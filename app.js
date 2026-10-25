'use strict';

/* =========================================================
   Knee Recovery Tracker: all data lives in localStorage.
   ========================================================= */

const STORE_KEY = 'knee-recovery-tracker:v1';

const PROCEDURES = [
  'ACL reconstruction + meniscus repair',
  'ACL reconstruction + partial meniscectomy',
  'ACL reconstruction',
  'Other knee surgery',
];

// Quick-add library: [name, sets, reps, extra]. Sets/reps are first-time defaults only;
// after that an exercise fills in from the last time it was logged.
const STARTER_EXERCISES = [
  ['Quad sets', 3, 10, '5 s hold'],
  ['Straight leg raises', 3, 10, ''],
  ['Heel slides', 3, 10, ''],
  ['Heel props (extension)', null, null, '10 min'],
  ['Prone hangs', null, null, '5 min'],
  ['Ankle pumps', 1, 20, ''],
  ['Patellar mobilizations', null, null, '2 min'],
  ['Calf raises', 3, 15, ''],
  ['Glute bridges', 3, 10, ''],
  ['Side-lying hip abduction', 3, 10, ''],
  ['Hamstring curls', 3, 10, ''],
  ['Terminal knee extensions', 3, 15, 'band'],
  ['Mini squats', 3, 10, ''],
  ['Wall sits', 3, null, '30 s hold'],
  ['Step-ups', 3, 10, ''],
  ['Single-leg balance', 3, null, '30 s'],
  ['Leg press', 3, 10, ''],
  ['Stationary bike', null, null, '10 min'],
].map(([name, sets, reps, extra]) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, sets, reps, extra }));

// v1 stored a "dose" string like "3 × 10, 5 s hold".
function parseDose(dose = '') {
  const m = dose.match(/^(\d+)\s*[×x]\s*(\d+)\s*(?:,\s*(.*))?$/i);
  return m ? { sets: Number(m[1]), reps: Number(m[2]), extra: m[3] || '' } : { sets: null, reps: null, extra: dose };
}

function fmtDose(w) {
  const parts = [];
  if (w.sets != null && w.reps != null) parts.push(`${w.sets} × ${w.reps}`);
  else if (w.sets != null) parts.push(`${w.sets} sets`);
  else if (w.reps != null) parts.push(`${w.reps} reps`);
  if (w.extra) parts.push(w.extra);
  return parts.join(', ');
}

const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Day ranges are post-op days (day 0 = surgery day).
const PHASES = [
  { name: 'Protection & early motion', from: 0, to: 14,
    focus: ['Control pain and swelling with ice, compression and elevation', 'Get the knee fully straight', 'Wake up the quad with quad sets and leg raises'] },
  { name: 'Restore motion & walking', from: 14, to: 42,
    focus: ['Work toward 90°, then 120° of bend', 'Wean off crutches and brace as cleared', 'Walk with a normal heel-to-toe pattern'] },
  { name: 'Strength & control', from: 42, to: 84,
    focus: ['Build quad and hip strength', 'Single-leg balance and control', 'Full, symmetric range of motion'] },
  { name: 'Advanced strength & running prep', from: 84, to: 182,
    focus: ['Progressive loading in the gym', 'Start a return-to-run program when cleared', 'Landing mechanics and early plyometrics'] },
  { name: 'Return to sport', from: 182, to: Infinity,
    focus: ['Sport-specific agility and cutting', 'Strength and hop testing against the other leg', 'Gradual return to practice, then games'] },
];

// Typical windows in post-op weeks. These are general guides, not a protocol.
const MILESTONES = [
  { id: 'full-ext', name: 'Knee fully straight (0° extension)', from: 1, to: 2 },
  { id: 'slr', name: 'Straight leg raise with no lag', from: 1, to: 3 },
  { id: 'flex-90', name: '90° of knee bend', from: 2, to: 4 },
  { id: 'off-crutches', name: 'Walking without crutches', from: 2, to: 6 },
  { id: 'bike', name: 'Full revolution on a stationary bike', from: 3, to: 6 },
  { id: 'off-brace', name: 'Brace discontinued', from: 4, to: 6 },
  { id: 'flex-120', name: '120° of knee bend', from: 6, to: 8 },
  { id: 'normal-gait', name: 'Walking with a normal gait', from: 6, to: 8 },
  { id: 'balance', name: '30-second single-leg balance', from: 6, to: 10 },
  { id: 'stairs', name: 'Stairs step-over-step', from: 8, to: 12 },
  { id: 'full-flex', name: 'Full bend, matching the other knee', from: 10, to: 12 },
  { id: 'jog', name: 'First jog', from: 12, to: 16 },
  { id: 'sl-squat', name: 'Controlled single-leg squat', from: 12, to: 16 },
  { id: 'agility', name: 'Agility & cutting drills', from: 20, to: 26 },
  { id: 'rts', name: 'Cleared to return to sport', from: 36, to: 52 },
];

/* ---------------- State ---------------- */

function normalize(s = {}) {
  const logs = s.logs || {};
  let exercises = Array.isArray(s.exercises)
    ? s.exercises.map(e => ('dose' in e && e.sets === undefined ? { id: e.id, name: e.name, ...parseDose(e.dose) } : e))
    : STARTER_EXERCISES.map(e => ({ ...e }));

  if ((s.version || 1) < 2) {
    // v1 entries were a checklist of program ids; turn them into logged exercises.
    Object.values(logs).forEach(entry => {
      if (!entry.exercises) return;
      entry.workout = Object.keys(entry.exercises)
        .map(id => exercises.find(e => e.id === id))
        .filter(Boolean)
        .map(e => ({ name: e.name, sets: e.sets ?? undefined, reps: e.reps ?? undefined, extra: e.extra || undefined }));
      if (!entry.workout.length) delete entry.workout;
      delete entry.exercises;
    });
    STARTER_EXERCISES.forEach(st => {
      if (!exercises.some(e => sameName(e.name, st.name))) exercises.push({ ...st });
    });
  }

  return {
    version: 2,
    profile: Object.assign({
      surgeryDate: '', knee: 'Right', procedure: PROCEDURES[0],
      graft: '', surgeon: '', pt: '', goal: '',
    }, s.profile),
    logs,
    exercises,
    milestones: s.milestones || {},
    customMilestones: Array.isArray(s.customMilestones) ? s.customMilestones : [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn('Could not read saved data', e);
  }
  return normalize();
}

let state = load();

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('Could not save. Your browser storage may be full or disabled.');
  }
}

