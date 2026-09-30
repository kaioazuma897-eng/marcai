// Modelos prontos por segmento + dados fictícios para demonstração.
// Uso: node src/seed.js <barbearia|salao|clinica|oficina> [--demo]   (apaga e recria tudo)
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { db, tx, setSettings, getSettings } from './db.js';
import { addDays, nowLocal, toMin, weekday } from './time.js';

const MON_FRI = [1, 2, 3, 4, 5];
const TUE_SAT = [2, 3, 4, 5, 6];

export const PRESETS = {
  barbearia: {
    label: 'Barbearia',
    settings: {
      business_name: 'Barbearia Navalha de Ouro', tagline: 'Corte, barba e aquele café enquanto espera',
      primary_color: '#b45309', staff_label: 'Barbeiro', notes_label: 'Alguma preferência de corte?',
      slot_step: 30, address: 'Rua Augusta, 1200 — São Paulo/SP', whatsapp: '5511999990000',
    },
    services: [
      ['Corte masculino', 30, 4500, 'Tesoura e máquina, com lavagem'],
      ['Barba', 30, 3500, 'Toalha quente e navalha'],
      ['Corte + barba', 60, 7000, 'O combo completo'],
      ['Pigmentação', 45, 5000, ''],
      ['Sobrancelha', 15, 1500, ''],
    ],
    professionals: [
      { name: 'Rafael', role: 'Barbeiro', color: '#d97706' },
      { name: 'Diego', role: 'Barbeiro', color: '#2563eb' },
      { name: 'Thiago', role: 'Barbeiro júnior', color: '#059669', services: [0, 1, 4] },
    ],
    hours: { days: TUE_SAT, ranges: [['09:00', '12:00'], ['13:00', '19:00']] },
  },
  salao: {
    label: 'Salão de beleza',
    settings: {
      business_name: 'Studio Bella', tagline: 'Cabelo, unhas e autoestima em dia',
      primary_color: '#be185d', staff_label: 'Profissional', notes_label: 'Observações (ex.: comprimento do cabelo)',
      slot_step: 30, address: 'Av. Brasil, 450 — Belo Horizonte/MG', whatsapp: '5531999990000',
    },
    services: [
      ['Corte feminino', 60, 9000, ''],
      ['Escova', 45, 6000, ''],
      ['Coloração', 120, 18000, 'Inclui tonalizante'],
      ['Hidratação', 60, 8000, ''],
      ['Manicure', 45, 4000, ''],
      ['Pedicure', 45, 4500, ''],
    ],
    professionals: [
      { name: 'Ana Paula', role: 'Cabeleireira', color: '#db2777', services: [0, 1, 2, 3] },
      { name: 'Juliana', role: 'Cabeleireira', color: '#7c3aed', services: [0, 1, 3] },
      { name: 'Camila', role: 'Manicure', color: '#0891b2', services: [4, 5] },
    ],
    hours: { days: TUE_SAT, ranges: [['09:00', '19:00']] },
  },
  clinica: {
    label: 'Clínica',
    settings: {
      business_name: 'Clínica Viver Bem', tagline: 'Fisioterapia e nutrição com hora marcada',
      primary_color: '#0f766e', staff_label: 'Especialista', notes_label: 'Convênio ou motivo da consulta',
      slot_step: 30, address: 'Rua das Flores, 88, sala 12 — Curitiba/PR', whatsapp: '5541999990000',
      cancel_limit_hours: 12,
    },
    services: [
      ['Consulta de fisioterapia', 50, 20000, 'Avaliação inicial'],
      ['Sessão de fisioterapia', 50, 15000, ''],
      ['Consulta nutricional', 60, 22000, 'Com bioimpedância'],
      ['Retorno nutricional', 30, 12000, ''],
    ],
    professionals: [
      { name: 'Dra. Marina Lopes', role: 'Fisioterapeuta', color: '#0d9488', services: [0, 1] },
      { name: 'Dr. Paulo Mendes', role: 'Nutricionista', color: '#4f46e5', services: [2, 3] },
    ],
    hours: { days: MON_FRI, ranges: [['08:00', '12:00'], ['14:00', '18:00']] },
  },
  oficina: {
    label: 'Oficina mecânica',
    settings: {
      business_name: 'Auto Center Pistão', tagline: 'Deixe o carro e volte com ele pronto',
      primary_color: '#1d4ed8', staff_label: 'Box', notes_label: 'Modelo, ano e placa do veículo',
      slot_step: 60, address: 'Av. Industrial, 3000 — Campinas/SP', whatsapp: '5519999990000',
      min_notice_min: 180, cancel_limit_hours: 4,
    },
    services: [
      ['Troca de óleo e filtro', 60, 18000, ''],
      ['Alinhamento e balanceamento', 60, 15000, ''],
      ['Diagnóstico eletrônico', 60, 12000, 'Scanner + relatório'],
      ['Revisão de freios', 120, 25000, ''],
      ['Revisão completa', 240, 60000, 'Checklist de 40 itens'],
    ],
    professionals: [
      { name: 'Box 1 — Elevador', role: 'Mecânica geral', color: '#2563eb' },
      { name: 'Box 2 — Alinhamento', role: 'Suspensão', color: '#ea580c', services: [1] },
    ],
    hours: { days: MON_FRI, ranges: [['08:00', '12:00'], ['13:00', '18:00']], saturday: [['08:00', '12:00']] },
  },
};

