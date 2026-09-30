// Fluxo de agendamento do cliente: serviço → profissional → data/hora → dados → confirmação.
const app = $('#app');
const state = { info: null, service: null, pro: undefined, date: null, time: null, days: [], slots: [], step: 'service' };
const STEPS = ['service', 'pro', 'datetime', 'form'];

init();

async function init() {
  try {
    state.info = await api('/api/public/info');
  } catch {
    app.innerHTML = '<div class="empty">Não foi possível carregar a agenda. Atualize a página.</div>';
    return;
  }
  renderHeader();
  const token = new URLSearchParams(location.search).get('t');
  if (token) return showManage(token);
  renderMine();
  render();
}

function renderHeader() {
  const s = state.info.settings;
  applyBrand(s.primary_color);
  document.title = `Agendar — ${s.business_name}`;
  $('#logo').textContent = initials(s.business_name);
  $('#biz-name').textContent = s.business_name;
  $('#biz-tagline').textContent = s.tagline || '';
  const meta = [];
  if (s.address) meta.push(`<span>📍 ${esc(s.address)}</span>`);
  if (s.whatsapp) meta.push(`<a href="${waLink(s.whatsapp)}" target="_blank" rel="noopener">💬 WhatsApp</a>`);
  if (s.instagram) meta.push(`<a href="https://instagram.com/${esc(s.instagram.replace('@', ''))}" target="_blank" rel="noopener">📷 ${esc(s.instagram)}</a>`);
  $('#biz-meta').innerHTML = meta.join('');
}

// Agendamentos feitos neste aparelho ficam salvos para o cliente achar de novo.
async function renderMine() {
  const tokens = store.get('marcai:mine', []);
  if (!tokens.length) return;
  const results = await Promise.all(tokens.map((t) => api(`/api/public/appointments/${t}`).catch(() => null)));
  const today = state.info.today;
  const upcoming = results.filter((a) => a && a.status === 'confirmed' && a.date >= today);
  store.set('marcai:mine', upcoming.map((a) => a.token));
  if (!upcoming.length) return;
  $('#mine').innerHTML = `<div class="card mine">
    <strong>Seus próximos horários</strong>
    ${upcoming.map((a) => `<a href="/?t=${encodeURIComponent(a.token)}">
      <span>${esc(a.service_name)} · ${esc(fmtDate(a.date, { day: '2-digit', month: 'short' }))} às ${a.time}</span>
      <span class="muted">Ver ›</span></a>`).join('')}
  </div>`;
}

function stepsBar() {
  const visible = STEPS.filter((s) => s !== 'pro' || !skipPro());
  const idx = visible.indexOf(state.step);
  return `<ol class="steps" aria-hidden="true">${visible.map((_, i) => `<li class="${i <= idx ? 'on' : ''}"></li>`).join('')}</ol>`;
}

function title(text, back = true) {
  return `<div class="step-title">${back ? '<button class="back" data-back aria-label="Voltar">←</button>' : ''}<h2>${text}</h2></div>`;
}

const prosForService = () => state.info.professionals.filter((p) => p.service_ids.includes(state.service.id));
const skipPro = () => state.service && prosForService().length === 1;
const proName = (id) => state.info.professionals.find((p) => p.id === id)?.name;

