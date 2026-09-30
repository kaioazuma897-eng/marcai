import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.NOTIFY_PROVIDER = 'log';

const { db, getSettings } = await import('../src/db.js');
const { applyPreset } = await import('../src/seed.js');
const { getSlots, createAppointment, rescheduleAppointment, HttpError } = await import('../src/booking.js');
const { runReminders } = await import('../src/notify.js');
const { addDays, nowLocal, weekday } = await import('../src/time.js');

console.log = () => {}; // silencia o provedor "log"

let day; // um dia útil da barbearia (ter–sáb) daqui a alguns dias
const corte = () => db.prepare("SELECT id FROM services WHERE name = 'Corte masculino'").get().id;
const pro = (name) => db.prepare('SELECT id FROM professionals WHERE name = ?').get(name).id;
const customer = { name: 'Cliente Teste', phone: '11987654321' };

before(() => {
  applyPreset('barbearia');
  const today = nowLocal(getSettings().timezone).date;
  day = addDays(today, 3);
  while (![2, 3, 4, 5, 6].includes(weekday(day))) day = addDays(day, 1);
});

test('oferece horários só dentro do expediente e respeita o almoço', () => {
  const times = getSlots({ date: day, serviceId: corte(), professionalId: pro('Rafael') }).map((s) => s.time);
  assert.equal(times[0], '09:00');
  assert.ok(times.includes('11:30'));
  assert.ok(!times.includes('12:00') && !times.includes('12:30'), 'não deve oferecer horário no almoço');
  assert.equal(times.at(-1), '18:30');
});

test('não oferece horários em dia de folga', () => {
  let sunday = day;
  while (weekday(sunday) !== 0) sunday = addDays(sunday, 1);
  assert.deepEqual(getSlots({ date: sunday, serviceId: corte() }), []);
});

test('serviço longo não "vaza" para o almoço nem para depois do expediente', () => {
  const combo = db.prepare("SELECT id FROM services WHERE name = 'Corte + barba'").get().id;
  const times = getSlots({ date: day, serviceId: combo, professionalId: pro('Rafael') }).map((s) => s.time);
  assert.ok(times.includes('11:00'));
  assert.ok(!times.includes('11:30'), '11:30 + 60min invadiria o almoço');
  assert.ok(!times.includes('18:30'), '18:30 + 60min passaria das 19:00');
});

test('impede dois clientes no mesmo horário com o mesmo profissional', () => {
  const input = { ...customer, serviceId: corte(), professionalId: pro('Rafael'), date: day, time: '10:00' };
  const first = createAppointment(input);
  assert.equal(first.professional_name, 'Rafael');
  assert.throws(() => createAppointment({ ...input, name: 'Outra Pessoa' }), (e) => e instanceof HttpError && e.status === 409);
  const times = getSlots({ date: day, serviceId: corte(), professionalId: pro('Rafael') }).map((s) => s.time);
  assert.ok(!times.includes('10:00'));
});

test('"sem preferência" distribui para quem estiver livre', () => {
  const input = { ...customer, serviceId: corte(), professionalId: null, date: day, time: '15:00' };
  const names = [createAppointment(input), createAppointment(input), createAppointment(input)].map((a) => a.professional_name);
  assert.equal(new Set(names).size, 3, 'cada um deve ir para um barbeiro diferente');
  assert.throws(() => createAppointment(input), (e) => e.status === 409, 'com todos ocupados, recusa');
});

test('bloqueio de agenda remove os horários', () => {
  db.prepare('INSERT INTO blocks (professional_id, date, start_min, end_min, reason) VALUES (NULL, ?, ?, ?, ?)').run(day, 16 * 60, 17 * 60, 'Reunião');
  const times = getSlots({ date: day, serviceId: corte() }).map((s) => s.time);
  assert.ok(!times.includes('16:00') && !times.includes('16:30'));
  assert.ok(times.includes('17:00'));
});

test('agendamento online precisa cair num horário oferecido; o painel pode encaixar', () => {
  const input = { ...customer, serviceId: corte(), professionalId: pro('Diego'), date: day, time: '12:15' };
  assert.throws(() => createAppointment(input, 'online'), (e) => e.status === 409);
  const encaixe = createAppointment(input, 'admin');
  assert.equal(encaixe.time, '12:15');
});

test('remarcar recusa conflito e aceita horário livre', () => {
  const a = createAppointment({ ...customer, serviceId: corte(), professionalId: pro('Diego'), date: day, time: '09:00' });
  createAppointment({ ...customer, serviceId: corte(), professionalId: pro('Diego'), date: day, time: '09:30' });
  assert.throws(() => rescheduleAppointment(a.id, { date: day, time: '09:30' }), (e) => e.status === 409);
  assert.equal(rescheduleAppointment(a.id, { date: day, time: '13:00' }).time, '13:00');
});

test('valida telefone e nome', () => {
  const base = { serviceId: corte(), date: day, time: '14:00' };
  assert.throws(() => createAppointment({ ...base, name: 'X', phone: '11987654321' }), (e) => e.status === 400);
  assert.throws(() => createAppointment({ ...base, name: 'Fulano', phone: '1234' }), (e) => e.status === 400);
});

test('lembrete sai uma única vez para quem está dentro da janela', async () => {
  const s = getSettings();
  const now = nowLocal(s.timezone);
  // Agendamento daqui a ~3h (fora da antecedência mínima), inserido direto para não depender do expediente.
  const start = now.min + 180 < 1440 ? now.min + 180 : 60;
  const date = now.min + 180 < 1440 ? now.date : addDays(now.date, 1);
  db.prepare(`INSERT INTO appointments (token, service_id, professional_id, date, start_min, end_min, customer_name, customer_phone)
    VALUES ('tok-reminder', ?, ?, ?, ?, ?, 'Lembrada', '5511900000000')`).run(corte(), pro('Rafael'), date, start, start + 30);
  const sent1 = await runReminders();
  const sent2 = await runReminders();
  assert.ok(sent1 >= 1);
  assert.equal(sent2, 0);
  const n = db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'reminder' AND recipient = '5511900000000'").get().n;
  assert.equal(n, 1);
});
