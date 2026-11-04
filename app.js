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

// Eigener Plan (plan.own): nachgebauter Plan ohne Progressionslogik – keine Zyklen/Deload, keine Steigerung,
// im Training immer die Werte vom letzten Mal (beim ersten Mal Sätze × Wdh. und ggf. Startgewicht aus dem Plan)
const ownPlan = () => !!activePlan().own;

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
  // früher automatisch angelegter, leerer Platzhalter „Mein Plan“ (ohne Trainingstage) -> entfernen
  d.plans = d.plans.filter(p => !(p.name === 'Mein Plan' && !p.own && !(p.days || []).length));
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
    if (p.rotate != null && !(p.rotate >= 1)) delete p.rotate;  // Wechsel-Plan: Trainings pro Woche (siehe dayTimes)
  }
  // null = bewusst kein Plan aktiv; fehlt die Angabe (ältere Daten) oder gibt es den Plan nicht mehr -> erster Plan
  if (d.activePlanId !== null && !d.plans.some(p => p.id === d.activePlanId)) d.activePlanId = d.plans.length ? d.plans[0].id : null;
  bindPlanAccessors(d);

  if (!Array.isArray(d.bodyweight)) d.bodyweight = [];  // [{ id, date, kg }]
  if (!Array.isArray(d.steps)) d.steps = [];            // [{ date: JJJJ-MM-TT, steps }]
  if (!Array.isArray(d.complaints)) d.complaints = [];  // [{ cycleStart, date, areas: [...] }], einmal pro Zyklus
  if (!d.hintsDismissed) d.hintsDismissed = {};         // Übung -> Zyklus, in dem der Stillstand-Hinweis weggeklickt wurde
  if (!d.cycleShift) d.cycleShift = {};
  // Umbenannte Übungen: Pläne und Trainings ziehen mit, damit Verlauf und Vergleich weiter passen
  // (läuft schon beim Laden ganz oben – daher hier keine Hilfsfunktionen von weiter unten)
  const renamed = { 'nordic curls': 'Nordic Hamstring Curls' };
  for (const [from, to] of Object.entries(renamed)) {
    const key = x => String(x || '').trim().toLowerCase();
    const fix = o => { if (o && key(o.name) === from) o.name = to; if (o && key(o.replacedFrom) === from) o.replacedFrom = to; };
    for (const p of d.plans) for (const day of p.days || []) (day.exercises || []).forEach(fix);
    for (const s of d.sessions || []) (s.entries || []).forEach(fix);
  }
  if (!d.tour) d.tour = { seen: {}, off: false };       // Einführungen: gesehene Schritte (tour.js)
  if (d.home === undefined) d.home = null;              // Heim-Ausrüstung { db:[kg], kb:[kg], bands:[1–4], anchor, bar, bench 0/1/2, dip }
  if (!d.roundSkips) d.roundSkips = {};                 // Durchlauf (roundKey) -> [dayId, …]: in dieser Woche ausgelassene Tage                 // Zyklus -> { from, by }: Vergleich um die Verlängerung des Vorzyklus versetzt
  if (d.nutrition === undefined) d.nutrition = null;    // Ernährung: Phase, Angaben, Ziel (siehe nutrition.js)
  if (!Array.isArray(d.foodLog)) d.foodLog = [];       // Ernährungstagebuch (food.js)
  if (!d.foods || typeof d.foods !== 'object' || Array.isArray(d.foods)) d.foods = {};  // gemerkte Lebensmittel
  if (!Array.isArray(d.foodMeals)) d.foodMeals = [];
  if (!Array.isArray(d.cardio)) d.cardio = [];  // Cardio-Einheiten (cardio.js)  // gespeicherte Mahlzeiten (Schnellauswahl)
  if (!d.foodClosed || typeof d.foodClosed !== 'object') {
    // abgeschlossene Tagebuch-Tage; beim Einführen gelten alle bisherigen Tage vor heute als abgeschlossen
    d.foodClosed = {};
    const today = new Date().toLocaleDateString('sv-SE');
    for (const e of d.foodLog) if (e.date < today) d.foodClosed[e.date] = true;
  }
  if (d.mcal && !Array.isArray(d.mcal.starts)) d.mcal.starts = [];  // Zykluskalender (menstrual.js)
  if (!Array.isArray(d.intake)) d.intake = [];          // gegessen pro Tag: [{ date, kcal, p, c, f, src: 'health' | 'hand' }]
  if (d.profile === undefined) d.profile = null;  // { name, sex: 'm' | 'f', color: Schlüssel aus PROFILE_COLORS } – beim ersten Öffnen gefragt
  // Farbe wird einmal nach dem Geschlecht vorbelegt (früher „Passend“ = color null) und folgt ihm danach nicht mehr
  if (d.profile && d.profile.sex && !d.profile.color) d.profile.color = d.profile.sex === 'f' ? 'berry' : 'blue';
  if (!Array.isArray(d.customExercises)) d.customExercises = [];  // eigene Übungen: [{ name, kind, group, like, note }]
  if (!Array.isArray(d.dayTemplates)) d.dayTemplates = [];  // selbst erstellte Trainingstage: [{ id, name, intensity, groups }]
  // Periodisierung: buildWeeks Aufbauwochen, danach 1 Deload-Woche – jede Woche ist ein Durchlauf (siehe cycleInfo)
  if (!d.cycle) d.cycle = { buildWeeks: 4, start: new Date().toLocaleDateString('sv-SE'), week: 1, no: 1 };
  if (d.cycle.week == null) upgradeCycle(d);
  // defWeeks = Standardlänge (4–10 Aufbauwochen, bestimmt die Verteilung von Sätzen und Tank);
  // adj = nur für den laufenden Zyklus verlängert/verkürzt (z. B. Urlaub); buildWeeks = Länge des laufenden Zyklus
  if (d.cycle.defWeeks == null) d.cycle.defWeeks = d.cycle.buildWeeks || 4;
  d.cycle.defWeeks = Math.min(10, Math.max(4, d.cycle.defWeeks));
  if (d.cycle.adj == null) d.cycle.adj = 0;
  if (!d.cycle.lens) d.cycle.lens = {};  // Länge früherer Zyklen: { Kennung: Aufbauwochen }
  d.cycle.buildWeeks = Math.max(0, d.cycle.defWeeks + d.cycle.adj);
  // „schwer“/„leicht“ im Tagesnamen einmalig in den Wiederholungsbereich umbenennen (nur der Name – Inhalt bleibt;
  // Trainings hängen über die dayId am Tag). User-Wunsch 2026-11-02.
  if (!d.renamedInt) {
    const ren = n => typeof n === 'string'
      ? n.replace(/\s*\b(schwer|leicht)\b/i, (m, w) => ` – ${w.toLowerCase() === 'schwer' ? 'niedrige' : 'hohe'} Wdh.`) : n;
    for (const p of d.plans) for (const day of p.days) day.name = ren(day.name);
    for (const t of d.dayTemplates) t.name = ren(t.name);
    for (const s of d.sessions || []) s.dayName = ren(s.dayName);
    d.renamedInt = true;
  }
  return d;
}

// Früher waren Zykluswochen Kalenderwochen: jedem Training seine damalige Woche mitgeben, Wochen-Abweichungen
// der Progression (Schlüssel: Montag) umschlüsseln und mit der aktuellen Kalender-Zykluswoche als Durchlauf weitermachen.
function upgradeCycle(d) {
  const c = d.cycle;
  for (const s of d.sessions) {
    if (s.cycleStart) continue;
    const lc = legacyCycleInfo(c, new Date(s.date));
    Object.assign(s, { cycleStart: lc.cycleStart, week: lc.week });
  }
  for (const p of d.plans) {
    const own = {};
    for (const [k, v] of Object.entries(p.weekProgression || {})) {
      if (!/^\d{4}-\d\d-\d\d$/.test(k)) { own[k] = v; continue; }
      const lc = legacyCycleInfo(c, new Date(k + 'T12:00:00'));
      own[`${lc.cycleStart}|${lc.week}`] = v;
    }
    p.weekProgression = own;
  }
  const now = legacyCycleInfo(c, new Date());
  d.cycle = { buildWeeks: c.buildWeeks, start: now.cycleStart, week: now.week, no: now.cycle };
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
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY));
    // laufendes Training: Tagesname wie im Plan (z. B. nach der Umbenennung „schwer“/„leicht“ in upgradeData)
    const day = d && data.plans.flatMap(p => p.days).find(x => x.id === d.dayId);
    if (day && day.name.trim()) d.dayName = day.name;
    return d;
  } catch (e) { return null; }
}

function saveDraft() {
  if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  else localStorage.removeItem(DRAFT_KEY);
}

/* ---------- Hilfsfunktionen ---------- */

const $view = document.getElementById('view');
const $title = document.getElementById('title');
const $back = document.getElementById('back');
const $cancel = document.getElementById('cancel');
const $toast = document.getElementById('toast');

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- Modi: Einfach / Standard / Experte ----------
   Die Logik (Steigerung, Volumen, Tank, Zyklen, Ernährung) ist in allen Modi dieselbe – der Modus bestimmt nur, was zu
   sehen und einzustellen ist (data.profile.mode). Was ausgeblendet ist, läuft mit der Empfehlung der App weiter.
   FEATURE_MODE: ab welchem Modus eine Funktion zu sehen ist (fehlt sie hier: in allen Modi). Abgestimmt mit dem User. */
const APP_MODES = {
  e: { rank: 1, icon: '🌱', label: 'Einfach', text: 'Nur das Nötigste – die App entscheidet für dich. Ideal für Neulinge.' },
  s: { rank: 2, icon: '💪', label: 'Standard', text: 'Das Wichtige mit kurzer Begründung – für Einsteiger und Fortgeschrittene.' },
  x: { rank: 3, icon: '🦉', label: 'Experte', text: 'Alle Zahlen, Tabellen und Einstellungen – für alte Hasen.' },
};
const FEATURE_MODE = {
  // Plan-Assistent
  'wiz-custom': 's', 'wiz-style': 'x', 'wiz-freq': 's', 'wiz-days': 's', 'wiz-name': 's', 'wiz-focus': 's', 'wiz-volume': 's',
  'wiz-volume-edit': 'x', 'wiz-rir': 'x', 'wiz-preview': 's', 'wiz-int': 's', 'wiz-deload': 's', 'wiz-prog': 's', 'entry-week': 's',
  // Vor dem Training
  'check-detail': 's', 'first-max': 's', 'cycle-choice': 's',
  // Training
  'tr-rir-input': 's', 'tr-tank-target': 's', 'tr-max': 's', 'tr-step': 's', 'tr-variants': 'x', 'tr-compare': 's', 'tr-sets': 's',
  'tr-add': 's', 'tr-comment': 's', 'tr-prog': 's', 'tr-next': 's',
  // Startseite & Verlauf
  'stall-hints': 's', 'week-view': 's', 'session-edit': 's', 'ex-history': 's', 'chart-detail': 'x', 'steps': 's',
  // Plan-Reiter
  'plans-multi': 's', 'plan-add-ex': 's', 'day-reprange': 's', 'ex-kind-group': 'x', 'day-free': 'x', 'day-volume': 'x',
  'plan-cycle-settings': 'x', 'plan-week-jump': 's', 'cycle-len': 's', 'cycle-adjust': 's', 'plan-week-prog': 'x', 'plan-volume': 'x', 'plan-rir': 'x', 'custom-ex': 's',
  'day-templates': 's',
  // Ernährung
  'nut-minicut': 's', 'nut-pace': 's', 'nut-own-kcal': 's', 'nut-macros': 's', 'nut-macro-pct': 'x', 'nut-protein-detail': 's',
  'nut-health': 's', 'nut-history': 's', 'nut-trend-detail': 's', 'nut-measured': 'x', 'nut-train-q': 's', 'nut-explain': 's',
};
// Bestehende Nutzer ohne Wahl: Experte (so fehlt nach dem Update nichts); neue wählen bei der Begrüßung
const appMode = () => (data.profile && APP_MODES[data.profile.mode] ? data.profile.mode : 'x');
const feat = k => APP_MODES[appMode()].rank >= APP_MODES[FEATURE_MODE[k] || 'e'].rank;
const simpleMode = () => appMode() === 'e';
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
    if (e) return { date: s.date, dayName: s.dayName, sets: e.sets, result: e.result, deload: !!s.deload };
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
const STEP_OPTIONS = [1.25, 2, 2.5, 5];
const MAX_UNKNOWN_HINT = 'Du weißt dein Max. bei 10 Wdh. nicht? Kein Problem – lass das Feld leer und taste dich mit den ersten Sätzen an ein Gewicht heran, das sich passend anfühlt. Trag ein, was du geschafft hast (Gewicht, Wdh. und Tank): Die App errechnet daraus den Wert und die weitere Steigerung.';  // wählbare Gewichtssprünge pro Übung
const STEP_HINT = 'Um so viel geht das Gewicht hoch, wenn die App mehr Gewicht vorschlägt. 1,25 kg braucht kleine Scheiben (z. B. 2 × 0,625 kg oder Mikro-Scheiben) – gut für Übungen, bei denen 2,5 kg auf einmal zu viel ist (z. B. Schulterdrücken, Seitheben). 5 kg passt z. B. zu Maschinen mit 5-kg-Stufen.';

const round2 = x => Math.round(x * 100) / 100;
const roundTo = (w, step, fn = Math.round) => round2(fn(w / step) * step);

// Heimtraining: t.weights = vorhandene Gewichte (sortiert). Dann gibt es nur diese – liegt ein Vorschlag dazwischen,
// gilt das leichtere (mit mehr Wdh., User-Regel 2026-11-04). Sonst das Raster in Schritten von t.step.
function wUp(w, t) {
  if (t.weights) { const x = t.weights.find(v => v > w + 1e-9); return x == null ? null : x; }
  return round2(w + (t.step || 2.5));
}
function wDown(w, t) {
  if (t.weights) { const x = [...t.weights].reverse().find(v => v < w - 1e-9); return x == null ? null : x; }
  const d = round2(w - (t.step || 2.5));
  return d > 0 ? d : null;
}
function wSnap(w, t, fn = Math.round) {
  const L = t.weights;
  if (!L || !L.length) return roundTo(w, t.step || 2.5, fn);
  if (fn === Math.ceil) { const x = L.find(v => v >= w - 1e-9); return x == null ? L[L.length - 1] : x; }
  const f = [...L].reverse().find(v => v <= w + 1e-9);
  return f == null ? L[0] : f;
}
// Plan „Zu Hause“: Gewichte der Übung aus der Ausrüstung (null = freies Raster)
const homePlan = () => hasActivePlan() && activePlan().equip === 'home';
const weightsFor = name => homePlan() ? homeWeights(name, data.home) : null;

// Startgewicht aus „Max. bei 10 Wdh.“ und den Zielvorgaben
function targetWeight(t) {
  if (t.max10 == null) return null;
  return wSnap(t.max10 * repFactor(t.reps + t.rir), t);
}

// Nach einem Satz: Abweichung vom Ziel (in Wdh.) und passendes Gewicht für den nächsten Satz
function adjustAfterSet(weight, reps, rir, t) {
  const diff = (reps + rir) - (t.reps + t.rir);
  const raw = Math.min(weight * 1.05, Math.max(weight * 0.9,
    weight * repFactor(t.reps + t.rir) / repFactor(reps + rir)));
  let w = wSnap(raw, t);
  if (w > weight * 1.05) w = wSnap(raw, t, Math.floor);
  return { diff, weight: w };
}

// Nach dem Training: Gewicht fürs nächste Mal, gemessen am ersten Satz.
// Knapp verfehlt (weniger als MISS_REPS Wdh.) -> halten, deutlich verfehlt -> reduzieren.
function progression(first, t) {
  const rir = first.rir != null ? first.rir : t.rir;
  const { diff, weight } = adjustAfterSet(first.weight, first.reps, rir, t);
  let next, deload = false;
  const up = wUp(first.weight, t), down = wDown(first.weight, t);
  if (diff >= 1) next = Math.max(weight, up != null ? up : first.weight);     // klar übertroffen
  else if (diff >= 0) next = up != null ? up : first.weight;                  // genau erreicht
  else if (diff <= -MISS_REPS) { next = Math.min(weight, down != null ? down : first.weight); deload = true; }  // deutlich verfehlt
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
  if (w == null) return { weight: null, reps: Math.max(MIN_REPS, repsAt(null)) };  // ohne Gewicht (Eigengewicht)
  let wt = startWeight != null ? startWeight : w;
  if (!keepWeight || repsAt(wt) < MIN_REPS - 1) {
    while (repsAt(wt) < MIN_REPS) { const d = wDown(wt, t); if (d == null) break; wt = d; }
  }
  return { weight: wt, reps: Math.max(MIN_REPS, repsAt(wt)) };
}

// Nie weniger als MIN_REPS Wdh.: sonst das Gewicht so weit senken, dass MIN_REPS mit derselben Anstrengung passen
// (Eigengewicht: mindestens MIN_REPS – schafft man weniger, empfiehlt die App eine leichtere Variante, siehe bwHint)
function atLeastMinReps(p, t) {
  if (p.reps == null || p.reps >= MIN_REPS) return p;
  if (p.weight == null) return t.bodyweight ? { ...p, reps: MIN_REPS } : p;
  const step = t.step || 2.5;
  const w = wSnap(p.weight * repFactor(MIN_REPS + t.rir) / repFactor(p.reps + t.rir), t, Math.floor);
  return { weight: Math.max(t.weights ? t.weights[0] : step, w), reps: MIN_REPS };
}

// Satzziel laut Plan: Satz 1 = Ziel-Wdh., danach je Satz FATIGUE weniger (mind. MIN_REPS)
const goalReps = (t, i) => Math.max(MIN_REPS, t.reps - FATIGUE * i);

