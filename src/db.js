import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'marcai.db');
if (DB_PATH !== ':memory:') fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS services (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    duration_min INTEGER NOT NULL,
    price_cents  INTEGER NOT NULL DEFAULT 0,
    active       INTEGER NOT NULL DEFAULT 1,
    sort         INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS professionals (
    id     INTEGER PRIMARY KEY,
    name   TEXT NOT NULL,
    role   TEXT NOT NULL DEFAULT '',
    color  TEXT NOT NULL DEFAULT '#6366f1',
    active INTEGER NOT NULL DEFAULT 1,
    sort   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS professional_services (
    professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
    service_id      INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    PRIMARY KEY (professional_id, service_id)
  );

  CREATE TABLE IF NOT EXISTS working_hours (
    id              INTEGER PRIMARY KEY,
    professional_id INTEGER NOT NULL REFERENCES professionals(id) ON DELETE CASCADE,
    weekday         INTEGER NOT NULL,
    start_min       INTEGER NOT NULL,
    end_min         INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blocks (
    id              INTEGER PRIMARY KEY,
    professional_id INTEGER REFERENCES professionals(id) ON DELETE CASCADE,
    date            TEXT NOT NULL,
    start_min       INTEGER NOT NULL,
    end_min         INTEGER NOT NULL,
    reason          TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id               INTEGER PRIMARY KEY,
    token            TEXT NOT NULL UNIQUE,
    service_id       INTEGER NOT NULL REFERENCES services(id),
    professional_id  INTEGER NOT NULL REFERENCES professionals(id),
    date             TEXT NOT NULL,
    start_min        INTEGER NOT NULL,
    end_min          INTEGER NOT NULL,
    customer_name    TEXT NOT NULL,
    customer_phone   TEXT NOT NULL,
    customer_email   TEXT NOT NULL DEFAULT '',
    notes            TEXT NOT NULL DEFAULT '',
    price_cents      INTEGER NOT NULL DEFAULT 0,
    status           TEXT NOT NULL DEFAULT 'confirmed',
    source           TEXT NOT NULL DEFAULT 'online',
    reminder_sent_at TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_appt_date  ON appointments(date, professional_id);
  CREATE INDEX IF NOT EXISTS idx_appt_phone ON appointments(customer_phone);

  CREATE TABLE IF NOT EXISTS notifications (
    id             INTEGER PRIMARY KEY,
    appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
    kind           TEXT NOT NULL,
    channel        TEXT NOT NULL,
    recipient      TEXT NOT NULL,
    message        TEXT NOT NULL,
    status         TEXT NOT NULL,
    error          TEXT,
    created_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

let txDepth = 0;
export function tx(fn) {
  if (txDepth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  txDepth++;
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth--;
  }
}

export const DEFAULT_SETTINGS = {
  business_name: 'Meu Negócio',
  segment: 'barbearia',
  tagline: 'Agende seu horário em poucos cliques',
  phone: '',
  whatsapp: '',
  address: '',
  instagram: '',
  timezone: 'America/Sao_Paulo',
  primary_color: '#b45309',
  staff_label: 'Profissional',
  notes_label: 'Observações',
  slot_step: 30,
  min_notice_min: 60,
  max_days_ahead: 30,
  reminder_hours: 24,
  cancel_limit_hours: 2,
};

// Chaves que começam com "_" são internas (segredos) e nunca saem pela API.
export function getSettings() {
  const s = { ...DEFAULT_SETTINGS };
  for (const r of db.prepare("SELECT key, value FROM settings WHERE key NOT LIKE '\\_%' ESCAPE '\\'").all()) {
    s[r.key] = JSON.parse(r.value);
  }
  return s;
}

export function setSettings(obj) {
  const st = db.prepare(
    'INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  tx(() => {
    for (const [k, v] of Object.entries(obj)) st.run(k, JSON.stringify(v));
  });
}

export function getSecret(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('_' + key);
  return row ? JSON.parse(row.value) : null;
}

export function setSecret(key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('_' + key, JSON.stringify(value));
}