/* ---------------- Utilities ---------------- */

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fromKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d);
}
const todayKey = () => toKey(new Date());
function addDays(k, n) {
  const d = fromKey(k);
  d.setDate(d.getDate() + n);
  return toKey(d);
}
function daysBetween(a, b) {
  return Math.round((fromKey(b) - fromKey(a)) / 864e5);
}
function postOpDay(k) {
  return state.profile.surgeryDate ? daysBetween(state.profile.surgeryDate, k) : null;
}
const weekOf = day => Math.floor(day / 7) + 1;
function fmtDate(k, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return fromKey(k).toLocaleDateString(undefined, opts);
}
function fmtShort(k) {
  return fmtDate(k, { weekday: 'short', month: 'short', day: 'numeric' });
}
const sortedKeys = () => Object.keys(state.logs).sort();
const num = v => (v === '' || v == null || Number.isNaN(Number(v)) ? undefined : Number(v));
const uid = () => Math.random().toString(36).slice(2, 9);

function phaseFor(day) {
  return PHASES.find(p => day >= p.from && day < p.to) || PHASES[PHASES.length - 1];
}
function allMilestones() {
  return MILESTONES.concat(state.customMilestones.map(m => ({ ...m, custom: true })));
}

/* ---------------- Navigation ---------------- */

let currentView = 'today';

function showView(name) {
  currentView = name;
  $$('.tabs button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  render();
  window.scrollTo({ top: 0 });
}

$$('.tabs button').forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

function render() {
  renderHeader();
  if (currentView === 'today') renderToday();
  if (currentView === 'progress') renderProgress();
  if (currentView === 'milestones') renderMilestones();
  if (currentView === 'history') renderHistory();
  if (currentView === 'settings') renderSettings();
}

function renderHeader() {
  const p = state.profile;
  if (!p.surgeryDate) {
    $('#headerSub').textContent = 'Set your surgery date to begin';
    return;
  }
  const day = postOpDay(todayKey());
  $('#headerSub').textContent = day >= 0
    ? `${p.knee} knee · Day ${day} post-op · Week ${weekOf(day)}`
    : `${p.knee} knee · Surgery in ${-day} day${day === -1 ? '' : 's'}`;
}

/* ---------------- Onboarding ---------------- */

function fillProcedureSelect(sel) {
  sel.innerHTML = PROCEDURES.map(p => `<option>${esc(p)}</option>`).join('');
}
fillProcedureSelect($('#obProcedure'));
fillProcedureSelect($('#pProcedure'));

$('#onboarding').addEventListener('submit', e => {
  e.preventDefault();
  state.profile.surgeryDate = $('#obDate').value;
  state.profile.knee = $('#obKnee').value;
  state.profile.procedure = $('#obProcedure').value;
  save();
  render();
});

/* ---------------- Log (today) ---------------- */

let logDate = todayKey();
let draft = {};      // values for the tap scales
let dirty = false;

function buildScales() {
  $$('.scale').forEach(el => {
    const min = Number(el.dataset.min), max = Number(el.dataset.max);
    const labels = el.dataset.labels ? el.dataset.labels.split(',') : null;
    let html = '';
    for (let v = min; v <= max; v++) {
      const lbl = labels ? `<span class="lbl">${esc(labels[v - min])}</span>` : '';
      html += `<button type="button" data-v="${v}" aria-label="${el.dataset.field} ${v}">${v}${lbl}</button>`;
    }
    el.innerHTML = html;
    el.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const f = el.dataset.field, v = Number(b.dataset.v);
      draft[f] = draft[f] === v ? undefined : v;   // tap again to clear
      paintScale(el);
      markDirty();
    });
  });
}

function paintScale(el) {
  const v = draft[el.dataset.field];
  const hotFrom = el.dataset.field === 'mood' ? Infinity : 7;
  el.querySelectorAll('button').forEach(b => {
    const bv = Number(b.dataset.v);
    b.classList.toggle('on', bv === v);
    b.classList.toggle('hot', bv === v && bv >= hotFrom);
    b.setAttribute('aria-pressed', bv === v);
  });
}

function markDirty() {
  dirty = true;
  $('#saveStatus').textContent = 'Unsaved changes';
}

const LOG_INPUTS = ['flexion', 'extension', 'walking', 'brace', 'icing', 'notes'];

// Sleep is stored as decimal hours. Accepts "8:14" (hours:minutes) or "8.5".
// Returns undefined for blank input and null for input we can't read.
function parseSleep(text) {
  const s = text.trim();
  if (!s) return undefined;
  let hours;
  const hm = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (hm) {
    if (Number(hm[2]) >= 60) return null;
    hours = Number(hm[1]) + Number(hm[2]) / 60;
  } else if (/^\d{1,2}(\.\d+)?$|^\.\d+$/.test(s)) {
    hours = Number(s);
  } else {
    return null;
  }
  return hours <= 24 ? Math.round(hours * 60) / 60 : null;
}

// Whole and half hours read naturally as decimals (8, 7.5); anything else as h:mm.
function sleepInputText(hours) {
  if (hours == null) return '';
  if (Number.isInteger(hours * 2)) return String(hours);
  const mins = Math.round(hours * 60);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
}