// Nächste Gewichtsstufe, sobald die Leistung (cap Wdh. bis zum Versagen bei w) reicht,
// um mit w + step noch goal Wdh. mit Ziel-Tank (nach k Sätzen Ermüdung) zu schaffen.
function stepUp(cap, w, t, k, goal) {
  if (w == null || (!t.step && !t.weights)) return null;
  const up = wUp(w, t);
  if (up == null) return null;  // schon das schwerste vorhandene Gewicht -> weiter über die Wdh.
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
  const bwEl = $view.querySelector(`[data-bwhint="${ei}"]`);
  if (bwEl) { const html = bwHint(en); bwEl.innerHTML = html; bwEl.hidden = !html; }
  updateNextHints(ei);
  if (t.own) return;  // eigener Plan: folgende Sätze nicht anpassen
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
    // Nie schwerer als der Satz davor (kein Zickzack, kein Sprung nach oben) – dann eben mehr Wdh. bei dessen Gewicht
    if (!s.manualWeight && p.weight != null) {
      let pw = null;
      for (let i = j - 1; i >= 0; i--) if (variantOf(en.sets[i]) === variantOf(s)) { pw = parseNum(en.sets[i].weight); break; }
      if (pw != null && p.weight > pw) p = planSet(cap, w, tt, j - last, pw);
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
      const pl = en.planned[j];
      p = {
        weight: p.weight != null && keep != null && p.weight < keep ? p.weight : keep,
        reps: Math.min(p.reps, t.bodyweight && pl && pl.reps != null ? pl.reps : t.reps),
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

// Früheres Modell (nur noch für die Übernahme alter Daten): Zykluswochen = Kalenderwochen ab c.start (Montag),
// c.begin = erster Trainingsmontag bei Einstieg mitten im Zyklus.
// Wird schon beim Laden der Daten gebraucht (vor den const-Hilfen weiter unten) -> ohne sie geschrieben.
function legacyCycleInfo(c, date) {
  const begin = c.begin && c.begin > c.start ? c.begin : c.start;
  const day = iso => new Date(iso + 'T12:00:00');
  const monday = mondayISO(date);
  const len = c.buildWeeks + 1;
  const n = Math.max(0, Math.round((day(monday < begin ? begin : monday) - day(c.start)) / (7 * 86400000)));
  const cycle = Math.floor(n / len) + 1;
  const start = day(c.start);
  start.setDate(start.getDate() + 7 * (cycle - 1) * len);
  return { cycle, week: n % len + 1, cycleStart: start.toLocaleDateString('sv-SE') };
}

// Zykluswochen sind Durchläufe, keine Kalenderwochen: eine Woche ist geschafft, sobald jeder Trainingstag des
// Plans (bei 2× pro Woche: zweimal) trainiert wurde – egal, ob in 6, 7 oder 9 Tagen. Woche 1..buildWeeks = Aufbau,
// buildWeeks + 1 = Deload, danach der nächste Zyklus.
// data.cycle = { buildWeeks, start, week, no }: aktueller Durchlauf (start = Kennung des Zyklus, sortierbar wie ein
// Datum; no = Nummer des Zyklus). Jedes Training speichert cycleStart + week seines Durchlaufs.
const roundKey = (start, week) => `${start}|${week}`;
const roundSessions = (start, week) => data.sessions.filter(s => s.cycleStart === start && s.week === week);

// Wie oft kommt ein Trainingstag in Durchlauf week dran? Sonst plan.perWeek (1 oder 2). Wechsel-Pläne (plan.rotate =
// Trainings pro Woche, User-Wunsch 2026-11-04): die Tage laufen über die Wochen der Reihe nach weiter – z. B. Ober-/
// Unterkörper bei 3 Trainings: Woche 1 O·U·O, Woche 2 U·O·U … (jeder Muskel im Schnitt 1,5× pro Woche); neuer Zyklus beginnt vorn
const activeDays = (p = activePlan()) => p.days.filter(d => d.exercises.some(e => e.name.trim()));
function dayTimes(day, week, p = activePlan()) {
  if (!p.rotate) return p.perWeek || 1;
  const list = activeDays(p), m = list.length, j = list.indexOf(day);
  if (j < 0) return 0;
  const t0 = (Math.max(1, week) - 1) * p.rotate;
  let n = 0;
  for (let t = t0; t < t0 + p.rotate; t++) if (t % m === j) n++;
  return n;
}
// durchschnittlich je Tag pro Woche (für Wochenvolumen): Wechsel-Plan = Trainings ÷ Tage, z. B. 3 ÷ 2 = 1,5
const perWeekAvg = (p = activePlan()) => p.rotate ? p.rotate / Math.max(1, activeDays(p).length) : (p.perWeek || 1);
// „Eine Woche ist geschafft, sobald …“
const roundDoneText = (p = activePlan()) => p.rotate ? `die ${p.rotate} Trainings der Woche gemacht sind (die Tage wechseln sich ab)`
  : `jeder Trainingstag einmal${(p.perWeek || 1) > 1 ? ' bzw. zweimal' : ''} dran war`;

// In einem Durchlauf ausgelassene Tage (ungeplante Pause, User-Wunsch 2026-11-04): je Eintrag ein ausgelassenes Training
// dieses Tages – sie zählen für „Woche geschafft“ wie erledigt, haben aber kein Training (keine Werte, kein Vergleich)
const roundSkipped = (start, week) => (data.roundSkips || {})[roundKey(start, week)] || [];

// Noch offene Trainings eines Durchlaufs: [{ day, left }] für die Tage des aktiven Plans
function roundOpen(start, week) {
  const done = roundSessions(start, week), skipped = roundSkipped(start, week);
  return activeDays()
    .map(day => ({ day, left: dayTimes(day, week) - done.filter(s => s.dayId === day.id).length - skipped.filter(id => id === day.id).length }))
    .filter(x => x.left > 0);
}

// Neue Zykluskennung: heutiges Datum, aber immer später als alle bisherigen
function newCycleId(after = data.cycle.start) {
  const today = todayISO();
  return today > after ? today : after + 'a';
}

// Deload „selbst bestimmen“ (plan.deload = 'self'): kein automatischer Deload. Nach der letzten Aufbauwoche geht es
// Woche für Woche weiter (Woche 5, 6 … mit Volumen und Tank der letzten Aufbauwoche, Gewicht/Wdh. steigen weiter),
// bis man den Deload selbst einlegt (data.cycle.deloadAt = diese Woche des aktuellen Zyklus). Danach: neuer Zyklus.
// Sonst ('auto'): Deload = Woche buildWeeks + 1.
const selfDeload = () => activePlan().deload === 'self' && !ownPlan();

// Ist diese Woche (Durchlauf) ein Deload? Gespeicherte Trainings wissen es selbst, sonst laut Plan-Einstellung.
function isDeloadRound(start, week) {
  if (roundSessions(start, week).some(s => s.deload)) return true;
  if (selfDeload()) return start === data.cycle.start && data.cycle.deloadAt === week;
  return week === cycleLenOf(start) + 1;
}

// Aufbauwochen eines Zyklus: laufender Zyklus wie eingestellt, frühere wie damals, neue mit der Standardlänge
const cycleLenOf = start => start === data.cycle.start ? data.cycle.buildWeeks
  : data.cycle.lens[start] != null ? data.cycle.lens[start] : data.cycle.defWeeks;
const roundLabel = (start, week) => isDeloadRound(start, week) ? 'Deload-Woche' : weekLabel(week);
const ciLabel = ci => ci.deload ? 'Deload-Woche' : weekLabel(ci.week);

// Durchlauf nach ci: nächste Woche bzw. nach dem Deload der nächste Zyklus (Kennung: Tag des letzten Deload-Trainings)
function roundAfter(ci) {
  if (!ci.deload) return { start: ci.cycleStart, week: ci.week + 1, no: ci.cycle };
  const last = roundSessions(ci.cycleStart, ci.week).map(s => new Date(s.date).toLocaleDateString('sv-SE')).sort().pop();
  // Zyklus, der mit dem Deload begonnen hat (nach Pause/Krankheit): die Intro-Woche danach gehört noch zum selben Zyklus
  const lead = data.cycle.leadDl && data.cycle.leadDl === ci.cycleStart;
  return { start: last && last > ci.cycleStart ? last : newCycleId(ci.cycleStart), week: 1, no: ci.cycle + (lead ? 0 : 1) };
}

function toCycleInfo(start, week, no, bw) {
  const deload = selfDeload() ? start === data.cycle.start && data.cycle.deloadAt === week : week === bw + 1;
  return { cycle: no, week, buildWeeks: bw, cycleStart: start, deload, intro: week === 1 && !deload, extra: !deload && week > bw };
}

// Aktueller Durchlauf. Ist der gespeicherte Durchlauf komplett, gilt schon der nächste.
function cycleInfo() {
  const c = data.cycle;
  const bw = c.buildWeeks;
  const ci = toCycleInfo(c.start, selfDeload() ? c.week : Math.min(c.week, bw + 1), c.no || 1, bw);
  const done = data.days.length && (roundSessions(ci.cycleStart, ci.week).length || roundSkipped(ci.cycleStart, ci.week).length)
    && !roundOpen(ci.cycleStart, ci.week).length;
  if (!done) return ci;
  const n = roundAfter(ci);
  return toCycleInfo(n.start, n.week, n.no, cycleLenOf(n.start));
}

// Aktuellen Durchlauf festlegen (Assistent, Woche umstellen, nach dem Speichern eines Trainings).
// Ein selbst eingelegter Deload gilt nur im Zyklus, in dem er eingelegt wurde.
function setRound(start, week, no) {
  if (start !== data.cycle.start) {
    delete data.cycle.deloadAt;
    // neuer Zyklus: Länge des alten merken, der neue beginnt mit der Standardlänge
    if (data.cycle.start) data.cycle.lens[data.cycle.start] = data.cycle.buildWeeks;
    data.cycle.adj = 0;
    data.cycle.buildWeeks = data.cycle.lens[start] != null ? data.cycle.lens[start] : data.cycle.defWeeks;
  }
  Object.assign(data.cycle, { start, week, no });
}

// Laufenden Zyklus verlängern/verkürzen: Länge = Standard + adj, nie kürzer als die laufende Woche
function setCycleAdj(adj) {
  const ci = cycleInfo();
  const min = ci.deload ? data.cycle.buildWeeks : Math.max(1, ci.week);
  const len = Math.min(12, Math.max(min, data.cycle.defWeeks + adj));
  data.cycle.adj = len - data.cycle.defWeeks;
  data.cycle.buildWeeks = len;
}

// Deload „selbst bestimmen“: ab jetzt Deload-Woche. Wurde in der laufenden Woche schon trainiert, bleibt das dort
// gespeichert und der Deload ist die nächste Woche.
function startDeloadNow() {
  const ci = cycleInfo();
  const w = roundSessions(ci.cycleStart, ci.week).length ? ci.week + 1 : ci.week;
  setRound(ci.cycleStart, w, ci.cycle);
  data.cycle.deloadAt = w;
}

const DELOAD_WEIGHT = 0.85;  // Deload: 15 % weniger Gewicht als in der letzten Trainingswoche (User-Regel 2026-11-03, vorher 20 %)

// Progression, getrennt schaltbar: volume = mehr Sätze von Woche zu Woche, load = Gewicht/Wdh. steigern.
// Grundeinstellung des Plans (ganzer Zyklus) -> Abweichung einer Woche (Schlüssel: roundKey) ->
// Abweichung eines einzelnen Trainings (draft.progression).
const PROG_KEYS = { volume: 'Volumen', load: 'Gewicht & Wdh.' };
const planProgression = (p = activePlan()) => ({ volume: true, load: true, ...p.progression });
const weekProgression = (key, p = activePlan()) => ({ ...planProgression(p), ...(p.weekProgression || {})[key] });

// Satz-Woche: ohne Volumenprogression gelten die Sätze der Vorwoche – also die der letzten Woche
// dieses Zyklus mit Volumenprogression (sonst Intro). volumeNow = Einstellung für das aktuelle Training.
function volumeWeek(ci, volumeNow) {
  if (volumeNow) return ci.week;
  for (let w = ci.week - 1; w > 1; w--) if (weekProgression(roundKey(ci.cycleStart, w)).volume) return w;
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
const RIR_PLAN = { 4: [2, 1.5, 1, 0.5] };  // Eckwerte Start … Höhepunkt (siehe curveAt)

// Sätze und Tank sind als 4 Eckwerte gespeichert (Start, 2, 3, Höhepunkt). Bei einer anderen Zykluslänge verteilt die App
// den Anstieg gleichmäßig auf die Aufbauwochen der Standardlänge (data.cycle.defWeeks); Wochen darüber hinaus
// (Zyklus verlängert) bleiben auf dem Höhepunkt. curveLenOverride: Eckwerte direkt ansehen (Volumen-Tabelle).
const ANCHORS = 4;
let curveLenOverride = null;
const curveLen = () => curveLenOverride || data.cycle.defWeeks || ANCHORS;
const anchorPos = (week, len = curveLen()) => len <= 1 ? 0 : (Math.min(Math.max(week, 1), len) - 1) / (len - 1) * (ANCHORS - 1);
function curveAt(arr, week, len = curveLen()) {
  const p = anchorPos(week, len), i = Math.floor(p), f = p - i;
  const at = k => arr[Math.min(k, arr.length - 1)];
  return at(i) + (at(i + 1) - at(i)) * f;
}

// Übungsart: Grundübungen +1 im Tank, Assistenzübungen −1 (näher ans Muskelversagen)
const KINDS = { compound: 'Grundübung', normal: 'Normale Übung', assist: 'Assistenzübung' };
const KIND_OFFSET = { compound: 1, normal: 0, assist: -1 };
const COMPOUND = /^(kniebeugen|frontkniebeugen|bankdrucken[^(]*\(langhantel|kreuzheben|schulterdrucken langhantel|rudern langhantel|dips|umsetzen|reissen)/;
const ASSIST = /curls|bizeps|seitheben|frontheben|trizeps|kickbacks|stirndrucken|beinstrecker|beinbeuger|butterfly|fliegende|crossover|wadenheben|face pulls|reverse|crunches|sit-ups|beinheben|knieheben|plank|seitstutz|russian|bauchroller|rotation|holzhacker|shrugs|abduktoren|adduktoren|handgelenk|uberzuge|glute|sissy/;

// Eigengewichtsübungen: Steigerung nur über die Wdh. (kg-Spalte = Körpergewicht), kein automatisches Aufwärmen.
// ex.bwLoad = true: Gewichtsprogression trotzdem an (z. B. mit Zusatzgewicht) – dann wie eine normale Übung.
const BODYWEIGHT = /^(klimmzuge(?!.*(zusatzgewicht|assist))|dips \((brust|trizeps)\)|bankdips|liegestutze|hyperextensions \(|sissy squats|nordic|crunches( schragbank)?$|sit-ups|beinheben|knieheben|plank|seitstutz|bauchroller|burpees|glute bridge|pike-liegestutze|diamant-liegestutze|rudern umgekehrt|kniebeugen eigengewicht|einbeinige kniebeugen|bulgarian split squats ohne|ausfallschritte eigengewicht|beincurls am boden|hip thrust am sofa|seitliches beinheben|clamshells|copenhagen|wadenheben an der treppe|dead bug|superman|y-t-w)/;
// Bandübungen laufen wie Eigengewicht (ohne kg, Steigerung über die Wdh.), dazu die Bandstufe (siehe bandShift)
const isBodyweightName = name => BODYWEIGHT.test(norm(String(name || '').trim())) || isBandName(name);
const isBodyweight = ex => !!ex && !ex.bwLoad && isBodyweightName(ex.name);

// Bezugstraining ohne Gewichte (für Eigengewichtsübungen: nur die Wdh. zählen)
const withoutWeight = e => e && {
  ...e,
  sets: (e.sets || []).map(s => ({ ...s, weight: null })),
  planned: (e.planned || []).map(p => p && { ...p, weight: null }),
};

// Zuletzt eingetragenes Körpergewicht (kg) oder null
function currentBodyweight() {
  const last = [...data.bodyweight].sort((a, b) => b.date.localeCompare(a.date))[0];
  return last ? last.kg : null;
}

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
  const arr = custom || RIR_PLAN[4];
  // Eckwerte als Kurve über die Zykluswochen, auf halbe Wdh. gerundet (Bereiche [min, max] je Grenze)
  const half = v => Math.round(v * 2) / 2;
  const lo = half(curveAt(arr.map(b => Array.isArray(b) ? b[0] : b), week));
  const hi = half(curveAt(arr.map(b => Array.isArray(b) ? b[1] : b), week));
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
  const plan = Array.from({ length: Math.max(1, buildWeeks) });
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
  'upper-heavy': 'Oberkörper – niedrige Wdh.', 'upper-light': 'Oberkörper – hohe Wdh.',
  'lower-heavy': 'Unterkörper – niedrige Wdh.', 'lower-light': 'Unterkörper – hohe Wdh.',
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

const VOL_WEEKS = 4;  // Eckwerte Intro, W2, W3, W4 – bei anderer Zykluslänge als Kurve (siehe curveAt)
const volWeekIdx = week => Math.round(anchorPos(week));  // nächster Eckwert (für Zusatzsätze)

// Trainingstage mit Tag-Typ, die Übungen dieser Muskelgruppe haben (in Plan-Reihenfolge)
const daysWithGroup = g => data.days.filter(d => dayIntensity(d) && d.exercises.some(e => e.name.trim() && groupOf(e) === g));

// Wochenvolumen, das nicht glatt auf die Trainings aufgeht: so viele Tage (die ersten) bekommen 1 Satz mehr.
// activePlan().volExtra = { Muskelgruppe: [Intro, W2, W3, W4] }
const volExtraFor = (g, w) => ((activePlan().volExtra || {})[g] || [])[w] || 0;

// Sätze pro Training für eine Muskelgruppe an einem bestimmten Tag (Grundwert + ggf. 1 zusätzlicher Satz).
// vol = Volumen-Tabelle; der Plan-Assistent rechnet mit seinem Entwurf (dort gibt es keine Zusatzsätze).
function dayVolume(day, g, week, vol = data.volume) {
  // Plan-Assistent: Eckwerte direkt (Wochen 1–4); sonst Kurve über die Zykluslänge
  const len = vol === data.volume ? curveLen() : ANCHORS;
  const w = Math.round(anchorPos(week, len));
  let v = Math.round(curveAt(vol[g], week, len));
  if (vol === data.volume) {
    const idx = daysWithGroup(g).indexOf(day);
    if (idx >= 0 && idx < volExtraFor(g, w)) v += 1;
  }
  return v;
}

// Geplante Sätze pro Woche (vor der Verteilung auf die Übungen): Summe über die Tage × Durchgänge pro Woche
function weeklyTarget(g, w) {
  const days = daysWithGroup(g);
  curveLenOverride = ANCHORS;  // Eckwert w direkt
  let sum;
  try { sum = days.reduce((a, d) => a + dayVolume(d, g, w + 1), 0); } finally { curveLenOverride = null; }
  return Math.round(sum * perWeekAvg());  // Wechsel-Plan: Schnitt der Wochen, auf ganze Sätze gerundet
}

// Wochenvolumen einstellen: gleichmäßig auf die Trainings verteilen, Rest als +1 Satz an einzelnen Tagen
function setWeeklyVolume(g, w, total) {
  const p = activePlan();
  const days = daysWithGroup(g).length, per = perWeekAvg(p);
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
  curveLenOverride = ANCHORS;  // Eckwerte (Volumen-Tabelle)
  try { return weeklyVolumeAnchors(g); } finally { curveLenOverride = null; }
}
function weeklyVolumeAnchors(g) {
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
  const n = perWeekAvg();  // jeder Tag n-mal pro Woche (Wechsel-Plan: im Schnitt)
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
  const per = perWeekAvg();
  const act = weeklyVolume(g);
  const target = [0, 1, 2, 3].map(w => weeklyTarget(g, w));
  let t = '';
  if (typed && target[typed[0]] !== typed[1]) {
    t += `→ ${typed[1]} lässt sich nicht gleichmäßig auf ${fmtNum(days.length * per)} Trainings verteilen – es werden ${target[typed[0]]}. `;
  }
  t += `${per % 1 ? 'Ø ' : ''}${fmtNum(round1(days.length * per))} Training${days.length * per === 1 ? '' : 's'} pro Woche · Deload ${fmtNum(Math.round(act[4]))}`;
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
// half: Anstieg ab der Intro-Woche halbiert (Training an Diät/Minicut angepasst, siehe nutTrainAdapt)
function autoSetsForDay(day, week, deload, vol = data.volume, half = false) {
  const res = new Map();
  const vw = (g, w) => {
    const v = dayVolume(day, g, w, vol);
    if (!half) return v;
    const intro = dayVolume(day, g, 1, vol);
    return intro + Math.floor((v - intro) / 2);  // halber Satz -> abrunden
  };
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
      sets = distributeStart(exs, Math.ceil(dayVolume(day, g, 99, vol) / 2));  // Deload: halber Höhepunkt
    } else {
      sets = distributeStart(exs, dayVolume(day, g, 1, vol));
      const state = { k: 0 };
      for (let w = 2; w <= week; w++) addSets(exs, sets, Math.max(0, vw(g, w) - vw(g, w - 1)), state);
    }
    sets.forEach((v, id) => res.set(id, v));
  }
  return res;
}

// Geschätzte Trainingsdauer in Minuten (User-Vorgabe 2026-11-03): je Satz 1 min, nach jedem Satz Pause nach Übungsart –
// Grundübung 4, normale Übung 3, Isolation (Assistenz) 2 min; nach dem letzten Satz des Trainings keine Pause.
// Sätze wie im Training (draftEntries): Muskelgruppen-Volumen der Woche, sonst Wochenplan der Übung; deload = halbe Sätze.
const REST_MIN = { compound: 4, normal: 3, assist: 2 };
function estDuration(day, week, plan = activePlan(), deload = false) {
  const exs = day.exercises.filter(e => e.name.trim());
  if (!exs.length) return 0;
  const bw = data.cycle.buildWeeks || 4;
  const w = Math.min(Math.max(1, week), bw);
  const auto = autoSetsForDay(day, deload ? bw : w, deload, plan.volume || {});
  let t = 0, rest = 0;
  for (const ex of exs) {
    const n = auto.has(ex.id) ? auto.get(ex.id) : deload ? deloadSets(setsForWeek(ex, bw, bw)) : setsForWeek(ex, w, bw);
    rest = REST_MIN[kindOf(ex)] || 3;
    t += n * (1 + rest);
  }
  return t - rest;
}
// „ca. 55 min“ bzw. „ca. 45–60 min“ (auf 5 min gerundet)
function estText(lo, hi = lo) {
  const r = m => Math.max(5, Math.round(m / 5) * 5);
  const a = r(Math.min(lo, hi)), b = r(Math.max(lo, hi));
  if (a === b) return `ca. ${fmtDur(a)}`;
  return b <= 60 ? `ca. ${a}–${b} min` : `ca. ${fmtDur(a)} – ${fmtDur(b)}`;
}
// Spanne eines Tages über den Zyklus: Intro-Woche bis Höhepunkt (eigener Plan: immer gleich)
const estRange = (day, plan = activePlan()) => [estDuration(day, 1, plan), estDuration(day, data.cycle.buildWeeks || 4, plan)];

// Zeitlimit (User-Wunsch 2026-11-04): Training auf limit Minuten kürzen. Zeit je Satz wie bei estDuration.
// Reihenfolge: 1. und 2. Satz für jede geplante Muskelgruppe (mit ihrer besten Übung – Grundübung vor normaler vor Isolation),
// dann alle weiteren Sätze der Grundübungen, danach normale Übungen, zuletzt Isolation. Passt ein Satz nicht mehr, wird er
// übersprungen (ein kürzerer kann noch passen). Kürzt draft-Einträge direkt; null = alles passt, nichts gekürzt.
const KIND_RANK = { compound: 0, normal: 1, assist: 2 };
function trimToTime(entries, limit) {
  const info = entries.map((en, i) => {
    const ex = planExercise(en.name) || { name: en.name }, kind = kindOf(ex);
    return { en, i, rank: KIND_RANK[kind] != null ? KIND_RANK[kind] : 1, rest: REST_MIN[kind] || 3, group: groupOf(ex), max: en.sets.length, n: 0 };
  });
  const time = () => { let t = 0, last = 0; for (const x of info) if (x.n) { t += x.n * (1 + x.rest); last = x.rest; } return t - last; };
  info.forEach(x => { x.n = x.max; });
  const before = time();
  if (before <= limit) return null;
  info.forEach(x => { x.n = 0; });
  // Vertreter je Muskelgruppe: beste Übungsart, bei Gleichstand die erste im Plan
  const reps = new Map();
  for (const x of info) { const r = reps.get(x.group); if (!r || x.rank < r.rank) reps.set(x.group, x); }
  const repList = [...reps.values()].sort((a, b) => a.rank - b.rank || a.i - b.i);
  const slots = [];
  for (const k of [1, 2]) for (const x of repList) if (x.max >= k) slots.push(x);
  const more = [];
  for (const x of info) for (let k = 1; k <= x.max; k++) if (!(reps.get(x.group) === x && k <= 2)) more.push({ x, k });
  more.sort((a, b) => a.x.rank - b.x.rank || a.k - b.k || a.x.i - b.x.i);
  for (const m of more) slots.push(m.x);
  for (const x of slots) { x.n++; if (time() > limit) x.n--; }
  if (!info.some(x => x.n)) { const first = repList[0] || info[0]; first.n = 1; }  // mindestens ein Satz
  const dropped = info.filter(x => !x.n).map(x => x.en.name);
  const cut = info.filter(x => x.n && x.n < x.max).map(x => ({ name: x.en.name, from: x.max, to: x.n }));
  for (const x of info) {
    if (!x.n || x.n === x.max) continue;
    x.en.sets.length = x.n;
    x.en.planned.length = Math.min(x.en.planned.length, x.n);
    x.en.target = { ...x.en.target, sets: x.n };
  }
  const kept = info.filter(x => x.n).map(x => x.en);
  entries.length = 0;
  entries.push(...kept);
  return { limit, before, after: time(), dropped, cut };
}

// Deload: Volumen halbieren (Sätze), Gewicht −15 %, nie schwerer als DELOAD_RIR im Tank.
// base = normales Ziel, damit man es beim Ersetzen der Übung neu berechnen kann.
const deloadSets = sets => Math.max(1, Math.round(sets / 2));
// Sätze pro Woche: Start in der Intro-Woche, Steigerung erst am Zyklusende –
// bei +1 nur in der letzten Woche, bei +2 in den letzten beiden Wochen je +1 usw.
// half: Anstieg halbiert (Training an Diät/Minicut angepasst)
function setsForWeek(ex, week, buildWeeks, half = false) {
  const full = Math.max(0, ex.setsEnd - ex.sets);
  const diff = half ? Math.floor(full / 2) : full;
  return ex.sets + Math.max(0, diff - (buildWeeks - week));
}

// ref: erster normaler Satz der letzten Trainingswoche (lastWorkSet) – Bezug für Gewicht und Wdh. (User-Regel
// 2026-11-03); ohne Training mit Gewicht wie bisher aus „Max. bei 10 Wdh.“
function deloadTarget(t, ref) {
  const normal = ref ? ref.weight : targetWeight(t);
  return {
    ...t,
    ...(ref ? { reps: Math.max(MIN_REPS, ref.reps) } : {}),
    sets: t.fixedSets ? t.sets : deloadSets(t.sets),  // automatisch verteilt: schon halbiert
    rir: Math.max(t.rir, DELOAD_RIR),
    weight: normal != null ? wSnap(normal * DELOAD_WEIGHT, t) : null,
    deload: true,
    base: t,
  };
}

// In welchem Zyklus und welcher Woche (Durchlauf) lag ein gespeichertes Training?
// (Ältere Trainings ohne Angabe bekommen sie beim Laden, siehe upgradeData.)
const sessionCycle = s => ({ cycleStart: s.cycleStart || '', week: s.week || 0 });

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
    if (e) return { date: s.date, cycleStart: c.cycleStart, week: c.week, occ: s.dayId === dayId ? sessionOccurrence(s) : null,
      sets: e.sets, planned: e.planned, target: e.target };
  }
  return null;
}

// Verlängerung des Zyklus vor diesem (Deload „selbst bestimmen“): { from: dessen Kennung, by: Zahl der Wochen nach
// den Aufbauwochen } – null, wenn er nicht verlängert wurde
function prevExtension(cycleStart) {
  const before = [...new Set(data.sessions.map(s => s.cycleStart).filter(cs => cs && cs < cycleStart))].sort().pop();
  if (!before) return null;
  const by = Math.max(0, ...data.sessions.filter(s => s.cycleStart === before && !s.deload).map(s => s.week)) - cycleLenOf(before);
  return by > 0 ? { from: before, by } : null;
}

// Gewählt beim ersten Training des Zyklus: Vergleich um die Verlängerung des letzten Zyklus versetzt
// (data.cycleShift[Kennung] = { from, by }; by = 0: Woche für Woche wie gewohnt)
const cycleShift = start => { const s = data.cycleShift[start]; return s && s.by ? s : null; };

// Vergleichswoche. Mit Verschiebung: Woche + by im verlängerten Zyklus davor (fehlt sie, wie gewohnt dieselbe Woche).
// plus: so viele Wdh. darf ein Satz gegenüber der Vergleichswoche zulegen (wächst mit dem Abstand, siehe cmpPlus)
function comparisonEntry(name, dayId, ci) {
  const sh = cycleShift(ci.cycleStart);
  const e = sh && findWeekEntry(name, dayId, c => c.cycleStart === sh.from && c.week === ci.week + sh.by, ci.occurrence || 1);
  const c = e ? { ...e, shifted: true } : sameWeekEntry(name, dayId, ci);
  return c && { ...c, plus: cmpPlus(cmpGap(c, ci)) };
}

// Abstand der Vergleichswoche zur Woche ci in Aufbauwochen (Deloads zählen nicht, die Woche ci zählt mit):
// trainierte Wochen des alten Zyklus nach der Vergleichswoche + Zyklen dazwischen + Wochen 1 … ci.week
function cmpGap(cmp, ci) {
  const weeksOf = cs => new Set(data.sessions.filter(s => s.cycleStart === cs && !s.deload).map(s => s.week));
  let gap = [...weeksOf(cmp.cycleStart)].filter(w => w > cmp.week).length + ci.week;
  const between = new Set(data.sessions.map(s => s.cycleStart).filter(cs => cs && cs > cmp.cycleStart && cs < ci.cycleStart));
  for (const cs of between) gap += weeksOf(cs).size;
  return gap;
}

// +1 Wdh. je n Wochen Abstand (n nach Erfahrung des Plans), mindestens 1 – Einsteiger z. B. 4-Wochen-Zyklus +1,
// 10 Wochen +3; Fortgeschrittene und alte Hasen werden langsamer stärker (10 Wochen: weiter +1). Vorher immer +1: bei
// langen Zyklen blieben Einsteiger hinter ihrer echten Kraft zurück (User-Regel 2026-11-03, Simulation sim4).
// Die Vorwoche bremst weiter: es gilt der niedrigere Vorschlag aus beiden (refProposal).
const CMP_WEEKS_PER_REP = { neuling: 4, einsteiger: 4, fortgeschritten: 8, hase: 12 };
const cmpWeeksPerRep = () => CMP_WEEKS_PER_REP[(hasActivePlan() && activePlan().level) || ''] || 8;  // ohne Angabe: wie Fortgeschritten
const cmpPlus = gap => Math.max(1, Math.round(gap / cmpWeeksPerRep()));

// Vergleichswoche ohne Verschiebung: dieselbe Woche (und derselbe Durchgang) im vorherigen Zyklus
// Erklärung bei versetztem Vergleich (leer ohne Verschiebung)
function shiftText(start, week) {
  const sh = cycleShift(start);
  return sh ? `Vergleich ist Woche ${week + sh.by} des letzten Zyklus (Verlängerung berücksichtigt) – das Gewicht kommt von dort, Wdh. und Tank wie in dieser Woche.` : '';
}

const sameWeekEntry = (name, dayId, ci) =>
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
  // Leichtes Gewicht (eine Stufe ist ein großer Sprung): erst die Wdh. senken, solange es höchstens 3 unter dem
  // Ziel und mind. MIN_REPS sind – statt zwischen zwei Gewichten hin- und herzuspringen (User-Regel 2026-11-03)
  const below = wDown(w, t);
  if ((below == null || bigStep(w, w - below)) && repsAt(w) >= Math.max(MIN_REPS, goal - 3)) return { weight: w, reps: Math.min(goal, repsAt(w)) };
  let wt = w;
  while (repsAt(wt) < goal) { const d = wDown(wt, t); if (d == null) break; wt = d; }
  return { weight: wt, reps: Math.max(MIN_REPS, Math.min(goal, repsAt(wt))) };
}

// Großer Gewichtssprung: eine Stufe ist mehr als BIG_STEP des Gewichts (z. B. 2,5 kg bei unter 25 kg)
const BIG_STEP = 0.1;
const bigStep = (w, step) => w != null && w > 0 && step > 0 && step / w > BIG_STEP;

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
// Mehr im Tank als das damalige Ziel (srcRir): Wdh. darauf umrechnen (abgerundet) – mehr Wdh. mit vollem Tank zählen.
// Weniger im Tank als geplant: auf das Tank-Ziel der neuen Woche umrechnen (gerundet) – mehr Wdh. mit weniger Tank
// sind keine Mehrleistung. Boden: nie weniger Wdh. als im Bezugssatz geschafft (User-Regel 2026-11-01); deutlich
// verfehlte Sätze laufen vorher über die Bremse (refProposal/missed).
// plus: so viele Wdh. Steigerung (true = 1, false = bestätigen); ab 2 zählt das Mehr auch für die nächste Gewichtsstufe.
function fromRef(src, target, plus, i, srcRir) {
  plus = +plus || 0;
  let weight = src.weight;
  let base = src.reps;
  if (src.reps != null && src.rir != null && srcRir != null) {
    base = src.rir < srcRir
      ? Math.round(src.reps + src.rir - (target.rir != null ? target.rir : srcRir))
      : Math.floor(src.reps + src.rir - srcRir + 1e-9);
  }
  let reps = base != null ? base + plus : goalReps(target, i);
  if (src.reps != null) reps = Math.max(reps, src.reps);
  if (src.reps != null && src.weight != null) {
    const cap = src.reps + (src.rir != null ? src.rir : target.rir) + Math.max(0, plus - 1);
    const up = stepUp(cap, src.weight, { step: 2.5, ...target }, 0, goalReps(target, i));
    if (up) ({ weight, reps } = up);
  }
  return { weight, reps };
}

// Vorschlag aus einer versetzten Vergleichswoche (Verlängerung berücksichtigt, z. B. Intro ↔ Woche 4): nur das Gewicht
// kommt von dort, Wdh. und Tank wie in der aktuellen Woche. Mit der damaligen Leistung (+1 Wdh. Steigerung) wird
// das Gewicht gesucht, mit dem die Ziel-Wdh. beim heutigen Tank-Ziel klappen: in Stufen runter, wenn es nicht reicht,
// eine Stufe hoch, wenn die Leistung schon dafür reicht.
function shiftedRef(src, target, i, srcRir, plus = 1) {
  const goal = goalReps(target, i);
  if (src.weight == null || src.reps == null) return { weight: src.weight, reps: goal };
  const cap = src.reps + (src.rir != null ? src.rir : srcRir != null ? srcRir : target.rir) + plus;
  const t = { step: 2.5, ...target };
  return stepUp(cap, src.weight, t, 0, goal) || weightForGoal(cap, src.weight, t, 0, goal);
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
  if (!en.target || !en.plan || draft.deload || draft.own || draft.week == null) return out;
  const done = en.sets.map(s => isDone(s));
  if (!done.some(Boolean)) return out;
  const bw = data.cycle.buildWeeks;
  const nw = draft.week + 1;
  if (nw > bw && !selfDeload()) return done.map(d => d ? '<span>→ Nächste Woche: Deload (leichter)</span>' : '');

  const num = s => ({ weight: parseNum(s.weight), reps: parseNum(s.reps), rir: parseNum(s.rir), variant: variantOf(s) });
  const doneSets = en.sets.filter(isDone).map(num);
  const ex = planExercise(en.name) || { name: en.name };
  const t = { ...en.plan, rir: rirFor(kindOf(ex), nw, bw, groupOf(ex)) };
  delete t.hold; delete t.intro;
  const hold = !weekProgression(roundKey(draft.cycleStart, nw)).load;
  // derselbe Durchgang nächste Woche (beim 2. Training kann dort noch das 1. Training der Woche begrenzen)
  const occ = draft.occurrence || 1;
  const cmp = hold ? null : comparisonEntry(en.name, draft.dayId, { week: nw, cycleStart: draft.cycleStart, occurrence: occ });
  const fmt = p => (p.weight != null ? `${fmtNum(p.weight)} kg × ` : '') + `${p.reps} Wdh.`;
  const when = occ > 1 ? `Nächste Woche, ${occ}. Training` : 'Nächste Woche';
  const lastW = {};  // zuletzt vorgeschlagenes Gewicht je Ausführung (kein Satz schwerer als der davor)

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
      why = r.rule === 'brake' ? 'Ziel verfehlt → leichter' : r.hold ? 'halten' : r.fromCmp ? 'Vergleich letzter Zyklus' : '';
    }
    p = atLeastMinReps(p, t);
    if (p.weight != null && lastW[v] != null && p.weight > lastW[v]) {
      p = { weight: lastW[v], reps: Math.max(MIN_REPS, repsAtWeight(p.reps, t.rir, p.weight, lastW[v])) };
    }
    if (p.weight != null) lastW[v] = p.weight;
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
// onlyPlan: nur Trainings der Tage des aktiven Plans (eigener Plan: Werte aus anderen Plänen zählen nicht)
function holdSets(name, v, onlyPlan = false) {
  const own = onlyPlan && new Set(data.days.map(d => d.id));
  for (const s of sessionsNewestFirst()) {
    if (s.deload || (own && !own.has(s.dayId))) continue;
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
// Vorwoche: Satz 1 +1 Wdh., Rest bestätigen (reicht die Leistung, nächste Gewichtsstufe); Vergleichswoche: +cmp.plus
// je Satz (+1 je 4 Wochen Abstand); gibt es beide, gilt der niedrigere. Satz in der Vorwoche deutlich verfehlt ->
// Gewicht runter, Wdh. wie damals geplant (leichte Gewichte: erst weniger Wdh., siehe weightForGoal).
function refProposal(t, prev, cmp, i, k, v) {
  const cmpV = ofVariant(cmp && cmp.sets, v);
  const prevV = ofVariant(prev && prev.sets, v);
  if (k < prevV.length && missed(prev, v, k)) {
    const src = prevV[k];
    const pl = ofVariant(prev.planned, v)[k];
    const goal = pl && pl.reps != null ? pl.reps : src.reps;
    if (src.weight == null) {
      // Eigengewicht: Wdh. so weit senken, dass das Tank-Ziel wieder stimmt (mind. MIN_REPS)
      const capBw = src.reps + (src.rir != null ? src.rir : t.rir);
      return { p: { weight: null, reps: Math.max(MIN_REPS, Math.floor(capBw - t.rir + 1e-9)) }, rule: 'brake' };
    }
    const cap = src.reps + (src.rir != null ? src.rir : t.rir);
    return { p: weightForGoal(cap, src.weight, { step: 2.5, ...t }, 0, goal), rule: 'brake' };
  }
  const rirOf = e => e && e.target && e.target.rir != null ? e.target.rir : null;  // damaliges Tank-Ziel
  const a = !cmpV.length ? null
    : cmp.shifted ? shiftedRef(refAt(cmpV, k), t, i, rirOf(cmp), cmp.plus || 1)
    : fromRef(refAt(cmpV, k), t, cmp.plus || 1, i, rirOf(cmp));
  const b = prevV.length ? fromRef(refAt(prevV, k), t, k === 0, i, rirOf(prev)) : null;
  if (a && b) {
    if (!lighterSet(a, b)) return { p: b, rule: 'lower', fromCmp: false };
    // Der letzte Zyklus ist leichter: Steigerung entfällt, aber das Gewicht der Vorwoche bleibt (Gewicht und Wdh.
    // halten) – weniger Gewicht gibt es nur, wenn ein Satz deutlich verfehlt wurde (Bremse oben). User-Regel 2026-11-02
    const src = refAt(prevV, k);
    if (a.weight != null && src.weight != null && a.weight < src.weight) {
      return { p: { weight: src.weight, reps: src.reps != null ? src.reps : a.reps }, rule: 'lower', fromCmp: true, hold: true };
    }
    return { p: a, rule: 'lower', fromCmp: true };
  }
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
    const ref = holdSets(en.name, v, t.own).map(s => t.bodyweight ? { ...s, weight: null } : s);
    if (ref.length) {
      const src = refAt(ref, k);
      p = { weight: src.weight, reps: src.reps };
      rule = 'hold';
    }
  } else {
    ({ p, rule } = refProposal(t, en.prevWeek, en.compare, i, k, v));
    if (!p && v) {
      const lastV = lastVariantSets(en.name, v).map(s => t.bodyweight ? { ...s, weight: null } : s);
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
  // Training an die Diät angepasst: kein höheres Gewicht als beim letzten Mal (Vorwoche, sonst letzter Zyklus) –
  // stattdessen höchstens 1 Wdh. mehr, soweit es das Tank-Ziel hergibt (User-Regel 2026-11-02)
  if (t.noLoadUp && p && p.weight != null && rule !== 'brake') {
    const prevV = ofVariant(en.prevWeek && en.prevWeek.sets, v), cmpV = ofVariant(en.compare && en.compare.sets, v);
    const ref = prevV.length ? refAt(prevV, k) : cmpV.length ? refAt(cmpV, k) : null;
    if (ref && ref.weight != null && ref.reps != null && p.weight > ref.weight) {
      const cap = ref.reps + (ref.rir != null ? ref.rir : t.rir);
      p = { weight: ref.weight, reps: Math.max(ref.reps, Math.min(ref.reps + 1, Math.floor(cap - t.rir + 1e-9))) };
      rule = 'diet';
    }
  }
  if (!p) {
    const b = en.base[Math.min(i, en.base.length - 1)];
    p = { weight: parseNum(b.weight), reps: parseNum(b.reps) };
  }
  if (!t.own) p = atLeastMinReps(p, t);  // eigener Plan: Wdh. bleiben, wie eingetragen
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
  if (w == null && t.bodyweight) reps = Math.max(MIN_REPS, reps);
  return {
    ...set,
    weight: w != null ? fmtNum(w) : set.weight,
    reps: String(Math.max(1, reps)),
    baseWeight: w != null ? w : set.baseWeight,
  };
}

// Wdh. bei einem anderen Gewicht mit derselben Anstrengung (Wdh. + Tank bei Gewicht from -> bei Gewicht to)
const repsAtWeight = (reps, rir, from, to) => Math.floor(capacityAt(reps + rir, from, to) - rir + 1e-9);

// Innerhalb eines Trainings nie schwerer als der Satz davor (derselben Ausführung): sonst dessen Gewicht,
// Wdh. passend umgerechnet. Leichter werden darf ein Satz (Ermüdung), wieder schwerer werden nicht (kein Zickzack).
function notHeavierThanBefore(en, i, v, set) {
  const w = parseNum(set.weight);
  if (w == null) return set;
  let before = null;
  for (let j = i - 1; j >= 0; j--) if (en.sets[j] && variantOf(en.sets[j]) === v) { before = en.sets[j]; break; }
  const pw = before && parseNum(before.weight);
  if (pw == null || w <= pw) return set;
  const rir = en.target.rir != null ? en.target.rir : 2;
  const reps = Math.max(MIN_REPS, repsAtWeight(parseNum(set.reps), rir, w, pw));
  return { ...set, weight: fmtNum(pw), reps: String(reps), baseWeight: pw };
}

// Satz i (neu) vorschlagen und den ursprünglichen Vorschlag für die Bremse merken
function applyProposal(en, i, v) {
  const { set: proposed, rule } = proposeSet(en, i, v);
  const set = notHeavierThanBefore(en, i, v, applyPenalty(proposed, en.target, draft.penalty || 0));
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
  if (isBodyweightName(en.name)) return null;  // Eigengewichtsübungen (auch mit Zusatzgewicht): kein Aufwärmsatz
  const k = kindOf(planExercise(en.name) || { name: en.name });
  if (k === 'compound') return /dips/.test(norm(en.name)) ? null : 'barbell';
  return k === 'normal' ? 'normal' : null;
}

const firstWorkWeight = en => parseNum(en.sets[0] && en.sets[0].weight);

function warmWeight(en, pct, work) {
  const step = (en.target && en.target.step) || stepFor(planExercise(en.name) || { name: en.name, step: null });
  const tw = en.target && en.target.weights;
  const w = tw ? wSnap(pct * work, en.target, Math.floor) : Math.max(step, roundTo(pct * work, step));
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
  // Standard zugeklappt (spart Platz, eine Übung passt so etwa auf einen Bildschirm): eine Zeile mit allen Werten,
  // aufgeklappt (en.warmOpen) zum Ändern
  const closed = !en.warmOpen;
  const summary = en.warmup.map(w => `${w.weight || '–'} kg × ${w.reps || '–'}`).join(' · ');
  const head = `<button class="warm-title warm-toggle" data-action="wu-toggle" data-ei="${ei}" aria-expanded="${!closed}">
      <span>🔥 Aufwärmen${closed ? ` <small>${esc(summary)}</small>` : ''}</span><span class="chev" aria-hidden="true">${closed ? '▸' : '▾'}</span></button>`;
  if (closed) return `<div class="warmup closed" data-warm="${ei}">${head}</div>`;
  let h = `<div class="warmup" data-warm="${ei}">${head}
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

// „Abbrechen“ vor dem Training (neue Übungen, Fragen): zurück zum Start, es beginnt kein Training
const CANCEL_START = {
  ask: 'Trainingsstart abbrechen?\n\nDas Training wird nicht begonnen.',
  run: () => { skipRoundFor = null; go('start'); },
};

const views = {
  start:    { title: 'Training',      tab: 'start',   render: renderStart },
  training: { title: () => draft ? draft.dayName : 'Training', tab: 'start', back: 'start', render: renderTraining, after: startTrainingTimer },
  plan:     { title: 'Trainingsplan', tab: 'plan',    render: renderPlan },
  day:      { title: 'Trainingstag',  tab: 'plan',    back: 'plan', render: renderDay },
  history:  { title: 'Verlauf',       tab: 'history', render: renderHistory },
  exercise: { title: p => p.name,     tab: 'history', back: p => [p.from || 'history', p.fromParams || {}], render: renderExercise },
  week:     { title: 'Trainingswoche', tab: 'start',  back: 'start', render: renderWeek },
  library:  { title: 'Übungsbibliothek', tab: 'plan', back: 'plan', render: renderLibrary },
  homeeq:   { title: 'Deine Ausrüstung', tab: 'plan', back: 'plan', render: () => renderHomeEq() },  // steht in wizard.js (später geladen)
  // Übung aus der Bibliothek: zurück dorthin, woher sie geöffnet wurde (from/fromParams)
  libadd:   { title: p => p.name ? 'Eigene Übung bearbeiten' : 'Eigene Übung', tab: 'plan',
    back: p => p.name ? ['libex', { name: p.name }] : ['library', {}], render: renderLibAdd },
  libex:    { title: p => p.name, tab: p => p.tab || 'plan', back: p => [p.from || 'library', p.fromParams || {}], render: renderLibEx },
  // aus der Wochenansicht geöffnet: params.week = roundKey dieser Woche
  session:  { title: p => p.edit ? 'Bearbeiten' : 'Training', tab: p => p.week ? 'start' : 'history',
    back: p => p.edit ? ['session', { id: p.id, week: p.week }] : p.week ? ['week', { key: p.week }] : ['history', {}],
    cancel: p => p.edit ? { ask: 'Bearbeitung abbrechen?\n\nDeine Änderungen an diesem Training werden nicht gespeichert.',
      run: () => { sessionEdit = null; go('session', { id: p.id, week: p.week }); } } : null,
    render: renderSession },
  // Zurück: vorige Frage, bei Frage 1 die neuen Übungen (falls abgefragt), sonst Start
  check:    { title: 'Vor dem Training', tab: 'start', render: renderCheck, cancel: () => CANCEL_START,
    back: p => p.step > 1 ? ['check', { ...p, step: p.step - 1 }]
      : p.exIds ? ['firstmax', { id: p.id, exIds: p.exIds, choice: p.choice }]
      : p.choice ? ['cyclechoice', { id: p.id, ...p.choice }] : ['start', {}] },
  firstmax: { title: 'Neue Übungen',     tab: 'start', render: renderFirstMax, cancel: () => CANCEL_START,
    back: p => p.choice ? ['cyclechoice', { id: p.id, ...p.choice }] : ['start', {}] },
  cyclechoice: { title: 'Neuer Zyklus',  tab: 'start', back: 'start', render: renderCycleChoice, cancel: () => CANCEL_START },
  entryweek: { title: 'Neuer Plan',      tab: 'start', back: 'start', render: renderEntryWeek, cancel: () => CANCEL_START },
  data:     { title: 'Optionen',      tab: 'data',    render: renderData, after: showAppVersion },
};

function go(view, params = {}) {
  current = { view, params };
  render();
  window.scrollTo(0, 0);
}

function render() {
  if (typeof nutSync === 'function') nutSync();  // Ernährung: Erhaltungswoche im Deload, Minicut-Abschnitte (nutrition.js)
  const v = views[current.view];
  $title.textContent = typeof v.title === 'function' ? v.title(current.params) : v.title;
  $back.hidden = !v.back;
  $cancel.hidden = !viewCancel();
  const tab = typeof v.tab === 'function' ? v.tab(current.params) : v.tab;
  document.querySelectorAll('#tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  $view.innerHTML = v.render(current.params);
  if (v.after) v.after(current.params);  // z. B. Diagramm zeichnen, wenn die Breite bekannt ist
  syncBackKey();
  syncTyping();  // Feld beim Neuzeichnen verschwunden (z. B. Seitenwechsel) -> Leiste wieder zeigen
  if (typeof tourCheck === 'function') tourCheck();  // Einführung beim ersten Öffnen (tour.js)
}

// „Abbrechen“ oben rechts bei mehrstufigen Vorgängen: views[…].cancel = { ask, run } (oder Funktion der params,
// die das liefert bzw. null). ask = Rückfrage, run = was danach passiert.
function viewCancel() {
  const c = views[current.view].cancel;
  return typeof c === 'function' ? c(current.params) : c || null;
}

// Zurück-Taste bzw. -Geste des Handys (und des Browsers) wie „Zurück“ oben: Auf Unterseiten liegt ein zusätzlicher
// Eintrag im Browser-Verlauf, den die Taste verbraucht, statt die App zu schließen. Auf den Hauptseiten wird er
// wieder entfernt, damit die Taste die App dort wie gewohnt schließt.
let skipPop = false;  // Eintrag wird gerade selbst entfernt -> dieses popstate nicht als „Zurück“ werten

// Beim Zurückgehen im Browser-Verlauf stellt der Browser sonst die damalige Scroll-Position wieder her –
// die App springt dann plötzlich z. B. ganz nach unten. Die Position bestimmt die App selbst (go/back).
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// Während getippt wird (Tastatur offen), die untere Leiste ausblenden – sie würde sonst über der Tastatur
// hängen bzw. beim Scrollen aus dem Bild wandern
const isTypingField = el => el && (el.tagName === 'TEXTAREA'
  || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file', 'date'].includes(el.type)));
// Leiste nur ausblenden, solange wirklich in ein Feld getippt wird (sichtbare App, Feld hat den Fokus)
const syncTyping = () => document.body.classList.toggle('typing',
  document.visibilityState === 'visible' && isTypingField(document.activeElement));
document.addEventListener('focusin', e => { if (isTypingField(e.target)) document.body.classList.add('typing'); });
// kurz warten: beim Wechsel ins nächste Feld bleibt die Tastatur offen
document.addEventListener('focusout', () => setTimeout(syncTyping, 100));
// Mitten im Tippen zum Homebildschirm o. Ä. gewechselt: Feld verlassen (Tastatur zu), beim Zurückkommen Leiste
// wieder zeigen und die Bildschirmposition neu berechnen lassen (sonst bleibt die Leiste verrutscht)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && isTypingField(document.activeElement)) document.activeElement.blur();
  syncTyping();
  if (document.visibilityState === 'visible') requestAnimationFrame(() => window.scrollTo(window.scrollX, window.scrollY));
});
window.addEventListener('pageshow', syncTyping);

function syncBackKey() {
  if (skipPop) return;
  const armed = !!(history.state && history.state.sub);
  const sub = !!views[current.view].back;
  if (sub && !armed) history.pushState({ sub: true }, '');
  else if (!sub && armed) { skipPop = true; history.back(); }
}

window.addEventListener('popstate', () => {
  if (skipPop) { skipPop = false; syncBackKey(); return; }
  if (views[current.view].back) actions.back(); else syncBackKey();
});

// action = Wochen antippbar: 'week-open' (Trainings der Woche ansehen) oder
// 'cycle-jump' („Zyklus anpassen“ an der Zykluskarte: diese Woche als die gewählte Zykluswoche zählen)
// Deload „selbst bestimmen“: Wochen bis zur aktuellen (auch über die Aufbauwochen hinaus); die Deload-Pille gibt es
// beim Ansehen nur, wenn gerade Deload ist – unter „Zyklus anpassen“ (cycle-jump) legt sie den Deload ein.
function cyclePills(ci, action = null) {
  const self = selfDeload();
  const weeks = !self ? ci.buildWeeks : ci.deload ? Math.max(1, ci.week - 1) : Math.max(ci.buildWeeks, ci.week);
  const pill = (w, label, cls, state) => action
    ? `<button class="pill ${cls} ${state}" data-action="${action}" data-w="${w}">${label}</button>`
    : `<span class="pill ${cls} ${state}">${label}</span>`;
  let h = '<div class="pills">';
  for (let i = 1; i <= weeks; i++) {
    const state = i === ci.week && !ci.deload ? 'now' : i < ci.week || ci.deload ? 'past' : '';
    h += pill(i, i === 1 ? 'Intro' : i, i === 1 ? 'intro' : '', state);
  }
  if (!self) h += pill(ci.buildWeeks + 1, 'Deload', 'dl', ci.deload ? 'now' : '');
  else if (ci.deload) h += pill(ci.week, 'Deload', 'dl', 'now');
  else if (action === 'cycle-jump') h += pill('deload', 'Deload', 'dl', '');
  return h + '</div>';
}

// Stand des Durchlaufs: „1 von 3 Trainings erledigt · offen: Pull, Beine“
function roundStatus(ci) {
  const total = activeDays().reduce((a, d) => a + dayTimes(d, ci.week), 0);
  const open = roundOpen(ci.cycleStart, ci.week);
  const left = open.reduce((a, x) => a + x.left, 0);
  const sk = roundSkipped(ci.cycleStart, ci.week).filter(id => findDay(id)).length;
  if (!total) return '';
  return `${total - left - sk} von ${total} Trainings erledigt${sk ? ` · ${sk} ausgelassen` : ''}` +
    (left ? ` · offen: ${open.map(x => esc(x.day.name) + (x.left > 1 ? ` (${x.left}×)` : '')).join(', ')}` : '');
}

function cycleCard(ci) {
  if (ownPlan()) {
    return `<div class="card cycle">
      <h2>Eigener Plan</h2>
      <p class="round-status">🔄 ${roundStatus(ci)}</p>
      <p class="sub">Ohne Zyklen und ohne Steigerung durch die App – im Training stehen immer deine Werte vom letzten Mal.</p>
    </div>`;
  }
  const head = ci.deload
    ? `Zyklus ${ci.cycle} · Deload-Woche`
    : `Zyklus ${ci.cycle} · ${weekLabel(ci.week)}${ci.intro ? '' : ci.extra ? ' · Verlängerung' : ` von ${ci.buildWeeks}`}`;
  const self = selfDeload();
  const sub = ci.deload
    ? `Halbe Sätze, 15 % weniger Gewicht als in der letzten Trainingswoche, mind. ${DELOAD_RIR} Wdh. im Tank. Danach beginnt der nächste Zyklus.`
    : shiftText(ci.cycleStart, ci.week) && !ci.extra
      ? `${ci.intro ? 'Start-Sätze laut Plan. ' : ''}${shiftText(ci.cycleStart, ci.week)}`
    : ci.intro
      ? `Start-Sätze laut Plan. Werte der letzten Intro-Woche, je Satz +1 Wdh. pro ${cmpWeeksPerRep()} Wochen Abstand.`
      : ci.extra
        ? 'Weiter mit Sätzen und Tank der letzten Aufbauwoche – Gewicht und Wdh. steigen weiter, bis du den Deload einlegst.'
        : `Werte derselben Woche im letzten Zyklus, je Satz +1 Wdh. pro ${cmpWeeksPerRep()} Wochen Abstand.`;
  const wp = weekProgression(roundKey(ci.cycleStart, ci.week));
  const off = ci.deload ? '' : progOffText({ ...wp, volume: wp.volume || ci.week === 1 });
  return `<div class="card cycle ${ci.deload ? 'is-deload' : ''}">
    <h2>${head}</h2>${cyclePills(ci, feat('week-view') ? 'week-open' : null)}
    <p class="round-status">🔄 ${roundStatus(ci)}</p>
    <p class="sub">${sub} Eine Woche ist geschafft, sobald ${roundDoneText()} – egal, wie viele Tage du dafür brauchst.</p>
    ${off ? `<p class="prog-note">⏸ Diese Woche ${off}</p>` : ''}
    ${self && !ci.deload ? `<button class="btn outline deload-btn" data-action="deload-now">😮‍💨 Deload-Woche einlegen</button>
      <p class="tap-hint">Deload selbst bestimmen: Leg ihn ein, wann du ihn brauchst.</p>` : ''}
    ${feat('week-view') ? '<p class="tap-hint">Woche antippen: Trainings ansehen und bearbeiten</p>' : ''}
    ${cycleAdjustHtml(ci)}
  </div>`;
}

// Start-Bildschirm: Stillstand-Hinweise und Beschwerden dieses Zyklus
function hintsCard() {
  const hints = feat('stall-hints') ? stagnationHints() : [];
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

// Bisherige Nutzer (vor den Modi): einmal fragen, wie viel die App zeigen soll – bis dahin Experte (alles wie gewohnt)
function modeAskCard() {
  const p = data.profile || {};
  if (p.mode || (!data.sessions.length && !data.plans.length)) return '';
  return `<div class="card hints mode-ask"><p><b>✨ Neu: Wähle, wie viel die App zeigt</b></p>
      <div class="mode-opts">${Object.entries(APP_MODES).map(([k, x]) =>
        `<button class="split-opt ${k === 'x' ? 'on' : ''}" data-action="mode-set" data-m="${k}"><b>${x.icon} ${x.label}</b><small>${x.text}</small></button>`).join('')}</div>
      <p class="hint">Bisher siehst du alles (Experte). Deine Daten und dein Plan bleiben in jedem Modus gleich – auch die Steigerung im
        Training. Wechseln kannst du jederzeit in den Optionen.</p>
      <button class="btn" data-action="mode-set" data-m="x">So lassen</button></div>`;
}

// Einfach/Standard: nach dem zweiten abgeschlossenen Zyklus einmal anbieten, mehr Einstellungen zu zeigen
function modeUpCard() {
  if (!(data.profile || {}).mode) return modeAskCard();
  const m = appMode();
  if (m === 'x' || (data.profile || {}).modeUpSeen === m) return '';
  if (new Set(data.sessions.filter(x => x.cycleStart).map(x => x.cycleStart)).size < 3) return '';
  const next = m === 'e' ? 's' : 'x';
  return `<div class="card hints"><p><b>${APP_MODES[next].icon} Du trainierst jetzt schon eine ganze Weile regelmäßig</b></p>
      <p class="hint">Möchtest du mehr Einstellungen und Erklärungen sehen? Im Modus „${APP_MODES[next].label}“: ${APP_MODES[next].text}
        Deine Daten bleiben, wie sie sind – zurück geht es jederzeit in den Optionen.</p>
      <div class="row"><button class="btn primary" data-action="mode-set" data-m="${next}">Zu „${APP_MODES[next].label}“ wechseln</button>
        <button class="btn" data-action="mode-up-no">Nein, danke</button></div></div>`;
}

// Erinnerung an die Sicherung (alle Modi): ab 4 Trainings, wenn die letzte Sicherung über 30 Tage her ist
// Sicherungs-Erinnerung: ab BACKUP_DAYS Tagen seit der letzten Sicherung (User-Wunsch 2026-11-03, vorher 30 Tage) –
// auf der Startseite (mit „Später“ für BACKUP_SNOOZE Tage) und direkt nach dem Speichern eines Trainings
const BACKUP_DAYS = 7, BACKUP_SNOOZE = 3;
const daysSinceISO = d => d ? Math.round((Date.parse(todayISO() + 'T12:00:00') - Date.parse(d + 'T12:00:00')) / 86400000) : Infinity;
const backupDue = () => daysSinceISO(data.lastExport) >= BACKUP_DAYS;
const backupAgoText = () => data.lastExport ? `Deine letzte Sicherung ist ${daysSinceISO(data.lastExport)} Tage her.` : 'Du hast deine Daten noch nie gesichert.';

function backupCard() {
  if (data.sessions.length < 4 || !backupDue() || daysSinceISO(data.backupSnooze) < BACKUP_SNOOZE) return '';
  return `<div class="card hints"><p><b>💾 Zeit für eine Sicherung</b></p>
      <p class="hint">${backupAgoText()}
        Alles liegt nur auf diesem Handy – geht es verloren oder wird die App gelöscht, sind die Daten weg.</p>
      <div class="row"><button class="btn primary" data-action="export">Jetzt sichern</button>
        <button class="btn" data-action="backup-later">Später</button></div></div>`;
}

// Nach dem Speichern eines Trainings: Sicherung anbieten, wenn sie fällig ist (ab dem 2. Training)
function backupAfterTrainingCard() {
  if (data.sessions.length < 2 || !backupDue()) return '';
  return `<div class="card hints backup-after"><p><b>💾 Gleich mitsichern?</b></p>
      <p class="hint">${backupAgoText()} Ein Tipp genügt – auf dem iPhone dann „In Dateien sichern“ wählen.</p>
      <button class="btn primary" data-action="export">Jetzt sichern</button></div>`;
}

// „⏱ Wenig Zeit?“ (Zeitlimit): data.timeLimit = { min, once } – once = nur fürs nächste Training, sonst bis man es ändert.
// timeEdit = { min (Text), once } solange das Eingabefeld offen ist
let timeEdit = null;
function timeLimitHtml() {
  const tl = data.timeLimit;
  if (timeEdit) {
    const chip = m => `<button class="vchip ${String(timeEdit.min) === String(m) ? 'on' : ''}" data-action="time-chip" data-m="${m}">${m} min</button>`;
    return `<div class="card time-card">
        <p><b>⏱ Wie viel Zeit hast du für das Training?</b></p>
        <div class="variants">${[30, 45, 60, 75].map(chip).join('')}</div>
        <label class="row"><span>Minuten</span><input class="inp kg" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off"
          data-field="time-min" value="${esc(timeEdit.min)}" placeholder="45"></label>
        <div class="seg two"><button class="${timeEdit.once ? 'on' : ''}" data-action="time-once" data-v="1">Nur nächstes Training</button>
          <button class="${timeEdit.once ? '' : 'on'}" data-action="time-once" data-v="0">Bis ich es ändere</button></div>
        <p class="hint">Die App kürzt das Training passend: Jede geplante Muskelgruppe bekommt zuerst 1–2 Sätze – mit einer
          Grundübung, wenn es eine gibt –, dann folgen die übrigen Sätze der Grundübungen, danach normale Übungen und zuletzt
          Isolationsübungen. Gerechnet wird mit 1 Minute pro Satz plus Pause (Grundübung 4, normale Übung 3, Isolation 2 Minuten).</p>
        <div class="row"><button class="btn" data-action="time-cancel">Abbrechen</button>
          <button class="btn primary" data-action="time-save">Übernehmen</button></div>
      </div>`;
  }
  if (tl && tl.min) {
    return `<div class="time-strip"><span>⏱ <b>Zeitlimit ${tl.min} min</b> · ${tl.once ? 'nur nächstes Training' : 'bis du es änderst'}</span>
        <button class="btn small" data-action="time-open">Ändern</button><button class="btn small" data-action="time-off">Aus</button></div>`;
  }
  return `<button class="btn outline time-btn" data-action="time-open">⏱ Wenig Zeit?<small>Training auf deine verfügbare Zeit kürzen</small></button>`;
}

// Tage auslassen (ungeplante Pause): Auswahl der Tage, die in dieser Woche ohne Training als erledigt zählen.
// skipPick = Set der ausgewählten Tage, solange die Auswahl offen ist (null = zu)
let skipPick = null;
function skipHtml(ci) {
  const done = roundSessions(ci.cycleStart, ci.week);
  // Tage, die sich noch auslassen lassen (offen) oder schon ausgelassen sind
  const cands = activeDays().filter(d => done.filter(s => s.dayId === d.id).length < dayTimes(d, ci.week));
  if (!cands.length) return '';
  if (!skipPick) {
    return `<button class="btn outline skip-btn" data-action="skip-open">⏭ Tage auslassen
      <small>Nach einer ungeplanten Pause mit einem anderen Tag weitermachen</small></button>`;
  }
  return `<div class="card skip-panel">
      <p><b>Welche Tage lässt du in dieser Woche aus?</b></p>
      <p class="hint">Die ausgewählten Tage zählen für ${ciLabel(ci)} als erledigt – ohne Training und ohne Werte. Danach geht es
        mit dem nächsten offenen Tag weiter, und sind alle Tage erledigt, mit der nächsten Woche. Du kannst einen ausgelassenen
        Tag trotzdem noch trainieren, dann zählt er ganz normal.</p>
      <div class="group-chips skip-chips">${cands.map(d => `<button class="gchip ${skipPick.has(d.id) ? 'on' : ''}" data-action="skip-pick" data-id="${d.id}">
        ${skipPick.has(d.id) ? '⏭ ' : ''}${esc(d.name)}</button>`).join('')}</div>
      <div class="row"><button class="btn" data-action="skip-cancel">Abbrechen</button>
        <button class="btn primary" data-action="skip-save">Übernehmen</button></div>
    </div>`;
}

function renderStart() {
  let h = greeting() + colorHintCard() + modeUpCard() + backupCard() + (hasActivePlan() ? cycleCard(cycleInfo()) : '') + hintsCard();
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
        <h2>${data.plans.length ? 'Kein Plan aktiv' : 'Noch kein Plan'}</h2>
        <p class="hint">${data.plans.length ? 'Erstelle einen neuen Plan oder aktiviere einen bisherigen im Reiter „Plan“. Deine Trainings und Erfolge bleiben erhalten.'
          : 'Erstelle deinen ersten Trainingsplan – der Assistent führt dich Schritt für Schritt hindurch.'}</p>
        <button class="btn primary" data-action="wiz-start">✨ Neuen Plan erstellen</button>
        ${data.plans.length ? '<button class="btn center" data-action="tab" data-tab="plan">Bisherigen Plan aktivieren</button>' : ''}
      </div>`;
  }
  if (!data.days.length) {
    return h + `<p class="hint">Noch kein Trainingsplan vorhanden. Lege zuerst deine Trainingstage und Übungen an.</p>
      <button class="btn primary" data-action="tab" data-tab="plan">Trainingsplan anlegen</button>`;
  }
  h += nutStartLine();  // Ernährungsphase kurz anzeigen (nutrition.js)
  h += `<h2>Welcher Trainingstag? <small class="hint">· ${esc(activePlan().name)}</small></h2>`;
  if (!draft) h += timeLimitHtml();
  const limit = data.timeLimit && data.timeLimit.min;
  const sessions = sessionsNewestFirst();
  // als Nächstes dran: der nächste noch offene Tag des Durchlaufs, gezählt ab dem zuletzt trainierten Tag
  const ci = cycleInfo();
  const open = new Set(roundOpen(ci.cycleStart, ci.week).map(x => x.day.id));
  const lastOwn = sessions.find(s => findDay(s.dayId));
  const from = lastOwn ? data.days.indexOf(findDay(lastOwn.dayId)) + 1 : 0;
  const order = data.days.map((_, i) => data.days[(from + i) % data.days.length]);
  const nextDay = !draft && lastOwn ? order.find(d => open.has(d.id)) : null;
  const skippedIds = roundSkipped(ci.cycleStart, ci.week);
  data.days.forEach((day, i) => {
    const last = sessions.find(s => s.dayId === day.id);
    const dur = lastDuration(day.id);
    const done = day.exercises.some(e => e.name.trim()) && !open.has(day.id);
    // ausgelassen: ohne Training in dieser Woche, nur übersprungen
    const skipped = done && skippedIds.includes(day.id) && !roundSessions(ci.cycleStart, ci.week).some(s => s.dayId === day.id);
    // geschätzte Dauer dieser Woche (Sätze wie im Training) und zuletzt gemessene Dauer
    const est = estDuration(day, ci.week, activePlan(), ci.deload);
    const estTxt = !est ? '' : limit && est > limit ? `⏱ gekürzt auf ca. ${fmtDur(limit)} (sonst ${estText(est)})` : estText(est);
    const info = `${day.exercises.length} Übung${day.exercises.length === 1 ? '' : 'en'}` + (estTxt ? ` · ${estTxt}` : '') +
      (last ? ` · zuletzt ${fmtDate(last.date)}` : '') + (dur ? ` · ⏱ ${fmtDur(dur)}` : '');
    const next = day === nextDay;
    h += `<button class="btn nav day-btn ${next ? 'next' : ''} ${done ? 'done' : ''} ${skipped ? 'skipped' : ''}" data-action="start-day" data-id="${day.id}">
      <span class="day-no">${skipped ? '⏭' : done ? '✓' : i + 1}</span>
      <span class="day-txt">${esc(day.name)}${next ? '<span class="badge">Als Nächstes</span>' : ''}${skipped ? '<span class="badge skip">diese Woche ausgelassen</span>'
        : done ? '<span class="badge done">diese Woche erledigt</span>' : ''}<small>${info}</small></span></button>`;
  });
  if (!draft) h += skipHtml(ci);
  if (typeof cardioStartHtml === 'function') h += `<h2>Cardio</h2>${cardioStartHtml()}`;
  return h;
}

// Werte früherer Trainings: je Satz eine Zeile; mehrere Spalten nebeneinander (z. B. letzter Zyklus | Vorwoche)
function setRows(cols, head = false) {
  const n = Math.max(...cols.map(c => c.sets.length));
  return `<table class="last-sets${cols.length === 1 ? ' one' : ''}">${head ?`<tr><th></th>${cols.map(c => `<th>${c.label}</th>`).join('')}</tr>` : ''}` +
    Array.from({ length: n }, (_, i) => `<tr><td class="no">${i + 1}</td>${cols.map(c =>
      `<td>${c.sets[i] ? fmtSet(c.sets[i]) : ''}</td>`).join('')}</tr>`).join('') + '</table>';
}

// Im Training: was das Zeitlimit gekürzt hat
function timeCutNote() {
  const c = draft.timeCut;
  if (!draft.timeLimit) return '';
  if (!c) return `<p class="intro-note time-note">⏱ Zeitlimit ${draft.timeLimit} min – das Training passt schon so, nichts gekürzt.</p>`;
  return `<p class="intro-note time-note">⏱ Auf ca. ${fmtDur(c.after)} gekürzt (Zeitlimit ${c.limit} min, sonst ca. ${fmtDur(c.before)}).
    ${c.cut.length ? `<br><small>Weniger Sätze: ${c.cut.map(x => `${esc(x.name)} ${x.from} → ${x.to}`).join(' · ')}</small>` : ''}
    ${c.dropped.length ? `<br><small>Heute ausgelassen: ${c.dropped.map(esc).join(' · ')}</small>` : ''}</p>`;
}

function renderTraining() {
  if (!draft) return '<p class="hint">Kein laufendes Training.</p>';
  let h = draft.own
    ? '<p class="intro-note">Eigener Plan: Vorgeschlagen sind immer deine Werte vom letzten Mal (beim ersten Mal Sätze × Wdh. aus deinem Plan). Die App steigert nichts – Gewicht und Wdh. änderst du selbst.</p>'
    : draft.deload
    ? `<p class="deload-note">Deload-Woche: halbe Sätze, 15 % weniger Gewicht als in der letzten Trainingswoche, nie schwerer als ${DELOAD_RIR} Wdh. im Tank. Keine Steigerung.</p>`
    : draft.intro
      ? `<p class="intro-note">Intro-Woche: Start-Sätze laut Plan. ${shiftText(draft.cycleStart, 1)
        || `Vergleich ist die Intro-Woche des letzten Zyklus, je Satz +1 Wdh. pro ${cmpWeeksPerRep()} Wochen Abstand.`}</p>`
      : '';
  const lastDur = lastDuration(draft.dayId);
  h = `<div class="timer-bar"><span>⏱ <b id="tr-timer">0:00</b></span>
    <span>${lastDur ? `Letztes Mal: ${fmtDur(lastDur)}` : 'Erstes Mal – Zeit wird gemessen'}</span></div>` + timeCutNote() + h;
  h += `<p class="sub">${fmtDate(draft.date, true)}<br>${!feat('tr-rir-input')
    ? 'Trag nach jedem Satz ein, was du geschafft hast, und tippe an, wie er sich angefühlt hat – die App passt die nächsten Sätze daran an.'
    : draft.own
    ? 'Trag nach jedem Satz ein, was du geschafft hast und wie viele Wdh. noch im Tank waren – damit gilt der Satz als erledigt.'
    : 'Trag nach jedem Satz ein, wie viele Wdh. noch im Tank waren – damit gilt der Satz als erledigt und die Wdh. der folgenden Sätze passen sich an.'}</p>`;
  if (feat('tr-prog')) h += progressionCard();

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
    h += `<section class="card ex-card tint-${ei % 4}">
      <div class="ex-head">
        <h2>${libEntry(en.name) ? `<button class="lib-link" data-action="lib-open" data-name="${esc(en.name)}"
          aria-label="Ausführung ansehen">${esc(en.name)} <span class="info-dot">i</span></button>` : esc(en.name)}</h2>
        <div class="ex-tools">
          ${feat('tr-comment') ? `<button class="icon-btn bubble ${(en.comment || '').trim() ? 'has' : ''}" data-action="comment-toggle"
            data-ei="${ei}" aria-label="Kommentar">💬 Kommentar</button>` : ''}
          <button class="icon-btn swap" data-action="rep-open" data-ei="${ei}">⇄ Ersetzen</button>
        </div>
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
    if (stall && feat('stall-hints')) h += `<p class="stall-note">💡 Stillstand: ${stagnationText(stall)}</p>`;
    const body = en.target && en.target.bodyweight;  // Eigengewicht: kein Aufwärmen, kg = Körpergewicht
    if (!body) {
      if (!en.warmupEdited) syncWarmup(en);  // Vorschlag passend zum aktuellen ersten Arbeitssatz
      h += warmupBlock(en, ei);
    }
    const lastComment = feat('tr-comment') && lastCommentFor(en.name);
    if (lastComment) {
      h += `<div class="last-comment"><span>💬 Letztes Mal: „${esc(lastComment.text)}“</span>
        <button class="icon-btn" data-action="comment-dismiss" data-sid="${lastComment.sessionId}"
          data-name="${esc(en.name)}" aria-label="Hinweis ausblenden">✕</button></div>`;
    }
    if (en.replacedFrom) h += `<p class="last">statt ${esc(en.replacedFrom)}</p>`;
    if (en.replacing) h += renderReplace(en, ei);
    const bandEx = body && en.target && en.target.band;
    if (bandEx) h += `<p class="bw-note">🎗️ Bandübung: Steigerung über die Wiederholungen – ab etwa ${BAND_MAX_REPS} Wdh. kommt das nächststärkere Band.</p>` + bandRow(en, ei);
    else if (body) h += '<p class="bw-note">🧍 Eigengewichtsübung: Steigerung über die Wiederholungen.</p>';
    if (body || (en.target && en.target.weights)) { const bh = bwHint(en); h += `<p class="bw-hint" data-bwhint="${ei}"${bh ? '' : ' hidden'}>${bh}</p>`; }
    if (en.target && en.target.own) {
      h += `<p class="target">Plan: ${en.target.sets} × ${en.target.reps} Wdh.</p>`;
    } else if (en.target) {
      const t = en.target;
      h += feat('tr-tank-target')
        ? `<p class="target">Ziel: ${t.sets} × ${t.reps} Wdh. · Ø ${targetRirText(t)} im Tank</p>`
        : `<p class="target">Ziel: ${t.sets} × ${t.reps} Wdh. · ${feelTargetText(t)}</p>`;
    }
    // Max. bei 10 Wdh., Steigerung und Ausführung kompakt nebeneinander; die Auswahl klappt darunter auf
    const t = en.target;
    const withMax = t && !t.own && !body && feat('tr-max');
    const vAll = en.sets.length && en.sets.every(s => variantOf(s) === variantOf(en.sets[0])) ? variantOf(en.sets[0]) : null;
    if (withMax || feat('tr-variants')) h += `<div class="ex-meta ${withMax ? '' : 'wide'}">${withMax ? `<label class="max-mini"><span>Max. kg bei 10 Wdh.</span>
          <input class="inp kg ${t.max10 == null ? 'missing' : ''}" type="text" inputmode="decimal" autocomplete="off"
            data-field="tr-max" data-ei="${ei}" placeholder="kg" value="${t.max10 == null ? '' : fmtNum(t.max10)}"></label>` : ''}
        <div class="ex-chips">${withMax && feat('tr-step') && !t.weights ? stepChip(en, ei) : ''}
          ${feat('tr-variants') ? `<button class="step-chip" data-action="ex-variant-open" data-ei="${ei}" aria-expanded="${!!en.variantOpen}">Ausführung:
            <b>${vAll != null ? VARIANTS[vAll] : 'gemischt'}</b> <span aria-hidden="true">✎</span></button>` : ''}</div>
      </div>`;
    if (withMax && t.max10 == null) h += `<p class="first-max-hint">${last ? '' : '🆕 Erstes Mal: '}${MAX_UNKNOWN_HINT}</p>`;
    // Einfach-Modus: „Kennenlern-Woche“ statt Max.-Abfrage – die App errechnet das Max. aus dem Geschafften
    if (!feat('tr-max') && t && !t.own && !body && t.max10 == null) {
      h += `<p class="first-max-hint">🆕 Kennenlernen: Nimm ein Gewicht, mit dem du die Wiederholungen sicher schaffst, und sag nach jedem
        Satz, wie er sich angefühlt hat – die App passt das Gewicht danach an.</p>`;
    }
    if (withMax && en.stepOpen) h += stepPick(en, ei);
    if (en.variantOpen) {
      h += `<div class="variants ex-var-pick">${Object.entries(VARIANTS).map(([v, label]) =>
        `<button class="vchip ${vAll === v ? 'on' : ''}" data-action="ex-variant" data-ei="${ei}" data-v="${v}">${label}</button>`).join('')}
        <p class="hint">Gilt für alle noch offenen Sätze. Einzelne Sätze: Satznummer antippen.</p></div>`;
    }
    if (en.weekFirst && feat('tr-compare')) {
      h += `<div class="compare">Plan des 1. Trainings dieser Woche (${fmtDate(en.weekFirst.date)}):
        ${setRows([{ sets: en.weekFirst.sets }])}<b>2. Training der Woche: höchstens dieser Plan – keine Steigerung dagegen</b></div>`;
    }
    if (!feat('tr-compare')) {
      // Einfach: eine Zeile mit den Werten vom letzten Mal
      h += last ? `<p class="last">Letztes Mal: ${last.sets.map(x => x.weight != null ? `${fmtNum(x.weight)} kg × ${x.reps}` : `${x.reps} Wdh.`).join(' · ')}</p>`
        : '<p class="last">Erstes Mal – noch keine Werte.</p>';
    } else if (en.compare) {
      const rule = en.compare.shifted && !en.rule
        ? 'Verlängerung berücksichtigt: Gewicht aus dieser Woche, Wdh. und Tank wie in der aktuellen Woche'
        : en.rule === 'brake'
        ? `Vorwoche deutlich verfehlt (mind. ${MISS_REPS} Wdh. unter Plan) → weniger Gewicht, Wdh. wie geplant`
        : en.rule === 'lower'
          ? 'Heute: pro Satz der niedrigere Vorschlag aus beiden – Ziel: Satz 1 eine Wdh. mehr als in der Vorwoche, die übrigen Sätze bestätigen'
          : en.rule === 'week'
            ? 'Heute: begrenzt durch das 1. Training dieser Woche'
          : en.rule === 'diet'
            ? 'Diät: Gewicht wie zuletzt – höchstens 1 Wdh. mehr, dafür näher am Muskelversagen'
            : `Heute: je Satz +${en.compare.plus || 1} Wdh. – oder mehr Gewicht, wenn es die Leistung hergibt`;
      const occ = draft.occurrence > 1 || en.compare.occ > 1 ? `, ${en.compare.occ || 1}. Training` : '';
      const cols = [{ label: `Letzter Zyklus<small>${weekLabel(en.compare.week)}${occ} · ${fmtDate(en.compare.date)}</small>`, sets: en.compare.sets }];
      if (en.prevWeek) cols.push({ label: `Vorwoche<small>${weekLabel(en.prevWeek.week)} · ${fmtDate(en.prevWeek.date)}</small>`, sets: en.prevWeek.sets });
      h += `<div class="compare">${setRows(cols, true)}<b>${rule}</b></div>`;
    } else {
      h += last
        ? `<div class="last">Letztes Mal (${fmtDate(last.date)}):${setRows([{ sets: last.sets }])}</div>`
        : en.target && en.target.own ? '<p class="last">Erstes Mal – Werte aus deinem Plan.</p>'
        : en.target && en.target.max10 == null && !body ? ''  // dann steht oben schon der Hinweis „Erstes Mal“
          : '<p class="last">Erstes Mal – noch keine Werte.</p>';
    }
    // Einfach: kein Erklärtext zur Anpassung (Fachbegriffe) – die angepassten Werte stehen direkt in den Feldern
    h += `<p class="adjust ${feat('tr-rir-input') ? '' : 'simple-off'}" data-note="${ei}" ${en.note ? '' : 'hidden'}>${esc(en.note)}</p>`;
    const rirInput = feat('tr-rir-input');
    h += `<div class="setgrid"><span class="head">Satz</span><span class="head">kg</span><span class="head">Wdh.</span><span class="head">${rirInput ? 'Tank' : 'Gefühl'}</span>`;
    const tankHint = en.target && !en.target.own ? targetRirText(en.target).replace('mind. ', '≥') : '–';
    const next = feat('tr-next') ? nextPreview(en) : [];
    const bodyKg = body ? currentBodyweight() : null;
    en.sets.forEach((s, si) => {
      const v = variantOf(s);
      h += (feat('tr-variants') ? `<button class="setno ${v ? 'has-v' : ''}" data-action="set-variant" data-ei="${ei}" data-si="${si}"
          aria-label="Satz ${si + 1}: ${VARIANTS[v]} – antippen zum Wechseln">${si + 1}${v ? `<small>${VARIANTS[v]}</small>` : ''}</button>`
          : `<span class="setno">${si + 1}${v ? `<small>${VARIANTS[v]}</small>` : ''}</span>`) + `
        ${body ? (en.target && en.target.band ? `<span class="bw-cell">Band<small>${BAND_LEVELS[en.target.band]}</small></span>`
          : `<span class="bw-cell">Körper${bodyKg != null ? `<small>${fmtNum(bodyKg)} kg</small>` : ''}</span>`)
        : `<input type="text" inputmode="decimal" autocomplete="off" placeholder="–"
          data-field="tr-weight" data-ei="${ei}" data-si="${si}" value="${esc(s.weight)}">`}
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="–"
          data-field="tr-reps" data-ei="${ei}" data-si="${si}" value="${esc(s.reps)}">
        ${rirInput ? `<input type="text" inputmode="decimal" autocomplete="off" placeholder="${tankHint}"
          class="tank" data-field="tr-rir" data-ei="${ei}" data-si="${si}" value="${esc(s.rir)}">`
          : `<button class="feel-btn ${s.rir !== '' && s.rir != null ? 'set' : ''}" data-action="tr-feel-open" data-ei="${ei}" data-si="${si}"
            aria-label="Wie hat sich Satz ${si + 1} angefühlt?">${feelIcon(en, s)}</button>`}
        <div class="next-hint" data-next="${ei}-${si}">${next[si] || ''}</div>
        ${!rirInput && en.feelOpen === si ? `<div class="feel-pick">${FEELS.map(f =>
          `<button class="vchip" data-action="tr-feel" data-ei="${ei}" data-si="${si}" data-f="${f.k}">${f.icon}<small>${f.label}</small></button>`).join('')}</div>` : ''}`;
    });
    h += `</div>${rirInput ? `<p class="avg" data-avg="${ei}">${avgTankText(en)}</p>` : ''}
      ${feat('tr-sets') ? `<div class="row set-btns">
        <button class="btn" data-action="tr-del-set" data-ei="${ei}">− Satz</button>
        <button class="btn" data-action="tr-add-set" data-ei="${ei}">+ Satz</button>
      </div>` : ''}</section>`;
  });
  if (feat('tr-add')) h += draft.adding ? renderAddExercise()
    : '<button class="btn center" data-action="add-open">+ Übung hinzufügen</button>';
  h += `${feat('tr-variants') ? '<p class="hint">Satznummer antippen: Ausführung wechseln (normal → mit Pause → langsam). Sätze mit Pause oder langsam werden nur mit gleich ausgeführten Sätzen verglichen.</p>' : ''}
    <button class="btn primary" data-action="tr-save">Training speichern</button>
    <div class="spacer"></div>
    <button class="btn danger" data-action="tr-cancel">Training verwerfen</button>`;
  return h;
}

// Einfach-Modus: Gefühl statt Tank-Zahl. Intern wird daraus „Wdh. im Tank“ relativ zum Ziel der Übung.
const FEELS = [
  { k: 'easy', icon: '😊', label: 'locker' },
  { k: 'good', icon: '💪', label: 'gut' },
  { k: 'hard', icon: '😤', label: 'hart' },
  { k: 'max', icon: '🔥', label: 'ging nichts mehr' },
];
function feelRir(t, k) {
  const r = Math.round((t && t.rir != null ? t.rir : 2));
  // locker = noch mind. 4 · gut = genau das Ziel · hart = noch 1 · ging nichts mehr = 0
  return { easy: Math.max(4, r + 2), good: r, hard: Math.max(0, Math.min(1, r - 1)), max: 0 }[k];
}
function feelIcon(en, s) {
  if (s.rir === '' || s.rir == null) return '<span class="feel-q">Wie?</span>';
  const v = parseNum(s.rir), r = Math.round(en.target && en.target.rir != null ? en.target.rir : 2);
  return v <= 0 ? '🔥' : v < r ? '😤' : v > r + 1 ? '😊' : '💪';
}
const feelTargetText = t => {
  const r = Math.round(t.rir != null ? t.rir : 2);
  return r <= 0 ? 'jeder Satz bis „ging nichts mehr“ 🔥'
    : `hör auf, wenn noch etwa ${r} Wdh. gegangen wären (= 💪 gut)`;
};

// Progression nur für dieses Training ein-/ausschalten (nicht im Deload; Volumen erst ab Woche 2)
function progressionCard() {
  if (draft.deload || draft.own || !draft.progression) return '';
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

// Schnellauswahl beim Ersetzen: verwandte Übungen derselben Muskelgruppe – zuerst gleiche Bewegung (Figur in der
// Bibliothek) und gleiche Übungsfamilie (erstes Wort, z. B. „Rudern“), dann gleiche Übungsart, schon trainierte vorn
// skip: Übungen, die nicht vorgeschlagen werden (Standard: die des laufenden Trainings)
function relatedExercises(name, n = 6, skip = draft ? draft.entries.map(e => e.name) : []) {
  const g = groupOf({ name }), kind = kindOf({ name });
  const lib = libEntry(name), word = n2 => norm(n2).split(/[\s(]/)[0];
  const taken = new Set([nameKey(name), ...skip.map(nameKey)]);
  const trained = new Set(data.sessions.flatMap(s => s.entries.map(e => nameKey(e.name))));
  const pool = [...new Map([...EXERCISE_LIST.map(([x]) => x), ...ownExerciseNames()].map(x => [nameKey(x), x])).values()];
  // Plan „Nur Maschinentraining“ (auch gerade im Assistenten): Maschinen zuerst
  const inWiz = current.view === 'wizard' && typeof wiz !== 'undefined' && wiz;
  const machines = inWiz ? wizMachines() : (activePlan() || {}).equip === 'machine';
  // Plan „Zu Hause“: zuerst Übungen, die mit der eingetragenen Ausrüstung gehen
  const home = inWiz ? wiz.equip === 'home' : homePlan();
  const score = c => (lib && libEntry(c) && libEntry(c).pattern === lib.pattern ? 4 : 0) + (word(c) === word(name) ? 3 : 0)
    + (kindOf({ name: c }) === kind ? 2 : 0) + (trained.has(nameKey(c)) ? 1 : 0) + (machines && isMachine(c) ? 20 : 0)
    + (home && homeOk(c, data.home) ? 20 : 0);
  return pool.filter(c => !taken.has(nameKey(c)) && groupOf({ name: c }) === g)
    .map(c => [c, score(c)]).sort((a, b) => b[1] - a[1]).slice(0, n).map(([c]) => c);
}

function renderReplace(en, ei) {
  const t = en.target;
  const quick = relatedExercises(en.replacedFrom || en.name);
  return `<div class="replace">
    <p class="lbl">Ersatzübung</p>
    ${quick.length ? `<p class="hint quick-title">Schnellauswahl – ähnliche Übungen:</p>
      <div class="quick-picks">${quick.map(q => `<button class="vchip" data-action="rep-quick" data-ei="${ei}" data-name="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <p class="hint quick-title">… oder selbst suchen:</p>` : ''}
    <input class="inp" type="text" data-field="rep-name" data-ei="${ei}"
      autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Übung eintippen …">
    <div class="suggest" hidden></div>
    <label class="row">
      <span>Max. kg bei 10 Wdh.</span>
      <input class="inp kg" type="text" inputmode="decimal" autocomplete="off"
        data-field="rep-max" data-ei="${ei}" placeholder="kg">
    </label>
    <p class="hint rep-max-hint" hidden>Für diese Übung ist noch kein Max. bei 10 Wdh. bekannt – trag es ein, wenn du es weißt. ${MAX_UNKNOWN_HINT}</p>
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
    <p class="hint rep-max-hint" hidden>Für diese Übung ist noch kein Max. bei 10 Wdh. bekannt – trag es ein, wenn du es weißt. ${MAX_UNKNOWN_HINT}</p>
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
  let h = feat('plans-multi') ? '<h2>Meine Pläne</h2>' : '<h2>Mein Plan</h2>';
  // Einfach: nur der aktive Plan („Neuen Plan erstellen“ ersetzt ihn)
  for (const p of data.plans.filter(x => feat('plans-multi') || x.id === active.id)) {
    const isActive = p.id === active.id;
    const state = isActive ? ' · aktiv'
      : (p.endedAt ? ` · beendet am ${fmtDate(p.endedAt + 'T12:00:00')}` : '') + ' · antippen zum Aktivieren';
    // geschätzte Dauer pro Training: kürzester Tag in der Intro-Woche bis längster am Höhepunkt
    const est = p.days.map(d => estRange(d, p)).filter(([, hi]) => hi);
    const estTxt = est.length ? ` · ${estText(Math.min(...est.map(x => x[0])), Math.max(...est.map(x => x[1])))} pro Training` : '';
    h += `<div class="plan-row ${isActive ? 'active' : ''} ${p.endedAt && !isActive ? 'ended' : ''}">
      <button class="plan-pick" data-action="plan-activate" data-id="${p.id}">
        <b>${esc(p.name)}</b><small>${p.days.length} Trainingstag${p.days.length === 1 ? '' : 'e'}${estTxt}${state}</small>
      </button>
      <button class="icon-btn" data-action="plan-rename" data-id="${p.id}" aria-label="Umbenennen">✎</button>
      ${feat('plans-multi') ? `<button class="icon-btn danger" data-action="plan-delete" data-id="${p.id}" aria-label="Plan löschen">🗑</button>` : ''}
    </div>`;
  }
  const libBtn = `<button class="btn nav lib-open-btn" data-action="lib">📖 Übungsbibliothek
    <small>Alle Übungen mit Animation, Ausführung und Tipps</small></button>`;
  if (!hasActivePlan()) {
    return h + `<p class="hint">${data.plans.length ? 'Kein Plan aktiv. Tippe einen Plan an, um ihn wieder zu aktivieren, oder erstelle einen neuen.'
      : 'Noch kein Plan vorhanden. Erstelle deinen ersten Plan.'}</p>
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
    const [lo, hi] = estRange(day, active);
    h += `<button class="btn nav day-btn" data-action="open-day" data-id="${day.id}">
      <span class="day-no">${i + 1}</span><span class="day-txt">${esc(day.name)}${hi ? `<small>${estText(lo, hi)}${lo !== hi ? ' (Intro bis Höhepunkt)' : ''}</small>` : ''}</span></button>`;
  });
  if (active.equip === 'home') h += homeEqCard();
  if (data.days.some(d => estDuration(d, 1, active))) {
    h += `<p class="hint">Geschätzte Trainingsdauer: je Satz 1 Minute, dazu Pause nach jedem Satz – Grundübungen 4, normale Übungen 3,
      Isolationsübungen 2 Minuten (ohne Aufwärmen).</p>`;
  }
  if (active.own) {
    return h + `<button class="btn center" data-action="add-day">+ Trainingstag hinzufügen</button>
      <h2>Steigerung</h2>
      <div class="card">
        <p class="per-week-title">✋ Eigener Plan – ohne Steigerung durch die App</p>
        <p class="hint">Keine Zyklen, keine Deload-Woche, keine Vorschläge für mehr Gewicht, Wiederholungen oder Sätze. Im Training stehen immer deine Werte vom letzten Mal – beim ersten Mal Sätze × Wdh. und Startgewicht aus deinem Plan.</p>
        <button class="btn outline" data-action="plan-own-off">📈 Doch die Steigerung der App nutzen</button>
      </div>`;
  }
  const perWeek = active.perWeek || 1;
  // Nur bei Plänen, deren Tage 2× pro Woche laufen: kurzer Hinweis (festgelegt beim Erstellen des Plans)
  h += `<button class="btn center" data-action="add-day">+ Trainingstag hinzufügen</button>
    ${perWeek > 1 ? `<div class="card per-week">
      <p class="per-week-title">🔁 Jeder Trainingstag 2× pro Woche · ${data.days.length * perWeek} Trainings</p>
      <p class="hint">Die Tage wiederholen sich der Reihe nach. Das 2. Training eines Tages in der Woche richtet sich nach dem 2. Training derselben Woche im letzten Zyklus und liegt nie über dem Plan des 1. Trainings dieser Woche.</p>
    </div>` : ''}
    ${active.rotate ? `<div class="card per-week">
      <p class="per-week-title">🔁 Im Wechsel · ${active.rotate} Trainings pro Woche · Ø ${fmtNum(round1(perWeekAvg(active)))}× je Tag</p>
      <p class="hint">Die Tage laufen über die Wochen der Reihe nach weiter: ${(() => {
        const list = activeDays(active);
        const wk = w => Array.from({ length: active.rotate }, (_, i) => list[((w - 1) * active.rotate + i) % list.length].name).join(' · ');
        return list.length ? `Woche 1: ${esc(wk(1))} – Woche 2: ${esc(wk(2))} …` : '';
      })()} Kommt ein Tag 2× in einer Woche dran, liegt das 2. Training nie über dem Plan des 1.</p>
    </div>` : ''}
    ${periodCard(c, active)}`;
  return h;
}

// Standard-Zykluslänge ändern (Regler): gilt ab sofort, auch für den laufenden Zyklus (seine Anpassung bleibt)
function applyCycleLen(v) {
  data.cycle.defWeeks = Math.min(10, Math.max(4, v));
  setCycleAdj(data.cycle.adj);
  saveData(); render();
}

let cycAdjustOpen = false;  // „Zyklus anpassen“ aufgeklappt
let cycEndAsk = false;      // Rückfrage „Zyklus beenden?“

// Zykluslänge im Panel „Zyklus anpassen“: ein − / + mit Auswahl „Gilt für“ – alle Zyklen (Standard, 4–10 Wochen, Anstieg
// wird neu verteilt) oder nur diesen Zyklus (verlängern/verkürzen, z. B. wegen Urlaub). Früher zwei Regler (Schieber +
// −/+), User-Wunsch 2026-11-03. null: Auswahl aus dem Stand ableiten (Zyklus verlängert/verkürzt -> „nur dieser“).
let cycLenScope = null;

function cycleLenHtml(ci) {
  const len = data.cycle.buildWeeks, def = data.cycle.defWeeks, adj = data.cycle.adj;
  const min = ci.deload ? len : Math.max(1, ci.week);
  const lenOn = feat('cycle-len');
  const scope = !lenOn ? 'this' : cycLenScope || (adj ? 'this' : 'all');
  // „Alle Zyklen“: Zahl = Standardlänge (4–10); „Nur diesen Zyklus“: Zahl = Länge des laufenden Zyklus (ab laufender Woche, bis 12)
  const val = scope === 'all' ? def : len;
  const lo = scope === 'all' ? 4 : min, hi = scope === 'all' ? 10 : 12;
  const wk = n => `${n} Woche${n === 1 ? '' : 'n'}`;
  const changed = adj ? `${wk(Math.abs(adj))} ${adj > 0 ? 'verlängert' : 'verkürzt'}` : '';
  const state = scope === 'all'
    ? `Standard für alle Zyklen${adj ? ` · dieser Zyklus: ${wk(len)} (${changed})` : ''}`
    : adj ? `nur dieser Zyklus, ${changed} · Standard ${def}` : `nur dieser Zyklus · wie Standard`;
  const chip = (k, l) => `<button class="vchip ${scope === k ? 'on' : ''}" data-action="cyc-scope" data-s="${k}">${l}</button>`;
  return `<p><b>Zykluslänge</b></p>
      <div class="row cyc-adj-row">
        <button class="icon-btn" data-action="cyc-adj" data-scope="${scope}" data-d="-1" ${val <= lo ? 'disabled' : ''} aria-label="Eine Woche kürzer">−</button>
        <span><b>${wk(val)}</b> + Deload<small>${state}</small></span>
        <button class="icon-btn" data-action="cyc-adj" data-scope="${scope}" data-d="1" ${val >= hi ? 'disabled' : ''} aria-label="Eine Woche länger">+</button>
      </div>
      ${lenOn ? `<p class="lbl chips-title">Gilt für</p><div class="variants cyc-scope">${chip('all', 'Alle Zyklen')}${chip('this', 'Nur diesen Zyklus')}</div>` : ''}
      <p class="hint">${scope === 'all'
        ? `Aufbauwochen inklusive Intro-Woche (4–10), danach 1 Deload-Woche. Start und Höhepunkt (Sätze und Wdh. im Tank) bleiben
          gleich – die App verteilt den Anstieg auf die Wochen: lang = langsamer und gleichmäßiger, kurz = schneller. Gilt ab
          sofort, auch für den laufenden Zyklus.`
        : `<b>Kürzer:</b> Der Deload kommt früher – praktisch, wenn er genau in den Urlaub fallen soll. <b>Länger:</b> Zusätzliche
          Wochen auf dem Höchststand (gleiche Sätze, Gewicht und Wdh. steigen weiter) – z. B. wenn du wegen des Urlaubs Trainings
          verpasst hast. Gilt nur für diesen Zyklus; der nächste hat wieder ${wk(def)}.`}</p>`;
}

// Zyklus anpassen an der Zykluskarte (Trainings-Reiter): Woche wechseln, Zykluslänge, beenden
function cycleAdjustHtml(ci) {
  if (!feat('cycle-adjust') || ownPlan()) return '';
  if (!cycAdjustOpen) {
    return `<button class="btn cyc-adjust-btn" data-action="cyc-adjust-open"><span>⚙️ Zyklus anpassen</span>
      <small>${feat('plan-week-jump') ? 'Woche wechseln · ' : ''}Länge · Beenden</small></button>`;
  }
  if (cycEndAsk) {
    const trained = roundSessions(ci.cycleStart, ci.week).length > 0;
    return `<div class="cyc-adjust">
        <p><b>Zyklus jetzt beenden?</b></p>
        <p class="hint">Alle eingetragenen Trainings bleiben gespeichert. Wie soll es weitergehen?</p>
        ${ci.deload ? '' : `<button class="btn primary" data-action="cyc-end" data-m="deload">😮‍💨 Mit Deload-Woche abschließen</button>
        <p class="hint">Empfohlen: ${trained ? 'Nach dieser Woche' : 'Ab jetzt'} kommt die leichte Deload-Woche zum Erholen, danach beginnt der nächste Zyklus.</p>`}
        <button class="btn" data-action="cyc-end" data-m="new">⏭ Neuer Zyklus – mit der Intro-Woche</button>
        <p class="hint">Der nächste Zyklus beginnt sofort mit der Intro-Woche – z. B. nach einem Urlaub, in dem du dich schon erholt hast.</p>
        ${ci.deload ? '' : `<button class="btn" data-action="cyc-end" data-m="newdl">🩹 Neuer Zyklus – mit der Deload-Woche starten</button>
        <p class="hint">Nach Krankheit oder längerer Pause: Du steigst ab sofort mit der leichten Deload-Woche wieder ein (halbe Sätze,
          15 % weniger Gewicht), danach geht es mit der Intro-Woche weiter.</p>`}
        <button class="btn center" data-action="cyc-end-cancel">Abbrechen</button>
      </div>`;
  }
  // Woche wechseln und Zykluslänge (Standard für alle Zyklen) stehen mit im Panel – früher im Plan-Reiter
  // unter Periodisierung (User-Wunsch 2026-11-03)
  const jump = !feat('plan-week-jump') ? '' : `<p><b>Mit welcher Woche weitermachen?</b></p>
      ${cyclePills(ci, 'cycle-jump')}
      <p class="hint">Antippen, um ab jetzt mit einer anderen Woche weiterzumachen – z. B. nach Krankheit oder längerer Pause
        direkt mit der Deload-Woche oder wieder mit der Intro-Woche. Bisherige Trainings bleiben gespeichert.</p>
      <hr class="cyc-sep">`;
  return `<div class="cyc-adjust">
      ${jump}
      ${cycleLenHtml(ci)}
      <hr class="cyc-sep">
      <button class="btn danger" data-action="cyc-end-ask">⏹ Zyklus beenden</button>
      <button class="btn center" data-action="cyc-adjust-open">Fertig</button>
    </div>`;
}

// Periodisierung im Plan-Reiter – Teile je nach Modus (Wochen/Deload, Woche wechseln, Progression, RIR, Volumen)
function periodCard(c, active) {
  // Woche wechseln, Zykluslänge und „Zyklus anpassen“ stehen im Trainings-Reiter an der Zykluskarte (cycleAdjustHtml)
  const cfg = feat('plan-cycle-settings');
  if (!cfg && !feat('cycle-adjust') && !feat('plan-volume')) return '';
  let h = '<h2>Periodisierung</h2><div class="card">';
  if (feat('cycle-adjust')) h += '<p class="hint">Woche wechseln, Zykluslänge, Verlängern/Verkürzen und „Zyklus beenden“ findest du im Reiter Training an der Zykluskarte unter „⚙️ Zyklus anpassen“.</p>';
  if (cfg) {
    h += `<p class="hint">Eine Woche ist ein Durchlauf: geschafft, sobald ${roundDoneText(active)} – egal, ob du dafür 6, 7 oder 9 Tage brauchst.</p>
      <p class="lbl chips-title">Deload</p>
      <div class="variants">${[['auto', 'Automatisch'], ['self', 'Selbst bestimmen']].map(([m, l]) =>
        `<button class="vchip ${(active.deload || 'auto') === m ? 'on' : ''}" data-action="plan-deload" data-m="${m}">${l}</button>`).join('')}</div>
      <p class="hint">${selfDeload()
        ? 'Kein automatischer Deload: Nach den Trainingswochen geht es Woche für Woche weiter (Sätze und Tank wie in der letzten Aufbauwoche, Gewicht und Wdh. steigen weiter). Den Deload legst du selbst ein – auf dem Startbildschirm, z. B. unter „⚙️ Zyklus anpassen“ über „Deload“.'
        : 'Nach den Trainingswochen folgt automatisch 1 Deload-Woche.'}
        Deload: halbe Sätze, 15 % weniger Gewicht als in der letzten Trainingswoche, nie schwerer als ${DELOAD_RIR} Wdh. im Tank, keine Steigerung. Anschließend beginnt der nächste Zyklus.</p>`;
  }
  if (feat('plan-week-prog')) h += progressionTable();
  if (feat('plan-rir')) h += rirTable(c.buildWeeks);
  h += '</div>';
  if (feat('plan-volume')) h += volumeEditor();
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
    const round = roundKey(ci.cycleStart, w);
    const p = weekProgression(round);
    const cell = k => {
      if (k === 'volume' && w === 1) return '<td class="hint">–</td>';  // Intro: Start-Sätze, keine Steigerung
      const differs = own[round] && own[round][k] !== undefined;
      return `<td><button class="prog-cell ${p[k] ? 'on' : 'off'} ${differs ? 'own' : ''}" data-action="prog-week"
        data-key="${k}" data-round="${esc(round)}" aria-label="${PROG_KEYS[k]} ${w === 1 ? 'Intro' : 'Woche ' + w}">${p[k] ? '✓' : '✕'}</button></td>`;
    };
    h += `<tr class="${!ci.deload && ci.week === w ? 'cur' : ''}"><td>${w === 1 ? 'Intro' : 'W' + w}
      ${ci.week === w ? '<small class="hint">jetzt</small>' : ''}</td>${cell('volume')}${cell('load')}</tr>`;
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
  if (!ex.name.trim() || ci.deload) return '';
  const cmp = comparisonEntry(ex.name, day.id, ci);
  if (!cmp) return '';
  return `<p class="compare">Diese Woche (${weekLabel(ci.week)}) – Vergleich letzter Zyklus:<br>
    ${cmp.sets.map(fmtSet).join(' · ')}<br><b>Ziel: je Satz +${cmp.plus || 1} Wdh. bzw. nächste Gewichtsstufe – ab Woche 2 höchstens Vorwoche mit Satz 1 +1 Wdh.</b></p>`;
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

// Nur bei Eigengewichtsübungen: nur Körpergewicht (Steigerung über die Wdh.) oder mit Zusatzgewicht (Gewichtsprogression)
function bodyweightRow(ex, i) {
  if (!isBodyweightName(ex.name)) return '';
  return `<div class="variants plan"><span>Gewicht</span>${[[0, 'Nur Körpergewicht'], [1, 'Mit Zusatzgewicht']].map(([v, l]) =>
      `<button class="vchip ${!!ex.bwLoad === !!v ? 'on' : ''}" data-action="ex-bwload" data-i="${i}" data-v="${v}">${l}</button>`).join('')}</div>
    <p class="hint kind-hint">${ex.bwLoad
      ? 'Gewichtsprogression an: Trag im Training dein Zusatzgewicht ein – es wird wie bei anderen Übungen gesteigert.'
      : 'Eigengewichtsübung: kein Gewicht, Steigerung nur über die Wiederholungen, kein Aufwärmsatz.'}</p>`;
}

// Übung im Plan ersetzen: Schnellauswahl ähnlicher Übungen oder Suche (alle Modi)
let planSwap = null;  // { day, i } – geöffnetes „Ersetzen“ im Trainingstag

function planSwapHtml(day, ex, i) {
  if (!planSwap || planSwap.day !== day.id || planSwap.i !== i) {
    return `<button class="btn outline plan-swap-btn" data-action="plan-swap-open" data-i="${i}">⇄ Übung ersetzen</button>`;
  }
  // die zuletzt ersetzte Übung immer als Erstes (zum schnellen Zurücktauschen)
  const prev = ex.replacedFrom && nameKey(ex.replacedFrom) !== nameKey(ex.name)
    && !day.exercises.some(e => nameKey(e.name) === nameKey(ex.replacedFrom)) ? ex.replacedFrom : null;
  const related = ex.name.trim() ? relatedExercises(ex.name, 6, day.exercises.map(e => e.name)) : [];
  const quick = [...(prev ? [prev] : []), ...related.filter(q => !prev || nameKey(q) !== nameKey(prev))].slice(0, 6);
  return `<div class="replace">
      <p class="lbl">${ex.name.trim() ? `„${esc(ex.name)}“ ersetzen` : 'Übung wählen'}</p>
      ${quick.length ? `<p class="hint quick-title">Schnellauswahl – ähnliche Übungen (antippen tauscht sofort):</p>
        <div class="quick-picks">${quick.map(q => `<button class="vchip ${q === prev ? 'swap-prev' : ''}" data-action="plan-swap-pick" data-i="${i}" data-name="${esc(q)}">${q === prev ? '↩ ' : ''}${esc(q)}${q === prev ? '<small>vorher im Plan</small>' : ''}</button>`).join('')}</div>
        <p class="hint quick-title">… oder selbst suchen:</p>` : ''}
      <input class="inp" type="text" data-field="plan-swap-name" data-i="${i}" autocomplete="off" autocorrect="off" spellcheck="false"
        placeholder="Übung eintippen, z. B. Rudern …">
      <div class="suggest" hidden></div>
      <div class="row"><button class="btn" data-action="plan-swap-cancel">Abbrechen</button>
        <button class="btn primary" data-action="plan-swap-ok" data-i="${i}">⇄ Ersetzen</button></div>
      <p class="hint">Die neue Übung übernimmt den Platz im Plan mit denselben Sätzen. Gespeicherte Trainings bleiben, wie sie sind;
        das Startgewicht kommt aus früheren Trainings mit dieser Übung oder wird beim ersten Mal ermittelt.</p>
    </div>`;
}

// Übung tauschen: Name, Art und Muskelgruppe neu (automatisch), Max. aus früheren Trainings; Platz und Sätze bleiben
function planReplaceExercise(day, i, name) {
  const ex = day.exercises[i];
  name = String(name || '').trim();
  if (!name) { alert('Bitte eine Übung wählen oder eintippen.'); return false; }
  if (nameKey(name) === nameKey(ex.name)) { planSwap = null; return true; }
  const oldGroup = groupOf(ex);
  if (ex.name.trim()) ex.replacedFrom = ex.name.trim();  // für die Schnellauswahl (zurücktauschen)
  Object.assign(ex, { name, kind: null, variant: '', step: null, max10: knownMax10(name) });
  // unbekannte Übung: Muskelgruppe der alten behalten, damit das Wochenvolumen stimmt
  ex.group = EXERCISE_GROUPS.has(nameKey(name)) ? null : oldGroup;
  planSwap = null;
  saveData();
  toast(`Ersetzt durch „${name}“ ✔`);
  return true;
}

// Übung im Trainingstag eines eigenen Plans: nur Sätze × Wdh., Startgewicht und Ausführung
function ownExerciseCard(ex, i) {
  return `<div class="card">
    <div class="ex-name-row">
      <input class="inp" type="text" data-field="ex-name" data-i="${i}"
        autocomplete="off" autocorrect="off" spellcheck="false"
        value="${esc(ex.name)}" placeholder="Übung eintippen, z. B. Bank…">
      <button class="info-btn" data-action="lib-open" data-i="${i}" aria-label="Ausführung ansehen"
        ${libEntry(ex.name) ? '' : 'hidden'}>i</button>
    </div>
    <div class="suggest" hidden></div>
    ${planSwapHtml(findDay(current.params.id), ex, i)}
    ${stepperRow('Sätze', 'sets', i, ex.sets)}
    ${stepperRow('Wdh. pro Satz', 'reps', i, ex.reps)}
    ${bodyweightRow(ex, i)}
    ${isBodyweight(ex) ? '' : `<label class="row"><span>Startgewicht<br><small class="hint">nur fürs erste Training</small></span>
      <input class="inp kg" type="text" inputmode="decimal" autocomplete="off" data-field="ex-start" data-i="${i}"
        placeholder="kg" value="${ex.startWeight == null ? '' : fmtNum(ex.startWeight)}"></label>`}
    <div class="variants plan"><span>Ausführung</span>${Object.entries(VARIANTS).map(([v, label]) =>
      `<button class="vchip ${(ex.variant || '') === v ? 'on' : ''}" data-action="plan-variant" data-i="${i}" data-v="${v}">${label}</button>`).join('')}
    </div>
    <div class="row">
      <button class="icon-btn" data-action="ex-up" data-i="${i}" aria-label="Nach oben">↑</button>
      <button class="icon-btn" data-action="ex-down" data-i="${i}" aria-label="Nach unten">↓</button>
      <button class="icon-btn danger" data-action="ex-del" data-i="${i}">Entfernen</button>
    </div>
  </div>`;
}

function renderDay({ id }) {
  const day = findDay(id);
  if (!day) return '<p class="hint">Trainingstag nicht gefunden.</p>';
  if (ownPlan()) {
    return `<label class="lbl">Name des Trainingstags
        <input class="inp" type="text" data-field="day-name" value="${esc(day.name)}"></label>
      <p class="hint">Eigener Plan: Sätze und Wiederholungen legst du pro Übung selbst fest – die App steigert nichts.</p>
      <h2>Übungen</h2>${day.exercises.map(ownExerciseCard).join('')}
      <button class="btn center" data-action="add-ex">+ Übung hinzufügen</button>
      <button class="btn primary" data-action="day-done">✔ Fertig</button>
      <p class="hint">Änderungen werden automatisch gespeichert.</p>
      <div class="spacer"></div>
      <button class="btn danger" data-action="del-day">Trainingstag löschen</button>`;
  }
  let h = `<label class="lbl">Name des Trainingstags
      <input class="inp" type="text" data-field="day-name" value="${esc(day.name)}">
    </label>
    ${feat('day-reprange') ? `<div class="variants plan daytype"><span>Wiederholungsbereich</span>${Object.entries({ heavy: 'Niedrig', light: 'Hoch', '': 'Frei' })
      .filter(([t]) => t || feat('day-free') || !dayIntensity(day)).map(([t, label]) =>
      `<button class="vchip ${(dayIntensity(day) || '') === t ? 'on' : ''}" data-action="day-type" data-t="${t}">${label}</button>`).join('')}
    </div>` : ''}
    <p class="hint">${!feat('day-reprange') ? 'Sätze, Wiederholungen und Gewichte rechnet die App automatisch aus.' : dayIntensity(day)
      ? `${{ heavy: 'Niedrig: mehr Gewicht, weniger Wiederholungen', light: 'Hoch: weniger Gewicht, mehr Wiederholungen' }[dayIntensity(day)]} – beides sind intensive Trainingstage, nur mit unterschiedlicher Belastung.
        Sätze und Wiederholungen werden automatisch aus Muskelgruppe, Übungsart und Zykluswoche berechnet.`
      : 'Frei: Sätze und Wiederholungen legst du pro Übung selbst fest.'}</p>
    ${feat('day-volume') ? volumeSummary(day) : ''}
    <h2>Übungen</h2>`;
  const bw = data.cycle.buildWeeks;
  const autoWeeks = Array.from({ length: bw }, (_, w) => autoSetsForDay(day, w + 1, false));
  const autoDeload = autoSetsForDay(day, 0, true);
  day.exercises.forEach((ex, i) => {
    const isAuto = autoDeload.has(ex.id);
    h += `<div class="card">
      <div class="ex-name-row">
        ${feat('plan-add-ex') || !ex.name.trim() ? `<input class="inp" type="text" data-field="ex-name" data-i="${i}"
          autocomplete="off" autocorrect="off" spellcheck="false"
          value="${esc(ex.name)}" placeholder="Übung eintippen, z. B. Bank…">` : `<h3 class="plan-ex-name">${esc(ex.name)}</h3>`}
        <button class="info-btn" data-action="lib-open" data-i="${i}" aria-label="Ausführung ansehen"
          ${libEntry(ex.name) ? '' : 'hidden'}>i</button>
      </div>
      <div class="suggest" hidden></div>
      ${planSwapHtml(day, ex, i)}
      ${feat('tr-compare') ? planCompare(ex, day) : ''}
      ${feat('ex-kind-group') ? `<label class="row"><span>Muskelgruppe</span>
        <select class="inp sel" data-field="ex-group" data-i="${i}">
          <option value="">auto${groupOf({ name: ex.name }) ? ': ' + MUSCLES[groupOf({ name: ex.name })] : ''}</option>
          ${Object.entries(MUSCLES).map(([g, label]) =>
            `<option value="${g}" ${ex.group === g ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </label>` : ''}
      ${isAuto
        ? `<p class="auto-info">Sätze automatisch: ${autoWeeks.map((m, w) => `${w === 0 ? 'Intro' : 'W' + (w + 1)} ${m.get(ex.id)}`).join(' · ')} · Deload ${autoDeload.get(ex.id)}<br>
           Wdh.: ${repRangeText(day, ex)} (Start bei ${repsFor(day, ex)})</p>`
        : `${stepperRow('Sätze Intro', 'sets', i, ex.sets)}
           ${stepperRow('Sätze letzte Woche', 'setsEnd', i, ex.setsEnd)}
           <p class="hint kind-hint">${setsPreview(ex)}</p>
           ${dayIntensity(day)
             ? `<p class="auto-info">Wdh.: ${repRangeText(day, ex)} (Start bei ${repsFor(day, ex)}) · Muskelgruppe ohne Volumen-Vorgabe, Sätze von Hand</p>`
             : stepperRow('Wdh. pro Satz', 'reps', i, ex.reps)}`}
      ${feat('ex-kind-group') ? `<div class="variants plan"><span>Art${ex.kind == null ? ' <small class="hint">(auto)</small>' : ''}</span>${Object.entries(KINDS).map(([k, label]) =>
        `<button class="vchip ${kindOf(ex) === k ? 'on' : ''}" data-action="plan-kind" data-i="${i}" data-k="${k}">${label}</button>`).join('')}
      </div>` : ''}
      ${feat('tr-tank-target') ? `<p class="hint kind-hint">Ziel im Tank diese Woche: <b>${weekRirText(kindOf(ex), groupOf(ex))}</b></p>` : ''}
      ${feat('tr-variants') ? `<div class="variants plan"><span>Ausführung</span>${Object.entries(VARIANTS).map(([v, label]) =>
        `<button class="vchip ${(ex.variant || '') === v ? 'on' : ''}" data-action="plan-variant" data-i="${i}" data-v="${v}">${label}</button>`).join('')}
      </div>` : ''}
      ${bodyweightRow(ex, i)}
      ${isBodyweight(ex) || !feat('tr-max') ? '' : `<label class="row">
        <span>Max. kg bei 10 Wdh.</span>
        <input class="inp kg ${ex.max10 == null ? 'missing' : ''}" type="text" inputmode="decimal"
          autocomplete="off" data-field="ex-max" data-i="${i}" placeholder="kg"
          value="${ex.max10 == null ? '' : fmtNum(ex.max10)}">
      </label>
      ${feat('tr-step') ? `<div class="variants plan"><span>Steigerung${ex.step == null ? ' <small class="hint">(auto)</small>' : ''}</span>${STEP_OPTIONS.map(v =>
        `<button class="vchip ${stepFor(ex) === v ? 'on' : ''}" data-action="set-step" data-i="${i}" data-v="${v}">${fmtNum(v)} kg</button>`).join('')}
      </div>` : ''}`}
      <div class="row">
        <button class="icon-btn" data-action="ex-up" data-i="${i}" aria-label="Nach oben">↑</button>
        <button class="icon-btn" data-action="ex-down" data-i="${i}" aria-label="Nach unten">↓</button>
        <button class="icon-btn danger" data-action="ex-del" data-i="${i}">Entfernen</button>
      </div>
    </div>`;
  });
  h += `${feat('plan-add-ex') ? '<button class="btn center" data-action="add-ex">+ Übung hinzufügen</button>' : ''}
    <button class="btn primary" data-action="day-done">✔ Fertig</button>
    <p class="hint">${feat('tr-max') ? `Änderungen werden automatisch gespeichert. „Max. kg bei 10 Wdh.“ wird nach jedem Training automatisch angepasst. Steigerung: Kurzhantel-Übungen 2 kg, alle anderen 2,5 kg – pro Übung änderbar auf 1,25 / 2 / 2,5 / 5 kg. ${STEP_HINT}`
      : 'Übung tauschen: Namen antippen und eine andere eintippen. Änderungen werden automatisch gespeichert.'}</p>
    <div class="spacer"></div>
    <button class="btn danger" data-action="del-day">Trainingstag löschen</button>`;
  return h;
}

/* ---------- Kalender (Verlauf und Cardio-Statistik) ---------- */

// je Kalender (key): angezeigter Monat 'JJJJ-MM' und angetippter Tag 'JJJJ-MM-TT' (null = keiner)
const calState = {};
const MONTHS_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const calGet = key => calState[key] || (calState[key] = { month: todayISO().slice(0, 7), sel: null });
// Kalendertag (lokal) eines gespeicherten Zeitpunkts
const localDay = iso => new Date(iso).toLocaleDateString('sv-SE');

// Monatskalender, Woche ab Montag. marks(tag) -> { cls, sub } | null (cls z. B. 'tr' Training, 'cd' nur Cardio)
function calendarHtml(key, marks) {
  const st = calGet(key);
  const [y, m] = st.month.split('-').map(Number);
  const lead = (new Date(y, m - 1, 1, 12).getDay() + 6) % 7;
  const days = new Date(y, m, 0).getDate();
  const today = todayISO();
  let cells = '<span class="cal-cell empty"></span>'.repeat(lead);
  for (let d = 1; d <= days; d++) {
    const iso = `${st.month}-${String(d).padStart(2, '0')}`;
    const mk = iso <= today ? marks(iso) : null;
    const cls = ['cal-cell', mk && mk.cls, iso === today && 'today', iso === st.sel && 'sel', iso > today && 'future'].filter(Boolean).join(' ');
    cells += `<button class="${cls}" data-action="cal-pick" data-k="${key}" data-d="${iso}" ${iso > today ? 'disabled' : ''}
      aria-label="${fmtDate(iso + 'T12:00:00', true)}"><b>${d}</b><small>${mk && mk.sub ? mk.sub : ''}</small></button>`;
  }
  return `<div class="cal">
      <div class="cal-head">
        <button class="icon-btn" data-action="cal-nav" data-k="${key}" data-d="-1" aria-label="Voriger Monat">‹</button>
        <b>${MONTHS_DE[m - 1]} ${y}</b>
        <button class="icon-btn" data-action="cal-nav" data-k="${key}" data-d="1" ${st.month >= today.slice(0, 7) ? 'disabled' : ''} aria-label="Nächster Monat">›</button>
      </div>
      <div class="cal-grid">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(w => `<span class="cal-wd">${w}</span>`).join('')}${cells}</div>
    </div>`;
}

// Knopf eines gespeicherten Trainings (Verlauf, Kalendertag)
const sessionBtn = s => `<button class="btn nav" data-action="open-session" data-id="${s.id}">
    ${fmtDate(s.date)}<small>${esc(s.dayName)} · ${s.entries.length} Übungen · ${fmtTons(sessionTonnage(s))}${s.duration ? ' · ⏱ ' + fmtDur(s.duration) : ''}${s.deload ? ' · Deload' : ''}</small></button>`;

// Verlauf: Kalender mit Trainings (und Cardio), angetippter Tag, Trainings des Monats, Übungen
function renderHistory() {
  const cardio = typeof cardioStartHtml === 'function' ? cardioStartHtml() : '';
  const cardioList = typeof data.cardio !== 'undefined' ? data.cardio : [];
  if (!data.sessions.length && !cardioList.length) {
    return cardio + '<p class="hint">Noch keine Trainings gespeichert.</p>';
  }
  const byDay = new Map();
  for (const s of sessionsNewestFirst()) {
    const d = localDay(s.date);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }
  const icon = c => (typeof CARDIO_TYPES !== 'undefined' && (CARDIO_TYPES[c.type] || CARDIO_TYPES.other).icon) || '🏃';
  const st = calGet('hist');
  let h = calendarHtml('hist', iso => {
    const ss = byDay.get(iso) || [], cs = cardioList.filter(c => c.date === iso);
    if (!ss.length && !cs.length) return null;
    return { cls: ss.length ? (ss.every(s => s.deload) ? 'tr dl' : 'tr') : 'cd', sub: cs.length ? icon(cs[0]) : '' };
  });
  h += `<p class="cal-legend"><span class="cal-key tr"></span>Training <span class="cal-key dl"></span>Deload
    <span class="cal-key cd"></span>nur Cardio</p>`;
  // angetippter Tag
  if (st.sel) {
    const ss = byDay.get(st.sel) || [], cs = cardioList.filter(c => c.date === st.sel);
    h += `<div class="card cal-day"><p class="cal-day-head"><b>${fmtDate(st.sel + 'T12:00:00', true)}</b></p>
      ${ss.map(sessionBtn).join('')}${cs.map(c => typeof cardioRowHtml === 'function' ? cardioRowHtml(c) : '').join('')}
      ${ss.length || cs.length ? '' : '<p class="hint">An diesem Tag hast du nichts eingetragen.</p>'}</div>`;
  }
  // Trainings des angezeigten Monats
  const inMonth = sessionsNewestFirst().filter(s => localDay(s.date).slice(0, 7) === st.month);
  const cdMonth = cardioList.filter(c => c.date.slice(0, 7) === st.month);
  const [y, m] = st.month.split('-').map(Number);
  h += `<h2>${MONTHS_DE[m - 1]}: ${inMonth.length} Training${inMonth.length === 1 ? '' : 's'}${cdMonth.length ? ` · ${cdMonth.length}× Cardio` : ''}</h2>`;
  h += inMonth.length ? inMonth.map(sessionBtn).join('') : '<p class="hint">In diesem Monat keine Trainings.</p>';
  h += `<h2>Cardio</h2>${cardio}`;

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
  if (feat('ex-history') && exercises.length) h += '<h2>Übungen</h2>';
  for (const ex of feat('ex-history') ? exercises : []) {
    h += `<button class="btn nav" data-action="open-exercise" data-name="${esc(ex.name)}">
      ${esc(ex.name)}<small>${ex.count}× trainiert · zuletzt ${fmtDate(ex.last)}</small></button>`;
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
    <span class="lib-thumb">${libFigure(name, false) || '<span class="lib-own" aria-hidden="true">★</span>'}</span>
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
    <p class="hint">Jede Übung mit animierter Ausführung, Zielmuskeln und Tipps. Muskelgruppe antippen zum Aufklappen.</p>
    ${feat('custom-ex') ? '<button class="btn outline lib-add-btn" data-action="libc-new">＋ Eigene Übung hinzufügen</button>' : ''}
    <p class="hint">Dir fehlt eine Übung, z. B. ein besonderes Gerät in deinem Studio? Leg sie einmal an – danach kannst du sie
      jederzeit wieder aufrufen: im Plan, im Plan-Assistenten und beim Ersetzen oder Hinzufügen im Training.</p>`;
  if (data.customExercises.length) {
    const open = libOpenGroups.has('own');
    h += `<details class="award-cat lib-group" ${open ? 'open' : ''}>
      <summary data-action="lib-toggle" data-g="own">★ Eigene Übungen <small class="hint">(${data.customExercises.length})</small></summary>
      ${open ? data.customExercises.map(c => libRow(c.name)).join('') : ''}</details>`;
  }
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
  const c = customExercise(name);
  if (c) return renderCustomEx(c, e);
  if (!e) return `<p class="hint">Für „${esc(name)}“ gibt es noch keine Erklärung in der Bibliothek.</p>`;
  const t = typeof shortFor === 'function' ? shortFor(e.name, e.pattern) : FIG_TEXT[e.pattern] || {};
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
    ${typeof guideHtml === 'function' ? guideHtml(e.name, e.pattern) : ''}
    ${trained ? `<button class="btn nav" data-action="open-exercise" data-name="${esc(name)}">Deine Einträge zu dieser Übung</button>` : ''}
    ${['neuling', 'einsteiger'].includes(activePlan().level) ? coachNote()
      : '<p class="hint">Die Figur zeigt das Bewegungsprinzip. Bei Unsicherheit lass dir die Übung im Studio zeigen.</p>'}`;
}

/* ---------- Eigene Übungen ---------- */

// data.customExercises: [{ name, kind, group, like, note }] – werden beim Start in die Übungsliste übernommen
// (Vorschläge, Plan-Assistent, Ersetzen, Bibliothek). like = ähnliche Übung, deren Figur und Tipps gezeigt werden.
const customKeys = new Set();
const customExercise = name => data.customExercises.find(c => nameKey(c.name) === nameKey(name)) || null;
const builtinExercise = name => EXERCISE_KINDS.has(nameKey(name)) && !customKeys.has(nameKey(name));

function registerCustomExercises() {
  for (const k of customKeys) {
    for (let i = EXERCISE_LIST.length - 1; i >= 0; i--) if (nameKey(EXERCISE_LIST[i][0]) === k) EXERCISE_LIST.splice(i, 1);
    for (let i = EXERCISES.length - 1; i >= 0; i--) if (nameKey(EXERCISES[i]) === k) EXERCISES.splice(i, 1);
    EXERCISE_KINDS.delete(k);
    EXERCISE_GROUPS.delete(k);
    const lib = LIB_INDEX.get(k);
    if (lib && lib.custom) LIB_INDEX.delete(k);
  }
  customKeys.clear();
  for (const c of data.customExercises) {
    const k = nameKey(c.name);
    if (EXERCISE_KINDS.has(k)) continue;  // Name gibt es schon in der Liste
    EXERCISE_LIST.push([c.name, c.kind, c.group]);
    EXERCISES.push(c.name);
    EXERCISE_KINDS.set(k, c.kind);
    EXERCISE_GROUPS.set(k, c.group);
    const like = c.like && LIB_INDEX.get(nameKey(c.like));
    if (like && !LIB_INDEX.has(k)) LIB_INDEX.set(k, { ...like, note: c.note || '', custom: true });
    customKeys.add(k);
  }
}

function renderCustomEx(c, e) {
  const t = !e ? {} : typeof shortFor === 'function' ? shortFor(c.like, e.pattern) : FIG_TEXT[e.pattern] || {};
  const trained = data.sessions.some(s => s.entries.some(en => nameKey(en.name) === nameKey(c.name)));
  let h = e ? `<div class="card lib-fig">${libFigure(c.name, true)}</div>` : '';
  h += `<div class="lib-chips"><span class="lib-chip">★ Eigene Übung</span><span class="lib-chip">${KINDS[c.kind]}</span>
      <span class="lib-chip">${MUSCLES[c.group] || ''}</span></div>
    ${c.note ? `<p class="lib-note">${esc(c.note)}</p>` : ''}`;
  if (e) {
    h += `<div class="card">
      <h2>Ausführung</h2>
      <p class="hint">Figur und Tipps von der ähnlichen Übung „${esc(c.like)}“.</p>
      <ol class="lib-steps">${(t.steps || []).map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      ${t.tips && t.tips.length ? `<h2>Darauf achten</h2><ul class="lib-tips">${t.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    </div>${typeof guideHtml === 'function' ? guideHtml(c.like, e.pattern) : ''}`;
  } else {
    h += `<p class="hint">Zu dieser Übung gibt es keine Figur. Wenn du unter „Bearbeiten“ eine ähnliche Übung auswählst,
      zeigt die Bibliothek deren Ausführung und Tipps.</p>`;
  }
  return h + `${trained ? `<button class="btn nav" data-action="open-exercise" data-name="${esc(c.name)}">Deine Einträge zu dieser Übung</button>` : ''}
    <button class="btn" data-action="libc-edit" data-name="${esc(c.name)}">✎ Bearbeiten</button>
    <button class="btn danger" data-action="libc-del" data-name="${esc(c.name)}">Eigene Übung löschen</button>`;
}

let libForm = null;  // Eingaben im Formular „Eigene Übung“

function renderLibAdd(p) {
  if (!libForm) {
    const c = p.name && customExercise(p.name);
    libForm = c ? { ...c, orig: c.name } : { name: '', kind: 'normal', group: '', like: '', note: '', orig: null };
  }
  const f = libForm;
  const chip = (action, key, val, label) => `<button class="vchip ${f[key] === val ? 'on' : ''}" data-action="${action}" data-v="${val}">${label}</button>`;
  const kindInfo = {
    compound: 'große, schwere Mehrgelenkübung, meist mit Langhantel (z. B. Kniebeugen, Bankdrücken) – mit mehreren Aufwärmsätzen und 1 Wdh. mehr im Tank',
    normal: 'die meisten Maschinen-, Kabel- und Kurzhantelübungen – 1 Aufwärmsatz, Tank wie geplant',
    assist: 'kleine Isolationsübung (z. B. Seitheben, Curls, Waden) – ohne Aufwärmen und 1 Wdh. näher am Muskelversagen',
  };
  return `${p.name ? '' : `<div class="card">
      <h2>So legst du eine eigene Übung an</h2>
      <ol class="lib-steps">
        <li><b>Name:</b> so, wie du die Übung wiedererkennst – z. B. „Rudermaschine Gym80 einarmig“.</li>
        <li><b>Muskelgruppe:</b> Aus ihr bekommt die Übung ihre Sätze im Wochenvolumen deines Plans.</li>
        <li><b>Übungsart:</b> bestimmt das Aufwärmen und wie nah du ans Muskelversagen gehst.</li>
        <li><b>Ähnliche Übung</b> (freiwillig): Dann zeigt die Bibliothek deren Figur und Tipps zur Ausführung.</li>
        <li><b>Notiz</b> (freiwillig): z. B. Sitzhöhe, Griff oder Einstellung am Gerät.</li>
      </ol>
      <p class="hint">Danach ist die Übung dauerhaft gespeichert und du kannst sie einfach immer wieder abrufen: in der Bibliothek
        (unter „★ Eigene Übungen“ und bei ihrer Muskelgruppe), bei der Übungsauswahl im Plan und im Plan-Assistenten sowie beim
        „⇄ Ersetzen“ und „+ Übung hinzufügen“ im Training – einfach die ersten Buchstaben eintippen, dann erscheint sie in den Vorschlägen.
        Sie ist auch in deiner Sicherung enthalten. Steigerung und Max. bei 10 Wdh. rechnet die App wie bei jeder anderen Übung.</p>
    </div>`}
    <div class="card libc-form">
      <label class="lbl" for="libc-name">Name der Übung</label>
      <input class="inp" id="libc-name" type="text" data-field="libc-name" autocomplete="off" autocorrect="off"
        placeholder="z. B. Rudermaschine einarmig" value="${esc(f.name)}">
      <p class="lbl">Muskelgruppe</p>
      <div class="variants plan">${Object.entries(MUSCLES).map(([g, label]) => chip('libc-group', 'group', g, label)).join('')}</div>
      <p class="lbl">Übungsart</p>
      <div class="variants plan">${Object.entries(KINDS).map(([k, label]) => chip('libc-kind', 'kind', k, label)).join('')}</div>
      <p class="hint">${KINDS[f.kind]}: ${kindInfo[f.kind]}.</p>
      <label class="lbl" for="libc-like">Ähnliche Übung <small class="hint">(freiwillig)</small></label>
      <input class="inp" id="libc-like" type="text" data-field="libc-like" autocomplete="off" autocorrect="off" spellcheck="false"
        placeholder="z. B. Rudern Kabelzug eng" value="${esc(f.like || '')}">
      <div class="suggest" hidden></div>
      <label class="lbl" for="libc-note">Notiz <small class="hint">(freiwillig)</small></label>
      <textarea class="inp comment" id="libc-note" rows="2" data-field="libc-note"
        placeholder="z. B. Sitzhöhe 4, neutraler Griff">${esc(f.note || '')}</textarea>
    </div>
    <button class="btn primary" data-action="libc-save">✔ Übung speichern</button>
    <button class="btn" data-action="libc-cancel">Abbrechen</button>`;
}

// Alle Wochen (Durchläufe) zum Blättern: mit Trainings und die des aktuellen Zyklus, in zeitlicher Reihenfolge
function allRounds() {
  const ci = cycleInfo();
  const keys = new Set(data.sessions.filter(s => s.cycleStart).map(s => roundKey(s.cycleStart, s.week)));
  for (let w = 1; w <= ci.buildWeeks + 1; w++) keys.add(roundKey(ci.cycleStart, w));
  const split = k => { const i = k.lastIndexOf('|'); return [k.slice(0, i), Number(k.slice(i + 1))]; };
  return [...keys].map(split).sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]).map(([s, w]) => roundKey(s, w));
}

// Trainings einer Zykluswoche (key = roundKey), mit Blättern zur Vor-/Folgewoche
function renderWeek({ key }) {
  const ci = cycleInfo();
  const i = key.lastIndexOf('|');
  const start = key.slice(0, i), week = Number(key.slice(i + 1));
  const sessions = roundSessions(start, week).sort((a, b) => a.date.localeCompare(b.date));
  const isNow = start === ci.cycleStart && week === ci.week;
  const ahead = start === ci.cycleStart && week > ci.week;
  // Zyklus-Nummer: vom aktuellen Zyklus aus zurückgezählt
  const starts = [...new Set(allRounds().map(k => k.slice(0, k.lastIndexOf('|'))))];
  const no = ci.cycle - (starts.indexOf(ci.cycleStart) - starts.indexOf(start));
  const first = sessions.length ? fmtDate(sessions[0].date) : '';
  const last = sessions.length ? fmtDate(sessions[sessions.length - 1].date) : '';
  const when = first ? first + (last !== first ? ` – ${last}` : '') : isNow ? 'läuft gerade' : ahead ? 'kommt noch' : '';

  let h = `<div class="card week-head">
      <button class="icon-btn" data-action="week-shift" data-dir="-1" aria-label="Vorherige Woche">‹</button>
      <div><b>${roundLabel(start, week)}</b>${no >= 1 ? `<small>Zyklus ${no}</small>` : ''}${when ? `<small>${when}</small>` : ''}</div>
      <button class="icon-btn" data-action="week-shift" data-dir="1" aria-label="Nächste Woche">›</button>
    </div>`;
  if (sessions.length) {
    const tons = sessions.reduce((a, s) => a + sessionTonnage(s), 0);
    h += `<div class="stats two"><div class="stat"><span>Trainings</span><b>${sessions.length}</b></div>
      <div class="stat"><span>Bewegt</span><b>${fmtTons(tons)}</b></div></div>`;
  }
  for (const s of sessions) {
    h += `<button class="btn nav" data-action="open-session" data-id="${s.id}" data-week="${esc(key)}">
      ${esc(s.dayName)}<small>${fmtDate(s.date)} · ${s.entries.length} Übungen · ${fmtTons(sessionTonnage(s))}${s.duration ? ' · ⏱ ' + fmtDur(s.duration) : ''}</small></button>`;
  }
  if (!sessions.length) {
    h += `<p class="hint">${ahead ? 'Diese Woche liegt noch vor dir.' : isNow ? 'In dieser Woche wurde noch nicht trainiert.' : 'In dieser Woche wurde nicht trainiert.'}</p>`;
  }
  if (isNow && data.days.length) h += `<p class="hint">🔄 ${roundStatus(ci)}</p>`;
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
    (fresh ? backupAfterTrainingCard() : '') +
    `<div class="stats two"><div class="stat"><span>Bewegt (Tonnage)</span><b>${fmtTons(sessionTonnage(s))}</b></div>
      <div class="stat"><span>Dauer</span><b>${s.duration ? fmtDur(s.duration) : '–'}</b></div></div>`;
  const progNote = s.progression ? ` · ${progOffText(s.progression)}` : '';
  let h = top + `<p class="sub">${fmtDate(s.date, true)}<br>${esc(s.dayName)}${s.deload ? ' · Deload-Woche (keine Steigerung)' : progNote}` +
    (s.readiness ? `<br>Tagesform: ${readinessText(s.readiness)}` : '') + (s.timeLimit ? `<br>⏱ auf ${s.timeLimit} min gekürzt` : '') + '</p>' +
    `${feat('session-edit') ? `<button class="btn outline" data-action="se-edit" data-id="${s.id}">✎ Training bearbeiten</button>` : ''}<ul class="list">`;
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

// Erstes Training eines neuen Plans: mit welcher Zykluswoche geht es los? (w = 1 … buildWeeks oder 'deload')
function renderEntryWeek({ id, w }) {
  const bw = data.cycle.buildWeeks;
  const self = selfDeload();
  const entry = w === 'deload' ? bw + 1 : Number(w);
  const left = bw - entry;
  const after = entry > bw
    ? 'Danach beginnt der Zyklus mit der Intro-Woche.'
    : self
      ? `Danach ${left ? `noch ${left} Aufbauwoche${left === 1 ? '' : 'n'}, dann ` : ''}geht es Woche für Woche weiter, bis du den Deload einlegst.`
      : `Danach ${left ? `noch ${left} Aufbauwoche${left === 1 ? '' : 'n'} und ` : ''}die Deload-Woche.`;
  return `<div class="card wiz-q">
      <p class="sub">${esc(findDay(id).name)} · erstes Training mit „${esc(activePlan().name)}“</p>
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">📅</span><h2>Mit welcher Woche startest du?</h2></div>
      <p class="hint wiz-q-explain">Normalerweise beginnst du mit der Intro-Woche. Nach Krankheit oder einer längeren Pause
        kannst du z. B. direkt mit der leichten Deload-Woche einsteigen – oder, wenn du schon gut im Training bist, mit einer
        späteren Woche.</p>
      <p class="lbl chips-title">Einstieg mit</p>
      <div class="pills">${Array.from({ length: bw + 1 }, (_, i) => i + 1).map(n => {
        const dl = n > bw;
        return `<button class="pill ${dl ? 'dl' : n === 1 ? 'intro' : ''} ${n === entry ? 'now' : ''}"
          data-action="entry-week" data-w="${dl ? 'deload' : n}">${dl ? 'Deload' : n === 1 ? 'Intro' : n}</button>`;
      }).join('')}</div>
      <p class="hint">Dieses Training gehört dann zur <b>${cycleWeekLabel(entry, bw)}</b>. ${after}</p>
    </div>
    <div class="row"><button class="btn" data-action="cancel">Abbrechen</button>
      <button class="btn primary" data-action="entry-ok">Weiter</button></div>`;
}

// Erstes Training nach einem verlängerten Zyklus: Woche für Woche vergleichen oder um die Verlängerung versetzt
function renderCycleChoice({ id, by }) {
  const bw = data.cycle.buildWeeks;
  const wk = n => `${n} Woche${n === 1 ? '' : 'n'}`;
  const pairs = Array.from({ length: bw }, (_, i) => `${i ? 'W' + (i + 1) : 'Intro'} ↔ W${i + 1 + by}`).join(' · ');
  const opt = (shift, title, text) => `<button class="split-opt freq-opt" data-action="cycle-choice" data-shift="${shift}">
      <b>${title}</b><small>${text}</small></button>`;
  return `<div class="card wiz-q">
      <p class="sub">${esc(findDay(id).name)} · erstes Training im neuen Zyklus</p>
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🔁</span><h2>Woran soll sich der neue Zyklus orientieren?</h2></div>
      <p class="hint wiz-q-explain">Dein letzter Zyklus wurde um <b>${wk(by)}</b> verlängert (bis Woche ${bw + by}). Soll sich der neue Zyklus
        Woche für Woche nach dem alten richten – oder die Verlängerung mit berücksichtigen?</p>
      ${opt(1, 'Verlängerung berücksichtigen', `Der Vergleich verschiebt sich um ${wk(by)}: ${pairs}. Das Gewicht kommt aus der versetzten Woche, Wiederholungen und Tank bleiben so, wie sie für die jeweilige Woche vorgesehen sind.`)}
      ${opt(0, 'Woche für Woche wie im letzten Zyklus', `Intro ↔ Intro, W2 ↔ W2 … – jede Woche wird mit derselben Woche des letzten Zyklus verglichen, je Satz +1 Wdh. pro ${cmpWeeksPerRep()} Wochen Abstand`)}
    </div>
    <p class="hint">Gilt für den ganzen neuen Zyklus.</p>`;
}

// Vor dem ersten Training mit neuen Übungen: „Max. bei 10 Wdh.“ eintragen oder leer lassen
function renderFirstMax({ id, exIds }) {
  const day = findDay(id);
  const list = day.exercises.filter(e => exIds.includes(e.id));
  return `<div class="card wiz-q">
      <p class="sub">${esc(day.name)} · ${list.length === 1 ? '1 neue Übung' : `${list.length} neue Übungen`}</p>
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🏋️</span><h2>Wie viel schaffst du bei 10 Wiederholungen?</h2></div>
      <p class="hint wiz-q-explain"><b>Max. bei 10 Wdh.</b> (auch „10 RM“) ist das Gewicht, mit dem du eine Übung gerade so
        <b>10-mal sauber</b> schaffst – eine 11. Wiederholung ginge nicht mehr. Daraus berechnet die App deine Gewichte für jedes Training.</p>
      ${list.map(ex => `<div class="fm-row">
        <span class="fm-name">${esc(ex.name)}${libInfoBtn(ex.name)}</span>
        <input class="inp kg" type="text" inputmode="decimal" autocomplete="off" data-field="first-max" data-id="${ex.id}"
          placeholder="kg" value="${ex.max10 == null ? '' : fmtNum(ex.max10)}">
      </div>`).join('')}
    </div>
    <div class="first-max-note"><span aria-hidden="true">💡</span><p><b>Du weißt es nicht genau?</b> Dann lass das Feld einfach leer
      und trag im Training ganz normal ein, was du im Satz geschafft hast – Gewicht, Wiederholungen und wie viele noch im Tank
      gewesen wären. Die App berechnet das Max. bei 10 Wdh. danach selbst. Bei Übungen ohne Gewicht (z. B. Klimmzüge) ebenfalls leer lassen.</p></div>
    <div class="row"><button class="btn" data-action="cancel">Abbrechen</button>
      <button class="btn primary" data-action="first-max-done">Weiter</button></div>`;
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
  if (!feat('check-detail') && step === 1) {
    // Einfach: eine Frage – bei Nein kurze Auswahl, was los ist
    if (current.params.notOk) {
      return `<div class="card check">
        <p class="sub">${esc(findDay(id).name)}</p>
        <h2 class="question">Was ist los?</h2>
        <div class="row"><button class="btn" data-action="check-simple" data-k="sleep">😴 schlecht geschlafen</button>
          <button class="btn" data-action="check-simple" data-k="stress">😫 viel Stress</button></div>
        <button class="btn" data-action="check-simple" data-k="both">beides</button>
        <p class="hint">Die App senkt die Ziele heute etwas.</p></div>`;
    }
    return `<div class="card check">
      <p class="sub">${esc(findDay(id).name)}</p>
      <div class="check-emoji" aria-hidden="true">🙂</div>
      <h2 class="question">Alles okay heute?</h2>
      <div class="row">
        <button class="btn primary" data-action="check-simple" data-k="ok">Ja</button>
        <button class="btn primary" data-action="check-simple" data-k="no">Nein</button>
      </div></div>`;
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

// Modus wählen (Optionen)
function modeCard() {
  const m = appMode();
  return `<div class="card mode-card">
      <h2>Modus</h2>
      <div class="mode-opts">${Object.entries(APP_MODES).map(([k, x]) =>
        `<button class="split-opt ${m === k ? 'on' : ''}" data-action="mode-set" data-m="${k}"><b>${x.icon} ${x.label}</b><small>${x.text}</small></button>`).join('')}</div>
      <p class="hint">Bestimmt, wie viel die App zeigt und fragt. Die Trainingssteuerung ist in allen Modi dieselbe: Was du nicht siehst,
        läuft mit der Empfehlung der App weiter. Ein Wechsel ändert nichts an deinen Daten.</p>
    </div>`;
}

function renderData() {
  return modeCard() + (typeof tourCard === 'function' ? tourCard() : '') + appearanceCard() + profileCard() + (typeof nutHintsCard === 'function' ? nutHintsCard() : '') + (typeof mcOptionsCard === 'function' ? mcOptionsCard() : '') + `<div class="card">
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
    <p class="hint app-version" id="app-version"></p>
`;
}

// App-Version = Name des Offline-Speichers (CACHE in sw.js), z. B. „Version 82“ – zum Prüfen, ob ein Update angekommen ist
function showAppVersion() {
  const el = document.getElementById('app-version');
  if (!el || !window.caches) return;
  caches.keys().then(keys => {
    const v = keys.map(k => (k.match(/^trainingsapp-v(\d+)$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => b - a)[0];
    if (v) el.textContent = `App-Version ${v}`;
  }).catch(() => {});
}

/* ---------- Aktionen ---------- */

// Übungen, die zum ersten Mal drankommen: kein „Max. bei 10 Wdh.“ und noch nie trainiert
// (Eigengewichtsübungen ohne Gewichtsprogression brauchen keinen Wert)
const firstTimeExercises = day => day.exercises.filter(e => e.name.trim() && e.max10 == null && !lastEntry(e.name) && !isBodyweight(e));

// Vor dem Training, der Reihe nach: Woche abschließen? (askSkipRound) → erstes Training nach einem verlängerten
// Zyklus: Vergleich versetzen? → neue Übungen: „Max. bei 10 Wdh.“ → zwei kurze Fragen → startDay mit dem Abzug.
function beginCheck(id) {
  const day = findDay(id);
  if (!day.exercises.some(e => e.name.trim())) {
    alert('Dieser Trainingstag hat noch keine Übungen. Lege sie unter „Plan“ an.');
    return;
  }
  if (draft && !confirm(`Es läuft bereits ein Training (${draft.dayName}). Verwerfen und neu beginnen?`)) return;
  if (ownPlan()) { startDay(id); return; }  // eigener Plan: keine Fragen vorab, es wird nichts angepasst
  // neuer Plan aus dem Assistenten: erst fragen, mit welcher Zykluswoche er beginnt
  if (activePlan().askEntry) {
    if (!feat('entry-week')) { delete activePlan().askEntry; saveData(); }  // Einfach: immer mit der Intro-Woche
    else { go('entryweek', { id, w: 1 }); return; }
  }
  if (!askSkipRound(day)) return;
  beginAfterRound(id);
}

// choice: die Zyklus-Frage wurde gerade beantwortet ({ from, by }) – „Zurück“ führt dann wieder dorthin
function beginAfterRound(id, choice = null) {
  const ci = trainingRound(id);
  const fresh = !data.sessions.some(s => s.cycleStart === ci.cycleStart);  // erstes Training dieses Zyklus
  if (!choice && fresh && !ci.deload && data.cycleShift[ci.cycleStart] === undefined) {
    const ext = prevExtension(ci.cycleStart);
    if (ext && !feat('cycle-choice')) {
      // Einfach: Verlängerung automatisch berücksichtigen
      data.cycleShift[ci.cycleStart] = { from: ext.from, by: ext.by };
      saveData();
    } else if (ext) { go('cyclechoice', { id, from: ext.from, by: ext.by }); return; }
  }
  const neu = firstTimeExercises(findDay(id));
  if (neu.length && feat('first-max')) { go('firstmax', { id, exIds: neu.map(e => e.id), choice }); return; }
  beginQuestions(id, null, choice);
}

// exIds: die neuen Übungen wurden schon abgefragt – „Zurück“ bei Frage 1 führt wieder dorthin
function beginQuestions(id, exIds, choice = null) {
  if (trainingRound(id).deload) startDay(id);  // Deload ist ohnehin leicht -> keine Fragen, kein Abzug
  else go('check', { id, step: 1, exIds, choice });
}

// Tag, für den die laufende Woche vorzeitig abgeschlossen wird (er war in dieser Woche schon dran)
let skipRoundFor = null;

// War der Tag in dieser Woche (Durchlauf) schon dran, während andere noch offen sind: Woche abschließen und mit ihm
// die nächste beginnen? false = nicht starten.
function askSkipRound(day) {
  skipRoundFor = null;
  const ci = cycleInfo();
  const open = roundOpen(ci.cycleStart, ci.week);
  if (!open.length || open.some(x => x.day.id === day.id)) return true;
  const next = roundAfter(ci);
  const nextLabel = next.week === 1 ? 'Intro-Woche des nächsten Zyklus' : ciLabel(toCycleInfo(next.start, next.week, next.no, cycleLenOf(next.start)));
  if (!confirm(`„${day.name}“ war in dieser Woche (${ciLabel(ci)}) schon dran. Noch offen: ${open.map(x => x.day.name).join(', ')}.\n\n` +
    `OK = diese Woche abschließen (offene Trainings auslassen) und mit „${day.name}“ die ${nextLabel} beginnen.\nAbbrechen = nicht starten.`)) return false;
  skipRoundFor = day.id;
  return true;
}

// Zykluswoche, in die ein Training dieses Tages fällt (ggf. schon die nächste, siehe askSkipRound)
function trainingRound(id) {
  const ci = cycleInfo();
  if (skipRoundFor !== id) return ci;
  const n = roundAfter(ci);
  return toCycleInfo(n.start, n.week, n.no, cycleLenOf(n.start));
}

// readiness = { sleptWell, stress }; jede negative Antwort zieht 1 Wdh. pro Übung ab
function startDay(id, readiness = { sleptWell: true, stress: false }) {
  const day = findDay(id);
  const exercises = day.exercises.filter(e => e.name.trim());
  if (!exercises.length) return;

  if (typeof nutSync === 'function') nutSync();  // z. B. Minicut vorbei -> Deload beginnt (nutrition.js)
  const ci = trainingRound(id);
  const own = ownPlan();
  skipRoundFor = null;
  draft = {
    dayId: day.id,
    dayName: day.name,
    date: new Date().toISOString(),
    deload: ci.deload && !own,
    intro: ci.intro && !own,
    own,
    cycleStart: ci.cycleStart,
    week: ci.week,
    cycleNo: ci.cycle,
    readiness,
    penalty: ci.deload || own ? 0 : (readiness.sleptWell ? 0 : 1) + (readiness.stress ? 1 : 0),
    // Progression für dieses Training: Einstellung der Woche, im Training noch änderbar (Deload: ohnehin keine)
    progression: own ? { volume: false, load: false }
      : ci.deload ? { volume: true, load: true } : weekProgression(roundKey(ci.cycleStart, ci.week)),
    occurrence: nextOccurrence(day.id, ci),  // 2 = dieser Tag wurde diese Woche schon einmal trainiert
    entries: [],
  };
  // erst nach dem Anlegen von draft, weil setupEntry die Zykluswoche aus draft liest
  draft.entries = draftEntries(day);
  // Zeitlimit („⏱ Wenig Zeit?“ auf der Startseite): Training kürzen; „nur nächstes Training“ ist damit verbraucht
  const tl = data.timeLimit;
  if (tl && tl.min) {
    draft.timeLimit = tl.min;
    draft.timeCut = trimToTime(draft.entries, tl.min);
    if (tl.once) { delete data.timeLimit; saveData(); }
  }
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
  // (Wochen nach der letzten Aufbauwoche, Deload „selbst bestimmen“: Sätze wie in der letzten Aufbauwoche)
  const setsWeek = draft.deload ? draft.week
    : Math.min(bw, volumeWeek({ week: draft.week, cycleStart: draft.cycleStart }, prog.volume));
  // Ernährungsphase Diät/Minicut mit angepasstem Training: halber Volumenanstieg, 1 Wdh. weniger im Tank
  // (nicht im Deload und nicht bei eigenen Plänen)
  const adapt = !draft.deload && !draft.own && nutTrainAdapt();
  draft.nutAdapt = adapt;
  const auto = autoSetsForDay(day, setsWeek, draft.deload, data.volume, adapt);
  return day.exercises.filter(e => e.name.trim()).map(ex => {
    const en = { name: ex.name.trim() };
    // Ziel im Tank aus Zykluswoche und Übungsart (Deload: Wert der letzten Trainingswoche, dann mind. 3)
    const week = draft.deload ? bw : draft.week;
    const [lo, hi] = rirRange(kindOf(ex), week, bw, groupOf(ex)).map(x => Math.max(0, x - (adapt ? 1 : 0)));
    const rir = (lo + hi) / 2;
    const rirText = lo === hi ? fmtNum(lo) : `${fmtNum(lo)}–${fmtNum(hi)}`;
    // Sätze: automatisch aus dem Muskelgruppen-Volumen, sonst laut Wochenplan der Übung
    // (Deload: Sätze der letzten Woche, werden dort halbiert)
    const fixedSets = auto.has(ex.id);
    const sets = fixedSets ? auto.get(ex.id) : setsForWeek(ex, draft.deload ? bw : setsWeek, bw, adapt);
    const target = { sets, fixedSets, reps: repsFor(day, ex), rir, rirText, max10: ex.max10, step: stepFor(ex), weights: weightsFor(ex.name) };
    if (!draft.deload && !prog.load) target.hold = true;  // Gewicht/Wdh. vom letzten Mal halten
    if (adapt) target.noLoadUp = true;  // Diät/Minicut angepasst: Gewicht nicht steigern, höchstens 1 Wdh. mehr
    if (draft.own) Object.assign(target, { own: true, startWeight: ex.startWeight != null ? ex.startWeight : null });
    setupEntry(en, target, () => ex.variant);
    return en;
  });
}

// Ziel und vorgeschlagene Sätze einer Übung je nach Zykluswoche festlegen:
// Deload -> halbiert & leichter; sonst Werte der Vergleichswoche + 1 Wdh., falls vorhanden
// variantFor(i) liefert die Ausführungsvariante von Satz i
function setupEntry(en, target, variantFor = () => '') {
  // Eigengewichtsübung: ohne Gewicht rechnen – Steigerung nur über die Wdh.
  const body = isBodyweight(planExercise(en.name) || { name: en.name });
  const band = body && isBandName(en.name) ? en.bandPick || bandFor(planExercise(en.name)) : null;
  target = (({ bodyweight, band: b, ...t }) => t)(target);
  if (body) target = { ...target, bodyweight: true, max10: null, ...(band ? { band } : {}) };
  const strip = e => body ? bandShift(withoutWeight(e), band) : e;
  en.plan = target;
  if (draft.deload) target = deloadTarget(target, body ? null : lastWorkSet(en.name, draft.dayId));
  else if (draft.intro) target = { ...target, intro: true };
  // ohne Gewichtsprogression (hold) keine Bezugswochen – es gelten die Werte vom letzten Mal
  const cmp = draft.deload || target.hold ? null : strip(comparisonEntry(en.name, draft.dayId, draft));
  const prev = draft.deload || draft.intro || target.hold ? null : strip(previousWeekEntry(en.name, draft.dayId, draft));
  // Satzzahl laut Wochenplan der Übung (Deload: halbiert)
  const n = target.sets;
  en.target = { ...target, sets: n };
  en.compare = cmp;
  en.prevWeek = prev;
  // 2. Training dieses Tages in der Woche: nie mehr als im 1. Training dieser Woche geschafft
  en.weekFirst = draft.occurrence > 1 && !draft.deload ? strip(weekFirstEntry(en.name, draft.dayId, draft)) : null;
  en.rule = null;
  en.base = buildSets(en.name, en.target);  // Vorschlag ohne Bezugswoche
  en.sets = [];
  en.planned = [];  // ursprünglicher Vorschlag, damit die Bremse nächste Woche vergleichen kann
  for (let i = 0; i < n; i++) applyProposal(en, i, variantFor(i) || '');
  en.note = null;
  en.warmup = null;  // Aufwärmen wird beim Anzeigen passend zum ersten Arbeitssatz vorgeschlagen
  en.warmupEdited = false;
}

// Bandstufe einer Übung: im Plan gespeichert, sonst das leichteste vorhandene Band
const bandLevels = () => (data.home && data.home.bands && data.home.bands.length ? [...data.home.bands].sort() : [1, 2, 3, 4]);
const bandFor = ex => (ex && ex.band) || bandLevels()[0];
// Bandstufe gewechselt: Wdh. des Bezugstrainings aufs aktuelle Band umrechnen – je Stufe etwa BAND_STEP_REPS Wdh.
// (vom User bestätigt: ab ~20 Wdh. nächstes Band, dann mit etwas weniger Wdh.)
const BAND_STEP_REPS = 8, BAND_MAX_REPS = 20;
function bandShift(e, band) {
  const from = e && e.target && e.target.band;
  if (!e || !band || !from || from === band) return e;
  const d = (band - from) * BAND_STEP_REPS;
  const sh = x => x && x.reps != null ? { ...x, reps: Math.max(1, x.reps - d) } : x;
  return { ...e, sets: (e.sets || []).map(sh), planned: (e.planned || []).map(sh) };
}

// Deload mit Gewicht: erster normaler Satz (mit Gewicht) im letzten Training ohne Deload – bevorzugt neuester Zyklus
// und derselbe Trainingstag (null ohne Training)
function lastWorkSet(name, dayId) {
  const e = findWeekEntry(name, dayId, () => true);
  return (e && ofVariant(e.sets, '').find(s => s.weight != null && s.reps != null)) || null;
}

// Eigengewicht im Deload: Wdh. + Tank des ersten Satzes im letzten Training ohne Deload (null ohne Training)
function bwDeloadRef(name) {
  const k = nameKey(name);
  for (const s of sessionsNewestFirst()) {
    if (s.deload) continue;
    const e = s.entries.find(en => nameKey(en.name) === k);
    const first = e && ofVariant(e.sets, '').find(x => x.reps != null);
    if (first) return first.reps + (first.rir != null ? first.rir : 2);
  }
  return null;
}

// Eigengewicht: leichtere / schwerere Variante je Übung (Name ohne Umlaute, wie BODYWEIGHT)
const BW_VARIANTS = [
  [/^einbeinige kniebeugen zum stuhl/, '„Kniebeugen Eigengewicht“', '„Einbeinige Kniebeugen (Pistol Squats)“ – ganz ohne Stuhl'],
  [/^einbeinige kniebeugen/, '„Einbeinige Kniebeugen zum Stuhl“', 'eine Kurzhantel oder Kettlebell vor der Brust halten'],
  [/^nordic/, '„Beincurls am Boden (Handtuch)“ – oder nur langsam absenken und mit den Händen wieder hochdrücken', 'noch langsamer absenken (5 Sekunden) oder eine Gewichtsscheibe vor der Brust halten'],
  [/^klimmzuge/, '„Klimmzüge assistiert (Maschine)“ oder mit Widerstandsband', '„Klimmzüge mit Zusatzgewicht“ (Dip-Gürtel oder Gewichtsweste)'],
  [/^(dips|bankdips)/, '„Dips assistiert (Maschine)“ oder „Dips Maschine“', 'Dips mit Zusatzgewicht (Dip-Gürtel oder Gewichtsweste)'],
  [/^liegestutze/, '„Liegestütze erhöht“ (Hände auf Bank oder Kasten)', 'Liegestütze mit Gewichtsweste oder Füßen erhöht – oder „Bankdrücken“'],
  [/^hyperextensions \(/, 'einen kleineren Bewegungsradius', '„Hyperextensions mit Gewicht“'],
  [/^beinheben/, '„Knieheben hängend“', 'Beinheben langsamer und mit gestreckten Beinen'],
  [/^knieheben/, 'eine kleinere Bewegung', '„Beinheben hängend“'],
  [/^(crunches|sit-ups)/, 'eine kleinere Bewegung', '„Crunches Kabelzug (kniend)“ oder „Crunches Maschine“'],
  [/^glute bridge/, 'eine kleinere Bewegung', '„Hip Thrust Langhantel“'],
];
function bwVariants(name) {
  const n = norm(name);
  const hit = BW_VARIANTS.find(([re]) => re.test(n));
  return hit ? { easy: hit[1], hard: hit[2] }
    : { easy: 'eine leichtere Ausführung (z. B. mit Unterstützung oder kleinerem Bewegungsradius)', hard: 'Zusatzgewicht oder langsamer (z. B. 3 Sekunden absenken)' };
}

// Hinweis bei Eigengewicht: unter MIN_REPS Wdh. geschafft -> leichtere Variante; über BW_MAX_REPS -> schwerere
const BW_MAX_REPS = 15;
// Zu Hause mit vorhandenen Gewichten: ab MAXED_REPS Wdh. mit dem schwersten Gewicht eine schwerere Variante vorschlagen
const MAXED_REPS = 20;
const HOME_HARDER = [
  [/goblet|kniebeugen/, '„Bulgarian Split Squats“ oder „Einbeinige Kniebeugen zum Stuhl“'],
  [/kreuzheben rumanisch \((kurzhantel|kettlebell)\)/, '„Kreuzheben rumänisch einbeinig (Kurzhantel)“'],
  [/hip thrust|glute bridge/, 'einbeinig ausführen oder oben 2 Sekunden halten'],
  [/bankdrucken|floor press|fliegende/, 'langsamer (3 Sekunden absenken) oder mit Pause unten – oder „Liegestütze Füße erhöht“'],
  [/rudern/, 'oben 2 Sekunden halten und langsam absenken'],
  [/ausfallschritte|bulgarian|step-ups/, 'langsamer (3 Sekunden absenken) oder mit Pause unten'],
];
function maxedHint(en) {
  const t = en.target, top = t.weights[t.weights.length - 1];
  const last = lastEntry(en.name);
  const hit = en.sets.some(x => isDone(x) && parseNum(x.weight) >= top && parseNum(x.reps) >= MAXED_REPS)
    || (!en.sets.some(isDone) && last && !last.deload && last.sets.some(x => x.weight >= top && x.reps >= MAXED_REPS));
  if (!hit) return '';
  const n = norm(en.name), h = HOME_HARDER.find(([re]) => re.test(n));
  return `💡 ${MAXED_REPS} Wdh. mit deinem schwersten Gewicht (${fmtNum(top)} kg): Zeit für eine schwerere Variante – ${h ? h[1]
    : 'einarmig bzw. einbeinig ausführen oder langsamer (3 Sekunden absenken)'}. Oder trag schwerere Gewichte unter „Plan → 🏠 Deine Ausrüstung“ ein.
    Tauschen kannst du die Übung oben über „⇄ Ersetzen“.`;
}
// Band: ab BAND_MAX_REPS Wdh. das nächststärkere Band vorschlagen (Knopf wechselt es)
function bandHint(en) {
  const t = en.target, ei = draft.entries.indexOf(en);
  const last = lastEntry(en.name);
  const lastSame = last && !last.deload && (last.target || {}).band === t.band;
  const hit = en.sets.some(x => isDone(x) && parseNum(x.reps) >= BAND_MAX_REPS)
    || (!en.sets.some(isDone) && lastSame && last.sets.some(x => x.reps >= BAND_MAX_REPS));
  if (!hit || en.bandNext) return '';
  const next = bandLevels().find(b => b > t.band);
  return next ? `💡 ${BAND_MAX_REPS} Wdh. geschafft – Zeit fürs nächststärkere Band. Die App rechnet dann mit etwa ${BAND_STEP_REPS} Wdh. weniger.
      <button class="vchip" data-action="tr-band" data-ei="${ei}" data-v="${next}">Band „${BAND_LEVELS[next]}“ nehmen</button>`
    : `💡 ${BAND_MAX_REPS} Wdh. mit deinem stärksten Band: Nimm zwei Bänder zusammen, greif das Band kürzer oder führe die Bewegung langsamer aus (3 Sekunden absenken).`;
}
// Bandstufe im Training wählen: ohne erledigten Satz gilt sie sofort, sonst ab dem nächsten Training
function bandRow(en, ei) {
  const cur = en.bandNext || en.target.band;
  return `<div class="variants plan band-row"><span>Band</span>${bandLevels().map(b =>
    `<button class="vchip ${cur === b ? 'on' : ''}" data-action="tr-band" data-ei="${ei}" data-v="${b}">${BAND_LEVELS[b]}</button>`).join('')}</div>
    ${en.bandNext ? `<p class="hint">Ab dem nächsten Training: Band „${BAND_LEVELS[en.bandNext]}“ (heute „${BAND_LEVELS[en.target.band]}“).</p>` : ''}`;
}

function bwHint(en) {
  const t = en.target;
  if (!t || t.own || t.deload) return '';
  if (t.weights && !t.bodyweight) return maxedHint(en);
  if (!t.bodyweight) return '';
  if (t.band) return bandHint(en);
  const done = en.sets.filter(isDone).map(x => parseNum(x.reps));
  const last = lastEntry(en.name);
  const lastReps = last && !last.deload ? last.sets.map(x => x.reps).filter(r => r != null) : [];
  const v = bwVariants(en.name);
  const swap = ' Tauschen kannst du die Übung oben über „⇄ Ersetzen“.';
  if (done.some(r => r < MIN_REPS) || (!done.length && lastReps.some(r => r < MIN_REPS))) {
    return `💡 Weniger als ${MIN_REPS} Wdh. sind für einen sinnvollen Satz zu wenig. Nimm besser eine leichtere Variante: ${v.easy}.${swap}`;
  }
  if (en.sets.some(x => parseNum(x.reps) > BW_MAX_REPS)) {
    return `💡 Mehr als ${BW_MAX_REPS} Wdh.: Ab hier trainierst du vor allem Ausdauer. Zeit für eine schwerere Variante: ${v.hard}.${swap}`;
  }
  return '';
}

// Vorgeschlagene Sätze für den Trainingsstart
function buildSets(name, target) {
  // Gewicht aus der Progression; ohne Max.-Wert das Gewicht vom letzten Mal
  // (Eigengewichtsübung: kein Gewicht, nur Wdh.)
  const last = lastEntry(name);
  const tw = target.bodyweight ? null : target.deload ? target.weight : targetWeight(target);
  const sets = [];
  const lastSets = last && !target.bodyweight ? ofVariant(last.sets, '') : [];  // nur normale Sätze als Bezug
  // Zu Hause: liegt das passende Gewicht zwischen zwei vorhandenen, gilt das leichtere – dafür mehr Wdh.
  let reps0 = target.reps;
  if (target.weights && tw != null && target.max10 != null && !target.deload) {
    const ideal = target.max10 * repFactor(target.reps + target.rir);
    reps0 = Math.min(MAXED_REPS, Math.max(target.reps, repsAtWeight(target.reps, target.rir, ideal, tw)));
  }
  for (let i = 0; i < target.sets; i++) {
    const ls = lastSets[i] || lastSets[lastSets.length - 1];
    const lw = ls && ls.weight != null ? ls.weight : null;
    if (target.own && target.bodyweight) {
      sets.push({ weight: '', reps: String(target.reps), rir: '', auto: true });
      continue;
    }
    if (target.deload && target.bodyweight) {
      // Deload ohne Gewicht: Wdh. aus der letzten Leistung, so dass DELOAD_RIR im Tank bleiben (je Satz −1 Ermüdung)
      const ref = bwDeloadRef(name);
      const reps = ref != null ? Math.max(MIN_REPS, ref - DELOAD_RIR - FATIGUE * i) : target.reps;
      sets.push({ weight: '', reps: String(reps), rir: '', auto: true });
      continue;
    }
    if (target.own) {
      // eigener Plan (noch nie in diesem Plan trainiert): in jedem Satz die Wdh. laut Plan, Startgewicht –
      // ohne Startgewicht das zuletzt verwendete Gewicht dieser Übung (z. B. aus einem früheren Plan)
      const ow = target.startWeight != null ? target.startWeight : lw;
      sets.push({ weight: ow != null ? fmtNum(ow) : '', reps: String(target.reps), rir: '', auto: true });
      continue;
    }
    const w = tw != null ? tw
      : lw != null && target.deload ? wSnap(lw * DELOAD_WEIGHT, target) : lw;
    if (target.deload) {
      // Deload: gleiche Wdh. in allen Sätzen, das leichtere Gewicht reicht als Entlastung
      sets.push({ weight: w != null ? fmtNum(w) : '', reps: String(target.reps), rir: '', auto: true });
      continue;
    }
    // Ziel-Wdh. gelten für Satz 1, danach je Satz 1 Wdh. weniger (Ermüdung), mind. MIN_REPS
    const p = i === 0 ? { weight: w, reps: reps0 } : planSet(reps0 + target.rir, w, target, i);
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

// Gewichtssprung der Übung im Training: kleiner Knopf, aufgeklappt die Auswahl 1,25 / 2 / 2,5 / 5 kg
const stepChip = (en, ei) => `<button class="step-chip" data-action="tr-step-open" data-ei="${ei}" aria-expanded="${!!en.stepOpen}">Steigerung:
    <b>${fmtNum(en.target.step || 2.5)} kg</b> <span aria-hidden="true">✎</span></button>`;
function stepPick(en, ei) {
  const cur = en.target.step || 2.5;
  return `<div class="step-pick">
      <div class="variants plan"><span>Steigerung</span>${STEP_OPTIONS.map(v =>
        `<button class="vchip ${cur === v ? 'on' : ''}" data-action="tr-step" data-ei="${ei}" data-v="${v}">${fmtNum(v)} kg</button>`).join('')}
      </div>
      <p class="hint">${STEP_HINT} Die Auswahl wird im Plan gespeichert und gilt auch für alle weiteren Trainings dieser Übung.</p>
    </div>`;
}

// Übung im laufenden Training gegen eine andere tauschen (Plan bleibt unverändert)
function replaceExercise(en, name, max10) {
  const original = en.replacedFrom || en.name;
  const ex = planExercise(name);
  const plan = en.plan || en.target;  // Ziel laut Plan (ohne Deload-/Intro-Anpassung)
  en.name = name;
  en.replacedFrom = nameKey(name) === nameKey(original) ? null : original;
  const variants = en.sets.map(variantOf);
  setupEntry(en, { ...plan, max10, step: stepFor(ex || { name, step: null }), weights: weightsFor(name) },
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

// Max. bei 10 Wdh. aus dem ersten normalen Satz: Wdh. + Tank = Wdh. bis zum Versagen bei diesem Gewicht
// (Tank nicht eingetragen -> Ziel-Tank der Woche)
function estimateMax10(en) {
  const first = en.sets.find(s => !s.variant);
  if (!first || !first.weight || first.reps == null) return null;
  const rir = first.rir != null ? first.rir : en.target ? en.target.rir : 0;
  return roundTo(first.weight / repFactor(first.reps + rir), 0.5);
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
  // Noch gar kein „Max. bei 10 Wdh.“ (neue Übung, z. B. im Deload): aus dem ersten Satz schätzen
  for (const en of entries) {
    if (en.result || knownMax10(en.name) != null) continue;
    const est = estimateMax10(en);
    if (est != null) setPlanMax10(en.name, est);
  }

  const session = { id: uid(), dayId: draft.dayId, dayName: draft.dayName, date: draft.date, entries };
  if (draft.deload) session.deload = true;
  else if (!prog.volume || !prog.load) session.progression = { volume: prog.volume, load: prog.load };
  if (draft.penalty) session.readiness = draft.readiness;
  if (draft.timeCut) session.timeLimit = draft.timeLimit;  // auf Zeit gekürzt (Anzeige im Verlauf)
  if (draft.cycleStart) {
    // doch trainiert: ein „ausgelassen“ dieses Tages in dieser Woche entfällt
    const sk = data.roundSkips[roundKey(draft.cycleStart, draft.week)];
    if (sk && sk.includes(draft.dayId)) {
      sk.splice(sk.indexOf(draft.dayId), 1);
      if (!sk.length) delete data.roundSkips[roundKey(draft.cycleStart, draft.week)];
    }
    Object.assign(session, { cycleStart: draft.cycleStart, week: draft.week });
    setRound(draft.cycleStart, draft.week, draft.cycleNo || data.cycle.no);  // ab jetzt gilt dieser Durchlauf
  }
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

// Als gesichert gilt erst, was wirklich geteilt bzw. heruntergeladen wurde (Abbrechen im Teilen-Menü zählt nicht)
function markExported() {
  data.lastExport = new Date().toLocaleDateString('sv-SE');  // für die Sicherungs-Erinnerung
  saveData();
}

async function exportData() {
  const json = JSON.stringify({ ...data, exportedAt: new Date().toISOString() }, null, 2);
  const filename = `training-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], filename, { type: 'application/json' });

  // iPhone: Teilen-Menü -> „In Dateien sichern“
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Trainings-Sicherung' });
      markExported();
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
  markExported();
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
      cycleShift: d.cycleShift, roundSkips: d.roundSkips, timeLimit: d.timeLimit, home: d.home, tour: d.tour, welcomeSeen: d.welcomeSeen, nutrition: d.nutrition, intake: d.intake, foodLog: d.foodLog, foods: d.foods, foodClosed: d.foodClosed, foodMeals: d.foodMeals, mcal: d.mcal, cardio: d.cardio, nutPlan: d.nutPlan,
      customExercises: d.customExercises, profile: d.profile,
    });
    registerCustomExercises();
    applyTheme();
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
  const hint = input.closest('.replace').querySelector('.rep-max-hint');
  if (hint) hint.hidden = m != null || !input.value.trim();
}

// Max. bei 10 Wdh. im Training geändert: im Plan speichern; ist noch kein Satz erledigt, Vorschlag neu berechnen
function applyTrainingMax(el) {
  const en = draft.entries[el.dataset.ei];
  const v = parseNum(el.value);
  if (!en || !en.target || v === en.target.max10) return;
  const ex = planExercise(en.name);
  if (ex) { ex.max10 = v; saveData(); }
  if (!en.sets.some(isDone) && en.plan) {
    const variants = en.sets.map(variantOf);
    setupEntry(en, { ...en.plan, max10: v }, i => variants[Math.min(i, variants.length - 1)]);
  } else {
    en.target.max10 = v;
    if (en.plan) en.plan.max10 = v;
  }
  saveDraft(); render();
}

function moveExercise(day, i, dir) {
  const j = i + dir;
  if (j < 0 || j >= day.exercises.length) return;
  [day.exercises[i], day.exercises[j]] = [day.exercises[j], day.exercises[i]];
}

const actions = {
  // Reiterwechsel: Zeitfenster und Auswahl im Diagramm zurücksetzen (Diagramme und Ernährung teilen sie sich)
  tab: el => { Object.assign(chartState, { end: null, sel: null }); go(el.dataset.tab); },
  // back: Name der Ansicht oder Funktion (params) => [Ansicht, params]
  cancel: () => {
    const c = viewCancel();
    if (c && confirm(c.ask)) c.run();
  },
  back: () => {
    const b = views[current.view].back;
    const [view, params] = typeof b === 'function' ? b(current.params) : [b, {}];
    const y = current.params.returnY;  // z. B. zurück an dieselbe Stelle im Training
    go(view, params);
    if (y != null) window.scrollTo(0, y);
  },
  lib: () => go('library'),
  'libc-new': () => { libForm = null; go('libadd', {}); },
  'libc-edit': el => { libForm = null; go('libadd', { name: el.dataset.name }); },
  'libc-cancel': () => {
    const name = libForm && libForm.orig;
    libForm = null;
    if (name) go('libex', { name }); else go('library');
  },
  'libc-group': el => { libForm.group = el.dataset.v; render(); },
  'libc-kind': el => { libForm.kind = el.dataset.v; render(); },
  'libc-save': () => {
    const f = libForm;
    const name = f.name.trim().replace(/\s+/g, ' ');
    if (!name) { alert('Bitte gib der Übung einen Namen.'); return; }
    if (!f.group) { alert('Bitte wähle die Muskelgruppe – aus ihr bekommt die Übung ihre Sätze.'); return; }
    const renamed = f.orig && nameKey(f.orig) !== nameKey(name);
    if ((!f.orig || renamed) && (builtinExercise(name) || customExercise(name))) {
      alert(`„${name}“ gibt es schon in der Bibliothek. Such sie einfach dort – oder wähle einen anderen Namen.`);
      return;
    }
    const like = (f.like || '').trim();
    const c = { name, kind: f.kind, group: f.group, like: like && builtinExercise(like) ? like : '', note: (f.note || '').trim() };
    if (f.orig) {
      const i = data.customExercises.findIndex(x => nameKey(x.name) === nameKey(f.orig));
      data.customExercises[i] = c;
      // Umbenannt: auch in allen Plänen umbenennen (der Verlauf behält den alten Namen)
      if (renamed) data.plans.forEach(p => p.days.forEach(d => d.exercises.forEach(e => {
        if (nameKey(e.name) === nameKey(f.orig)) e.name = name;
      })));
    } else data.customExercises.push(c);
    registerCustomExercises();
    saveData();
    libForm = null;
    if (like && !c.like) toast('Ähnliche Übung nicht gefunden – bitte aus den Vorschlägen wählen');
    else toast(f.orig ? 'Übung gespeichert ✔' : `${name} angelegt ✔`);
    libOpenGroups.add('own');
    go('libex', { name });
  },
  'libc-del': el => {
    const name = el.dataset.name;
    if (!confirm(`„${name}“ aus deinen eigenen Übungen löschen?\n\nIn deinen Plänen und im Verlauf bleibt sie erhalten – sie erscheint nur nicht mehr in der Bibliothek und in den Vorschlägen.`)) return;
    data.customExercises = data.customExercises.filter(c => nameKey(c.name) !== nameKey(name));
    registerCustomExercises();
    saveData();
    go('library');
  },
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
  'time-open': () => {
    const tl = data.timeLimit;
    timeEdit = { min: tl && tl.min ? String(tl.min) : '45', once: tl ? !!tl.once : true };
    render();
  },
  'time-chip': el => { timeEdit.min = el.dataset.m; render(); },
  'time-once': el => { timeEdit.once = el.dataset.v === '1'; render(); },
  'time-cancel': () => { timeEdit = null; render(); },
  'time-save': () => {
    const m = Math.round(parseNum(timeEdit.min));
    if (!(m >= 10 && m <= 240)) { alert('Bitte eine Zeit zwischen 10 und 240 Minuten eintragen.'); return; }
    data.timeLimit = { min: m, once: timeEdit.once };
    timeEdit = null;
    saveData();
    toast(`⏱ Zeitlimit ${m} min – ${data.timeLimit.once ? 'gilt für das nächste Training' : 'gilt, bis du es änderst'}`);
    render();
  },
  'time-off': () => { delete data.timeLimit; timeEdit = null; saveData(); toast('Zeitlimit aus – wieder das ganze Training'); render(); },
  'skip-open': () => {
    const ci = cycleInfo();
    skipPick = new Set(roundSkipped(ci.cycleStart, ci.week));
    render();
  },
  'skip-pick': el => { skipPick.has(el.dataset.id) ? skipPick.delete(el.dataset.id) : skipPick.add(el.dataset.id); render(); },
  'skip-cancel': () => { skipPick = null; render(); },
  'skip-save': () => {
    const ci = cycleInfo(), key = roundKey(ci.cycleStart, ci.week);
    const done = roundSessions(ci.cycleStart, ci.week);
    // diesen Durchlauf festhalten (wie beim Speichern eines Trainings) – sonst rechnet cycleInfo vom vorherigen aus
    setRound(ci.cycleStart, ci.week, ci.cycle);
    // je ausgewähltem Tag alle noch offenen Trainings dieser Woche auslassen
    const list = [];
    for (const id of skipPick) {
      const n = dayTimes(findDay(id), ci.week) - done.filter(s => s.dayId === id).length;
      for (let k = 0; k < n; k++) list.push(id);
    }
    if (list.length) data.roundSkips[key] = list; else delete data.roundSkips[key];
    skipPick = null;
    saveData();
    const now = cycleInfo();
    toast(now.cycleStart !== ci.cycleStart || now.week !== ci.week ? `Woche geschafft – weiter mit ${ciLabel(now)}`
      : list.length ? `${new Set(list).size} Tag${new Set(list).size === 1 ? '' : 'e'} ausgelassen` : 'Keine Tage ausgelassen');
    render();
  },
  'entry-week': el => go('entryweek', { ...current.params, w: el.dataset.w }),
  // Einstiegswoche des neuen Plans übernehmen (Deload „selbst bestimmen“: die erste Woche ist der Deload), dann wie gewohnt weiter
  'entry-ok': () => {
    const { id, w } = current.params;
    const ci = cycleInfo();
    if (w === 'deload' && selfDeload()) { setRound(ci.cycleStart, 1, ci.cycle); data.cycle.deloadAt = 1; }
    else setRound(ci.cycleStart, w === 'deload' ? data.cycle.buildWeeks + 1 : Number(w), ci.cycle);
    delete activePlan().askEntry;
    saveData();
    if (!askSkipRound(findDay(id))) return;
    beginAfterRound(id);
  },
  // Einfach-Modus: Gefühl eines Satzes
  'tr-feel-open': el => {
    const en = draft.entries[el.dataset.ei];
    en.feelOpen = en.feelOpen === Number(el.dataset.si) ? null : Number(el.dataset.si);
    render();
  },
  'tr-feel': el => {
    const ei = Number(el.dataset.ei), si = Number(el.dataset.si);
    const en = draft.entries[ei];
    fields['tr-rir']({ value: String(feelRir(en.target, el.dataset.f)), dataset: { ei: String(ei), si: String(si) } });
    en.feelOpen = null;
    render();
  },
  'first-max-done': () => beginQuestions(current.params.id, current.params.exIds, current.params.choice),
  // erstes Training nach einem verlängerten Zyklus: Vergleich versetzen (1) oder Woche für Woche (0)
  'cycle-choice': el => {
    const { id, from, by } = current.params;
    data.cycleShift[trainingRound(id).cycleStart] = { from, by: el.dataset.shift === '1' ? by : 0 };
    saveData();
    beginAfterRound(id, { from, by });
  },
  'check-answer': el => {
    const yes = el.dataset.answer === 'yes';
    const { id, step } = current.params;
    if (step === 1) go('check', { ...current.params, step: 2, sleptWell: yes });
    else if (currentComplaints() == null) go('check', { ...current.params, step: 3, stress: yes, areas: [] });
    else startDay(id, { sleptWell: current.params.sleptWell, stress: yes });
  },
  'check-simple': el => {
    const k = el.dataset.k;
    if (k === 'no') { go('check', { ...current.params, notOk: true }); return; }
    const sleptWell = !(k === 'sleep' || k === 'both'), stress = k === 'stress' || k === 'both';
    const { id } = current.params;
    if (currentComplaints() == null) go('check', { ...current.params, step: 3, sleptWell, stress, areas: [], notOk: false });
    else startDay(id, { sleptWell, stress });
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
    data.complaints.push({ cycleStart: trainingRound(id).cycleStart, date: new Date().toISOString(), areas });
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
  'tr-step-open': el => {
    const en = draft.entries[el.dataset.ei];
    en.stepOpen = !en.stepOpen;
    saveDraft(); render();
  },
  // Neuer Gewichtssprung: im Plan speichern; ist bei der Übung noch nichts erledigt, Vorschlag neu berechnen
  'tr-step': el => {
    const en = draft.entries[el.dataset.ei];
    const v = Number(el.dataset.v);
    const ex = planExercise(en.name);
    if (ex) { ex.step = v; saveData(); }
    en.stepOpen = false;
    if (en.target.step !== v) {
      if (!en.sets.some(isDone) && en.plan) {
        const variants = en.sets.map(variantOf);
        setupEntry(en, { ...en.plan, step: v }, i => variants[Math.min(i, variants.length - 1)]);
      } else {
        en.target.step = v;
        if (en.plan) en.plan.step = v;
      }
    }
    saveDraft(); render();
  },
  // Bandstufe: im Plan speichern; ohne erledigten Satz sofort neu rechnen, sonst gilt sie ab dem nächsten Training
  'tr-band': el => {
    const en = draft.entries[el.dataset.ei];
    const v = Number(el.dataset.v);
    const ex = planExercise(en.name);
    if (ex) { ex.band = v; saveData(); }
    if (!en.sets.some(isDone) && en.plan) {
      en.bandPick = v; en.bandNext = null;
      const variants = en.sets.map(variantOf);
      setupEntry(en, en.plan, i => variants[Math.min(i, variants.length - 1)]);
    } else en.bandNext = v === en.target.band ? null : v;
    saveDraft(); render();
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
    const missing = ownPlan() ? [] : findDay(current.params.id).exercises.filter(e => e.name.trim() && e.max10 == null && !isBodyweight(e));
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
    findDay(current.params.id).exercises.push(withDefaults(ownPlan() ? { id: uid(), name: '', sets: 3 } : { id: uid(), name: '', sets: 2, setsEnd: 3 }));
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
    } else if (input.dataset.field === 'own-name') {
      wizOwnPick(input, el.dataset.name);
    } else if (input.dataset.field === 'libc-like') {
      libForm.like = el.dataset.name;
    } else if (input.dataset.field === 'wiz-swap-name') {
      // Plan-Assistent, Ersetzen in der Vorschau: Name steht im Feld, bestätigt wird mit „Ersetzen“
    } else {
      fillReplaceMax(input);
    }
  },

  // nicht gleich ins Suchfeld springen – sonst verdeckt die Tastatur die Schnellauswahl
  'rep-open': el => {
    draft.entries.forEach((en, i) => { en.replacing = i === +el.dataset.ei && !en.replacing; });
    render();
    const panel = $view.querySelector('.replace');
    if (panel) panel.scrollIntoView({ block: 'nearest' });
  },
  // Schnellauswahl: Übung ins Feld übernehmen (bekanntes Max. dazu), bestätigt wird mit „Ersetzen“
  'rep-quick': el => {
    const panel = el.closest('.replace');
    const input = panel.querySelector('[data-field="rep-name"]');
    input.value = el.dataset.name;
    fillReplaceMax(input);
    panel.querySelectorAll('.quick-picks .vchip').forEach(b => b.classList.toggle('on', b === el));
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
      max10, step: stepFor(ex), weights: weightsFor(name),
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
  'plan-swap-open': el => { planSwap = { day: current.params.id, i: Number(el.dataset.i) }; render(); },
  'plan-swap-cancel': () => { planSwap = null; render(); },
  'plan-swap-pick': el => { if (planReplaceExercise(findDay(current.params.id), Number(el.dataset.i), el.dataset.name)) render(); },
  'plan-swap-ok': el => {
    const input = $view.querySelector(`[data-field="plan-swap-name"][data-i="${el.dataset.i}"]`);
    if (planReplaceExercise(findDay(current.params.id), Number(el.dataset.i), input && input.value)) render();
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
  // eigener Plan -> ab jetzt mit Zyklen, Deload und Steigerung der App (Tage bleiben „Frei“: Sätze × Wdh. pro Übung)
  'plan-own-off': () => {
    const p = activePlan();
    if (!confirm(`„${p.name}“ ab jetzt mit der Steigerung der App trainieren?\n\nDann gibt es Zyklen mit Intro-, Aufbau- und Deload-Woche, und die App schlägt Woche für Woche mehr Gewicht bzw. Wiederholungen vor.`)) return;
    delete p.own;
    p.progression = { volume: true, load: true };
    setRound(newCycleId(), 1, (data.cycle.no || 0) + 1);
    saveData(); render();
    toast('Steigerung eingeschaltet – es beginnt die Intro-Woche');
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
    if (!data.plans.some(x => x.id === data.activePlanId)) {
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
  'cycle-weeks': el => applyCycleLen(data.cycle.defWeeks + Number(el.dataset.delta)),
  // Laufenden Zyklus anpassen (Urlaub …): verlängern / verkürzen / beenden
  'cyc-adjust-open': () => { cycAdjustOpen = !cycAdjustOpen; cycEndAsk = false; cycLenScope = null; render(); },
  'cyc-adj': el => {
    const d = Number(el.dataset.d);
    if (el.dataset.scope === 'all') {
      // Standardlänge für alle Zyklen (4–10), gilt sofort auch für den laufenden – dessen Verlängerung/Verkürzung bleibt
      data.cycle.defWeeks = Math.min(10, Math.max(4, data.cycle.defWeeks + d));
      setCycleAdj(data.cycle.adj);
    } else setCycleAdj(data.cycle.adj + d);
    saveData(); render();
  },
  'cyc-scope': el => { cycLenScope = el.dataset.s; render(); },
  'cyc-end-ask': () => { cycEndAsk = true; render(); },
  'cyc-end-cancel': () => { cycEndAsk = false; render(); },
  'cyc-end': el => {
    const ci = cycleInfo();
    if (el.dataset.m === 'deload') {
      if (ci.deload) { toast('Die Deload-Woche läuft schon'); return; }
      if (selfDeload()) startDeloadNow();
      else {
        // Woche schon angefangen: Zyklus endet nach ihr, dann Deload – sonst Deload ab jetzt
        const trained = roundSessions(ci.cycleStart, ci.week).length > 0;
        const len = trained ? ci.week : ci.week - 1;
        data.cycle.adj = len - data.cycle.defWeeks;
        data.cycle.buildWeeks = len;
        if (!trained) setRound(ci.cycleStart, len + 1, ci.cycle);
      }
      toast(cycleInfo().deload ? 'Jetzt: Deload-Woche, danach neuer Zyklus' : 'Zyklus endet nach dieser Woche – dann kommt der Deload');
    } else if (el.dataset.m === 'newdl') {
      // neuer Zyklus, der mit der Deload-Woche beginnt (Wiedereinstieg) – danach Intro-Woche im selben Zyklus
      if (ci.deload) { toast('Die Deload-Woche läuft schon'); return; }
      data.cycle.buildWeeks = Math.max(1, ci.week - (roundSessions(ci.cycleStart, ci.week).length ? 0 : 1));
      const id = newCycleId(ci.cycleStart);
      setRound(id, 1, ci.cycle + 1);
      if (selfDeload()) data.cycle.deloadAt = 1;
      else setRound(id, data.cycle.buildWeeks + 1, ci.cycle + 1);
      data.cycle.leadDl = id;
      toast('Neuer Zyklus – es geht mit der Deload-Woche los, danach Intro');
    } else {
      // ohne Deload: sofort neuer Zyklus mit der Intro-Woche
      data.cycle.buildWeeks = Math.max(1, ci.week - (roundSessions(ci.cycleStart, ci.week).length ? 0 : 1));
      setRound(newCycleId(ci.cycleStart), 1, ci.cycle + 1);
      toast('Neuer Zyklus – es geht mit der Intro-Woche los');
    }
    cycEndAsk = false; cycAdjustOpen = false;
    saveData(); render();
  },
  // ab jetzt mit der gewählten Zykluswoche weitermachen (Intro … Deload). Vorwärts im selben Zyklus;
  // zurück (z. B. nach Krankheit) beginnt ein neuer Zyklus ab dieser Woche – verglichen wird dann mit den Zyklen davor.
  'cycle-jump': el => {
    if (el.dataset.w === 'deload') { actions['deload-now'](); return; }  // Deload „selbst bestimmen“
    const w = Number(el.dataset.w);
    const ci = cycleInfo();
    const label = selfDeload() ? weekLabel(w) : cycleWeekLabel(w);
    if (ci.week === w && !ci.deload) return;
    const started = roundSessions(ci.cycleStart, ci.week).length > 0;
    if (!confirm(`Ab jetzt mit der ${label} weitermachen?${started ? `\n\nDie Trainings, die du in der ${ciLabel(ci)} schon gemacht hast, bleiben dort gespeichert.` : ''}`)) return;
    if (w > ci.week) setRound(ci.cycleStart, w, ci.cycle);
    else setRound(newCycleId(ci.cycleStart), w, w === 1 ? ci.cycle + 1 : ci.cycle);
    delete data.cycle.deloadAt;
    saveData(); render();
    toast(`Jetzt: ${label}`);
  },
  // Deload „selbst bestimmen“: jetzt einlegen
  'deload-now': () => {
    const ci = cycleInfo();
    if (ci.deload) return;
    if (!confirm('Deload-Woche jetzt einlegen?\n\nHalbe Sätze, 15 % weniger Gewicht, mind. 3 Wdh. im Tank – jeder Trainingstag einmal. Danach beginnt ein neuer Zyklus mit der Intro-Woche.')) return;
    startDeloadNow();
    saveData(); render();
    toast('Deload-Woche eingelegt');
  },
  // Deload automatisch (nach den Trainingswochen) oder selbst bestimmen
  'plan-deload': el => {
    const p = activePlan(), mode = el.dataset.m;
    if ((p.deload || 'auto') === mode) return;
    const ci = cycleInfo();
    if (mode === 'auto' && ci.extra && !confirm(`Du bist gerade in ${weekLabel(ci.week)}, also schon nach den geplanten Trainingswochen.\n\nMit „Automatisch“ beginnt jetzt die Deload-Woche. Fortfahren?`)) return;
    const wasDeload = ci.deload;
    if (mode === 'self') p.deload = 'self'; else delete p.deload;
    if (mode === 'self' && wasDeload) { setRound(ci.cycleStart, ci.week, ci.cycle); data.cycle.deloadAt = ci.week; }  // laufender Deload bleibt
    if (mode === 'auto') {
      delete data.cycle.deloadAt;
      if (ci.extra) setRound(newCycleId(ci.cycleStart), data.cycle.buildWeeks + 1, ci.cycle);  // Deload als eigener Abschnitt
      else if (wasDeload) setRound(ci.cycleStart, data.cycle.buildWeeks + 1, ci.cycle);
    }
    saveData(); render();
  },
  // Eigengewichtsübung: Gewichtsprogression (mit Zusatzgewicht) an/aus
  'ex-bwload': el => {
    const ex = findDay(current.params.id).exercises[el.dataset.i];
    if (el.dataset.v === '1') ex.bwLoad = true; else delete ex.bwLoad;
    saveData(); render();
  },
  'plan-variant': el => {
    findDay(current.params.id).exercises[el.dataset.i].variant = el.dataset.v;
    saveData(); render();
  },
  // Ganze Übung: alle noch offenen Sätze auf die Variante stellen
  'ex-variant-open': el => {
    const en = draft.entries[el.dataset.ei];
    en.variantOpen = !en.variantOpen;
    saveDraft(); render();
  },
  'ex-variant': el => {
    const ei = +el.dataset.ei;
    const en = draft.entries[ei];
    en.variantOpen = false;
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
    const own = ownPlan();  // eigener Plan: auch unter 5 Wdh. möglich, Sätze in jeder Woche gleich
    ex[prop] = Math.min(max, Math.max(own ? 1 : min, ex[prop] + Number(el.dataset.delta)));
    if (own && prop === 'sets') ex.setsEnd = ex.sets;
    // Letzte Woche nie weniger Sätze als die Intro-Woche
    if (prop === 'sets' && ex.setsEnd < ex.sets) ex.setsEnd = ex.sets;
    if (prop === 'setsEnd' && ex.setsEnd < ex.sets) ex.setsEnd = ex.sets;
    saveData(); render();
  },

  // aus dem Verlauf oder z. B. aus der Bibliothek: „Zurück“ führt wieder dorthin
  'open-exercise': el => go('exercise', { name: el.dataset.name, from: current.view, fromParams: current.params }),
  'open-session': el => go('session', { id: el.dataset.id, week: el.dataset.week }),
  // Kalender: Monat blättern bzw. Tag antippen (nochmal antippen = abwählen)
  'cal-nav': el => {
    const st = calGet(el.dataset.k);
    const [y, m] = st.month.split('-').map(Number);
    st.month = new Date(y, m - 1 + Number(el.dataset.d), 1, 12).toLocaleDateString('sv-SE').slice(0, 7);
    st.sel = null;
    render();
  },
  'cal-pick': el => {
    const st = calGet(el.dataset.k);
    st.sel = st.sel === el.dataset.d ? null : el.dataset.d;
    render();
  },
  'del-session': el => {
    if (!confirm('Dieses Training endgültig löschen?')) return;
    data.sessions = data.sessions.filter(s => s.id !== el.dataset.id);
    saveData(); toast('Training gelöscht');
    if (current.params.week) go('week', { key: current.params.week }); else go('history');
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
  // Progression im Plan: Grundeinstellung (ganzer Zyklus) bzw. eine einzelne Woche (data-round)
  'prog-plan': el => {
    const p = activePlan(), key = el.dataset.key;
    p.progression = { ...planProgression(p), [key]: !planProgression(p)[key] };
    // Wochen, die jetzt der Grundeinstellung entsprechen, sind keine Abweichung mehr
    for (const [round, own] of Object.entries(p.weekProgression)) {
      if (own[key] === p.progression[key]) delete own[key];
      if (!Object.keys(own).length) delete p.weekProgression[round];
    }
    saveData(); render();
  },
  'prog-week': el => {
    const p = activePlan(), key = el.dataset.key, round = el.dataset.round;
    const value = !weekProgression(round)[key];
    const own = { ...(p.weekProgression[round] || {}) };
    if (value === planProgression(p)[key]) delete own[key]; else own[key] = value;  // wie Grundeinstellung -> keine Abweichung
    if (Object.keys(own).length) p.weekProgression[round] = own; else delete p.weekProgression[round];
    saveData(); render();
  },
  // Aufwärmen auf-/zuklappen (nur dieser Kasten wird neu gezeichnet, die Seite springt nicht)
  'wu-toggle': el => {
    const ei = +el.dataset.ei, en = draft.entries[ei];
    en.warmOpen = !en.warmOpen;
    saveDraft();
    const box = $view.querySelector(`[data-warm="${ei}"]`);
    if (box) box.outerHTML = warmupBlock(en, ei); else render();
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
    en.warmOpen = true;  // neuen Satz gleich zeigen
    saveDraft(); render();
  },
  'wu-del': el => {
    const en = draft.entries[el.dataset.ei];
    en.warmup.pop();
    en.warmupEdited = true;
    saveDraft(); render();
  },
  // Wochenansicht: Woche w des aktuellen Zyklus öffnen bzw. eine Woche vor/zurück blättern
  'week-open': el => go('week', { key: roundKey(cycleInfo().cycleStart, Number(el.dataset.w)) }),
  'week-shift': el => {
    const all = allRounds();
    const to = all[all.indexOf(current.params.key) + Number(el.dataset.dir)];
    if (to) go('week', { key: to }); else toast(Number(el.dataset.dir) < 0 ? 'Keine frühere Woche' : 'Keine spätere Woche');
  },
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

  export: () => exportData().then(() => render()),  // danach verschwindet die Erinnerung
  'mode-set': el => {
    data.profile = { ...(data.profile || {}), mode: el.dataset.m, modeUpSeen: el.dataset.m };
    saveData();
    toast(`Modus „${APP_MODES[el.dataset.m].label}“`);
    render();
  },
  'mode-up-no': () => { data.profile = { ...(data.profile || {}), modeUpSeen: appMode() }; saveData(); render(); },
  'backup-later': () => { data.backupSnooze = new Date().toLocaleDateString('sv-SE'); saveData(); render(); },
  import: () => document.getElementById('import-file').click(),
  'reset-trainings': () => {
    if (!confirm(`Alle ${data.sessions.length} Trainings, Körpergewicht, Schritte und Ernährungseinträge löschen?\n\nDie Trainingstage mit ihren Übungen bleiben erhalten.`)) return;
    if (!confirm('Wirklich löschen? Das lässt sich nicht rückgängig machen.')) return;
    Object.assign(data, { sessions: [], bodyweight: [], steps: [], intake: [], foodLog: [], foodClosed: {}, cardio: [], complaints: [], hintsDismissed: {}, cycleShift: {}, roundSkips: {} });
    // Max.-Werte stammen aus den gelöschten Trainings -> neu eintragen lassen
    data.plans.forEach(p => p.days.forEach(d => d.exercises.forEach(e => { e.max10 = null; })));
    setRound(todayISO(), 1, 1);
    saveData();
    draft = null; saveDraft();
    toast('Trainings gelöscht – Plan ist noch da');
    go('plan');
  },
  'reset-all': () => {
    if (!confirm('Wirklich ALLES löschen?\n\nPlan, Trainings, Körpergewicht, Schritte und Einstellungen werden entfernt.')) return;
    if (!confirm('Letzte Nachfrage: Das lässt sich nicht rückgängig machen. Fortfahren?')) return;
    data = upgradeData(emptyData());
    registerCustomExercises();
    applyTheme();
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
  // neue Übung vor dem ersten Training: gilt für alle Tage mit dieser Übung
  'first-max': el => {
    const ex = findDay(current.params.id).exercises.find(e => e.id === el.dataset.id);
    setPlanMax10(ex.name, parseNum(el.value));
    saveData();
  },
  // eigener Plan: Gewicht fürs erste Training
  'ex-start': el => {
    findDay(current.params.id).exercises[el.dataset.i].startWeight = parseNum(el.value);
    saveData();
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
  'plan-swap-name': el => showSuggestions(el),
  'add-name': el => { showSuggestions(el); fillReplaceMax(el); },
  'libc-name': el => { libForm.name = el.value; },
  'libc-note': el => { libForm.note = el.value; },
  'libc-like': el => {
    libForm.like = el.value;
    showSuggestions(el, EXERCISE_LIST.map(([n]) => n).filter(n => !customKeys.has(nameKey(n))));
  },
  'tr-max': el => { el.classList.toggle('missing', parseNum(el.value) == null); },
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
  // Regler Zykluslänge: Anzeige beim Ziehen, übernommen beim Loslassen (siehe change)
  'time-min': el => { if (timeEdit) timeEdit.min = el.value; },
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
  if (e.target.dataset && e.target.dataset.field === 'tr-max') { applyTrainingMax(e.target); return; }
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
  if (f === 'ex-name' || f === 'rep-name' || f === 'chart-name' || f === 'add-name' || f === 'wiz-add' || f === 'libc-like') {
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
/* ---------- Profil: Name, Geschlecht, Farbe ---------- */

// Farbwelten: Akzentfarbe (a = Verlauf) und Hintergrund (bg = hell, dunkel). Blau und Beere mit neutralem Grau,
// die übrigen färben auch den Hintergrund ein (CSS: :root[data-accent=…] in style.css).
const PROFILE_COLORS = {
  blue: { label: 'Blau', bg: ['#f3f4f8', '#0b0c0f'], a: ['#2563eb', '#4f46e5'] },
  berry: { label: 'Beere', bg: ['#f3f4f8', '#0b0c0f'], a: ['#d6336c', '#9c36b5'] },
  ocean: { label: 'Ozean', bg: ['#e8f0fa', '#07101d'], a: ['#0b6bcb', '#0ea5e9'] },
  rose: { label: 'Rosé', bg: ['#fbeef3', '#16090f'], a: ['#db2777', '#f43f5e'] },
  forest: { label: 'Wald', bg: ['#eaf3ec', '#07120c'], a: ['#0f8a5f', '#4d8f1f'] },
  lavender: { label: 'Lavendel', bg: ['#f2eefb', '#0f0b1a'], a: ['#7c3aed', '#c026d3'] },
  sunset: { label: 'Abendrot', bg: ['#fdf0e7', '#170c07'], a: ['#ea580c', '#e11d48'] },
  lagoon: { label: 'Lagune', bg: ['#e7f5f6', '#061315'], a: ['#0891b2', '#0d9488'] },
  sand: { label: 'Sand', bg: ['#f5efe4', '#12100b'], a: ['#b45309', '#a16207'] },
};
const profileName = () => (data.profile && data.profile.name) || '';
const profileSex = () => (data.profile && data.profile.sex) || null;
// Farbe: selbst gewählt, sonst passend zum Geschlecht (Frau: Beere, sonst Blau)
const sexColor = () => profileSex() === 'f' ? 'berry' : 'blue';
const profileColor = () => {
  const c = data.profile && data.profile.color;
  return c && PROFILE_COLORS[c] ? c : sexColor();
};

const THEME_MODES = { '': 'Automatisch', light: 'Hell', dark: 'Dunkel' };

// Farbe und Hell/Dunkel: data-accent bzw. data-theme am html-Element (ohne data-theme folgt die App dem Handy)
function applyTheme() {
  const root = document.documentElement;
  root.dataset.accent = profileColor();
  const mode = (data.profile && data.profile.theme) || '';
  if (mode) root.dataset.theme = mode; else delete root.dataset.theme;
  // Statusleiste des Handys in der Hintergrundfarbe der Farbwelt einfärben
  const [light, dark] = PROFILE_COLORS[profileColor()].bg;
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    const isDark = /dark/.test(m.getAttribute('media') || '');
    m.setAttribute('content', mode === 'dark' ? dark : mode === 'light' ? light : isDark ? dark : light);
  });
}

// Diskopumper und Booty-Plan schließen sich aus: angezeigt wird nur der passende (ohne Angabe beide)
function classicHidden(id) {
  const sex = profileSex();
  return sex === 'f' ? /^disko/.test(id) : sex === 'm' ? /^booty/.test(id) : false;
}

function greeting() {
  const name = profileName();
  if (!name) return '';
  const hour = new Date().getHours();
  const hi = hour < 5 ? 'Hallo' : hour < 11 ? 'Guten Morgen' : hour < 18 ? 'Hallo' : 'Guten Abend';
  return `<p class="greeting">${hi}, <b>${esc(name)}</b> 👋</p>`;
}

const sexButtons = (cur, action) => [['m', 'Männlich'], ['f', 'Weiblich']].map(([k, l]) =>
  `<button class="${cur === k ? 'on' : ''}" data-action="${action}" data-k="${k}">${l}</button>`).join('');

// Optionen → Aussehen: Farbwelt als Kacheln (Vorschau von Hintergrund und Akzent), dazu Hell/Dunkel
function appearanceCard() {
  const p = data.profile || {};
  const cur = profileColor();
  const tile = (k, c) => `<button class="color-opt ${cur === k ? 'on' : ''}" data-action="profile-color" data-k="${k}"
      style="--sw-bg-l:${c.bg[0]};--sw-bg-d:${c.bg[1]};--sw-a:${c.a[0]};--sw-b:${c.a[1]}"><span class="sw"><i></i></span>${c.label}</button>`;
  return `<div class="card profile-card">
      <h2>Aussehen</h2>
      <p class="lbl">Farbwelt</p>
      <div class="color-grid">${Object.entries(PROFILE_COLORS).map(([k, c]) => tile(k, c)).join('')}</div>
      <p class="lbl">Darstellung</p>
      <div class="seg three">${Object.entries(THEME_MODES).map(([k, l]) =>
        `<button class="${((p.theme || '') === k) ? 'on' : ''}" data-action="profile-theme" data-k="${k}">${l}</button>`).join('')}
      </div>
      <p class="hint">Blau und Beere haben einen neutralen grauen Hintergrund, alle anderen Farbwelten färben auch den Hintergrund ein.
        „Automatisch“ folgt der Einstellung deines Handys (hell/dunkel),
        „Hell“ und „Dunkel“ gelten immer – jede Farbwelt gibt es in beiden Varianten.</p>
    </div>`;
}

function profileCard() {
  const p = data.profile || {};
  return `<div class="card profile-card">
      <h2>Profil</h2>
      <label class="lbl">Dein Name
        <input class="inp" type="text" data-field="profile-name" autocomplete="given-name" placeholder="Vorname" value="${esc(p.name || '')}">
      </label>
      <p class="lbl">Geschlecht</p>
      <div class="seg two">${sexButtons(p.sex, 'profile-sex')}</div>
      <p class="hint">Das Geschlecht bestimmt, welcher Klassiker im Plan-Assistenten angeboten wird (Diskopumper oder Booty-Plan),
        und wird im Ernährungsrechner vorausgefüllt.</p>
    </div>`;
}

// Einmaliger Hinweis auf der Startseite: Farbwelten unter „Optionen“ (danach profile.colorHint)
function colorHintCard() {
  if (!data.profile || !data.profile.name || data.profile.colorHint) return '';
  return `<div class="card color-hint">
      <h2>🎨 Mach die App zu deiner</h2>
      <p>Im Reiter <b>„Optionen“</b> kannst du die Farbwelt der App wählen – viele davon färben auch den Hintergrund ein –
        und zwischen hell und dunkel wechseln.</p>
      <div class="row"><button class="btn primary" data-action="color-hint" data-go="1">Farben ansehen</button>
        <button class="btn" data-action="color-hint">Später</button></div>
    </div>`;
}

// Erstes Öffnen: Begrüßung in zwei Schritten – 1. Name und Geschlecht, 2. Ernährungsphase (und ob das Training angepasst wird).
// Wer die App schon nutzt, wird nur nach dem gefragt, was noch fehlt (die Phase nur einmal, „Später“ zählt als Antwort).
let welc = null;  // { step, fresh, phase: null | '' (später) | 'bulk' …, trainAdapt }

const welcomeNeedsProfile = () => !(data.profile && data.profile.name && data.profile.sex);
const welcomeNeedsPhase = () => !data.nutrition && !(data.profile && data.profile.phaseAsked);

function showWelcome() {
  if (!welcomeNeedsProfile() && !welcomeNeedsPhase()) return;
  welc = { step: welcomeNeedsProfile() ? 1 : 2, fresh: !data.welcomeSeen && !data.sessions.length, phase: null, trainAdapt: null };
  const el = document.createElement('div');
  el.className = 'welcome';
  el.innerHTML = `<div class="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcome-title">${welcomeHtml()}</div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
}

function welcomeHtml() {
  const icon = `<div class="welcome-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="4.5" y="6.5" width="3.5" height="11" rx="1.2"/>
        <rect x="16" y="6.5" width="3.5" height="11" rx="1.2"/><path d="M8 12h8M2 9.5v5M22 9.5v5"/></svg></div>`;
  const two = welcomeNeedsPhase();  // gibt es einen zweiten Schritt?
  const dots = (welc.step === 1 ? two : welcomeNeedsProfile() || welc.fresh)
    ? `<p class="welcome-step">Schritt ${welc.step} von 2</p>` : '';
  if (welc.step === 1) {
    return `${icon}${dots}
      ${welc.fresh ? `<h2 id="welcome-title">Willkommen bei StepUp Strength</h2>
      <p>Schön, dass du auf StepUp Strength aufmerksam geworden bist! Viel Spaß auf deiner Reise – nimm dir ruhig
        etwas Zeit, um dich mit den Möglichkeiten der App vertraut zu machen. 🙂</p>`
      : `<h2 id="welcome-title">Etwas persönlicher</h2>
      <p>Verrate der App kurz, wie du heißt – dann kann sie dich persönlich ansprechen und sich etwas mehr auf dich einstellen.</p>`}
      <div class="welcome-form">
        <label class="lbl">Wie heißt du?
          <input class="inp" type="text" id="welcome-name" autocomplete="given-name" placeholder="Vorname" value="${esc(profileName())}">
        </label>
        <p class="lbl">Geschlecht</p>
        <div class="seg two" id="welcome-sex">${sexButtons(profileSex(), 'welcome-sex')}</div>
        ${welc.fresh ? `<p class="lbl">Wie viel soll die App zeigen?</p>
          <div class="welcome-modes" id="welcome-mode">${Object.entries(APP_MODES).map(([k, x]) =>
            `<button class="split-opt ${welc.mode === k ? 'on' : ''}" data-action="welcome-mode" data-m="${k}"><b>${x.icon} ${x.label}</b><small>${x.text}</small></button>`).join('')}</div>
          <p class="hint welcome-note">Die Trainingssteuerung ist in allen Modi gleich – der Modus bestimmt nur, wie viele Zahlen und
            Einstellungen du siehst. Du kannst ihn jederzeit in den Optionen ändern.</p>` : ''}
      </div>
      ${two ? '' : '<p class="hint welcome-note">Du kannst beides später im Reiter „Optionen“ unter „Profil“ ändern.</p>'}
      <button class="btn primary" data-action="welcome-ok">${two ? 'Weiter' : 'Speichern'}</button>`;
  }
  const opt = (p, icon, label, text) => `<button class="split-opt cat ${welc.phase === p ? 'on' : ''}" data-action="welcome-phase" data-p="${p}">
        <span class="cat-icon">${icon}</span><b>${label}</b><small>${text}</small></button>`;
  const train = welc.phase === 'diet' || welc.phase === 'minicut'
    ? nutTrainQuestion(welc, 'welcome-train')
    : welc.phase === 'bulk' || welc.phase === 'recomp'
      ? `<p class="hint welcome-note">Im ${welc.phase === 'bulk' ? 'Aufbau' : 'Body Recomposition'} läuft dein Trainingsplan ganz normal –
          eine Anpassung ist nur in Diät und Minicut vorgesehen.</p>` : '';
  return `${icon}${dots}
      <h2 id="welcome-title">${welc.fresh || welcomeNeedsProfile() ? 'Deine Ernährungsphase' : `${esc(profileName()) ? esc(profileName()) + ', i' : 'I'}n welcher Phase bist du?`}</h2>
      <p>${welc.fresh || welcomeNeedsProfile() ? 'In welcher Phase bist du gerade?' : 'Neu in der App:'} Davon hängt ab, wie viel du essen solltest – und
        auf Wunsch passt die App in einer Diät auch deinen Trainingsplan an.</p>
      <div class="welcome-form wiz-q welcome-phases">
        ${Object.entries(NUT_PHASES).filter(([p]) => p !== 'minicut' || feat('nut-minicut')).map(([p, ph]) => opt(p, ph.icon, ph.label, ph.short)).join('')}
        ${opt('', '🕓', 'Später festlegen', 'Kein Problem – du kannst die Phase jederzeit im Reiter „Ernährung“ wählen.')}
        <details class="nut-help">${NUT_HELP}</details>
      </div>
      <div id="welcome-train">${train}</div>
      ${welc.phase ? `<p class="hint welcome-note">Dein Kalorienziel berechnet die App, sobald du im Reiter „Ernährung“ noch Alter, Größe,
        Gewicht und Aktivität ergänzt. Phase und Trainingsanpassung kannst du dort jederzeit ändern.</p>` : ''}
      ${welc.fresh ? `<ul class="welcome-tips">
        <li><b>Plan:</b> Mit dem Assistenten in wenigen Schritten deinen Trainingsplan erstellen.</li>
        <li><b>Training:</b> Trainingstag antippen und loslegen – die App schlägt Gewichte und Wiederholungen vor.</li>
        <li><b>Optionen:</b> Farbwelt und hell/dunkel wählen, Name und Geschlecht ändern – und deine Daten sichern. Alles bleibt nur auf deinem Handy, sichere es ab und zu.</li>
      </ul>` : ''}
      <button class="btn primary" data-action="welcome-done">${welc.fresh ? "Los geht's 💪" : 'Speichern'}</button>`;
}

// Inhalt neu zeichnen, Scroll-Position behalten
function welcomeRedraw(focus) {
  const card = document.querySelector('.welcome-card');
  if (!card) return;
  const top = card.scrollTop;
  card.innerHTML = welcomeHtml();
  card.scrollTop = top;
  const t = focus && card.querySelector(focus);
  if (t && t.firstElementChild) t.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function welcomeClose() {
  const box = document.querySelector('.welcome');
  welc = null;
  if (box) { box.classList.remove('show'); setTimeout(() => box.remove(), 350); }
  render();
}

actions['welcome-sex'] = el => {
  el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
  // Farbe gleich als Vorschau umstellen (nur solange noch keine gewählt ist)
  if (!(data.profile && data.profile.color)) document.documentElement.dataset.accent = el.dataset.k === 'f' ? 'berry' : 'blue';
};

actions['welcome-mode'] = el => {
  welc.mode = el.dataset.m;
  el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
};

actions['welcome-ok'] = () => {
  const box = document.querySelector('.welcome');
  if (!box) return;
  const name = box.querySelector('#welcome-name').value.trim();
  const on = box.querySelector('#welcome-sex button.on');
  if (!name) { alert('Bitte gib deinen Namen ein.'); return; }
  if (!on) { alert('Bitte wähle dein Geschlecht.'); return; }
  if (welc.fresh && !welc.mode) { alert('Bitte wähle aus, wie viel die App zeigen soll (Einfach, Standard oder Experte).'); return; }
  // Erste Farbwahl nach dem Geschlecht (Frau: Beere, sonst Blau) – danach nur noch unter „Optionen“ änderbar
  data.profile = { ...(data.profile || {}), name, sex: on.dataset.k, ...(welc.mode ? { mode: welc.mode, modeUpSeen: welc.mode } : {}),
    color: (data.profile && data.profile.color) || (on.dataset.k === 'f' ? 'berry' : 'blue') };
  if (!welcomeNeedsPhase()) data.welcomeSeen = true;
  saveData();
  applyTheme();
  if (welcomeNeedsPhase()) { welc.step = 2; welcomeRedraw(); document.querySelector('.welcome-card').scrollTop = 0; return; }
  welcomeClose();
};

actions['welcome-phase'] = el => {
  const p = el.dataset.p;
  if (welc.phase !== p) welc.trainAdapt = null;
  welc.phase = p;
  welcomeRedraw('#welcome-train');
};
actions['welcome-train'] = el => { welc.trainAdapt = el.dataset.v === '1'; welcomeRedraw(); };

actions['welcome-done'] = () => {
  if (welc.phase == null) { alert('Bitte wähle deine Phase – oder „Später festlegen“.'); return; }
  if ((welc.phase === 'diet' || welc.phase === 'minicut') && welc.trainAdapt == null && !feat('nut-train-q')) welc.trainAdapt = true;
  if ((welc.phase === 'diet' || welc.phase === 'minicut') && welc.trainAdapt == null) {
    alert('Bitte noch auswählen, ob dein Trainingsplan an die Phase angepasst werden soll.');
    return;
  }
  if (welc.phase && !data.nutrition) {
    // Nur die Phase – Alter, Größe usw. ergänzt man im Reiter „Ernährung“ (bis dahin kein Kalorienziel)
    data.nutrition = nutBeginPhase({
      sex: profileSex(), age: null, ageYear: null, height: null, bodyFat: null, activity: null,
      phase: welc.phase, pace: welc.phase === 'recomp' ? 'light' : 'normal', goalKg: null, weeks: NUT_MINICUT_MAX,
      macroPct: null, trainAdapt: welc.trainAdapt,
    }, welc.phase, nutWeight());
  }
  data.profile = { ...(data.profile || {}), phaseAsked: true };
  data.welcomeSeen = true;
  saveData();
  welcomeClose();
};

actions['profile-sex'] = el => {
  data.profile = { ...(data.profile || {}), sex: el.dataset.k };
  saveData(); applyTheme(); render();
};
actions['profile-theme'] = el => {
  data.profile = { ...(data.profile || {}), theme: el.dataset.k || null };
  saveData(); applyTheme(); render();
};
actions['profile-color'] = el => {
  data.profile = { ...(data.profile || {}), color: el.dataset.k, colorHint: true };
  saveData(); applyTheme(); render();
};
actions['color-hint'] = el => {
  data.profile = { ...(data.profile || {}), colorHint: true };
  saveData();
  if (el.dataset.go) go('data'); else render();
};
fields['profile-name'] = el => {
  data.profile = { ...(data.profile || {}), name: el.value.trim() };
  saveData();
};

/* ---------- Start ---------- */

// Erst zeichnen, wenn alle Skripte geladen sind (die Startseite nutzt z. B. nutrition.js) –
// sonst bleibt die Seite beim Öffnen leer, bis man einen Reiter antippt.
function boot() {
  applyTheme();
  registerCustomExercises();  // Übungsliste und Bibliothek um eigene Übungen ergänzen (library.js ist jetzt geladen)
  render();
  showWelcome();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else setTimeout(boot);

if ('serviceWorker' in navigator) {
  // Neue Version übernommen (neuer Service Worker hat die Kontrolle) -> einmal neu laden, damit sie sofort sichtbar ist.
  // Nicht beim allerersten Start (da gab es noch keinen Service Worker).
  if (navigator.serviceWorker.controller) {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      location.reload();
    });
  }
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
    // Installierte Apps bleiben oft im Hintergrund offen und werden nur wieder nach vorn geholt (ohne Neuladen).
    // Deshalb auch dann nach einer neuen Version schauen – höchstens alle 5 Minuten.
    let checked = Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || Date.now() - checked < 5 * 60000) return;
      checked = Date.now();
      reg.update().catch(() => {});
    });
  }).catch(() => { /* z. B. ohne HTTPS */ });
}
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().catch(() => {});
}
