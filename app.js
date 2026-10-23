'use strict';

/* ---------- Speicher (localStorage) ---------- */

const STORE_KEY = 'trainingsapp-daten';
const DRAFT_KEY = 'trainingsapp-entwurf';

let data = loadData();
let draft = loadDraft();          // laufendes, noch nicht gespeichertes Training
let current = { view: 'start', params: {} };

function emptyData() {
  return { app: 'trainingsapp', version: 1, days: [], sessions: [] };
}

function isValidData(d) {
  return d && Array.isArray(d.days) && Array.isArray(d.sessions);
}

function loadData() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (isValidData(d)) return d;
  } catch (e) { /* leer oder defekt -> neu anfangen */ }
  return emptyData();
}

function saveData() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch (e) {
    alert('Speichern fehlgeschlagen: ' + e.message);
  }
}

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch (e) { return null; }
}

function saveDraft() {
  if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  else localStorage.removeItem(DRAFT_KEY);
}

/* ---------- Hilfsfunktionen ---------- */

const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $back = document.getElementById('back');
const $toast = document.getElementById('toast');

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nameKey = name => String(name).trim().toLowerCase();
const findDay = id => data.days.find(d => d.id === id);

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function parseNum(s) {
  const n = parseFloat(String(s).replace(',', '.'));
  return isFinite(n) ? n : null;
}

const fmtNum = n => String(n).replace('.', ',');

function fmtDate(iso, long) {
  const opts = long
    ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
    : { weekday: 'short', day: '2-digit', month: '2-digit', year: '2-digit' };
  return new Date(iso).toLocaleDateString('de-DE', opts);
}

function fmtSet(s) {
  if (s.weight == null) return `${s.reps} Wdh.`;
  if (s.reps == null) return `${fmtNum(s.weight)} kg`;
  return `${fmtNum(s.weight)} kg × ${s.reps}`;
}

function sessionsNewestFirst() {
  return [...data.sessions].sort((a, b) => b.date.localeCompare(a.date));
}

// Letzter Eintrag einer Übung (über alle Trainingstage, per Name)
function lastEntry(name) {
  const k = nameKey(name);
  for (const s of sessionsNewestFirst()) {
    const e = s.entries.find(en => nameKey(en.name) === k);
    if (e) return { date: s.date, dayName: s.dayName, sets: e.sets };
  }
  return null;
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $toast.hidden = true; }, 2200);
}

/* ---------- Bildschirme ---------- */

const views = {
  start:    { title: 'Training',      tab: 'start',   render: renderStart },
  training: { title: () => draft ? draft.dayName : 'Training', tab: 'start', back: 'start', render: renderTraining },
  plan:     { title: 'Trainingsplan', tab: 'plan',    render: renderPlan },
  day:      { title: 'Trainingstag',  tab: 'plan',    back: 'plan', render: renderDay },
  history:  { title: 'Verlauf',       tab: 'history', render: renderHistory },
  exercise: { title: p => p.name,     tab: 'history', back: 'history', render: renderExercise },
  session:  { title: 'Training',      tab: 'history', back: 'history', render: renderSession },
  data:     { title: 'Sicherung',     tab: 'data',    render: renderData },
};

function go(view, params = {}) {
  current = { view, params };
  render();
  window.scrollTo(0, 0);
}

function render() {
  const v = views[current.view];
  $title.textContent = typeof v.title === 'function' ? v.title(current.params) : v.title;
  $back.hidden = !v.back;
  document.querySelectorAll('#tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === v.tab);
  });
  $view.innerHTML = v.render(current.params);
}

function renderStart() {
  let h = '';
  if (draft) {
    h += `<div class="card highlight">
      <h2>Laufendes Training: ${esc(draft.dayName)}</h2>
      <p class="sub">begonnen ${fmtDate(draft.date)}</p>
      <button class="btn primary" data-action="resume">Fortsetzen</button>
    </div>`;
  }
  if (!data.days.length) {
    return h + `<p class="hint">Noch kein Trainingsplan vorhanden. Lege zuerst deine Trainingstage und Übungen an.</p>
      <button class="btn primary" data-action="tab" data-tab="plan">Trainingsplan anlegen</button>`;
  }
  h += '<h2>Welcher Trainingstag?</h2>';
  const sessions = sessionsNewestFirst();
  for (const day of data.days) {
    const last = sessions.find(s => s.dayId === day.id);
    const info = `${day.exercises.length} Übungen` + (last ? ` · zuletzt ${fmtDate(last.date)}` : '');
    h += `<button class="btn" data-action="start-day" data-id="${day.id}">
      ${esc(day.name)}<small>${info}</small></button>`;
  }
  return h;
}

