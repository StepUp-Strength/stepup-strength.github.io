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
  return d && Array.isArray(d.sessions) && (Array.isArray(d.plans) || Array.isArray(d.days));
}

// Fehlende Felder ergänzen (z. B. bei Daten aus einer älteren App-Version)
function withDefaults(ex) {
  if (ex.sets == null) ex.sets = 3;          // Sätze in der Intro-Woche
  if (ex.setsEnd == null) ex.setsEnd = ex.sets;  // Sätze in der letzten Trainingswoche
  if (ex.reps == null) ex.reps = 10;      // Ziel-Wiederholungen pro Satz
  if (ex.rir == null) ex.rir = 2;         // Ziel: Wiederholungen im Tank
  if (ex.max10 === undefined) ex.max10 = null;  // max. kg bei 10 Wdh.
  if (ex.step === undefined) ex.step = null;    // Steigerung in kg, null = automatisch
  if (ex.variant === undefined) ex.variant = '';  // Standard-Ausführung: '', 'pause', 'slow'
  if (ex.kind === undefined) ex.kind = null;      // Übungsart, null = automatisch aus dem Namen
  if (ex.group === undefined) ex.group = null;    // Muskelgruppe, null = automatisch aus dem Namen
  return ex;
}

/* Mehrere Pläne: data.plans = [{ id, name, days, volume, rirPlan, endedAt? }], data.activePlanId.
   data.days / data.volume / data.rirPlan zeigen immer auf den aktiven Plan (nicht mitgespeichert).
   activePlanId = null: kein Plan aktiv (z. B. nach „Plan beenden“) – dann gilt ein leerer Platzhalter-Plan. */
function activePlan(d = data) {
  return d.plans.find(p => p.id === d.activePlanId)
    || activePlan.none || (activePlan.none = { ...newPlan('Kein aktiver Plan'), none: true });
}
const hasActivePlan = () => !activePlan().none;

function newPlan(name, days = []) {
  return {
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, days, volume: defaultVolume(), rirPlan: {},
    progression: { volume: true, load: true }, weekProgression: {}, perWeek: 1,
  };
}

function bindPlanAccessors(d) {
  for (const key of ['days', 'volume', 'rirPlan']) {
    Object.defineProperty(d, key, {
      configurable: true,
      enumerable: false,
      get: () => activePlan(d)[key],
      set: v => { activePlan(d)[key] = v; },
    });
  }
}

