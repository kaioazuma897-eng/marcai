import { db, tx, getSettings, setSettings, DEFAULT_SETTINGS } from './db.js';
import {
  HttpError, availableDays, createAppointment, getAppointment, getAppointmentByToken, getSlots,
  listAppointments, normalizePhone, rescheduleAppointment, setStatus,
} from './booking.js';
import { notify, notifyLater, runReminders, PROVIDER, BASE_URL } from './notify.js';
import { checkPassword, changePassword, clearSessionCookie, createSessionCookie, rateLimit } from './auth.js';
import { absMin, addDays, fmtMin, isDate, nowLocal, toMin, weekday } from './time.js';
import { PRESETS, applyPreset } from './seed.js';

export const routes = [];
const route = (method, path, handler, { auth = false } = {}) => {
  const keys = [];
  const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth });
};
const admin = (method, path, handler) => route(method, '/api/admin' + path, handler, { auth: true });

const need = (cond, msg, status = 400) => { if (!cond) throw new HttpError(status, msg); };
const int = (v) => Number.parseInt(v, 10);
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function publicInfo() {
  const s = getSettings();
  const services = db.prepare('SELECT id, name, description, duration_min, price_cents FROM services WHERE active = 1 ORDER BY sort, id').all();
  const professionals = db.prepare('SELECT id, name, role, color FROM professionals WHERE active = 1 ORDER BY sort, id').all();
  const map = db.prepare('SELECT service_id FROM professional_services WHERE professional_id = ?');
  for (const p of professionals) p.service_ids = map.all(p.id).map((r) => r.service_id);
  return { settings: s, services, professionals, today: nowLocal(s.timezone).date };
}

// =============================== Público ===============================

route('GET', '/api/public/info', () => publicInfo());

route('GET', '/api/public/days', ({ query }) =>
  availableDays({ serviceId: int(query.service), professionalId: int(query.professional) || null }));

route('GET', '/api/public/slots', ({ query }) =>
  getSlots({ date: query.date, serviceId: int(query.service), professionalId: int(query.professional) || null })
    .map(({ time, professionals }) => ({ time, professionals })));

route('POST', '/api/public/appointments', ({ body, ip }) => {
  need(rateLimit('book:' + ip, 15, 3600_000), 'Muitas tentativas. Tente novamente mais tarde.', 429);
  const appt = createAppointment(body, 'online');
  notifyLater('confirmation', appt);
  return { token: appt.token, appointment: publicAppt(appt) };
});

route('GET', '/api/public/appointments/:token', ({ params }) => {
  const appt = getAppointmentByToken(params.token);
  need(appt, 'Agendamento não encontrado.', 404);
  return publicAppt(appt);
});

route('POST', '/api/public/appointments/:token/cancel', ({ params }) => {
  const appt = getAppointmentByToken(params.token);
  need(appt, 'Agendamento não encontrado.', 404);
  need(appt.status === 'confirmed', 'Este agendamento não pode mais ser cancelado.', 409);
  const s = getSettings();
  const left = absMin(appt.date, appt.start_min) - nowLocal(s.timezone).abs;
  need(left >= Number(s.cancel_limit_hours) * 60,
    `O cancelamento online vai até ${s.cancel_limit_hours}h antes. Fale com a gente pelo WhatsApp.`, 409);
  const updated = setStatus(appt.id, 'cancelled');
  notifyLater('cancellation', updated);
  return publicAppt(updated);
});

function publicAppt(a) {
  const s = getSettings();
  const left = absMin(a.date, a.start_min) - nowLocal(s.timezone).abs;
  return {
    token: a.token, date: a.date, time: a.time, end: a.end, status: a.status,
    service_name: a.service_name, professional_name: a.professional_name, price_cents: a.price_cents,
    customer_name: a.customer_name,
    can_cancel: a.status === 'confirmed' && left >= Number(s.cancel_limit_hours) * 60,
  };
}

// =============================== Sessão ===============================

route('POST', '/api/admin/login', ({ body, ip, res }) => {
  need(rateLimit('login:' + ip, 10, 900_000), 'Muitas tentativas. Aguarde 15 minutos.', 429);
  need(checkPassword(str(body.password, 200)), 'Senha incorreta.', 401);
  res.setHeader('Set-Cookie', createSessionCookie(BASE_URL.startsWith('https')));
  return { ok: true };
});

route('POST', '/api/admin/logout', ({ res }) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  return { ok: true };
});

admin('GET', '/me', () => ({ ok: true, provider: PROVIDER, base_url: BASE_URL }));

