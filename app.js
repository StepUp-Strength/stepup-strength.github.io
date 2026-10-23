'use strict';

/* ---------- Speicher (localStorage) ---------- */

const STORE_KEY = 'trainingsapp-daten';
const DRAFT_KEY = 'trainingsapp-entwurf';

let data = loadData();
let draft = loadDraft();          // laufendes, noch nicht gespeichertes Training
let current = { view: 'start', params: {} };

function emptyData() {
  return { app: 'trainingsapp', version: 1, days: [], sessions: [], bodyweight: [], cycle: null };
}

function isValidData(d) {
  return d && Array.isArray(d.days) && Array.isArray(d.sessions);
}

// Fehlende Felder ergänzen (z. B. bei Daten aus einer älteren App-Version)
function withDefaults(ex) {
  if (ex.sets == null) ex.sets = 3;
  if (ex.reps == null) ex.reps = 10;      // Ziel-Wiederholungen pro Satz
  if (ex.rir == null) ex.rir = 2;         // Ziel: Wiederholungen im Tank
  if (ex.max10 === undefined) ex.max10 = null;  // max. kg bei 10 Wdh.
  if (ex.step === undefined) ex.step = null;    // Steigerung in kg, null = automatisch
  return ex;
}

function upgradeData(d) {
  d.days.forEach(day => day.exercises.forEach(withDefaults));
  if (!Array.isArray(d.bodyweight)) d.bodyweight = [];  // [{ id, date, kg }]
  // Periodisierung: buildWeeks Aufbauwochen ab start (Montag), danach 1 Deload-Woche
  if (!d.cycle) d.cycle = { buildWeeks: 5, start: mondayISO(new Date()) };
  return d;
}

function loadData() {
  try {
    const d = JSON.parse(localStorage.getItem(STORE_KEY));
    if (isValidData(d)) return upgradeData(d);
  } catch (e) { /* leer oder defekt -> neu anfangen */ }
  return upgradeData(emptyData());
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
  const tank = s.rir != null ? ` · Tank ${s.rir}` : '';
  if (s.weight == null) return `${s.reps} Wdh.${tank}`;
  if (s.reps == null) return `${fmtNum(s.weight)} kg`;
  return `${fmtNum(s.weight)} kg × ${s.reps}${tank}`;
}

function sessionsNewestFirst() {
  // reverse() zuerst, damit bei gleicher Uhrzeit das zuletzt gespeicherte vorne steht
  return [...data.sessions].reverse().sort((a, b) => b.date.localeCompare(a.date));
}

// Letzter Eintrag einer Übung (über alle Trainingstage, per Name)
function lastEntry(name) {
  const k = nameKey(name);
  for (const s of sessionsNewestFirst()) {
    const e = s.entries.find(en => nameKey(en.name) === k);
    if (e) return { date: s.date, dayName: s.dayName, sets: e.sets, result: e.result };
  }
  return null;
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { $toast.hidden = true; }, 2200);
}

/* ---------- Progression ---------- */

// Faustregel: 1 Wdh. mehr oder weniger bis zum Versagen ≈ 2,5 % Gewicht.
// repFactor(n) = Anteil vom „Max. bei 10 Wdh.“, mit dem man n Wdh. bis zum Versagen schafft.
const repFactor = n => Math.max(0.5, 1 - 0.025 * (n - 10));

const DUMBBELL = /kurzhantel|konzentrationscurls|arnold press|goblet/;
const stepFor = ex => ex.step != null ? ex.step : (DUMBBELL.test(norm(ex.name)) ? 2 : 2.5);

const round2 = x => Math.round(x * 100) / 100;
const roundTo = (w, step, fn = Math.round) => round2(fn(w / step) * step);

// Startgewicht aus „Max. bei 10 Wdh.“ und den Zielvorgaben
function targetWeight(t) {
  if (t.max10 == null) return null;
  return roundTo(t.max10 * repFactor(t.reps + t.rir), t.step);
}

// Nach einem Satz: Abweichung vom Ziel (in Wdh.) und passendes Gewicht für den nächsten Satz
function adjustAfterSet(weight, reps, rir, t) {
  const diff = (reps + rir) - (t.reps + t.rir);
  const raw = Math.min(weight * 1.05, Math.max(weight * 0.9,
    weight * repFactor(t.reps + t.rir) / repFactor(reps + rir)));
  let w = roundTo(raw, t.step);
  if (w > weight * 1.05) w = roundTo(raw, t.step, Math.floor);
  return { diff, weight: w };
}

// Nach dem Training: Gewicht fürs nächste Mal, gemessen am ersten Satz
function progression(first, t, prev) {
  const rir = first.rir != null ? first.rir : t.rir;
  const { diff, weight } = adjustAfterSet(first.weight, first.reps, rir, t);
  const prevMissed = prev && prev.result && prev.result.diff < 0 && !prev.result.deload;
  let next, deload = false;
  if (diff >= 1) next = Math.max(weight, first.weight + t.step);     // klar übertroffen
  else if (diff >= 0) next = first.weight + t.step;                  // genau erreicht
  else if (prevMissed) { next = roundTo(first.weight * 0.95, t.step, Math.floor); deload = true; }
  else next = first.weight;                                          // verfehlt: halten
  return { diff, next: round2(next), deload };
}