function upgradeData(d) {
  // ältere Daten: ein einzelner Plan direkt in d -> als „Mein Plan“ übernehmen
  if (!Array.isArray(d.plans)) {
    const p = newPlan('Mein Plan', d.days || []);
    if (d.volume) p.volume = d.volume;
    if (d.rirPlan) p.rirPlan = d.rirPlan;
    d.plans = [p];
    d.activePlanId = p.id;
  }
  delete d.days; delete d.volume; delete d.rirPlan;
  if (!d.plans.length) d.plans.push(newPlan('Mein Plan'));
  for (const p of d.plans) {
    if (!Array.isArray(p.days)) p.days = [];
    p.days.forEach(day => day.exercises.forEach(withDefaults));
    if (!p.volume) p.volume = defaultVolume();  // Sätze pro Muskelgruppe und Training
    if (!p.rirPlan) p.rirPlan = {};             // Muskelgruppe -> Tank-Ziel je Woche (normale Übungen)
    // Progression: Grundeinstellung (ganzer Zyklus) und Abweichungen einzelner Wochen (Montag -> { volume, load })
    if (!p.progression) p.progression = { volume: true, load: true };
    if (!p.weekProgression) p.weekProgression = {};
    if (!p.volExtra) p.volExtra = {};  // Muskelgruppe -> [Intro…W4]: so viele Tage bekommen 1 Satz mehr
    if (![1, 2].includes(p.perWeek)) p.perWeek = 1;  // wie oft jeder Trainingstag pro Woche absolviert wird
  }
  // null = bewusst kein Plan aktiv; fehlt die Angabe (ältere Daten) oder gibt es den Plan nicht mehr -> erster Plan
  if (d.activePlanId !== null && !d.plans.some(p => p.id === d.activePlanId)) d.activePlanId = d.plans[0].id;
  bindPlanAccessors(d);

  if (!Array.isArray(d.bodyweight)) d.bodyweight = [];  // [{ id, date, kg }]
  if (!Array.isArray(d.steps)) d.steps = [];            // [{ date: JJJJ-MM-TT, steps }]
  if (!Array.isArray(d.complaints)) d.complaints = [];  // [{ cycleStart, date, areas: [...] }], einmal pro Zyklus
  if (!d.hintsDismissed) d.hintsDismissed = {};         // Übung -> Zyklus, in dem der Stillstand-Hinweis weggeklickt wurde
  if (!Array.isArray(d.dayTemplates)) d.dayTemplates = [];  // selbst erstellte Trainingstage: [{ id, name, intensity, groups }]
  // Periodisierung: buildWeeks Aufbauwochen ab start (Montag), danach 1 Deload-Woche
  if (!d.cycle) d.cycle = { buildWeeks: 4, start: mondayISO(new Date()) };
  d.cycle.buildWeeks = Math.min(5, Math.max(4, d.cycle.buildWeeks));  // 4–5 Trainingswochen
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

// Tonnage = Summe aus Gewicht × Wiederholungen aller Sätze (Sätze ohne Gewicht zählen nicht)
const setsTonnage = sets => sets.reduce((a, x) => a + (x.weight != null && x.reps != null ? x.weight * x.reps : 0), 0);
const sessionTonnage = s => s.entries.reduce((sum, e) => sum + setsTonnage(e.sets), 0);

// 850 kg / 12,4 t / 1.234,5 t
const fmtTons = kg => kg >= 1000
  ? `${(Math.round(kg / 100) / 10).toLocaleString('de-DE')} t`
  : `${Math.round(kg).toLocaleString('de-DE')} kg`;

function fmtSet(s) {
  const tank = (s.rir != null ? ` · Tank ${fmtNum(s.rir)}` : '') + (s.variant ? ` · ${VARIANTS[s.variant]}` : '');
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

/* ---------- Erfolgs-Mitteilung ---------- */

// Neue Erfolge erscheinen nacheinander oben als Mitteilung (wie eine Push-Mitteilung). Nach oben wischen
// schließt sie, Antippen öffnet die Erfolge, sonst verschwindet sie nach einigen Sekunden.
const notifyQueue = [];
let notifyBusy = false;

function celebrate(list) {
  if (!list || !list.length) return;
  notifyQueue.push(...list);
  if (!notifyBusy) nextNotify();
}

function nextNotify() {
  const a = notifyQueue.shift();
  if (!a) { notifyBusy = false; return; }
  notifyBusy = true;
  const more = notifyQueue.length;
  const sparks = Array.from({ length: 14 }, (_, i) => {
    const ang = (i / 14) * Math.PI * 2;
    const dist = 34 + (i % 3) * 12;
    return `<i class="spark" style="--dx:${Math.round(Math.cos(ang) * dist)}px;--dy:${Math.round(Math.sin(ang) * dist)}px;--d:${(i % 4) * 40}ms"></i>`;
  }).join('');
  const el = document.createElement('div');
  el.className = 'notify';
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="notify-icon">${a.icon}${sparks}</div>
    <div class="notify-body">
      <div class="notify-head"><span>🏆 Neuer Erfolg</span><span>jetzt</span></div>
      <b>${esc(a.name)}</b><small>${esc(a.desc)}</small>
      ${more ? `<small class="notify-more">+ ${more} weitere${more === 1 ? 'r' : ''}</small>` : ''}
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  if (navigator.vibrate) navigator.vibrate([30, 50, 30]);

  let gone = false;
  const close = () => {
    if (gone) return;
    gone = true;
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => { el.remove(); nextNotify(); }, 420);
  };
  const timer = setTimeout(close, 5000);
  el.addEventListener('click', () => {
    close();
    notifyQueue.length = 0;  // alle anzeigen lassen sich in der Übersicht
    chartState.mode = 'awards';
    go('charts');
  });
  let y0 = null;
  el.addEventListener('touchstart', e => { y0 = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchmove', e => {
    if (y0 != null && e.touches[0].clientY - y0 < -25) { y0 = null; close(); }
  }, { passive: true });
}

// Erfolge, die durch eine Änderung (fn) neu freigeschaltet wurden, als Mitteilung zeigen; liefert sie zurück
function withAwards(fn) {
  const before = unlockedIds();
  fn();
  const fresh = achievementProgress().done.filter(a => !before.has(a.id))
    .map(({ icon, name, desc }) => ({ icon, name, desc }));
  celebrate(fresh);
  return fresh;
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

// Nach dem Training: Gewicht fürs nächste Mal, gemessen am ersten Satz.
// Knapp verfehlt (weniger als MISS_REPS Wdh.) -> halten, deutlich verfehlt -> reduzieren.
function progression(first, t) {
  const rir = first.rir != null ? first.rir : t.rir;
  const { diff, weight } = adjustAfterSet(first.weight, first.reps, rir, t);
  let next, deload = false;
  if (diff >= 1) next = Math.max(weight, first.weight + t.step);     // klar übertroffen
  else if (diff >= 0) next = first.weight + t.step;                  // genau erreicht
  else if (diff <= -MISS_REPS) { next = Math.min(weight, first.weight - t.step); deload = true; }  // deutlich verfehlt
  else next = first.weight;                                          // knapp verfehlt: halten
  return { diff, next: round2(next), deload };
}

function resultText(r) {
  if (r.diff >= 1) return 'Ziel übertroffen → steigern';
  if (r.diff >= 0) return 'Ziel erreicht → kleiner Schritt hoch';
  if (r.deload) return 'Ziel deutlich verfehlt → Gewicht reduziert';
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

// Weniger Wdh. als das wird bei Übungen mit Gewicht nie vorgeschlagen
const MIN_REPS = 5;

// Vorschlag für einen Satz, k Sätze nach einem Satz mit cap Wdh. bis zum Versagen bei Gewicht w.
// startWeight: Ausgangsgewicht des Satzes (z. B. aus der Vergleichswoche), sonst das Gewicht von w.
// keepWeight: Gewicht bleibt (Ziel nur knapp verfehlt) – fehlt dann höchstens 1 Wdh. zu MIN_REPS, wird mit
// etwas weniger Tank gerechnet. Sonst wird in Steigerungsschritten reduziert, bis mindestens MIN_REPS Wdh. passen.
function planSet(cap, w, t, k, fixedWeight, startWeight, keepWeight = false) {
  const repsAt = wt => Math.floor(capacityAt(cap, w, wt) - t.rir - FATIGUE * k + 1e-9);
  if (fixedWeight != null) return { weight: fixedWeight, reps: Math.max(MIN_REPS, repsAt(fixedWeight)) };
  if (w == null) return { weight: null, reps: Math.max(1, repsAt(null)) };  // ohne Gewicht
  let wt = startWeight != null ? startWeight : w;
  if (!keepWeight || repsAt(wt) < MIN_REPS - 1) while (repsAt(wt) < MIN_REPS && wt - t.step > 0) wt = round2(wt - t.step);
  return { weight: wt, reps: Math.max(MIN_REPS, repsAt(wt)) };
}

// Nie weniger als MIN_REPS Wdh.: sonst das Gewicht so weit senken, dass MIN_REPS mit derselben Anstrengung passen
function atLeastMinReps(p, t) {
  if (p.weight == null || p.reps == null || p.reps >= MIN_REPS) return p;
  const step = t.step || 2.5;
  const w = roundTo(p.weight * repFactor(MIN_REPS + t.rir) / repFactor(p.reps + t.rir), step, Math.floor);
  return { weight: Math.max(step, w), reps: MIN_REPS };
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
// Durchschnitt Tank aller erledigten Sätze im Vergleich zum Wochenziel
function avgTankText(en) {
  const done = en.sets.filter(isDone).map(s => parseNum(s.rir));
  if (!done.length || !en.target) return '';
  const avg = Math.round(done.reduce((a, b) => a + b, 0) / done.length * 10) / 10;
  const t = en.target.rir;
  const verdict = Math.abs(avg - t) <= 0.5 ? '✔ im Ziel' : avg > t ? 'leichter als geplant' : 'schwerer als geplant';
  return `Ø Tank bisher: <b>${fmtNum(avg)}</b> (Ziel ${targetRirText(en.target)}) – ${verdict}`;
}

// Bezug ist immer der letzte erledigte Satz derselben Ausführungsvariante.
function recalcSets(ei) {
  const en = draft.entries[ei];
  const t = en.target;
  if (!t) return;
  const avgEl = $view.querySelector(`[data-avg="${ei}"]`);
  if (avgEl) avgEl.innerHTML = avgTankText(en);
  updateNextHints(ei);
  const tt = { step: 2.5, ...t };
  let first = null, firstLast = -1, firstCap = null, firstReduced = false;
  for (let j = 0; j < en.sets.length; j++) {
    const s = en.sets[j];
    if (!s.auto || isDone(s)) continue;  // Wdh. selbst geändert oder schon erledigt -> nicht anfassen
    let last = -1;
    for (let i = j - 1; i >= 0; i--) {
      if (isDone(en.sets[i]) && variantOf(en.sets[i]) === variantOf(s)) { last = i; break; }
    }
    if (last < 0) continue;
    const done = en.sets[last];
    const cap = parseNum(done.reps) + parseNum(done.rir);
    const w = parseNum(done.weight);
    // Ausgangsgewicht: laut Vorschlag – wurde im letzten Satz über den Vorschlag hinaus gesteigert, nie darunter
    const pl = en.planned[last];
    const raised = w != null && pl && pl.weight != null && w > pl.weight;
    const start = raised && s.baseWeight != null ? Math.max(s.baseWeight, w) : s.baseWeight;
    // Abstand des letzten erledigten Satzes zu seinem Vorschlag: erst ab MISS_REPS darunter geht das Gewicht runter
    const d = setDeficit({ weight: w, reps: parseNum(done.reps), rir: parseNum(done.rir) }, en.planned[last], t.rir);
    const missedBig = d != null && d <= -MISS_REPS;
    let p = planSet(cap, w, tt, j - last, s.manualWeight ? parseNum(s.weight) : null, start, !missedBig && !t.deload);
    // ohne Gewichtsprogression bzw. im 2. Training der Woche nie über den Vorschlag hinaus
    const capToPlan = t.hold || !!en.weekFirst;
    if (!t.deload && !capToPlan && !s.manualWeight) {
      // Genug Wdh. über dem Ziel -> nächste Gewichtsstufe für die folgenden Sätze
      const up = stepUp(cap, w, tt, j - last, goalReps(tt, j));
      if (up && (p.weight == null || up.weight > p.weight)) p = up;
    }
    // Letzter erledigter Satz deutlich verfehlt -> Gewicht runter, damit die geplanten Wdh. wieder klappen
    let reduced = false;
    if (!t.deload && !s.manualWeight && w != null) {
      const goal = en.planned[j] && en.planned[j].reps;
      if (missedBig && goal != null) {
        p = weightForGoal(cap, w, tt, j - last, goal);
        reduced = true;
      }
    }
    if (capToPlan && !s.manualWeight) {
      // nie über den Vorschlag hinaus, nur nach unten anpassen
      const pl = en.planned[j] || {};
      if (pl.weight != null && p.weight != null && p.weight > pl.weight) p = planSet(cap, w, tt, j - last, pl.weight);
      if (pl.reps != null) p = { ...p, reps: Math.min(p.reps, pl.reps) };
    }
    if (t.deload) {
      // Deload: Wdh. nie über das Ziel erhöhen, nur senken, falls es schwerer als DELOAD_RIR war
      const keep = parseNum(s.weight);
      p = {
        weight: p.weight != null && keep != null && p.weight < keep ? p.weight : keep,
        reps: Math.min(p.reps, t.reps),
      };
    }
    if (!first) { first = p; firstLast = last; firstCap = cap; firstReduced = reduced; }
    const weight = p.weight != null ? fmtNum(p.weight) : s.weight;
    if (weight !== s.weight) { s.weight = weight; setInput('tr-weight', ei, j, weight); }
    if (String(p.reps) !== s.reps) { s.reps = String(p.reps); setInput('tr-reps', ei, j, s.reps); }
  }
  if (!first) return;
  const last = firstLast, cap = firstCap;
  en.note = `Satz ${last + 1}: ${cap} Wdh. bis zum Versagen → nächster Satz: ` +
    (first.weight != null ? `${fmtNum(first.weight)} kg × ` : '') + `${first.reps} Wdh. ` +
    (firstReduced
      ? `(Ziel um mind. ${MISS_REPS} Wdh. verfehlt → weniger Gewicht statt weniger Wdh.)`
      : `(${fmtNum(t.rir)} im Tank, −${FATIGUE} Ermüdung, mind. ${MIN_REPS} Wdh.)`);
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
// c.begin (optional): erster Trainingsmontag, wenn mitten im Zyklus eingestiegen wird (z. B. mit Woche 3
// oder dem Deload nach einer Pause) – c.start liegt dann entsprechend viele Wochen davor.
// Vor c.begin gilt der Plan als noch nicht gestartet (future) und zeigt die Einstiegswoche.
function cycleInfo(date = new Date()) {
  const c = data.cycle;
  const begin = c.begin && c.begin > c.start ? c.begin : c.start;
  const weeksBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / WEEK_MS);
  const monday = mondayISO(date);
  const len = c.buildWeeks + 1;
  const future = monday < begin;
  const n = weeksBetween(c.start, future ? begin : monday);
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
    begin,
    cycleStart,
    deloadStart: addWeeks(cycleStart, c.buildWeeks),
    nextStart: addWeeks(cycleStart, len),
  };
}

const DELOAD_WEIGHT = 0.8;  // Deload: 20 % weniger Gewicht

// Progression, getrennt schaltbar: volume = mehr Sätze von Woche zu Woche, load = Gewicht/Wdh. steigern.
// Grundeinstellung des Plans (ganzer Zyklus) -> Abweichung einer Woche (Schlüssel: Montag) ->
// Abweichung eines einzelnen Trainings (draft.progression).
const PROG_KEYS = { volume: 'Volumen', load: 'Gewicht & Wdh.' };
const planProgression = (p = activePlan()) => ({ volume: true, load: true, ...p.progression });
const weekProgression = (monday, p = activePlan()) => ({ ...planProgression(p), ...(p.weekProgression || {})[monday] });

// Satz-Woche: ohne Volumenprogression gelten die Sätze der Vorwoche – also die der letzten Woche
// dieses Zyklus mit Volumenprogression (sonst Intro). volumeNow = Einstellung für das aktuelle Training.
function volumeWeek(ci, volumeNow) {
  if (volumeNow) return ci.week;
  for (let w = ci.week - 1; w > 1; w--) if (weekProgression(addWeeks(ci.cycleStart, w - 1)).volume) return w;
  return 1;
}

// Text für ausgeschaltete Progression, z. B. „ohne Volumenprogression“ (leer, wenn alles an)
function progOffText(prog) {
  const off = [!prog.volume && 'Volumen', !prog.load && 'Gewicht & Wdh.'].filter(Boolean);
  return off.length === 2 ? 'ohne Progression' : off.length ? `ohne Progression bei ${off[0]}` : '';
}

const progChip = (key, on, attrs) =>
  `<button class="vchip prog-chip ${on ? 'on' : 'off'}" data-key="${key}" ${attrs}>${on ? '✓' : '✕'} ${PROG_KEYS[key]}</button>`;

// Ziel im Tank pro Trainingswoche (normale Übungen, als Durchschnitt über die Sätze).
// [min, max] = Bereich; gerechnet wird mit der Mitte.
const RIR_PLAN = { 4: [2, 1.5, 1, 0.5], 5: [2, 1.5, 1, 0.5, 0.5] };  // 5. Woche: Option, noch offen

// Übungsart: Grundübungen +1 im Tank, Assistenzübungen −1 (näher ans Muskelversagen)
const KINDS = { compound: 'Grundübung', normal: 'Normal', assist: 'Assistenz' };
const KIND_OFFSET = { compound: 1, normal: 0, assist: -1 };
const COMPOUND = /^(kniebeugen|frontkniebeugen|bankdrucken[^(]*\(langhantel|kreuzheben|schulterdrucken langhantel|rudern langhantel|dips|umsetzen|reissen)/;
const ASSIST = /curls|bizeps|seitheben|frontheben|trizeps|kickbacks|stirndrucken|beinstrecker|beinbeuger|butterfly|fliegende|crossover|wadenheben|face pulls|reverse|crunches|sit-ups|beinheben|knieheben|plank|seitstutz|russian|bauchroller|rotation|holzhacker|shrugs|abduktoren|adduktoren|handgelenk|uberzuge|glute|sissy/;

// Übungsart: selbst gewählt > Übungsliste > Vermutung anhand des Namens
function kindOf(ex) {
  if (ex.kind) return ex.kind;
  const listed = EXERCISE_KINDS.get(nameKey(ex.name || ''));
  if (listed) return listed;
  const n = norm(ex.name || '');
  return COMPOUND.test(n) ? 'compound' : ASSIST.test(n) ? 'assist' : 'normal';
}

// Tank-Ziel als Bereich [min, max] für Übungsart und Woche. Hat die Muskelgruppe eigene Werte
// (data.rirPlan, aus dem Plan-Assistenten), gelten diese als Basis für normale Übungen.
function rirRange(kind, week, buildWeeks, group) {
  const custom = group && data.rirPlan && data.rirPlan[group];
  let base;
  if (custom) {
    base = custom[Math.min(Math.max(week, 1), custom.length) - 1];  // eine 5. Woche übernimmt W4
  } else {
    const plan = RIR_PLAN[buildWeeks] || RIR_PLAN[5];
    base = plan[Math.min(plan.length, Math.max(1, week)) - 1];
  }
  const [lo, hi] = Array.isArray(base) ? base : [base, base];
  const off = KIND_OFFSET[kind || 'normal'];
  return [Math.max(0, lo + off), Math.max(0, hi + off)];
}

const rirFor = (kind, week, buildWeeks, group) => {
  const [lo, hi] = rirRange(kind, week, buildWeeks, group);
  return (lo + hi) / 2;
};

const rirLabel = (kind, week, buildWeeks, group) => {
  const [lo, hi] = rirRange(kind, week, buildWeeks, group);
  return lo === hi ? fmtNum(lo) : `${fmtNum(lo)}–${fmtNum(hi)}`;
};

// Ziel im Tank, wie es angezeigt wird (Bereich statt Mittelwert, im Deload „mind. 3“)
const targetRirText = t => t.deload ? `mind. ${fmtNum(t.rir)}` : (t.rirText || fmtNum(t.rir));

function weekRirText(kind, group) {
  const ci = cycleInfo();
  if (ci.deload) return `Deload – mind. ${DELOAD_RIR}`;
  return `${rirLabel(kind, ci.week, ci.buildWeeks, group)} (${weekLabel(ci.week)})`;
}

function rirTable(buildWeeks) {
  const plan = RIR_PLAN[buildWeeks];
  const ci = cycleInfo();
  const custom = Object.keys(data.rirPlan || {});
  if (custom.length) {
    // eigene Werte pro Muskelgruppe (normale Übungen)
    let h = '<div class="table-wrap"><table class="rir"><tr><th>Tank (normal)</th>' +
      plan.map((_, i) => `<th class="${!ci.deload && ci.week === i + 1 ? 'now' : ''}">${i === 0 ? 'Intro' : 'W' + (i + 1)}</th>`).join('') + '</tr>';
    for (const g of custom) {
      h += `<tr><td>${MUSCLES[g] || g}</td>` + plan.map((_, i) =>
        `<td class="${!ci.deload && ci.week === i + 1 ? 'now' : ''}">${rirLabel('normal', i + 1, buildWeeks, g)}</td>`).join('') + '</tr>';
    }
    return h + `</table></div><p class="hint">Grundübungen +1, Assistenzübungen −1 (nie unter 0). Deload: mind. ${DELOAD_RIR}.</p>`;
  }
  let h = '<div class="table-wrap"><table class="rir"><tr><th>Ziel im Tank</th>';
  plan.forEach((_, i) => { h += `<th class="${!ci.deload && ci.week === i + 1 ? 'now' : ''}">${i === 0 ? 'Intro' : 'W' + (i + 1)}</th>`; });
  h += '<th>Deload</th></tr>';
  for (const [k, label] of Object.entries(KINDS)) {
    h += `<tr><td>${label}</td>` + plan.map((_, i) =>
      `<td class="${!ci.deload && ci.week === i + 1 ? 'now' : ''}">${rirLabel(k, i + 1, buildWeeks)}</td>`).join('') +
      `<td class="${ci.deload ? 'now' : ''}">≥ ${DELOAD_RIR}</td></tr>`;
  }
  return h + '</table></div>';
}

/* ---------- Muskelgruppen, Wochenvolumen & Tag-Typen ---------- */

const MUSCLES = {
  brust: 'Brust', lat: 'Lat', trapez: 'Trapez', schulter_vorne: 'Schulter vorne',
  schulter_seite: 'Schulter seitlich', schulter_hinten: 'Schulter hinten', bizeps: 'Bizeps',
  trizeps: 'Trizeps', unterarme: 'Unterarme', quadrizeps: 'Quadrizeps', beinbeuger: 'Beinbeuger',
  gesaess: 'Gesäß', adduktoren: 'Adduktoren', abduktoren: 'Abduktoren', waden: 'Waden',
  bauch: 'Bauch', ruecken_unten: 'Unterer Rücken', ganzkoerper: 'Ganzkörper', ausdauer: 'Ausdauer',
};

// Standard: Sätze pro Training je Muskelgruppe: Intro, W2, W3, W4 (Deload = Hälfte von W4, aufgerundet).
// Die gültigen Werte stehen in data.volume und lassen sich im Plan ändern.
// (Funktion statt Konstante, weil die Daten schon ganz am Anfang beim Laden ergänzt werden.)
function defaultVolume() {
  return {
    brust: [5, 5, 6, 7], lat: [5, 5, 6, 6], trapez: [2, 2, 3, 3],
    schulter_seite: [2, 3, 3, 4], schulter_hinten: [2, 3, 3, 4], bizeps: [2, 3, 3, 4], trizeps: [2, 3, 3, 4],
    quadrizeps: [5, 5, 6, 7], beinbeuger: [3, 4, 4, 5], waden: [2, 2, 3, 3], bauch: [2, 2, 3, 3],
    adduktoren: [1, 1, 2, 2], abduktoren: [1, 1, 2, 2],
  };
}

const DAY_TYPES = {
  'upper-heavy': 'Oberkörper schwer', 'upper-light': 'Oberkörper leicht',
  'lower-heavy': 'Unterkörper schwer', 'lower-light': 'Unterkörper leicht',
};
const DAY_GROUPS = {
  upper: ['brust', 'lat', 'trapez', 'schulter_seite', 'schulter_hinten', 'bizeps', 'trizeps'],
  lower: ['quadrizeps', 'beinbeuger', 'waden', 'bauch', 'adduktoren', 'abduktoren'],
};

// Wiederholungsbereiche: gestartet wird am unteren Ende
const REP_RANGES = {
  heavy: { compound: [6, 8], normal: [8, 10], assist: [8, 12] },
  light: { compound: [8, 10], normal: [10, 12], assist: [10, 15] },
};

// Muskelgruppe raten, wenn die Übung nicht in der Liste steht (Reihenfolge zählt)
const GROUP_GUESS = [
  [/beinbeug|rumanisch|nordic/, 'beinbeuger'], [/wade/, 'waden'], [/adduktor/, 'adduktoren'], [/abduktor/, 'abduktoren'],
  [/crunch|bauch|sit-up|plank|beinheben|knieheben/, 'bauch'], [/hip thrust|glute|gesass/, 'gesaess'],
  [/kniebeug|beinpresse|beinstreck|ausfall|hack|squat|step-up/, 'quadrizeps'],
  [/rudern.*breit|shrug/, 'trapez'], [/rudern|latzieh|latzug|klimmz|pulldown|uberzug/, 'lat'],
  [/seitheben|y-raise/, 'schulter_seite'], [/reverse|face pull|vorgebeugt/, 'schulter_hinten'],
  [/schulterdruck|frontheben|military|arnold/, 'schulter_vorne'], [/trizeps|stirndruck|dips|french/, 'trizeps'],
  [/curl|bizeps/, 'bizeps'], [/bank|brust|butterfly|fliegende|crossover|liegestutz/, 'brust'],
  [/kreuzheb/, 'ruecken_unten'],
];

function groupOf(ex) {
  if (ex.group) return ex.group;
  const listed = EXERCISE_GROUPS.get(nameKey(ex.name || ''));
  if (listed) return listed;
  const n = norm(ex.name || '');
  const hit = GROUP_GUESS.find(([re]) => re.test(n));
  return hit ? hit[1] : '';
}

// Tag-Intensität: 'heavy' / 'light' = Sätze und Wdh. automatisch, null = frei.
// (Ältere Tage haben noch type: 'upper-heavy' usw.)
const dayIntensity = day => !day ? null
  : day.intensity !== undefined ? day.intensity
  : day.type ? (day.type.endsWith('heavy') ? 'heavy' : 'light') : null;

// Muskelgruppen, die an diesem Tag geplant sind (für die Kontrolltabelle)
function dayGroups(day) {
  const planned = day.groups || (day.type ? DAY_GROUPS[day.type.split('-')[0]] : []);
  const present = day.exercises.filter(e => e.name.trim()).map(groupOf);
  return [...new Set([...planned, ...present])].filter(g => data.volume[g]);
}

// Ziel-Wdh. (unteres Ende des Bereichs) laut Tag-Typ, sonst laut Plan
function repsFor(day, ex) {
  const int = dayIntensity(day);
  return int ? REP_RANGES[int][kindOf(ex)][0] : ex.reps;
}

function repRangeText(day, ex) {
  const [lo, hi] = REP_RANGES[dayIntensity(day)][kindOf(ex)];
  return `${lo}–${hi}`;
}

const VOL_WEEKS = 4;  // Intro, W2, W3, W4 (eine 5. Woche übernimmt die Werte von W4)
const volWeekIdx = week => Math.min(Math.max(week, 1), VOL_WEEKS) - 1;

// Trainingstage mit Tag-Typ, die Übungen dieser Muskelgruppe haben (in Plan-Reihenfolge)
const daysWithGroup = g => data.days.filter(d => dayIntensity(d) && d.exercises.some(e => e.name.trim() && groupOf(e) === g));

// Wochenvolumen, das nicht glatt auf die Trainings aufgeht: so viele Tage (die ersten) bekommen 1 Satz mehr.
// activePlan().volExtra = { Muskelgruppe: [Intro, W2, W3, W4] }
const volExtraFor = (g, w) => ((activePlan().volExtra || {})[g] || [])[w] || 0;

// Sätze pro Training für eine Muskelgruppe an einem bestimmten Tag (Grundwert + ggf. 1 zusätzlicher Satz).
// vol = Volumen-Tabelle; der Plan-Assistent rechnet mit seinem Entwurf (dort gibt es keine Zusatzsätze).
function dayVolume(day, g, week, vol = data.volume) {
  const w = volWeekIdx(week);
  let v = vol[g][w];
  if (vol === data.volume) {
    const idx = daysWithGroup(g).indexOf(day);
    if (idx >= 0 && idx < volExtraFor(g, w)) v += 1;
  }
  return v;
}

// Geplante Sätze pro Woche (vor der Verteilung auf die Übungen): Summe über die Tage × Durchgänge pro Woche
function weeklyTarget(g, w) {
  const days = daysWithGroup(g);
  const sum = days.reduce((a, d) => a + dayVolume(d, g, w + 1), 0);
  return sum * (activePlan().perWeek || 1);
}

// Wochenvolumen einstellen: gleichmäßig auf die Trainings verteilen, Rest als +1 Satz an einzelnen Tagen
function setWeeklyVolume(g, w, total) {
  const p = activePlan();
  const days = daysWithGroup(g).length, per = p.perWeek || 1;
  if (!p.volExtra) p.volExtra = {};
  const extra = p.volExtra[g] || (p.volExtra[g] = [0, 0, 0, 0]);
  if (!days) { data.volume[g][w] = total; extra[w] = 0; return; }
  const sessions = days * per;
  const base = Math.max(1, Math.floor(total / sessions));
  data.volume[g][w] = base;
  extra[w] = Math.min(days - 1, Math.floor(Math.max(0, total - base * sessions) / per));
}

// Sätze pro Woche einer Muskelgruppe über alle Trainingstage mit Tag-Typ: [Intro, W2, W3, W4, Deload]
// (tatsächlich verteilt – kann unter dem Plan liegen, wenn es zu wenige Übungen gibt)
function weeklyVolume(g) {
  const weeks = [1, 2, 3, 4].map(w => 0);
  let deload = 0;
  for (const day of data.days) {
    const ids = day.exercises.filter(e => groupOf(e) === g).map(e => e.id);
    weeks.forEach((_, w) => {
      const m = autoSetsForDay(day, w + 1, false);
      ids.forEach(id => { weeks[w] += m.get(id) || 0; });
    });
    const d = autoSetsForDay(day, 0, true);
    ids.forEach(id => { deload += d.get(id) || 0; });
  }
  const n = activePlan().perWeek || 1;  // jeder Tag n-mal pro Woche
  return [...weeks, deload].map(x => x * n);
}

// Plan: Sätze pro Muskelgruppe – pro Woche oder pro Training einstellen, das jeweils andere passt sich an
function volumeEditor() {
  const groups = Object.keys(data.volume);
  const inp = (field, g, w, v, cls) =>
    `<td><input class="vol-inp ${cls}" type="text" inputmode="numeric" pattern="[0-9]*" data-field="${field}" data-g="${g}" data-w="${w}" value="${v}"></td>`;
  let h = `<details class="award-cat vol-editor" open><summary>Sätze pro Muskelgruppe</summary>
    <div class="card">
    <p class="hint">Am einfachsten die Sätze <b>pro Woche</b> eintragen – die App verteilt sie auf die Trainings. Oder direkt die Sätze <b>pro Training</b> ändern. Die Übungen passen sich automatisch an.</p>
    <table class="rir vol"><tr><th></th><th>Intro</th><th>W2</th><th>W3</th><th>W4</th></tr>`;
  for (const g of groups) {
    h += `<tr class="vol-g"><td colspan="5"><button class="vol-del" data-action="vol-del" data-g="${g}"
        aria-label="${MUSCLES[g]} entfernen">✕</button><b>${MUSCLES[g] || g}</b></td></tr>
      <tr><td>pro Woche</td>${[0, 1, 2, 3].map(w => inp('volw', g, w, weeklyTarget(g, w) || data.volume[g][w], 'week')).join('')}</tr>
      <tr class="vol-per"><td>pro Training</td>${data.volume[g].map((v, w) => inp('vol', g, w, v, 'per')).join('')}</tr>
      <tr class="vol-week"><td colspan="5"><span data-volweek="${g}">${volWeekText(g)}</span></td></tr>`;
  }
  h += '</table>';
  const missing = Object.keys(MUSCLES).filter(g => !data.volume[g] && g !== 'ausdauer');
  if (missing.length) {
    h += `<label class="row"><span>Muskelgruppe hinzufügen</span>
      <select class="inp sel" data-field="vol-add"><option value="">auswählen …</option>
        ${missing.map(g => `<option value="${g}">${MUSCLES[g]}</option>`).join('')}</select></label>`;
  }
  return h + `<div class="row"><button class="btn outline" data-action="vol-reset">Standardwerte wiederherstellen</button></div></div></details>`;
}

// Unter der Muskelgruppe: Zahl der Trainings, Deload, Verteilung und ob die Übungen das Volumen genau treffen.
// typed = gerade eingetippte Wochenzahl [Woche, Wert] – wenn sie sich nicht genau verteilen lässt, steht das dabei.
function volWeekText(g, typed = null) {
  const days = daysWithGroup(g);
  if (!days.length) return 'Noch keine Übung dieser Muskelgruppe in einem Trainingstag mit Tag-Typ.';
  const per = activePlan().perWeek || 1;
  const act = weeklyVolume(g);
  const target = [0, 1, 2, 3].map(w => weeklyTarget(g, w));
  let t = '';
  if (typed && target[typed[0]] !== typed[1]) {
    t += `→ ${typed[1]} lässt sich nicht gleichmäßig auf ${days.length * per} Trainings verteilen – es werden ${target[typed[0]]}. `;
  }
  t += `${days.length * per} Training${days.length * per === 1 ? '' : 's'} pro Woche · Deload ${act[4]}`;
  if ([0, 1, 2, 3].some(w => volExtraFor(g, w))) t += ' · nicht glatt teilbar: einzelne Tage bekommen 1 Satz mehr';
  if (target.some((x, w) => act[w] !== x)) {
    const why = [];
    if (target.some((x, w) => act[w] < x)) why.push(`höchstens ${MAX_SETS_PER_EX} Sätze je Übung – ggf. Übung ergänzen`);
    if (target.some((x, w) => act[w] > x)) why.push('jede Übung bekommt mindestens 1 Satz');
    t += ` · ⚠ tatsächlich: ${act.slice(0, 4).join(' · ')} (${why.join('; ')})`;
  }
  return t;
}

const MAX_SETS_PER_EX = 3;  // automatische Verteilung: höchstens so viele Sätze pro Übung

// Intro (und Deload): jede Übung 1 Satz, Rest der Reihe nach an Grund → Normal → Assistenz
// (Übungen mit MAX_SETS_PER_EX Sätzen werden übersprungen; überzählige Sätze fallen weg)
function distributeStart(exs, total) {
  const sets = new Map(exs.map(e => [e.id, 1]));
  const order = ['compound', 'normal', 'assist'].flatMap(k => exs.filter(e => kindOf(e) === k));
  let rest = total - exs.length;
  for (let i = 0; rest > 0 && order.some(e => sets.get(e.id) < MAX_SETS_PER_EX); i++) {
    const e = order[i % order.length];
    if (sets.get(e.id) >= MAX_SETS_PER_EX) continue;
    sets.set(e.id, sets.get(e.id) + 1);
    rest--;
  }
  return sets;
}

// Steigerung: zusätzliche Sätze reihum an Assistenz → Grund → Normal, innerhalb der Art an die
// Übung mit den wenigsten Sätzen (höchstens MAX_SETS_PER_EX). state.k merkt sich, wer als Nächstes dran ist.
function addSets(exs, sets, count, state) {
  for (let n = 0; n < count; n++) {
    for (let tries = 0; tries < 3; tries++) {
      const kind = ['assist', 'compound', 'normal'][state.k++ % 3];
      const cands = exs.filter(e => kindOf(e) === kind && sets.get(e.id) < MAX_SETS_PER_EX);
      if (!cands.length) continue;
      const e = cands.reduce((a, b) => sets.get(b.id) < sets.get(a.id) ? b : a);
      sets.set(e.id, sets.get(e.id) + 1);
      break;
    }
  }
}

// Sätze pro Übung eines Trainingstags (nur bei Tag-Typ und Muskelgruppen aus der Volumen-Tabelle)
// vol: Volumen-Tabelle (Standard: data.volume; der Plan-Assistent rechnet mit seinem Entwurf)
function autoSetsForDay(day, week, deload, vol = data.volume) {
  const res = new Map();
  if (!dayIntensity(day)) return res;
  const byGroup = {};
  for (const e of day.exercises) {
    const g = groupOf(e);
    if (!e.name.trim() || !vol[g]) continue;
    (byGroup[g] = byGroup[g] || []).push(e);
  }
  for (const [g, exs] of Object.entries(byGroup)) {
    let sets;
    if (deload) {
      sets = distributeStart(exs, Math.ceil(dayVolume(day, g, VOL_WEEKS, vol) / 2));
    } else {
      sets = distributeStart(exs, dayVolume(day, g, 1, vol));
      const state = { k: 0 };
      for (let w = 2; w <= week; w++) addSets(exs, sets, Math.max(0, dayVolume(day, g, w, vol) - dayVolume(day, g, w - 1, vol)), state);
    }
    sets.forEach((v, id) => res.set(id, v));
  }
  return res;
}

// Deload: Volumen halbieren (Sätze), Gewicht −20 %, nie schwerer als DELOAD_RIR im Tank.
// base = normales Ziel, damit man es beim Ersetzen der Übung neu berechnen kann.
const deloadSets = sets => Math.max(1, Math.round(sets / 2));
// Sätze pro Woche: Start in der Intro-Woche, Steigerung erst am Zyklusende –
// bei +1 nur in der letzten Woche, bei +2 in den letzten beiden Wochen je +1 usw.
function setsForWeek(ex, week, buildWeeks) {
  const diff = Math.max(0, ex.setsEnd - ex.sets);
  return ex.sets + Math.max(0, diff - (buildWeeks - week));
}

function deloadTarget(t) {
  const normal = targetWeight(t);
  return {
    ...t,
    sets: t.fixedSets ? t.sets : deloadSets(t.sets),  // automatisch verteilt: schon halbiert
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

const sameCycleWeek = (a, b) => a.cycleStart === b.cycleStart && a.week === b.week;

// Der wievielte Durchgang seines Trainingstags in dieser Zykluswoche war ein Training (1, 2, …)?
// (Wird ein Tag zweimal pro Woche trainiert, hat jeder Durchgang seine eigene Steigerung.)
function sessionOccurrence(s) {
  const c = sessionCycle(s);
  return 1 + data.sessions.filter(x => x !== s && x.dayId === s.dayId && x.date < s.date
    && sameCycleWeek(sessionCycle(x), c)).length;
}

// Passendes Training einer Übung in einer bestimmten Zykluswoche: bevorzugt neuester Zyklus, derselbe
// Trainingstag, derselbe Durchgang (occ) in der Woche, sonst das neueste
function findWeekEntry(name, dayId, match, occ = 1) {
  const k = nameKey(name);
  const occOf = new Map();
  const sameOcc = s => {
    if (s.dayId !== dayId) return false;
    if (!occOf.has(s)) occOf.set(s, sessionOccurrence(s));
    return occOf.get(s) === occ;
  };
  const cands = data.sessions
    .filter(s => !s.deload)
    .map(s => ({ s, c: sessionCycle(s) }))
    .filter(x => match(x.c))
    .sort((a, b) => b.c.cycleStart.localeCompare(a.c.cycleStart)
      || (b.s.dayId === dayId) - (a.s.dayId === dayId)
      || sameOcc(b.s) - sameOcc(a.s)
      || b.s.date.localeCompare(a.s.date));
  for (const { s, c } of cands) {
    const e = s.entries.find(en => nameKey(en.name) === k);
    if (e) return { date: s.date, week: c.week, occ: s.dayId === dayId ? sessionOccurrence(s) : null,
      sets: e.sets, planned: e.planned, target: e.target };
  }
  return null;
}

// Vergleichswoche: dieselbe Woche (und derselbe Durchgang) im vorherigen Zyklus
const comparisonEntry = (name, dayId, ci) =>
  findWeekEntry(name, dayId, c => c.week === ci.week && c.cycleStart < ci.cycleStart, ci.occurrence || 1);

// Vorwoche (derselbe Durchgang) im selben Zyklus
const previousWeekEntry = (name, dayId, ci) => ci.week < 2 ? null
  : findWeekEntry(name, dayId, c => c.cycleStart === ci.cycleStart && c.week === ci.week - 1, ci.occurrence || 1);

// 2. Durchgang eines Tages in der Woche: Plan des 1. Trainings dieser Woche als Obergrenze (keine Steigerung
// dagegen). Es zählt, was dort geplant war – nicht, was geschafft wurde (ältere Trainings ohne Plan: geschafft).
function weekFirstEntry(name, dayId, ci) {
  const k = nameKey(name);
  const first = data.sessions
    .filter(s => s.dayId === dayId && !s.deload && sameCycleWeek(sessionCycle(s), ci))
    .sort((a, b) => a.date.localeCompare(b.date))
    .find(s => s.entries.some(e => nameKey(e.name) === k));
  if (!first) return null;
  const e = first.entries.find(en => nameKey(en.name) === k);
  const planned = (e.planned || []).filter(p => p && (p.weight != null || p.reps != null));
  return { date: first.date, sets: planned.length ? planned : e.sets };
}

// Durchgang des nächsten Trainings eines Tages in der laufenden Zykluswoche
function nextOccurrence(dayId, ci) {
  return 1 + data.sessions.filter(s => s.dayId === dayId && sameCycleWeek(sessionCycle(s), ci)).length;
}

// Ziel deutlich verfehlt: ein Satz lag (Wdh. + Tank) mindestens MISS_REPS unter seinem Vorschlag
// -> das Gewicht geht runter (statt die Wdh. immer weiter zu senken)
const MISS_REPS = 2;

// Abstand eines erledigten Satzes zu seinem Vorschlag in Wdh. (negativ = verfehlt), null ohne Maßstab.
// Wurde mit anderem Gewicht trainiert als vorgeschlagen, wird die Leistung aufs vorgeschlagene Gewicht umgerechnet.
function setDeficit(done, planned, tRir) {
  if (!done || done.reps == null || !planned || planned.reps == null) return null;
  let cap = done.reps + (done.rir != null ? done.rir : tRir);
  if (planned.weight != null && done.weight != null) cap = capacityAt(cap, done.weight, planned.weight);
  return cap - (planned.reps + tRir);
}

// Hat Satz k (der Variante v) im Bezugstraining prev das Ziel deutlich verfehlt?
function missed(prev, v, k) {
  const t = prev.target || {};
  const p = ofVariant(prev.planned, v)[k];
  if (!p && v) return false;  // ohne gespeicherten Vorschlag gibt es für Varianten keinen Maßstab
  const d = setDeficit(ofVariant(prev.sets, v)[k], p || (k === 0 ? { reps: t.reps } : null), t.rir != null ? t.rir : 2);
  return d != null && d <= -MISS_REPS;
}

// Gewicht, mit dem nach einer Leistung (cap Wdh. bis zum Versagen bei Gewicht w) wieder goal Wdh. mit Ziel-Tank
// (nach k Sätzen Ermüdung) klappen – in Steigerungsschritten nach unten, nie schwerer als w
function weightForGoal(cap, w, t, k, goal) {
  const repsAt = x => Math.floor(capacityAt(cap, w, x) - t.rir - FATIGUE * k + 1e-9);
  let wt = w;
  while (repsAt(wt) < goal && wt - t.step > 0) wt = round2(wt - t.step);
  return { weight: wt, reps: Math.max(MIN_REPS, Math.min(goal, repsAt(wt))) };
}

// Ist Vorschlag a leichter als b? Zuerst nach Gewicht, bei gleichem Gewicht nach Wdh.
function lighterSet(a, b) {
  if (a.weight != null && b.weight != null && a.weight !== b.weight) return a.weight < b.weight;
  return a.reps < b.reps;
}

/* ---------- Ausführungsvarianten ---------- */

// '' = normal. Sätze einer Variante werden nur mit Sätzen derselben Variante verglichen.
const VARIANTS = { '': 'Normal', pause: 'mit Pause', slow: 'langsam' };
const VARIANT_SHORT = { pause: 'P', slow: 'L' };
const variantOf = s => (s && s.variant) || '';
const ofVariant = (sets, v) => (sets || []).filter(s => variantOf(s) === v);

// k-ter Bezugssatz einer Liste; fehlt er, den letzten nehmen und je Satz Ermüdung abziehen
function refAt(list, k) {
  if (k < list.length) return list[k];
  const last = list[list.length - 1];
  const extra = k - list.length + 1;
  return { ...last, reps: last.reps != null ? Math.max(MIN_REPS, last.reps - FATIGUE * extra) : null };
}

// Vorschlag aus einem Bezugssatz: gleiches Gewicht, Wdh. +1 (plusOne) bzw. bestätigen –
// reicht die damalige Leistung schon für die nächste Gewichtsstufe, steigt stattdessen das Gewicht.
// Die Wdh. werden vorher auf das damalige Tank-Ziel (srcRir) umgerechnet: mehr Wdh. mit weniger Tank sind keine
// Mehrleistung (11 Wdh. mit 2 statt 3 im Tank zählen wie 10), mehr Wdh. mit vollem Tank schon.
function fromRef(src, target, plusOne, i, srcRir) {
  let weight = src.weight;
  const base = src.reps != null && src.rir != null && srcRir != null
    ? Math.floor(src.reps + src.rir - srcRir + 1e-9) : src.reps;
  let reps = base != null ? base + (plusOne ? 1 : 0) : goalReps(target, i);
  if (src.reps != null && src.weight != null) {
    const cap = src.reps + (src.rir != null ? src.rir : target.rir);
    const up = stepUp(cap, src.weight, { step: 2.5, ...target }, 0, goalReps(target, i));
    if (up) ({ weight, reps } = up);
  }
  return { weight, reps };
}

// Kommentar aus dem letzten Training dieser Übung, das einen hatte.
// Wurde der Hinweis mit ✕ ausgeblendet, werden auch ältere Kommentare nicht mehr gezeigt.
function lastCommentFor(name) {
  for (const s of sessionsNewestFirst()) {
    const e = s.entries.find(en => nameKey(en.name) === nameKey(name));
    if (!e || !e.comment) continue;
    return e.commentHidden ? null : { text: e.comment, sessionId: s.id };
  }
  return null;
}

// Vorschau unter jedem erledigten Satz: was nächste Woche am gleichen Trainingstag für diesen Satz
// vorgeschlagen wird – mit denselben Regeln wie proposeSet (refProposal). Liefert HTML je Satz.
function nextPreview(en) {
  const out = en.sets.map(() => '');
  if (!en.target || !en.plan || draft.deload || draft.week == null) return out;
  const done = en.sets.map(s => isDone(s));
  if (!done.some(Boolean)) return out;
  const bw = data.cycle.buildWeeks;
  const nw = draft.week + 1;
  if (nw > bw) return done.map(d => d ? '<span>→ Nächste Woche: Deload (leichter)</span>' : '');

  const num = s => ({ weight: parseNum(s.weight), reps: parseNum(s.reps), rir: parseNum(s.rir), variant: variantOf(s) });
  const doneSets = en.sets.filter(isDone).map(num);
  const nextMonday = addWeeks(draft.cycleStart, draft.week);
  const ex = planExercise(en.name) || { name: en.name };
  const t = { ...en.plan, rir: rirFor(kindOf(ex), nw, bw, groupOf(ex)) };
  delete t.hold; delete t.intro;
  const hold = !weekProgression(nextMonday).load;
  // derselbe Durchgang nächste Woche (beim 2. Training kann dort noch das 1. Training der Woche begrenzen)
  const occ = draft.occurrence || 1;
  const cmp = hold ? null : comparisonEntry(en.name, draft.dayId, { week: nw, cycleStart: draft.cycleStart, occurrence: occ });
  const fmt = p => (p.weight != null ? `${fmtNum(p.weight)} kg × ` : '') + `${p.reps} Wdh.`;
  const when = occ > 1 ? `Nächste Woche, ${occ}. Training` : 'Nächste Woche';

  return en.sets.map((s, i) => {
    if (!done[i]) return '';
    const v = variantOf(s);
    const src = num(s);
    // Gespeichert werden nur erledigte Sätze: Position unter ihnen (iNext) bzw. unter denen derselben
    // Ausführung (k) – so zählt auch proposeSet nächste Woche
    const k = en.sets.slice(0, i).filter(x => isDone(x) && variantOf(x) === v).length;
    const iNext = en.sets.slice(0, i).filter(isDone).length;
    let p, why = '';
    if (hold) {
      p = { weight: src.weight, reps: src.reps };
      why = 'Progression aus';
    } else {
      const r = refProposal(t, { sets: doneSets, planned: en.planned, target: en.target }, cmp, iNext, k, v);
      p = r.p;
      why = r.rule === 'brake' ? 'Ziel verfehlt → leichter' : r.fromCmp ? 'Vergleich letzter Zyklus' : '';
    }
    p = atLeastMinReps(p, t);
    const dir = p.weight == null || src.weight == null || p.weight === src.weight ? ''
      : p.weight > src.weight ? ' ↑' : ' ↓';
    return `<span>→ ${when}: <b>${fmt(p)}</b>${dir}${why ? ` <small>(${why})</small>` : ''}</span>`;
  });
}

function updateNextHints(ei) {
  const en = draft.entries[ei];
  nextPreview(en).forEach((html, si) => {
    const el = $view.querySelector(`[data-next="${ei}-${si}"]`);
    if (el) el.innerHTML = html;
  });
}

// Ohne Gewichts-/Wdh.-Progression: Sätze einer Variante aus dem letzten Training dieser Übung (ohne Deload)
function holdSets(name, v) {
  for (const s of sessionsNewestFirst()) {
    if (s.deload) continue;
    const e = s.entries.find(en => nameKey(en.name) === nameKey(name));
    const sets = e ? ofVariant(e.sets, v) : [];
    if (sets.length) return sets;
  }
  return [];
}

// Neueste Sätze einer Variante (falls es keine Bezugswoche mit dieser Variante gibt)
function lastVariantSets(name, v) {
  for (const s of sessionsNewestFirst()) {
    const e = s.entries.find(en => nameKey(en.name) === nameKey(name));
    const sets = e ? ofVariant(e.sets, v) : [];
    if (sets.length) return sets;
  }
  return [];
}

// Vorschlag aus Vorwoche (prev = { sets, planned, target }) und Vergleichswoche (cmp) für Satz i,
// den k-ten Satz der Variante v; t = Ziel der neuen Woche. p = null, wenn es keinen Bezug gibt.
// Vorwoche: Satz 1 +1 Wdh., Rest bestätigen (reicht die Leistung, nächste Gewichtsstufe); Vergleichswoche: +1 je Satz;
// gibt es beide, gilt der niedrigere. Satz in der Vorwoche deutlich verfehlt -> Gewicht runter, Wdh. wie damals geplant.
function refProposal(t, prev, cmp, i, k, v) {
  const cmpV = ofVariant(cmp && cmp.sets, v);
  const prevV = ofVariant(prev && prev.sets, v);
  if (k < prevV.length && missed(prev, v, k)) {
    const src = prevV[k];
    const pl = ofVariant(prev.planned, v)[k];
    const goal = pl && pl.reps != null ? pl.reps : src.reps;
    if (src.weight == null) return { p: { weight: null, reps: src.reps }, rule: 'brake' };
    const cap = src.reps + (src.rir != null ? src.rir : t.rir);
    return { p: weightForGoal(cap, src.weight, { step: 2.5, ...t }, 0, goal), rule: 'brake' };
  }
  const rirOf = e => e && e.target && e.target.rir != null ? e.target.rir : null;  // damaliges Tank-Ziel
  const a = cmpV.length ? fromRef(refAt(cmpV, k), t, true, i, rirOf(cmp)) : null;
  const b = prevV.length ? fromRef(refAt(prevV, k), t, k === 0, i, rirOf(prev)) : null;
  if (a && b) return { p: lighterSet(b, a) ? b : a, rule: 'lower', fromCmp: lighterSet(a, b) };
  return { p: a || b, rule: null };
}

// Vorschlag für Satz i mit Variante v: Werte vom letzten Mal (Progression aus) bzw. refProposal.
// Ohne Bezug: Vorschlag aus Plan/Progression (en.base).
// Varianten nutzen zusätzlich die Vorwoche und notfalls ihr letztes Training als Bezug.
function proposeSet(en, i, v) {
  const t = en.target;
  const k = en.sets.slice(0, i).filter(s => variantOf(s) === v).length;
  let p = null, rule = null;
  if (t.hold) {
    // Gewichts-/Wdh.-Progression aus: Werte vom letzten Mal 1:1
    const ref = holdSets(en.name, v);
    if (ref.length) {
      const src = refAt(ref, k);
      p = { weight: src.weight, reps: src.reps };
      rule = 'hold';
    }
  } else {
    ({ p, rule } = refProposal(t, en.prevWeek, en.compare, i, k, v));
    if (!p && v) {
      const lastV = lastVariantSets(en.name, v);
      if (lastV.length) p = fromRef(refAt(lastV, k), t, k === 0, i);
    }
  }
  const firstV = ofVariant(en.weekFirst && en.weekFirst.sets, v);
  if (firstV.length && !t.hold) {
    // 2. Training der Woche: höchstens der Plan des 1. Trainings dieser Woche (keine Steigerung dagegen)
    const f = refAt(firstV, k);
    const cap = { weight: f.weight, reps: f.reps };
    if (cap.reps != null && (!p || lighterSet(cap, p))) { p = cap; rule = 'week'; }
  }
  if (!p) {
    const b = en.base[Math.min(i, en.base.length - 1)];
    p = { weight: parseNum(b.weight), reps: parseNum(b.reps) };
  }
  p = atLeastMinReps(p, t);
  return {
    set: {
      weight: p.weight != null ? fmtNum(p.weight) : '',
      reps: p.reps != null ? String(p.reps) : '',
      rir: '',
      auto: true,
      baseWeight: p.weight,  // Ausgangsgewicht für die Anpassung im Training
      variant: v,
    },
    rule,
  };
}

// Schlecht geschlafen / Stress: erwartete Wdh. um pen senken. Fiele der Satz unter MIN_REPS,
// geht wie sonst auch das Gewicht runter.
function applyPenalty(set, t, pen) {
  const r = parseNum(set.reps);
  if (!pen || r == null) return set;
  let reps = r - pen;
  let w = parseNum(set.weight);
  if (reps < MIN_REPS && w != null) ({ weight: w, reps } = planSet(reps + t.rir, w, { step: 2.5, ...t }, 0));
  return {
    ...set,
    weight: w != null ? fmtNum(w) : set.weight,
    reps: String(Math.max(1, reps)),
    baseWeight: w != null ? w : set.baseWeight,
  };
}

// Satz i (neu) vorschlagen und den ursprünglichen Vorschlag für die Bremse merken
function applyProposal(en, i, v) {
  const { set: proposed, rule } = proposeSet(en, i, v);
  const set = applyPenalty(proposed, en.target, draft.penalty || 0);
  en.sets[i] = set;
  en.planned[i] = { weight: parseNum(set.weight), reps: parseNum(set.reps), variant: v };
  if (i === 0) en.rule = rule;
}

const weekLabel = w => w === 1 ? 'Intro-Woche' : `Woche ${w}`;
// wie weekLabel, aber die Woche nach den Trainingswochen heißt Deload-Woche
const cycleWeekLabel = (w, bw = data.cycle.buildWeeks) => w > bw ? 'Deload-Woche' : weekLabel(w);

/* ---------- Trainingsdauer ---------- */

const fmtDur = min => min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;

function fmtClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(sec).padStart(2, '0');
}

// Dauer des letzten Trainings dieses Trainingstags (in Minuten)
function lastDuration(dayId) {
  const s = sessionsNewestFirst().find(x => x.dayId === dayId && x.duration);
  return s ? s.duration : null;
}

// Uhr im Training: läuft ab dem Start (draft.date), auch wenn die App zwischendurch geschlossen war
let trTimer = null;
function startTrainingTimer() {
  clearInterval(trTimer);
  const tick = () => {
    const el = document.getElementById('tr-timer');
    if (!el || !draft) { clearInterval(trTimer); return; }
    el.textContent = fmtClock(Date.now() - Date.parse(draft.date));
  };
  tick();
  trTimer = setInterval(tick, 1000);
}

/* ---------- Beschwerden (einmal pro Zyklus abgefragt) ---------- */

const BODY_AREAS = {
  schulter: { label: 'Schulter', groups: ['brust', 'schulter_vorne', 'schulter_seite', 'schulter_hinten'], match: /dips/,
    tip: 'Griff etwas enger, lieber Kurzhantel oder Maschine, Bewegung nicht ganz ausreizen' },
  ellenbogen: { label: 'Ellenbogen', groups: ['bizeps', 'trizeps', 'unterarme'],
    tip: 'Seil oder SZ-Stange statt gerader Stange, lieber etwas leichter' },
  handgelenk: { label: 'Handgelenk', groups: ['bizeps', 'unterarme'], match: /bankdrucken|liegestutz/,
    tip: 'Handgelenk gerade halten, Neutralgriff oder Bandagen nutzen' },
  ruecken: { label: 'Rücken', groups: ['ruecken_unten'], match: /kniebeugen|kreuzheben|rudern langhantel|good mornings|t-bar/,
    tip: 'Rücken gerade, Gewicht reduzieren, lieber Maschine (z. B. Beinpresse, brustgestütztes Rudern)' },
  huefte: { label: 'Hüfte', groups: ['gesaess', 'adduktoren', 'abduktoren'], match: /kniebeugen|ausfallschritte|bulgarian|kreuzheben/,
    tip: 'Bewegungsumfang etwas verkürzen, Gewicht reduzieren' },
  knie: { label: 'Knie', groups: ['quadrizeps'],
    tip: 'Tiefe begrenzen, lieber Beinpresse oder Hackenschmidt, Beinstrecker leichter' },
  sprunggelenk: { label: 'Sprunggelenk', groups: ['waden'], match: /ausfallschritte|step-ups/,
    tip: 'Gewicht reduzieren, Waden lieber sitzend' },
};

// Beschwerden für den aktuellen Zyklus (null = noch nicht abgefragt)
function currentComplaints() {
  const ci = cycleInfo();
  const c = data.complaints.find(x => x.cycleStart === ci.cycleStart);
  return c ? c.areas : null;
}

// Hinweise für eine Übung aus den Beschwerden dieses Zyklus
function complaintTips(name) {
  const areas = currentComplaints() || [];
  const g = groupOf({ name }), n = norm(name);
  return areas.filter(a => BODY_AREAS[a] && (BODY_AREAS[a].groups.includes(g) || (BODY_AREAS[a].match && BODY_AREAS[a].match.test(n))))
    .map(a => ({ label: BODY_AREAS[a].label, tip: BODY_AREAS[a].tip }));
}

/* ---------- Stillstand erkennen ---------- */

// Geschätztes Max. bei 10 Wdh. pro Übung und abgeschlossenem Zyklus (Deload zählt nicht).
// Weniger als 1 % Zuwachs gegenüber dem Zyklus davor = Stillstand.
function stagnationHints() {
  const ci = cycleInfo();
  const byEx = {};
  for (const s of data.sessions) {
    if (s.deload) continue;
    const cs = sessionCycle(s).cycleStart;
    if (cs >= ci.cycleStart) continue;  // nur abgeschlossene Zyklen
    for (const e of s.entries) {
      const est = e.sets.filter(x => !x.variant && x.weight != null && x.reps != null)
        .map(x => x.weight / repFactor(x.reps + (x.rir != null ? x.rir : 0)));
      if (!est.length) continue;
      const k = nameKey(e.name);
      const o = byEx[k] = byEx[k] || { name: e.name, cycles: {} };
      o.cycles[cs] = Math.max(o.cycles[cs] || 0, ...est);
    }
  }
  const inPlan = new Set(data.days.flatMap(d => d.exercises.map(e => nameKey(e.name))));
  const hints = [];
  for (const [k, o] of Object.entries(byEx)) {
    if (!inPlan.has(k) || data.hintsDismissed[k] === ci.cycleStart) continue;
    const vals = Object.keys(o.cycles).sort().map(c => o.cycles[c]);
    if (vals.length < 2) continue;
    const last = vals[vals.length - 1], prev = vals[vals.length - 2];
    if (last > prev * 1.01) continue;
    // wie viele Zyklen in Folge ohne Fortschritt?
    let stalled = 1;
    for (let i = vals.length - 2; i > 0 && vals[i] <= vals[i - 1] * 1.01; i--) stalled++;
    hints.push({ key: k, name: o.name, prev: round1(prev), last: round1(last), stalled });
  }
  return hints;
}

// Alternative Übungen derselben Muskelgruppe (bevorzugt gleiche Art), die noch nicht im Plan stehen
function alternativesFor(name) {
  const g = groupOf({ name }), kind = kindOf({ name });
  const inPlan = new Set(data.days.flatMap(d => d.exercises.map(e => nameKey(e.name))));
  return EXERCISE_LIST
    .filter(([n, k, gr]) => gr === g && !inPlan.has(nameKey(n)) && nameKey(n) !== nameKey(name))
    .sort((a, b) => (b[1] === kind) - (a[1] === kind))
    .slice(0, 2).map(([n]) => n);
}

function stagnationText(h) {
  const alts = alternativesFor(h.name);
  return `Geschätztes Max. bei 10 Wdh.: ${fmtNum(h.prev)} → ${fmtNum(h.last)} kg` +
    (h.stalled > 1 ? ` (${h.stalled} Zyklen ohne Fortschritt)` : '') +
    `<br>Ideen: ${alts.length ? `Variante wechseln (z. B. ${alts.map(esc).join(' oder ')}), ` : ''}` +
    'Volumen anpassen (Sätze pro Muskelgruppe ±1) oder Intensität ändern (anderer Wdh.-Bereich, Ausführung „mit Pause“ oder „langsam“).';
}

/* ---------- Aufwärmen ---------- */

const BAR_KG = 20;
const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
const WARM_PCT = 0.5;   // normale Übungen: 1 Aufwärmsatz mit ca. 50 % des ersten Arbeitssatzes …
const WARM_REPS = 10;   // … und so vielen Wdh.

// 'barbell' = Grundübung mit Langhantel (Stange + Steigerung, Scheiben-Anzeige), 'normal' = 1 Satz mit 50 %,
// null = kein Aufwärmen (Assistenzübungen, Dips)
function warmupKind(en) {
  const k = kindOf(planExercise(en.name) || { name: en.name });
  if (k === 'compound') return /dips/.test(norm(en.name)) ? null : 'barbell';
  return k === 'normal' ? 'normal' : null;
}

const firstWorkWeight = en => parseNum(en.sets[0] && en.sets[0].weight);

function warmWeight(en, pct, work) {
  const step = (en.target && en.target.step) || stepFor(planExercise(en.name) || { name: en.name, step: null });
  const w = Math.max(step, roundTo(pct * work, step));
  return warmupKind(en) === 'barbell' ? Math.max(BAR_KG, w) : w;
}

// Selbst angepasstes Aufwärmen vom letzten Mal (Anteil vom ersten Arbeitssatz + Wdh.), sonst null
function lastWarmup(name) {
  const k = nameKey(name);
  for (const s of sessionsNewestFirst()) {
    const e = s.entries.find(en => nameKey(en.name) === k);
    if (!e || !e.warmupCustom) continue;
    const work = e.sets[0] && e.sets[0].weight;
    if (!work) continue;
    return e.warmup.filter(w => w.weight != null).map(w => ({ pct: w.weight / work, reps: w.reps }));
  }
  return null;
}

// Vorschlag: wie zuletzt selbst angepasst, sonst Langhantel-Steigerung bzw. 1 Satz mit 50 %;
// Übungen ohne Aufwärmen (z. B. Assistenzübungen) nur, wenn man es dort selbst hinzugefügt hatte
function defaultWarmup(en) {
  const work = firstWorkWeight(en);
  if (!work) return [];
  const kind = warmupKind(en);
  const list = lastWarmup(en.name)
    || (kind === 'barbell' ? warmupSets(work).map(w => ({ pct: w / work, reps: warmupReps(w, work) }))
      : kind === 'normal' ? [{ pct: WARM_PCT, reps: WARM_REPS }]
      : []);
  return list.map(w => ({ pct: w.pct, weight: fmtNum(warmWeight(en, w.pct, work)), reps: w.reps == null ? '' : String(w.reps) }));
}

// Aufwärmen an den ersten Arbeitssatz anpassen: unverändert -> neuer Vorschlag,
// sonst folgen nur die Sätze, deren Gewicht nicht selbst eingetragen wurde
function syncWarmup(en) {
  if (!en.warmup || !en.warmupEdited) { en.warmup = defaultWarmup(en); return; }
  const work = firstWorkWeight(en);
  if (work) en.warmup.forEach(w => { if (!w.manual) w.weight = fmtNum(warmWeight(en, w.pct, work)); });
}

// Aufwärm-Kasten einer Übung; ohne Aufwärmsatz nur ein kleiner Knopf zum Hinzufügen
function warmupBlock(en, ei) {
  if (!en.warmup.length) {
    return `<div class="warm-add" data-warm="${ei}">
      <button class="vchip" data-action="wu-add" data-ei="${ei}">+ Aufwärmsatz</button></div>`;
  }
  const kind = warmupKind(en);
  const work = firstWorkWeight(en);
  let h = `<div class="warmup" data-warm="${ei}"><div class="warm-title">🔥 Aufwärmen</div>
    <div class="setgrid warmgrid"><span></span><span class="head">kg</span><span class="head">Wdh.</span><span class="head">` +
    (kind === 'barbell' ? 'pro Seite' : '') + '</span>' + en.warmup.map((w, wi) => `<span class="setno">A${wi + 1}</span>
      <input type="text" inputmode="decimal" autocomplete="off" placeholder="kg"
        data-field="wu-weight" data-ei="${ei}" data-wi="${wi}" value="${esc(w.weight)}">
      <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="Wdh."
        data-field="wu-reps" data-ei="${ei}" data-wi="${wi}" value="${esc(w.reps)}">
      <span class="plates" data-plates="${ei}-${wi}">${kind === 'barbell' && parseNum(w.weight) ? platesPerSide(parseNum(w.weight)) : ''}</span>`).join('') +
    `</div>
    <div class="row warm-btns">
      <button class="vchip" data-action="wu-del" data-ei="${ei}">− Aufwärmsatz</button>
      <button class="vchip" data-action="wu-add" data-ei="${ei}">+ Aufwärmsatz</button>
    </div>`;
  if (kind === 'barbell' && work) {
    h += `<div class="warm-row work"><b>Arbeitssatz ${fmtNum(work)} kg</b><span>${platesPerSide(work)}</span></div>
      <small>Rechts: Scheiben pro Seite (Stange ${BAR_KG} kg)</small>`;
  } else {
    h += `<small>Zählt nicht als Arbeitssatz. Änderungen merkt sich die App fürs nächste Mal.</small>`;
  }
  return h + '</div>';
}

// Gespeicherte Form: nur Zahlen, ohne leere Zeilen
const warmupForSession = en => en.warmup
  .map(w => ({ weight: parseNum(w.weight), reps: parseNum(w.reps) }))
  .filter(w => w.weight != null || w.reps != null);

// Stange, dann +20 kg, bis der Abstand zum Arbeitssatz unter 20 kg liegt, dann noch einmal +10 kg
function warmupSets(work) {
  if (!work || work <= BAR_KG) return [];
  const list = [BAR_KG];
  let w = BAR_KG;
  while (work - w >= 20 && w + 20 < work) { w += 20; list.push(w); }
  if (w + 10 < work) list.push(w + 10);
  return list;
}

// Wiederholungen beim Aufwärmen: Stange 10, danach weniger, je näher am Arbeitsgewicht
function warmupReps(w, work) {
  if (w <= BAR_KG) return 10;
  const p = w / work;
  return p <= 0.5 ? 8 : p <= 0.7 ? 5 : p <= 0.85 ? 3 : 2;
}

// Scheiben pro Seite, z. B. 80 kg -> „25 + 5“
function platesPerSide(total) {
  let rest = Math.round((total - BAR_KG) / 2 * 100) / 100;
  if (rest <= 0) return 'nur Stange';
  const out = [];
  for (const p of PLATES) {
    while (rest >= p - 1e-9) { out.push(p); rest = Math.round((rest - p) * 100) / 100; }
  }
  return out.map(fmtNum).join(' + ') + (rest > 0 ? ` (+ ${fmtNum(rest)})` : '');
}


/* ---------- Bildschirme ---------- */

const views = {
  start:    { title: 'Training',      tab: 'start',   render: renderStart },
  training: { title: () => draft ? draft.dayName : 'Training', tab: 'start', back: 'start', render: renderTraining, after: startTrainingTimer },
  plan:     { title: 'Trainingsplan', tab: 'plan',    render: renderPlan },
  day:      { title: 'Trainingstag',  tab: 'plan',    back: 'plan', render: renderDay },
  history:  { title: 'Verlauf',       tab: 'history', render: renderHistory },
  exercise: { title: p => p.name,     tab: 'history', back: 'history', render: renderExercise },
  week:     { title: 'Trainingswoche', tab: 'start',  back: 'start', render: renderWeek },
  library:  { title: 'Übungsbibliothek', tab: 'plan', back: 'plan', render: renderLibrary },
  // Übung aus der Bibliothek: zurück dorthin, woher sie geöffnet wurde (from/fromParams)
  libex:    { title: p => p.name, tab: p => p.tab || 'plan', back: p => [p.from || 'library', p.fromParams || {}], render: renderLibEx },
  // aus der Wochenansicht geöffnet: params.week = Montag dieser Woche
  session:  { title: p => p.edit ? 'Bearbeiten' : 'Training', tab: p => p.week ? 'start' : 'history',
    back: p => p.edit ? ['session', { id: p.id, week: p.week }] : p.week ? ['week', { start: p.week }] : ['history', {}],
    render: renderSession },
  check:    { title: 'Vor dem Training', tab: 'start', back: 'start', render: renderCheck },
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
  const tab = typeof v.tab === 'function' ? v.tab(current.params) : v.tab;
  document.querySelectorAll('#tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  $view.innerHTML = v.render(current.params);
  if (v.after) v.after(current.params);  // z. B. Diagramm zeichnen, wenn die Breite bekannt ist
}

// action = Wochen antippbar: 'week-open' (Trainings der Woche ansehen) oder
// 'cycle-jump' (Plan-Reiter: diese Woche als die gewählte Zykluswoche zählen)
function cyclePills(ci, action = null) {
  let h = '<div class="pills">';
  for (let i = 1; i <= ci.buildWeeks + 1; i++) {
    const deload = i === ci.buildWeeks + 1;
    const state = i === ci.week ? 'now' : i < ci.week ? 'past' : '';
    const cls = deload ? 'dl' : i === 1 ? 'intro' : '';
    const label = deload ? 'Deload' : i === 1 ? 'Intro' : i;
    h += action
      ? `<button class="pill ${cls} ${state}" data-action="${action}" data-w="${i}">${label}</button>`
      : `<span class="pill ${cls} ${state}">${label}</span>`;
  }
  return h + '</div>';
}

function cycleCard(ci) {
  const head = ci.future
    ? `Start am ${fmtDate(ci.begin + 'T12:00:00')}${ci.week > 1 ? ` mit ${cycleWeekLabel(ci.week, ci.buildWeeks)}` : ''}`
    : ci.deload
      ? `Zyklus ${ci.cycle} · Deload-Woche`
      : `Zyklus ${ci.cycle} · ${weekLabel(ci.week)}${ci.intro ? '' : ` von ${ci.buildWeeks}`}`;
  const sub = ci.deload
    ? `Halbe Sätze, 20 % weniger Gewicht, mind. ${DELOAD_RIR} Wdh. im Tank. Nächster Zyklus ab ${fmtDate(ci.nextStart)}.`
    : ci.intro
      ? `Start-Sätze laut Plan. Werte der letzten Intro-Woche, je +1 Wdh. Deload ab ${fmtDate(ci.deloadStart)}.`
      : `Werte derselben Woche im letzten Zyklus, je +1 Wdh. Deload-Woche ab ${fmtDate(ci.deloadStart)}.`;
  const wp = weekProgression(mondayISO(new Date()));
  const off = ci.deload || ci.future ? '' : progOffText({ ...wp, volume: wp.volume || ci.week === 1 });
  return `<div class="card cycle ${ci.deload ? 'is-deload' : ''}">
    <h2>${head}</h2>${cyclePills(ci, 'week-open')}<p class="sub">${sub}</p>
    ${off ? `<p class="prog-note">⏸ Diese Woche ${off}</p>` : ''}
    <p class="tap-hint">Woche antippen: Trainings ansehen und bearbeiten</p>
  </div>`;
}

// Start-Bildschirm: Stillstand-Hinweise und Beschwerden dieses Zyklus
function hintsCard() {
  const hints = stagnationHints();
  const areas = currentComplaints() || [];
  if (!hints.length && !areas.length) return '';
  let h = '<div class="card hints"><h2>💡 Hinweise</h2>';
  if (areas.length) {
    h += `<p><b>Beschwerden in diesem Zyklus:</b> ${areas.map(a => BODY_AREAS[a].label).join(', ')}.
      Betroffene Übungen sind im Training markiert. Bei Schmerzen den Satz abbrechen.</p>`;
  }
  for (const s of hints) {
    h += `<div class="hint-item"><div><b>Stillstand bei ${esc(s.name)}</b><br><small>${stagnationText(s)}</small></div>
      <button class="icon-btn" data-action="hint-dismiss" data-key="${esc(s.key)}" aria-label="Hinweis ausblenden">✕</button></div>`;
  }
  return h + '</div>';
}

function renderStart() {
  let h = (hasActivePlan() ? cycleCard(cycleInfo()) : '') + hintsCard();
  if (draft) {
    h += `<div class="card highlight">
      <h2>Laufendes Training: ${esc(draft.dayName)}</h2>
      <p class="sub">begonnen ${fmtDate(draft.date)}</p>
      <button class="btn primary" data-action="resume">Fortsetzen</button>
    </div>`;
  }
  if (!hasActivePlan()) {
    return h + `<div class="card no-plan">
        <div class="check-emoji" aria-hidden="true">🏁</div>
        <h2>Kein Plan aktiv</h2>
        <p class="hint">Erstelle einen neuen Plan oder aktiviere einen bisherigen im Reiter „Plan“. Deine Trainings und Erfolge bleiben erhalten.</p>
        <button class="btn primary" data-action="wiz-start">✨ Neuen Plan erstellen</button>
        ${data.plans.length ? '<button class="btn center" data-action="tab" data-tab="plan">Bisherigen Plan aktivieren</button>' : ''}
      </div>`;
  }
  if (!data.days.length) {
    return h + `<p class="hint">Noch kein Trainingsplan vorhanden. Lege zuerst deine Trainingstage und Übungen an.</p>
      <button class="btn primary" data-action="tab" data-tab="plan">Trainingsplan anlegen</button>`;
  }
  h += `<h2>Welcher Trainingstag? <small class="hint">· ${esc(activePlan().name)}</small></h2>`;
  const sessions = sessionsNewestFirst();
  // als Nächstes dran: der Tag nach dem zuletzt trainierten Tag dieses Plans
  const lastOwn = sessions.find(s => findDay(s.dayId));
  const nextId = !draft && lastOwn ? data.days[(data.days.indexOf(findDay(lastOwn.dayId)) + 1) % data.days.length].id : null;
  data.days.forEach((day, i) => {
    const last = sessions.find(s => s.dayId === day.id);
    const dur = lastDuration(day.id);
    const info = `${day.exercises.length} Übungen` + (last ? ` · zuletzt ${fmtDate(last.date)}` : '') +
      (dur ? ` · ⏱ ${fmtDur(dur)}` : '');
    const next = day.id === nextId;
    h += `<button class="btn nav day-btn ${next ? 'next' : ''}" data-action="start-day" data-id="${day.id}">
      <span class="day-no">${i + 1}</span>
      <span class="day-txt">${esc(day.name)}${next ? '<span class="badge">Als Nächstes</span>' : ''}<small>${info}</small></span></button>`;
  });
  return h;
}

function renderTraining() {
  if (!draft) return '<p class="hint">Kein laufendes Training.</p>';
  let h = draft.deload
    ? `<p class="deload-note">Deload-Woche: halbe Sätze, 20 % weniger Gewicht, nie schwerer als ${DELOAD_RIR} Wdh. im Tank. Keine Steigerung.</p>`
    : draft.intro
      ? '<p class="intro-note">Intro-Woche: Start-Sätze laut Plan. Vergleich ist die Intro-Woche des letzten Zyklus, je +1 Wdh.</p>'
      : '';
  const lastDur = lastDuration(draft.dayId);
  h = `<div class="timer-bar"><span>⏱ <b id="tr-timer">0:00</b></span>
    <span>${lastDur ? `Letztes Mal: ${fmtDur(lastDur)}` : 'Erstes Mal – Zeit wird gemessen'}</span></div>` + h;
  h += `<p class="sub">${fmtDate(draft.date, true)}<br>Trag nach jedem Satz ein, wie viele Wdh. noch im Tank waren – damit gilt der Satz als erledigt und die Wdh. der folgenden Sätze passen sich an.</p>`;
  h += progressionCard();

  // Reihenfolge nur für dieses Training ändern (der Plan bleibt, wie er ist)
  if (draft.reorder) {
    return h + `<div class="card"><h2>Reihenfolge heute</h2><ul class="list reorder">` +
      draft.entries.map((en, ei) => `<li class="bw-row">
        <span>${ei + 1}. ${esc(en.name)}</span>
        <button class="icon-btn" data-action="tr-move" data-ei="${ei}" data-dir="-1" aria-label="Nach oben" ${ei === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-action="tr-move" data-ei="${ei}" data-dir="1" aria-label="Nach unten" ${ei === draft.entries.length - 1 ? 'disabled' : ''}>↓</button>
      </li>`).join('') +
      `</ul><button class="btn primary" data-action="reorder-toggle">✔ Fertig</button>
      <p class="hint">Gilt nur für dieses Training. Eingetragene Werte bleiben erhalten.</p></div>`;
  }
  h += '<button class="btn outline" data-action="reorder-toggle">⇅ Reihenfolge ändern</button>';

  const stalls = stagnationHints();
  draft.entries.forEach((en, ei) => {
    const last = lastEntry(en.name);
    h += `<section class="card">
      <div class="ex-head">
        <h2>${libEntry(en.name) ? `<button class="lib-link" data-action="lib-open" data-name="${esc(en.name)}"
          aria-label="Ausführung ansehen">${esc(en.name)} <span class="info-dot">i</span></button>` : esc(en.name)}</h2>
        <button class="icon-btn bubble ${(en.comment || '').trim() ? 'has' : ''}" data-action="comment-toggle"
          data-ei="${ei}" aria-label="Kommentar">💬</button>
        <button class="icon-btn swap" data-action="rep-open" data-ei="${ei}">⇄ Ersetzen</button>
      </div>`;
    if (en.added) {
      h += `<div class="added-row"><span>Heute zusätzlich</span>
        <button class="icon-btn" data-action="added-remove" data-ei="${ei}">Entfernen</button></div>`;
    }
    if (en.commentOpen) {
      h += `<textarea class="inp comment" rows="3" data-field="tr-comment" data-ei="${ei}"
        placeholder="Kommentar zur Übung, z. B. Sitzhöhe 4, Schulter zwickt …">${esc(en.comment)}</textarea>`;
    }
    for (const c of complaintTips(en.name)) {
      h += `<p class="complaint-note">⚠️ ${c.label}: ${c.tip}. Bei Schmerz Satz abbrechen.</p>`;
    }
    const stall = stalls.find(s => s.key === nameKey(en.name));
    if (stall) h += `<p class="stall-note">💡 Stillstand: ${stagnationText(stall)}</p>`;
    if (!en.warmupEdited) syncWarmup(en);  // Vorschlag passend zum aktuellen ersten Arbeitssatz
    h += warmupBlock(en, ei);
    const lastComment = lastCommentFor(en.name);
    if (lastComment) {
      h += `<div class="last-comment"><span>💬 Letztes Mal: „${esc(lastComment.text)}“</span>
        <button class="icon-btn" data-action="comment-dismiss" data-sid="${lastComment.sessionId}"
          data-name="${esc(en.name)}" aria-label="Hinweis ausblenden">✕</button></div>`;
    }
    if (en.replacedFrom) h += `<p class="last">statt ${esc(en.replacedFrom)}</p>`;
    if (en.replacing) h += renderReplace(en, ei);
    if (en.target) {
      const t = en.target;
      h += `<p class="target">Ziel: ${t.sets} × ${t.reps} Wdh. · Ø ${targetRirText(t)} im Tank` +
        (t.max10 != null ? `<br><small>Max. bei 10 Wdh.: ${fmtNum(t.max10)} kg</small>` : '') + '</p>';
    }
    if (en.weekFirst) {
      h += `<p class="compare">Plan des 1. Trainings dieser Woche (${fmtDate(en.weekFirst.date)}):<br>
        ${en.weekFirst.sets.map(fmtSet).join(' · ')}<br><b>2. Training der Woche: höchstens dieser Plan – keine Steigerung dagegen</b></p>`;
    }
    if (en.compare) {
      const rule = en.rule === 'brake'
        ? `Vorwoche deutlich verfehlt (mind. ${MISS_REPS} Wdh. unter Plan) → weniger Gewicht, Wdh. wie geplant`
        : en.rule === 'lower'
          ? 'Heute: pro Satz der niedrigere Vorschlag aus beiden – Ziel: Satz 1 eine Wdh. mehr als in der Vorwoche, die übrigen Sätze bestätigen'
          : en.rule === 'week'
            ? 'Heute: begrenzt durch das 1. Training dieser Woche'
            : 'Heute: je Satz +1 Wdh. – oder mehr Gewicht, wenn es die Leistung hergibt';
      const occ = draft.occurrence > 1 || en.compare.occ > 1 ? `, ${en.compare.occ || 1}. Training` : '';
      h += `<p class="compare">Letzter Zyklus, ${weekLabel(en.compare.week)}${occ} (${fmtDate(en.compare.date)}):<br>
        ${en.compare.sets.map(fmtSet).join(' · ')}` +
        (en.prevWeek ? `<br>Vorwoche, ${weekLabel(en.prevWeek.week)} (${fmtDate(en.prevWeek.date)}):<br>
        ${en.prevWeek.sets.map(fmtSet).join(' · ')}` : '') +
        `<br><b>${rule}</b></p>`;
    } else {
      h += last
        ? `<p class="last">Letztes Mal (${fmtDate(last.date)}): ${last.sets.map(fmtSet).join(' · ')}</p>`
        : '<p class="last">Erstes Mal – noch keine Werte.</p>';
    }
    const vAll = en.sets.length && en.sets.every(s => variantOf(s) === variantOf(en.sets[0])) ? variantOf(en.sets[0]) : null;
    h += `<div class="variants"><span>Ausführung</span>${Object.entries(VARIANTS).map(([v, label]) =>
      `<button class="vchip ${vAll === v ? 'on' : ''}" data-action="ex-variant" data-ei="${ei}" data-v="${v}">${label}</button>`).join('')}
    </div>`;
    h += `<p class="adjust" data-note="${ei}" ${en.note ? '' : 'hidden'}>${esc(en.note)}</p>`;
    h += '<div class="setgrid"><span class="head">Satz</span><span class="head">kg</span><span class="head">Wdh.</span><span class="head">Tank</span>';
    const tankHint = en.target ? targetRirText(en.target).replace('mind. ', '≥') : '–';
    const next = nextPreview(en);
    en.sets.forEach((s, si) => {
      const v = variantOf(s);
      h += `<button class="setno ${v ? 'has-v' : ''}" data-action="set-variant" data-ei="${ei}" data-si="${si}"
          aria-label="Satz ${si + 1}: ${VARIANTS[v]} – antippen zum Wechseln">${si + 1}${v ? `<small>${VARIANTS[v]}</small>` : ''}</button>
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="–"
          data-field="tr-weight" data-ei="${ei}" data-si="${si}" value="${esc(s.weight)}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="–"
          data-field="tr-reps" data-ei="${ei}" data-si="${si}" value="${esc(s.reps)}">
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="${tankHint}"
          class="tank" data-field="tr-rir" data-ei="${ei}" data-si="${si}" value="${esc(s.rir)}">
        <div class="next-hint" data-next="${ei}-${si}">${next[si] || ''}</div>`;
    });
    h += `</div><p class="avg" data-avg="${ei}">${avgTankText(en)}</p>
      <div class="row">
        <button class="btn" data-action="tr-del-set" data-ei="${ei}">− Satz</button>
        <button class="btn" data-action="tr-add-set" data-ei="${ei}">+ Satz</button>
      </div></section>`;
  });
  h += draft.adding ? renderAddExercise()
    : '<button class="btn center" data-action="add-open">+ Übung hinzufügen</button>';
  h += `<p class="hint">Satznummer antippen: Ausführung wechseln (normal → mit Pause → langsam). Sätze mit Pause oder langsam werden nur mit gleich ausgeführten Sätzen verglichen.</p>
    <button class="btn primary" data-action="tr-save">Training speichern</button>
    <div class="spacer"></div>
    <button class="btn danger" data-action="tr-cancel">Training verwerfen</button>`;
  return h;
}

// Progression nur für dieses Training ein-/ausschalten (nicht im Deload; Volumen erst ab Woche 2)
function progressionCard() {
  if (draft.deload || !draft.progression) return '';
  const p = draft.progression;
  const keys = draft.week > 1 ? ['volume', 'load'] : ['load'];
  const notes = [];
  if (draft.week > 1 && !p.volume) notes.push('Sätze wie in der Vorwoche.');
  if (!p.load) notes.push('Gewicht und Wdh. wie beim letzten Mal – keine Steigerung, „Max. bei 10 Wdh.“ bleibt.');
  return `<div class="card prog-card"><div class="prog-row"><b>Progression heute</b>
      <div class="variants">${keys.map(k => progChip(k, p[k], 'data-action="prog-today"')).join('')}</div></div>
      ${notes.length ? `<p class="hint">${notes.join(' ')}</p>` : ''}
    </div>`;
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

// Im laufenden Training eine Übung ergänzen (Vorschläge, Max.-Gewicht, Satzzahl, optional in den Plan)
function renderAddExercise() {
  return `<div class="card replace add-ex">
    <p class="lbl">Übung hinzufügen</p>
    <input class="inp" type="text" data-field="add-name"
      autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Übung eintippen …">
    <div class="suggest" hidden></div>
    <label class="row">
      <span>Max. kg bei 10 Wdh.</span>
      <input class="inp kg" type="text" inputmode="decimal" autocomplete="off" data-field="rep-max" placeholder="kg">
    </label>
    <label class="row"><span>Sätze</span>
      <select class="inp sel" id="add-sets">${[1, 2, 3, 4, 5, 6].map(n =>
        `<option value="${n}" ${n === 3 ? 'selected' : ''}>${n}</option>`).join('')}</select>
    </label>
    <label class="check-row"><input type="checkbox" id="add-keep"> Auch dauerhaft in den Trainingsplan übernehmen</label>
    <div class="row">
      <button class="btn" data-action="add-cancel">Abbrechen</button>
      <button class="btn primary" data-action="add-ok">Hinzufügen</button>
    </div>
  </div>`;
}

// Plan-Reiter: alle Pläne, Assistent, Trainingstage des aktiven Plans (nur Namen), Periodisierung
function renderPlan() {
  const c = data.cycle;
  const active = activePlan();
  let h = '<h2>Meine Pläne</h2>';
  for (const p of data.plans) {
    const isActive = p.id === active.id;
    const state = isActive ? ' · aktiv'
      : (p.endedAt ? ` · beendet am ${fmtDate(p.endedAt + 'T12:00:00')}` : '') + ' · antippen zum Aktivieren';
    h += `<div class="plan-row ${isActive ? 'active' : ''} ${p.endedAt && !isActive ? 'ended' : ''}">
      <button class="plan-pick" data-action="plan-activate" data-id="${p.id}">
        <b>${esc(p.name)}</b><small>${p.days.length} Trainingstag${p.days.length === 1 ? '' : 'e'}${state}</small>
      </button>
      <button class="icon-btn" data-action="plan-rename" data-id="${p.id}" aria-label="Umbenennen">✎</button>
      <button class="icon-btn danger" data-action="plan-delete" data-id="${p.id}" aria-label="Plan löschen">🗑</button>
    </div>`;
  }
  const libBtn = `<button class="btn nav lib-open-btn" data-action="lib">📖 Übungsbibliothek
    <small>Alle Übungen mit Animation, Ausführung und Tipps</small></button>`;
  if (!hasActivePlan()) {
    return h + `<p class="hint">Kein Plan aktiv. Tippe einen Plan an, um ihn wieder zu aktivieren, oder erstelle einen neuen.</p>
      <button class="btn primary" data-action="wiz-start">✨ Neuen Plan erstellen</button>${libBtn}`;
  }
  h += `<button class="btn primary" data-action="wiz-start">✨ Neuen Plan erstellen</button>
    <button class="btn outline" data-action="plan-end">⏹ „${esc(active.name)}“ beenden</button>
    ${libBtn}
    <h2>Trainingstage · ${esc(active.name)}</h2>`;
  if (!data.days.length) {
    h += '<p class="hint">Dieser Plan hat noch keine Trainingstage.</p>';
  }
  data.days.forEach((day, i) => {
    h += `<button class="btn nav day-btn" data-action="open-day" data-id="${day.id}">
      <span class="day-no">${i + 1}</span><span class="day-txt">${esc(day.name)}</span></button>`;
  });
  const perWeek = active.perWeek || 1;
  h += `<button class="btn center" data-action="add-day">+ Trainingstag hinzufügen</button>
    <div class="card per-week">
      <div class="row" style="margin-top:0"><span>Jeder Trainingstag pro Woche<br>
        <small class="hint">${data.days.length * perWeek} Trainings pro Woche</small></span>
        <div class="stepper">${[1, 2].map(n => `<button class="toggle ${perWeek === n ? 'on' : ''}" data-action="plan-perweek" data-n="${n}">${n}×</button>`).join('')}</div>
      </div>
      ${perWeek > 1 ? '<p class="hint">Das 2. Training eines Tages in der Woche richtet sich nach dem 2. Training derselben Woche im letzten Zyklus und liegt nie über dem Plan des 1. Trainings dieser Woche.</p>' : ''}
    </div>
    <h2>Periodisierung</h2>
    <div class="card">
      <div class="row" style="margin-top:0">
        <span>Trainingswochen<br><small class="hint">inkl. Intro, danach Deload</small></span>
        <div class="stepper">
          <button data-action="cycle-weeks" data-delta="-1" aria-label="Weniger Wochen">−</button>
          <b>${c.buildWeeks}</b>
          <button data-action="cycle-weeks" data-delta="1" aria-label="Mehr Wochen">+</button>
        </div>
      </div>
      <label class="row"><span>Zyklus-Start</span>
        <input class="inp date" type="date" data-field="cycle-start" value="${c.start}"></label>
      <p class="hint">Danach folgt automatisch 1 Deload-Woche: halbe Sätze der letzten Woche, 20 % weniger Gewicht, nie schwerer als ${DELOAD_RIR} Wdh. im Tank, keine Steigerung. Anschließend beginnt der nächste Zyklus.</p>
      <p class="lbl chips-title">Aktuelle Woche</p>
      ${cyclePills(cycleInfo(), 'cycle-jump')}
      <p class="hint">Antippen, um diese Woche anders einzuordnen – z. B. nach Krankheit oder längerer Pause direkt in die Deload-Woche oder zurück in die Intro-Woche. Der Zyklus verschiebt sich entsprechend.</p>
      ${progressionTable()}
      ${rirTable(c.buildWeeks)}
    </div>
    ${volumeEditor()}`;
  return h;
}

// Progression: Grundeinstellung des Plans und Abweichungen für die Wochen des aktuellen Zyklus
function progressionTable() {
  const ci = cycleInfo();
  const def = planProgression();
  const own = activePlan().weekProgression;
  let h = `<p class="lbl chips-title">Progression</p>
    <div class="prog-def"><span>Grundeinstellung<br><small class="hint">ganzer Zyklus</small></span>
      <div class="variants">${Object.keys(PROG_KEYS).map(k => progChip(k, def[k], 'data-action="prog-plan"')).join('')}</div></div>
    <table class="rir prog-table"><tr><th>Woche</th><th>Volumen</th><th>Gewicht & Wdh.</th></tr>`;
  for (let w = 1; w <= ci.buildWeeks; w++) {
    const monday = addWeeks(ci.cycleStart, w - 1);
    const p = weekProgression(monday);
    const cell = k => {
      if (k === 'volume' && w === 1) return '<td class="hint">–</td>';  // Intro: Start-Sätze, keine Steigerung
      const differs = own[monday] && own[monday][k] !== undefined;
      return `<td><button class="prog-cell ${p[k] ? 'on' : 'off'} ${differs ? 'own' : ''}" data-action="prog-week"
        data-key="${k}" data-monday="${monday}" aria-label="${PROG_KEYS[k]} ${w === 1 ? 'Intro' : 'Woche ' + w}">${p[k] ? '✓' : '✕'}</button></td>`;
    };
    h += `<tr class="${!ci.deload && !ci.future && ci.week === w ? 'cur' : ''}"><td>${w === 1 ? 'Intro' : 'W' + w}
      <small class="hint">${fmtDate(monday + 'T12:00:00').replace(/^\w+\., /, '')}</small></td>${cell('volume')}${cell('load')}</tr>`;
  }
  return h + `</table>
    <p class="hint">Volumen = mehr Sätze von Woche zu Woche (aus: Sätze wie in der Vorwoche). Gewicht & Wdh. = Steigerung von Training zu Training (aus: Werte vom letzten Mal halten). Einzelne Wochen antippen, um nur dort abzuweichen (umrandet). Für ein einzelnes Training lässt es sich direkt im Training umschalten.</p>`;
}

// Grenzen für die Plus/Minus-Felder einer Übung
const LIMITS = { sets: [1, 20], setsEnd: [1, 20], reps: [5, 50], rir: [0, 10] };

// Vorschau im Plan: Sätze je Woche des Zyklus
function setsPreview(ex) {
  const bw = data.cycle.buildWeeks;
  const weeks = Array.from({ length: bw }, (_, i) => setsForWeek(ex, i + 1, bw));
  return `Sätze je Woche: ${weeks.map((s, i) => `${i === 0 ? 'Intro' : 'W' + (i + 1)} ${s}`).join(' · ')} · Deload ${deloadSets(ex.setsEnd)}`;
}

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
    ${cmp.sets.map(fmtSet).join(' · ')}<br><b>Ziel: je Satz +1 Wdh. bzw. nächste Gewichtsstufe – ab Woche 2 höchstens Vorwoche mit Satz 1 +1 Wdh.</b></p>`;
}

// Kontrolle im Plan: Sätze pro Muskelgruppe und Woche für diesen Trainingstag
function volumeSummary(day) {
  if (!dayIntensity(day)) return '';
  const bw = data.cycle.buildWeeks;
  const weeks = Array.from({ length: bw }, (_, w) => autoSetsForDay(day, w + 1, false));
  const deload = autoSetsForDay(day, 0, true);
  const sum = (m, g) => day.exercises.filter(e => groupOf(e) === g && m.has(e.id)).reduce((a, e) => a + m.get(e.id), 0);
  let h = '<div class="card"><h2>Sätze pro Muskelgruppe</h2><div class="table-wrap"><table class="rir"><tr><th></th>' +
    weeks.map((_, w) => `<th>${w === 0 ? 'Intro' : 'W' + (w + 1)}</th>`).join('') + '<th>Deload</th></tr>';
  for (const g of dayGroups(day)) {
    const has = day.exercises.some(e => e.name.trim() && groupOf(e) === g);
    h += `<tr><td>${MUSCLES[g]}</td>` + (has
      ? weeks.map(m => `<td>${sum(m, g)}</td>`).join('') + `<td>${sum(deload, g)}</td>`
      : `<td colspan="${bw + 1}" class="missing-cell">keine Übung</td>`) + '</tr>';
  }
  const total = m => [...m.values()].reduce((a, b) => a + b, 0);
  h += '<tr class="total"><td>Gesamt</td>' + weeks.map(m => `<td>${total(m)}</td>`).join('') + `<td>${total(deload)}</td></tr>`;
  return h + '</table></div></div>';
}

function renderDay({ id }) {
  const day = findDay(id);
  if (!day) return '<p class="hint">Trainingstag nicht gefunden.</p>';
  let h = `<label class="lbl">Name des Trainingstags
      <input class="inp" type="text" data-field="day-name" value="${esc(day.name)}">
    </label>
    <div class="variants plan daytype"><span>Intensität</span>${Object.entries({ heavy: 'Schwer', light: 'Leicht', '': 'Frei' }).map(([t, label]) =>
      `<button class="vchip ${(dayIntensity(day) || '') === t ? 'on' : ''}" data-action="day-type" data-t="${t}">${label}</button>`).join('')}
    </div>
    <p class="hint">${dayIntensity(day)
      ? 'Sätze und Wiederholungen werden automatisch aus Muskelgruppe, Übungsart und Zykluswoche berechnet.'
      : 'Frei: Sätze und Wiederholungen legst du pro Übung selbst fest.'}</p>
    ${volumeSummary(day)}
    <h2>Übungen</h2>`;
  const bw = data.cycle.buildWeeks;
  const autoWeeks = Array.from({ length: bw }, (_, w) => autoSetsForDay(day, w + 1, false));
  const autoDeload = autoSetsForDay(day, 0, true);
  day.exercises.forEach((ex, i) => {
    const isAuto = autoDeload.has(ex.id);
    h += `<div class="card">
      <div class="ex-name-row">
        <input class="inp" type="text" data-field="ex-name" data-i="${i}"
          autocomplete="off" autocorrect="off" spellcheck="false"
          value="${esc(ex.name)}" placeholder="Übung eintippen, z. B. Bank…">
        <button class="info-btn" data-action="lib-open" data-i="${i}" aria-label="Ausführung ansehen"
          ${libEntry(ex.name) ? '' : 'hidden'}>i</button>
      </div>
      <div class="suggest" hidden></div>
      ${planCompare(ex, day)}
      <label class="row"><span>Muskelgruppe</span>
        <select class="inp sel" data-field="ex-group" data-i="${i}">
          <option value="">auto${groupOf({ name: ex.name }) ? ': ' + MUSCLES[groupOf({ name: ex.name })] : ''}</option>
          ${Object.entries(MUSCLES).map(([g, label]) =>
            `<option value="${g}" ${ex.group === g ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>
      ${isAuto
        ? `<p class="auto-info">Sätze automatisch: ${autoWeeks.map((m, w) => `${w === 0 ? 'Intro' : 'W' + (w + 1)} ${m.get(ex.id)}`).join(' · ')} · Deload ${autoDeload.get(ex.id)}<br>
           Wdh.: ${repRangeText(day, ex)} (Start bei ${repsFor(day, ex)})</p>`
        : `${stepperRow('Sätze Intro', 'sets', i, ex.sets)}
           ${stepperRow('Sätze letzte Woche', 'setsEnd', i, ex.setsEnd)}
           <p class="hint kind-hint">${setsPreview(ex)}</p>
           ${dayIntensity(day)
             ? `<p class="auto-info">Wdh.: ${repRangeText(day, ex)} (Start bei ${repsFor(day, ex)}) · Muskelgruppe ohne Volumen-Vorgabe, Sätze von Hand</p>`
             : stepperRow('Wdh. pro Satz', 'reps', i, ex.reps)}`}
      <div class="variants plan"><span>Art${ex.kind == null ? ' <small class="hint">(auto)</small>' : ''}</span>${Object.entries(KINDS).map(([k, label]) =>
        `<button class="vchip ${kindOf(ex) === k ? 'on' : ''}" data-action="plan-kind" data-i="${i}" data-k="${k}">${label}</button>`).join('')}
      </div>
      <p class="hint kind-hint">Ziel im Tank diese Woche: <b>${weekRirText(kindOf(ex), groupOf(ex))}</b></p>
      <div class="variants plan"><span>Ausführung</span>${Object.entries(VARIANTS).map(([v, label]) =>
        `<button class="vchip ${(ex.variant || '') === v ? 'on' : ''}" data-action="plan-variant" data-i="${i}" data-v="${v}">${label}</button>`).join('')}
      </div>
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
    h += `<button class="btn nav" data-action="open-exercise" data-name="${esc(ex.name)}">
      ${esc(ex.name)}<small>${ex.count}× trainiert · zuletzt ${fmtDate(ex.last)}</small></button>`;
  }
  h += '<h2>Alle Trainings</h2>';
  for (const s of sessionsNewestFirst()) {
    h += `<button class="btn nav" data-action="open-session" data-id="${s.id}">
      ${fmtDate(s.date)}<small>${esc(s.dayName)} · ${s.entries.length} Übungen · ${fmtTons(sessionTonnage(s))}${s.duration ? ' · ⏱ ' + fmtDur(s.duration) : ''}${s.deload ? ' · Deload' : ''}</small></button>`;
  }
  return h;
}

function renderExercise({ name }) {
  const k = nameKey(name);
  const rows = [];
  for (const s of sessionsNewestFirst()) {
    const e = s.entries.find(en => nameKey(en.name) === k);
    if (e) rows.push({ session: s, sets: e.sets, comment: e.comment });
  }
  if (!rows.length) return '<p class="hint">Keine Einträge.</p>';

  const weights = rows.flatMap(r => r.sets.map(s => s.weight)).filter(w => w != null);
  let h = weights.length
    ? `<p class="sub">Höchstes Gewicht: <b>${fmtNum(Math.max(...weights))} kg</b> · ${rows.length} Trainings</p>`
    : '';
  if (libEntry(name)) h += `<button class="link-btn lib-small" data-action="lib-open" data-name="${esc(name)}">ⓘ Ausführung ansehen</button>`;
  h += '<ul class="list">';
  for (const r of rows) {
    h += `<li><div class="date">${fmtDate(r.session.date)} <small>${esc(r.session.dayName)}</small></div>
      <div class="sets">${r.sets.map(fmtSet).join('<br>')}</div>
      ${r.comment ? `<div class="comment-text">💬 ${esc(r.comment)}</div>` : ''}</li>`;
  }
  return h + '</ul>';
}

/* ---------- Übungsbibliothek ---------- */

let libQuery = '';           // Suchtext in der Bibliothek
const libOpenGroups = new Set();  // aufgeklappte Muskelgruppen

function libRow(name) {
  const kind = KINDS[kindOf({ name })];
  return `<button class="btn nav lib-row" data-action="lib-open" data-name="${esc(name)}">
    <span class="lib-thumb">${libFigure(name, false)}</span>
    <span class="lib-txt">${esc(name)}<small>${kind}</small></span></button>`;
}

function libResults() {
  const q = norm(libQuery.trim());
  if (!q) return '';
  const hits = EXERCISE_LIST.filter(([n]) => norm(n).includes(q)).slice(0, 40);
  return hits.length ? hits.map(([n]) => libRow(n)).join('') : '<p class="hint">Keine Übung gefunden.</p>';
}

function renderLibrary() {
  let h = `<input class="inp lib-search" type="search" data-field="lib-search" autocomplete="off" autocorrect="off"
      spellcheck="false" placeholder="Übung suchen, z. B. Rudern …" value="${esc(libQuery)}">
    <div id="lib-results">${libResults()}</div>
    <div id="lib-groups" ${libQuery.trim() ? 'hidden' : ''}>
    <p class="hint">Jede Übung mit animierter Ausführung, Zielmuskeln und Tipps. Muskelgruppe antippen zum Aufklappen.</p>`;
  for (const g of Object.keys(MUSCLES)) {
    const list = EXERCISE_LIST.filter(e => e[2] === g);
    if (!list.length) continue;
    const open = libOpenGroups.has(g);
    h += `<details class="award-cat lib-group" ${open ? 'open' : ''}>
      <summary data-action="lib-toggle" data-g="${g}">${MUSCLES[g]} <small class="hint">(${list.length})</small></summary>
      ${open ? list.map(([n]) => libRow(n)).join('') : ''}</details>`;
  }
  return h + '</div>';
}

function renderLibEx({ name }) {
  const e = libEntry(name);
  if (!e) return `<p class="hint">Für „${esc(name)}“ gibt es noch keine Erklärung in der Bibliothek.</p>`;
  const t = FIG_TEXT[e.pattern] || {};
  const kind = KINDS[kindOf(planExercise(name) || { name })];
  const group = MUSCLES[groupOf(planExercise(name) || { name })] || '';
  const trained = data.sessions.some(s => s.entries.some(en => nameKey(en.name) === nameKey(name)));
  return `<div class="card lib-fig">${libFigure(name, true)}</div>
    <div class="lib-chips"><span class="lib-chip">${kind}</span>${group ? `<span class="lib-chip">${group}</span>` : ''}</div>
    ${e.note ? `<p class="lib-note">${esc(e.note)}</p>` : ''}
    <div class="card">
      <h2>Ausführung</h2>
      <ol class="lib-steps">${(t.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      ${t.tips && t.tips.length ? `<h2>Darauf achten</h2><ul class="lib-tips">${t.tips.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : ''}
      <p class="hint lib-muscles"><b>Zielmuskel:</b> ${group || '–'}${t.also ? ` · <b>mit dabei:</b> ${esc(t.also)}` : ''}</p>
    </div>
    ${trained ? `<button class="btn nav" data-action="open-exercise" data-name="${esc(name)}">Deine Einträge zu dieser Übung</button>` : ''}
    <p class="hint">Die Figur zeigt das Bewegungsprinzip. Bei Unsicherheit lass dir die Übung im Studio zeigen.</p>`;
}

// Trainings einer Kalenderwoche (start = Montag), mit Blättern zur Vor-/Folgewoche
function renderWeek({ start }) {
  const ci = cycleInfo(new Date(start + 'T12:00:00'));
  const sunday = new Date(start + 'T12:00:00');
  sunday.setDate(sunday.getDate() + 6);
  const label = ci.future ? 'Vor dem Start' : cycleWeekLabel(ci.week, ci.buildWeeks);
  const sessions = data.sessions.filter(s => mondayISO(new Date(s.date)) === start)
    .sort((a, b) => a.date.localeCompare(b.date));
  const thisWeek = mondayISO(new Date());

  let h = `<div class="card week-head">
      <button class="icon-btn" data-action="week-shift" data-dir="-1" aria-label="Vorherige Woche">‹</button>
      <div><b>${label}</b>${ci.future ? '' : `<small>Zyklus ${ci.cycle}</small>`}<small>${fmtDate(start + 'T12:00:00')} – ${fmtDate(sunday)}</small></div>
      <button class="icon-btn" data-action="week-shift" data-dir="1" aria-label="Nächste Woche">›</button>
    </div>`;
  if (sessions.length) {
    const tons = sessions.reduce((a, s) => a + sessionTonnage(s), 0);
    h += `<div class="stats two"><div class="stat"><span>Trainings</span><b>${sessions.length}</b></div>
      <div class="stat"><span>Bewegt</span><b>${fmtTons(tons)}</b></div></div>`;
  }
  for (const s of sessions) {
    h += `<button class="btn nav" data-action="open-session" data-id="${s.id}" data-week="${start}">
      ${esc(s.dayName)}<small>${fmtDate(s.date)} · ${s.entries.length} Übungen · ${fmtTons(sessionTonnage(s))}${s.duration ? ' · ⏱ ' + fmtDur(s.duration) : ''}</small></button>`;
  }
  if (!sessions.length) {
    h += `<p class="hint">${start > thisWeek ? 'Diese Woche liegt noch vor dir.' : 'In dieser Woche wurde nicht trainiert.'}</p>`;
  }
  if (start === thisWeek && data.days.length) {
    const per = activePlan().perWeek || 1;
    const open = data.days
      .map(d => ({ d, left: per - sessions.filter(s => s.dayId === d.id).length }))
      .filter(x => x.left > 0);
    h += `<p class="hint">${open.length ? `Noch offen diese Woche: ${open.map(x => esc(x.d.name) + (per > 1 ? ` (${x.left}×)` : '')).join(', ')}`
      : 'Alle Trainings dieser Woche erledigt 💪'}</p>`;
  }
  if (sessions.length) h += '<p class="hint">Training antippen, um es anzusehen oder nachträglich zu ändern.</p>';
  return h;
}

// Arbeitskopie beim Bearbeiten eines gespeicherten Trainings (Werte als Text wie in den Eingabefeldern)
let sessionEdit = null;

function startSessionEdit(s) {
  const txt = n => n == null ? '' : fmtNum(n);
  sessionEdit = {
    id: s.id,
    entries: s.entries.map(e => ({
      comment: e.comment || '',
      sets: e.sets.map(st => ({ weight: txt(st.weight), reps: txt(st.reps), rir: txt(st.rir), variant: st.variant })),
    })),
  };
}

function renderSessionEdit(s) {
  let h = `<p class="sub">${fmtDate(s.date, true)}<br>${esc(s.dayName)}</p>`;
  sessionEdit.entries.forEach((e, ei) => {
    h += `<section class="card"><h2>${esc(s.entries[ei].name)}</h2>
      <div class="setgrid"><span class="head">Satz</span><span class="head">kg</span><span class="head">Wdh.</span><span class="head">Tank</span>`;
    e.sets.forEach((st, si) => {
      const v = variantOf(st);
      h += `<span class="setno ${v ? 'has-v' : ''}">${si + 1}${v ? `<small>${VARIANTS[v]}</small>` : ''}</span>
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="–"
          data-field="se-set" data-prop="weight" data-ei="${ei}" data-si="${si}" value="${esc(st.weight)}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="–"
          data-field="se-set" data-prop="reps" data-ei="${ei}" data-si="${si}" value="${esc(st.reps)}">
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="–" class="tank"
          data-field="se-set" data-prop="rir" data-ei="${ei}" data-si="${si}" value="${esc(st.rir)}">`;
    });
    h += `</div>
      <div class="row">
        <button class="btn" data-action="se-del-set" data-ei="${ei}">− Satz</button>
        <button class="btn" data-action="se-add-set" data-ei="${ei}">+ Satz</button>
      </div>
      <textarea class="inp comment edit-comment" rows="2" data-field="se-comment" data-ei="${ei}"
        placeholder="Kommentar zur Übung …">${esc(e.comment)}</textarea>
    </section>`;
  });
  return h + `<button class="btn primary" data-action="se-save">Änderungen speichern</button>
    <button class="btn center" data-action="back">Abbrechen</button>
    <p class="hint">Übungen ohne Sätze werden aus dem Training entfernt. Nach dem Speichern wird die Steigerung fürs nächste Mal neu berechnet.</p>`;
}

function saveSessionEdit() {
  const s = data.sessions.find(x => x.id === sessionEdit.id);
  const entries = [];
  sessionEdit.entries.forEach((e, ei) => {
    const sets = e.sets
      .map(st => ({ weight: parseNum(st.weight), reps: parseNum(st.reps), rir: parseNum(st.rir),
        ...(st.variant ? { variant: st.variant } : {}) }))
      .filter(st => st.weight != null || st.reps != null);
    if (!sets.length) return;
    const en = { ...s.entries[ei], sets };
    if (e.comment.trim()) en.comment = e.comment.trim(); else delete en.comment;
    entries.push(en);
  });
  if (!entries.length) {
    alert('Es muss mindestens ein Satz eingetragen sein. Um das ganze Training zu entfernen, „Dieses Training löschen“ verwenden.');
    return false;
  }
  s.entries = entries;
  recalcResults(s);
  saveData();
  sessionEdit = null;
  return true;
}

// Nach dem Bearbeiten: Ergebnis (Gewicht fürs nächste Mal) neu berechnen; ist es das neueste Training
// dieser Übung, auch „Max. bei 10 Wdh.“ im Plan
function recalcResults(s) {
  if (s.deload || (s.progression && !s.progression.load)) return;
  const list = sessionsNewestFirst();
  const idx = list.indexOf(s);
  const has = (x, k) => x.entries.find(e => nameKey(e.name) === k);
  for (const en of s.entries) {
    const k = nameKey(en.name);
    const result = entryResult(en);
    if (!result) { delete en.result; continue; }
    en.result = result;
    if (!list.slice(0, idx).some(x => has(x, k))) setPlanMax10(en.name, result.max10);
  }
}

function renderSession({ id, fresh, edit, week }) {
  const s = data.sessions.find(x => x.id === id);
  if (!s) return '<p class="hint">Training nicht gefunden.</p>';
  if (edit) {
    if (!sessionEdit || sessionEdit.id !== id) startSessionEdit(s);
    return renderSessionEdit(s);
  }
  const won = fresh || [];
  const top = (won.length ? `<div class="card award-new">${won.map(a =>
      `<div class="award-row"><span class="award-icon">${a.icon}</span><div><b>Neuer Erfolg: ${esc(a.name)}</b><small>${esc(a.desc)}</small></div></div>`).join('')}</div>` : '') +
    `<div class="stats two"><div class="stat"><span>Bewegt (Tonnage)</span><b>${fmtTons(sessionTonnage(s))}</b></div>
      <div class="stat"><span>Dauer</span><b>${s.duration ? fmtDur(s.duration) : '–'}</b></div></div>`;
  const progNote = s.progression ? ` · ${progOffText(s.progression)}` : '';
  let h = top + `<p class="sub">${fmtDate(s.date, true)}<br>${esc(s.dayName)}${s.deload ? ' · Deload-Woche (keine Steigerung)' : progNote}` +
    (s.readiness ? `<br>Tagesform: ${readinessText(s.readiness)}` : '') + '</p>' +
    `<button class="btn outline" data-action="se-edit" data-id="${s.id}">✎ Training bearbeiten</button><ul class="list">`;
  for (const e of s.entries) {
    const res = e.result
      ? `<div class="result">${resultText(e.result)}<br>Nächstes Mal: <b>${fmtNum(e.result.next)} kg</b></div>`
      : '';
    const instead = e.replacedFrom ? ` <small>statt ${esc(e.replacedFrom)}</small>` : '';
    const comment = e.comment ? `<div class="comment-text">💬 ${esc(e.comment)}</div>` : '';
    const warm = e.warmup && e.warmup.length
      ? `<div class="warm-line">🔥 Aufwärmen: ${e.warmup.map(fmtSet).join(' · ')}</div>` : '';
    h += `<li><div class="date">${esc(e.name)}${instead}</div>${warm}
      <div class="sets">${e.sets.map(fmtSet).join('<br>')}</div>${comment}${res}</li>`;
  }
  return h + `</ul><button class="btn danger" data-action="del-session" data-id="${s.id}">Dieses Training löschen</button>`;
}

function renderCheck({ id, step, areas }) {
  const total = currentComplaints() == null ? 3 : 2;  // Beschwerden nur einmal pro Zyklus
  if (step === 3) {
    const sel = areas || [];
    return `<div class="card check">
      <p class="sub">${esc(findDay(id).name)} · Frage 3 von 3 · einmal pro Zyklus</p>
      <h2 class="question">Hast du aktuell Beschwerden oder Schmerzen?</h2>
      <div class="area-grid">${Object.entries(BODY_AREAS).map(([k, a]) =>
        `<button class="vchip ${sel.includes(k) ? 'on' : ''}" data-action="check-area" data-k="${k}">${a.label}</button>`).join('')}</div>
      <div class="row">
        <button class="btn" data-action="check-areas-done" data-none="1">Keine</button>
        <button class="btn primary" data-action="check-areas-done">Weiter</button>
      </div>
      <p class="hint">Mehrere antippen möglich. Betroffene Übungen bekommen in diesem Zyklus einen Hinweis.</p>
    </div>`;
  }
  const [emoji, q] = step === 1 ? ['😴', 'Hast du gut geschlafen?'] : ['😫', 'Hattest du sonst viel Stress?'];
  return `<div class="card check">
    <p class="sub">${esc(findDay(id).name)} · Frage ${step} von ${total}</p>
    <div class="check-emoji" aria-hidden="true">${emoji}</div>
    <h2 class="question">${q}</h2>
    <div class="row">
      <button class="btn primary" data-action="check-answer" data-answer="yes">Ja</button>
      <button class="btn primary" data-action="check-answer" data-answer="no">Nein</button>
    </div>
  </div>`;
}

const readinessText = r => {
  if (!r) return '';
  const parts = [];
  if (!r.sleptWell) parts.push('schlecht geschlafen');
  if (r.stress) parts.push('viel Stress');
  return parts.join(', ');
};

function renderData() {
  return `<div class="card">
      <h2>Deine Daten</h2>
      <p>${data.days.length} Trainingstage · ${data.sessions.length} gespeicherte Trainings</p>
      <p class="hint">Alles wird nur auf diesem Gerät gespeichert. Mach regelmäßig eine Sicherung, z. B. in der Dateien-App oder iCloud Drive.</p>
    </div>
    <button class="btn primary" data-action="export">Sicherung exportieren</button>
    <button class="btn center" data-action="import">Sicherung importieren</button>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
    <p class="hint">Beim Importieren werden die aktuellen Daten durch die Sicherung ersetzt.</p>
    <h2>Daten löschen</h2>
    <button class="btn danger" data-action="reset-trainings">Trainings löschen, Plan behalten</button>
    <button class="btn danger" data-action="reset-all">Alles zurücksetzen</button>
    <p class="hint">„Trainings löschen“ entfernt alle gespeicherten Trainings, Körpergewicht und Schritte – die Trainingstage mit ihren Übungen bleiben (das „Max. kg bei 10 Wdh.“ wird geleert). „Alles zurücksetzen“ macht die App wieder wie neu. Vorher am besten eine Sicherung exportieren.</p>
`;
}

/* ---------- Aktionen ---------- */

// Vor dem Training: zwei kurze Fragen, danach startDay mit dem Abzug
function beginCheck(id) {
  const day = findDay(id);
  if (!day.exercises.some(e => e.name.trim())) {
    alert('Dieser Trainingstag hat noch keine Übungen. Lege sie unter „Plan“ an.');
    return;
  }
  if (draft && !confirm(`Es läuft bereits ein Training (${draft.dayName}). Verwerfen und neu beginnen?`)) return;
  if (cycleInfo().deload) startDay(id);  // Deload ist ohnehin leicht -> keine Fragen, kein Abzug
  else go('check', { id, step: 1 });
}

// readiness = { sleptWell, stress }; jede negative Antwort zieht 1 Wdh. pro Übung ab
function startDay(id, readiness = { sleptWell: true, stress: false }) {
  const day = findDay(id);
  const exercises = day.exercises.filter(e => e.name.trim());
  if (!exercises.length) return;

  const ci = cycleInfo();
  draft = {
    dayId: day.id,
    dayName: day.name,
    date: new Date().toISOString(),
    deload: ci.deload,
    intro: ci.intro,
    cycleStart: ci.cycleStart,
    week: ci.week,
    readiness,
    penalty: ci.deload ? 0 : (readiness.sleptWell ? 0 : 1) + (readiness.stress ? 1 : 0),
    // Progression für dieses Training: Einstellung der Woche, im Training noch änderbar (Deload: ohnehin keine)
    progression: ci.deload ? { volume: true, load: true } : weekProgression(mondayISO(new Date())),
    occurrence: nextOccurrence(day.id, ci),  // 2 = dieser Tag wurde diese Woche schon einmal trainiert
    entries: [],
  };
  // erst nach dem Anlegen von draft, weil setupEntry die Zykluswoche aus draft liest
  draft.entries = draftEntries(day);
  saveDraft();
  go('training');
  const dur = lastDuration(day.id);
  if (dur) toast(`⏱ Letztes Mal hat „${day.name}“ ${fmtDur(dur)} gedauert`);
}

// Übungen des Trainings laut Plan, Zykluswoche und Progression (draft.progression)
function draftEntries(day) {
  const bw = data.cycle.buildWeeks;
  const prog = draft.progression;
  // Sätze aus dem Wochenvolumen der Muskelgruppen (nur bei Tag-Typ); ohne Volumenprogression wie in der Vorwoche
  const setsWeek = draft.deload ? draft.week
    : volumeWeek({ week: draft.week, cycleStart: draft.cycleStart }, prog.volume);
  const auto = autoSetsForDay(day, setsWeek, draft.deload);
  return day.exercises.filter(e => e.name.trim()).map(ex => {
    const en = { name: ex.name.trim() };
    // Ziel im Tank aus Zykluswoche und Übungsart (Deload: Wert der letzten Trainingswoche, dann mind. 3)
    const week = draft.deload ? bw : draft.week;
    const rir = rirFor(kindOf(ex), week, bw, groupOf(ex));
    const rirText = rirLabel(kindOf(ex), week, bw, groupOf(ex));
    // Sätze: automatisch aus dem Muskelgruppen-Volumen, sonst laut Wochenplan der Übung
    // (Deload: Sätze der letzten Woche, werden dort halbiert)
    const fixedSets = auto.has(ex.id);
    const sets = fixedSets ? auto.get(ex.id) : setsForWeek(ex, draft.deload ? bw : setsWeek, bw);
    const target = { sets, fixedSets, reps: repsFor(day, ex), rir, rirText, max10: ex.max10, step: stepFor(ex) };
    if (!draft.deload && !prog.load) target.hold = true;  // Gewicht/Wdh. vom letzten Mal halten
    setupEntry(en, target, () => ex.variant);
    return en;
  });
}

// Ziel und vorgeschlagene Sätze einer Übung je nach Zykluswoche festlegen:
// Deload -> halbiert & leichter; sonst Werte der Vergleichswoche + 1 Wdh., falls vorhanden
// variantFor(i) liefert die Ausführungsvariante von Satz i
function setupEntry(en, target, variantFor = () => '') {
  en.plan = target;
  if (draft.deload) target = deloadTarget(target);
  else if (draft.intro) target = { ...target, intro: true };
  // ohne Gewichtsprogression (hold) keine Bezugswochen – es gelten die Werte vom letzten Mal
  const cmp = draft.deload || target.hold ? null : comparisonEntry(en.name, draft.dayId, draft);
  const prev = draft.deload || draft.intro || target.hold ? null : previousWeekEntry(en.name, draft.dayId, draft);
  // Satzzahl laut Wochenplan der Übung (Deload: halbiert)
  const n = target.sets;
  en.target = { ...target, sets: n };
  en.compare = cmp;
  en.prevWeek = prev;
  // 2. Training dieses Tages in der Woche: nie mehr als im 1. Training dieser Woche geschafft
  en.weekFirst = draft.occurrence > 1 && !draft.deload ? weekFirstEntry(en.name, draft.dayId, draft) : null;
  en.rule = null;
  en.base = buildSets(en.name, en.target);  // Vorschlag ohne Bezugswoche
  en.sets = [];
  en.planned = [];  // ursprünglicher Vorschlag, damit die Bremse nächste Woche vergleichen kann
  for (let i = 0; i < n; i++) applyProposal(en, i, variantFor(i) || '');
  en.note = null;
  en.warmup = null;  // Aufwärmen wird beim Anzeigen passend zum ersten Arbeitssatz vorgeschlagen
  en.warmupEdited = false;
}

// Vorgeschlagene Sätze für den Trainingsstart
function buildSets(name, target) {
  // Gewicht aus der Progression; ohne Max.-Wert das Gewicht vom letzten Mal
  const last = lastEntry(name);
  const tw = target.deload ? target.weight : targetWeight(target);
  const sets = [];
  const lastSets = last ? ofVariant(last.sets, '') : [];  // nur normale Sätze als Bezug
  for (let i = 0; i < target.sets; i++) {
    const ls = lastSets[i] || lastSets[lastSets.length - 1];
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
  const variants = en.sets.map(variantOf);
  setupEntry(en, { ...plan, max10, step: stepFor(ex || { name, step: null }) },
    i => variants[Math.min(i, variants.length - 1)]);
}

// Ergebnis einer Übung fürs nächste Mal, gemessen am ersten normalen Satz (null, wenn Werte fehlen).
// max10 steht auch im Ergebnis – für Ersatzübungen, die nicht im Plan stehen.
function entryResult(en) {
  const first = en.sets.find(s => !s.variant);
  if (!en.target || !first || first.weight == null || first.reps == null || first.rir == null) return null;
  const t = { step: 2.5, ...en.target };
  const result = progression(first, t);
  result.max10 = Math.round(result.next / repFactor(t.reps + t.rir) * 10) / 10;
  return result;
}

const setPlanMax10 = (name, max10) => {
  for (const day of data.days) {
    for (const ex of day.exercises) if (nameKey(ex.name) === nameKey(name)) ex.max10 = max10;
  }
};

function saveTraining() {
  const entries = draft.entries
    .map(en => ({
      name: en.name,
      ...(en.replacedFrom ? { replacedFrom: en.replacedFrom } : {}),
      target: en.target,
      planned: en.planned,
      ...((en.comment || '').trim() ? { comment: en.comment.trim() } : {}),
      // Aufwärmen (zählt nicht als Arbeitssatz); selbst angepasst = Vorschlag fürs nächste Mal
      ...(en.warmup && (en.warmup.length || en.warmupEdited) ? { warmup: warmupForSession(en) } : {}),
      ...(en.warmupEdited ? { warmupCustom: true } : {}),
      // Nur Sätze, die man angefasst hat – unveränderte Vorschläge zählen nicht als erledigt
      sets: en.sets
        .filter(s => s.touched)
        .map(s => ({
          weight: parseNum(s.weight), reps: parseNum(s.reps), rir: parseNum(s.rir),
          ...(s.variant ? { variant: s.variant } : {}),
        }))
        .filter(s => s.weight != null || s.reps != null),
    }))
    .filter(en => en.sets.length);

  if (!entries.length) {
    alert('Es ist noch nichts eingetragen.');
    return;
  }

  // Progression berechnen und „Max. bei 10 Wdh.“ im Plan aktualisieren
  // (nicht in der Deload-Woche und nicht ohne Gewichts-/Wdh.-Progression)
  const prog = draft.progression || { volume: true, load: true };
  for (const en of draft.deload || !prog.load ? [] : entries) {
    const result = entryResult(en);
    if (!result) continue;
    en.result = result;
    setPlanMax10(en.name, result.max10);
  }

  const session = { id: uid(), dayId: draft.dayId, dayName: draft.dayName, date: draft.date, entries };
  if (draft.deload) session.deload = true;
  else if (!prog.volume || !prog.load) session.progression = { volume: prog.volume, load: prog.load };
  if (draft.penalty) session.readiness = draft.readiness;
  if (draft.cycleStart) Object.assign(session, { cycleStart: draft.cycleStart, week: draft.week });
  // Trainingsdauer in Minuten (über 10 Stunden = vermutlich vergessen zu speichern -> nicht werten)
  const minutes = Math.round((Date.now() - Date.parse(draft.date)) / 60000);
  if (minutes > 0 && minutes < 600) session.duration = minutes;
  const fresh = withAwards(() => data.sessions.push(session));  // neue Erfolge als Mitteilung
  saveData();
  draft = null;
  saveDraft();
  toast('Training gespeichert ✔');
  go('session', { id: session.id, fresh });
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
    const plans = Array.isArray(d.plans) ? `${d.plans.length} Plänen` : `${d.days.length} Trainingstagen`;
    if (!confirm(`Sicherung mit ${plans} und ${d.sessions.length} Trainings laden?\n\nDie aktuellen Daten werden ersetzt.`)) return;
    data = upgradeData({
      app: 'trainingsapp', version: 1,
      plans: d.plans, activePlanId: d.activePlanId,
      days: d.days, volume: d.volume, rirPlan: d.rirPlan,  // ältere Sicherungen mit nur einem Plan
      sessions: d.sessions, bodyweight: d.bodyweight, cycle: d.cycle, steps: d.steps,
      complaints: d.complaints, hintsDismissed: d.hintsDismissed, dayTemplates: d.dayTemplates,
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

// Vorschlagsliste eines Eingabefelds: direkt dahinter oder – wenn das Feld in einer Zeile mit
// einem Knopf steht (z. B. i-Knopf im Trainingstag) – hinter dieser Zeile
function suggestBoxFor(input) {
  const next = input.nextElementSibling;
  if (next && next.classList.contains('suggest')) return next;
  const row = input.closest('.ex-name-row');
  return row ? row.nextElementSibling : next;
}

function showSuggestions(input, pool) {
  const box = suggestBoxFor(input);
  const list = suggestions(input.value, pool);
  box.innerHTML = list.map(s => `<button type="button" data-action="pick"
    data-name="${esc(s.name)}">${esc(s.name)}${s.own ? ' <small>★</small>' : ''}</button>`).join('');
  box.hidden = !list.length;
}

// Variante eines Satzes ändern. Noch nicht angefasste Sätze bekommen einen neuen Vorschlag
// aus den Bezugssätzen dieser Variante; eigene Eingaben bleiben stehen.
function changeVariant(en, i, v) {
  const s = en.sets[i];
  if (variantOf(s) === v) return;
  if (!en.base || s.touched) { s.variant = v; return; }
  applyProposal(en, i, v);
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
  // back: Name der Ansicht oder Funktion (params) => [Ansicht, params]
  back: () => {
    const b = views[current.view].back;
    const [view, params] = typeof b === 'function' ? b(current.params) : [b, {}];
    const y = current.params.returnY;  // z. B. zurück an dieselbe Stelle im Training
    go(view, params);
    if (y != null) window.scrollTo(0, y);
  },
  lib: () => go('library'),
  // data-name, im Trainingstag data-i (der Name kann sich beim Tippen geändert haben)
  'lib-open': el => {
    const v = views[current.view];
    const tab = typeof v.tab === 'function' ? v.tab(current.params) : v.tab;
    const name = el.dataset.name || (current.view === 'day' ? findDay(current.params.id).exercises[el.dataset.i].name : '');
    if (!name) return;
    go('libex', { name, from: current.view, fromParams: current.params, returnY: window.scrollY, tab });
  },
  // Muskelgruppe auf-/zuklappen (Liste wird erst beim Aufklappen gezeichnet)
  'lib-toggle': el => {
    const g = el.dataset.g;
    if (libOpenGroups.has(g)) libOpenGroups.delete(g); else libOpenGroups.add(g);
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
  },
  resume: () => go('training'),
  'start-day': el => beginCheck(el.dataset.id),
  'check-answer': el => {
    const yes = el.dataset.answer === 'yes';
    const { id, step } = current.params;
    if (step === 1) go('check', { id, step: 2, sleptWell: yes });
    else if (currentComplaints() == null) go('check', { id, step: 3, sleptWell: current.params.sleptWell, stress: yes, areas: [] });
    else startDay(id, { sleptWell: current.params.sleptWell, stress: yes });
  },
  'check-area': el => {
    const areas = current.params.areas || [];
    const k = el.dataset.k;
    current.params.areas = areas.includes(k) ? areas.filter(a => a !== k) : [...areas, k];
    render();
  },
  'check-areas-done': el => {
    const { id, sleptWell, stress } = current.params;
    const areas = el.dataset.none ? [] : current.params.areas || [];
    data.complaints.push({ cycleStart: cycleInfo().cycleStart, date: new Date().toISOString(), areas });
    saveData();
    startDay(id, { sleptWell, stress });
  },
  'hint-dismiss': el => {
    data.hintsDismissed[el.dataset.key] = cycleInfo().cycleStart;  // gilt bis zum nächsten Zyklus
    saveData(); render();
  },
  // Hinweis auf den letzten Kommentar ausblenden (im Verlauf bleibt der Kommentar stehen)
  'reorder-toggle': () => {
    draft.reorder = !draft.reorder;
    saveDraft(); render();
  },
  'tr-move': el => {
    const i = +el.dataset.ei, j = i + Number(el.dataset.dir);
    if (j < 0 || j >= draft.entries.length) return;
    [draft.entries[i], draft.entries[j]] = [draft.entries[j], draft.entries[i]];
    saveDraft(); render();
  },
  'comment-dismiss': el => {
    const s = data.sessions.find(x => x.id === el.dataset.sid);
    const e = s && s.entries.find(en => nameKey(en.name) === nameKey(el.dataset.name));
    if (!e) return;
    e.commentHidden = true;
    saveData(); render();
  },
  'comment-toggle': el => {
    const en = draft.entries[el.dataset.ei];
    en.commentOpen = !en.commentOpen;
    saveDraft(); render();
    if (en.commentOpen) $view.querySelector(`[data-field="tr-comment"][data-ei="${el.dataset.ei}"]`).focus();
  },

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
      variant: variantOf(prev),
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
    findDay(current.params.id).exercises.push(withDefaults({ id: uid(), name: '', sets: 2, setsEnd: 3 }));
    saveData(); render();
    const inputs = $view.querySelectorAll('[data-field="ex-name"]');
    inputs[inputs.length - 1].focus();
  },
  pick: el => {
    const box = el.closest('.suggest');
    const prev = box.previousElementSibling;
    const input = prev.matches('input') ? prev : prev.querySelector('input');
    input.value = el.dataset.name;
    box.hidden = true;
    input.blur();
    if (input.dataset.field === 'ex-name') {
      findDay(current.params.id).exercises[input.dataset.i].name = el.dataset.name;
      const info = prev.querySelector && prev.querySelector('.info-btn');
      if (info) info.hidden = !libEntry(el.dataset.name);
      saveData();
    } else if (input.dataset.field === 'chart-name') {
      showChartFor(el.dataset.name);
    } else if (input.dataset.field === 'wiz-add') {
      wizAddPick(el.dataset.name);
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
  'add-open': () => {
    draft.adding = true;
    saveDraft(); render();
    const input = $view.querySelector('[data-field="add-name"]');
    if (input) { input.scrollIntoView({ block: 'center' }); input.focus(); }
  },
  'add-cancel': () => { draft.adding = false; saveDraft(); render(); },
  'add-ok': el => {
    const panel = el.closest('.replace');
    const name = panel.querySelector('[data-field="add-name"]').value.trim();
    if (!name) { alert('Bitte eine Übung eingeben.'); return; }
    const max10 = parseNum(panel.querySelector('[data-field="rep-max"]').value);
    const sets = Number(panel.querySelector('#add-sets').value);
    const keep = panel.querySelector('#add-keep').checked;
    const day = findDay(draft.dayId);
    const ex = withDefaults({ id: uid(), name, sets, setsEnd: sets, max10 });
    // Ziele wie bei einer Plan-Übung: Wdh. nach Tag-Typ, Tank nach Art und Zykluswoche; Satzzahl wie gewählt
    const bw = data.cycle.buildWeeks;
    const week = draft.deload ? bw : draft.week || 1;
    const en = { name, added: true };
    setupEntry(en, {
      sets, fixedSets: true, reps: repsFor(day, ex),
      rir: rirFor(kindOf(ex), week, bw, groupOf(ex)), rirText: rirLabel(kindOf(ex), week, bw, groupOf(ex)),
      max10, step: stepFor(ex),
    });
    draft.entries.push(en);
    draft.adding = false;
    if (keep && day) {
      day.exercises.push(ex);
      saveData();
    }
    saveDraft(); render();
    const cards = $view.querySelectorAll('section.card');
    if (cards.length) cards[cards.length - 1].scrollIntoView({ block: 'start' });
    toast(keep ? `${name} hinzugefügt und im Plan gespeichert` : `${name} für heute hinzugefügt`);
  },
  'added-remove': el => {
    const en = draft.entries[el.dataset.ei];
    if (en.sets.some(s => s.touched) && !confirm(`„${en.name}“ mit den eingetragenen Sätzen entfernen?`)) return;
    draft.entries.splice(el.dataset.ei, 1);
    saveDraft(); render();
  },
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
  'plan-activate': el => {
    if (data.activePlanId === el.dataset.id) return;
    if (draft && !confirm(`Es läuft noch ein Training (${draft.dayName}). Trotzdem den Plan wechseln?`)) return;
    data.activePlanId = el.dataset.id;
    const wasEnded = !!activePlan().endedAt;
    delete activePlan().endedAt;
    saveData(); render();
    toast(`„${activePlan().name}“ ist ${wasEnded ? 'wieder' : 'jetzt'} aktiv`);
  },
  // Plan beenden: bleibt in der Liste (beendet am …), danach ist kein Plan aktiv
  'plan-end': () => {
    const p = activePlan();
    if (draft) { alert(`Es läuft noch ein Training (${draft.dayName}). Bitte erst speichern oder verwerfen.`); return; }
    if (!confirm(`Plan „${p.name}“ beenden?\n\nEr bleibt in der Liste und kann jederzeit wieder aktiviert werden. Trainings, Verlauf und Erfolge bleiben erhalten.`)) return;
    p.endedAt = todayISO();
    data.activePlanId = null;
    saveData(); render();
    toast(`„${p.name}“ beendet`);
  },
  'plan-rename': el => {
    const p = data.plans.find(x => x.id === el.dataset.id);
    const name = prompt('Neuer Name für den Plan:', p.name);
    if (name && name.trim()) { p.name = name.trim(); saveData(); render(); }
  },
  'plan-delete': el => {
    const p = data.plans.find(x => x.id === el.dataset.id);
    if (!confirm(`Plan „${p.name}“ mit ${p.days.length} Trainingstagen löschen?`)) return;
    if (!confirm('Wirklich löschen? Das lässt sich nicht rückgängig machen.\n\nGespeicherte Trainings, Verlauf und Erfolge bleiben erhalten.')) return;
    data.plans = data.plans.filter(x => x !== p);
    if (!data.plans.length) {
      data.plans.push(newPlan('Mein Plan'));  // es gibt immer mindestens einen Plan
      data.activePlanId = data.plans[0].id;
    } else if (!data.plans.some(x => x.id === data.activePlanId)) {
      data.activePlanId = null;  // aktiven Plan gelöscht -> kein Plan aktiv (nicht einfach einen anderen starten)
    }
    saveData(); render();
    toast('Plan gelöscht');
  },
  'day-type': el => {
    const day = findDay(current.params.id);
    if (!day.groups) day.groups = dayGroups(day);  // geplante Muskelgruppen beim Umstellen behalten
    day.intensity = el.dataset.t || null;
    delete day.type;
    saveData(); render();
  },
  'load-template': () => {
    const replace = data.days.length && confirm('Vorhandene Trainingstage durch den Standard-Plan ersetzen?\n\n„Abbrechen“ = die 4 Tage zusätzlich anlegen. Gespeicherte Trainings bleiben in beiden Fällen erhalten.');
    const days = TEMPLATE_DAYS.map(t => ({
      id: uid(),
      name: t.name,
      type: t.type,
      exercises: t.exercises.map(name => withDefaults({ id: uid(), name })),
    }));
    data.days = replace ? days : data.days.concat(days);
    saveData();
    toast('Standard-Plan angelegt ✔');
    render();
  },
  'vol-del': el => {
    const g = el.dataset.g;
    if (!confirm(`„${MUSCLES[g] || g}“ entfernen? Übungen dieser Muskelgruppe bekommen ihre Sätze dann wieder von Hand.`)) return;
    delete data.volume[g];
    if (activePlan().volExtra) delete activePlan().volExtra[g];
    saveData(); go('plan', { volOpen: true });
  },
  'vol-reset': () => {
    if (!confirm('Alle Sätze pro Muskelgruppe auf die Standardwerte zurücksetzen?')) return;
    data.volume = defaultVolume();
    activePlan().volExtra = {};
    saveData(); go('plan', { volOpen: true });
    toast('Standardwerte wiederhergestellt');
  },
  'plan-kind': el => {
    findDay(current.params.id).exercises[el.dataset.i].kind = el.dataset.k;
    saveData(); render();
  },
  'cycle-weeks': el => {
    data.cycle.buildWeeks = Math.min(5, Math.max(4, data.cycle.buildWeeks + Number(el.dataset.delta)));
    saveData(); render();
  },
  // diese Woche als gewählte Zykluswoche zählen (Intro … Deload), der Zyklus verschiebt sich
  'cycle-jump': el => {
    const w = Number(el.dataset.w);
    const label = cycleWeekLabel(w);
    const ci = cycleInfo();
    if (!ci.future && ci.week === w) return;
    if (!confirm(`Ab dieser Woche mit der ${label} weitermachen?\n\nDer Zyklus wird entsprechend verschoben.`)) return;
    data.cycle.start = addWeeks(mondayISO(new Date()), -(w - 1));
    delete data.cycle.begin;
    saveData(); render();
    toast(`Diese Woche: ${label}`);
  },
  'plan-variant': el => {
    findDay(current.params.id).exercises[el.dataset.i].variant = el.dataset.v;
    saveData(); render();
  },
  // Ganze Übung: alle noch offenen Sätze auf die Variante stellen
  'ex-variant': el => {
    const ei = +el.dataset.ei;
    const en = draft.entries[ei];
    en.sets.forEach((s, i) => { if (!isDone(s)) changeVariant(en, i, el.dataset.v); });
    recalcSets(ei); saveDraft(); render();
  },
  // Einzelner Satz: normal -> mit Pause -> langsam -> normal
  'set-variant': el => {
    const ei = +el.dataset.ei, si = +el.dataset.si;
    const en = draft.entries[ei];
    const order = Object.keys(VARIANTS);
    const next = order[(order.indexOf(variantOf(en.sets[si])) + 1) % order.length];
    changeVariant(en, si, next);
    recalcSets(ei); saveDraft(); render();
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
    // Letzte Woche nie weniger Sätze als die Intro-Woche
    if (prop === 'sets' && ex.setsEnd < ex.sets) ex.setsEnd = ex.sets;
    if (prop === 'setsEnd' && ex.setsEnd < ex.sets) ex.setsEnd = ex.sets;
    saveData(); render();
  },

  'open-exercise': el => go('exercise', { name: el.dataset.name }),
  'open-session': el => go('session', { id: el.dataset.id, week: el.dataset.week }),
  'del-session': el => {
    if (!confirm('Dieses Training endgültig löschen?')) return;
    data.sessions = data.sessions.filter(s => s.id !== el.dataset.id);
    saveData(); toast('Training gelöscht');
    if (current.params.week) go('week', { start: current.params.week }); else go('history');
  },
  // Progression nur für dieses Training umschalten -> Vorschläge neu berechnen
  'prog-today': el => {
    const day = findDay(draft.dayId);
    if (!day) { alert('Der Trainingstag steht nicht mehr im Plan.'); return; }
    const changed = draft.entries.some(en => en.added || en.replacedFrom || en.sets.some(s => s.touched));
    if (changed && !confirm('Die Vorschläge werden neu berechnet. Schon eingetragene Werte, ersetzte und hinzugefügte Übungen gehen dabei verloren. Fortfahren?')) return;
    const key = el.dataset.key;
    draft.progression = { ...draft.progression, [key]: !draft.progression[key] };
    const comments = new Map(draft.entries.map(en => [nameKey(en.name), en.comment]));
    draft.entries = draftEntries(day);
    draft.entries.forEach(en => { if (comments.get(nameKey(en.name))) en.comment = comments.get(nameKey(en.name)); });
    saveDraft(); render();
    toast(`${PROG_KEYS[key]}: Progression heute ${draft.progression[key] ? 'an' : 'aus'}`);
  },
  // Wie oft jeder Trainingstag pro Woche absolviert wird – Sätze pro Training auf Wunsch so anpassen,
  // dass die Wochensumme gleich bleibt
  'plan-perweek': el => {
    const p = activePlan(), n = Number(el.dataset.n), old = p.perWeek || 1;
    if (n === old) return;
    if (confirm(`Sätze pro Training anpassen, damit die Sätze pro Woche gleich bleiben?\n\n(${n > old ? 'ungefähr halbiert' : 'verdoppelt'}; „Abbrechen“ lässt die Sätze pro Training, wie sie sind)`)) {
      for (const g of Object.keys(p.volume)) p.volume[g] = p.volume[g].map(v => Math.max(1, Math.round(v * old / n)));
    }
    p.perWeek = n;
    saveData(); render();
  },
  // Progression im Plan: Grundeinstellung (ganzer Zyklus) bzw. eine einzelne Woche (data-monday)
  'prog-plan': el => {
    const p = activePlan(), key = el.dataset.key;
    p.progression = { ...planProgression(p), [key]: !planProgression(p)[key] };
    // Wochen, die jetzt der Grundeinstellung entsprechen, sind keine Abweichung mehr
    for (const [monday, own] of Object.entries(p.weekProgression)) {
      if (own[key] === p.progression[key]) delete own[key];
      if (!Object.keys(own).length) delete p.weekProgression[monday];
    }
    saveData(); render();
  },
  'prog-week': el => {
    const p = activePlan(), key = el.dataset.key, monday = el.dataset.monday;
    const value = !weekProgression(monday)[key];
    const own = { ...(p.weekProgression[monday] || {}) };
    if (value === planProgression(p)[key]) delete own[key]; else own[key] = value;  // wie Grundeinstellung -> keine Abweichung
    if (Object.keys(own).length) p.weekProgression[monday] = own; else delete p.weekProgression[monday];
    saveData(); render();
  },
  // Aufwärmsatz hinzufügen: etwas schwerer als der letzte (+20 % vom Arbeitssatz, höchstens 90 %), weniger Wdh.
  'wu-add': el => {
    const en = draft.entries[el.dataset.ei];
    const last = en.warmup[en.warmup.length - 1];
    const pct = last ? Math.min(0.9, last.pct + 0.2) : WARM_PCT;
    const reps = last ? Math.max(3, (parseNum(last.reps) || WARM_REPS) - 3) : WARM_REPS;
    const work = firstWorkWeight(en);
    en.warmup.push({ pct, weight: work ? fmtNum(warmWeight(en, pct, work)) : '', reps: String(reps) });
    en.warmupEdited = true;
    saveDraft(); render();
  },
  'wu-del': el => {
    const en = draft.entries[el.dataset.ei];
    en.warmup.pop();
    en.warmupEdited = true;
    saveDraft(); render();
  },
  // Wochenansicht: Woche w des aktuellen Zyklus öffnen bzw. eine Woche vor/zurück blättern
  'week-open': el => go('week', { start: addWeeks(cycleInfo().cycleStart, Number(el.dataset.w) - 1) }),
  'week-shift': el => go('week', { start: addWeeks(current.params.start, Number(el.dataset.dir)) }),
  // gespeichertes Training nachträglich bearbeiten
  'se-edit': el => {
    startSessionEdit(data.sessions.find(s => s.id === el.dataset.id));
    go('session', { id: el.dataset.id, week: current.params.week, edit: true });
  },
  'se-add-set': el => {
    const sets = sessionEdit.entries[el.dataset.ei].sets;
    const last = sets[sets.length - 1];
    sets.push(last ? { ...last } : { weight: '', reps: '', rir: '' });
    render();
  },
  'se-del-set': el => {
    const sets = sessionEdit.entries[el.dataset.ei].sets;
    if (sets.length) sets.pop();
    render();
  },
  'se-save': () => {
    const { id, week } = current.params;
    let ok = false;
    withAwards(() => { ok = saveSessionEdit(); });  // nachträglich mehr geschafft -> evtl. neuer Erfolg
    if (!ok) return;
    toast('Änderungen gespeichert ✔');
    go('session', { id, week });
  },

  export: () => exportData(),
  import: () => document.getElementById('import-file').click(),
  'reset-trainings': () => {
    if (!confirm(`Alle ${data.sessions.length} Trainings, Körpergewicht und Schritte löschen?\n\nDie Trainingstage mit ihren Übungen bleiben erhalten.`)) return;
    if (!confirm('Wirklich löschen? Das lässt sich nicht rückgängig machen.')) return;
    Object.assign(data, { sessions: [], bodyweight: [], steps: [], complaints: [], hintsDismissed: {} });
    // Max.-Werte stammen aus den gelöschten Trainings -> neu eintragen lassen
    data.plans.forEach(p => p.days.forEach(d => d.exercises.forEach(e => { e.max10 = null; })));
    data.cycle.start = mondayISO(new Date());
    delete data.cycle.begin;
    saveData();
    draft = null; saveDraft();
    toast('Trainings gelöscht – Plan ist noch da');
    go('plan');
  },
  'reset-all': () => {
    if (!confirm('Wirklich ALLES löschen?\n\nPlan, Trainings, Körpergewicht, Schritte und Einstellungen werden entfernt.')) return;
    if (!confirm('Letzte Nachfrage: Das lässt sich nicht rückgängig machen. Fortfahren?')) return;
    data = upgradeData(emptyData());
    saveData();
    draft = null; saveDraft();
    toast('App zurückgesetzt');
    go('start');
  },
};

// Eingabefelder schreiben direkt in die Daten (ohne neu zu zeichnen)
const fields = {
  'day-name': el => { findDay(current.params.id).name = el.value; saveData(); },
  // Suche in der Bibliothek: nur die Trefferliste neu zeichnen, damit das Feld den Fokus behält
  'lib-search': el => {
    libQuery = el.value;
    $view.querySelector('#lib-results').innerHTML = libResults();
    $view.querySelector('#lib-groups').hidden = !!libQuery.trim();
  },
  'se-set': el => { sessionEdit.entries[el.dataset.ei].sets[el.dataset.si][el.dataset.prop] = el.value; },
  'se-comment': el => { sessionEdit.entries[el.dataset.ei].comment = el.value; },
  // Sätze pro Muskelgruppe ändern – nur die Wochensumme neu anzeigen, damit das Feld den Fokus behält
  // Sätze pro Training: gilt für alle Tage gleich (Zusatzsätze dieser Woche entfallen), Wochenzahl anpassen
  vol: el => {
    const n = parseInt(el.value, 10);
    if (!isFinite(n) || n < 0 || n > 30) return;
    const g = el.dataset.g, w = +el.dataset.w;
    data.volume[g][w] = n;
    const extra = (activePlan().volExtra || {})[g];
    if (extra) extra[w] = 0;
    saveData();
    const week = $view.querySelector(`[data-field="volw"][data-g="${g}"][data-w="${w}"]`);
    if (week) week.value = weeklyTarget(g, w) || n;
    const text = $view.querySelector(`[data-volweek="${g}"]`);
    if (text) text.textContent = volWeekText(g);
  },
  // Sätze pro Woche: auf die Trainings verteilen, Zeile „pro Training“ anpassen
  volw: el => {
    const n = parseInt(el.value, 10);
    if (!isFinite(n) || n < 1 || n > 80) return;
    const g = el.dataset.g, w = +el.dataset.w;
    setWeeklyVolume(g, w, n);
    saveData();
    const per = $view.querySelector(`[data-field="vol"][data-g="${g}"][data-w="${w}"]`);
    if (per) per.value = data.volume[g][w];
    const text = $view.querySelector(`[data-volweek="${g}"]`);
    if (text) text.textContent = volWeekText(g, [w, n]);
  },
  'vol-add': el => {
    if (!el.value) return;
    data.volume[el.value] = [2, 2, 3, 3];
    saveData(); go('plan', { volOpen: true });
  },
  'ex-group': el => {
    findDay(current.params.id).exercises[el.dataset.i].group = el.value || null;
    saveData(); render();
  },
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
    // i-Knopf nur, wenn es zur eingetippten Übung eine Erklärung gibt
    const info = el.parentElement.querySelector('.info-btn');
    if (info) info.hidden = !libEntry(el.value);
  },
  'rep-name': el => { showSuggestions(el); fillReplaceMax(el); },
  'add-name': el => { showSuggestions(el); fillReplaceMax(el); },
  'cycle-start': el => {
    if (!el.value) return;
    data.cycle.start = mondayISO(el.value + 'T12:00:00');  // immer auf den Montag dieser Woche
    delete data.cycle.begin;
    saveData(); render();
  },
  'tr-weight': el => {
    const s = draft.entries[el.dataset.ei].sets[el.dataset.si];
    s.weight = el.value;
    // Aufwärmen richtet sich nach dem ersten Arbeitssatz
    const en = draft.entries[el.dataset.ei];
    const warm = +el.dataset.si === 0 && $view.querySelector(`[data-warm="${el.dataset.ei}"]`);
    if (warm) { syncWarmup(en); warm.outerHTML = warmupBlock(en, +el.dataset.ei); }
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
  // Aufwärmsätze: selbst geändert -> folgt nicht mehr automatisch dem Arbeitssatz, wird gemerkt
  'wu-weight': el => {
    const en = draft.entries[el.dataset.ei];
    const w = en.warmup[el.dataset.wi];
    w.weight = el.value;
    w.manual = true;
    en.warmupEdited = true;
    const plates = $view.querySelector(`[data-plates="${el.dataset.ei}-${el.dataset.wi}"]`);
    if (plates && warmupKind(en) === 'barbell') plates.textContent = parseNum(el.value) ? platesPerSide(parseNum(el.value)) : '';
    saveDraft();
  },
  'wu-reps': el => {
    const en = draft.entries[el.dataset.ei];
    en.warmup[el.dataset.wi].reps = el.value;
    en.warmupEdited = true;
    saveDraft();
  },
  'tr-comment': el => {
    const en = draft.entries[el.dataset.ei];
    en.comment = el.value;
    const bubble = $view.querySelector(`[data-action="comment-toggle"][data-ei="${el.dataset.ei}"]`);
    if (bubble) bubble.classList.toggle('has', !!el.value.trim());
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
  // Auswahllisten: manche Safari-Versionen melden nur „change“, nicht „input“
  if (e.target.matches('select[data-field]') && fields[e.target.dataset.field]) {
    fields[e.target.dataset.field](e.target);
    return;
  }
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
  if (f === 'ex-name' || f === 'rep-name' || f === 'chart-name' || f === 'add-name' || f === 'wiz-add') {
    const box = suggestBoxFor(e.target);
    setTimeout(() => { box.hidden = true; }, 200);
  }
});

// Beim Antippen eines Feldes den Inhalt markieren -> einfach überschreiben
document.addEventListener('focusin', e => {
  if (e.target.matches('.setgrid input, .vol-inp')) setTimeout(() => e.target.select(), 0);
});

/* ---------- Begrüßung beim allerersten Öffnen ---------- */

// Nur für neue Nutzer (noch keine Trainings) und nur einmal – danach merkt sich die App das in data.welcomeSeen
function showWelcome() {
  if (data.welcomeSeen || data.sessions.length) return;
  const el = document.createElement('div');
  el.className = 'welcome';
  el.innerHTML = `<div class="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div class="welcome-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4.5" y="6.5" width="3.5" height="11" rx="1.2"/>
        <rect x="16" y="6.5" width="3.5" height="11" rx="1.2"/><path d="M8 12h8M2 9.5v5M22 9.5v5"/></svg></div>
      <h2 id="welcome-title">Willkommen bei StepUp Strength</h2>
      <p>Schön, dass du auf StepUp Strength aufmerksam geworden bist! Viel Spaß auf deiner Reise – nimm dir ruhig
        etwas Zeit, um dich mit den Möglichkeiten der App vertraut zu machen. 🙂</p>
      <ul class="welcome-tips">
        <li><b>Plan:</b> Mit dem Assistenten in wenigen Schritten deinen Trainingsplan erstellen.</li>
        <li><b>Training:</b> Trainingstag antippen und loslegen – die App schlägt Gewichte und Wiederholungen vor.</li>
        <li><b>Sicherung:</b> Alles bleibt nur auf deinem Handy – sichere es ab und zu.</li>
      </ul>
      <button class="btn primary" data-action="welcome-ok">Los geht's 💪</button>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
}

actions['welcome-ok'] = () => {
  data.welcomeSeen = true;
  saveData();
  const el = document.querySelector('.welcome');
  if (!el) return;
  el.classList.remove('show');
  setTimeout(() => el.remove(), 350);
};

/* ---------- Start ---------- */

render();
showWelcome();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* z. B. ohne HTTPS */ });
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