function renderTraining() {
  if (!draft) return '<p class="hint">Kein laufendes Training.</p>';
  let h = `<p class="sub">${fmtDate(draft.date, true)}<br>Vorausgefüllt mit deinen Werten vom letzten Mal. Leere Felder werden nicht gespeichert.</p>`;
  draft.entries.forEach((en, ei) => {
    const last = lastEntry(en.name);
    h += `<section class="card"><h2>${esc(en.name)}</h2>`;
    h += last
      ? `<p class="last">Letztes Mal (${fmtDate(last.date)}): ${last.sets.map(fmtSet).join(' · ')}</p>`
      : '<p class="last">Erstes Mal – noch keine Werte.</p>';
    h += '<div class="setgrid"><span></span><span class="head">kg</span><span class="head">Wdh.</span>';
    en.sets.forEach((s, si) => {
      h += `<span class="setno">${si + 1}</span>
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="–"
          data-field="tr-weight" data-ei="${ei}" data-si="${si}" value="${esc(s.weight)}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="–"
          data-field="tr-reps" data-ei="${ei}" data-si="${si}" value="${esc(s.reps)}">`;
    });
    h += `</div>
      <div class="row">
        <button class="btn" data-action="tr-del-set" data-ei="${ei}">− Satz</button>
        <button class="btn" data-action="tr-add-set" data-ei="${ei}">+ Satz</button>
      </div></section>`;
  });
  h += `<button class="btn primary" data-action="tr-save">Training speichern</button>
    <div class="spacer"></div>
    <button class="btn danger" data-action="tr-cancel">Training verwerfen</button>`;
  return h;
}

function renderPlan() {
  let h = '';
  if (!data.days.length) {
    h += '<p class="hint">Lege Trainingstage an, z. B. „Tag A – Oberkörper“ und „Tag B – Beine“.</p>';
  }
  for (const day of data.days) {
    const names = day.exercises.map(e => e.name.trim()).filter(Boolean).join(', ');
    h += `<button class="btn" data-action="open-day" data-id="${day.id}">
      ${esc(day.name)}<small>${names ? esc(names) : 'Noch keine Übungen'}</small></button>`;
  }
  h += '<button class="btn primary" data-action="add-day">+ Trainingstag hinzufügen</button>';
  return h;
}

function renderDay({ id }) {
  const day = findDay(id);
  if (!day) return '<p class="hint">Trainingstag nicht gefunden.</p>';
  let h = `<label class="lbl">Name des Trainingstags
      <input class="inp" type="text" data-field="day-name" value="${esc(day.name)}">
    </label>
    <h2>Übungen</h2>`;
  day.exercises.forEach((ex, i) => {
    h += `<div class="card">
      <input class="inp" type="text" data-field="ex-name" data-i="${i}"
        value="${esc(ex.name)}" placeholder="z. B. Bankdrücken">
      <div class="row">
        <span>Sätze</span>
        <div class="stepper">
          <button data-action="sets-minus" data-i="${i}" aria-label="Weniger Sätze">−</button>
          <b>${ex.sets}</b>
          <button data-action="sets-plus" data-i="${i}" aria-label="Mehr Sätze">+</button>
        </div>
      </div>
      <div class="row">
        <button class="icon-btn" data-action="ex-up" data-i="${i}" aria-label="Nach oben">↑</button>
        <button class="icon-btn" data-action="ex-down" data-i="${i}" aria-label="Nach unten">↓</button>
        <button class="icon-btn danger" data-action="ex-del" data-i="${i}">Entfernen</button>
      </div>
    </div>`;
  });
  h += `<button class="btn primary" data-action="add-ex">+ Übung hinzufügen</button>
    <div class="spacer"></div>
    <button class="btn danger" data-action="del-day">Trainingstag löschen</button>`;
  return h;
}

function renderHistory() {
  if (!data.sessions.length) {
    return '<p class="hint">Noch keine Trainings gespeichert.</p>';
  }
  // Übungen nach Namen zusammenfassen
  const map = new Map();
  for (const s of sessionsNewestFirst()) {
    for (const e of s.entries) {
      const k = nameKey(e.name);
      if (!map.has(k)) map.set(k, { name: e.name, count: 0, last: s.date });
      map.get(k).count++;
    }
  }
  const exercises = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));

  let h = '<h2>Übungen</h2>';
  for (const ex of exercises) {
    h += `<button class="btn" data-action="open-exercise" data-name="${esc(ex.name)}">
      ${esc(ex.name)}<small>${ex.count}× trainiert · zuletzt ${fmtDate(ex.last)}</small></button>`;
  }
  h += '<h2>Alle Trainings</h2>';
  for (const s of sessionsNewestFirst()) {
    h += `<button class="btn" data-action="open-session" data-id="${s.id}">
      ${fmtDate(s.date)}<small>${esc(s.dayName)} · ${s.entries.length} Übungen</small></button>`;
  }
  return h;
}