function resultText(r) {
  if (r.diff >= 1) return 'Ziel übertroffen → steigern';
  if (r.diff >= 0) return 'Ziel erreicht → kleiner Schritt hoch';
  if (r.deload) return 'Zweimal verfehlt → Gewicht reduziert';
  return 'Ziel verfehlt → Gewicht halten';
}

// Pro Satz wird man schwächer: so viele Wdh. kostet die Ermüdung von Satz zu Satz
const FATIGUE = 1;

// Wdh. bis zum Versagen bei anderem Gewicht (falls man das Gewicht im Folgesatz ändert)
function capacityAt(cap, weight, newWeight) {
  if (!weight || !newWeight || weight === newWeight) return cap;
  const f = repFactor(cap) * newWeight / weight;
  return 10 + (1 - f) / 0.025;
}

const isDone = s => parseNum(s.reps) != null && parseNum(s.rir) != null;

// Weniger Wdh. als das wird nie vorgeschlagen – stattdessen geht das Gewicht runter
const MIN_REPS = 5;

// Vorschlag für einen Satz, k Sätze nach einem Satz mit cap Wdh. bis zum Versagen bei Gewicht w.
// Ohne festes Gewicht wird in Steigerungsschritten reduziert, bis mindestens MIN_REPS Wdh. passen.
// startWeight: Ausgangsgewicht des Satzes (z. B. aus der Vergleichswoche), sonst das Gewicht von w.
function planSet(cap, w, t, k, fixedWeight, startWeight) {
  const repsAt = wt => Math.floor(capacityAt(cap, w, wt) - t.rir - FATIGUE * k + 1e-9);
  if (fixedWeight != null) return { weight: fixedWeight, reps: Math.max(1, repsAt(fixedWeight)) };
  if (w == null) return { weight: null, reps: Math.max(1, repsAt(null)) };  // ohne Gewicht
  let wt = startWeight != null ? startWeight : w;
  while (repsAt(wt) < MIN_REPS && wt - t.step > 0) wt = round2(wt - t.step);
  return { weight: wt, reps: Math.max(1, repsAt(wt)) };
}

// Satzziel laut Plan: Satz 1 = Ziel-Wdh., danach je Satz FATIGUE weniger (mind. MIN_REPS)
const goalReps = (t, i) => Math.max(MIN_REPS, t.reps - FATIGUE * i);

// Nächste Gewichtsstufe, sobald die Leistung (cap Wdh. bis zum Versagen bei w) reicht,
// um mit w + step noch goal Wdh. mit Ziel-Tank (nach k Sätzen Ermüdung) zu schaffen.
function stepUp(cap, w, t, k, goal) {
  if (w == null || !t.step) return null;
  const up = round2(w + t.step);
  const reps = Math.floor(capacityAt(cap, w, up) - t.rir - FATIGUE * k + 1e-9);
  return reps >= goal ? { weight: up, reps } : null;
}

function setInput(field, ei, j, value) {
  const input = $view.querySelector(`[data-field="${field}"][data-ei="${ei}"][data-si="${j}"]`);
  if (!input) return;
  input.value = value;
  input.classList.remove('flash');
  void input.offsetWidth;
  input.classList.add('flash');
}

// Im Training: Wdh. der offenen Sätze aus dem letzten erledigten Satz ableiten.
// Wdh. nächster Satz = (Wdh. + Tank) − Ziel-Tank − Ermüdung; jeder weitere Satz noch 1 weniger.
function recalcSets(ei) {
  const en = draft.entries[ei];
  const t = en.target;
  if (!t) return;
  let last = -1;
  en.sets.forEach((s, i) => { if (isDone(s)) last = i; });
  if (last < 0 || last === en.sets.length - 1) return;

  const done = en.sets[last];
  const cap = parseNum(done.reps) + parseNum(done.rir);
  const w = parseNum(done.weight);
  const tt = { step: 2.5, ...t };
  let first = null;
  for (let j = last + 1; j < en.sets.length; j++) {
    const s = en.sets[j];
    if (!s.auto) continue;  // Wdh. selbst geändert -> Satz nicht mehr anfassen
    // Ausgangsgewicht: aus der Vergleichswoche, aber nie unter dem zuletzt gesteigerten Gewicht
    const start = s.baseWeight != null && w != null ? Math.max(s.baseWeight, w) : s.baseWeight;
    let p = planSet(cap, w, tt, j - last, s.manualWeight ? parseNum(s.weight) : null, start);
    if (!t.deload && !s.manualWeight) {
      // Genug Wdh. über dem Ziel -> nächste Gewichtsstufe für die folgenden Sätze
      const up = stepUp(cap, w, tt, j - last, goalReps(tt, j));
      if (up && (p.weight == null || up.weight > p.weight)) p = up;
    }
    if (t.deload) {
      // Deload: Wdh. nie über das Ziel erhöhen, nur senken, falls es schwerer als DELOAD_RIR war
      const keep = parseNum(s.weight);
      p = {
        weight: p.weight != null && keep != null && p.weight < keep ? p.weight : keep,
        reps: Math.min(p.reps, t.reps),
      };
    }
    if (!first) first = p;
    const weight = p.weight != null ? fmtNum(p.weight) : s.weight;
    if (weight !== s.weight) { s.weight = weight; setInput('tr-weight', ei, j, weight); }
    if (String(p.reps) !== s.reps) { s.reps = String(p.reps); setInput('tr-reps', ei, j, s.reps); }
  }
  if (!first) return;
  en.note = `Satz ${last + 1}: ${cap} Wdh. bis zum Versagen → Satz ${last + 2}: ` +
    (first.weight != null ? `${fmtNum(first.weight)} kg × ` : '') + `${first.reps} Wdh. ` +
    `(${t.rir} im Tank, −${FATIGUE} Ermüdung, mind. ${MIN_REPS} Wdh.)`;
  const note = $view.querySelector(`[data-note="${ei}"]`);
  if (note) { note.textContent = en.note; note.hidden = false; }
}