function go(step) {
  state.step = step;
  render();
  app.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function back() {
  const order = STEPS.filter((s) => s !== 'pro' || !skipPro());
  const i = order.indexOf(state.step);
  if (i > 0) go(order[i - 1]);
}

function render() {
  ({ service: renderServices, pro: renderPros, datetime: renderDateTime, form: renderForm })[state.step]();
  $('[data-back]', app)?.addEventListener('click', back);
}

function renderServices() {
  const { services } = state.info;
  app.innerHTML = stepsBar() + title('Escolha o serviço', false) + (services.length
    ? `<div class="choices">${services.map((s) => `
      <button class="choice" data-id="${s.id}">
        <span class="grow"><strong>${esc(s.name)}</strong>
          <span class="muted small">${duration(s.duration_min)}${s.description ? ' · ' + esc(s.description) : ''}</span></span>
        <span class="price">${money(s.price_cents)}</span>
      </button>`).join('')}</div>`
    : '<div class="empty">Nenhum serviço disponível no momento.</div>');
  $$('.choice', app).forEach((b) => b.addEventListener('click', () => {
    state.service = services.find((s) => s.id === Number(b.dataset.id));
    state.date = state.time = null;
    if (skipPro()) { state.pro = prosForService()[0].id; go('datetime'); } else { state.pro = undefined; go('pro'); }
  }));
}

function renderPros() {
  const label = state.info.settings.staff_label || 'Profissional';
  const pros = prosForService();
  app.innerHTML = stepsBar() + title(`Escolha o ${label.toLowerCase()}`) + `<div class="choices">
    <button class="choice" data-id="">
      <span class="avatar" style="background:var(--surface-2);color:var(--text)">★</span>
      <span class="grow"><strong>Sem preferência</strong><span class="muted small">Mostra mais horários disponíveis</span></span>
    </button>
    ${pros.map((p) => `<button class="choice" data-id="${p.id}">
      <span class="avatar" style="background:${esc(p.color)}">${esc(initials(p.name))}</span>
      <span class="grow"><strong>${esc(p.name)}</strong><span class="muted small">${esc(p.role)}</span></span>
    </button>`).join('')}
  </div>`;
  $$('.choice', app).forEach((b) => b.addEventListener('click', () => {
    state.pro = b.dataset.id ? Number(b.dataset.id) : null;
    state.date = state.time = null;
    go('datetime');
  }));
}

async function renderDateTime() {
  const who = state.pro ? ` com ${esc(proName(state.pro))}` : '';
  app.innerHTML = stepsBar() + title('Escolha dia e horário') +
    `<p class="muted small" style="margin:-8px 0 14px">${esc(state.service.name)}${who} · ${duration(state.service.duration_min)}</p>
     <div class="days" id="days"><div class="empty" style="width:100%">Buscando datas…</div></div>
     <div id="slots"></div>`;

  const q = `service=${state.service.id}${state.pro ? '&professional=' + state.pro : ''}`;
  state.days = await api(`/api/public/days?${q}`);
  if (state.step !== 'datetime') return;
  const firstOpen = state.days.find((d) => d.slots > 0);
  if (!firstOpen) {
    $('#days').innerHTML = '';
    $('#slots').innerHTML = `<div class="empty">Sem horários livres nos próximos dias.${state.info.settings.whatsapp
      ? `<br><br><a class="btn wa" href="${waLink(state.info.settings.whatsapp, 'Olá! Queria ver um horário para ' + state.service.name)}" target="_blank" rel="noopener">Chamar no WhatsApp</a>` : ''}</div>`;
    return;
  }
  if (!state.date || !state.days.some((d) => d.date === state.date && d.slots)) state.date = firstOpen.date;

  $('#days').innerHTML = state.days.map((d) => `
    <button class="day ${d.date === state.date ? 'sel' : ''}" data-date="${d.date}" ${d.slots ? '' : 'disabled'}
      aria-label="${esc(longDate(d.date))}${d.slots ? '' : ', sem horários'}">
      <small>${d.date === state.info.today ? 'Hoje' : fmtDate(d.date, { weekday: 'short' }).replace('.', '')}</small>
      <b>${d.date.slice(8)}</b>
      <small>${fmtDate(d.date, { month: 'short' }).replace('.', '')}</small>
    </button>`).join('');
  $$('.day', app).forEach((b) => b.addEventListener('click', () => {
    state.date = b.dataset.date;
    state.time = null;
    $$('.day', app).forEach((x) => x.classList.toggle('sel', x === b));
    loadSlots();
  }));
  $('.day.sel', app)?.scrollIntoView({ block: 'nearest', inline: 'center' });
  loadSlots();
}

async function loadSlots() {
  const box = $('#slots');
  box.innerHTML = '<div class="empty">Carregando horários…</div>';
  const date = state.date;
  const q = `date=${date}&service=${state.service.id}${state.pro ? '&professional=' + state.pro : ''}`;
  const slots = await api(`/api/public/slots?${q}`);
  if (date !== state.date) return;
  state.slots = slots;
  if (!slots.length) { box.innerHTML = '<div class="empty">Esse dia lotou. Escolha outra data.</div>'; return; }
  const groups = [['Manhã', 0, 720], ['Tarde', 720, 1080], ['Noite', 1080, 1440]];
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  box.innerHTML = `<p class="small muted" style="margin:14px 0 0">${esc(longDate(date))}</p>` + groups.map(([label, a, b]) => {
    const list = slots.filter((s) => toMin(s.time) >= a && toMin(s.time) < b);
    return list.length ? `<div class="slot-group"><h3>${label}</h3><div class="slots">
      ${list.map((s) => `<button class="slot" data-time="${s.time}">${s.time}</button>`).join('')}</div></div>` : '';
  }).join('');
  $$('.slot', box).forEach((b) => b.addEventListener('click', () => {
    state.time = b.dataset.time;
    go('form');
  }));
}

function summaryHtml() {
  const slot = state.slots.find((s) => s.time === state.time);
  const pro = state.pro ?? (slot?.professionals.length === 1 ? slot.professionals[0] : null);
  return `<div class="summary">
    <div class="row"><strong>${esc(state.service.name)}</strong><strong>${money(state.service.price_cents)}</strong></div>
    <div class="row muted small"><span>${esc(longDate(state.date))} às ${state.time}</span><span>${duration(state.service.duration_min)}</span></div>
    ${pro ? `<div class="muted small">com ${esc(proName(pro))}</div>` : ''}
  </div>`;
}

function renderForm() {
  const saved = store.get('marcai:me', {});
  const notesLabel = state.info.settings.notes_label || 'Observações';
  app.innerHTML = stepsBar() + title('Seus dados') + summaryHtml() + `
    <form class="form" id="form" novalidate>
      <label class="field">Nome completo
        <input class="input" name="name" autocomplete="name" required minlength="2" value="${esc(saved.name || '')}">
      </label>
      <div class="grid-2">
        <label class="field">WhatsApp
          <input class="input" name="phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="(11) 91234-5678" required value="${esc(fmtPhone(saved.phone || ''))}">
        </label>
        <label class="field"><span>E-mail <span class="hint">opcional</span></span>
          <input class="input" name="email" type="email" autocomplete="email" value="${esc(saved.email || '')}">
        </label>
      </div>
      <label class="field"><span>${esc(notesLabel)} <span class="hint">opcional</span></span>
        <textarea class="input" name="notes" maxlength="500" rows="2"></textarea>
      </label>
      <p class="small muted" style="margin:0">Você vai receber a confirmação e um lembrete pelo WhatsApp.</p>
      <button class="btn primary block" type="submit">Confirmar agendamento</button>
    </form>`;
  const form = $('#form');
  maskPhone(form.phone);
  if (!saved.name) form.name.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form);
    const data = Object.fromEntries(new FormData(form));
    if (data.name.trim().length < 2) return toast('Informe seu nome.', true);
    if (data.phone.replace(/\D/g, '').length < 10) return toast('Informe o WhatsApp com DDD.', true);
    btn.disabled = true;
    btn.textContent = 'Confirmando…';
    try {
      const res = await api('/api/public/appointments', {
        method: 'POST',
        body: { ...data, serviceId: state.service.id, professionalId: state.pro, date: state.date, time: state.time },
      });
      store.set('marcai:me', { name: data.name, phone: data.phone, email: data.email });
      store.set('marcai:mine', [...new Set([...store.get('marcai:mine', []), res.token])]);
      renderSuccess(res.appointment);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
      btn.textContent = 'Confirmar agendamento';
      if (err.status === 409) { state.time = null; go('datetime'); }
    }
  });
}

