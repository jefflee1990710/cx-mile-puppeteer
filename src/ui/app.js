const STORAGE_KEY = 'cx-mile-puppeteer-form-v1';
const HISTORY_KEY = 'cx-mile-puppeteer-history-v1';
const HISTORY_MAX = 50;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function uid() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const CABIN_LABELS = {
  eco: 'Economy 經濟',
  pey: 'Premium Eco 特選經濟',
  bus: 'Business 商務',
  fir: 'First 頭等',
};

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function defaultForm() {
  return {
    autoLogin: true,
    loginMethod: 'mobile',
    countryCode: '852',
    mobile: '',
    membership: '',
    password: '',
    tasks: [{ id: uid(), origin: 'HKG', dest: 'NRT', dates: [todayIso()] }],
    cabins: ['bus'],
    adults: 1,
    directOnly: false,
    intervalMin: 30,
  };
}

function loadForm() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultForm();
    const parsed = { ...defaultForm(), ...JSON.parse(raw) };
    const today = todayIso();
    parsed.tasks = (parsed.tasks || defaultForm().tasks).map(t => ({
      ...t,
      dates: (t.dates || []).filter(d => d >= today),
    }));
    return parsed;
  } catch {
    return defaultForm();
  }
}

function saveForm(form) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
}

/** Strip password; keep enquiry fields for replay. */
function toHistoryEntry(form, startedAt = Date.now()) {
  return {
    id: `${startedAt}-${Math.random().toString(36).slice(2, 8)}`,
    startedAt,
    autoLogin: !!form.autoLogin,
    loginMethod: form.loginMethod === 'membership' ? 'membership' : 'mobile',
    countryCode: form.countryCode || '852',
    mobile: form.mobile || '',
    membership: form.membership || '',
    tasks: (form.tasks || []).map(t => ({
      id: t.id || uid(),
      origin: t.origin || '',
      dest: t.dest || '',
      dates: [...(t.dates || [])],
      range: t.range,
    })),
    cabins: [...(form.cabins || [])],
    adults: form.adults || 1,
    directOnly: !!form.directOnly,
    intervalMin: form.intervalMin || 30,
  };
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
}

function appendHistory(form) {
  const entry = toHistoryEntry(form);
  const next = [entry, ...loadHistory().filter(e => !sameEnquiry(e, entry))];
  saveHistory(next);
  return entry;
}

function sameEnquiry(a, b) {
  return (
    a.loginMethod === b.loginMethod &&
    a.countryCode === b.countryCode &&
    a.mobile === b.mobile &&
    a.membership === b.membership &&
    a.adults === b.adults &&
    !!a.directOnly === !!b.directOnly &&
    a.intervalMin === b.intervalMin &&
    JSON.stringify(a.cabins) === JSON.stringify(b.cabins) &&
    JSON.stringify(
      (a.tasks || []).map(t => ({ o: t.origin, d: t.dest, dates: t.dates })),
    ) ===
      JSON.stringify((b.tasks || []).map(t => ({ o: t.origin, d: t.dest, dates: t.dates })))
  );
}

function formatHistoryTime(ts) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

function entryToForm(entry) {
  const current = readFormFromDom();
  const today = todayIso();
  return {
    ...defaultForm(),
    autoLogin: entry.autoLogin ?? true,
    loginMethod: entry.loginMethod === 'membership' ? 'membership' : 'mobile',
    countryCode: entry.countryCode || '852',
    mobile: entry.mobile || '',
    membership: entry.membership || '',
    // Keep current password (history never stores it).
    password: current.password || '',
    adults: entry.adults || 1,
    directOnly: !!entry.directOnly,
    intervalMin: entry.intervalMin || 30,
    cabins: entry.cabins?.length ? entry.cabins : ['bus'],
    tasks: (entry.tasks || []).map(t => ({
      id: uid(),
      origin: t.origin || '',
      dest: t.dest || '',
      dates: (t.dates || []).filter(d => d >= today),
    })),
  };
}