/* ---------- Periodisierung ---------- */

const WEEK_MS = 7 * 86400000;
const DELOAD_RIR = 3;  // in der Deload-Woche mindestens so viele Wdh. im Tank

// Montag der Woche als JJJJ-MM-TT
function mondayISO(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  return d.toLocaleDateString('sv-SE');
}

const addWeeks = (iso, n) => {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + 7 * n);
  return d.toLocaleDateString('sv-SE');
};

// Wo im Zyklus liegt das Datum? Woche 1..buildWeeks = Aufbau, buildWeeks + 1 = Deload
function cycleInfo(date = new Date()) {
  const c = data.cycle;
  const weeks = Math.round((new Date(mondayISO(date) + 'T12:00:00') - new Date(c.start + 'T12:00:00')) / WEEK_MS);
  const len = c.buildWeeks + 1;
  const future = weeks < 0;
  const n = Math.max(0, weeks);
  const cycle = Math.floor(n / len) + 1;
  const pos = n % len;
  const cycleStart = addWeeks(c.start, (cycle - 1) * len);
  return {
    cycle,
    week: pos + 1,
    buildWeeks: c.buildWeeks,
    deload: !future && pos === c.buildWeeks,
    intro: !future && pos === 0,
    future,
    cycleStart,
    deloadStart: addWeeks(cycleStart, c.buildWeeks),
    nextStart: addWeeks(cycleStart, len),
  };
}

const DELOAD_WEIGHT = 0.8;  // Deload: 20 % weniger Gewicht

// Deload: Volumen halbieren (Sätze), Gewicht −20 %, nie schwerer als DELOAD_RIR im Tank.
// base = normales Ziel, damit man es beim Ersetzen der Übung neu berechnen kann.
const deloadSets = sets => Math.max(1, Math.round(sets / 2));
const introSets = sets => deloadSets(sets) + 1;  // Intro-Woche: ein Satz mehr als im Deload

function deloadTarget(t) {
  const normal = targetWeight(t);
  return {
    ...t,
    sets: deloadSets(t.sets),
    rir: Math.max(t.rir, DELOAD_RIR),
    weight: normal != null ? roundTo(normal * DELOAD_WEIGHT, t.step) : null,
    deload: true,
    base: t,
  };
}

// In welchem Zyklus (Startdatum) und welcher Woche lag ein gespeichertes Training?
function sessionCycle(s) {
  if (s.cycleStart) return { cycleStart: s.cycleStart, week: s.week };
  const c = cycleInfo(new Date(s.date));
  return { cycleStart: c.cycleStart, week: c.week };
}

// Vergleichswoche: dieselbe Woche im vorherigen Zyklus (bevorzugt derselbe Trainingstag)
function comparisonEntry(name, dayId, ci) {
  const k = nameKey(name);
  const cands = data.sessions
    .filter(s => !s.deload)
    .map(s => ({ s, c: sessionCycle(s) }))
    .filter(x => x.c.week === ci.week && x.c.cycleStart < ci.cycleStart)
    .sort((a, b) => b.c.cycleStart.localeCompare(a.c.cycleStart)
      || (b.s.dayId === dayId) - (a.s.dayId === dayId)
      || b.s.date.localeCompare(a.s.date));
  for (const { s } of cands) {
    const e = s.entries.find(en => nameKey(en.name) === k);
    if (e) return { date: s.date, week: ci.week, sets: e.sets };
  }
  return null;
}

// Sätze aus der Vergleichswoche: gleiches Gewicht und je 1 Wdh. mehr –
// außer die damalige Leistung reicht schon für die nächste Gewichtsstufe
function compareSets(cmp, target) {
  const n = target.intro ? target.sets : cmp.sets.length;
  const sets = [];
  for (let i = 0; i < n; i++) {
    const src = cmp.sets[i] || cmp.sets[cmp.sets.length - 1];
    let weight = src.weight;
    let reps = src.reps != null ? src.reps + 1 : target.reps;
    if (src.reps != null && src.weight != null) {
      const cap = src.reps + (src.rir != null ? src.rir : target.rir);
      const up = stepUp(cap, src.weight, { step: 2.5, ...target }, 0, goalReps(target, i));
      if (up) ({ weight, reps } = up);
    }
    sets.push({
      weight: weight != null ? fmtNum(weight) : '',
      reps: String(reps),
      rir: '',
      auto: true,
      baseWeight: weight,  // Ausgangsgewicht für die Anpassung im Training
    });
  }
  return sets;
}

const weekLabel = w => w === 1 ? 'Intro-Woche' : `Woche ${w}`;

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
  if (v.after) v.after(current.params);  // z. B. Diagramm zeichnen, wenn die Breite bekannt ist
}

