// Painel do dono: agenda, clientes, serviços, equipe, bloqueios, mensagens e configurações.
const root = $('#root');
const modal = $('#modal');
const S = { settings: null, me: null, services: [], pros: [], date: null, mode: 'timeline', showCancelled: false, today: null };
const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const ICONS = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 01-1 1h-5v-6H9v6H4a1 1 0 01-1-1z"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  clientes: '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 010 8M22 21c0-3-2-5-4-6"/>',
  servicos: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  equipe: '<circle cx="12" cy="7" r="4"/><path d="M4 21c0-4 4-7 8-7s8 3 8 7"/>',
  bloqueios: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  mensagens: '<path d="M4 5h16v11H8l-4 4z"/>',
  config: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  sair: '<path d="M15 4h4a1 1 0 011 1v14a1 1 0 01-1 1h-4M10 17l5-5-5-5M15 12H3"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;

const VIEWS = {
  inicio: ['Início', viewHome],
  agenda: ['Agenda', viewAgenda],
  clientes: ['Clientes', viewCustomers],
  servicos: ['Serviços', viewServices],
  equipe: ['Equipe', viewTeam],
  bloqueios: ['Folgas e bloqueios', viewBlocks],
  mensagens: ['Mensagens', viewMessages],
  config: ['Configurações', viewSettings],
};

boot();

async function boot() {
  try {
    S.me = await api('/api/admin/me');
  } catch {
    return renderLogin();
  }
  await refreshBase();
  renderShell();
  window.addEventListener('hashchange', route);
  route();
}

async function refreshBase() {
  const [info, services, pros] = await Promise.all([
    api('/api/public/info'), api('/api/admin/services'), api('/api/admin/professionals'),
  ]);
  S.settings = info.settings;
  S.today = info.today;
  S.date = S.date || info.today;
  S.services = services;
  S.pros = pros;
  applyBrand(S.settings.primary_color);
}

// Erros 401 em qualquer tela levam de volta ao login.
async function call(path, opts) {
  try {
    return await api(path, opts);
  } catch (err) {
    if (err.status === 401) { renderLogin(); throw err; }
    toast(err.message, true);
    throw err;
  }
}