function renderExercise({ name }) {
  const k = nameKey(name);
  const rows = [];
  for (const s of sessionsNewestFirst()) {
    const e = s.entries.find(en => nameKey(en.name) === k);
    if (e) rows.push({ session: s, sets: e.sets });
  }
  if (!rows.length) return '<p class="hint">Keine Einträge.</p>';

  const weights = rows.flatMap(r => r.sets.map(s => s.weight)).filter(w => w != null);
  let h = weights.length
    ? `<p class="sub">Höchstes Gewicht: <b>${fmtNum(Math.max(...weights))} kg</b> · ${rows.length} Trainings</p>`
    : '';
  h += '<ul class="list">';
  for (const r of rows) {
    h += `<li><div class="date">${fmtDate(r.session.date)} <small>${esc(r.session.dayName)}</small></div>
      <div class="sets">${r.sets.map(fmtSet).join('<br>')}</div></li>`;
  }
  return h + '</ul>';
}

function renderSession({ id }) {
  const s = data.sessions.find(x => x.id === id);
  if (!s) return '<p class="hint">Training nicht gefunden.</p>';
  let h = `<p class="sub">${fmtDate(s.date, true)}<br>${esc(s.dayName)}</p><ul class="list">`;
  for (const e of s.entries) {
    h += `<li><div class="date">${esc(e.name)}</div>
      <div class="sets">${e.sets.map(fmtSet).join('<br>')}</div></li>`;
  }
  return h + `</ul><button class="btn danger" data-action="del-session" data-id="${s.id}">Dieses Training löschen</button>`;
}

function renderData() {
  return `<div class="card">
      <h2>Deine Daten</h2>
      <p>${data.days.length} Trainingstage · ${data.sessions.length} gespeicherte Trainings</p>
      <p class="hint">Alles wird nur auf diesem Gerät gespeichert. Mach regelmäßig eine Sicherung, z. B. in der Dateien-App oder iCloud Drive.</p>
    </div>
    <button class="btn primary" data-action="export">Sicherung exportieren</button>
    <button class="btn center" data-action="import">Sicherung importieren</button>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
    <p class="hint">Beim Importieren werden die aktuellen Daten durch die Sicherung ersetzt.</p>`;
}

/* ---------- Aktionen ---------- */

function startDay(id) {
  const day = findDay(id);
  const exercises = day.exercises.filter(e => e.name.trim());
  if (!exercises.length) {
    alert('Dieser Trainingstag hat noch keine Übungen. Lege sie unter „Plan“ an.');
    return;
  }
  if (draft && !confirm(`Es läuft bereits ein Training (${draft.dayName}). Verwerfen und neu beginnen?`)) return;

  draft = {
    dayId: day.id,
    dayName: day.name,
    date: new Date().toISOString(),
    entries: exercises.map(ex => {
      const last = lastEntry(ex.name);
      const sets = [];
      for (let i = 0; i < ex.sets; i++) {
        const ls = last && (last.sets[i] || last.sets[last.sets.length - 1]);
        sets.push({
          weight: ls && ls.weight != null ? fmtNum(ls.weight) : '',
          reps: ls && ls.reps != null ? String(ls.reps) : '',
        });
      }
      return { name: ex.name.trim(), sets };
    }),
  };
  saveDraft();
  go('training');
}

function saveTraining() {
  const entries = draft.entries
    .map(en => ({
      name: en.name,
      sets: en.sets
        .map(s => ({ weight: parseNum(s.weight), reps: parseNum(s.reps) }))
        .filter(s => s.weight != null || s.reps != null),
    }))
    .filter(en => en.sets.length);

  if (!entries.length) {
    alert('Es ist noch nichts eingetragen.');
    return;
  }
  data.sessions.push({
    id: uid(),
    dayId: draft.dayId,
    dayName: draft.dayName,
    date: draft.date,
    entries,
  });
  saveData();
  draft = null;
  saveDraft();
  toast('Training gespeichert ✔');
  go('start');
}