function calendarLinks(a) {
  const s = state.info.settings;
  const stamp = (d, t) => d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00';
  const text = `${a.service_name} — ${s.business_name}`;
  const details = `Com ${a.professional_name}. Gerenciar: ${location.origin}/?t=${a.token}`;
  const google = 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
    action: 'TEMPLATE', text, details, location: s.address || '',
    dates: `${stamp(a.date, a.time)}/${stamp(a.date, a.end)}`, ctz: s.timezone,
  });
  const icsText = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Marcai//PT-BR', 'BEGIN:VEVENT',
    `UID:${a.token}@marcai`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    `DTSTART;TZID=${s.timezone}:${stamp(a.date, a.time)}`, `DTEND;TZID=${s.timezone}:${stamp(a.date, a.end)}`,
    `SUMMARY:${text.replace(/[,;]/g, '\\$&')}`, `LOCATION:${(s.address || '').replace(/[,;]/g, '\\$&')}`,
    `DESCRIPTION:${details.replace(/[,;]/g, '\\$&')}`,
    'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:Lembrete', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const ics = URL.createObjectURL(new Blob([icsText], { type: 'text/calendar' }));
  return { google, ics };
}

function renderSuccess(a) {
  const links = calendarLinks(a);
  app.innerHTML = `<div class="success">
    <div class="check">✓</div>
    <h2>Horário confirmado!</h2>
    <p class="muted">Enviamos os detalhes para o seu WhatsApp.</p>
  </div>
  <div class="summary" style="margin-top:14px">
    <div class="row"><strong>${esc(a.service_name)}</strong><strong>${money(a.price_cents)}</strong></div>
    <div class="row small"><span>${esc(longDate(a.date))}</span><span class="tabnum">${a.time} – ${a.end}</span></div>
    <div class="muted small">com ${esc(a.professional_name)}</div>
  </div>
  <div class="actions">
    <a class="btn" href="${links.google}" target="_blank" rel="noopener">Google Agenda</a>
    <a class="btn" href="${links.ics}" download="agendamento.ics">Outra agenda (.ics)</a>
    <a class="btn ghost" href="/?t=${encodeURIComponent(a.token)}">Gerenciar</a>
  </div>
  <div class="actions"><button class="btn primary" id="again">Agendar outro serviço</button></div>`;
  $('#again').addEventListener('click', () => {
    Object.assign(state, { service: null, pro: undefined, date: null, time: null });
    renderMine();
    go('service');
  });
}

