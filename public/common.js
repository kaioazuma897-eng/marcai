// Utilitários compartilhados entre a página pública e o painel.
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const money = (cents) => cents
  ? (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  : 'Grátis';

const duration = (min) => min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${min % 60 ? String(min % 60).padStart(2, '0') : ''}`;

const parseDate = (d) => new Date(d + 'T12:00:00Z');
const fmtDate = (d, opts) => parseDate(d).toLocaleDateString('pt-BR', { timeZone: 'UTC', ...opts });
const longDate = (d) => fmtDate(d, { weekday: 'long', day: 'numeric', month: 'long' });
const addDays = (d, n) => new Date(parseDate(d).getTime() + n * 86400000).toISOString().slice(0, 10);

function fmtPhone(digits) {
  const d = String(digits || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digits || '';
}

function maskPhone(input) {
  input.addEventListener('input', () => {
    const d = input.value.replace(/\D/g, '').slice(0, 11);
    let v = d;
    if (d.length > 2) v = `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length > 7) v = `(${d.slice(0, 2)}) ${d.slice(2, d.length - 4)}-${d.slice(-4)}`;
    input.value = v;
  });
}

const initials = (name) => String(name).replace(/^(Dra?\.|Box \d+ —)\s*/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

const waLink = (digits, text = '') => `https://wa.me/${String(digits).replace(/\D/g, '')}${text ? '?text=' + encodeURIComponent(text) : ''}`;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? (method === 'GET' ? undefined : '{}') : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erro ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

function applyBrand(color) {
  if (!/^#[0-9a-f]{6}$/i.test(color || '')) return;
  document.documentElement.style.setProperty('--brand', color);
  const n = parseInt(color.slice(1), 16);
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  document.documentElement.style.setProperty('--brand-ink', lum > 0.62 ? '#1c1917' : '#fff');
}

const STATUS_LABEL = { confirmed: 'Confirmado', done: 'Concluído', no_show: 'Faltou', cancelled: 'Cancelado' };

const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* modo privado */ } },
};
