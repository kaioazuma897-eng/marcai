// Gera os prints do README com um Chrome/Edge headless via DevTools Protocol (sem dependências).
// Uso: com o servidor rodando (node server.js), rode: node scripts/screenshots.js
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const OUT = path.join(process.cwd(), 'docs');
const PORT = 9333;
const BROWSERS = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, mobile: true };
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false };

const exe = BROWSERS.find((p) => fs.existsSync(p));
if (!exe) throw new Error('Chrome/Edge não encontrado. Informe o caminho em BROWSER=...');
fs.mkdirSync(OUT, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'marcai-shots-'));
const browser = spawn(exe, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

let ws;
let seq = 0;
const pending = new Map();
const listeners = [];

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function once(method) {
  return new Promise((resolve) => listeners.push({ method, resolve }));
}

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) {
        ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener('open', r, { once: true }));
        ws.addEventListener('message', (e) => {
          const msg = JSON.parse(e.data);
          if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
          } else if (msg.method) {
            for (let j = listeners.length - 1; j >= 0; j--) {
              if (listeners[j].method === msg.method) listeners.splice(j, 1)[0].resolve(msg.params);
            }
          }
        });
        return;
      }
    } catch { /* navegador ainda subindo */ }
    await sleep(200);
  }
  throw new Error('Não consegui conectar ao navegador headless.');
}

async function eval_(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'Erro no evaluate');
  return r.result.value;
}

async function open(url, viewport) {
  await send('Emulation.setDeviceMetricsOverride', viewport);
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url });
  // Mudar só o #hash não recarrega a página, então não espera o evento para sempre.
  await Promise.race([loaded, sleep(5000)]);
  await sleep(1200);
}

async function shot(name) {
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(data, 'base64'));
  console.log('✔ docs/' + name);
}

try {
  await connect();
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });

  // Página do cliente (celular)
  await open(`${BASE}/`, MOBILE);
  await shot('cliente-servicos.png');

  await eval_(`document.querySelector('.choice').click()`); // primeiro serviço
  await sleep(400);
  await eval_(`document.querySelector('.choice').click()`); // "sem preferência"
  await sleep(1500);
  await eval_(`document.querySelectorAll('.day:not(:disabled)')[3].click()`); // um dia com a agenda mais livre
  await sleep(1200);
  await shot('cliente-horarios.png');

  await eval_(`document.querySelectorAll('.slot')[1].click()`);
  await sleep(500);
  await eval_(`(() => {
    const f = document.querySelector('#form');
    f.name.value = 'Marina Albuquerque';
    f.phone.value = '(11) 98765-4321';
    document.activeElement?.blur();
  })()`);
  await shot('cliente-dados.png');

  // Painel (desktop)
  await eval_(`fetch('/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ${JSON.stringify(PASSWORD)} }) }).then((r) => r.status)`);
  await open(`${BASE}/admin#inicio`, DESKTOP);
  await shot('painel-inicio.png');

  await open(`${BASE}/admin#agenda`, DESKTOP);
  await eval_(`document.querySelector('[data-nav="1"]').click()`); // amanhã: dia cheio a partir das 9h
  await sleep(1200);
  await shot('painel-agenda.png');

  await eval_(`document.querySelector('.appt:not(.cancelled)').click()`);
  await sleep(1000);
  await shot('painel-detalhes.png');

  await open(`${BASE}/admin#clientes`, DESKTOP);
  await shot('painel-clientes.png');
} finally {
  ws?.close();
  browser.kill();
  await sleep(500);
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
}
