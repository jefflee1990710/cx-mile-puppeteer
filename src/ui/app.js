const STORAGE_KEY = 'cx-mile-puppeteer-form-v1';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function uid() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function defaultForm() {
  return {
    autoLogin: true,
    countryCode: '852',
    mobile: '',
    password: '',
    tasks: [{ id: uid(), origin: 'HKG', dest: 'NRT', dates: [] }],
    cabins: ['bus'],
    adults: 1,
    intervalMin: 30,
  };
}

function loadForm() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultForm();
    return { ...defaultForm(), ...JSON.parse(raw) };
  } catch {
    return defaultForm();
  }
}

function saveForm(form) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
}

function readFormFromDom() {
  const tasks = $$('.task').map(node => {
    const dates = $$('.chip', node).map(c => c.dataset.date).filter(Boolean);
    return {
      id: node.dataset.id || uid(),
      origin: $('#origin', node).value.trim().toUpperCase(),
      dest: $('#dest', node).value.trim().toUpperCase(),
      dates,
    };
  });
  return {
    autoLogin: $('#autoLogin').checked,
    countryCode: $('#countryCode').value.trim(),
    mobile: $('#mobile').value.trim(),
    password: $('#password').value,
    tasks,
    cabins: $$('input[name="cabin"]:checked').map(el => el.value),
    adults: Number($('#adults').value) || 1,
    intervalMin: Number($('#intervalMin').value) || 30,
  };
}

function renderTasks(tasks) {
  const root = $('#tasks');
  root.innerHTML = '';
  for (const task of tasks) {
    const el = document.createElement('div');
    el.className = 'task';
    el.dataset.id = task.id;
    el.innerHTML = `
      <div class="grid3">
        <label>Origin<input id="origin" type="text" maxlength="3" value="${task.origin || ''}" /></label>
        <label>Dest<input id="dest" type="text" maxlength="3" value="${task.dest || ''}" /></label>
        <label>Add date
          <span class="row">
            <input id="dateInput" type="date" />
            <button type="button" class="ghost add-date">Add</button>
          </span>
        </label>
      </div>
      <div class="chips"></div>
      <button type="button" class="ghost remove-task">Remove task</button>
    `;
    const chips = $('.chips', el);
    for (const d of task.dates || []) {
      chips.appendChild(chipEl(d));
    }
    $('.add-date', el).addEventListener('click', () => {
      const input = $('#dateInput', el);
      const v = input.value;
      if (!v) return;
      if (![...$$('.chip', el)].some(c => c.dataset.date === v)) {
        chips.appendChild(chipEl(v));
      }
      input.value = '';
      persist();
    });
    $('.remove-task', el).addEventListener('click', () => {
      el.remove();
      if (!$$('.task').length) renderTasks(defaultForm().tasks);
      persist();
    });
    root.appendChild(el);
  }
}

function chipEl(date) {
  const span = document.createElement('span');
  span.className = 'chip';
  span.dataset.date = date;
  span.innerHTML = `${date} <button type="button" aria-label="Remove ${date}">×</button>`;
  $('button', span).addEventListener('click', () => {
    span.remove();
    persist();
  });
  return span;
}

function applyForm(form) {
  $('#autoLogin').checked = !!form.autoLogin;
  $('#countryCode').value = form.countryCode || '852';
  $('#mobile').value = form.mobile || '';
  $('#password').value = form.password || '';
  $('#adults').value = String(form.adults || 1);
  $('#intervalMin').value = String(form.intervalMin || 30);
  $$('input[name="cabin"]').forEach(el => {
    el.checked = (form.cabins || []).includes(el.value);
  });
  renderTasks(form.tasks?.length ? form.tasks : defaultForm().tasks);
}

function persist() {
  saveForm(readFormFromDom());
}

function setRunning(running, message) {
  $('#start').disabled = running;
  $('#stop').disabled = !running;
  $('#status').textContent = message || (running ? 'Running…' : 'Idle');
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
  if (!form.tasks.some(t => t.origin && t.dest && t.dates?.length)) {
    alert('Each task needs origin, destination, and at least one date.');
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
  setRunning(true, 'Running…');
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
      setRunning(!!data.running, data.message || (data.running ? 'Running…' : 'Idle'));
    } else if (data.type === 'passStart') {
      $('#results').innerHTML = '';
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
  es.onerror = () => {
    // browser reconnects automatically
  };
}

const form = loadForm();
applyForm(form);
$('#addTask').addEventListener('click', () => {
  const current = readFormFromDom();
  current.tasks.push({ id: uid(), origin: 'HKG', dest: '', dates: [] });
  applyForm(current);
  persist();
});
document.body.addEventListener('change', persist);
document.body.addEventListener('input', persist);
$('#start').addEventListener('click', start);
$('#stop').addEventListener('click', stop);
connectEvents();
fetch('/api/status')
  .then(r => r.json())
  .then(s => setRunning(!!s.running, s.running ? 'Running…' : 'Idle'))
  .catch(() => undefined);