async function showManage(token) {
  let a;
  try {
    a = await api(`/api/public/appointments/${encodeURIComponent(token)}`);
  } catch {
    app.innerHTML = '<div class="empty">Agendamento não encontrado.<br><br><a class="btn primary" href="/">Fazer um agendamento</a></div>';
    return;
  }
  const s = state.info.settings;
  const past = a.date < state.info.today;
  app.innerHTML = `<div class="step-title"><h2>Seu agendamento</h2><span class="badge ${a.status}">${STATUS_LABEL[a.status]}</span></div>
    <div class="summary">
      <div class="row"><strong>${esc(a.service_name)}</strong><strong>${money(a.price_cents)}</strong></div>
      <div class="row small"><span>${esc(longDate(a.date))}</span><span class="tabnum">${a.time} – ${a.end}</span></div>
      <div class="muted small">com ${esc(a.professional_name)} · em nome de ${esc(a.customer_name)}</div>
    </div>
    ${a.status === 'confirmed' && !past ? `
      <p class="small muted">${a.can_cancel
        ? 'Não vai conseguir vir? Cancele para liberar a vaga para outra pessoa.'
        : `O cancelamento online vai até ${s.cancel_limit_hours}h antes. Para mudar, fale com a gente.`}</p>` : ''}
    <div class="actions" style="justify-content:flex-start">
      ${a.can_cancel ? '<button class="btn danger" id="cancel">Cancelar horário</button>' : ''}
      ${s.whatsapp ? `<a class="btn wa" target="_blank" rel="noopener" href="${waLink(s.whatsapp,
        `Olá! Sou ${a.customer_name} e tenho horário ${fmtDate(a.date, { day: '2-digit', month: '2-digit' })} às ${a.time} (${a.service_name}). Gostaria de remarcar.`)}">Remarcar pelo WhatsApp</a>` : ''}
      <a class="btn primary" href="/">Novo agendamento</a>
    </div>`;
  $('#cancel')?.addEventListener('click', async () => {
    if (!confirm('Cancelar este horário?')) return;
    try {
      await api(`/api/public/appointments/${encodeURIComponent(token)}/cancel`, { method: 'POST' });
      toast('Horário cancelado.');
      showManage(token);
    } catch (err) { toast(err.message, true); }
  });
}
