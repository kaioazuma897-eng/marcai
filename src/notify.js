import { db, getSettings } from './db.js';
import { getAppointment } from './booking.js';
import { absMin, addDays, longDate, nowLocal } from './time.js';

export const BASE_URL = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
export const PROVIDER = (process.env.NOTIFY_PROVIDER || 'log').toLowerCase();

const money = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function whenText(appt, s) {
  const now = nowLocal(s.timezone);
  if (appt.date === now.date) return `hoje às ${appt.time}`;
  if (appt.date === addDays(now.date, 1)) return `amanhã às ${appt.time}`;
  return `${longDate(appt.date)} às ${appt.time}`;
}

export function buildMessage(kind, appt, s = getSettings()) {
  const first = appt.customer_name.split(' ')[0];
  const link = `${BASE_URL}/?t=${appt.token}`;
  const where = s.address ? `\n📍 ${s.address}` : '';
  const what = `${appt.service_name} com ${appt.professional_name}` +
    (appt.price_cents ? ` (${money(appt.price_cents)})` : '');

  switch (kind) {
    case 'confirmation':
      return `Olá, ${first}! Seu horário na ${s.business_name} está confirmado ✅\n\n` +
        `📅 ${longDate(appt.date)} às ${appt.time}\n🗂 ${what}${where}\n\n` +
        `Precisa cancelar? Acesse: ${link}`;
    case 'reschedule':
      return `Olá, ${first}! Seu horário na ${s.business_name} foi remarcado 🔄\n\n` +
        `📅 ${longDate(appt.date)} às ${appt.time}\n🗂 ${what}${where}\n\nDetalhes: ${link}`;
    case 'reminder':
      return `Oi, ${first}! Passando para lembrar do seu horário ${whenText(appt, s)} na ${s.business_name} ⏰\n\n` +
        `🗂 ${what}${where}\n\nSe não puder vir, cancele pelo link para liberar a vaga: ${link}`;
    case 'cancellation':
      return `Olá, ${first}. Seu horário de ${longDate(appt.date)} às ${appt.time} na ${s.business_name} foi cancelado.\n\n` +
        `Quando quiser marcar de novo: ${BASE_URL}/`;
    default:
      throw new Error('Tipo de mensagem desconhecido: ' + kind);
  }
}

// ---- Provedores -----------------------------------------------------------------------------

const providers = {
  async log({ to, message }) {
    console.log(`\n[mensagem → +${to}]\n${message}\n`);
    return { status: 'logged' };
  },

  async webhook({ to, email, message, kind, appt }) {
    const url = process.env.NOTIFY_WEBHOOK_URL;
    if (!url) throw new Error('NOTIFY_WEBHOOK_URL não configurado');
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.NOTIFY_WEBHOOK_TOKEN) headers.Authorization = `Bearer ${process.env.NOTIFY_WEBHOOK_TOKEN}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ to, email, message, kind, appointment: appt }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Webhook respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { status: 'sent' };
  },

  async twilio({ to, message }) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM;
    if (!sid || !token || !from) throw new Error('Credenciais do Twilio incompletas');
    const toAddr = from.startsWith('whatsapp:') ? `whatsapp:+${to}` : `+${to}`;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ From: from, To: toAddr, Body: message }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Twilio respondeu ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return { status: 'sent' };
  },
};

export async function notify(kind, apptOrId) {
  const appt = typeof apptOrId === 'object' ? apptOrId : getAppointment(apptOrId);
  if (!appt) return null;
  const message = buildMessage(kind, appt);
  const send = providers[PROVIDER] || providers.log;
  let result;
  try {
    result = await send({ to: appt.customer_phone, email: appt.customer_email, message, kind, appt });
  } catch (err) {
    console.error(`[notify] falha ao enviar ${kind} do agendamento #${appt.id}:`, err.message);
    result = { status: 'failed', error: err.message };
  }
  db.prepare(
    `INSERT INTO notifications (appointment_id, kind, channel, recipient, message, status, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(appt.id, kind, PROVIDER, appt.customer_phone, message, result.status, result.error || null);
  return result;
}

// Dispara sem bloquear a resposta HTTP.
export const notifyLater = (kind, appt) => { notify(kind, appt).catch((e) => console.error(e)); };

// ---- Lembretes automáticos -------------------------------------------------------------------

let running = false;

export async function runReminders() {
  if (running) return 0;
  running = true;
  try {
    const s = getSettings();
    const now = nowLocal(s.timezone);
    const windowMin = Number(s.reminder_hours) * 60;
    const horizon = addDays(now.date, Math.ceil(windowMin / 1440) + 1);
    const due = db.prepare(
      `SELECT id, date, start_min FROM appointments
       WHERE status = 'confirmed' AND reminder_sent_at IS NULL AND date BETWEEN ? AND ?`,
    ).all(now.date, horizon).filter((a) => {
      const diff = absMin(a.date, a.start_min) - now.abs;
      return diff > 0 && diff <= windowMin;
    });

    const mark = db.prepare('UPDATE appointments SET reminder_sent_at = ? WHERE id = ? AND reminder_sent_at IS NULL');
    for (const a of due) {
      // Marca antes de enviar: se o envio falhar, fica registrado em Mensagens e o dono reenvia manualmente,
      // em vez de o cliente receber spam a cada minuto.
      if (!mark.run(new Date().toISOString(), a.id).changes) continue;
      await notify('reminder', a.id);
    }
    return due.length;
  } finally {
    running = false;
  }
}

export function startReminderLoop() {
  const tick = () => runReminders().catch((e) => console.error('[lembretes]', e));
  tick();
  return setInterval(tick, 60_000);
}