const DEMO_CUSTOMERS = [
  'Lucas Almeida', 'Mariana Costa', 'Pedro Henrique', 'Beatriz Souza', 'Gabriel Lima', 'Larissa Rocha',
  'Matheus Oliveira', 'Fernanda Dias', 'João Victor', 'Amanda Ribeiro', 'Rafael Martins', 'Carolina Nunes',
  'Bruno Carvalho', 'Letícia Gomes', 'Gustavo Pereira', 'Isabela Freitas', 'Felipe Barbosa', 'Natália Pinto',
  'Leonardo Teixeira', 'Vitória Araújo', 'Eduardo Moreira', 'Júlia Cardoso', 'Rodrigo Castro', 'Aline Ramos',
  'Vinícius Moura', 'Patrícia Lopes', 'André Fernandes', 'Renata Vieira',
].map((name, i) => ({ name, phone: `55119${String(70000000 + i * 137911).slice(0, 8)}` }));

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function applyPreset(key, { demo = false } = {}) {
  const preset = PRESETS[key];
  if (!preset) throw new Error(`Modelo desconhecido: ${key}. Use: ${Object.keys(PRESETS).join(', ')}`);

  tx(() => {
    for (const t of ['notifications', 'appointments', 'blocks', 'working_hours', 'professional_services', 'professionals', 'services']) {
      db.exec(`DELETE FROM ${t}`);
    }
    db.exec("DELETE FROM settings WHERE key NOT LIKE '\\_%' ESCAPE '\\'");
    setSettings({ ...preset.settings, segment: key });

    const insService = db.prepare('INSERT INTO services (name, duration_min, price_cents, description, sort) VALUES (?, ?, ?, ?, ?)');
    const serviceIds = preset.services.map(([name, dur, price, desc], i) =>
      Number(insService.run(name, dur, price, desc, i).lastInsertRowid));

    const insPro = db.prepare('INSERT INTO professionals (name, role, color, sort) VALUES (?, ?, ?, ?)');
    const insMap = db.prepare('INSERT INTO professional_services (professional_id, service_id) VALUES (?, ?)');
    const insHour = db.prepare('INSERT INTO working_hours (professional_id, weekday, start_min, end_min) VALUES (?, ?, ?, ?)');

    preset.professionals.forEach((p, i) => {
      const id = Number(insPro.run(p.name, p.role, p.color, i).lastInsertRowid);
      (p.services || serviceIds.map((_, j) => j)).forEach((j) => insMap.run(id, serviceIds[j]));
      for (const d of preset.hours.days) {
        for (const [a, b] of preset.hours.ranges) insHour.run(id, d, toMin(a), toMin(b));
      }
      for (const [a, b] of preset.hours.saturday || []) insHour.run(id, 6, toMin(a), toMin(b));
    });

    if (demo) seedDemoAppointments();
  });
}

function seedDemoAppointments() {
  const s = getSettings();
  const now = nowLocal(s.timezone);
  const rand = rng(42);
  const step = Number(s.slot_step);
  const pros = db.prepare('SELECT id FROM professionals').all();
  const hours = db.prepare('SELECT start_min, end_min FROM working_hours WHERE professional_id = ? AND weekday = ? ORDER BY start_min');
  const svcOf = db.prepare(`SELECT s.id, s.duration_min, s.price_cents FROM services s
    JOIN professional_services ps ON ps.service_id = s.id WHERE ps.professional_id = ?`);
  const ins = db.prepare(`INSERT INTO appointments (token, service_id, professional_id, date, start_min, end_min,
    customer_name, customer_phone, price_cents, status, source, reminder_sent_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const keepReminders = (process.env.NOTIFY_PROVIDER || 'log') === 'log';

  for (let d = -21; d <= 7; d++) {
    const date = addDays(now.date, d);
    const busyness = d < 0 ? 0.6 : d === 0 ? 0.55 : Math.max(0.15, 0.5 - d * 0.05);
    for (const pro of pros) {
      const services = svcOf.all(pro.id);
      for (const h of hours.all(pro.id, weekday(date))) {
        let t = h.start_min;
        while (t < h.end_min) {
          const svc = services[Math.floor(rand() * services.length)];
          if (rand() < busyness && t + svc.duration_min <= h.end_min) {
            const past = d < 0 || (d === 0 && t < now.min);
            const r = rand();
            const status = past ? (r < 0.84 ? 'done' : r < 0.93 ? 'no_show' : 'cancelled') : (r < 0.92 ? 'confirmed' : 'cancelled');
            const c = DEMO_CUSTOMERS[Math.floor(rand() * DEMO_CUSTOMERS.length)];
            const created = addDays(date, -Math.ceil(rand() * 6)) + ' 12:00:00';
            ins.run(crypto.randomBytes(16).toString('base64url'), svc.id, pro.id, date, t, t + svc.duration_min,
              c.name, c.phone, svc.price_cents, status, rand() < 0.7 ? 'online' : 'admin',
              past || !keepReminders ? new Date().toISOString() : null, created);
            t += Math.ceil(svc.duration_min / step) * step;
          } else {
            t += step;
          }
        }
      }
    }
  }
}

export function isEmpty() {
  return db.prepare('SELECT COUNT(*) AS n FROM services').get().n === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const key = process.argv[2] || 'barbearia';
  applyPreset(key, { demo: process.argv.includes('--demo') });
  console.log(`✔ Banco recriado com o modelo "${PRESETS[key].label}"${process.argv.includes('--demo') ? ' e dados de demonstração' : ''}.`);
}