function cyclePills(ci) {
  let h = '<div class="pills">';
  for (let i = 1; i <= ci.buildWeeks + 1; i++) {
    const deload = i === ci.buildWeeks + 1;
    const state = i === ci.week ? 'now' : i < ci.week ? 'past' : '';
    const cls = deload ? 'dl' : i === 1 ? 'intro' : '';
    h += `<span class="pill ${cls} ${state}">${deload ? 'Deload' : i === 1 ? 'Intro' : i}</span>`;
  }
  return h + '</div>';
}

function cycleCard(ci) {
  const head = ci.future
    ? `Zyklus startet am ${fmtDate(ci.cycleStart)}`
    : ci.deload
      ? `Zyklus ${ci.cycle} · Deload-Woche`
      : `Zyklus ${ci.cycle} · ${weekLabel(ci.week)}${ci.intro ? '' : ` von ${ci.buildWeeks}`}`;
  const sub = ci.deload
    ? `Halbe Sätze, 20 % weniger Gewicht, mind. ${DELOAD_RIR} Wdh. im Tank. Nächster Zyklus ab ${fmtDate(ci.nextStart)}.`
    : ci.intro
      ? `Ein Satz mehr als im Deload. Werte der letzten Intro-Woche, je +1 Wdh. Deload ab ${fmtDate(ci.deloadStart)}.`
      : `Werte derselben Woche im letzten Zyklus, je +1 Wdh. Deload-Woche ab ${fmtDate(ci.deloadStart)}.`;
  return `<div class="card cycle ${ci.deload ? 'is-deload' : ''}">
    <h2>${head}</h2>${cyclePills(ci)}<p class="sub">${sub}</p>
  </div>`;
}

