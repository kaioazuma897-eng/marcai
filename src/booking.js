import crypto from 'node:crypto';
import { db, tx, getSettings } from './db.js';
import { absMin, addDays, dayNumber, fmtMin, isDate, nowLocal, weekday } from './time.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const STATUSES = ['confirmed', 'done', 'no_show', 'cancelled'];

// Guarda só dígitos; números brasileiros sem DDI ganham 55 na frente.
export function normalizePhone(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  return d;
}

const APPT_SELECT = `
  SELECT a.*, s.name AS service_name, s.duration_min,
         p.name AS professional_name, p.color AS professional_color
  FROM appointments a
  JOIN services s ON s.id = a.service_id
  JOIN professionals p ON p.id = a.professional_id`;

export function serializeAppt(a) {
  if (!a) return null;
  return {
    id: a.id,
    token: a.token,
    date: a.date,
    time: fmtMin(a.start_min),
    end: fmtMin(a.end_min),
    start_min: a.start_min,
    end_min: a.end_min,
    service_id: a.service_id,
    service_name: a.service_name,
    professional_id: a.professional_id,
    professional_name: a.professional_name,
    professional_color: a.professional_color,
    customer_name: a.customer_name,
    customer_phone: a.customer_phone,
    customer_email: a.customer_email,
    notes: a.notes,
    price_cents: a.price_cents,
    status: a.status,
    source: a.source,
    reminder_sent_at: a.reminder_sent_at,
    created_at: a.created_at,
  };
}

export const getAppointment = (id) => serializeAppt(db.prepare(`${APPT_SELECT} WHERE a.id = ?`).get(id));
export const getAppointmentByToken = (token) =>
  serializeAppt(db.prepare(`${APPT_SELECT} WHERE a.token = ?`).get(String(token)));

export function listAppointments({ from, to, professionalId, status } = {}) {
  const where = [];
  const params = [];
  if (from) { where.push('a.date >= ?'); params.push(from); }
  if (to) { where.push('a.date <= ?'); params.push(to); }
  if (professionalId) { where.push('a.professional_id = ?'); params.push(Number(professionalId)); }
  if (status) { where.push('a.status = ?'); params.push(status); }
  const sql = `${APPT_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.date, a.start_min, p.sort, p.id`;
  return db.prepare(sql).all(...params).map(serializeAppt);
}

function professionalsFor(serviceId, professionalId) {
  const sql = `
    SELECT p.* FROM professionals p
    JOIN professional_services ps ON ps.professional_id = p.id AND ps.service_id = ?
    WHERE p.active = 1 ${professionalId ? 'AND p.id = ?' : ''}
    ORDER BY p.sort, p.id`;
  return professionalId ? db.prepare(sql).all(serviceId, Number(professionalId)) : db.prepare(sql).all(serviceId);
}

function busyIntervals(professionalId, date, excludeId = 0) {
  const appts = db.prepare(
    `SELECT start_min, end_min FROM appointments
     WHERE professional_id = ? AND date = ? AND status != 'cancelled' AND id != ?`,
  ).all(professionalId, date, excludeId);
  const blocks = db.prepare(
    `SELECT start_min, end_min FROM blocks
     WHERE date = ? AND (professional_id IS NULL OR professional_id = ?)`,
  ).all(date, professionalId);
  return [...appts, ...blocks];
}

export function hasConflict(professionalId, date, start, end, excludeId = 0) {
  return busyIntervals(professionalId, date, excludeId).some((b) => b.start_min < end && b.end_min > start);
}

/**
 * Horários livres de um serviço num dia. Cada horário traz os profissionais que podem atendê-lo.
 * `ignoreRules` (painel) desconsidera antecedência mínima e limite de dias à frente.
 */
export function getSlots({ date, serviceId, professionalId, ignoreRules = false }) {
  const s = getSettings();
  if (!isDate(date)) return [];
  const now = nowLocal(s.timezone);
  const dn = dayNumber(date);
  const today = dayNumber(now.date);
  if (!ignoreRules && (dn < today || dn > today + Number(s.max_days_ahead))) return [];

  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(Number(serviceId));
  if (!service || (!service.active && !ignoreRules)) return [];

  const step = Math.max(5, Number(s.slot_step) || 30);
  const earliest = ignoreRules ? -Infinity : now.abs + Number(s.min_notice_min);
  const wd = weekday(date);
  const bySlot = new Map();
  const hoursStmt = db.prepare(
    'SELECT start_min, end_min FROM working_hours WHERE professional_id = ? AND weekday = ? ORDER BY start_min',
  );

  for (const pro of professionalsFor(service.id, professionalId)) {
    const busy = busyIntervals(pro.id, date);
    for (const h of hoursStmt.all(pro.id, wd)) {
      for (let t = h.start_min; t + service.duration_min <= h.end_min; t += step) {
        if (absMin(date, t) < earliest) continue;
        const end = t + service.duration_min;
        if (busy.some((b) => b.start_min < end && b.end_min > t)) continue;
        if (!bySlot.has(t)) bySlot.set(t, []);
        bySlot.get(t).push(pro.id);
      }
    }
  }

  return [...bySlot.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([min, pros]) => ({ min, time: fmtMin(min), professionals: pros }));
}