function renderLogin() {
  modal.open && modal.close();
  root.innerHTML = `<div class="login"><form class="card" id="login">
      <div><h1 style="font-size:22px">Painel do negócio</h1><p class="muted small" style="margin:4px 0 0">Entre para ver sua agenda.</p></div>
      <label class="field">Senha <input class="input" type="password" name="password" autocomplete="current-password" autofocus required></label>
      <button class="btn primary block">Entrar</button>
      <a class="small muted" href="/" style="text-align:center">Ir para a página de agendamento</a>
    </form></div>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: e.target.password.value } });
      boot();
    } catch (err) { toast(err.message, true); }
  });
}

function renderShell() {
  const s = S.settings;
  root.innerHTML = `<div class="admin">
    <nav class="side">
      <div class="brand"><div class="logo">${esc(initials(s.business_name))}</div>
        <div><b>${esc(s.business_name)}</b><a class="small muted" href="/" target="_blank">Ver página ↗</a></div></div>
      ${Object.entries(VIEWS).map(([k, [label]]) => `<a class="nav" href="#${k}" data-view="${k}">${icon(k)}<span>${label}</span></a>`).join('')}
      <div class="spacer"></div>
      <button class="nav" id="logout">${icon('sair')}<span>Sair</span></button>
    </nav>
    <main class="content" id="view"></main>
  </div>`;
  $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }); renderLogin(); });
}

function route() {
  const key = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'agenda';
  $$('.nav[data-view]').forEach((a) => a.classList.toggle('on', a.dataset.view === key));
  document.title = `${VIEWS[key][0]} — ${S.settings.business_name}`;
  $('#view').innerHTML = '<div class="empty">Carregando…</div>';
  VIEWS[key][1]($('#view')).catch((e) => { if (e.status !== 401) console.error(e); });
}

// ---------------------------------------------------------------- Modal

function openModal(titleHtml, bodyHtml, footHtml = '') {
  modal.innerHTML = `<div class="modal-head"><h2 style="font-size:18px">${titleHtml}</h2>
      <button class="btn ghost sm" data-close aria-label="Fechar">✕</button></div>
    <div class="modal-body">${bodyHtml}</div>${footHtml ? `<div class="modal-foot">${footHtml}</div>` : ''}`;
  $('[data-close]', modal).addEventListener('click', () => modal.close());
  if (!modal.open) modal.showModal();
  return modal;
}
modal.addEventListener('click', (e) => { if (e.target === modal) modal.close(); });

// ---------------------------------------------------------------- Início

async function viewHome(el) {
  const d = await call('/api/admin/dashboard');
  const max = Math.max(1, ...d.next7.map((x) => x.count));
  el.innerHTML = `<div class="page-head"><div><h1>Olá! 👋</h1><p class="muted" style="margin:4px 0 0">${esc(longDate(d.date))}</p></div>
      <div class="toolbar"><button class="btn primary" id="new">+ Novo agendamento</button></div></div>
    <div class="kpis">
      ${kpi('Hoje', d.day.count, d.day.next ? `Próximo: ${d.day.next.time} · ${d.day.next.customer_name}` : 'Nenhum horário pendente')}
      ${kpi('Faturamento previsto hoje', money(d.day.revenue_cents).replace('Grátis', 'R$ 0,00'), `${d.day.done} atendimento(s) concluído(s)`)}
      ${kpi('Faturado em 30 dias', money(d.last30.revenue_cents).replace('Grátis', 'R$ 0,00'), `${d.last30.done} atendimentos`)}
      ${kpi('Faltas em 30 dias', pct(d.last30.no_show_rate), `${pct(d.last30.online_share)} dos agendamentos foram online`)}
    </div>
    <div class="cols">
      <section class="card section"><h2>Próximos 7 dias</h2>
        <div class="bars">${d.next7.map((x) => `<a class="b" href="#agenda" data-date="${x.date}" style="text-decoration:none;color:inherit" title="${x.count} agendamento(s) · ${money(x.revenue_cents)}">
          <span class="tabnum">${x.count}</span><i style="height:${(x.count / max) * 100}%"></i>
          <small>${x.date === d.date ? 'Hoje' : fmtDate(x.date, { weekday: 'short' }).replace('.', '')}</small></a>`).join('')}</div>
      </section>
      <section class="card section"><h2>Serviços que mais faturaram (30 dias)</h2>
        ${d.top_services.length ? `<table class="t"><tbody>${d.top_services.map((s) => `<tr><td>${esc(s.name)}</td>
          <td class="num muted">${s.n}×</td><td class="num"><strong>${money(s.c)}</strong></td></tr>`).join('')}</tbody></table>`
          : '<div class="empty">Ainda sem atendimentos concluídos.</div>'}
      </section>
    </div>
    <section class="card section"><h2>Divulgue seu link de agendamento</h2>
      <div class="toolbar"><input class="input" readonly value="${esc(S.me.base_url)}/" style="max-width:360px" id="publink">
      <button class="btn" id="copy">Copiar link</button>
      <a class="btn" target="_blank" href="${waLink('', `Agende seu horário na ${S.settings.business_name}: ${S.me.base_url}/`)}">Compartilhar no WhatsApp</a></div>
      <p class="small muted" style="margin:10px 0 0">Coloque na bio do Instagram, no Google Meu Negócio e na mensagem automática do WhatsApp.</p>
    </section>`;
  $('#new').addEventListener('click', () => newAppointmentModal({}));
  $('#copy').addEventListener('click', () => { navigator.clipboard?.writeText($('#publink').value); toast('Link copiado!'); });
  $$('.bars .b', el).forEach((b) => b.addEventListener('click', () => { S.date = b.dataset.date; }));
}

const kpi = (label, value, sub, meter) => `<div class="card kpi"><small>${label}</small><div class="v">${value}</div>
  ${meter !== undefined ? `<div class="meter"><i style="width:${Math.round(meter * 100)}%"></i></div>` : ''}<div class="s">${esc(sub)}</div></div>`;
const pct = (x) => `${Math.round(x * 100)}%`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- Agenda

async function viewAgenda(el) {
  const [ag, d] = await Promise.all([call(`/api/admin/agenda?date=${S.date}`), call(`/api/admin/dashboard?date=${S.date}`)]);
  const isToday = S.date === ag.now.date;
  el.innerHTML = `<div class="page-head">
      <div><h1>${esc(cap(longDate(S.date)))}</h1>
        <p class="muted small" style="margin:4px 0 0">${isToday ? 'Hoje' : S.date < ag.now.date ? 'Dia passado' : 'Próximo'}</p></div>
      <div class="toolbar">
        <button class="btn sm" data-nav="-1" aria-label="Dia anterior">←</button>
        <button class="btn sm" data-nav="0">Hoje</button>
        <button class="btn sm" data-nav="1" aria-label="Próximo dia">→</button>
        <input class="input" type="date" id="pick" value="${S.date}" style="width:auto;min-height:34px;padding:4px 8px">
        <button class="btn sm" id="mode">${S.mode === 'timeline' ? 'Ver em lista' : 'Ver linha do tempo'}</button>
        <button class="btn primary sm" id="new">+ Agendar</button>
      </div></div>
    <div class="kpis">
      ${kpi('Agendamentos', d.day.count, `${d.day.done} concluído(s)`)}
      ${kpi('Faturamento previsto', money(d.day.revenue_cents).replace('Grátis', 'R$ 0,00'), 'Sem contar faltas')}
      ${kpi('Ocupação', pct(d.day.occupancy), 'Do expediente da equipe', d.day.occupancy)}
      ${kpi('Próximo cliente', d.day.next ? d.day.next.time : '—', d.day.next ? `${d.day.next.customer_name} · ${d.day.next.service_name}` : isToday ? 'Nada pendente hoje' : 'Só para o dia de hoje')}
    </div>
    <div class="card" id="board"></div>
    <label class="small muted" style="display:inline-flex;gap:6px;margin-top:10px;align-items:center">
      <input type="checkbox" id="showc" ${S.showCancelled ? 'checked' : ''}> Mostrar cancelados</label>`;

  $$('[data-nav]', el).forEach((b) => b.addEventListener('click', () => {
    S.date = b.dataset.nav === '0' ? ag.now.date : addDays(S.date, Number(b.dataset.nav));
    route();
  }));
  $('#pick').addEventListener('change', (e) => { if (e.target.value) { S.date = e.target.value; route(); } });
  $('#mode').addEventListener('click', () => { S.mode = S.mode === 'timeline' ? 'list' : 'timeline'; route(); });
  $('#new').addEventListener('click', () => newAppointmentModal({ date: S.date }));
  $('#showc').addEventListener('change', (e) => { S.showCancelled = e.target.checked; route(); });

  const appts = ag.appointments.filter((a) => S.showCancelled || a.status !== 'cancelled');
  if (S.mode === 'list' || !ag.professionals.length) renderList($('#board'), appts);
  else renderTimeline($('#board'), ag, appts);
}

function renderList(box, appts) {
  box.innerHTML = appts.length ? `<div class="table-wrap"><table class="t"><thead><tr>
      <th>Horário</th><th>Cliente</th><th>Serviço</th><th>${esc(S.settings.staff_label)}</th><th class="num">Valor</th><th>Status</th></tr></thead>
      <tbody>${appts.map((a) => `<tr class="click" data-id="${a.id}">
        <td class="tabnum"><strong>${a.time}</strong> <span class="muted">– ${a.end}</span></td>
        <td>${esc(a.customer_name)}<div class="small muted">${fmtPhone(a.customer_phone)}</div></td>
        <td>${esc(a.service_name)}</td>
        <td><span class="badge" style="background:${esc(a.professional_color)}22;color:${esc(a.professional_color)}">${esc(a.professional_name)}</span></td>
        <td class="num">${money(a.price_cents)}</td>
        <td><span class="badge ${a.status}">${STATUS_LABEL[a.status]}</span></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">Nenhum agendamento neste dia.</div>';
  $$('tr[data-id]', box).forEach((tr) => tr.addEventListener('click', () => appointmentModal(Number(tr.dataset.id))));
}

function renderTimeline(box, ag, appts) {
  const PPM = 1.6; // pixels por minuto
  const mins = [8 * 60, 18 * 60];
  for (const p of ag.professionals) for (const h of p.hours) mins.push(h.start_min, h.end_min);
  for (const a of appts) mins.push(a.start_min, a.end_min);
  const start = Math.floor(Math.min(...mins) / 60) * 60;
  const end = Math.ceil(Math.max(...mins) / 60) * 60;
  const H = (end - start) * PPM;
  const y = (m) => (m - start) * PPM;
  const cols = ag.professionals.length;

  const lines = [];
  for (let m = start; m <= end; m += 30) lines.push(`<div class="tl-line ${m % 60 ? 'half' : ''}" style="top:${y(m)}px"></div>`);
  const nowLine = ag.now.date === ag.date && ag.now.min >= start && ag.now.min <= end
    ? `<div class="now-line" style="top:${y(ag.now.min)}px"></div>` : '';

  const colHtml = ag.professionals.map((p) => {
    const mine = appts.filter((a) => a.professional_id === p.id);
    const blocks = ag.blocks.filter((b) => b.professional_id === null || b.professional_id === p.id);
    return `<div class="tl-col" data-pro="${p.id}" style="height:${H}px">
      ${p.hours.map((h) => `<div class="tl-open" style="top:${y(h.start_min)}px;height:${(h.end_min - h.start_min) * PPM}px"></div>`).join('')}
      ${lines.join('')}
      ${blocks.map((b) => {
        const s = Math.max(b.start_min, start), e = Math.min(b.end_min, end);
        return `<div class="tl-block" style="top:${y(s)}px;height:${(e - s) * PPM}px">⛔ ${esc(b.reason || 'Bloqueado')}</div>`;
      }).join('')}
      ${mine.map((a) => `<div class="appt ${a.status}" data-id="${a.id}" style="--c:${esc(a.professional_color)};top:${y(a.start_min) + 1}px;height:${(a.end_min - a.start_min) * PPM - 2}px"
          title="${esc(`${a.time}–${a.end} · ${a.customer_name} · ${a.service_name}`)}">
        <b>${esc(a.customer_name)}</b><span>${a.time} · ${esc(a.service_name)}</span></div>`).join('')}
      ${nowLine}
    </div>`;
  }).join('');

  const timeLabels = [];
  for (let m = start; m <= end; m += 60) timeLabels.push(`<span style="top:${y(m)}px">${String(m / 60).padStart(2, '0')}:00</span>`);

  box.innerHTML = `<div class="timeline"><div class="tl-grid" style="grid-template-columns:56px repeat(${cols}, minmax(170px, 1fr))">
    <div class="tl-corner"></div>
    ${ag.professionals.map((p) => `<div class="tl-head"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}
      <span class="cnt">${appts.filter((a) => a.professional_id === p.id && a.status !== 'cancelled').length}</span></div>`).join('')}
    <div class="tl-times" style="height:${H}px;position:sticky">${timeLabels.join('')}</div>
    ${colHtml}
  </div></div>`;

  $$('.appt', box).forEach((a) => a.addEventListener('click', (e) => { e.stopPropagation(); appointmentModal(Number(a.dataset.id)); }));
  $$('.tl-col', box).forEach((col) => col.addEventListener('click', (e) => {
    if (e.target.closest('.tl-block')) return;
    const step = Number(S.settings.slot_step) || 30;
    const m = start + Math.floor((e.clientY - col.getBoundingClientRect().top) / PPM / step) * step;
    newAppointmentModal({ date: ag.date, time: fmtMin(m), professionalId: Number(col.dataset.pro) });
  }));
  // Rola até perto da hora atual (ou do primeiro atendimento).
  const focus = ag.now.date === ag.date ? ag.now.min - 60 : appts[0]?.start_min - 30;
  if (focus > start) $('.timeline', box).scrollTop = y(focus);
}

const fmtMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

async function appointmentModal(id) {
  const list = await call(`/api/admin/appointments?from=${S.date}&to=${S.date}`);
  let a = list.find((x) => x.id === id);
  if (!a) {
    const all = await call('/api/admin/appointments');
    a = all.find((x) => x.id === id);
  }
  if (!a) return toast('Agendamento não encontrado.', true);

  const waText = `Olá, ${a.customer_name.split(' ')[0]}! Aqui é da ${S.settings.business_name}. Sobre seu horário de ${fmtDate(a.date, { day: '2-digit', month: '2-digit' })} às ${a.time} (${a.service_name}): `;
  const actions = a.status === 'confirmed'
    ? `<button class="btn" data-status="done">✓ Concluído</button><button class="btn" data-status="no_show">Faltou</button>
       <button class="btn" id="resched">Remarcar</button><button class="btn danger" data-status="cancelled">Cancelar</button>`
    : `<button class="btn" data-status="confirmed">Reabrir como confirmado</button>`;

  openModal(`${esc(a.customer_name)} <span class="badge ${a.status}" style="vertical-align:middle">${STATUS_LABEL[a.status]}</span>`, `
    <dl class="kv">
      <dt>Quando</dt><dd>${esc(longDate(a.date))}, <strong class="tabnum">${a.time} – ${a.end}</strong></dd>
      <dt>Serviço</dt><dd>${esc(a.service_name)} · ${money(a.price_cents)}</dd>
      <dt>${esc(S.settings.staff_label)}</dt><dd>${esc(a.professional_name)}</dd>
      <dt>WhatsApp</dt><dd>${fmtPhone(a.customer_phone)} <a class="small" target="_blank" rel="noopener" href="${waLink(a.customer_phone, waText)}">abrir conversa ↗</a></dd>
      ${a.customer_email ? `<dt>E-mail</dt><dd>${esc(a.customer_email)}</dd>` : ''}
      <dt>Origem</dt><dd>${a.source === 'online' ? 'Página de agendamento' : 'Painel'} · lembrete ${a.reminder_sent_at ? 'enviado' : 'pendente'}</dd>
    </dl>
    <label class="field">Anotações internas<textarea class="input" id="notes" rows="2">${esc(a.notes)}</textarea></label>
    <div id="resched-box"></div>`,
    `${actions}<button class="btn ghost" id="remind">Enviar lembrete</button><button class="btn primary" id="save-notes">Salvar</button>`);

  const patch = async (body, msg) => {
    await call(`/api/admin/appointments/${a.id}`, { method: 'PATCH', body });
    toast(msg);
    modal.close();
    route();
  };
  $$('[data-status]', modal).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.status === 'cancelled' && !confirm('Cancelar e avisar o cliente pelo WhatsApp?')) return;
    patch({ status: b.dataset.status }, 'Status atualizado.');
  }));
  $('#save-notes').addEventListener('click', () => patch({ notes: $('#notes').value }, 'Anotação salva.'));
  $('#remind').addEventListener('click', async () => {
    const r = await call(`/api/admin/appointments/${a.id}/notify`, { method: 'POST', body: { kind: 'reminder' } });
    toast(r.status === 'failed' ? 'Falhou: ' + r.error : 'Lembrete enviado.', r.status === 'failed');
  });
  $('#resched')?.addEventListener('click', () => {
    const box = $('#resched-box');
    box.innerHTML = `<div class="card" style="padding:14px;display:grid;gap:12px">
      <strong>Remarcar</strong>${whenFields({ date: a.date, time: a.time, professionalId: a.professional_id, serviceId: a.service_id, forService: a.service_id })}
      <button class="btn primary" id="do-resched">Confirmar remarcação</button></div>`;
    wireWhenFields(box, () => a.service_id);
    $('#do-resched').addEventListener('click', () => patch({
      date: $('[name=date]', box).value, time: $('[name=time]', box).value, professionalId: Number($('[name=pro]', box).value),
    }, 'Remarcado e cliente avisado.'));
  });
}

// Campos de data/horário/profissional com sugestões de horários livres.
function whenFields({ date, time, professionalId, forService }) {
  const pros = S.pros.filter((p) => p.active && (!forService || p.service_ids.includes(forService)));
  return `<div class="grid-2">
      <label class="field">Data<input class="input" type="date" name="date" value="${date || S.date}" required></label>
      <label class="field">Horário<input class="input" type="time" name="time" value="${time || ''}" step="300" required></label>
    </div>
    <label class="field">${esc(S.settings.staff_label)}<select class="input" name="pro">
      ${professionalId === undefined ? '<option value="">Qualquer disponível</option>' : ''}
      ${pros.map((p) => `<option value="${p.id}" ${p.id === professionalId ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
    </select></label>
    <div><div class="small muted" style="margin-bottom:6px">Horários livres</div><div class="chips" data-free><span class="small muted">—</span></div></div>`;
}

function wireWhenFields(box, getService) {
  const load = async () => {
    const free = $('[data-free]', box);
    const service = getService();
    const date = $('[name=date]', box).value;
    if (!service || !date) { free.innerHTML = '<span class="small muted">Escolha serviço e data.</span>'; return; }
    const pro = $('[name=pro]', box).value;
    const slots = await call(`/api/admin/slots?date=${date}&service=${service}${pro ? '&professional=' + pro : ''}`);
    free.innerHTML = slots.length
      ? slots.map((s) => `<button type="button" class="chip" data-t="${s.time}">${s.time}</button>`).join('')
      : '<span class="small muted">Sem horários livres no expediente. Você ainda pode digitar um horário para encaixe.</span>';
    $$('[data-t]', free).forEach((c) => c.addEventListener('click', () => {
      $('[name=time]', box).value = c.dataset.t;
      $$('[data-t]', free).forEach((x) => x.style.borderColor = x === c ? 'var(--brand)' : '');
    }));
  };
  $('[name=date]', box).addEventListener('change', load);
  $('[name=pro]', box).addEventListener('change', load);
  box.reloadFree = load;
  load();
}

async function newAppointmentModal({ date, time, professionalId, name = '', phone = '' }) {
  const customers = await call('/api/admin/customers').catch(() => []);
  const services = S.services.filter((s) => s.active);
  const firstService = professionalId
    ? services.find((s) => S.pros.find((p) => p.id === professionalId)?.service_ids.includes(s.id)) || services[0]
    : services[0];
  openModal('Novo agendamento', `<form class="form" id="nf">
      <label class="field">Serviço<select class="input" name="service">${services.map((s) =>
        `<option value="${s.id}" ${s.id === firstService?.id ? 'selected' : ''}>${esc(s.name)} · ${duration(s.duration_min)} · ${money(s.price_cents)}</option>`).join('')}</select></label>
      <div id="when">${whenFields({ date, time, professionalId: professionalId ?? undefined, forService: firstService?.id })}</div>
      <div class="grid-2">
        <label class="field">Cliente<input class="input" name="name" list="cust-list" required value="${esc(name)}" autocomplete="off"></label>
        <label class="field">WhatsApp<input class="input" name="phone" type="tel" required value="${esc(fmtPhone(phone))}"></label>
      </div>
      <datalist id="cust-list">${customers.map((c) => `<option value="${esc(c.name)}">${fmtPhone(c.phone)}</option>`).join('')}</datalist>
      <label class="field">Anotações<textarea class="input" name="notes" rows="2"></textarea></label>
      <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="notify" checked> Enviar confirmação para o cliente</label>
    </form>`, '<button class="btn" data-close2>Cancelar</button><button class="btn primary" id="create">Agendar</button>');

  const f = $('#nf');
  maskPhone(f.phone);
  $('[data-close2]', modal).addEventListener('click', () => modal.close());
  const whenBox = $('#when');
  const svc = () => Number(f.service.value);
  wireWhenFields(whenBox, svc);
  f.service.addEventListener('change', () => {
    const keep = { date: $('[name=date]', whenBox).value, time: $('[name=time]', whenBox).value, pro: Number($('[name=pro]', whenBox).value) || undefined };
    const allowed = S.pros.find((p) => p.id === keep.pro)?.service_ids.includes(svc());
    whenBox.innerHTML = whenFields({ date: keep.date, time: keep.time, professionalId: allowed ? keep.pro : undefined, forService: svc() });
    wireWhenFields(whenBox, svc);
  });
  f.name.addEventListener('change', () => {
    const c = customers.find((x) => x.name === f.name.value);
    if (c && !f.phone.value) f.phone.value = fmtPhone(c.phone);
  });
  $('#create').addEventListener('click', async () => {
    if (!f.reportValidity()) return;
    const body = {
      serviceId: svc(), date: $('[name=date]', whenBox).value, time: $('[name=time]', whenBox).value,
      professionalId: Number($('[name=pro]', whenBox).value) || null,
      name: f.name.value, phone: f.phone.value, notes: f.notes.value, notify: f.notify.checked,
    };
    if (!body.time) return toast('Escolha o horário.', true);
    const a = await call('/api/admin/appointments', { method: 'POST', body });
    toast(`Agendado com ${a.professional_name} às ${a.time}.`);
    modal.close();
    S.date = a.date;
    if (location.hash !== '#agenda') location.hash = '#agenda'; else route();
  });
}

// ---------------------------------------------------------------- Clientes

async function viewCustomers(el) {
  el.innerHTML = `<div class="page-head"><h1>Clientes</h1>
      <div class="toolbar"><input class="input" id="q" placeholder="Buscar por nome ou telefone" style="width:260px">
      <a class="btn" id="csv" href="/api/admin/export.csv">Exportar agendamentos (CSV)</a></div></div>
    <div class="card" id="list"><div class="empty">Carregando…</div></div>`;
  let timer;
  const load = async () => {
    const rows = await call(`/api/admin/customers?q=${encodeURIComponent($('#q').value)}`);
    $('#list').innerHTML = rows.length ? `<div class="table-wrap"><table class="t"><thead><tr>
        <th>Cliente</th><th>WhatsApp</th><th class="num">Atendimentos</th><th class="num">Faltas</th>
        <th>Última visita</th><th>Próximo</th><th class="num">Total gasto</th></tr></thead><tbody>
      ${rows.map((c) => `<tr class="click" data-phone="${esc(c.phone)}">
        <td><strong>${esc(c.name)}</strong></td><td class="tabnum">${fmtPhone(c.phone)}</td>
        <td class="num">${c.done}</td><td class="num">${c.no_show ? `<span class="badge no_show">${c.no_show}</span>` : '0'}</td>
        <td>${c.last_visit ? fmtDate(c.last_visit, { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
        <td>${c.next_visit ? `<span class="badge confirmed">${fmtDate(c.next_visit, { day: '2-digit', month: 'short' })}</span>` : '—'}</td>
        <td class="num">${money(c.spent_cents).replace('Grátis', 'R$ 0,00')}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Nenhum cliente encontrado.</div>';
    $$('tr[data-phone]', el).forEach((tr) => tr.addEventListener('click', () => customerModal(rows.find((c) => c.phone === tr.dataset.phone))));
  };
  $('#q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  load();
}

async function customerModal(c) {
  const hist = await call(`/api/admin/customers/${c.phone}`);
  openModal(esc(c.name), `
    <div class="toolbar"><span class="tabnum">${fmtPhone(c.phone)}</span>
      <span class="badge done">${c.done} atendimento(s)</span>${c.no_show ? `<span class="badge no_show">${c.no_show} falta(s)</span>` : ''}
      <span class="badge">${money(c.spent_cents).replace('Grátis', 'R$ 0,00')}</span></div>
    <table class="t"><tbody>${hist.map((h) => `<tr><td class="tabnum">${fmtDate(h.date, { day: '2-digit', month: '2-digit', year: '2-digit' })} ${h.time}</td>
      <td>${esc(h.service_name)}<div class="small muted">${esc(h.professional_name)}</div></td>
      <td><span class="badge ${h.status}">${STATUS_LABEL[h.status]}</span></td></tr>`).join('')}</tbody></table>`,
    `<a class="btn wa" target="_blank" rel="noopener" href="${waLink(c.phone, `Olá, ${c.name.split(' ')[0]}! `)}">WhatsApp</a>
     <button class="btn primary" id="book">Agendar para este cliente</button>`);
  $('#book').addEventListener('click', () => newAppointmentModal({ date: S.today, name: c.name, phone: c.phone }));
}

// ---------------------------------------------------------------- Serviços

async function viewServices(el) {
  S.services = await call('/api/admin/services');
  el.innerHTML = `<div class="page-head"><h1>Serviços</h1><button class="btn primary" id="add">+ Novo serviço</button></div>
    <div class="card"><div class="table-wrap"><table class="t"><thead><tr><th>Serviço</th><th class="num">Duração</th><th class="num">Preço</th>
      <th class="num">${esc(S.settings.staff_label)}s</th><th>Status</th></tr></thead><tbody>
    ${S.services.map((s) => `<tr class="click" data-id="${s.id}"><td><strong>${esc(s.name)}</strong>${s.description ? `<div class="small muted">${esc(s.description)}</div>` : ''}</td>
      <td class="num">${duration(s.duration_min)}</td><td class="num">${money(s.price_cents)}</td><td class="num">${s.professionals}</td>
      <td>${s.active ? '<span class="badge done">Ativo</span>' : '<span class="badge">Oculto</span>'}</td></tr>`).join('')}
    </tbody></table></div></div>
    <p class="small muted">Novos serviços ficam disponíveis para toda a equipe. Ajuste quem atende cada serviço em <a href="#equipe">Equipe</a>.</p>`;
  $('#add').addEventListener('click', () => serviceModal());
  $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => serviceModal(S.services.find((s) => s.id === Number(tr.dataset.id)))));
}

function serviceModal(s = { name: '', description: '', duration_min: 30, price_cents: 0, active: 1 }) {
  openModal(s.id ? 'Editar serviço' : 'Novo serviço', `<form class="form" id="sf">
      <label class="field">Nome<input class="input" name="name" value="${esc(s.name)}" required></label>
      <label class="field"><span>Descrição <span class="hint">opcional, aparece para o cliente</span></span><input class="input" name="description" value="${esc(s.description)}"></label>
      <div class="grid-2">
        <label class="field">Duração (minutos)<input class="input" name="duration_min" type="number" min="5" max="720" step="5" value="${s.duration_min}" required></label>
        <label class="field">Preço (R$)<input class="input" name="price" inputmode="decimal" value="${(s.price_cents / 100).toFixed(2).replace('.', ',')}"></label>
      </div>
      <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Visível na página de agendamento</label>
    </form>`,
  `${s.id ? '<button class="btn danger" id="del">Excluir</button>' : ''}<button class="btn primary" id="save">Salvar</button>`);
  const f = $('#sf');
  $('#save').addEventListener('click', async () => {
    if (!f.reportValidity()) return;
    const body = {
      name: f.name.value, description: f.description.value, duration_min: Number(f.duration_min.value),
      price_cents: Math.round(Number(f.price.value.replace(/\./g, '').replace(',', '.') || 0) * 100), active: f.active.checked,
    };
    await call(s.id ? `/api/admin/services/${s.id}` : '/api/admin/services', { method: s.id ? 'PUT' : 'POST', body });
    toast('Serviço salvo.');
    modal.close();
    S.pros = await call('/api/admin/professionals');
    route();
  });
  $('#del')?.addEventListener('click', async () => {
    if (!confirm(`Excluir "${s.name}"?`)) return;
    const r = await call(`/api/admin/services/${s.id}`, { method: 'DELETE' });
    toast(r.archived ? 'Serviço tem histórico: foi ocultado em vez de excluído.' : 'Serviço excluído.');
    modal.close();
    route();
  });
}

// ---------------------------------------------------------------- Equipe

async function viewTeam(el) {
  [S.pros, S.services] = await Promise.all([call('/api/admin/professionals'), call('/api/admin/services')]);
  el.innerHTML = `<div class="page-head"><h1>Equipe e horários</h1><button class="btn primary" id="add">+ Adicionar</button></div><div id="cards"></div>`;
  const cards = $('#cards');
  S.pros.forEach((p) => cards.append(proCard(p)));
  $('#add').addEventListener('click', () => {
    const blank = { name: '', role: '', color: '#6366f1', active: 1, service_ids: S.services.filter((s) => s.active).map((s) => s.id),
      hours: [1, 2, 3, 4, 5].map((w) => ({ weekday: w, start: '09:00', end: '18:00' })) };
    const c = proCard(blank);
    cards.prepend(c);
    $('input[name=name]', c).focus();
  });
}

function proCard(p) {
  const el = document.createElement('section');
  el.className = 'card pro-card';
  el.innerHTML = `<div class="head">
      <input type="color" name="color" value="${esc(p.color)}" style="width:42px;height:42px;border:none;background:none;padding:0;cursor:pointer" aria-label="Cor">
      <input class="input" name="name" placeholder="Nome" value="${esc(p.name)}" style="flex:1;min-width:160px;font-weight:700">
      <input class="input" name="role" placeholder="Função (ex.: Barbeiro)" value="${esc(p.role)}" style="flex:1;min-width:140px">
      <label class="small" style="display:flex;gap:6px;align-items:center"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}> Ativo</label>
    </div>
    <div><div class="small muted" style="margin-bottom:6px;font-weight:600">Serviços que atende</div>
      <div class="chips">${S.services.filter((s) => s.active || p.service_ids.includes(s.id)).map((s) =>
        `<label class="chip"><input type="checkbox" name="svc" value="${s.id}" ${p.service_ids.includes(s.id) ? 'checked' : ''}>${esc(s.name)}</label>`).join('')}</div></div>
    <div><div class="small muted" style="margin-bottom:6px;font-weight:600">Horário de trabalho <span style="font-weight:400">— use dois intervalos para marcar o almoço</span></div>
      <div class="hours">${[1, 2, 3, 4, 5, 6, 0].map((w) => `<div class="row" data-wd="${w}"><strong class="small">${WEEKDAYS[w]}</strong>
        <div class="ranges">${p.hours.filter((h) => h.weekday === w).map(rangeHtml).join('')}
        <button class="btn sm ghost" data-add>+ intervalo</button><span class="small muted" data-off>Folga</span></div></div>`).join('')}</div></div>
    <div class="toolbar" style="justify-content:flex-end">
      ${p.id ? '<button class="btn danger sm" data-del>Remover</button>' : ''}
      <button class="btn primary sm" data-save>${p.id ? 'Salvar alterações' : 'Adicionar à equipe'}</button></div>`;

  const refreshOff = () => $$('.row', el).forEach((r) => { $('[data-off]', r).hidden = !!$('.range', r); });
  const wireRange = (r) => $('button', r).addEventListener('click', () => { r.remove(); refreshOff(); });
  $$('.range', el).forEach(wireRange);
  $$('[data-add]', el).forEach((b) => b.addEventListener('click', () => {
    const prev = $$('.range', b.parentElement).pop();
    const start = prev ? $$('input', prev)[1].value : '09:00';
    const tmp = document.createElement('div');
    tmp.innerHTML = rangeHtml({ start, end: prev ? '18:00' : '18:00' });
    const r = tmp.firstElementChild;
    b.before(r);
    wireRange(r);
    refreshOff();
  }));
  refreshOff();

  $('[data-save]', el).addEventListener('click', async () => {
    const body = {
      name: $('[name=name]', el).value, role: $('[name=role]', el).value, color: $('[name=color]', el).value,
      active: $('[name=active]', el).checked,
      service_ids: $$('[name=svc]:checked', el).map((c) => Number(c.value)),
      hours: $$('.row', el).flatMap((r) => $$('.range', r).map((rg) => {
        const [a, b] = $$('input', rg);
        return { weekday: Number(r.dataset.wd), start: a.value, end: b.value };
      })),
    };
    const saved = await call(p.id ? `/api/admin/professionals/${p.id}` : '/api/admin/professionals', { method: p.id ? 'PUT' : 'POST', body });
    toast('Salvo!');
    S.pros = await call('/api/admin/professionals');
    el.replaceWith(proCard(saved));
  });
  $('[data-del]', el)?.addEventListener('click', async () => {
    if (!confirm(`Remover ${p.name} da equipe?`)) return;
    const r = await call(`/api/admin/professionals/${p.id}`, { method: 'DELETE' });
    toast(r.archived ? 'Tem histórico de atendimentos: foi desativado.' : 'Removido.');
    route();
  });
  return el;
}

const rangeHtml = (h) => `<span class="range"><input type="time" value="${h.start}" step="300" aria-label="Início">–<input type="time" value="${h.end}" step="300" aria-label="Fim"><button type="button" aria-label="Remover intervalo">×</button></span>`;

// ---------------------------------------------------------------- Bloqueios

async function viewBlocks(el) {
  const blocks = await call('/api/admin/blocks');
  el.innerHTML = `<div class="page-head"><h1>Folgas e bloqueios</h1></div>
    <section class="card section"><h2>Bloquear um período</h2>
      <form class="form" id="bf">
        <div class="grid-2">
          <label class="field">De<input class="input" type="date" name="date" value="${S.today}" required></label>
          <label class="field">Até<input class="input" type="date" name="date_to" value="${S.today}" required></label>
        </div>
        <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="all_day" checked> Dia inteiro</label>
        <div class="grid-2" id="hrs" hidden>
          <label class="field">Das<input class="input" type="time" name="start" value="12:00"></label>
          <label class="field">Até<input class="input" type="time" name="end" value="13:00"></label>
        </div>
        <div class="grid-2">
          <label class="field">Quem<select class="input" name="professional_id"><option value="">Todos (fechar o estabelecimento)</option>
            ${S.pros.filter((p) => p.active).map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
          <label class="field">Motivo<input class="input" name="reason" placeholder="Feriado, férias, curso…"></label>
        </div>
        <div><button class="btn primary">Bloquear</button></div>
      </form></section>
    <section class="card section"><h2>Próximos bloqueios</h2>
      ${blocks.length ? `<table class="t"><tbody>${blocks.map((b) => `<tr>
        <td class="tabnum">${fmtDate(b.date, { weekday: 'short', day: '2-digit', month: 'short' })}</td>
        <td>${b.start_min === 0 && b.end_min === 1440 ? 'Dia inteiro' : `${b.start} – ${b.end}`}</td>
        <td>${esc(b.professional_name || 'Todos')}</td><td class="muted">${esc(b.reason)}</td>
        <td class="num"><button class="btn sm ghost danger" data-del="${b.id}">Remover</button></td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Nenhum bloqueio agendado.</div>'}</section>`;
  const f = $('#bf');
  f.all_day.addEventListener('change', () => { $('#hrs').hidden = f.all_day.checked; });
  f.date.addEventListener('change', () => { if (f.date_to.value < f.date.value) f.date_to.value = f.date.value; });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(f));
    body.all_day = f.all_day.checked;
    const r = await call('/api/admin/blocks', { method: 'POST', body });
    toast(r.conflicts ? `Bloqueado. Atenção: ${r.conflicts} agendamento(s) já marcados nesse período.` : `${r.created} dia(s) bloqueado(s).`, !!r.conflicts);
    route();
  });
  $$('[data-del]', el).forEach((b) => b.addEventListener('click', async () => {
    await call(`/api/admin/blocks/${b.dataset.del}`, { method: 'DELETE' });
    route();
  }));
}

// ---------------------------------------------------------------- Mensagens

async function viewMessages(el) {
  const rows = await call('/api/admin/notifications');
  const KIND = { confirmation: 'Confirmação', reminder: 'Lembrete', cancellation: 'Cancelamento', reschedule: 'Remarcação' };
  const providerInfo = {
    log: 'Modo demonstração: as mensagens são registradas aqui e no terminal, sem envio real. Configure NOTIFY_PROVIDER=webhook ou twilio no .env para enviar pelo WhatsApp.',
    webhook: 'Enviando via webhook (n8n, Make, Evolution API, Z-API…).',
    twilio: 'Enviando via Twilio.',
  }[S.me.provider] || '';
  el.innerHTML = `<div class="page-head"><h1>Mensagens automáticas</h1>
      <button class="btn" id="run">Verificar lembretes agora</button></div>
    <div class="card section"><strong>Canal: ${esc(S.me.provider)}</strong><p class="small muted" style="margin:6px 0 0">${esc(providerInfo)}</p>
      <p class="small muted" style="margin:6px 0 0">Lembretes saem ${S.settings.reminder_hours}h antes de cada horário confirmado (altere em Configurações).</p></div>
    <div class="card">${rows.length ? `<div class="table-wrap"><table class="t"><thead><tr><th>Enviada</th><th>Tipo</th><th>Cliente</th><th>Horário</th><th>Status</th></tr></thead><tbody>
      ${rows.map((n) => `<tr class="click" data-id="${n.id}"><td class="tabnum small">${esc(new Date(n.created_at.replace(' ', 'T') + 'Z').toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))}</td>
        <td>${KIND[n.kind] || n.kind}</td><td>${esc(n.customer_name || '—')}<div class="small muted">${fmtPhone(n.recipient)}</div></td>
        <td class="small">${n.date ? `${fmtDate(n.date, { day: '2-digit', month: '2-digit' })} ${n.time}` : '—'}</td>
        <td><span class="badge ${n.status}">${{ sent: 'Enviada', logged: 'Registrada', failed: 'Falhou' }[n.status] || n.status}</span></td></tr>
        <tr hidden data-msg="${n.id}"><td colspan="5"><div class="msg-preview">${esc(n.message)}</div>${n.error ? `<p class="small" style="color:var(--danger)">${esc(n.error)}</p>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">Nenhuma mensagem enviada ainda.</div>'}</div>`;
  $$('tr[data-id]', el).forEach((tr) => tr.addEventListener('click', () => {
    const m = $(`tr[data-msg="${tr.dataset.id}"]`, el);
    m.hidden = !m.hidden;
  }));
  $('#run').addEventListener('click', async () => {
    const r = await call('/api/admin/notifications/run', { method: 'POST' });
    toast(r.sent ? `${r.sent} lembrete(s) enviado(s).` : 'Nenhum lembrete pendente agora.');
    route();
  });
}

// ---------------------------------------------------------------- Configurações

async function viewSettings(el) {
  const { settings: s, presets } = await call('/api/admin/settings');
  const field = (name, label, attrs = '', hint = '') =>
    `<label class="field"><span>${label}${hint ? ` <span class="hint">${hint}</span>` : ''}</span><input class="input" name="${name}" value="${esc(s[name])}" ${attrs}></label>`;
  el.innerHTML = `<div class="page-head"><h1>Configurações</h1></div>
    <form id="sf">
    <section class="card section"><h2>Seu negócio</h2><div class="form">
      <div class="grid-2">${field('business_name', 'Nome', 'required')}${field('tagline', 'Frase de destaque')}</div>
      <div class="grid-2">${field('address', 'Endereço')}${field('whatsapp', 'WhatsApp do negócio', 'type="tel"', 'para o cliente falar com você')}</div>
      <div class="grid-2">${field('instagram', 'Instagram', 'placeholder="@seunegocio"')}
        <label class="field">Cor da marca<input class="input" type="color" name="primary_color" value="${esc(s.primary_color)}" style="padding:4px;height:42px"></label></div>
      <div class="grid-2">${field('staff_label', 'Como chamar a equipe', '', 'ex.: Barbeiro, Especialista, Box')}${field('notes_label', 'Pergunta no campo de observações')}</div>
    </div></section>
    <section class="card section"><h2>Regras da agenda</h2><div class="form">
      <div class="grid-2">${field('slot_step', 'Intervalo entre horários (min)', 'type="number" min="5" max="240" step="5"', 'ex.: 30 → 09:00, 09:30…')}
        ${field('min_notice_min', 'Antecedência mínima (min)', 'type="number" min="0" step="15"', 'evita agendamento em cima da hora')}</div>
      <div class="grid-2">${field('max_days_ahead', 'Agenda aberta por (dias)', 'type="number" min="1" max="180"')}
        ${field('cancel_limit_hours', 'Cliente cancela até (horas antes)', 'type="number" min="0" max="168"')}</div>
      <div class="grid-2">${field('reminder_hours', 'Lembrete automático (horas antes)', 'type="number" min="1" max="168"')}
        ${field('timezone', 'Fuso horário', '', 'ex.: America/Sao_Paulo, America/Manaus')}</div>
    </div></section>
    <div style="margin-bottom:16px"><button class="btn primary">Salvar configurações</button></div>
    </form>
    <section class="card section"><h2>Trocar senha do painel</h2>
      <form class="form" id="pf"><div class="grid-2">
        <label class="field">Senha atual<input class="input" type="password" name="current" autocomplete="current-password" required></label>
        <label class="field">Nova senha<input class="input" type="password" name="next" autocomplete="new-password" minlength="6" required></label>
      </div><div><button class="btn">Trocar senha</button></div></form></section>
    <section class="card section" style="border-color:color-mix(in srgb, var(--danger) 40%, var(--line))"><h2>Recomeçar com um modelo pronto</h2>
      <p class="small muted" style="margin-top:-6px">Apaga <strong>todos</strong> os serviços, equipe e agendamentos e recria a partir de um modelo. Útil para montar uma demonstração para um cliente novo.</p>
      <form class="form" id="rf"><div class="grid-2">
        <label class="field">Modelo<select class="input" name="preset">${Object.entries(presets).map(([k, v]) => `<option value="${k}" ${k === s.segment ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        <label class="field">Digite APAGAR para confirmar<input class="input" name="confirm" autocomplete="off"></label></div>
        <label class="small" style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="demo" checked> Incluir agendamentos fictícios de demonstração</label>
        <div><button class="btn danger">Recriar dados</button></div></form></section>`;

  $('#sf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    await call('/api/admin/settings', { method: 'PUT', body });
    toast('Configurações salvas.');
    await refreshBase();
    renderShell();
    route();
  });
  $('#pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    await call('/api/admin/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) });
    toast('Senha alterada. Entre novamente.');
    setTimeout(renderLogin, 1200);
  });
  $('#rf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    await call('/api/admin/reset', { method: 'POST', body: { preset: f.preset.value, confirm: f.confirm.value, demo: f.demo.checked } });
    toast('Dados recriados.');
    S.date = null;
    await refreshBase();
    renderShell();
    location.hash = '#agenda';
    route();
  });
}