async function exportData() {
  const json = JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2);
  const filename = `training-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], filename, { type: 'application/json' });

  // iPhone: Teilen-Menü -> „In Dateien sichern“
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Trainings-Sicherung' });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  // Fallback: normaler Download
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let d;
    try { d = JSON.parse(reader.result); } catch (e) { d = null; }
    if (!isValidData(d)) {
      alert('Diese Datei ist keine gültige Trainings-Sicherung.');
      return;
    }
    if (!confirm(`Sicherung mit ${d.days.length} Trainingstagen und ${d.sessions.length} Trainings laden?\n\nDie aktuellen Daten werden ersetzt.`)) return;
    data = { app: 'trainingsapp', version: 1, days: d.days, sessions: d.sessions };
    saveData();
    toast('Sicherung importiert ✔');
    go('start');
  };
  reader.readAsText(file);
}

function moveExercise(day, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= day.exercises.length) return;
  [day.exercises[i], day.exercises[j]] = [day.exercises[j], day.exercises[i]];
}

const actions = {
  tab: el => go(el.dataset.tab),
  back: () => go(views[current.view].back),
  resume: () => go('training'),
  'start-day': el => startDay(el.dataset.id),

  'tr-add-set': el => {
    const sets = draft.entries[el.dataset.ei].sets;
    const prev = sets[sets.length - 1];
    sets.push(prev ? { ...prev } : { weight: '', reps: '' });
    saveDraft(); render();
  },
  'tr-del-set': el => {
    const sets = draft.entries[el.dataset.ei].sets;
    if (sets.length) sets.pop();
    saveDraft(); render();
  },
  'tr-save': () => saveTraining(),
  'tr-cancel': () => {
    if (!confirm('Training wirklich verwerfen? Die Eingaben gehen verloren.')) return;
    draft = null; saveDraft(); go('start');
  },

  'add-day': () => {
    const day = { id: uid(), name: 'Tag ' + String.fromCharCode(65 + data.days.length % 26), exercises: [] };
    data.days.push(day);
    saveData();
    go('day', { id: day.id });
  },
  'open-day': el => go('day', { id: el.dataset.id }),
  'del-day': () => {
    const day = findDay(current.params.id);
    if (!confirm(`„${day.name}“ löschen? Bereits gespeicherte Trainings bleiben im Verlauf.`)) return;
    data.days = data.days.filter(d => d !== day);
    saveData(); go('plan');
  },
  'add-ex': () => {
    findDay(current.params.id).exercises.push({ id: uid(), name: '', sets: 3 });
    saveData(); render();
    const inputs = $view.querySelectorAll('[data-field="ex-name"]');
    inputs[inputs.length - 1].focus();
  },
  'ex-del': el => {
    const day = findDay(current.params.id);
    const ex = day.exercises[el.dataset.i];
    if (ex.name.trim() && !confirm(`„${ex.name}“ aus dem Plan entfernen?`)) return;
    day.exercises.splice(el.dataset.i, 1);
    saveData(); render();
  },
  'ex-up': el => { moveExercise(findDay(current.params.id), +el.dataset.i, -1); saveData(); render(); },
  'ex-down': el => { moveExercise(findDay(current.params.id), +el.dataset.i, 1); saveData(); render(); },
  'sets-minus': el => {
    const ex = findDay(current.params.id).exercises[el.dataset.i];
    ex.sets = Math.max(1, ex.sets - 1);
    saveData(); render();
  },
  'sets-plus': el => {
    const ex = findDay(current.params.id).exercises[el.dataset.i];
    ex.sets = Math.min(20, ex.sets + 1);
    saveData(); render();
  },

  'open-exercise': el => go('exercise', { name: el.dataset.name }),
  'open-session': el => go('session', { id: el.dataset.id }),
  'del-session': el => {
    if (!confirm('Dieses Training endgültig löschen?')) return;
    data.sessions = data.sessions.filter(s => s.id !== el.dataset.id);
    saveData(); toast('Training gelöscht'); go('history');
  },

  export: () => exportData(),
  import: () => document.getElementById('import-file').click(),
};

// Eingabefelder schreiben direkt in die Daten (ohne neu zu zeichnen)
const fields = {
  'day-name': el => { findDay(current.params.id).name = el.value; saveData(); },
  'ex-name': el => { findDay(current.params.id).exercises[el.dataset.i].name = el.value; saveData(); },
  'tr-weight': el => { draft.entries[el.dataset.ei].sets[el.dataset.si].weight = el.value; saveDraft(); },
  'tr-reps': el => { draft.entries[el.dataset.ei].sets[el.dataset.si].reps = el.value; saveDraft(); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) actions[el.dataset.action](el);
});

document.addEventListener('input', e => {
  const el = e.target.closest('[data-field]');
  if (el && fields[el.dataset.field]) fields[el.dataset.field](el);
});

document.addEventListener('change', e => {
  if (e.target.id === 'import-file' && e.target.files[0]) {
    importData(e.target.files[0]);
    e.target.value = '';
  }
});

// Beim Antippen eines Feldes den Inhalt markieren -> einfach überschreiben
document.addEventListener('focusin', e => {
  if (e.target.matches('.setgrid input')) setTimeout(() => e.target.select(), 0);
});

/* ---------- Start ---------- */

render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* z. B. ohne HTTPS */ });
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