function renderHistoryPanel() {
  const entries = loadHistory();
  const list = $('#historyList');
  const empty = $('#historyEmpty');
  const clearBtn = $('#historyClear');
  list.innerHTML = '';
  if (!entries.length) {
    empty.hidden = false;
    list.hidden = true;
    clearBtn.hidden = true;
    return;
  }
  empty.hidden = true;
  list.hidden = false;
  clearBtn.hidden = false;
  for (const entry of entries) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'history-item';
    const routes = (entry.tasks || [])
      .map(t => `${t.origin || '?'} → ${t.dest || '?'}`)
      .join(', ');
    const dates = (entry.tasks || [])
      .flatMap(t => t.dates || [])
      .filter(Boolean);
    const uniqueDates = [...new Set(dates)].slice(0, 4).join(', ');
    const cabinText = (entry.cabins || []).map(c => CABIN_LABELS[c] || c).join(' · ');
    btn.innerHTML = `
      <span class="history-item-time">${escapeHtml(formatHistoryTime(entry.startedAt))}</span>
      <span class="history-item-routes">${escapeHtml(routes)}</span>
      <span class="history-item-meta">${escapeHtml(
        [uniqueDates, cabinText, `${entry.adults || 1} adult${(entry.adults || 1) > 1 ? 's' : ''}`, `every ${entry.intervalMin || 30}m`]
          .filter(Boolean)
          .join(' · '),
      )}</span>
    `;
    btn.addEventListener('click', () => void reuseHistoryEntry(entry));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function setHistoryOpen(open) {
  void togglePanel($('#historyPanel'), open);
  if (open) renderHistoryPanel();
}

/**
 * Motion (Framer Motion DOM) helpers — same feel as extension AnimatePresence
 * (opacity + height, ~250ms easeInOut).
 */
function motionApi() {
  return globalThis.Motion || null;
}

let uiAnimLock = Promise.resolve();

function runUiAnim(fn) {
  uiAnimLock = uiAnimLock.then(fn).catch(() => undefined);
  return uiAnimLock;
}

async function animateIn(el) {
  const M = motionApi();
  el.hidden = false;
  el.style.overflow = 'hidden';
  el.style.opacity = '0';
  el.style.height = '0px';
  if (!M?.animate) {
    el.style.opacity = '';
    el.style.height = '';
    el.style.overflow = '';
    return;
  }
  await M.animate(el, { opacity: 1, height: 'auto' }, { duration: 0.25, ease: 'easeInOut' }).finished;
  el.style.opacity = '';
  el.style.height = '';
  el.style.overflow = '';
}

async function animateOut(el) {
  if (el.hidden) return;
  const M = motionApi();
  el.style.overflow = 'hidden';
  if (!M?.animate) {
    el.hidden = true;
    el.style.overflow = '';
    return;
  }
  await M.animate(el, { opacity: 0, height: 0 }, { duration: 0.25, ease: 'easeInOut' }).finished;
  el.hidden = true;
  el.style.opacity = '';
  el.style.height = '';
  el.style.overflow = '';
}

async function togglePanel(el, open) {
  await runUiAnim(async () => {
    if (open) {
      if (!el.hidden) return;
      await animateIn(el);
    } else {
      if (el.hidden) return;
      await animateOut(el);
    }
  });
}

async function swapFormSummary(showSummary) {
  const formEl = $('#searchForm');
  const summaryEl = $('#searchSummary');
  await runUiAnim(async () => {
    if (showSummary) {
      if (!formEl.hidden) await animateOut(formEl);
      if (summaryEl.hidden) await animateIn(summaryEl);
    } else {
      if (!summaryEl.hidden) await animateOut(summaryEl);
      if (formEl.hidden) await animateIn(formEl);
    }
  });
}

async function reuseHistoryEntry(entry) {
  if ($('#stop') && !$('#stop').hidden && !$('#stop').disabled) {
    await fetch('/api/stop', { method: 'POST' }).catch(() => undefined);
    setRunning(false, 'Idle');
  }
  setHistoryOpen(false);
  const form = entryToForm(entry);
  if (!form.tasks.some(t => t.origin && t.dest && t.dates?.length)) {
    alert('That history entry has no remaining future dates. Add dates, then search.');
    await applyForm(form);
    saveForm(form);
    return;
  }
  await applyForm(form);
  saveForm(form);
  await start();
}

/** @type {Array<{code:string,label:string,search:string}>} */
let origins = [];
/** @type {Record<string, Array<{code:string,label:string,search:string}>>} */
const destsByOrigin = {};

async function loadOrigins() {
  try {
    const res = await fetch('/api/airports/origins');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    origins = await res.json();
  } catch {
    origins = [];
  }
}

async function loadDestinations(origin) {
  const code = (origin || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) return [];
  if (destsByOrigin[code]) return destsByOrigin[code];
  try {
    const res = await fetch(`/api/airports/destinations/${code}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    destsByOrigin[code] = await res.json();
  } catch {
    destsByOrigin[code] = [];
  }
  return destsByOrigin[code];
}

/**
 * Combobox airport dropdown (matches extension AirportSelect).
 * @param {{ options: Array<{code:string,label:string,search:string}>, value: string, placeholder: string, loading?: boolean, onChange: (code: string) => void }} opts
 */
function createAirportSelect(opts) {
  const root = document.createElement('div');
  root.className = 'airport-select';

  const box = document.createElement('div');
  box.className = 'airport-box';
  box.tabIndex = 0;

  const list = document.createElement('ul');
  list.className = 'airport-list';
  list.hidden = true;

  let query = '';
  let open = false;

  const byCode = () => new Map(opts.options.map(o => [o.code, o]));

  const render = () => {
    box.innerHTML = '';
    const map = byCode();
    if (opts.value) {
      const chip = document.createElement('span');
      chip.className = 'airport-chip';
      const label = map.get(opts.value)?.label ?? opts.value;
      chip.innerHTML = `${label} <button type="button" aria-label="Remove ${opts.value}">×</button>`;
      $('button', chip).addEventListener('click', e => {
        e.stopPropagation();
        opts.onChange('');
      });
      box.appendChild(chip);
    } else {
      const input = document.createElement('input');
      input.className = 'airport-input';
      input.type = 'text';
      input.value = query;
      input.maxLength = opts.options.length ? 64 : 3;
      input.placeholder = opts.loading
        ? 'Loading airports…'
        : opts.options.length
          ? opts.placeholder
          : 'IATA (e.g. HKG)';
      input.disabled = !!opts.loading;
      input.addEventListener('focus', () => setOpen(true));
      input.addEventListener('input', e => {
        query = e.target.value;
        if (!opts.options.length) {
          const code = query.trim().toUpperCase();
          if (/^[A-Z]{3}$/.test(code)) opts.onChange(code);
          return;
        }
        setOpen(true);
        renderList();
      });
      box.appendChild(input);
    }

    renderList();
  };

  const renderList = () => {
    list.innerHTML = '';
    if (!open) {
      list.hidden = true;
      return;
    }
    const q = query.trim().toLowerCase();
    const pool = opts.options.filter(o => o.code !== opts.value);
    const matches = (q ? pool.filter(o => o.search.includes(q) || o.label.toLowerCase().includes(q)) : pool).slice(
      0,
      50,
    );
    if (!matches.length) {
      list.hidden = true;
      return;
    }
    for (const o of matches) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = o.label;
      btn.addEventListener('click', () => {
        query = '';
        opts.onChange(o.code);
        setOpen(false);
      });
      li.appendChild(btn);
      list.appendChild(li);
    }
    list.hidden = false;
  };

  const setOpen = next => {
    open = next;
    renderList();
  };

  box.addEventListener('click', () => {
    if (!opts.value) setOpen(true);
    const input = $('.airport-input', box);
    input?.focus();
  });

  document.addEventListener('pointerdown', e => {
    if (!root.contains(e.target)) setOpen(false);
  });

  root.appendChild(box);
  root.appendChild(list);

  root.update = next => {
    Object.assign(opts, next);
    render();
  };

  render();
  return root;
}

function selectedCabins() {
  return $$('.cabin-chip[aria-pressed="true"]').map(el => el.dataset.cabin);
}

function setCabins(cabins) {
  $$('.cabin-chip').forEach(el => {
    el.setAttribute('aria-pressed', cabins.includes(el.dataset.cabin) ? 'true' : 'false');
  });
}

function readFormFromDom() {
  const tasks = $$('.task').map(node => {
    const dates = $$('.date-chip', node).map(c => c.dataset.date).filter(Boolean);
    return {
      id: node.dataset.id || uid(),
      origin: (node.dataset.origin || '').toUpperCase(),
      dest: (node.dataset.dest || '').toUpperCase(),
      dates,
    };
  });
  return {
    autoLogin: $('#autoLogin').checked,
    loginMethod: currentLoginMethod(),
    countryCode: $('#countryCode').value.trim(),
    mobile: $('#mobile').value.trim(),
    membership: $('#membership').value.trim(),
    password: $('#password').value,
    tasks,
    cabins: selectedCabins(),
    adults: Number($('#adults').value) || 1,
    directOnly: $('#directOnly').checked,
    intervalMin: Number($('#intervalMin').value) || 30,
  };
}

function currentLoginMethod() {
  const pressed = $('.login-method-btn[aria-pressed="true"]');
  return pressed?.dataset.method === 'membership' ? 'membership' : 'mobile';
}

function setLoginMethod(method) {
  const next = method === 'membership' ? 'membership' : 'mobile';
  $$('.login-method-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', btn.dataset.method === next ? 'true' : 'false');
  });
  const mobileFields = $('#loginMobileFields');
  const membershipFields = $('#loginMembershipFields');
  if (mobileFields) mobileFields.hidden = next === 'membership';
  if (membershipFields) membershipFields.hidden = next !== 'membership';
}

function chipEl(date) {
  const span = document.createElement('span');
  span.className = 'date-chip';
  span.dataset.date = date;
  span.innerHTML = `${date} <button type="button" aria-label="Remove ${date}">×</button>`;
  $('button', span).addEventListener('click', () => {
    span.remove();
    persist();
  });
  return span;
}

function updateTaskCount() {
  const n = $$('.task').length;
  $('#taskCount').textContent = `${n} route${n === 1 ? '' : 's'}`;
}

function updateIntervalHint() {
  const mins = Number($('#intervalMin').value) || 30;
  $('#intervalHint').textContent =
    `Re-searches every ${mins}m — each cycle clears the list, searches again, and notifies on any match. Press Stop to end.`;
}

async function renderTasks(tasks) {
  const root = $('#tasks');
  root.innerHTML = '';
  for (const [index, task] of tasks.entries()) {
    const el = document.createElement('div');
    el.className = 'task';
    el.dataset.id = task.id;
    el.dataset.origin = task.origin || '';
    el.dataset.dest = task.dest || '';

    el.innerHTML = `
      <div class="task-head">
        <span class="task-title">Task ${index + 1}</span>
        <button type="button" class="icon-btn remove-task" aria-label="Remove task ${index + 1}">×</button>
      </div>
      <div class="route-grid">
        <div class="from-field">
          <span class="field-label">From</span>
          <div class="origin-slot"></div>
        </div>
        <span class="route-arrow" aria-hidden="true">→</span>
        <div class="to-field">
          <span class="field-label">To</span>
          <div class="dest-slot"></div>
        </div>
      </div>
      <div>
        <span class="field-label">Dates</span>
        <div class="date-chips"></div>
        <div class="date-add">
          <input class="date-input" type="date" min="${new Date().toISOString().slice(0, 10)}" aria-label="Task ${index + 1} add date" />
          <button type="button" class="link-btn add-date">+ Add</button>
        </div>
      </div>
    `;

    const chips = $('.date-chips', el);
    for (const d of task.dates || []) chips.appendChild(chipEl(d));

    const originSelect = createAirportSelect({
      options: origins,
      value: task.origin || '',
      placeholder: 'Origin',
      loading: !origins.length,
      onChange: async code => {
        el.dataset.origin = code;
        el.dataset.dest = '';
        destSelect.update({ options: [], value: '', loading: !!code });
        if (code) {
          const list = await loadDestinations(code);
          destSelect.update({ options: list, value: '', loading: false });
        } else {
          destSelect.update({ options: [], value: '', loading: false });
        }
        persist();
      },
    });
    $('.origin-slot', el).appendChild(originSelect);

    const destOptions = task.origin ? await loadDestinations(task.origin) : [];
    const destSelect = createAirportSelect({
      options: destOptions,
      value: task.dest || '',
      placeholder: 'Destination',
      loading: !!task.origin && !destOptions.length,
      onChange: code => {
        el.dataset.dest = code;
        persist();
      },
    });
    $('.dest-slot', el).appendChild(destSelect);

    const removeBtn = $('.remove-task', el);
    if (tasks.length <= 1) removeBtn.hidden = true;

    $('.add-date', el).addEventListener('click', () => {
      const input = $('.date-input', el);
      const v = input.value;
      if (!v) return;
      if (![...$$('.date-chip', el)].some(c => c.dataset.date === v)) {
        chips.appendChild(chipEl(v));
      }
      input.value = '';
      persist();
    });

    $('.remove-task', el).addEventListener('click', () => {
      if ($$('.task').length <= 1) return;
      el.remove();
      updateTaskCount();
      persist();
    });

    root.appendChild(el);
  }
  updateTaskCount();
}

function applyForm(form) {
  $('#autoLogin').checked = !!form.autoLogin;
  setLoginMethod(form.loginMethod === 'membership' ? 'membership' : 'mobile');
  $('#countryCode').value = form.countryCode || '852';
  $('#mobile').value = form.mobile || '';
  $('#membership').value = form.membership || '';
  $('#password').value = form.password || '';
  $('#directOnly').checked = !!form.directOnly;
  $('#adults').value = String(form.adults || 1);
  $('#intervalMin').value = String(form.intervalMin || 30);
  setCabins(form.cabins?.length ? form.cabins : ['bus']);
  updateIntervalHint();
  return renderTasks(form.tasks?.length ? form.tasks : defaultForm().tasks);
}

function persist() {
  saveForm(readFormFromDom());
}

/** @type {object | null} form snapshot shown while running */
let runningForm = null;

function renderSearchSummary(form) {
  const n = form.tasks?.length || 0;
  $('#summaryTitle').textContent = `Searching ${n} task${n === 1 ? '' : 's'}`;
  const ul = $('#summaryTasks');
  ul.innerHTML = '';
  for (const t of form.tasks || []) {
    const li = document.createElement('li');
    const dates = (t.dates || []).join(', ') || '—';
    li.innerHTML = `<span class="summary-route">${escapeHtml(t.origin)} → ${escapeHtml(t.dest)}</span><span class="summary-dates">${escapeHtml(dates)}</span>`;
    ul.appendChild(li);
  }
  const cabinText = (form.cabins || []).map(c => CABIN_LABELS[c] || c).join(' · ');
  const adults = form.adults || 1;
  $('#summaryMeta').textContent = `${cabinText} · ${adults} ${adults > 1 ? 'adults' : 'adult'} · every ${form.intervalMin || 30}m`;
}

function setRunning(running, message) {
  $('#start').disabled = running;
  $('#start').hidden = running;
  $('#stop').disabled = !running;
  $('#stop').hidden = !running;
  $('#status').textContent = message || (running ? 'Searching…' : 'Idle');

  const live = $('#liveStatus');
  if (running) {
    if (live.hidden) void togglePanel(live, true);
  } else if (!live.hidden) {
    void togglePanel(live, false);
  }

  const formEl = $('#searchForm');
  const summaryEl = $('#searchSummary');
  if (running) {
    if (!runningForm) runningForm = readFormFromDom();
    renderSearchSummary(runningForm);
    if (!formEl.hidden || summaryEl.hidden) void swapFormSummary(true);
  } else {
    runningForm = null;
    if (formEl.hidden || !summaryEl.hidden) void swapFormSummary(false);
  }
}

function prepend(listEl, html, className) {
  const li = document.createElement('li');
  if (className) li.className = className;
  li.innerHTML = html;
  listEl.prepend(li);
}

async function start() {
  const form = readFormFromDom();
  saveForm(form);
  const today = todayIso();
  if (!form.tasks.some(t => t.origin && t.dest && t.dates?.length)) {
    alert('Each task needs origin, destination, and at least one date.');
    return;
  }
  if (form.tasks.some(t => (t.dates || []).some(d => d < today))) {
    alert('Departure dates must be today or later.');
    return;
  }
  if (!form.cabins.length) {
    alert('Select at least one cabin.');
    return;
  }
  const res = await fetch('/api/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(form),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || `Start failed (${res.status})`);
    return;
  }
  appendHistory(form);
  runningForm = form;
  setHistoryOpen(false);
  setRunning(true, 'Searching…');
  $('#results').innerHTML = '';
}

async function stop() {
  await fetch('/api/stop', { method: 'POST' });
  setRunning(false, 'Stopping…');
}

function connectEvents() {
  const es = new EventSource('/api/events');
  es.onmessage = ev => {
    let data;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (data.type === 'status') {
      setRunning(!!data.running, data.message || (data.running ? 'Searching…' : 'Idle'));
    } else if (data.type === 'passStart') {
      $('#results').innerHTML = '';
      setRunning(true, 'Searching…');
      prepend($('#log'), `[${data.at}] Pass start`);
    } else if (data.type === 'result') {
      prepend(
        $('#results'),
        `<strong>${data.display}</strong><br>${data.found ? data.raw : 'Not available'}`,
        data.found ? 'found' : 'empty',
      );
    } else if (data.type === 'log') {
      prepend($('#log'), `[${data.at}] ${data.message}`);
    } else if (data.type === 'error') {
      prepend($('#log'), `[${data.at}] ERROR ${data.message}`);
      setRunning(false, 'Error');
    }
  };
}

$$('.cabin-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const pressed = btn.getAttribute('aria-pressed') === 'true';
    btn.setAttribute('aria-pressed', pressed ? 'false' : 'true');
    persist();
  });
});

$$('.login-method-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setLoginMethod(btn.dataset.method);
    persist();
  });
});

$('#addTask').addEventListener('click', async () => {
  const current = readFormFromDom();
  const last = current.tasks[current.tasks.length - 1];
  current.tasks.push({
    id: uid(),
    origin: last?.origin || 'HKG',
    dest: '',
    dates: last?.dates?.length ? [...last.dates] : [],
  });
  await applyForm(current);
  persist();
});

$('#intervalMin').addEventListener('input', updateIntervalHint);
document.body.addEventListener('change', persist);
document.body.addEventListener('input', e => {
  if (e.target.closest('.airport-select')) return;
  persist();
});
$('#start').addEventListener('click', start);
$('#stop').addEventListener('click', stop);
$('#historyBtn').addEventListener('click', () => {
  const panel = $('#historyPanel');
  setHistoryOpen(panel.hidden);
});
$('#historyClose').addEventListener('click', () => setHistoryOpen(false));
$('#historyClear').addEventListener('click', () => {
  if (!confirm('Clear all search history?')) return;
  saveHistory([]);
  renderHistoryPanel();
});
connectEvents();

const form = loadForm();
loadOrigins()
  .then(() => applyForm(form))
  .catch(() => applyForm(form));

fetch('/api/status')
  .then(r => r.json())
  .then(s => {
    if (s.running) {
      runningForm = loadForm();
      setRunning(true, 'Searching…');
    } else {
      setRunning(false, 'Idle');
    }
  })
  .catch(() => undefined);