admin('POST', '/password', ({ body }) => {
  need(checkPassword(str(body.current, 200)), 'Senha atual incorreta.', 401);
  need(str(body.next, 200).length >= 6, 'A nova senha precisa ter pelo menos 6 caracteres.');
  changePassword(str(body.next, 200));
  return { ok: true };
});

// =============================== Agenda ===============================

admin('GET', '/agenda', ({ query }) => {
  const s = getSettings();
  const date = isDate(query.date) ? query.date : nowLocal(s.timezone).date;
  const wd = weekday(date);
  const pros = db.prepare('SELECT id, name, role, color FROM professionals WHERE active = 1 ORDER BY sort, id').all();
  const hours = db.prepare('SELECT start_min, end_min FROM working_hours WHERE professional_id = ? AND weekday = ? ORDER BY start_min');
  for (const p of pros) p.hours = hours.all(p.id, wd);
  const blocks = db.prepare('SELECT * FROM blocks WHERE date = ? ORDER BY start_min').all(date);
  return { date, now: nowLocal(s.timezone), professionals: pros, blocks, appointments: listAppointments({ from: date, to: date }) };
});

admin('GET', '/dashboard', ({ query }) => {
  const s = getSettings();
  const now = nowLocal(s.timezone);
  const date = isDate(query.date) ? query.date : now.date;
  const day = listAppointments({ from: date, to: date }).filter((a) => a.status !== 'cancelled');

  // Ocupação: minutos agendados / minutos de expediente no dia.
  const openMin = db.prepare(`SELECT COALESCE(SUM(w.end_min - w.start_min), 0) AS m FROM working_hours w
    JOIN professionals p ON p.id = w.professional_id AND p.active = 1 WHERE w.weekday = ?`).get(weekday(date)).m;
  const bookedMin = day.reduce((sum, a) => sum + (a.end_min - a.start_min), 0);

  const from30 = addDays(now.date, -30);
  const last30 = db.prepare(`SELECT status, COUNT(*) AS n, SUM(price_cents) AS c FROM appointments
    WHERE date >= ? AND date < ? GROUP BY status`).all(from30, now.date);
  const by = Object.fromEntries(last30.map((r) => [r.status, r]));
  const past = (by.done?.n || 0) + (by.no_show?.n || 0);

  const next7 = db.prepare(`SELECT date, COUNT(*) AS n, SUM(price_cents) AS c FROM appointments
    WHERE date BETWEEN ? AND ? AND status != 'cancelled' GROUP BY date`).all(now.date, addDays(now.date, 6));
  const topServices = db.prepare(`SELECT s.name, COUNT(*) AS n, SUM(a.price_cents) AS c FROM appointments a
    JOIN services s ON s.id = a.service_id WHERE a.date >= ? AND a.date < ? AND a.status = 'done'
    GROUP BY s.id ORDER BY c DESC LIMIT 5`).all(from30, now.date);

  const upcoming = date === now.date
    ? day.filter((a) => a.status === 'confirmed' && a.start_min >= now.min).slice(0, 1)[0] || null
    : null;

  return {
    date,
    day: {
      count: day.length,
      revenue_cents: day.reduce((sum, a) => sum + (a.status === 'no_show' ? 0 : a.price_cents), 0),
      done: day.filter((a) => a.status === 'done').length,
      occupancy: openMin ? Math.min(1, bookedMin / openMin) : 0,
      next: upcoming,
    },
    last30: {
      revenue_cents: by.done?.c || 0,
      done: by.done?.n || 0,
      no_show_rate: past ? (by.no_show?.n || 0) / past : 0,
      cancelled: by.cancelled?.n || 0,
      online_share: db.prepare("SELECT AVG(source = 'online') AS r FROM appointments WHERE date >= ? AND date < ?").get(from30, now.date).r || 0,
    },
    next7: Array.from({ length: 7 }, (_, i) => {
      const d = addDays(now.date, i);
      const row = next7.find((r) => r.date === d);
      return { date: d, count: row?.n || 0, revenue_cents: row?.c || 0 };
    }),
    top_services: topServices,
  };
});

admin('GET', '/appointments', ({ query }) =>
  listAppointments({ from: query.from, to: query.to, professionalId: query.professional, status: query.status }));

admin('GET', '/slots', ({ query }) =>
  getSlots({ date: query.date, serviceId: int(query.service), professionalId: int(query.professional) || null, ignoreRules: true })
    .map(({ time, professionals }) => ({ time, professionals })));

admin('POST', '/appointments', ({ body }) => {
  const appt = createAppointment(body, 'admin');
  if (body.notify !== false) notifyLater('confirmation', appt);
  return appt;
});