export function availableDays({ serviceId, professionalId }) {
  const s = getSettings();
  const today = nowLocal(s.timezone).date;
  const days = [];
  for (let i = 0; i <= Number(s.max_days_ahead); i++) {
    const date = addDays(today, i);
    days.push({ date, slots: getSlots({ date, serviceId, professionalId }).length });
  }
  return days;
}

function pickLeastBusy(candidates, date) {
  if (candidates.length === 1) return candidates[0];
  const load = db.prepare(
    "SELECT COALESCE(SUM(end_min - start_min), 0) AS m FROM appointments WHERE professional_id = ? AND date = ? AND status != 'cancelled'",
  );
  return candidates
    .map((id) => ({ id, m: load.get(id, date).m }))
    .sort((a, b) => a.m - b.m)[0].id;
}

function reminderAlreadyDue(date, startMin, settings) {
  const now = nowLocal(settings.timezone);
  return absMin(date, startMin) - now.abs <= Number(settings.reminder_hours) * 60;
}

/**
 * Cria um agendamento. A verificação de disponibilidade e o INSERT rodam na mesma transação síncrona,
 * então dois clientes não conseguem pegar o mesmo horário.
 * - source 'online': precisa cair num horário oferecido pela página pública.
 * - source 'admin': o dono pode encaixar fora do expediente, desde que não haja conflito.
 */
export function createAppointment(input, source = 'online') {
  const settings = getSettings();
  const name = String(input.name || '').trim().slice(0, 80);
  const phone = normalizePhone(input.phone);
  const email = String(input.email || '').trim().slice(0, 120);
  const notes = String(input.notes || '').trim().slice(0, 500);
  const date = String(input.date || '');
  const startMin = typeof input.time === 'number' ? input.time : toMinSafe(input.time);

  if (name.length < 2) throw new HttpError(400, 'Informe seu nome.');
  if (phone.length < 12 || phone.length > 13) throw new HttpError(400, 'Informe um WhatsApp válido com DDD.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'E-mail inválido.');
  if (!isDate(date) || Number.isNaN(startMin)) throw new HttpError(400, 'Data ou horário inválido.');

  const service = db.prepare('SELECT * FROM services WHERE id = ?').get(Number(input.serviceId));
  if (!service || (!service.active && source === 'online')) throw new HttpError(400, 'Serviço indisponível.');
  const endMin = startMin + service.duration_min;
  const professionalId = input.professionalId ? Number(input.professionalId) : null;

  return tx(() => {
    let candidates;
    if (source === 'online') {
      const slot = getSlots({ date, serviceId: service.id, professionalId }).find((x) => x.min === startMin);
      candidates = slot ? slot.professionals : [];
    } else {
      if (endMin > 1440) throw new HttpError(400, 'O atendimento passaria da meia-noite.');
      const pros = professionalId
        ? db.prepare('SELECT id FROM professionals WHERE id = ?').all(professionalId)
        : professionalsFor(service.id, null);
      candidates = pros.map((p) => p.id).filter((id) => !hasConflict(id, date, startMin, endMin));
    }
    if (!candidates.length) {
      throw new HttpError(409, 'Esse horário acabou de ser preenchido. Escolha outro, por favor.');
    }

    const chosen = pickLeastBusy(candidates, date);
    const token = crypto.randomBytes(16).toString('base64url');
    const reminder = reminderAlreadyDue(date, startMin, settings) ? new Date().toISOString() : null;
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO appointments (token, service_id, professional_id, date, start_min, end_min,
         customer_name, customer_phone, customer_email, notes, price_cents, source, reminder_sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(token, service.id, chosen, date, startMin, endMin, name, phone, email, notes,
      service.price_cents, source, reminder);
    return getAppointment(Number(lastInsertRowid));
  });
}

export function rescheduleAppointment(id, { date, time, professionalId }) {
  const settings = getSettings();
  return tx(() => {
    const appt = getAppointment(id);
    if (!appt) throw new HttpError(404, 'Agendamento não encontrado.');
    const startMin = toMinSafe(time);
    if (!isDate(date) || Number.isNaN(startMin)) throw new HttpError(400, 'Data ou horário inválido.');
    const endMin = startMin + (appt.end_min - appt.start_min);
    if (endMin > 1440) throw new HttpError(400, 'O atendimento passaria da meia-noite.');
    const pro = Number(professionalId || appt.professional_id);
    if (hasConflict(pro, date, startMin, endMin, appt.id)) {
      throw new HttpError(409, 'Já existe um agendamento ou bloqueio nesse horário.');
    }
    const reminder = reminderAlreadyDue(date, startMin, settings) ? new Date().toISOString() : null;
    db.prepare(
      `UPDATE appointments SET date = ?, start_min = ?, end_min = ?, professional_id = ?,
         status = 'confirmed', reminder_sent_at = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(date, startMin, endMin, pro, reminder, appt.id);
    return getAppointment(appt.id);
  });
}

export function setStatus(id, status) {
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Status inválido.');
  const r = db.prepare("UPDATE appointments SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
  if (!r.changes) throw new HttpError(404, 'Agendamento não encontrado.');
  return getAppointment(id);
}

function toMinSafe(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v || ''));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}