function fmtSleep(hours) {
  const mins = Math.round(hours * 60);
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`;
}

function renderToday() {
  const hasProfile = !!state.profile.surgeryDate;
  $('#onboarding').hidden = hasProfile;
  $('#phaseCard').hidden = !hasProfile;
  if (!hasProfile && !$('#obDate').value) $('#obDate').value = todayKey();
  if (hasProfile) renderPhaseCard();
  loadForm(logDate);
}

function renderPhaseCard() {
  const day = postOpDay(todayKey());
  const goal = state.profile.goal ? `<p class="goal"><strong>Goal:</strong> ${esc(state.profile.goal)}</p>` : '';
  if (day < 0) {
    $('#phaseCard').innerHTML = `
      <div>
        <div class="eyebrow">Before surgery</div>
        <div class="bignum">${-day} day${day === -1 ? '' : 's'} to go</div>
        <p class="muted">Prehab helps: work on full extension, quad activation and reducing swelling before surgery.</p>
        ${goal}
      </div><div></div>`;
    return;
  }
  const phase = phaseFor(day);
  const idx = PHASES.indexOf(phase);
  const pct = phase.to === Infinity ? 100 : Math.round(((day - phase.from) / (phase.to - phase.from)) * 100);
  const week = weekOf(day);
  const next = allMilestones()
    .filter(m => !state.milestones[m.id])
    .sort((a, b) => (a.from ?? 999) - (b.from ?? 999))
    .slice(0, 3);
  const nextHtml = next.length
    ? next.map(m => `<li><span>${esc(m.name)}</span><span class="muted">${m.from != null ? `wk ${m.from}${m.to && m.to !== m.from ? '–' + m.to : ''}` : ''}</span></li>`).join('')
    : '<li><span>All milestones reached 🎉</span></li>';

  $('#phaseCard').innerHTML = `
    <div>
      <div class="eyebrow">Phase ${idx + 1} of ${PHASES.length}</div>
      <div class="bignum">Day ${day} · Week ${week}</div>
      <h3>${esc(phase.name)}</h3>
      <div class="bar" title="${pct}% through this phase"><i style="width:${pct}%"></i></div>
      <ul>${phase.focus.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
      ${goal}
    </div>
    <div>
      <div class="eyebrow">Up next</div>
      <ul class="next-ms">${nextHtml}</ul>
    </div>`;
}

/* Exercises logged for the day being edited: [{ name, sets, reps, extra, effort }] */
let workout = [];

const EFFORTS = [['easy', 'Easy'], ['moderate', 'Moderate'], ['hard', 'Hard']];
const effortLabel = v => (EFFORTS.find(([val]) => val === v) || [])[1] || '';

// The most recent sets/reps for an exercise before `beforeKey`, else the library default.
function lastDose(name, beforeKey) {
  const keys = sortedKeys().filter(k => k < beforeKey).reverse();
  for (const k of keys) {
    const w = (state.logs[k].workout || []).find(x => sameName(x.name, name));
    if (w) return { sets: w.sets, reps: w.reps, extra: w.extra };
  }
  const lib = state.exercises.find(e => sameName(e.name, name));
  return lib ? { sets: lib.sets, reps: lib.reps, extra: lib.extra } : {};
}

function lastSession(beforeKey) {
  const keys = sortedKeys().filter(k => k < beforeKey && state.logs[k].workout?.length);
  return keys[keys.length - 1] || null;
}

// Library ordered by most recently used, so the training-room regulars float to the front.
function libraryByRecent() {
  const last = {};
  sortedKeys().forEach(k => (state.logs[k].workout || []).forEach(w => { last[w.name.toLowerCase()] = k; }));
  return state.exercises
    .map((e, i) => ({ e, i, k: last[e.name.toLowerCase()] || '' }))
    .sort((a, b) => b.k.localeCompare(a.k) || a.i - b.i)
    .map(x => x.e);
}

function renderWorkout() {
  $('#workoutList').innerHTML = workout.length
    ? workout.map((w, i) => `
        <div class="wo-row">
          <div class="wo-head">
            <div class="wo-name">${esc(w.name)}</div>
            <div class="effort" role="group" aria-label="How hard was ${esc(w.name)}">
              ${EFFORTS.map(([val, label]) => `<button type="button" class="e-${val} ${w.effort === val ? 'on' : ''}" data-effort="${val}" data-i="${i}" aria-pressed="${w.effort === val}">${label}</button>`).join('')}
            </div>
          </div>
          <div class="wo-fields">
            <label class="wo-num"><input type="number" data-i="${i}" data-k="sets" value="${w.sets ?? ''}" min="0" max="99" inputmode="numeric" aria-label="${esc(w.name)} sets"><span>sets</span></label>
            <span class="wo-x">×</span>
            <label class="wo-num"><input type="number" data-i="${i}" data-k="reps" value="${w.reps ?? ''}" min="0" max="999" inputmode="numeric" aria-label="${esc(w.name)} reps"><span>reps</span></label>
            <input class="wo-extra" data-i="${i}" data-k="extra" value="${esc(w.extra || '')}" placeholder="hold, weight, time" aria-label="${esc(w.name)} details">
            <button type="button" class="icon-btn sm" data-rm="${i}" aria-label="Remove ${esc(w.name)}">×</button>
          </div>
        </div>`).join('')
    : '<p class="muted wo-empty">No exercises logged for this day yet.</p>';

  renderChips();
  $('#exCount').textContent = workout.length ? `${workout.length} logged` : '';
}

let editingChips = false;

function renderChips() {
  $('#editChips').textContent = editingChips ? 'Done' : 'Edit list';
  $('#exHint').textContent = editingChips
    ? 'Tap an exercise to remove it from this list.'
    : 'Tap to add. Sets and reps fill in from last time.';
  if (editingChips) {
    $('#repeatLast').hidden = true;
    $('#exChips').innerHTML = libraryByRecent()
      .map(e => `<button type="button" class="chip removable" data-remove-lib="${esc(e.name)}" aria-label="Remove ${esc(e.name)} from list">${esc(e.name)} <span aria-hidden="true">×</span></button>`)
      .join('') || '<small class="muted">Your list is empty.</small>';
    return;
  }

  const added = new Set(workout.map(w => w.name.toLowerCase()));
  $('#exChips').innerHTML = libraryByRecent().map(e => {
    const on = added.has(e.name.toLowerCase());
    return `<button type="button" class="chip ${on ? 'added' : ''}" data-add="${esc(e.name)}" aria-pressed="${on}">${on ? '✓' : '+'} ${esc(e.name)}</button>`;
  }).join('');

  const last = lastSession(logDate);
  $('#repeatLast').hidden = !last;
  if (last) $('#repeatLast').textContent = `Repeat ${fmtDate(last, { month: 'short', day: 'numeric' })} (${state.logs[last].workout.length})`;
}

$('#editChips').addEventListener('click', () => {
  editingChips = !editingChips;
  renderChips();
});

function addExercise(name) {
  name = name.trim();
  if (!name || workout.some(w => sameName(w.name, name))) return;
  let lib = state.exercises.find(e => sameName(e.name, name));
  if (!lib) {
    lib = { id: 'x-' + uid(), name, sets: null, reps: null, extra: '' };
    state.exercises.push(lib);
    save();
  }
  workout.push({ name: lib.name, ...lastDose(lib.name, logDate) });
  renderWorkout();
  markDirty();
}

$('#exChips').addEventListener('click', e => {
  const remove = e.target.closest('[data-remove-lib]')?.dataset.removeLib;
  if (remove) {
    if (!confirm(`Remove "${remove}" from your exercise list? Days you already logged it keep it.`)) return;
    state.exercises = state.exercises.filter(ex => !sameName(ex.name, remove));
    save();
    renderChips();
    return;
  }
  const name = e.target.closest('[data-add]')?.dataset.add;
  if (!name) return;
  const i = workout.findIndex(w => sameName(w.name, name));
  if (i >= 0) {
    workout.splice(i, 1);
    renderWorkout();
    markDirty();
  } else addExercise(name);
});

$('#repeatLast').addEventListener('click', () => {
  const last = lastSession(logDate);
  if (!last) return;
  state.logs[last].workout.forEach(w => {
    // Copy what was done, not how it felt; that gets rated fresh each day.
    if (!workout.some(x => sameName(x.name, w.name))) workout.push({ ...w, effort: undefined });
  });
  renderWorkout();
  markDirty();
});

function addOther() {
  addExercise($('#otherEx').value);
  $('#otherEx').value = '';
}
$('#addOtherEx').addEventListener('click', addOther);
$('#otherEx').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); addOther(); }
});

$('#workoutList').addEventListener('input', e => {
  const { i, k } = e.target.dataset;
  if (i == null) return;
  workout[i][k] = k === 'extra' ? e.target.value : num(e.target.value);
});
$('#workoutList').addEventListener('click', e => {
  const { rm, effort, i } = e.target.dataset;
  if (rm != null) {
    workout.splice(Number(rm), 1);
  } else if (effort) {
    workout[i].effort = workout[i].effort === effort ? undefined : effort;   // tap again to clear
  } else return;
  renderWorkout();
  markDirty();
});

function cleanWorkout(list) {
  return list
    .filter(w => w.name && w.name.trim())
    .map(w => {
      const out = { name: w.name.trim(), sets: num(w.sets), reps: num(w.reps), extra: (w.extra || '').trim() || undefined, effort: w.effort || undefined };
      Object.keys(out).forEach(key => out[key] === undefined && delete out[key]);
      return out;
    });
}

// Steps are entered the next day, once the full total is known, and saved onto the previous day.
function updateStepsField(k) {
  const prev = addDays(k, -1);
  $('#stepsLabel').textContent = k === todayKey()
    ? "Yesterday's steps"
    : `Steps on ${fmtDate(prev, { month: 'short', day: 'numeric' })}`;
  $('#steps').value = state.logs[prev]?.steps ?? '';
}

function saveStepsForPreviousDay(k) {
  const prev = addDays(k, -1);
  const steps = num($('#steps').value);
  if (steps != null) {
    state.logs[prev] = { ...state.logs[prev], steps };
  } else if (state.logs[prev]) {
    delete state.logs[prev].steps;
    if (!Object.keys(state.logs[prev]).length) delete state.logs[prev];
  }
}

function loadForm(k) {
  logDate = k;
  const entry = state.logs[k] || {};
  $('#logDate').value = k;
  $('#nextDay').disabled = k >= todayKey();

  const day = postOpDay(k);
  const parts = [fmtShort(k)];
  if (day != null) parts.push(day >= 0 ? `Post-op day ${day} · Week ${weekOf(day)}` : `${-day} days before surgery`);
  $('#logDateInfo').textContent = parts.join(' · ');

  draft = { pain: entry.pain, exPain: entry.exPain, swelling: entry.swelling, mood: entry.mood };
  $$('.scale').forEach(paintScale);
  LOG_INPUTS.forEach(id => { $('#' + id).value = entry[id] ?? ''; });
  $('#sleep').value = sleepInputText(entry.sleep);
  $('#sleep').setCustomValidity('');
  $('#pt').checked = !!entry.pt;
  $('#meds').checked = !!entry.meds;
  updateStepsField(k);
  workout = (entry.workout || []).map(w => ({ ...w }));
  $('#otherEx').value = '';
  renderWorkout();

  dirty = false;
  $('#saveStatus').textContent = state.logs[k] ? 'Editing a saved entry' : '';
}

function readForm() {
  const entry = {
    pain: draft.pain, exPain: draft.exPain, swelling: draft.swelling, mood: draft.mood,
    flexion: num($('#flexion').value),
    extension: num($('#extension').value),
    sleep: parseSleep($('#sleep').value) ?? undefined,
    icing: num($('#icing').value),
    steps: state.logs[logDate]?.steps,   // entered from the next day's check-in
    walking: $('#walking').value || undefined,
    brace: $('#brace').value || undefined,
    notes: $('#notes').value.trim() || undefined,
    pt: $('#pt').checked || undefined,
    meds: $('#meds').checked || undefined,
  };
  const done = cleanWorkout(workout);
  if (done.length) entry.workout = done;
  Object.keys(entry).forEach(key => entry[key] === undefined && delete entry[key]);
  return entry;
}

$('#logForm').addEventListener('submit', e => {
  e.preventDefault();
  const sleepEl = $('#sleep');
  if (parseSleep(sleepEl.value) === null) {
    sleepEl.closest('details').open = true;
    sleepEl.setCustomValidity('Enter sleep as hours:minutes (8:14) or decimal hours (8.5), up to 24 hours.');
    sleepEl.reportValidity();
    return;
  }
  const entry = readForm();
  if (Object.keys(entry).length) state.logs[logDate] = entry;
  else delete state.logs[logDate];
  saveStepsForPreviousDay(logDate);
  save();
  renderWorkout();   // refresh chip order
  dirty = false;
  $('#saveStatus').textContent = `Saved ✓ ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  renderHeader();
});

