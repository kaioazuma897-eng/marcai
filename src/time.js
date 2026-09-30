// Datas são guardadas como 'YYYY-MM-DD' e horários como minutos desde 00:00,
// sempre no fuso do estabelecimento. Assim a lógica de agenda não depende do fuso do servidor.

export const toMin = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return NaN;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 24 || mm > 59 || (h === 24 && mm > 0)) return NaN;
  return h * 60 + mm;
};

export const fmtMin = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

export const isDate = (s) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return false;
  const t = Date.parse(s + 'T00:00:00Z');
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

export const dayNumber = (date) => Math.floor(Date.parse(date + 'T00:00:00Z') / 86400000);
export const absMin = (date, min) => dayNumber(date) * 1440 + min;
export const weekday = (date) => new Date(date + 'T00:00:00Z').getUTCDay();
export const addDays = (date, n) =>
  new Date(Date.parse(date + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export function nowLocal(tz) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const min = Number(parts.hour) * 60 + Number(parts.minute);
  return { date, min, abs: absMin(date, min) };
}

export const longDate = (date) =>
  new Date(date + 'T12:00:00Z').toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  });
