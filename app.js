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

function upgradeData(d) {
  d.days.forEach(day => day.exercises.forEach(withDefaults));
  if (!Array.isArray(d.bodyweight)) d.bodyweight = [];  // [{ id, date, kg }]
  // Sätze pro Muskelgruppe und Training (im Plan einstellbar)
  if (!d.volume) d.volume = defaultVolume();
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
  const tt = { step: 2.5, ...t };
  let first = null, firstLast = -1, firstCap = null;
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
    if (!first) { first = p; firstLast = last; firstCap = cap; }
    const weight = p.weight != null ? fmtNum(p.weight) : s.weight;
    if (weight !== s.weight) { s.weight = weight; setInput('tr-weight', ei, j, weight); }
    if (String(p.reps) !== s.reps) { s.reps = String(p.reps); setInput('tr-reps', ei, j, s.reps); }
  }
  if (!first) return;
  const last = firstLast, cap = firstCap;
  en.note = `Satz ${last + 1}: ${cap} Wdh. bis zum Versagen → nächster Satz: ` +
    (first.weight != null ? `${fmtNum(first.weight)} kg × ` : '') + `${first.reps} Wdh. ` +
    `(${fmtNum(t.rir)} im Tank, −${FATIGUE} Ermüdung, mind. ${MIN_REPS} Wdh.)`;
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

// Tank-Ziel als Bereich [min, max] für Übungsart und Woche
function rirRange(kind, week, buildWeeks) {
  const plan = RIR_PLAN[buildWeeks] || RIR_PLAN[5];
  const base = plan[Math.min(plan.length, Math.max(1, week)) - 1];
  const [lo, hi] = Array.isArray(base) ? base : [base, base];
  const off = KIND_OFFSET[kind || 'normal'];
  return [Math.max(0, lo + off), Math.max(0, hi + off)];
}

const rirFor = (kind, week, buildWeeks) => {
  const [lo, hi] = rirRange(kind, week, buildWeeks);
  return (lo + hi) / 2;
};

const rirLabel = (kind, week, buildWeeks) => {
  const [lo, hi] = rirRange(kind, week, buildWeeks);
  return lo === hi ? fmtNum(lo) : `${fmtNum(lo)}–${fmtNum(hi)}`;
};

// Ziel im Tank, wie es angezeigt wird (Bereich statt Mittelwert, im Deload „mind. 3“)
const targetRirText = t => t.deload ? `mind. ${fmtNum(t.rir)}` : (t.rirText || fmtNum(t.rir));

function weekRirText(kind) {
  const ci = cycleInfo();
  if (ci.deload) return `Deload – mind. ${DELOAD_RIR}`;
  return `${rirLabel(kind, ci.week, ci.buildWeeks)} (${weekLabel(ci.week)})`;
}

function rirTable(buildWeeks) {
  const plan = RIR_PLAN[buildWeeks];
  const ci = cycleInfo();
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

const dayIntensity = day => day && day.type ? (day.type.endsWith('heavy') ? 'heavy' : 'light') : null;
const dayHalf = day => day && day.type ? day.type.split('-')[0] : null;

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
const volumeFor = (g, week) => data.volume[g][Math.min(Math.max(week, 1), VOL_WEEKS) - 1];
const deloadVolume = g => Math.ceil(data.volume[g][VOL_WEEKS - 1] / 2);

// Sätze pro Woche einer Muskelgruppe über alle Trainingstage mit Tag-Typ: [Intro, W2, W3, W4, Deload]
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
  return [...weeks, deload];
}