function renderStart() {
  let h = cycleCard(cycleInfo());
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
  let h = draft.deload
    ? `<p class="deload-note">Deload-Woche: halbe Sätze, 20 % weniger Gewicht, nie schwerer als ${DELOAD_RIR} Wdh. im Tank. Keine Steigerung.</p>`
    : draft.intro
      ? '<p class="intro-note">Intro-Woche: ein Satz mehr als im Deload. Vergleich ist die Intro-Woche des letzten Zyklus, je +1 Wdh.</p>'
      : '';
  h += `<p class="sub">${fmtDate(draft.date, true)}<br>Trag nach jedem Satz ein, wie viele Wdh. noch im Tank waren – damit gilt der Satz als erledigt und die Wdh. der folgenden Sätze passen sich an.</p>`;
  draft.entries.forEach((en, ei) => {
    const last = lastEntry(en.name);
    h += `<section class="card">
      <div class="ex-head">
        <h2>${esc(en.name)}</h2>
        <button class="icon-btn swap" data-action="rep-open" data-ei="${ei}">⇄ Ersetzen</button>
      </div>`;
    if (en.replacedFrom) h += `<p class="last">statt ${esc(en.replacedFrom)}</p>`;
    if (en.replacing) h += renderReplace(en, ei);
    if (en.target) {
      const t = en.target;
      h += `<p class="target">Ziel: ${t.sets} × ${t.reps} Wdh. · ${t.rir} im Tank` +
        (t.max10 != null ? `<br><small>Max. bei 10 Wdh.: ${fmtNum(t.max10)} kg</small>` : '') + '</p>';
    }
    if (en.compare) {
      h += `<p class="compare">Vergleich: ${weekLabel(en.compare.week)} im letzten Zyklus (${fmtDate(en.compare.date)})<br>
        ${en.compare.sets.map(fmtSet).join(' · ')}<br><b>Heute: je Satz +1 Wdh. – oder mehr Gewicht, wenn es die Leistung hergibt</b></p>`;
    } else {
      h += last
        ? `<p class="last">Letztes Mal (${fmtDate(last.date)}): ${last.sets.map(fmtSet).join(' · ')}</p>`
        : '<p class="last">Erstes Mal – noch keine Werte.</p>';
    }
    h += `<p class="adjust" data-note="${ei}" ${en.note ? '' : 'hidden'}>${esc(en.note)}</p>`;
    h += '<div class="setgrid"><span></span><span class="head">kg</span><span class="head">Wdh.</span><span class="head">Tank</span>';
    const tankHint = en.target ? en.target.rir : '–';
    en.sets.forEach((s, si) => {
      h += `<span class="setno">${si + 1}</span>
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="–"
          data-field="tr-weight" data-ei="${ei}" data-si="${si}" value="${esc(s.weight)}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="–"
          data-field="tr-reps" data-ei="${ei}" data-si="${si}" value="${esc(s.reps)}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="${tankHint}"
          class="tank" data-field="tr-rir" data-ei="${ei}" data-si="${si}" value="${esc(s.rir)}">`;
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

function renderReplace(en, ei) {
  const t = en.target;
  return `<div class="replace">
    <p class="lbl">Ersatzübung</p>
    <input class="inp" type="text" data-field="rep-name" data-ei="${ei}"
      autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Übung eintippen …">
    <div class="suggest" hidden></div>
    <label class="row">
      <span>Max. kg bei 10 Wdh.</span>
      <input class="inp kg" type="text" inputmode="decimal" autocomplete="off"
        data-field="rep-max" data-ei="${ei}" placeholder="kg">
    </label>
    ${t ? `<p class="hint">Übernimmt das Ziel: ${t.sets} × ${t.reps} Wdh. · ${t.rir} im Tank. Der Plan bleibt unverändert.</p>` : ''}
    <div class="row">
      <button class="btn" data-action="rep-cancel" data-ei="${ei}">Abbrechen</button>
      <button class="btn primary" data-action="rep-ok" data-ei="${ei}">Ersetzen</button>
    </div>
  </div>`;
}

function renderPlan() {
  const c = data.cycle;
  let h = `<h2>Periodisierung</h2>
    <div class="card">
      <div class="row" style="margin-top:0">
        <span>Wochen bis Deload<br><small class="hint">inkl. Intro-Woche</small></span>
        <div class="stepper">
          <button data-action="cycle-weeks" data-delta="-1" aria-label="Weniger Wochen">−</button>
          <b>${c.buildWeeks}</b>
          <button data-action="cycle-weeks" data-delta="1" aria-label="Mehr Wochen">+</button>
        </div>
      </div>
      <label class="row"><span>Zyklus-Start</span>
        <input class="inp date" type="date" data-field="cycle-start" value="${c.start}"></label>
      <p class="hint">Danach folgt automatisch 1 Deload-Woche: halbe Sätze, 20 % weniger Gewicht, nie schwerer als ${DELOAD_RIR} Wdh. im Tank, keine Steigerung. Anschließend beginnt der nächste Zyklus.</p>
      ${cyclePills(cycleInfo())}
      <div class="row"><button class="btn outline" data-action="cycle-restart">Neuen Zyklus ab dieser Woche</button></div>
    </div>
    <h2>Trainingstage</h2>`;
  if (!data.days.length) {
    h += '<p class="hint">Lege Trainingstage an, z. B. „Tag A – Oberkörper“ und „Tag B – Beine“.</p>';
  }
  for (const day of data.days) {
    const names = day.exercises.map(e => e.name.trim()).filter(Boolean).join(', ');
    h += `<button class="btn" data-action="open-day" data-id="${day.id}">
      ${esc(day.name)}<small>${names ? esc(names) : 'Noch keine Übungen'}</small></button>`;
  }
  h += '<button class="btn center" data-action="add-day">+ Trainingstag hinzufügen</button>';
  if (data.days.length) {
    h += `<p class="hint">Dein Plan ist gespeichert. Tippe einen Tag an, um ihn zu bearbeiten.</p>
      <button class="btn primary" data-action="tab" data-tab="start">Zum Training →</button>`;
  }
  return h;
}

// Grenzen für die Plus/Minus-Felder einer Übung
const LIMITS = { sets: [1, 20], reps: [5, 50], rir: [0, 10] };

function stepperRow(label, prop, i, value) {
  return `<div class="row">
    <span>${label}</span>
    <div class="stepper">
      <button data-action="step" data-prop="${prop}" data-delta="-1" data-i="${i}" aria-label="${label} weniger">−</button>
      <b>${value}</b>
      <button data-action="step" data-prop="${prop}" data-delta="1" data-i="${i}" aria-label="${label} mehr">+</button>
    </div>
  </div>`;
}

// Im Plan: Werte der Vergleichswoche für die aktuelle Zykluswoche
function planCompare(ex, day) {
  const ci = cycleInfo();
  if (!ex.name.trim() || ci.deload || ci.future) return '';
  const cmp = comparisonEntry(ex.name, day.id, ci);
  if (!cmp) return '';
  return `<p class="compare">Diese Woche (${weekLabel(ci.week)}) – Vergleich letzter Zyklus:<br>
    ${cmp.sets.map(fmtSet).join(' · ')}<br><b>Ziel: je Satz +1 Wdh.</b></p>`;
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
        autocomplete="off" autocorrect="off" spellcheck="false"
        value="${esc(ex.name)}" placeholder="Übung eintippen, z. B. Bank…">
      <div class="suggest" hidden></div>
      ${planCompare(ex, day)}
      ${stepperRow('Sätze', 'sets', i, ex.sets)}
      ${stepperRow('Wdh. pro Satz', 'reps', i, ex.reps)}
      ${stepperRow('Ziel im Tank (RIR)', 'rir', i, ex.rir)}
      <label class="row">
        <span>Max. kg bei 10 Wdh.</span>
        <input class="inp kg ${ex.max10 == null ? 'missing' : ''}" type="text" inputmode="decimal"
          autocomplete="off" data-field="ex-max" data-i="${i}" placeholder="kg"
          value="${ex.max10 == null ? '' : fmtNum(ex.max10)}">
      </label>
      <div class="row">
        <span>Steigerung${ex.step == null ? ' <small class="hint">(auto)</small>' : ''}</span>
        <div class="stepper">
          ${[2, 2.5].map(v => `<button class="toggle ${stepFor(ex) === v ? 'on' : ''}"
            data-action="set-step" data-i="${i}" data-v="${v}">${fmtNum(v)} kg</button>`).join('')}
        </div>
      </div>
      <div class="row">
        <button class="icon-btn" data-action="ex-up" data-i="${i}" aria-label="Nach oben">↑</button>
        <button class="icon-btn" data-action="ex-down" data-i="${i}" aria-label="Nach unten">↓</button>
        <button class="icon-btn danger" data-action="ex-del" data-i="${i}">Entfernen</button>
      </div>
    </div>`;
  });
  h += `<button class="btn center" data-action="add-ex">+ Übung hinzufügen</button>
    <button class="btn primary" data-action="day-done">✔ Fertig</button>
    <p class="hint">Änderungen werden automatisch gespeichert. „Max. kg bei 10 Wdh.“ wird nach jedem Training automatisch angepasst. Steigerung: Kurzhantel-Übungen 2 kg, alle anderen 2,5 kg – antippen zum Ändern.</p>
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
      ${fmtDate(s.date)}<small>${esc(s.dayName)} · ${s.entries.length} Übungen${s.deload ? ' · Deload' : ''}</small></button>`;
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
  let h = `<p class="sub">${fmtDate(s.date, true)}<br>${esc(s.dayName)}${s.deload ? ' · Deload-Woche (keine Steigerung)' : ''}</p><ul class="list">`;
  for (const e of s.entries) {
    const res = e.result
      ? `<div class="result">${resultText(e.result)}<br>Nächstes Mal: <b>${fmtNum(e.result.next)} kg</b></div>`
      : '';
    const instead = e.replacedFrom ? ` <small>statt ${esc(e.replacedFrom)}</small>` : '';
    h += `<li><div class="date">${esc(e.name)}${instead}</div>
      <div class="sets">${e.sets.map(fmtSet).join('<br>')}</div>${res}</li>`;
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

  const ci = cycleInfo();
  draft = {
    dayId: day.id,
    dayName: day.name,
    date: new Date().toISOString(),
    deload: ci.deload,
    intro: ci.intro,
    cycleStart: ci.cycleStart,
    week: ci.week,
    entries: [],
  };
  // erst nach dem Anlegen von draft, weil setupEntry die Zykluswoche aus draft liest
  draft.entries = exercises.map(ex => {
    const en = { name: ex.name.trim() };
    setupEntry(en, { sets: ex.sets, reps: ex.reps, rir: ex.rir, max10: ex.max10, step: stepFor(ex) });
    return en;
  });
  saveDraft();
  go('training');
}

// Ziel und vorgeschlagene Sätze einer Übung je nach Zykluswoche festlegen:
// Deload -> halbiert & leichter; sonst Werte der Vergleichswoche + 1 Wdh., falls vorhanden
function setupEntry(en, target) {
  en.plan = target;
  if (draft.deload) target = deloadTarget(target);
  else if (draft.intro) target = { ...target, sets: introSets(target.sets), intro: true };
  const cmp = draft.deload ? null : comparisonEntry(en.name, draft.dayId, draft);
  en.target = target;
  en.compare = cmp;
  en.sets = cmp ? compareSets(cmp, target) : buildSets(en.name, target);
  if (cmp) en.target = { ...target, sets: en.sets.length };
  en.note = null;
}

// Vorgeschlagene Sätze für den Trainingsstart
function buildSets(name, target) {
  // Gewicht aus der Progression; ohne Max.-Wert das Gewicht vom letzten Mal
  const last = lastEntry(name);
  const tw = target.deload ? target.weight : targetWeight(target);
  const sets = [];
  for (let i = 0; i < target.sets; i++) {
    const ls = last && (last.sets[i] || last.sets[last.sets.length - 1]);
    const lw = ls && ls.weight != null ? ls.weight : null;
    const w = tw != null ? tw
      : lw != null && target.deload ? roundTo(lw * DELOAD_WEIGHT, target.step || 2.5) : lw;
    if (target.deload) {
      // Deload: gleiche Wdh. in allen Sätzen, das leichtere Gewicht reicht als Entlastung
      sets.push({ weight: w != null ? fmtNum(w) : '', reps: String(target.reps), rir: '', auto: true });
      continue;
    }
    // Ziel-Wdh. gelten für Satz 1, danach je Satz 1 Wdh. weniger (Ermüdung), mind. MIN_REPS
    const p = i === 0 ? { weight: w, reps: target.reps } : planSet(target.reps + target.rir, w, target, i);
    sets.push({ weight: p.weight != null ? fmtNum(p.weight) : '', reps: String(p.reps), rir: '', auto: true });
  }
  return sets;
}

const planExercise = name => {
  for (const d of data.days) {
    const ex = d.exercises.find(e => nameKey(e.name) === nameKey(name));
    if (ex) return ex;
  }
  return null;
};

// Bekanntes „Max. bei 10 Wdh.“: aus dem Plan, sonst aus dem letzten Training dieser Übung
function knownMax10(name) {
  const ex = planExercise(name);
  if (ex && ex.max10 != null) return ex.max10;
  const last = lastEntry(name);
  return last && last.result && last.result.max10 != null ? last.result.max10 : null;
}

// Übung im laufenden Training gegen eine andere tauschen (Plan bleibt unverändert)
function replaceExercise(en, name, max10) {
  const original = en.replacedFrom || en.name;
  const ex = planExercise(name);
  const plan = en.plan || en.target;  // Ziel laut Plan (ohne Deload-/Intro-Anpassung)
  en.name = name;
  en.replacedFrom = nameKey(name) === nameKey(original) ? null : original;
  setupEntry(en, { sets: plan.sets, reps: plan.reps, rir: plan.rir, max10, step: stepFor(ex || { name, step: null }) });
}

function saveTraining() {
  const entries = draft.entries
    .map(en => ({
      name: en.name,
      ...(en.replacedFrom ? { replacedFrom: en.replacedFrom } : {}),
      target: en.target,
      // Nur Sätze, die man angefasst hat – unveränderte Vorschläge zählen nicht als erledigt
      sets: en.sets
        .filter(s => s.touched)
        .map(s => ({ weight: parseNum(s.weight), reps: parseNum(s.reps), rir: parseNum(s.rir) }))
        .filter(s => s.weight != null || s.reps != null),
    }))
    .filter(en => en.sets.length);

  if (!entries.length) {
    alert('Es ist noch nichts eingetragen.');
    return;
  }

  // Progression berechnen und „Max. bei 10 Wdh.“ im Plan aktualisieren (nicht in der Deload-Woche)
  for (const en of draft.deload ? [] : entries) {
    const first = en.sets[0];
    if (!en.target || first.weight == null || first.reps == null || first.rir == null) continue;
    const t = { step: 2.5, ...en.target };
    en.result = progression(first, t, lastEntry(en.name));
    const max10 = Math.round(en.result.next / repFactor(t.reps + t.rir) * 10) / 10;
    en.result.max10 = max10;  // auch für Ersatzübungen, die nicht im Plan stehen
    for (const day of data.days) {
      for (const ex of day.exercises) if (nameKey(ex.name) === nameKey(en.name)) ex.max10 = max10;
    }
  }

  const session = { id: uid(), dayId: draft.dayId, dayName: draft.dayName, date: draft.date, entries };
  if (draft.deload) session.deload = true;
  if (draft.cycleStart) Object.assign(session, { cycleStart: draft.cycleStart, week: draft.week });
  data.sessions.push(session);
  saveData();
  draft = null;
  saveDraft();
  toast('Training gespeichert ✔');
  go('session', { id: session.id });
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
    data = upgradeData({
      app: 'trainingsapp', version: 1,
      days: d.days, sessions: d.sessions, bodyweight: d.bodyweight, cycle: d.cycle,
    });
    saveData();
    toast('Sicherung importiert ✔');
    go('start');
  };
  reader.readAsText(file);
}

/* ---------- Übungs-Vorschläge ---------- */

// Kleinbuchstaben ohne Umlaute, damit „drucken“ auch „drücken“ findet
const norm = s => String(s).toLowerCase()
  .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');

function ownExerciseNames() {
  const names = data.days.flatMap(d => d.exercises.map(e => e.name));
  for (const s of data.sessions) for (const e of s.entries) names.push(e.name);
  return names.map(n => n.trim()).filter(Boolean);
}

function suggestions(query, pool) {
  const q = norm(query).trim();
  if (!q) return [];
  const qWords = q.split(/[^a-z0-9]+/).filter(Boolean);
  const own = new Set(ownExerciseNames().map(nameKey));

  const seen = new Set();
  const hits = [];
  for (const name of pool || [...ownExerciseNames(), ...EXERCISES]) {
    const k = nameKey(name);
    if (seen.has(k)) continue;
    seen.add(k);
    const n = norm(name);
    if (n === q) continue;
    const words = n.split(/[^a-z0-9]+/);
    // Jedes eingetippte Wort muss ein Wortanfang sein (ab 3 Buchstaben auch Wortteil)
    const match = qWords.every(qw => words.some(w => w.startsWith(qw)) || (qw.length >= 3 && n.includes(qw)));
    if (match) hits.push({ name, own: own.has(k), start: n.startsWith(q) });
  }
  hits.sort((a, b) => (b.own - a.own) || (b.start - a.start) || a.name.localeCompare(b.name, 'de'));
  return hits.slice(0, 12);
}

function showSuggestions(input, pool) {
  const box = input.nextElementSibling;
  const list = suggestions(input.value, pool);
  box.innerHTML = list.map(s => `<button type="button" data-action="pick"
    data-name="${esc(s.name)}">${esc(s.name)}${s.own ? ' <small>★</small>' : ''}</button>`).join('');
  box.hidden = !list.length;
}

// Beim Ersetzen: bekanntes Max.-Gewicht der gewählten Übung eintragen
function fillReplaceMax(input) {
  const maxInput = input.closest('.replace').querySelector('[data-field="rep-max"]');
  const m = knownMax10(input.value);
  maxInput.value = m != null ? fmtNum(m) : '';
  maxInput.classList.toggle('missing', m == null);
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
    const t = draft.entries[el.dataset.ei].target;
    const prevReps = prev ? parseNum(prev.reps) : null;
    sets.push({
      weight: prev ? prev.weight : '',
      reps: prevReps != null ? String(Math.max(1, prevReps - FATIGUE)) : (t ? String(t.reps) : ''),
      rir: '',
      auto: true,
    });
    recalcSets(+el.dataset.ei);
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
  'day-done': () => {
    const missing = findDay(current.params.id).exercises.filter(e => e.name.trim() && e.max10 == null);
    if (missing.length && !confirm(
      `Bei ${missing.length === 1 ? '1 Übung' : missing.length + ' Übungen'} fehlt noch „Max. kg bei 10 Wdh.“:\n\n` +
      missing.map(e => '• ' + e.name.trim()).join('\n') +
      '\n\nTrotzdem fertig? (Bei Übungen ohne Gewicht, z. B. Klimmzüge, einfach leer lassen.)'
    )) return;
    toast('Trainingstag gespeichert ✔'); go('plan');
  },
  'del-day': () => {
    const day = findDay(current.params.id);
    if (!confirm(`„${day.name}“ löschen? Bereits gespeicherte Trainings bleiben im Verlauf.`)) return;
    data.days = data.days.filter(d => d !== day);
    saveData(); go('plan');
  },
  'add-ex': () => {
    findDay(current.params.id).exercises.push(withDefaults({ id: uid(), name: '' }));
    saveData(); render();
    const inputs = $view.querySelectorAll('[data-field="ex-name"]');
    inputs[inputs.length - 1].focus();
  },
  pick: el => {
    const box = el.closest('.suggest');
    const input = box.previousElementSibling;
    input.value = el.dataset.name;
    box.hidden = true;
    input.blur();
    if (input.dataset.field === 'ex-name') {
      findDay(current.params.id).exercises[input.dataset.i].name = el.dataset.name;
      saveData();
    } else if (input.dataset.field === 'chart-name') {
      showChartFor(el.dataset.name);
    } else {
      fillReplaceMax(input);
    }
  },

  'rep-open': el => {
    draft.entries.forEach((en, i) => { en.replacing = i === +el.dataset.ei && !en.replacing; });
    render();
    const input = $view.querySelector(`[data-field="rep-name"][data-ei="${el.dataset.ei}"]`);
    if (input) input.focus();
  },
  'rep-cancel': el => { draft.entries[el.dataset.ei].replacing = false; render(); },
  'rep-ok': el => {
    const en = draft.entries[el.dataset.ei];
    const panel = el.closest('.replace');
    const name = panel.querySelector('[data-field="rep-name"]').value.trim();
    if (!name) { alert('Bitte eine Ersatzübung eingeben.'); return; }
    if (en.sets.some(s => s.touched) && !confirm('Bereits eingetragene Sätze dieser Übung gehen verloren. Trotzdem ersetzen?')) return;
    replaceExercise(en, name, parseNum(panel.querySelector('[data-field="rep-max"]').value));
    en.replacing = false;
    saveDraft(); render();
    toast(`Ersetzt durch ${name}`);
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
  'cycle-weeks': el => {
    data.cycle.buildWeeks = Math.min(6, Math.max(4, data.cycle.buildWeeks + Number(el.dataset.delta)));
    saveData(); render();
  },
  'cycle-restart': () => {
    if (!confirm('Neuen Zyklus ab dieser Woche beginnen? Diese Woche wird dann Aufbauwoche 1.')) return;
    data.cycle.start = mondayISO(new Date());
    saveData(); render();
    toast('Neuer Zyklus gestartet');
  },
  'set-step': el => {
    findDay(current.params.id).exercises[el.dataset.i].step = Number(el.dataset.v);
    saveData(); render();
  },
  step: el => {
    const ex = findDay(current.params.id).exercises[el.dataset.i];
    const prop = el.dataset.prop;
    const [min, max] = LIMITS[prop];
    ex[prop] = Math.min(max, Math.max(min, ex[prop] + Number(el.dataset.delta)));
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
  'ex-max': el => {
    const ex = findDay(current.params.id).exercises[el.dataset.i];
    ex.max10 = parseNum(el.value);
    el.classList.toggle('missing', ex.max10 == null);
    saveData();
  },
  'ex-name': el => {
    findDay(current.params.id).exercises[el.dataset.i].name = el.value;
    saveData();
    showSuggestions(el);
  },
  'rep-name': el => { showSuggestions(el); fillReplaceMax(el); },
  'cycle-start': el => {
    if (!el.value) return;
    data.cycle.start = mondayISO(el.value + 'T12:00:00');  // immer auf den Montag dieser Woche
    saveData(); render();
  },
  'tr-weight': el => {
    const s = draft.entries[el.dataset.ei].sets[el.dataset.si];
    s.weight = el.value;
    s.manualWeight = true;  // selbst gewähltes Gewicht -> nur noch Wdh. anpassen
    s.touched = true;
    recalcSets(+el.dataset.ei);
    saveDraft();
  },
  'tr-reps': el => {
    const s = draft.entries[el.dataset.ei].sets[el.dataset.si];
    s.reps = el.value;
    s.auto = false;  // selbst geändert -> nicht mehr automatisch überschreiben
    s.touched = true;
    recalcSets(+el.dataset.ei);
    saveDraft();
  },
  'tr-rir': el => {
    const s = draft.entries[el.dataset.ei].sets[el.dataset.si];
    s.rir = el.value;
    s.touched = true;
    recalcSets(+el.dataset.ei);
    saveDraft();
  },
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

// Vorschlag antippen, ohne dass das Eingabefeld vorher den Fokus verliert
document.addEventListener('pointerdown', e => {
  if (e.target.closest('.suggest')) e.preventDefault();
});

// Vorschläge schließen, wenn man das Feld verlässt
document.addEventListener('focusout', e => {
  const f = e.target.dataset && e.target.dataset.field;
  if (f === 'ex-name' || f === 'rep-name' || f === 'chart-name') {
    const box = e.target.nextElementSibling;
    setTimeout(() => { box.hidden = true; }, 200);
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