admin('PATCH', '/appointments/:id', async ({ params, body }) => {
  const id = int(params.id);
  const before = getAppointment(id);
  need(before, 'Agendamento não encontrado.', 404);
  let appt = before;
  if (body.notes !== undefined) {
    db.prepare("UPDATE appointments SET notes = ?, updated_at = datetime('now') WHERE id = ?").run(str(body.notes, 500), id);
    appt = getAppointment(id);
  }
  if (body.date || body.time || body.professionalId) {
    appt = rescheduleAppointment(id, {
      date: body.date || before.date, time: body.time || before.time, professionalId: body.professionalId,
    });
    if (body.notify !== false && (appt.date !== before.date || appt.start_min !== before.start_min)) notifyLater('reschedule', appt);
  }
  if (body.status && body.status !== appt.status) {
    appt = setStatus(id, body.status);
    if (body.status === 'cancelled' && body.notify !== false) notifyLater('cancellation', appt);
  }
  return appt;
});

admin('POST', '/appointments/:id/notify', async ({ params, body }) => {
  const kind = ['confirmation', 'reminder', 'cancellation', 'reschedule'].includes(body.kind) ? body.kind : 'reminder';
  const result = await notify(kind, int(params.id));
  need(result, 'Agendamento não encontrado.', 404);
  return result;
});

admin('GET', '/export.csv', ({ query, res }) => {
  const rows = listAppointments({ from: query.from, to: query.to });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = ['data', 'inicio', 'fim', 'servico', 'profissional', 'cliente', 'whatsapp', 'email', 'valor', 'status', 'origem', 'observacoes'];
  const lines = rows.map((a) => [a.date, a.time, a.end, a.service_name, a.professional_name, a.customer_name,
    a.customer_phone, a.customer_email, (a.price_cents / 100).toFixed(2).replace('.', ','), a.status, a.source, a.notes].map(esc).join(';'));
  res.setHeader('Content-Disposition', `attachment; filename="agendamentos-${query.from || 'inicio'}-${query.to || 'fim'}.csv"`);
  return { raw: '﻿' + [header.join(';'), ...lines].join('\r\n'), type: 'text/csv; charset=utf-8' };
});

// =============================== Clientes ===============================

admin('GET', '/customers', ({ query }) => {
  const q = `%${str(query.q, 60)}%`;
  const digits = str(query.q, 60).replace(/\D/g, '');
  return db.prepare(`
    SELECT customer_phone AS phone,
           (SELECT customer_name FROM appointments x WHERE x.customer_phone = a.customer_phone ORDER BY x.id DESC LIMIT 1) AS name,
           MAX(customer_email) AS email,
           COUNT(*) AS total,
           SUM(status = 'done') AS done,
           SUM(status = 'no_show') AS no_show,
           SUM(status = 'cancelled') AS cancelled,
           MAX(CASE WHEN status = 'done' THEN date END) AS last_visit,
           MIN(CASE WHEN status = 'confirmed' THEN date END) AS next_visit,
           SUM(CASE WHEN status = 'done' THEN price_cents ELSE 0 END) AS spent_cents
    FROM appointments a
    WHERE customer_name LIKE ? ${digits ? 'OR customer_phone LIKE ?' : ''}
    GROUP BY customer_phone
    ORDER BY MAX(a.id) DESC
    LIMIT 300`).all(...(digits ? [q, `%${digits}%`] : [q]));
});

admin('GET', '/customers/:phone', ({ params }) =>
  db.prepare(`SELECT a.id, a.date, a.start_min, a.status, a.price_cents, s.name AS service_name, p.name AS professional_name
    FROM appointments a JOIN services s ON s.id = a.service_id JOIN professionals p ON p.id = a.professional_id
    WHERE a.customer_phone = ? ORDER BY a.date DESC, a.start_min DESC LIMIT 50`).all(normalizePhone(params.phone))
    .map((a) => ({ ...a, time: fmtMin(a.start_min) })));

// =============================== Serviços ===============================

function readService(body) {
  const data = {
    name: str(body.name, 80),
    description: str(body.description, 200),
    duration_min: int(body.duration_min),
    price_cents: Math.round(Number(body.price_cents)),
    active: body.active === false || body.active === 0 ? 0 : 1,
  };
  need(data.name.length >= 2, 'Dê um nome ao serviço.');
  need(data.duration_min >= 5 && data.duration_min <= 720, 'Duração deve ficar entre 5 e 720 minutos.');
  need(Number.isFinite(data.price_cents) && data.price_cents >= 0, 'Preço inválido.');
  return data;
}