// Plan: Sätze pro Muskelgruppe und Training einstellen, darunter die Summe pro Woche
function volumeEditor() {
  const groups = Object.keys(data.volume);
  let h = `<details class="award-cat vol-editor" ${current.params.volOpen ? 'open' : ''}><summary>Sätze pro Muskelgruppe</summary>
    <div class="card">
    <p class="hint">Sätze <b>pro Training</b> – antippen und Zahl ändern. Die Übungen in allen Trainingstagen mit Tag-Typ passen sich automatisch an. Deload = Hälfte von W4.</p>
    <table class="rir vol"><tr><th></th><th>Intro</th><th>W2</th><th>W3</th><th>W4</th></tr>`;
  for (const g of groups) {
    h += `<tr><td>${MUSCLES[g] || g}</td>` + data.volume[g].map((v, w) =>
      `<td><input class="vol-inp" type="text" inputmode="numeric" pattern="[0-9]*" data-field="vol" data-g="${g}" data-w="${w}" value="${v}"></td>`).join('') +
      `</tr><tr class="vol-week"><td colspan="5"><button class="vol-del" data-action="vol-del" data-g="${g}"
        aria-label="${MUSCLES[g]} entfernen">✕</button><span data-volweek="${g}">${volWeekText(g)}</span></td></tr>`;
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

function volWeekText(g) {
  const [i, w2, w3, w4, d] = weeklyVolume(g);
  return i + w2 + w3 + w4 === 0
    ? 'pro Woche: noch keine Übung im Plan'
    : `pro Woche: Intro ${i} · W2 ${w2} · W3 ${w3} · W4 ${w4} · Deload ${d}`;
}

// Intro (und Deload): jede Übung 1 Satz, Rest der Reihe nach an Grund → Normal → Assistenz
function distributeStart(exs, total) {
  const sets = new Map(exs.map(e => [e.id, 1]));
  const order = ['compound', 'normal', 'assist'].flatMap(k => exs.filter(e => kindOf(e) === k));
  for (let rest = total - exs.length, i = 0; rest > 0; rest--, i++) {
    const e = order[i % order.length];
    sets.set(e.id, sets.get(e.id) + 1);
  }
  return sets;
}

// Steigerung: zusätzliche Sätze reihum an Assistenz → Grund → Normal, innerhalb der Art an die
// Übung mit den wenigsten Sätzen. state.k merkt sich, wer als Nächstes dran ist.
function addSets(exs, sets, count, state) {
  for (let n = 0; n < count; n++) {
    for (let tries = 0; tries < 3; tries++) {
      const kind = ['assist', 'compound', 'normal'][state.k++ % 3];
      const cands = exs.filter(e => kindOf(e) === kind);
      if (!cands.length) continue;
      const e = cands.reduce((a, b) => sets.get(b.id) < sets.get(a.id) ? b : a);
      sets.set(e.id, sets.get(e.id) + 1);
      break;
    }
  }
}

// Sätze pro Übung eines Trainingstags (nur bei Tag-Typ und Muskelgruppen aus der Volumen-Tabelle)
function autoSetsForDay(day, week, deload) {
  const res = new Map();
  if (!day.type) return res;
  const byGroup = {};
  for (const e of day.exercises) {
    const g = groupOf(e);
    if (!e.name.trim() || !data.volume[g]) continue;
    (byGroup[g] = byGroup[g] || []).push(e);
  }
  for (const [g, exs] of Object.entries(byGroup)) {
    let sets;
    if (deload) {
      sets = distributeStart(exs, deloadVolume(g));
    } else {
      sets = distributeStart(exs, volumeFor(g, 1));
      const state = { k: 0 };
      for (let w = 2; w <= week; w++) addSets(exs, sets, Math.max(0, volumeFor(g, w) - volumeFor(g, w - 1)), state);
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

// Neuestes passendes Training einer Übung in einer bestimmten Zykluswoche (bevorzugt derselbe Trainingstag)
function findWeekEntry(name, dayId, match) {
  const k = nameKey(name);
  const cands = data.sessions
    .filter(s => !s.deload)
    .map(s => ({ s, c: sessionCycle(s) }))
    .filter(x => match(x.c))
    .sort((a, b) => b.c.cycleStart.localeCompare(a.c.cycleStart)
      || (b.s.dayId === dayId) - (a.s.dayId === dayId)
      || b.s.date.localeCompare(a.s.date));
  for (const { s, c } of cands) {
    const e = s.entries.find(en => nameKey(en.name) === k);
    if (e) return { date: s.date, week: c.week, sets: e.sets, planned: e.planned, target: e.target };
  }
  return null;
}

// Vergleichswoche: dieselbe Woche im vorherigen Zyklus
const comparisonEntry = (name, dayId, ci) =>
  findWeekEntry(name, dayId, c => c.week === ci.week && c.cycleStart < ci.cycleStart);

// Vorwoche im selben Zyklus
const previousWeekEntry = (name, dayId, ci) => ci.week < 2 ? null
  : findWeekEntry(name, dayId, c => c.cycleStart === ci.cycleStart && c.week === ci.week - 1);

// Bremse: Satz 1 lag (Wdh. + Tank) mindestens BRAKE_REPS unter dem damaligen Vorschlag
const BRAKE_REPS = 2;
// v = Ausführungsvariante; es zählen nur Sätze derselben Variante
function braked(prev, v) {
  const s = ofVariant(prev.sets, v)[0];
  const t = prev.target || {};
  const p = ofVariant(prev.planned, v)[0];
  if (!p && v) return false;  // ohne gespeicherten Vorschlag gibt es für Varianten keinen Maßstab
  const planReps = p && p.reps != null ? p.reps : t.reps;
  if (!s || s.reps == null || planReps == null) return false;
  const tRir = t.rir != null ? t.rir : 2;
  let cap = s.reps + (s.rir != null ? s.rir : tRir);
  if (p && p.weight != null && s.weight != null) cap = capacityAt(cap, s.weight, p.weight);
  return cap - (planReps + tRir) <= -BRAKE_REPS;
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
// reicht die damalige Leistung schon für die nächste Gewichtsstufe, steigt stattdessen das Gewicht
function fromRef(src, target, plusOne, i) {
  let weight = src.weight;
  let reps = src.reps != null ? src.reps + (plusOne ? 1 : 0) : goalReps(target, i);
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

// Neueste Sätze einer Variante (falls es keine Bezugswoche mit dieser Variante gibt)
function lastVariantSets(name, v) {
  for (const s of sessionsNewestFirst()) {
    const e = s.entries.find(en => nameKey(en.name) === nameKey(name));
    const sets = e ? ofVariant(e.sets, v) : [];
    if (sets.length) return sets;
  }
  return [];
}

// Vorschlag für Satz i mit Variante v.
// Normal: Vergleichswoche (+1 je Satz) und Vorwoche (Satz 1 +1, Rest bestätigen) – der niedrigere;
// Bremse -> Vorwoche 1:1. Ohne Bezug: Vorschlag aus Plan/Progression (en.base).
// Varianten nutzen zusätzlich die Vorwoche und notfalls ihr letztes Training als Bezug.
function proposeSet(en, i, v) {
  const t = en.target;
  const k = en.sets.slice(0, i).filter(s => variantOf(s) === v).length;
  const cmpV = ofVariant(en.compare && en.compare.sets, v);
  const prevV = ofVariant(en.prevWeek && en.prevWeek.sets, v);
  const usePrev = prevV.length > 0;  // innerhalb des Zyklus immer: Satz 1 +1 Wdh., Rest bestätigen
  let p = null, rule = null;
  if (usePrev && braked(en.prevWeek, v)) {
    const src = refAt(prevV, k);
    p = { weight: src.weight, reps: src.reps };
    rule = 'brake';
  } else {
    const a = cmpV.length ? fromRef(refAt(cmpV, k), t, true, i) : null;
    const b = usePrev ? fromRef(refAt(prevV, k), t, k === 0, i) : null;
    if (a && b) { p = lighterSet(b, a) ? b : a; rule = 'lower'; }
    else p = a || b;
    if (!p && v) {
      const lastV = lastVariantSets(en.name, v);
      if (lastV.length) p = fromRef(refAt(lastV, k), t, k === 0, i);
    }
  }
  if (!p) {
    const b = en.base[Math.min(i, en.base.length - 1)];
    p = { weight: parseNum(b.weight), reps: parseNum(b.reps) };
  }
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

/* ---------- Bildschirme ---------- */

const views = {
  start:    { title: 'Training',      tab: 'start',   render: renderStart },
  training: { title: () => draft ? draft.dayName : 'Training', tab: 'start', back: 'start', render: renderTraining },
  plan:     { title: 'Trainingsplan', tab: 'plan',    render: renderPlan },
  day:      { title: 'Trainingstag',  tab: 'plan',    back: 'plan', render: renderDay },
  history:  { title: 'Verlauf',       tab: 'history', render: renderHistory },
  exercise: { title: p => p.name,     tab: 'history', back: 'history', render: renderExercise },
  session:  { title: 'Training',      tab: 'history', back: 'history', render: renderSession },
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
      ? `Start-Sätze laut Plan. Werte der letzten Intro-Woche, je +1 Wdh. Deload ab ${fmtDate(ci.deloadStart)}.`
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
      ? '<p class="intro-note">Intro-Woche: Start-Sätze laut Plan. Vergleich ist die Intro-Woche des letzten Zyklus, je +1 Wdh.</p>'
      : '';
  if (draft.penalty) {
    h += `<p class="readiness-note">Heute ${readinessText(draft.readiness)}: pro Übung ${draft.penalty} Wdh. weniger erwartet.</p>`;
  }
  h += `<p class="sub">${fmtDate(draft.date, true)}<br>Trag nach jedem Satz ein, wie viele Wdh. noch im Tank waren – damit gilt der Satz als erledigt und die Wdh. der folgenden Sätze passen sich an.</p>`;

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

  draft.entries.forEach((en, ei) => {
    const last = lastEntry(en.name);
    h += `<section class="card">
      <div class="ex-head">
        <h2>${esc(en.name)}</h2>
        <button class="icon-btn bubble ${(en.comment || '').trim() ? 'has' : ''}" data-action="comment-toggle"
          data-ei="${ei}" aria-label="Kommentar">💬</button>
        <button class="icon-btn swap" data-action="rep-open" data-ei="${ei}">⇄ Ersetzen</button>
      </div>`;
    if (en.commentOpen) {
      h += `<textarea class="inp comment" rows="3" data-field="tr-comment" data-ei="${ei}"
        placeholder="Kommentar zur Übung, z. B. Sitzhöhe 4, Schulter zwickt …">${esc(en.comment)}</textarea>`;
    }
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
    if (en.compare) {
      const rule = en.rule === 'brake'
        ? `Bremse: Die Vorwoche lief deutlich schwerer als geplant → Werte der Vorwoche 1:1`
        : en.rule === 'lower'
          ? 'Heute: pro Satz der niedrigere Vorschlag aus beiden – Ziel: Satz 1 eine Wdh. mehr als in der Vorwoche, die übrigen Sätze bestätigen'
          : 'Heute: je Satz +1 Wdh. – oder mehr Gewicht, wenn es die Leistung hergibt';
      h += `<p class="compare">Letzter Zyklus, ${weekLabel(en.compare.week)} (${fmtDate(en.compare.date)}):<br>
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
    en.sets.forEach((s, si) => {
      const v = variantOf(s);
      h += `<button class="setno ${v ? 'has-v' : ''}" data-action="set-variant" data-ei="${ei}" data-si="${si}"
          aria-label="Satz ${si + 1}: ${VARIANTS[v]} – antippen zum Wechseln">${si + 1}${v ? `<small>${VARIANTS[v]}</small>` : ''}</button>
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="–"
          data-field="tr-weight" data-ei="${ei}" data-si="${si}" value="${esc(s.weight)}">
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="–"
          data-field="tr-reps" data-ei="${ei}" data-si="${si}" value="${esc(s.reps)}">
        <input type="text" inputmode="decimal" autocomplete="off" placeholder="${tankHint}"
          class="tank" data-field="tr-rir" data-ei="${ei}" data-si="${si}" value="${esc(s.rir)}">`;
    });
    h += `</div><p class="avg" data-avg="${ei}">${avgTankText(en)}</p>
      <div class="row">
        <button class="btn" data-action="tr-del-set" data-ei="${ei}">− Satz</button>
        <button class="btn" data-action="tr-add-set" data-ei="${ei}">+ Satz</button>
      </div></section>`;
  });
  h += `<p class="hint">Satznummer antippen: Ausführung wechseln (normal → mit Pause → langsam). Sätze mit Pause oder langsam werden nur mit gleich ausgeführten Sätzen verglichen.</p>
    <button class="btn primary" data-action="tr-save">Training speichern</button>
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
      ${cyclePills(cycleInfo())}
      ${rirTable(c.buildWeeks)}
      <div class="row"><button class="btn outline" data-action="cycle-restart">Neuen Zyklus ab dieser Woche</button></div>
    </div>
    ${volumeEditor()}
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
  h += `<button class="btn outline" data-action="load-template">Standard-Plan anlegen (2 × Ober-, 2 × Unterkörper)</button>`;
  if (data.days.length) {
    h += `<p class="hint">Dein Plan ist gespeichert. Tippe einen Tag an, um ihn zu bearbeiten.</p>
      <button class="btn primary" data-action="tab" data-tab="start">Zum Training →</button>`;
  }
  return h;
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
  if (!day.type) return '';
  const bw = data.cycle.buildWeeks;
  const weeks = Array.from({ length: bw }, (_, w) => autoSetsForDay(day, w + 1, false));
  const deload = autoSetsForDay(day, 0, true);
  const sum = (m, g) => day.exercises.filter(e => groupOf(e) === g && m.has(e.id)).reduce((a, e) => a + m.get(e.id), 0);
  let h = '<div class="card"><h2>Sätze pro Muskelgruppe</h2><div class="table-wrap"><table class="rir"><tr><th></th>' +
    weeks.map((_, w) => `<th>${w === 0 ? 'Intro' : 'W' + (w + 1)}</th>`).join('') + '<th>Deload</th></tr>';
  // feste Gruppen der Körperhälfte plus selbst hinzugefügte, die an diesem Tag vorkommen
  const extra = Object.keys(data.volume).filter(g => !DAY_GROUPS[dayHalf(day)].includes(g)
    && day.exercises.some(e => e.name.trim() && groupOf(e) === g));
  for (const g of [...DAY_GROUPS[dayHalf(day)].filter(g => data.volume[g]), ...extra]) {
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
    <div class="variants plan daytype"><span>Tag-Typ</span>${Object.entries({ ...DAY_TYPES, '': 'Frei' }).map(([t, label]) =>
      `<button class="vchip ${(day.type || '') === t ? 'on' : ''}" data-action="day-type" data-t="${t}">${label}</button>`).join('')}
    </div>
    <p class="hint">${day.type
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
      <input class="inp" type="text" data-field="ex-name" data-i="${i}"
        autocomplete="off" autocorrect="off" spellcheck="false"
        value="${esc(ex.name)}" placeholder="Übung eintippen, z. B. Bank…">
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
           ${day.type
             ? `<p class="auto-info">Wdh.: ${repRangeText(day, ex)} (Start bei ${repsFor(day, ex)}) · Muskelgruppe ohne Volumen-Vorgabe, Sätze von Hand</p>`
             : stepperRow('Wdh. pro Satz', 'reps', i, ex.reps)}`}
      <div class="variants plan"><span>Art${ex.kind == null ? ' <small class="hint">(auto)</small>' : ''}</span>${Object.entries(KINDS).map(([k, label]) =>
        `<button class="vchip ${kindOf(ex) === k ? 'on' : ''}" data-action="plan-kind" data-i="${i}" data-k="${k}">${label}</button>`).join('')}
      </div>
      <p class="hint kind-hint">Ziel im Tank diese Woche: <b>${weekRirText(kindOf(ex))}</b></p>
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
    h += `<button class="btn" data-action="open-exercise" data-name="${esc(ex.name)}">
      ${esc(ex.name)}<small>${ex.count}× trainiert · zuletzt ${fmtDate(ex.last)}</small></button>`;
  }
  h += '<h2>Alle Trainings</h2>';
  for (const s of sessionsNewestFirst()) {
    h += `<button class="btn" data-action="open-session" data-id="${s.id}">
      ${fmtDate(s.date)}<small>${esc(s.dayName)} · ${s.entries.length} Übungen · ${fmtTons(sessionTonnage(s))}${s.deload ? ' · Deload' : ''}</small></button>`;
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
  h += '<ul class="list">';
  for (const r of rows) {
    h += `<li><div class="date">${fmtDate(r.session.date)} <small>${esc(r.session.dayName)}</small></div>
      <div class="sets">${r.sets.map(fmtSet).join('<br>')}</div>
      ${r.comment ? `<div class="comment-text">💬 ${esc(r.comment)}</div>` : ''}</li>`;
  }
  return h + '</ul>';
}

function renderSession({ id, fresh }) {
  const s = data.sessions.find(x => x.id === id);
  if (!s) return '<p class="hint">Training nicht gefunden.</p>';
  const won = fresh || [];
  const top = (won.length ? `<div class="card award-new">${won.map(a =>
      `<div class="award-row"><span class="award-icon">${a.icon}</span><div><b>Neuer Erfolg: ${esc(a.name)}</b><small>${esc(a.desc)}</small></div></div>`).join('')}</div>` : '') +
    `<div class="stats one"><div class="stat"><span>Heute bewegt (Tonnage)</span><b>${fmtTons(sessionTonnage(s))}</b></div></div>`;
  let h = top + `<p class="sub">${fmtDate(s.date, true)}<br>${esc(s.dayName)}${s.deload ? ' · Deload-Woche (keine Steigerung)' : ''}` +
    (s.readiness ? `<br>Tagesform: ${readinessText(s.readiness)}` : '') + '</p><ul class="list">';
  for (const e of s.entries) {
    const res = e.result
      ? `<div class="result">${resultText(e.result)}<br>Nächstes Mal: <b>${fmtNum(e.result.next)} kg</b></div>`
      : '';
    const instead = e.replacedFrom ? ` <small>statt ${esc(e.replacedFrom)}</small>` : '';
    const comment = e.comment ? `<div class="comment-text">💬 ${esc(e.comment)}</div>` : '';
    h += `<li><div class="date">${esc(e.name)}${instead}</div>
      <div class="sets">${e.sets.map(fmtSet).join('<br>')}</div>${comment}${res}</li>`;
  }
  return h + `</ul><button class="btn danger" data-action="del-session" data-id="${s.id}">Dieses Training löschen</button>`;
}

function renderCheck({ id, step }) {
  const q = step === 1 ? 'Hast du gut geschlafen?' : 'Hattest du sonst viel Stress?';
  const hint = step === 1 ? 'Bei „Nein“ wird pro Übung 1 Wiederholung weniger erwartet.'
    : 'Bei „Ja“ wird pro Übung 1 Wiederholung weniger erwartet.';
  return `<div class="card check">
    <p class="sub">${esc(findDay(id).name)} · Frage ${step} von 2</p>
    <h2 class="question">${q}</h2>
    <div class="row">
      <button class="btn primary" data-action="check-answer" data-answer="yes">Ja</button>
      <button class="btn primary" data-action="check-answer" data-answer="no">Nein</button>
    </div>
    <p class="hint">${hint}</p>
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
    <h2>Zum Ausprobieren</h2>
    <button class="btn outline" data-action="load-demo">Beispieldaten laden (3 Zyklen)</button>
    <p class="hint">Lädt 15 Wochen Beispieltraining mit dem Standard-Plan. <b>Ersetzt alle Daten auf diesem Gerät!</b>
      Tipp: Die Seite dafür in Safari öffnen statt in der installierten App – beide haben getrennte Speicher, deine echten Daten bleiben so unberührt.</p>`;
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
    entries: [],
  };
  // Sätze aus dem Wochenvolumen der Muskelgruppen (nur bei Tag-Typ)
  const auto = autoSetsForDay(day, ci.week, ci.deload);
  // erst nach dem Anlegen von draft, weil setupEntry die Zykluswoche aus draft liest
  draft.entries = exercises.map(ex => {
    const en = { name: ex.name.trim() };
    // Ziel im Tank aus Zykluswoche und Übungsart (Deload: Wert der letzten Trainingswoche, dann mind. 3)
    const week = ci.deload ? ci.buildWeeks : ci.week;
    const rir = rirFor(kindOf(ex), week, ci.buildWeeks);
    const rirText = rirLabel(kindOf(ex), week, ci.buildWeeks);
    // Sätze: automatisch aus dem Muskelgruppen-Volumen, sonst laut Wochenplan der Übung
    // (Deload: Sätze der letzten Woche, werden dort halbiert)
    const fixedSets = auto.has(ex.id);
    const sets = fixedSets ? auto.get(ex.id) : setsForWeek(ex, week, ci.buildWeeks);
    setupEntry(en, { sets, fixedSets, reps: repsFor(day, ex), rir, rirText, max10: ex.max10, step: stepFor(ex) },
      () => ex.variant);
    return en;
  });
  saveDraft();
  go('training');
}

// Ziel und vorgeschlagene Sätze einer Übung je nach Zykluswoche festlegen:
// Deload -> halbiert & leichter; sonst Werte der Vergleichswoche + 1 Wdh., falls vorhanden
// variantFor(i) liefert die Ausführungsvariante von Satz i
function setupEntry(en, target, variantFor = () => '') {
  en.plan = target;
  if (draft.deload) target = deloadTarget(target);
  else if (draft.intro) target = { ...target, intro: true };
  const cmp = draft.deload ? null : comparisonEntry(en.name, draft.dayId, draft);
  const prev = draft.deload || draft.intro ? null : previousWeekEntry(en.name, draft.dayId, draft);
  // Satzzahl laut Wochenplan der Übung (Deload: halbiert)
  const n = target.sets;
  en.target = { ...target, sets: n };
  en.compare = cmp;
  en.prevWeek = prev;
  en.rule = null;
  en.base = buildSets(en.name, en.target);  // Vorschlag ohne Bezugswoche
  en.sets = [];
  en.planned = [];  // ursprünglicher Vorschlag, damit die Bremse nächste Woche vergleichen kann
  for (let i = 0; i < n; i++) applyProposal(en, i, variantFor(i) || '');
  en.note = null;
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

function saveTraining() {
  const entries = draft.entries
    .map(en => ({
      name: en.name,
      ...(en.replacedFrom ? { replacedFrom: en.replacedFrom } : {}),
      target: en.target,
      planned: en.planned,
      ...((en.comment || '').trim() ? { comment: en.comment.trim() } : {}),
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

  // Progression berechnen und „Max. bei 10 Wdh.“ im Plan aktualisieren (nicht in der Deload-Woche)
  for (const en of draft.deload ? [] : entries) {
    const first = en.sets.find(s => !s.variant);  // Maßstab: erster normaler Satz
    if (!en.target || !first || first.weight == null || first.reps == null || first.rir == null) continue;
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
  if (draft.penalty) session.readiness = draft.readiness;
  if (draft.cycleStart) Object.assign(session, { cycleStart: draft.cycleStart, week: draft.week });
  const before = unlockedIds();
  data.sessions.push(session);
  const fresh = achievementProgress().done.filter(a => !before.has(a.id))
    .map(({ icon, name, desc }) => ({ icon, name, desc }));
  saveData();
  draft = null;
  saveDraft();
  toast('Training gespeichert ✔');
  go('session', { id: session.id, fresh });
  if (fresh.length) {
    toast(fresh.length > 2 ? `🏆 ${fresh.length} neue Erfolge freigeschaltet!` : `🏆 Erfolg freigeschaltet: ${fresh.map(a => a.name).join(', ')}`);
  }
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
      days: d.days, sessions: d.sessions, bodyweight: d.bodyweight, cycle: d.cycle, volume: d.volume,
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
  back: () => go(views[current.view].back),
  resume: () => go('training'),
  'start-day': el => beginCheck(el.dataset.id),
  'check-answer': el => {
    const yes = el.dataset.answer === 'yes';
    const { id, step } = current.params;
    if (step === 1) go('check', { id, step: 2, sleptWell: yes });
    else startDay(id, { sleptWell: current.params.sleptWell, stress: yes });
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
  'day-type': el => {
    findDay(current.params.id).type = el.dataset.t || null;
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
    saveData(); go('plan', { volOpen: true });
  },
  'vol-reset': () => {
    if (!confirm('Alle Sätze pro Muskelgruppe auf die Standardwerte zurücksetzen?')) return;
    data.volume = defaultVolume();
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
  'cycle-restart': () => {
    if (!confirm('Neuen Zyklus ab dieser Woche beginnen? Diese Woche wird dann Aufbauwoche 1.')) return;
    data.cycle.start = mondayISO(new Date());
    saveData(); render();
    toast('Neuer Zyklus gestartet');
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
  'open-session': el => go('session', { id: el.dataset.id }),
  'del-session': el => {
    if (!confirm('Dieses Training endgültig löschen?')) return;
    data.sessions = data.sessions.filter(s => s.id !== el.dataset.id);
    saveData(); toast('Training gelöscht'); go('history');
  },

  export: () => exportData(),
  import: () => document.getElementById('import-file').click(),
  'load-demo': async () => {
    if (!confirm('Beispieldaten laden?\n\nAlle Daten auf diesem Gerät (Plan, Trainings, Körpergewicht) werden ersetzt.')) return;
    try {
      const d = await (await fetch('demo.json', { cache: 'no-store' })).json();
      if (!isValidData(d)) throw new Error('ungültig');
      data = upgradeData({
        app: 'trainingsapp', version: 1,
        days: d.days, sessions: d.sessions, bodyweight: d.bodyweight, cycle: d.cycle, volume: d.volume,
      });
      saveData();
      draft = null; saveDraft();
      toast('Beispieldaten geladen ✔');
      go('history');
    } catch (e) {
      alert('Die Beispieldaten konnten nicht geladen werden. Bist du online?');
    }
  },
};

// Eingabefelder schreiben direkt in die Daten (ohne neu zu zeichnen)
const fields = {
  'day-name': el => { findDay(current.params.id).name = el.value; saveData(); },
  // Sätze pro Muskelgruppe ändern – nur die Wochensumme neu anzeigen, damit das Feld den Fokus behält
  vol: el => {
    const n = parseInt(el.value, 10);
    if (!isFinite(n) || n < 0 || n > 30) return;
    data.volume[el.dataset.g][+el.dataset.w] = n;
    saveData();
    const week = $view.querySelector(`[data-volweek="${el.dataset.g}"]`);
    if (week) week.textContent = volWeekText(el.dataset.g);
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
  if (f === 'ex-name' || f === 'rep-name' || f === 'chart-name') {
    const box = e.target.nextElementSibling;
    setTimeout(() => { box.hidden = true; }, 200);
  }
});

// Beim Antippen eines Feldes den Inhalt markieren -> einfach überschreiben
document.addEventListener('focusin', e => {
  if (e.target.matches('.setgrid input, .vol-inp')) setTimeout(() => e.target.select(), 0);
});

/* ---------- Start ---------- */

render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* z. B. ohne HTTPS */ });
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
