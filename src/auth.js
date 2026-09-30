import crypto from 'node:crypto';
import { getSecret, setSecret } from './db.js';

const SESSION_DAYS = 14;
const COOKIE = 'marcai_sid';

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

function secret() {
  let s = getSecret('session_secret');
  if (!s) {
    s = crypto.randomBytes(32).toString('hex');
    setSecret('session_secret', s);
  }
  return s;
}

function passwordHash() {
  let h = getSecret('admin_password_hash');
  if (!h) {
    const initial = process.env.ADMIN_PASSWORD || 'admin123';
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('⚠  Usando a senha padrão "admin123". Troque em Configurações no painel.');
    }
    h = hashPassword(initial);
    setSecret('admin_password_hash', h);
  }
  return h;
}

export const checkPassword = (pw) => verifyPassword(pw, passwordHash());
export const changePassword = (pw) => setSecret('admin_password_hash', hashPassword(pw));

// O hash da senha entra na assinatura: trocar a senha derruba todas as sessões antigas.
const sign = (exp) =>
  crypto.createHmac('sha256', secret()).update(`${exp}.${passwordHash()}`).digest('base64url');

export function createSessionCookie(secure) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  const value = `${exp}.${sign(exp)}`;
  return `${COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}

export const clearSessionCookie = () => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

export function isAuthenticated(req) {
  const cookies = Object.fromEntries(
    String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p.length === 2),
  );
  const [exp, sig] = String(cookies[COOKIE] || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const expected = sign(exp);
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

// Limitador simples em memória (por IP + chave).
const hits = new Map();
export function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.reset < now) {
    hits.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
}, 600_000).unref();