admin('GET', '/services', () =>
  db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM professional_services ps WHERE ps.service_id = s.id) AS professionals
    FROM services s ORDER BY s.active DESC, s.sort, s.id`).all());

admin('POST', '/services', ({ body }) => tx(() => {
  const d = readService(body);
  const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM services').get().n;
  const id = Number(db.prepare('INSERT INTO services (name, description, duration_min, price_cents, active, sort) VALUES (?, ?, ?, ?, ?, ?)')
    .run(d.name, d.description, d.duration_min, d.price_cents, d.active, sort).lastInsertRowid);
  // Novo serviço já fica disponível para todos os profissionais ativos; dá para ajustar depois.
  db.prepare('INSERT INTO professional_services (professional_id, service_id) SELECT id, ? FROM professionals WHERE active = 1').run(id);
  return db.prepare('SELECT * FROM services WHERE id = ?').get(id);
}));

admin('PUT', '/services/:id', ({ params, body }) => {
  const d = readService(body);
  const r = db.prepare('UPDATE services SET name = ?, description = ?, duration_min = ?, price_cents = ?, active = ? WHERE id = ?')
    .run(d.name, d.description, d.duration_min, d.price_cents, d.active, int(params.id));
  need(r.changes, 'Serviço não encontrado.', 404);
  return db.prepare('SELECT * FROM services WHERE id = ?').get(int(params.id));
});

admin('DELETE', '/services/:id', ({ params }) => {
  const id = int(params.id);
  const used = db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE service_id = ?').get(id).n;
  if (used) {
    db.prepare('UPDATE services SET active = 0 WHERE id = ?').run(id);
    return { archived: true };
  }
  db.prepare('DELETE FROM services WHERE id = ?').run(id);
  return { deleted: true };
});

// =============================== Profissionais ===============================

function fullProfessional(id) {
  const p = db.prepare('SELECT * FROM professionals WHERE id = ?').get(id);
  if (!p) return null;
  p.service_ids = db.prepare('SELECT service_id FROM professional_services WHERE professional_id = ?').all(id).map((r) => r.service_id);
  p.hours = db.prepare('SELECT weekday, start_min, end_min FROM working_hours WHERE professional_id = ? ORDER BY weekday, start_min')
    .all(id).map((h) => ({ weekday: h.weekday, start: fmtMin(h.start_min), end: fmtMin(h.end_min) }));
  return p;
}

function saveProfessional(id, body) {
  const name = str(body.name, 80);
  need(name.length >= 2, 'Informe o nome.');
  const color = /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : '#6366f1';
  const hours = (Array.isArray(body.hours) ? body.hours : []).map((h) => ({
    weekday: int(h.weekday), start: toMin(h.start), end: toMin(h.end),
  }));
  for (const h of hours) {
    need(h.weekday >= 0 && h.weekday <= 6 && h.start < h.end, 'Confira os horários: o início precisa ser antes do fim.');
  }
  return tx(() => {
    if (id) {
      need(db.prepare('UPDATE professionals SET name = ?, role = ?, color = ?, active = ? WHERE id = ?')
        .run(name, str(body.role, 60), color, body.active === false ? 0 : 1, id).changes, 'Profissional não encontrado.', 404);
    } else {
      const sort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM professionals').get().n;
      id = Number(db.prepare('INSERT INTO professionals (name, role, color, sort) VALUES (?, ?, ?, ?)')
        .run(name, str(body.role, 60), color, sort).lastInsertRowid);
    }
    db.prepare('DELETE FROM professional_services WHERE professional_id = ?').run(id);
    const insMap = db.prepare('INSERT OR IGNORE INTO professional_services (professional_id, service_id) SELECT ?, id FROM services WHERE id = ?');
    for (const sid of body.service_ids || []) insMap.run(id, int(sid));
    db.prepare('DELETE FROM working_hours WHERE professional_id = ?').run(id);
    const insHour = db.prepare('INSERT INTO working_hours (professional_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)');
    for (const h of hours) insHour.run(id, h.weekday, h.start, h.end);
    return fullProfessional(id);
  });
}

admin('GET', '/professionals', () =>
  db.prepare('SELECT id FROM professionals ORDER BY active DESC, sort, id').all().map((r) => fullProfessional(r.id)));
admin('POST', '/professionals', ({ body }) => saveProfessional(null, body));
admin('PUT', '/professionals/:id', ({ params, body }) => saveProfessional(int(params.id), body));
admin('DELETE', '/professionals/:id', ({ params }) => {
  const id = int(params.id);
  const used = db.prepare('SELECT COUNT(*) AS n FROM appointments WHERE professional_id = ?').get(id).n;
  if (used) {
    db.prepare('UPDATE professionals SET active = 0 WHERE id = ?').run(id);
    return { archived: true };
  }
  db.prepare('DELETE FROM professionals WHERE id = ?').run(id);
  return { deleted: true };
});

// =============================== Bloqueios ===============================

admin('GET', '/blocks', ({ query }) => {
  const from = isDate(query.from) ? query.from : nowLocal(getSettings().timezone).date;
  return db.prepare(`SELECT b.*, p.name AS professional_name FROM blocks b
    LEFT JOIN professionals p ON p.id = b.professional_id WHERE b.date >= ? ORDER BY b.date, b.start_min LIMIT 300`).all(from)
    .map((b) => ({ ...b, start: fmtMin(b.start_min), end: fmtMin(b.end_min) }));
});

admin('POST', '/blocks', ({ body }) => {
  const from = body.date;
  const to = body.date_to || body.date;
  need(isDate(from) && isDate(to) && to >= from, 'Datas inválidas.');
  const allDay = !!body.all_day;
  const start = allDay ? 0 : toMin(body.start);
  const end = allDay ? 1440 : toMin(body.end);
  need(start < end, 'O início precisa ser antes do fim.');
  const days = [];
  for (let d = from; d <= to && days.length < 120; d = addDays(d, 1)) days.push(d);
  const pro = int(body.professional_id) || null;
  const conflicts = db.prepare(`SELECT COUNT(*) AS n FROM appointments WHERE status = 'confirmed'
    AND date BETWEEN ? AND ? AND start_min < ? AND end_min > ? ${pro ? 'AND professional_id = ?' : ''}`)
    .get(...[from, to, end, start, ...(pro ? [pro] : [])]).n;
  tx(() => {
    const ins = db.prepare('INSERT INTO blocks (professional_id, date, start_min, end_min, reason) VALUES (?, ?, ?, ?, ?)');
    for (const d of days) ins.run(pro, d, start, end, str(body.reason, 120));
  });
  return { created: days.length, conflicts };
});

admin('DELETE', '/blocks/:id', ({ params }) => {
  db.prepare('DELETE FROM blocks WHERE id = ?').run(int(params.id));
  return { ok: true };
});

// =============================== Mensagens ===============================

admin('GET', '/notifications', () =>
  db.prepare(`SELECT n.*, a.customer_name, a.date, a.start_min FROM notifications n
    LEFT JOIN appointments a ON a.id = n.appointment_id ORDER BY n.id DESC LIMIT 200`).all()
    .map((n) => ({ ...n, time: n.start_min != null ? fmtMin(n.start_min) : null })));

admin('POST', '/notifications/run', async () => ({ sent: await runReminders() }));

// =============================== Configurações ===============================

admin('GET', '/settings', () => ({ settings: getSettings(), presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, v.label])) }));

admin('PUT', '/settings', ({ body }) => {
  const out = {};
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    if (body[k] === undefined) continue;
    if (typeof def === 'number') {
      const n = Number(body[k]);
      need(Number.isFinite(n) && n >= 0 && n <= 10000, `Valor inválido em ${k}.`);
      out[k] = n;
    } else {
      out[k] = str(body[k], 300);
    }
  }
  if (out.slot_step !== undefined) need(out.slot_step >= 5 && out.slot_step <= 240, 'Intervalo entre horários deve ficar entre 5 e 240 min.');
  if (out.max_days_ahead !== undefined) need(out.max_days_ahead >= 1 && out.max_days_ahead <= 180, 'Dias à frente: entre 1 e 180.');
  if (out.primary_color !== undefined) need(/^#[0-9a-f]{6}$/i.test(out.primary_color), 'Cor inválida.');
  if (out.whatsapp !== undefined) out.whatsapp = out.whatsapp ? normalizePhone(out.whatsapp) : '';
  if (out.timezone !== undefined) {
    try { new Intl.DateTimeFormat('pt-BR', { timeZone: out.timezone }); } catch { throw new HttpError(400, 'Fuso horário inválido.'); }
  }
  setSettings(out);
  return getSettings();
});

admin('POST', '/reset', ({ body }) => {
  need(PRESETS[body.preset], 'Modelo inválido.');
  need(body.confirm === 'APAGAR', 'Digite APAGAR para confirmar.');
  applyPreset(body.preset, { demo: !!body.demo });
  return { ok: true };
});
