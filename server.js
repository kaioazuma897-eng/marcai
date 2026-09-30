import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (fs.existsSync('.env')) process.loadEnvFile('.env');

const { routes } = await import('./src/routes.js');
const { HttpError } = await import('./src/booking.js');
const { isAuthenticated } = await import('./src/auth.js');
const { startReminderLoop, PROVIDER, BASE_URL } = await import('./src/notify.js');
const { applyPreset, isEmpty } = await import('./src/seed.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const PAGES = { '/': 'index.html', '/admin': 'admin.html' };

if (isEmpty()) {
  const segment = process.env.SEGMENT || 'barbearia';
  applyPreset(segment, { demo: process.env.DEMO_DATA !== '0' });
  console.log(`Banco vazio: modelo "${segment}" aplicado${process.env.DEMO_DATA !== '0' ? ' com dados de demonstração' : ''}.`);
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000) throw new HttpError(413, 'Requisição muito grande.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new HttpError(400, 'JSON inválido.');
  }
}

function serveStatic(req, res, pathname) {
  const file = PAGES[pathname] || pathname.slice(1);
  const full = path.join(PUBLIC_DIR, path.normalize(file));
  if (!full.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Proibido', 'text/plain');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Página não encontrada', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;

  if (!pathname.startsWith('/api/')) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método não permitido' });
    return serveStatic(req, res, pathname);
  }

  const match = routes.find((r) => r.method === req.method && r.re.test(pathname));
  if (!match) return send(res, 404, { error: 'Rota não encontrada' });

  try {
    if (match.auth && !isAuthenticated(req)) throw new HttpError(401, 'Faça login novamente.');
    // Exigir JSON em escritas impede formulários de outros sites (CSRF) de chegarem aqui.
    if (req.method !== 'GET' && !String(req.headers['content-type']).includes('application/json')) {
      throw new HttpError(415, 'Envie JSON.');
    }
    const params = Object.fromEntries(match.keys.map((k, i) => [k, decodeURIComponent(pathname.match(match.re)[i + 1])]));
    const body = req.method === 'GET' ? {} : await readJson(req);
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const result = await match.handler({ req, res, params, query: Object.fromEntries(url.searchParams), body, ip });
    if (result && result.raw !== undefined) return send(res, 200, result.raw, result.type);
    send(res, 200, result ?? { ok: true });
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    send(res, 500, { error: 'Erro interno. Tente novamente.' });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Marcaí rodando`);
  console.log(`  Página de agendamento → ${BASE_URL}/`);
  console.log(`  Painel do dono       → ${BASE_URL}/admin`);
  console.log(`  Envio de mensagens    → ${PROVIDER}\n`);
  startReminderLoop();
});