$('#logForm').addEventListener('input', e => {
  if (e.target.id === 'logDate') return;
  if (e.target.id === 'sleep') e.target.setCustomValidity('');
  markDirty();
});

function goToDate(k) {
  if (!k) return;
  if (k > todayKey()) k = todayKey();
  if (dirty && !confirm('You have unsaved changes for this day. Discard them?')) {
    $('#logDate').value = logDate;
    return;
  }
  loadForm(k);
}
$('#logDate').addEventListener('change', e => goToDate(e.target.value));
$('#prevDay').addEventListener('click', () => goToDate(addDays(logDate, -1)));
$('#nextDay').addEventListener('click', () => goToDate(addDays(logDate, 1)));

window.addEventListener('beforeunload', e => {
  if (dirty) { e.preventDefault(); e.returnValue = ''; }
});

/* ---------------- Charts (hand-rolled SVG) ---------------- */

function niceStep(span, maxTicks) {
  const steps = [1, 2, 5, 7, 14, 28, 56, 91, 182];
  return steps.find(s => span / s <= maxTicks) || 364;
}

function lineChart({ series, yMin, yMax, yStep, xMin, xMax, targets = [], markers = [], yFmt = v => v }) {
  const hasData = series.some(s => s.points.length);
  if (!hasData) return '<div class="empty">No data in this range yet. Log an entry to see it here.</div>';

  const W = 640, H = 230, m = { t: 14, r: 14, b: 30, l: 38 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const xs = x => m.l + ((x - xMin) / (xMax - xMin)) * iw;
  const ys = y => m.t + ih - ((y - yMin) / (yMax - yMin)) * ih;
  const clampY = y => Math.max(yMin, Math.min(yMax, y));
  let g = '';

  for (let y = yMin; y <= yMax + 1e-9; y += yStep) {
    g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${ys(y)}" y2="${ys(y)}"/>`;
    g += `<text class="tick" x="${m.l - 6}" y="${ys(y) + 4}" text-anchor="end">${yFmt(y)}</text>`;
  }
  const step = niceStep(xMax - xMin, 8);
  const firstTick = Math.ceil(xMin / step) * step;
  for (let x = firstTick; x <= xMax; x += step) {
    g += `<text class="tick" x="${xs(x)}" y="${H - 10}" text-anchor="middle">${x}</text>`;
  }

  targets.forEach(t => {
    if (t.y < yMin || t.y > yMax) return;
    g += `<line class="target" x1="${m.l}" x2="${W - m.r}" y1="${ys(t.y)}" y2="${ys(t.y)}"/>`;
    g += `<text class="target-label" x="${W - m.r - 4}" y="${ys(t.y) - 4}" text-anchor="end">${esc(t.label)}</text>`;
  });

  markers.forEach(mk => {
    if (mk.x < xMin || mk.x > xMax) return;
    const x = xs(mk.x);
    g += `<g><title>${esc(mk.label)} · day ${mk.x}</title>
      <line class="marker" x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ih}"/>
      <circle class="marker-dot" cx="${x}" cy="${m.t + 2}" r="4"/>
      <rect x="${x - 6}" y="${m.t}" width="12" height="${ih}" fill="transparent"/></g>`;
  });

  series.forEach(s => {
    const pts = s.points.filter(p => p.x >= xMin && p.x <= xMax).sort((a, b) => a.x - b.x);
    if (!pts.length) return;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${xs(p.x).toFixed(1)},${ys(clampY(p.y)).toFixed(1)}`).join(' ');
    g += `<path class="line s-${s.color}" d="${d}"/>`;
    pts.forEach(p => {
      g += `<circle class="dot f-${s.color}" cx="${xs(p.x).toFixed(1)}" cy="${ys(clampY(p.y)).toFixed(1)}" r="${pts.length > 60 ? 2.5 : 3.5}">
        <title>${esc(s.label)}: ${s.fmt ? s.fmt(p.y) : p.y + (s.unit || '')} · day ${p.x} (${fmtDate(p.key, { month: 'short', day: 'numeric' })})</title></circle>`;
    });
  });

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>
    <div class="muted" style="font-size:11.5px;text-align:right;margin-top:-2px">Post-op day</div>`;
}

function barChart({ bars, yMax = 100, yStep = yMax / 4, unit = '%' }) {
  if (!bars.length) return '<div class="empty">No weeks to show yet.</div>';
  const W = 640, H = 230, m = { t: 18, r: 10, b: 30, l: 38 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const bw = iw / bars.length;
  const ys = v => m.t + ih - (v / yMax) * ih;
  let g = '';
  for (let y = 0; y <= yMax; y += yStep) {
    g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${ys(y)}" y2="${ys(y)}"/>`;
    g += `<text class="tick" x="${m.l - 6}" y="${ys(y) + 4}" text-anchor="end">${y}${unit}</text>`;
  }
  const labelEvery = Math.ceil(bars.length / 12);
  bars.forEach((b, i) => {
    const x = m.l + i * bw + bw * 0.15, w = bw * 0.7;
    const h = Math.max(0, ih - (ys(b.value) - m.t));
    g += `<rect class="barrect" x="${x}" y="${ys(b.value)}" width="${w}" height="${h}" rx="3"><title>${esc(b.title)}</title></rect>`;
    if (bars.length <= 16) g += `<text class="barval" x="${x + w / 2}" y="${ys(b.value) - 4}" text-anchor="middle">${b.value}</text>`;
    if (i % labelEvery === 0) g += `<text class="tick" x="${x + w / 2}" y="${H - 10}" text-anchor="middle">${esc(b.label)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}</svg>
    <div class="muted" style="font-size:11.5px;text-align:right;margin-top:-2px">Post-op week</div>`;
}

/* ---------------- Progress ---------------- */

let range = 'all';

$$('#rangePicker button').forEach(b => b.addEventListener('click', () => {
  range = b.dataset.range;
  $$('#rangePicker button').forEach(x => x.classList.toggle('active', x === b));
  renderProgress();
}));

// x-axis day for an entry: post-op day, or days since the first log if no surgery date.
function xDay(k) {
  const d = postOpDay(k);
  if (d != null) return d;
  const first = sortedKeys()[0];
  return first ? daysBetween(first, k) : 0;
}

function series(field) {
  return sortedKeys()
    .filter(k => state.logs[k][field] != null)
    .map(k => ({ x: xDay(k), y: state.logs[k][field], key: k }));
}

function latestWith(field, beforeKey = '9999-12-31') {
  const keys = sortedKeys().filter(k => k <= beforeKey && state.logs[k][field] != null);
  const k = keys[keys.length - 1];
  return k ? { key: k, value: state.logs[k][field] } : null;
}

function avgOver(field, fromK, toK) {
  const vals = sortedKeys().filter(k => k >= fromK && k <= toK && state.logs[k][field] != null).map(k => state.logs[k][field]);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function streak() {
  let k = todayKey();
  if (!state.logs[k]) k = addDays(k, -1);
  let n = 0;
  while (state.logs[k]) { n++; k = addDays(k, -1); }
  return n;
}

const hasWorkout = entry => !!entry?.workout?.length;

// One row per rated exercise: a dot per session in range, most recently rated first.
function renderEffort(xMin, xMax) {
  const byName = new Map();
  sortedKeys().forEach(k => {
    const x = xDay(k);
    if (x < xMin || x > xMax) return;
    (state.logs[k].workout || []).forEach(w => {
      if (!w.effort) return;
      const key = w.name.toLowerCase();
      if (!byName.has(key)) byName.set(key, { name: w.name, pts: [] });
      byName.get(key).pts.push({ k, effort: w.effort });
    });
  });
  const rows = [...byName.values()].sort((a, b) => b.pts[b.pts.length - 1].k.localeCompare(a.pts[a.pts.length - 1].k));
  if (!rows.length) {
    $('#effortList').innerHTML = '<div class="empty">Rate exercises Easy, Moderate or Hard in your check-in to see how they change.</div>';
    return;
  }
  $('#effortList').innerHTML = rows.map(r => {
    const first = r.pts[0].effort, latest = r.pts[r.pts.length - 1].effort;
    const trend = r.pts.length > 1 && first !== latest ? `${effortLabel(first)} → ${effortLabel(latest)}` : effortLabel(latest);
    const dots = r.pts.slice(-30).map(p => {
      const d = postOpDay(p.k);
      return `<i class="eff-dot e-${p.effort}" title="${fmtDate(p.k, { month: 'short', day: 'numeric' })}${d != null ? ` · day ${d}` : ''}: ${effortLabel(p.effort)}"></i>`;
    }).join('');
    return `<div class="eff-row">
      <div><div class="eff-name">${esc(r.name)}</div><div class="eff-trend">${trend} · ${r.pts.length} rating${r.pts.length === 1 ? '' : 's'}</div></div>
      <div class="eff-dots">${dots}</div>
    </div>`;
  }).join('');
}

function stat(label, value, delta = '', cls = '') {
  return `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div><div class="delta ${cls}">${delta}</div></div>`;
}

function renderStats() {
  const out = [];
  const tk = todayKey();

  const flex = latestWith('flexion');
  if (flex) {
    const prev = latestWith('flexion', addDays(flex.key, -7));
    const best = Math.max(...series('flexion').map(p => p.y));
    let delta = `best ${best}°`;
    let cls = '';
    if (prev) {
      const diff = flex.value - prev.value;
      delta = `${diff >= 0 ? '+' : ''}${diff}° vs a week earlier`;
      cls = diff > 0 ? 'good' : diff < 0 ? 'bad' : '';
    }
    out.push(stat('Knee bend', `${flex.value}°`, delta, cls));
  } else out.push(stat('Knee bend', '–', 'Log flexion to track'));

  const ext = latestWith('extension');
  out.push(ext
    ? stat('Extension', `${ext.value}°`, ext.value <= 0 ? 'Fully straight ✓' : `${ext.value}° short of straight`, ext.value <= 0 ? 'good' : '')
    : stat('Extension', '–', 'Log extension to track'));

  const painNow = avgOver('pain', addDays(tk, -6), tk);
  const painPrev = avgOver('pain', addDays(tk, -13), addDays(tk, -7));
  if (painNow != null) {
    let delta = 'last 7 days', cls = '';
    if (painPrev != null) {
      const diff = painNow - painPrev;
      delta = `${diff <= 0 ? '↓' : '↑'} ${Math.abs(diff).toFixed(1)} vs prior week`;
      cls = diff < 0 ? 'good' : diff > 0 ? 'bad' : '';
    }
    out.push(stat('Everyday pain (7 d)', painNow.toFixed(1), delta, cls));
  } else out.push(stat('Everyday pain (7 d)', '–', 'No pain logged this week'));

  const exPainNow = avgOver('exPain', addDays(tk, -6), tk);
  const exPainPrev = avgOver('exPain', addDays(tk, -13), addDays(tk, -7));
  if (exPainNow != null) {
    let delta = 'last 7 days', cls = '';
    if (exPainPrev != null) {
      const diff = exPainNow - exPainPrev;
      delta = `${diff <= 0 ? '↓' : '↑'} ${Math.abs(diff).toFixed(1)} vs prior week`;
      cls = diff < 0 ? 'good' : diff > 0 ? 'bad' : '';
    }
    out.push(stat('Exercise/PT pain (7 d)', exPainNow.toFixed(1), delta, cls));
  } else out.push(stat('Exercise/PT pain (7 d)', '–', 'No exercise pain logged this week'));

  let exDays = 0;
  for (let i = 0; i < 7; i++) if (hasWorkout(state.logs[addDays(tk, -i)])) exDays++;
  out.push(stat('Exercise days (7 d)', `${exDays}/7`, 'days with exercises logged'));

  const s = streak();
  out.push(stat('Logging streak', `${s} day${s === 1 ? '' : 's'}`, s ? 'keep it going' : 'log today to start one'));

  const all = allMilestones();
  const done = all.filter(m => state.milestones[m.id]).length;
  out.push(stat('Milestones', `${done}/${all.length}`, done ? 'reached' : 'none checked off yet'));

  $('#stats').innerHTML = out.join('');
}

function renderProgress() {
  renderStats();

  const keys = sortedKeys();
  const todayX = xDay(todayKey());
  const lastX = keys.length ? xDay(keys[keys.length - 1]) : todayX;
  const xMax = Math.max(todayX, lastX, 1);
  let xMin;
  if (range === 'all') {
    const firstX = keys.length ? xDay(keys[0]) : 0;
    xMin = Math.min(0, firstX);
  } else {
    xMin = xMax - Number(range);
  }
  if (xMax - xMin < 7) xMin = xMax - 7;

  const markers = allMilestones()
    .filter(m => state.milestones[m.id])
    .map(m => ({ x: xDay(state.milestones[m.id]), label: m.name }));

  const flexPts = series('flexion');
  const flexTop = Math.max(150, ...flexPts.map(p => p.y));
  $('#chartFlexion').innerHTML = lineChart({
    series: [{ label: 'Flexion', color: 'c1', unit: '°', points: flexPts }],
    yMin: 0, yMax: Math.ceil(flexTop / 30) * 30, yStep: 30, xMin, xMax,
    targets: [{ y: 90, label: '90°' }, { y: 120, label: '120°' }, { y: 135, label: '135° typical full' }],
    markers, yFmt: v => `${v}°`,
  });

  const extPts = series('extension');
  const extVals = extPts.map(p => p.y);
  const extMax = Math.max(10, ...extVals);
  const extMin = Math.min(-5, ...extVals);
  $('#chartExtension').innerHTML = lineChart({
    series: [{ label: 'Extension', color: 'c2', unit: '°', points: extPts }],
    yMin: Math.floor(extMin / 5) * 5, yMax: Math.ceil(extMax / 5) * 5, yStep: extMax > 20 ? 10 : 5, xMin, xMax,
    targets: [{ y: 0, label: 'straight' }], yFmt: v => `${v}°`,
  });

  $('#chartSymptoms').innerHTML = lineChart({
    series: [
      { label: 'Everyday pain', color: 'c3', points: series('pain') },
      { label: 'Exercise/PT pain', color: 'c4', points: series('exPain') },
      { label: 'Swelling', color: 'c2', points: series('swelling') },
    ],
    yMin: 0, yMax: 10, yStep: 2, xMin, xMax,
  });

  renderEffort(xMin, xMax);

  const sleepPts = series('sleep');
  $('#chartSleep').innerHTML = lineChart({
    series: [{ label: 'Sleep', color: 'c4', fmt: fmtSleep, points: sleepPts }],
    yMin: 0, yMax: Math.max(10, ...sleepPts.map(p => Math.ceil(p.y))), yStep: 2, xMin, xMax,
    targets: [{ y: 8, label: '8 h' }], yFmt: v => `${v}h`,
  });

  // Days per post-op week with any exercise logged; future days are excluded.
  const bars = [];
  if (state.profile.surgeryDate && todayX >= 0) {
    const wFrom = Math.max(1, weekOf(Math.max(0, xMin)));
    const wTo = weekOf(todayX);
    for (let w = wFrom; w <= wTo; w++) {
      let active = 0, exercises = 0;
      for (let d = (w - 1) * 7; d < w * 7 && d <= todayX; d++) {
        const entry = state.logs[addDays(state.profile.surgeryDate, d)];
        if (hasWorkout(entry)) { active++; exercises += entry.workout.length; }
      }
      bars.push({ label: `${w}`, value: active, title: `Week ${w}: exercised on ${active} of 7 days (${exercises} exercises logged)` });
    }
  }
  $('#chartAdherence').innerHTML = barChart({ bars, yMax: 7, yStep: 1, unit: '' });
}

/* ---------------- Milestones ---------------- */

function renderMilestones() {
  const all = allMilestones();
  const today = todayKey();
  const day = postOpDay(today);
  const week = day != null && day >= 0 ? weekOf(day) : null;
  const done = all.filter(m => state.milestones[m.id]).length;
  $('#msSummary').textContent = `${done} of ${all.length} reached`;

  $('#milestoneList').innerHTML = all.map(m => {
    const achieved = state.milestones[m.id];
    const win = m.from != null ? `Typical: week ${m.from}${m.to != null && m.to !== m.from ? `–${m.to}` : ''}` : 'Personal goal';
    let pill = '';
    if (!achieved && week != null && m.from != null) {
      if (week >= m.from && week <= (m.to ?? m.from)) pill = '<span class="pill now">In window now</span>';
      else if (week < m.from) pill = `<span class="pill">in ${m.from - week} wk</span>`;
    }
    const meta = achieved
      ? `Reached ${fmtDate(achieved)}${postOpDay(achieved) != null ? ` · day ${postOpDay(achieved)} (week ${weekOf(Math.max(0, postOpDay(achieved)))})` : ''}`
      : win;
    return `
      <div class="ms ${achieved ? 'done' : ''}">
        <input type="checkbox" data-ms="${esc(m.id)}" ${achieved ? 'checked' : ''} aria-label="${esc(m.name)}">
        <div><div class="title">${esc(m.name)}</div><div class="meta">${meta}</div></div>
        <div class="right">
          ${pill}
          ${achieved ? `<input type="date" data-ms-date="${esc(m.id)}" value="${achieved}" max="${today}" aria-label="Date reached">` : ''}
          ${m.custom ? `<button type="button" class="link-btn danger-text" data-ms-del="${esc(m.id)}">Remove</button>` : ''}
        </div>
      </div>`;
  }).join('');
}

$('#milestoneList').addEventListener('change', e => {
  const id = e.target.dataset.ms;
  if (id) {
    if (e.target.checked) state.milestones[id] = todayKey();
    else delete state.milestones[id];
  }
  const dateId = e.target.dataset.msDate;
  if (dateId && e.target.value) state.milestones[dateId] = e.target.value;
  save();
  renderMilestones();
});

$('#milestoneList').addEventListener('click', e => {
  const id = e.target.dataset.msDel;
  if (!id || !confirm('Remove this milestone?')) return;
  state.customMilestones = state.customMilestones.filter(m => m.id !== id);
  delete state.milestones[id];
  save();
  renderMilestones();
});

$('#customMsForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#cmName').value.trim();
  if (!name) return;
  const wk = num($('#cmWeek').value);
  state.customMilestones.push({ id: 'c-' + uid(), name, from: wk, to: wk });
  save();
  e.target.reset();
  renderMilestones();
});

/* ---------------- History ---------------- */

function renderHistory() {
  const keys = sortedKeys().reverse();
  $('#historyCount').textContent = `${keys.length} entr${keys.length === 1 ? 'y' : 'ies'}`;
  if (!keys.length) {
    $('#historyList').innerHTML = '<div class="card empty">No entries yet. Your daily check-ins will show up here.</div>';
    return;
  }
  const dash = v => (v == null ? '<span class="muted">–</span>' : esc(v));
  const rows = keys.map(k => {
    const e = state.logs[k];
    const d = postOpDay(k);
    const exNames = (e.workout || []).map(w => w.name).join(', ');
    const exHtml = (e.workout || [])
      .map(w => `${esc(w.name)}${w.effort ? ` <span class="eff-tag e-${w.effort}">${effortLabel(w.effort)}</span>` : ''}`)
      .join(', ');
    const tags = [e.pt && 'PT', e.walking, e.brace && `Brace: ${e.brace.toLowerCase()}`].filter(Boolean).join(' · ');
    return `<tr>
      <td><strong>${fmtDate(k, { month: 'short', day: 'numeric' })}</strong><br><span class="muted">${d != null ? `Day ${d}` : ''}</span></td>
      <td>${dash(e.pain)}</td>
      <td>${dash(e.exPain)}</td>
      <td>${dash(e.swelling)}</td>
      <td>${e.flexion != null ? `${e.flexion}°` : dash()}</td>
      <td>${e.extension != null ? `${e.extension}°` : dash()}</td>
      <td title="${esc(exNames)}">${e.workout?.length || dash()}</td>
      <td class="notes">${tags ? `<div>${esc(tags)}</div>` : ''}${exHtml ? `<div class="ex-names">${exHtml}</div>` : ''}${e.notes ? esc(e.notes) : ''}</td>
      <td class="rowactions">
        <button type="button" class="link-btn" data-edit="${k}">Edit</button>
        <button type="button" class="link-btn danger-text" data-del="${k}">Delete</button>
      </td>
    </tr>`;
  }).join('');
  $('#historyList').innerHTML = `
    <div class="card table-wrap">
      <table class="hist-table">
        <thead><tr><th>Date</th><th title="Everyday pain">Pain</th><th title="Pain during exercise / PT">Ex. pain</th><th>Swell</th><th>Flex</th><th>Ext</th><th>Ex.</th><th class="notes">Notes</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

$('#historyList').addEventListener('click', e => {
  const editK = e.target.dataset.edit;
  const delK = e.target.dataset.del;
  if (editK) {
    logDate = editK;
    dirty = false;
    showView('today');
  }
  if (delK && confirm(`Delete the entry for ${fmtDate(delK)}?`)) {
    delete state.logs[delK];
    save();
    renderHistory();
  }
});

/* ---------------- Settings ---------------- */

function renderSettings() {
  const p = state.profile;
  $('#pDate').value = p.surgeryDate;
  $('#pKnee').value = p.knee;
  $('#pProcedure').value = p.procedure;
  $('#pGraft').value = p.graft;
  $('#pSurgeon').value = p.surgeon;
  $('#pPT').value = p.pt;
  $('#pGoal').value = p.goal;
  $('#profileStatus').textContent = '';
  renderExerciseEditor();
}

$('#profileForm').addEventListener('submit', e => {
  e.preventDefault();
  Object.assign(state.profile, {
    surgeryDate: $('#pDate').value,
    knee: $('#pKnee').value,
    procedure: $('#pProcedure').value,
    graft: $('#pGraft').value,
    surgeon: $('#pSurgeon').value.trim(),
    pt: $('#pPT').value.trim(),
    goal: $('#pGoal').value.trim(),
  });
  save();
  renderHeader();
  $('#profileStatus').textContent = 'Saved ✓';
});

function renderExerciseEditor() {
  $('#exerciseEditor').innerHTML = state.exercises.map((ex, i) => `
    <div class="ex-row">
      <input value="${esc(ex.name)}" data-i="${i}" data-k="name" aria-label="Exercise name">
      <input type="number" value="${ex.sets ?? ''}" data-i="${i}" data-k="sets" min="0" max="99" inputmode="numeric" placeholder="Sets" aria-label="${esc(ex.name)} default sets">
      <input type="number" value="${ex.reps ?? ''}" data-i="${i}" data-k="reps" min="0" max="999" inputmode="numeric" placeholder="Reps" aria-label="${esc(ex.name)} default reps">
      <input value="${esc(ex.extra || '')}" data-i="${i}" data-k="extra" placeholder="Hold / weight / time" aria-label="${esc(ex.name)} details">
      <button type="button" class="link-btn danger-text" data-ex-del="${i}">Remove</button>
    </div>`).join('') || '<p class="muted">No exercises yet.</p>';
}

$('#exerciseEditor').addEventListener('change', e => {
  const { i, k } = e.target.dataset;
  if (i == null) return;
  const ex = state.exercises[i];
  if (k === 'name') ex.name = e.target.value.trim() || ex.name;
  else if (k === 'extra') ex.extra = e.target.value.trim();
  else ex[k] = num(e.target.value) ?? null;
  save();
});

$('#exerciseEditor').addEventListener('click', e => {
  const i = e.target.dataset.exDel;
  if (i == null) return;
  if (!confirm(`Remove "${state.exercises[i].name}" from your quick-add list? Days you already logged it keep it.`)) return;
  state.exercises.splice(Number(i), 1);
  save();
  renderExerciseEditor();
});

$('#addExForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('#newExName').value.trim();
  if (state.exercises.some(ex => sameName(ex.name, name))) {
    alert(`"${name}" is already in your library.`);
    return;
  }
  state.exercises.push({
    id: 'x-' + uid(), name,
    sets: num($('#newExSets').value) ?? null,
    reps: num($('#newExReps').value) ?? null,
    extra: $('#newExExtra').value.trim(),
  });
  save();
  e.target.reset();
  renderExerciseEditor();
});

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$('#exportJson').addEventListener('click', () => {
  download(`knee-recovery-backup-${todayKey()}.json`, JSON.stringify(state, null, 2), 'application/json');
});

$('#importJsonBtn').addEventListener('click', () => $('#importJson').click());
$('#importJson').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (typeof data !== 'object' || !data.logs) throw new Error('missing logs');
    const n = Object.keys(data.logs).length;
    if (!confirm(`Replace your current data with this backup (${n} entries)?`)) return;
    state = normalize(data);
    save();
    render();
    alert('Backup restored.');
  } catch (err) {
    alert("That file doesn't look like a Knee Recovery backup.");
  }
});

$('#exportCsv').addEventListener('click', () => {
  const cols = ['date', 'post_op_day', 'pain', 'exercise_pain', 'swelling', 'flexion_deg', 'extension_deg', 'exercises',
    'walking', 'brace', 'sleep_h', 'sleep_hm', 'mood', 'icing', 'steps', 'pt_session', 'pain_meds', 'notes'];
  const cell = v => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = sortedKeys().map(k => {
    const e = state.logs[k];
    return [k, postOpDay(k), e.pain, e.exPain, e.swelling, e.flexion, e.extension,
      (e.workout || []).map(w => [w.name, fmtDose(w), w.effort && `(${effortLabel(w.effort).toLowerCase()})`].filter(Boolean).join(' ')).join('; '),
      e.walking, e.brace, e.sleep != null ? e.sleep.toFixed(2) : '', e.sleep != null ? sleepInputText(e.sleep) : '', e.mood, e.icing, e.steps, e.pt ? 'yes' : '', e.meds ? 'yes' : '', e.notes].map(cell).join(',');
  });
  download(`knee-recovery-log-${todayKey()}.csv`, [cols.join(','), ...rows].join('\n'), 'text/csv');
});

$('#eraseAll').addEventListener('click', () => {
  if (!confirm('Erase ALL entries, milestones and settings? This cannot be undone. Export a backup first if you want one.')) return;
  state = normalize();
  save();
  logDate = todayKey();
  showView('today');
});

/* ---------------- Boot ---------------- */

buildScales();
render();
