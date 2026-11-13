/* LockYourGains · © 2026 Alex Hundt · Alle Rechte vorbehalten – siehe LICENSE */
'use strict';

/* ---------- Fehlerprotokoll (v205, User-Wunsch 2026-11-11) ---------- */
// Unerwartete Fehler nur auf dem Gerät merken – eigener Schlüssel, NICHT in den Daten und nicht in der Sicherung, höchstens
// ERR_MAX Einträge, ohne Trainingsdaten: Fehlertext, Stelle (nur Dateiname:Zeile), Ansicht, App-Version. Gleicher Fehler direkt
// hintereinander wird gezählt statt doppelt gespeichert. Optionen → „Fehlerprotokoll“: teilen/kopieren, löschen.
const ERR_KEY = 'trainingsapp-fehler', ERR_MAX = 30;
let errToastShown = false;
function errLoad() {
  try { const a = JSON.parse(localStorage.getItem(ERR_KEY)); return Array.isArray(a) ? a : []; } catch (e) { return []; }
}
function errLog(msg, stack) {
  try {
    const list = errLoad();
    // Fehler schon beim Laden: current/APP_V gibt es dann noch nicht (Zugriff würde selbst einen Fehler werfen)
    let view = '', ver = null;
    try { view = current ? current.view : ''; } catch (e) { view = 'Laden'; }
    try { ver = APP_V; } catch (e) { /* noch nicht da */ }
    const text = String(msg || 'Unbekannter Fehler').slice(0, 300);
    // Pfade auf den Dateinamen kürzen (keine Adressen/Ordner im Protokoll)
    const at = String(stack || '').split('\n').slice(0, 4).map(l => l.trim().replace(/[a-z-]+:\/\/[^\s)]*\/([^/\s)]+)/gi, '$1'))
      .filter(Boolean).join(' | ').slice(0, 400);
    const last = list[list.length - 1];
    if (last && last.msg === text && last.view === view) { last.n = (last.n || 1) + 1; last.t = new Date().toISOString(); }
    else list.push({ t: new Date().toISOString(), msg: text, at, view, v: ver });
    localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(-ERR_MAX)));
    if (!errToastShown && typeof toast === 'function') {
      errToastShown = true;  // nur einmal pro Sitzung Bescheid geben
      setTimeout(() => { try { toast('Da ist etwas schiefgelaufen – steht unter Optionen → Hilfe & Info'); } catch (e) { /* egal */ } }, 0);
    }
  } catch (e) { /* das Protokoll darf selbst nie stören */ }
}
window.addEventListener('error', e => {
  if (e.message) errLog(e.message, (e.error && e.error.stack) || `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`);
});
window.addEventListener('unhandledrejection', e => {
  const r = e.reason;
  errLog((r && r.message) || String(r), r && r.stack);
});

/* ---------- Speicher ---------- */
// Die Daten liegen in IndexedDB (Platz für hunderte MB). localStorage (nur ca. 5 MB) war der frühere Speicher: Dort
// liegt weiter ein Spiegel, solange er hineinpasst – als zusätzliche Sicherung und damit beim Start sofort etwas da
// ist. Umzug beim ersten Start (storeInit): kopieren, zurücklesen, vergleichen – erst wenn alles gleich ist, gilt
// IndexedDB. Ohne IndexedDB (sehr alte Browser) bleibt alles im localStorage wie früher.

const STORE_KEY = 'trainingsapp-daten';
const DRAFT_KEY = 'trainingsapp-entwurf';
const CYCLE_MAX = 12;  // längster Standard-Zyklus (Aufbauwochen); hier oben, weil upgradeData ihn schon beim Laden braucht
const STORE_MODE_KEY = 'trainingsapp-speicher';  // 'idb' = umgezogen
const LS_LIMIT = 5 * 1024 * 1024;               // ungefähre Grenze des localStorage

let data = loadData();
let draft = loadDraft();          // laufendes, noch nicht gespeichertes Training
let current = { view: 'start', params: {} };

function emptyData() {
  return { app: 'trainingsapp', version: 1, days: [], sessions: [], bodyweight: [], cycle: null };
}

function isValidData(d) {
  return d && Array.isArray(d.sessions) && (Array.isArray(d.plans) || Array.isArray(d.days));
}

// Sicherung bereinigen (v196): Kennungen, Datumsangaben und Schlüssel landen an vielen Stellen ohne Entschärfung in
// data-Attributen. Eine präparierte Datei könnte darüber Code einschleusen. Deshalb werden in solchen Feldern (und in
// allen Objektschlüsseln) die Zeichen < > " sowie Steuerzeichen entfernt – gleich bleibende Ersetzung, Verweise
// (z. B. session.dayId -> day.id) passen danach noch zusammen. Namen und Texte bleiben unverändert (esc() beim Anzeigen).
const IMPORT_ID_KEYS = /^(id|dayId|sessionId|planId|activePlanId|exId|key|code|date|start|cycleStart|exportedAt|leadDl|from|to|win|cs|src|variant|kind|group|phase|mode|theme|look|color|sex|level|equip|intensity|meal|unit|type)$/;
const importClean = s => s.replace(/[<>"\u0000-\u001f\u007f]/g, '').slice(0, 200);
function cleanImport(v, key = '', depth = 0) {
  if (depth > 12) return null;
  if (typeof v === 'string') return key && IMPORT_ID_KEYS.test(key) ? importClean(v) : v;
  if (Array.isArray(v)) return v.map(x => cleanImport(x, key === 'starts' || key === 'skips' ? 'date' : '', depth + 1));
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      const ck = importClean(k);
      if (ck) o[ck] = cleanImport(v[k], k, depth + 1);
    }
    return o;
  }
  return v;
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
  if (!Array.isArray(d.measures)) d.measures = [];      // Körpermaße (v204): [{ id, date: JJJJ-MM-TT, v: { waist, hip, … } }] in cm
  if (!Array.isArray(d.complaints)) d.complaints = [];  // [{ cycleStart, date, areas: [...], pain?, side?, note? }] (Beschwerde-Tagebuch)
  if (!Array.isArray(d.painLog)) d.painLog = [];        // „Zwickt“ im Training (v209): [{ id, date, ex, area, pain, side? }]
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
  if (!d.hintOff) d.hintOff = { all: false, ex: {}, low: {} };  // ausgeblendete Hinweise im Training (siehe bwHint)
  if (d.pauseAsked === undefined) d.pauseAsked = null;  // letztes Training, nach dem schon wegen einer Pause gefragt wurde
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
  d.cycle.defWeeks = Math.min(CYCLE_MAX, Math.max(4, d.cycle.defWeeks));
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

let storeMode = 'ls';      // 'ls' = localStorage, 'idb' = IndexedDB
let storeReady = false;    // erst nach storeInit speichern (vorher könnten noch nicht geladene Daten drüberschreiben)
let storeDb = null;

function saveData() {
  if (!storeReady) return;
  const s = JSON.stringify(data);
  if (storeMode === 'idb') {
    idbPut('data', s).catch(e => alert('Speichern fehlgeschlagen: ' + (e && e.message)));
    // Spiegel im alten Speicher, solange er passt – passt er nicht mehr, wird er entfernt (sonst wäre er veraltet)
    try { localStorage.setItem(STORE_KEY, s); } catch (e) { try { localStorage.removeItem(STORE_KEY); } catch (e2) { /* egal */ } }
    return;
  }
  try {
    localStorage.setItem(STORE_KEY, s);
  } catch (e) {
    alert('Speichern fehlgeschlagen: ' + e.message);
  }
}

// IndexedDB: eine Tabelle „kv“, die Daten als ein JSON-Text unter dem Schlüssel „data“
function idbOpen() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('trainingsapp', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('IndexedDB blockiert'));
  });
}
function idbGet(key) {
  return new Promise((res, rej) => {
    const q = storeDb.transaction('kv').objectStore('kv').get(key);
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
function idbPut(key, value) {
  return new Promise((res, rej) => {
    const tx = storeDb.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = tx.onabort = () => rej(tx.error);
  });
}

// Hängt IndexedDB (z. B. privates Fenster, Browserfehler), nicht ewig warten
const withTimeout = (p, ms = 4000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('Zeitüberschreitung')), ms))]);

// Beim Start: Daten aus IndexedDB laden bzw. einmalig dorthin umziehen
async function storeInit() {
  let block = false;
  try {
    if (!window.indexedDB) return;
    storeDb = await withTimeout(idbOpen());
    if (localStorage.getItem(STORE_MODE_KEY) === 'idb') {
      const s = await withTimeout(idbGet('data'));
      const d = s ? JSON.parse(s) : null;
      if (isValidData(d)) {
        data = upgradeData(d);
        draft = loadDraft();
        storeMode = 'idb';
        return;
      }
      // Umgezogen, aber IndexedDB leer: mit dem Spiegel weiter (und neu kopieren) – ohne Spiegel nichts überschreiben
      if (!localStorage.getItem(STORE_KEY)) {
        alert('Deine Daten wurden nicht gefunden. Bitte lade unter „Optionen“ deine letzte Sicherung.');
        return;
      }
    }
    // Umzug: kopieren, zurücklesen, Zeichen für Zeichen vergleichen – erst dann umschalten
    const s = JSON.stringify(data);
    await withTimeout(idbPut('data', s));
    if (await withTimeout(idbGet('data')) === s) {
      localStorage.setItem(STORE_MODE_KEY, 'idb');
      storeMode = 'idb';
      // Browser bitten, den Speicher nicht von sich aus zu leeren (wo unterstützt)
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    }
  } catch (e) {
    // IndexedDB geht gerade nicht: mit dem Spiegel im alten Speicher weiter (er ist immer aktuell, solange es ihn gibt) –
    // beim nächsten Start wird von dort neu umgezogen. Ohne Spiegel lieber gar nicht speichern als Leeres drüberschreiben.
    storeMode = 'ls';
    if (localStorage.getItem(STORE_MODE_KEY) === 'idb') {
      if (localStorage.getItem(STORE_KEY)) localStorage.removeItem(STORE_MODE_KEY);
      else {
        block = true;
        alert('Deine Daten konnten gerade nicht geladen werden. Bitte schließe die App und öffne sie neu – nichts wurde verändert.');
      }
    }
  } finally {
    storeReady = !block;
  }
}

// Größe der gespeicherten Daten in Byte
const dataBytes = () => new Blob([JSON.stringify(data)]).size;
const fmtMB = b => b < 100 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${fmtNum(Math.round(b / 1024 / 1024 * 10) / 10)} MB`;

// Optionen: Platzanzeige (Speicherort, belegt, frei) – die freie Menge liefert der Browser erst asynchron
const storageInfoHtml = () => `<p class="hint storage-info" id="storage-info">💾 Deine Daten: ${fmtMB(dataBytes())}${storeMode === 'idb'
  ? ' · Speicher wird geprüft …' : ` von ca. 5 MB`}</p><p class="hint persist-info" id="persist-info"></p>`;

// Optionen (v205): Hat der Browser die Daten als dauerhaft markiert (löscht sie nicht von sich aus)? Sonst Rat je Gerät
function persistAdvice() {
  if (isIOS()) return isStandalone()
    ? 'Als App auf dem Home-Bildschirm löscht das iPhone deine Daten nicht nach 7 Tagen ohne Besuch. Mach trotzdem regelmäßig eine Sicherung.'
    : 'In Safari löscht das iPhone die Daten von Websites, die 7 Tage nicht geöffnet wurden. Hol dir die App auf den Home-Bildschirm (Anleitung unten) und mach regelmäßig eine Sicherung.';
  if (isAndroid()) return 'Chrome erlaubt das meist erst, wenn die App installiert ist oder öfter benutzt wird: Menü ⋮ → „App installieren“. Mach bis dahin regelmäßig eine Sicherung.';
  return 'Der Browser darf die Daten bei Speichermangel löschen. Mach regelmäßig eine Sicherung.';
}
async function persistFill() {
  const el = document.getElementById('persist-info');
  if (!el) return;
  if (!navigator.storage || !navigator.storage.persisted) {
    el.innerHTML = 'ℹ️ Dein Browser verrät nicht, ob die Daten dauerhaft gespeichert sind – mach regelmäßig eine Sicherung.';
    return;
  }
  let on = false;
  try { on = await navigator.storage.persisted(); } catch (e) { /* unbekannt = nein */ }
  el.classList.toggle('ok', on);
  el.innerHTML = on ? '🔒 <b>Dauerhaft gespeichert:</b> Der Browser löscht deine Daten nicht von sich aus.'
    : `⚠️ <b>Nicht dauerhaft geschützt.</b> ${persistAdvice()}
      ${navigator.storage.persist ? '<button class="link-btn persist-ask" data-action="persist-ask">Erneut anfragen</button>' : ''}`;
}
async function storageInfoFill() {
  const el = document.getElementById('storage-info');
  if (!el) return;
  const used = dataBytes();
  if (storeMode !== 'idb') {
    const pct = Math.round(used / LS_LIMIT * 100);
    el.innerHTML = `💾 Deine Daten: ${fmtMB(used)} von ca. 5 MB (${pct} %)${pct >= 80
      ? ' – <b>der Speicher wird knapp.</b> Sichere deine Daten und lösche ggf. alte Trainings.' : ''}`;
    return;
  }
  let free = '';
  try {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    if (est && est.quota) {
      const left = est.quota - (est.usage || 0);
      free = left > 1024 * 1024 * 1024 ? ` · frei: mehr als ${Math.floor(left / 1024 / 1024 / 1024)} GB` : ` · frei: ${fmtMB(left)}`;
      if ((est.usage || 0) / est.quota >= 0.8) free += ' – <b>der Speicher wird knapp.</b>';
    }
  } catch (e) { /* ohne Angabe */ }
  el.innerHTML = `💾 Deine Daten: ${fmtMB(used)} · großer App-Speicher${free}`;
}

// Startseite: Warnung nur, wenn der alte Speicher (ohne Umzug) fast voll ist
function storageWarnCard() {
  if (storeMode === 'idb' || !storeReady) return '';
  const pct = Math.round(dataBytes() / LS_LIMIT * 100);
  if (pct < 80) return '';
  return `<div class="card hints"><h2>💾 Speicher fast voll (${pct} %)</h2>
    <p class="hint">Bitte sichere deine Daten (Optionen → Deine Daten → Sicherung exportieren). Wird der Speicher voll, kann ein neues Training nicht gespeichert werden.</p>
    <button class="btn" data-action="opt-open" data-sec="data">Zu den Optionen</button></div>`;
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
// Training (v200): Fortschritt, Uhr und Menü „⋯“ als zweite Zeile der Kopfleiste
const $trHead = document.createElement('div');
$trHead.id = 'tr-head';
$trHead.hidden = true;
document.querySelector('header').appendChild($trHead);
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
  'tr-rir-input': 's', 'tr-tank-target': 's', 'tr-max': 's', 'tr-step': 's', 'tr-variants': 's', 'tr-compare': 's', 'tr-sets': 's',
  'tr-add': 's', 'tr-comment': 's', 'tr-prog': 's', 'tr-next': 's', 'tr-prefat': 's',
  // Startseite & Verlauf
  'stall-hints': 's', 'week-view': 's', 'session-edit': 's', 'ex-history': 's', 'chart-detail': 'x', 'steps': 's',
  // Plan-Reiter
  'plans-multi': 's', 'plan-add-ex': 's', 'day-reprange': 's', 'ex-kind-group': 'x', 'day-free': 'x', 'day-volume': 'x',
  'plan-cycle-settings': 'x', 'plan-week-jump': 's', 'cycle-len': 's', 'cycle-adjust': 's', 'plan-week-prog': 'x', 'plan-volume': 'x', 'plan-rir': 'x', 'custom-ex': 's',
  'day-templates': 's', 'supersets': 's',
  // Ernährung
  'nut-minicut': 's', 'nut-pace': 's', 'nut-own-kcal': 's', 'nut-macros': 's', 'nut-micro': 's', 'nut-macro-pct': 'x', 'nut-protein-detail': 's',
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
const setsTonnage = sets => sets.filter(x => !x.outlier).reduce((a, x) => a + (x.weight != null && x.reps != null ? x.weight * x.reps : 0)
  + (x.subs || []).reduce((b, y) => b + (y.weight != null && y.reps != null ? y.weight * y.reps : 0), 0), 0);
const sessionTonnage = s => s.entries.reduce((sum, e) => sum + setsTonnage(e.sets), 0);

// 850 kg / 12,4 t / 1.234,5 t
const fmtTons = kg => kg >= 1000
  ? `${(Math.round(kg / 100) / 10).toLocaleString('de-DE')} t`
  : `${Math.round(kg).toLocaleString('de-DE')} kg`;

/* Ausreißer (v215, User 2026-11-12): extreme Tippfehler, die trotz Rückfrage gespeichert wurden (Komma/Null vergessen),
   bleiben sichtbar, zählen aber nicht für Vorschläge, Max., Deload, Bestleistungen und Tonnage.
   Gewicht ≥ 2,5× oder ≤ 0,4× des Vorschlags bzw. des letzten Gewichts; Wdh. ≥ 3× und mind. 15 mehr. Zu wenig Wdh. = echt. */
const OUTLIER_HI = 2.5, OUTLIER_LO = 0.4;
function setOutlier(s, ref) {
  if (!s || !ref) return false;
  if (s.weight != null && ref.weight > 0 && (s.weight >= ref.weight * OUTLIER_HI || s.weight <= ref.weight * OUTLIER_LO)) return true;
  return s.reps != null && ref.reps > 0 && s.reps >= ref.reps * 3 && s.reps >= ref.reps + 15;
}
// Bezug: Vorschlag des Satzes, sonst erster normaler Satz vom letzten Mal
function outlierRef(name, planned) {
  if (planned && (planned.weight > 0 || planned.reps > 0)) return planned;
  const last = lastEntry(name);
  return last ? ofVariant(last.sets, '')[0] || null : null;
}

function fmtSet(s) {
  const tank = (s.rir != null && feat('tr-rir-input') ? ` · Tank ${fmtNum(s.rir)}` : '') + (s.variant ? ` · ${VARIANTS[s.variant]}` : '')
    + (s.outlier ? ' · ⚠ zählt nicht (Ausreißer)' : '');
  // Teil-Sätze (v211): Reduktion „→ 65 × 8 → 52,5 × 6“, Myo „+ 4+4+3“
  const subs = !(s.subs || []).length ? '' : s.variant === 'myo' ? ` + ${s.subs.map(x => x.reps).join('+')}`
    : ' ' + s.subs.map(x => `→ ${x.weight != null ? `${fmtNum(x.weight)} × ` : ''}${x.reps}`).join(' ');
  if (s.weight == null) return `${s.reps} Wdh.${subs}${tank}`;
  if (s.reps == null) return `${fmtNum(s.weight)} kg`;
  return `${fmtNum(s.weight)} kg × ${s.reps}${subs}${tank}`;
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
    if (e) return { date: s.date, dayName: s.dayName, sets: e.sets, result: e.result, deload: !!s.deload, ss: !!e.ss };
  }
  return null;
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.timer);
  // lange Mitteilungen bleiben länger stehen (v219)
  toast.timer = setTimeout(() => { $toast.hidden = true; }, Math.min(6000, 2200 + Math.max(0, String(msg).length - 50) * 35));
}

/* ---------- Eigene Fenster statt System-Pop-ups (v219, User 2026-11-12) ----------
   alert → uiDialog (wartet nicht – danach kommt im Code meist ohnehin return). confirm → askOk: zeigt das Fenster und gibt
   erst einmal false zurück; bei „OK“ wird die Aktion (bzw. rerun) noch einmal ausgeführt, die bestätigte Frage gilt dann
   als beantwortet (askPassed). So bleibt der Code synchron. prompt → uiPrompt (async). Tests/Simulation, die window.confirm
   oder window.prompt selbst setzen, bekommen wie bisher sofort deren Antwort. */
const NATIVE_CONFIRM = window.confirm, NATIVE_PROMPT = window.prompt;
let dlgChain = Promise.resolve();
const dlgCap = s => s.charAt(0).toUpperCase() + s.slice(1);
function dlgParts(msg) {
  let text = String(msg == null ? '' : msg).trim(), ok = null, cancel = null;
  const m = text.match(/\n*OK = ([^,\n]+), Abbrechen = ([^\n]+)$/);
  if (m) { ok = dlgCap(m[1].trim()); cancel = dlgCap(m[2].trim()); text = text.slice(0, m.index).trim(); }  // „OK = so speichern, Abbrechen = zurück“
  const paras = text.split(/\n\s*\n/);
  // erster Absatz als Überschrift, wenn er kurz ist (Frage oder Satz)
  const title = paras.length > 1 && paras[0].length <= 120 ? paras.shift() : null;
  const body = paras.map(p => {
    const lines = p.split('\n');
    if (lines.every(l => /^\s*[•\-]/.test(l))) return `<ul>${lines.map(l => `<li>${esc(l.replace(/^\s*[•\-]\s*/, ''))}</li>`).join('')}</ul>`;
    return `<p>${lines.map(esc).join('<br>')}</p>`;
  }).join('');
  return { title, body, ok, cancel };
}
// opts: { msg, title, ok, cancel, danger, input: { value, type, placeholder }, choices: [{ label, value, primary, danger }] }
function uiDialog(opts) {
  const run = () => new Promise(resolve => {
    const p = dlgParts(opts.msg);
    const title = opts.title || p.title;
    const okLabel = p.ok || opts.ok || 'OK', cancelLabel = opts.cancel === false ? null : p.cancel || opts.cancel || (opts.confirm ? 'Abbrechen' : null);
    const choices = opts.choices || [...(cancelLabel ? [{ label: cancelLabel, value: opts.input ? null : false }] : []),
      { label: okLabel, value: opts.input ? '__input' : true, primary: !opts.danger, danger: !!opts.danger }];
    const back = document.createElement('div');
    back.className = 'dlg-back';
    back.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">
        ${title ? `<h2 class="dlg-title">${esc(title)}</h2>` : ''}<div class="dlg-text">${p.body}</div>
        ${opts.input ? `<input class="inp dlg-inp" type="${opts.input.type || 'text'}" autocomplete="off" value="${esc(opts.input.value || '')}" placeholder="${esc(opts.input.placeholder || '')}">` : ''}
        ${opts.copy != null ? `<textarea class="inp dlg-copy" rows="5" readonly>${esc(opts.copy)}</textarea>` : ''}
        <div class="dlg-btns${choices.length > 2 ? ' many' : ''}">${choices.map((c, i) =>
          `<button class="btn ${c.danger ? 'danger-fill' : c.primary ? 'primary' : ''}" data-dlg="${i}">${esc(c.label)}</button>`).join('')}</div>
      </div>`;
    const done = v => {
      document.removeEventListener('keydown', key, true);
      back.classList.remove('show');
      setTimeout(() => back.remove(), 180);
      resolve(v);
    };
    const pick = i => { const c = choices[i]; done(c.value === '__input' ? back.querySelector('.dlg-inp').value : c.value); };
    const key = e => {
      if (e.key === 'Escape' && cancelLabel) { e.preventDefault(); e.stopPropagation(); done(opts.input ? null : false); }
      if (e.key === 'Enter' && !e.shiftKey && !(e.target && e.target.tagName === 'TEXTAREA')) { e.preventDefault(); pick(choices.length - 1); }
    };
    back.addEventListener('click', e => {
      const b = e.target.closest('[data-dlg]');
      if (b) { e.stopPropagation(); pick(Number(b.dataset.dlg)); return; }
      if (e.target === back && cancelLabel) done(opts.input ? null : false);
    });
    document.addEventListener('keydown', key, true);
    document.body.appendChild(back);
    requestAnimationFrame(() => back.classList.add('show'));
    const f = back.querySelector('.dlg-inp') || back.querySelector('.dlg-copy');  // Knöpfe nicht vorab fokussieren (Rahmen)
    if (f) setTimeout(() => { try { f.focus(); if (f.select) f.select(); } catch (e) { /* egal */ } }, 50);
  });
  const p = dlgChain.then(run, run);
  dlgChain = p.catch(() => {});
  return p;
}
window.alert = msg => { uiDialog({ msg }); };
// Bestätigen: Knopf-Beschriftung aus dem Text („… löschen?“ → „Löschen“)
function confirmOpts(msg) {
  const t = String(msg).split(/\n\s*\n/)[0];  // nur der erste Absatz (die eigentliche Frage)
  const verb = (t.match(/(?:^|[^\wäöüß])(löschen|entfernen|verwerfen|zurücksetzen|ersetzen|beenden)(?![\wäöüß])/i) || [])[1];
  const danger = /(?:^|[^\wäöüß])(löschen|verwerfen)(?![\wäöüß])/i.test(t);
  return { msg, confirm: true, ok: verb ? dlgCap(verb.toLowerCase()) : 'Ja', danger };
}
function uiConfirm(msg) {
  if (window.confirm !== NATIVE_CONFIRM) return Promise.resolve(!!window.confirm(msg));
  return uiDialog(confirmOpts(msg));
}
let actionNow = null;      // gerade laufende Aktion (Klick) – wird nach „OK“ noch einmal ausgeführt
let askPassed = new Set(); // in dieser Wiederholung schon bestätigte Fragen
let askPending = 0;        // offene Rückfragen (bei zwei Fragen nacheinander bleibt die erste bestätigt)
function askOk(msg, rerun) {
  if (window.confirm !== NATIVE_CONFIRM) return window.confirm(msg);  // Tests/Simulation: wie bisher sofort
  if (askPassed.has(msg)) return true;
  const a = actionNow;
  const again = rerun || (a ? () => { const keep = actionNow; actionNow = a; try { actions[a.name](a.el); } finally { actionNow = keep; } } : null);
  askPending++;
  uiDialog(confirmOpts(msg)).then(ok => {
    askPending--;
    if (!ok || !again) { if (!askPending) askPassed.clear(); return; }
    askPassed.add(msg);
    try { again(); } catch (e) { console.error(e); } finally { if (!askPending) askPassed.clear(); }
  });
  return false;
}
function uiPrompt(msg, value = '', type = 'text') {
  if (window.prompt !== NATIVE_PROMPT) return Promise.resolve(window.prompt(msg, value));
  return uiDialog({ msg, confirm: true, ok: 'OK', input: { value, type } });
}
// Text zum Kopieren anbieten (wenn Teilen und Zwischenablage nicht gehen)
function uiCopy(text, msg = 'Zum Kopieren markieren und kopieren:') { return uiDialog({ msg, copy: text, ok: 'Fertig' }); }

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
    goHist('awards');
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

// Vorermüdung (User-Regel 2026-11-09): Je Arbeitssatz, der vorher im Training dieselbe Muskelgruppe getroffen hat, ist man
// 5 % schwächer, je Satz für einen Hilfsmuskel halb so viel (Hilfsmuskeln: Drücken – Trizeps, vordere Schulter; Ziehen – Bizeps,
// hintere Schulter, Lat ↔ Trapez; Beine – Gesäß …; Isolationsübungen haben keine). Höchstens 20 % (User-Regel 2026-11-09).
// Die 5 % sind der Startwert: Die App lernt den persönlichen Wert aus den eigenen Trainings (prefatLearn).
// „Max. bei 10 Wdh.“ ist der Frisch-Wert: Vorschläge = Frisch-Wert × (1 − Vorermüdung), Ergebnisse werden vor dem
// Verrechnen auf frisch umgerechnet, Vergleichstrainings von ihrer damaligen auf die heutige Vorermüdung.
const PREFAT_SET = 0.05, PREFAT_MAX = 0.2;
const PREFAT_SHOW = 0.025;  // ab hier gilt eine Übung als vorermüdet (Hinweis, Vorermüdungs-PB)
const PREFAT_HELPERS = {
  brust: ['trizeps', 'schulter_vorne'], schulter_vorne: ['trizeps'], trizeps: ['brust', 'schulter_vorne'],
  lat: ['bizeps', 'schulter_hinten', 'trapez'], trapez: ['lat', 'bizeps', 'schulter_hinten'], quadrizeps: ['gesaess'], beinbeuger: ['gesaess'], gesaess: ['beinbeuger', 'quadrizeps'],
};
const prefatEx = name => planExercise(name) || { name };
const prefatHelpers = ex => kindOf(ex) === 'assist' ? [] : PREFAT_HELPERS[groupOf(ex)] || [];
// list: [{ name, n: Arbeitssätze }] in der Reihenfolge des Trainings -> { f: Vorermüdung von Übung i, same, help, g, u }
// u = Satz-Einheiten (Hilfsmuskel halb), f = persönlicher Wert je Satz × u, höchstens PREFAT_MAX
function preFatigueUnits(list, i) {
  const x = prefatEx(list[i].name), g = groupOf(x), hx = prefatHelpers(x);
  let same = 0, help = 0;
  if (g) {
    for (let j = 0; j < i; j++) {
      const y = prefatEx(list[j].name), gy = groupOf(y), n = list[j].n || 0;
      if (!gy || !n) continue;
      if (gy === g) same += n;
      else if (hx.includes(gy) || prefatHelpers(y).includes(g)) help += n;
    }
  }
  return { same, help, g, u: same + help / 2 };
}
function preFatigueInfo(list, i) {
  const r = preFatigueUnits(list, i);
  return { ...r, f: prefatOf(r.u) };
}
const prefatOf = u => Math.min(PREFAT_MAX, Math.round(prefatRate() * u * 1000) / 1000);
const preFatigue = (list, i) => preFatigueInfo(list, i).f;
// gespeichertes Training: Satz-Einheiten je Übung aus der gespeicherten Reihenfolge (zwischengespeichert)
const prefatCache = new WeakMap();
function sessionUnits(s, i) {
  if (!s || i == null || i < 0) return 0;
  const sig = s.entries.map(e => `${e.name}:${(e.sets || []).length}`).join('|');
  let c = prefatCache.get(s);
  if (!c || c.sig !== sig) {
    const list = s.entries.map(e => ({ name: e.name, n: (e.sets || []).length }));
    c = { sig, u: list.map((_, j) => preFatigueUnits(list, j).u) };
    prefatCache.set(s, c);
  }
  return c.u[i] || 0;
}
const sessionFat = (s, i) => prefatOf(sessionUnits(s, i));

// Persönlicher Wert je Satz (User-Wunsch 2026-11-09): Dieselbe Übung an verschiedenen Stellen im Training zeigt, wie viel
// Kraft die Vorermüdung wirklich kostet. Je Übung werden Trainings verglichen, die höchstens PREFAT_GAP Tage auseinander
// liegen und sich um mindestens PREFAT_MIN_DU Satz-Einheiten unterscheiden: Leistung S = Gewicht ÷ repFactor(Wdh. + Tank)
// des ersten Satzes. Gesucht wird der Wert r (1–10 %), der alle Verhältnisse S2/S1 am besten erklärt – mit demselben Modell
// wie die Vorschläge, also mit der Obergrenze: S2/S1 = (1 − min(20 %, r·u2)) / (1 − min(20 %, r·u1)). Kleinste Quadrate
// (Streuung je Vergleich PREFAT_SD), dazu der Startwert 5 % mit Unsicherheit PREFAT_PRIOR_SD – mit wenigen Vergleichen bleibt
// es nahe 5 %. Ohne Deload, nur Sätze mit Gewicht und eingetragenem Tank.
const PREFAT_SD = 0.035, PREFAT_PRIOR_SD = 0.012, PREFAT_GAP = 21, PREFAT_MIN_DU = 2, PREFAT_RATE_MIN = 0.01, PREFAT_RATE_MAX = 0.1;
let prefatLearnCache = null;
function prefatLearn() {
  const ss = (typeof data !== 'undefined' && data && data.sessions) || [];
  const key = `${ss.length}|${ss.length ? ss[0].id + ss[ss.length - 1].id : ''}`;
  if (prefatLearnCache && prefatLearnCache.key === key) return prefatLearnCache;
  const obs = {};
  for (const s of ss) {
    if (s.deload || (s.mc && s.mc.lvl > 0)) continue;  // Zyklustage mit Beschwerden verfälschen den Vergleich
    s.entries.forEach((e, i) => {
      const x = (e.sets || []).find(z => !z.variant);
      if (!x || !(x.weight > 0) || x.reps == null || x.rir == null) return;
      const cap = x.reps + x.rir;
      if (cap < 3 || cap > 20) return;
      (obs[nameKey(e.name)] = obs[nameKey(e.name)] || []).push({ t: Date.parse(s.date), u: sessionUnits(s, i), S: x.weight / repFactor(cap) });
    });
  }
  const pairs = [];
  for (const L of Object.values(obs)) {
    L.sort((p, q) => p.t - q.t);
    for (let j = 1; j < L.length; j++) {
      for (let i = j - 1; i >= 0 && L[j].t - L[i].t <= PREFAT_GAP * 864e5; i--) {
        if (Math.abs(L[j].u - L[i].u) < PREFAT_MIN_DU) continue;
        pairs.push({ u1: L[i].u, u2: L[j].u, lq: Math.log(L[j].S / L[i].S) });
        break;  // je Training nur der nächstgelegene passende Vergleich
      }
    }
  }
  const capF = (r, u) => Math.min(PREFAT_MAX, r * u);
  const loss = r => pairs.reduce((a, p) => {
    const d = p.lq - Math.log((1 - capF(r, p.u2)) / (1 - capF(r, p.u1)));
    return a + Math.min(9, (d / PREFAT_SD) ** 2);  // Ausreißer zählen höchstens wie 3 Streuungen
  }, ((r - PREFAT_SET) / PREFAT_PRIOR_SD) ** 2);
  let rate = PREFAT_SET, best = Infinity;
  for (let r = PREFAT_RATE_MIN; r <= PREFAT_RATE_MAX + 1e-9; r += 0.0005) { const l = loss(r); if (l < best) { best = l; rate = r; } }
  // Sicherheit: wie viele Vergleiche den Wert wirklich bestimmen (welche mit Unterschied unterhalb der Obergrenze)
  const w = pairs.filter(p => Math.min(p.u1, p.u2) * rate < PREFAT_MAX - 1e-9).length;
  prefatLearnCache = { key, rate: Math.round(rate * 1000) / 1000, n: pairs.length, w };
  return prefatLearnCache;
}
const prefatRate = () => prefatLearn().rate;
const draftPrefatList = () => draft.entries.map(en => ({ name: en.name, n: en.sets.length + techExtra(en.sets) }));
// Frisch-Wert auf die heutige Vorermüdung
const effMax = t => t.max10 == null ? null : t.max10 * (1 - (t.fat || 0));
// Satz von Vorermüdung a auf b umrechnen: mit Gewicht über das Gewicht (abgerundet auf die Stufen, Wdh. passend),
// ohne Gewicht über die Wdh. (anteilig)
function condSet(s, a, b, t) {
  if (!s || s.reps == null || Math.abs((a || 0) - (b || 0)) < 1e-9) return s;
  const ratio = (1 - (b || 0)) / (1 - (a || 0));
  const rir = s.rir != null ? s.rir : t.rir != null ? t.rir : 2;
  const cap = s.reps + rir;
  if (s.weight == null || !(s.weight > 0)) return { ...s, reps: Math.max(1, Math.round(cap * ratio - rir)) };
  const exact = s.weight * ratio;
  let w = wSnap(exact, t, Math.floor);
  if (!(w > 0)) w = wSnap(exact, t, Math.ceil);
  // Leichtes Gewicht, die Stufe wäre ein Sprung über 25 %: Gewicht halten, nur die Wdh. umrechnen – sonst ginge über die
  // Umrechnung auf z. B. 2,5 kg × 30+ Wdh. Leistung verloren (repFactor endet bei 30 Wdh.; Fehler bis v182: 5 × 13 → 5 × 9)
  if (w !== s.weight && Math.abs(w - s.weight) / s.weight > 0.25) {
    const keep = Math.round(capacityAt(cap, exact, s.weight) - rir);
    if (keep >= minReps()) return { ...s, reps: keep };
  }
  return { ...s, weight: w, reps: Math.max(1, Math.round(capacityAt(cap, exact, w) - rir)) };
}
// Bezugstraining (Vergleichswoche, Vorwoche …) auf die Vorermüdung des Ziels t umrechnen; rawSets = wie damals geschafft
function condRef(ref, t) {
  if (!ref || !t || Math.abs((ref.fat || 0) - (t.fat || 0)) < 1e-9) return ref;
  return { ...ref, sets: (ref.sets || []).map(s => condSet(s, ref.fat || 0, t.fat || 0, t)), rawSets: ref.sets };
}

const DUMBBELL = /kurzhantel|konzentrationscurls|arnold press|goblet/;
const stepFor = ex => ex.step != null ? ex.step : (DUMBBELL.test(norm(ex.name)) ? 2 : 2.5);
const STEP_OPTIONS = [1.25, 2, 2.5, 5, 10];
// „Max. bei 10 Wdh.“ ist ohne Vorermüdung gemeint (User-Wunsch 2026-11-09)
const MAX_FRESH_NOTE = 'Gemeint ist frisch: so viel, wie du schaffst, wenn die Übung die erste für diese Muskelgruppe im Training ist – nicht nach anderen Übungen für denselben Muskel. Steht sie weiter hinten, zieht die App die Vorermüdung selbst ab.';
const MAX_UNKNOWN_HINT = 'Du weißt dein Max. bei 10 Wdh. nicht? Kein Problem – lass das Feld leer und taste dich mit den ersten Sätzen an ein Gewicht heran, das sich passend anfühlt. Trag ein, was du geschafft hast (Gewicht, Wdh. und Tank): Die App errechnet daraus den Wert und die weitere Steigerung.';  // wählbare Gewichtssprünge pro Übung
const STEP_HINT = 'Um so viel geht das Gewicht hoch, wenn die App mehr Gewicht vorschlägt. 1,25 kg braucht kleine Scheiben (z. B. 2 × 0,625 kg oder Mikro-Scheiben) – gut für Übungen, bei denen 2,5 kg auf einmal zu viel ist (z. B. Schulterdrücken, Seitheben). 5 kg passt z. B. zu Maschinen mit 5-kg-Stufen, 10 kg zu Maschinen mit großen Steckgewichten (z. B. Beinpresse).';

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
  const m = effMax(t);
  if (m == null) return null;
  return wSnap(m * repFactor(t.reps + t.rir), t);
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
  if (r.diff >= 1) return 'Ziel übertroffen – es geht voran';
  if (r.diff >= 0) return 'Ziel erreicht ✓';
  if (r.deload) return 'Deutlich verfehlt – die App nimmt etwas zurück';
  return 'Knapp verfehlt – die App bleibt vorsichtig';
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

// Tippfehler (User-Regel 2026-11-06): nachfragen, nichts wird geblockt. Trainingsgewicht: mehr als 10 % Unterschied zum Vorschlag
// (sonst zum letzten Mal), aber nie bei genau einer Gewichtsstufe rauf oder runter – sonst käme die Frage bei kleinen Gewichten bei jedem
// normalen Sprung. Wdh.: ab 10 Unterschied. Körpergewicht: ab 5 kg.
const TYPO_WEIGHT_PCT = 0.1, TYPO_KG = 5, TYPO_REPS = 10;
function typoInfo(en, si) {
  const s = en.sets[si];
  if (!s || s.typoOk === `${s.weight}|${s.reps}`) return null;
  const last = lastEntry(en.name);
  const ls = last && last.sets.length ? last.sets[Math.min(si, last.sets.length - 1)] : null;
  const w = parseNum(s.weight), r = parseNum(s.reps);
  const rw = parseNum(s.refW), rr = parseNum(s.refR);
  const refW = rw != null ? rw : ls && ls.weight, refR = rr != null ? rr : ls && ls.reps;
  if (s.manualWeight && w != null && refW != null && Math.abs(w - refW) > refW * TYPO_WEIGHT_PCT + 1e-9 && w !== wUp(refW, en.target) && w !== wDown(refW, en.target)) {
    return { f: 'tr-weight', text: `${fmtNum(w)} kg? ${rw != null ? 'Vorgeschlagen waren' : 'Letztes Mal waren es'} ${fmtNum(refW)} kg.` };
  }
  if (s.auto === false && r != null && refR != null && Math.abs(r - refR) >= TYPO_REPS) {
    return { f: 'tr-reps', text: `${r} Wdh.? ${rr != null ? 'Vorgeschlagen waren' : 'Letztes Mal waren es'} ${refR}.` };
  }
  return null;
}
function typoHtml(en, ei, si) {
  const t = typoInfo(en, si);
  return t ? `<span>🔎 ${t.text}</span><button class="vchip" data-action="typo-ok" data-ei="${ei}" data-si="${si}">Stimmt so</button>
    <button class="vchip" data-action="typo-fix" data-ei="${ei}" data-si="${si}" data-f="${t.f}">Korrigieren</button>` : '';
}

// Weniger Wdh. als das wird bei Übungen mit Gewicht nie vorgeschlagen
// Neulinge und Einsteiger (plan.level): nie unter 8 Wdh., Wdh.-Bereiche eher 10–12 (User-Regel 2026-11-05) – sonst 5
const MIN_REPS_BASE = 5, MIN_REPS_BEGINNER = 8;
const beginnerPlan = () => hasActivePlan() && ['neuling', 'einsteiger'].includes(activePlan().level);
const minReps = () => beginnerPlan() ? MIN_REPS_BEGINNER : MIN_REPS_BASE;

// Vorschlag für einen Satz, k Sätze nach einem Satz mit cap Wdh. bis zum Versagen bei Gewicht w.
// startWeight: Ausgangsgewicht des Satzes (z. B. aus der Vergleichswoche), sonst das Gewicht von w.
// keepWeight: Gewicht bleibt (Ziel nur knapp verfehlt) – fehlt dann höchstens 1 Wdh. zu minReps(), wird mit
// etwas weniger Tank gerechnet. Sonst wird in Steigerungsschritten reduziert, bis mindestens minReps() Wdh. passen.
function planSet(cap, w, t, k, fixedWeight, startWeight, keepWeight = false) {
  const repsAt = wt => Math.floor(capacityAt(cap, w, wt) - t.rir - FATIGUE * k + 1e-9);
  if (fixedWeight != null) return { weight: fixedWeight, reps: Math.max(minReps(), repsAt(fixedWeight)) };
  if (w == null) return { weight: null, reps: Math.max(minReps(), repsAt(null)) };  // ohne Gewicht (Eigengewicht)
  let wt = startWeight != null ? startWeight : w;
  if (!keepWeight || repsAt(wt) < minReps() - 1) {
    while (repsAt(wt) < minReps()) { const d = wDown(wt, t); if (d == null) break; wt = d; }
  }
  return { weight: wt, reps: Math.max(minReps(), repsAt(wt)) };
}

// Nie weniger als minReps() Wdh.: sonst das Gewicht so weit senken, dass minReps() mit derselben Anstrengung passen
// (Eigengewicht: mindestens minReps() – schafft man weniger, empfiehlt die App eine leichtere Variante, siehe bwHint)
function atLeastMinReps(p, t) {
  if (p.reps == null || p.reps >= minReps()) return p;
  if (p.weight == null) return t.bodyweight ? { ...p, reps: minReps() } : p;
  const step = t.step || 2.5;
  const w = wSnap(p.weight * repFactor(minReps() + t.rir) / repFactor(p.reps + t.rir), t, Math.floor);
  return { weight: Math.max(t.weights ? t.weights[0] : step, w), reps: minReps() };
}

// Satzziel laut Plan: Satz 1 = Ziel-Wdh., danach je Satz FATIGUE weniger (mind. minReps())
const goalReps = (t, i) => Math.max(minReps(), t.reps - FATIGUE * i);

// Nächste Gewichtsstufe, sobald die Leistung (cap Wdh. bis zum Versagen bei w) reicht,
// um mit w + step noch goal Wdh. mit Ziel-Tank (nach k Sätzen Ermüdung) zu schaffen.
// Großer Sprung (kleine Gewichte): es reicht 2 Wdh. unter dem Ziel, sonst liefen die Wdh. davon (User-Regel 2026-11-06);
// strict = das volle Ziel muss sicher klappen (Diät: Steigerung nur, wenn der Plan wirklich erfüllt wurde)
function stepUp(cap, w, t, k, goal, strict = false) {
  if (w == null || (!t.step && !t.weights)) return null;
  const up = wUp(w, t);
  if (up == null) return null;  // schon das schwerste vorhandene Gewicht -> weiter über die Wdh.
  const reps = Math.floor(capacityAt(cap, w, up) - t.rir - FATIGUE * k + 1e-9);
  const need = !strict && bigStep(w, up - w) ? Math.max(minReps(), goal - 2) : goal;
  return reps >= need ? { weight: up, reps } : null;
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
  const idx = en.sets.map((s, i) => isDone(s) ? i : -1).filter(i => i >= 0);
  const done = idx.map(i => parseNum(en.sets[i].rir));
  if (!done.length || !en.target) return '';
  const avg = Math.round(done.reduce((a, b) => a + b, 0) / done.length * 10) / 10;
  const t = idx.reduce((a, i) => a + rirAt(en.target, i), 0) / idx.length;  // Ziel dieser Sätze (v199: je Satz)
  const verdict = Math.abs(avg - t) <= 0.5 ? '✔ im Ziel' : avg > t ? 'leichter als geplant' : 'schwerer als geplant';
  const goal = en.target.rirSplit && !en.target.deload ? fmtNum(Math.round(t * 10) / 10) : targetRirText(en.target);
  return `Ø Tank bisher: <b>${fmtNum(avg)}</b> (Ziel ${goal}) – ${verdict}`;
}

// Bezug ist immer der letzte erledigte Satz derselben Ausführungsvariante.
function recalcSets(ei) {
  const en = draft.entries[ei];
  const t = en.target;
  markSets(ei);  // v200: Satz-Farben und Fortschritt oben sofort mitziehen
  if (!t) return;
  const avgEl = $view.querySelector(`[data-avg="${ei}"]`);
  if (avgEl) avgEl.innerHTML = avgTankText(en);
  const bwEl = $view.querySelector(`[data-bwhint="${ei}"]`);
  if (bwEl) { const html = bwHint(en); bwEl.innerHTML = html; bwEl.hidden = !html; }
  updateNextHints(ei);
  if (t.own) return;  // eigener Plan: folgende Sätze nicht anpassen
  const tt = { step: 2.5, ...t };
  let first = null, firstJ = -1, firstLast = -1, firstCap = null, firstReduced = false;
  for (let j = 0; j < en.sets.length; j++) {
    const s = en.sets[j];
    if (!s.auto || isDone(s)) continue;  // Wdh. selbst geändert oder schon erledigt -> nicht anfassen
    let last = -1;
    for (let i = j - 1; i >= 0; i--) {
      if (isDone(en.sets[i]) && variantOf(en.sets[i]) === variantOf(s)) { last = i; break; }
    }
    if (last < 0) continue;
    const ttj = tAt(tt, j);  // Tank dieses Satzes (v199)
    const done = en.sets[last];
    const cap = parseNum(done.reps) + parseNum(done.rir);
    const w = parseNum(done.weight);
    // Ausgangsgewicht: laut Vorschlag – wurde im letzten Satz über den Vorschlag hinaus gesteigert, nie darunter
    const pl = en.planned[last];
    const raised = w != null && pl && pl.weight != null && w > pl.weight;
    const start = raised && s.baseWeight != null ? Math.max(s.baseWeight, w) : s.baseWeight;
    // Abstand des letzten erledigten Satzes zu seinem Vorschlag: erst ab MISS_REPS darunter geht das Gewicht runter
    const d = setDeficit({ weight: w, reps: parseNum(done.reps), rir: parseNum(done.rir) }, en.planned[last], rirAt(t, last));
    const missedBig = d != null && d <= -MISS_REPS;
    let p = planSet(cap, w, ttj, j - last, s.manualWeight ? parseNum(s.weight) : null, start, !missedBig && !t.deload);
    // ohne Gewichtsprogression bzw. im 2. Training der Woche nie über den Vorschlag hinaus
    const capToPlan = t.hold || !!en.weekFirst;
    if (!t.deload && !capToPlan && !s.manualWeight) {
      // Genug Wdh. über dem Ziel -> nächste Gewichtsstufe für die folgenden Sätze
      const up = stepUp(cap, w, ttj, j - last, goalReps(tt, j));
      if (up && (p.weight == null || up.weight > p.weight)) p = up;
    }
    // Letzter erledigter Satz deutlich verfehlt -> Gewicht runter, damit die geplanten Wdh. wieder klappen
    let reduced = false;
    if (!t.deload && !s.manualWeight && w != null) {
      const goal = en.planned[j] && en.planned[j].reps;
      if (missedBig && goal != null) {
        p = weightForGoal(cap, w, ttj, j - last, goal);
        reduced = true;
      }
    }
    // Nie schwerer als der Satz davor (kein Zickzack, kein Sprung nach oben) – dann eben mehr Wdh. bei dessen Gewicht
    if (!s.manualWeight && p.weight != null) {
      let pw = null;
      for (let i = j - 1; i >= 0; i--) if (variantOf(en.sets[i]) === variantOf(s)) { pw = parseNum(en.sets[i].weight); break; }
      if (pw != null && p.weight > pw) p = planSet(cap, w, ttj, j - last, pw);
    }
    if (capToPlan && !s.manualWeight) {
      // nie über den Vorschlag hinaus, nur nach unten anpassen
      const pl = en.planned[j] || {};
      if (pl.weight != null && p.weight != null && p.weight > pl.weight) p = planSet(cap, w, ttj, j - last, pl.weight);
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
    if (!first) { first = p; firstJ = j; firstLast = last; firstCap = cap; firstReduced = reduced; }
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
      : `(${fmtNum(rirAt(t, firstJ))} im Tank, −${FATIGUE} Ermüdung, mind. ${minReps()} Wdh.)`);
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
// Zykluslänge: 4–5 Wochen gängig, 6–8 länger (kleinere Steigerung je Woche), 9–12 sehr lang (User-Vorgabe 2026-11-05)
function cycleLenInfo(n) {
  const build = `Intro-Woche + ${n - 1} Aufbauwochen, danach die Deload-Woche.`;
  if (n <= 5) return { tag: 'gängig', text: `${build} Der gängige Zyklus: Von Woche zu Woche wird es spürbar fordernder,
    und die Erholung kommt rechtzeitig, bevor sich zu viel Müdigkeit ansammelt. Passt für die allermeisten.` };
  if (n <= 8) return { tag: 'länger', text: `${build} Ein längerer Zyklus: Start und Höhepunkt bleiben gleich, aber der Weg dorthin
    verteilt sich auf mehr Wochen – jede Woche wird also nur ein kleineres Stück fordernder. Dafür bleibst du länger am Stück dran,
    bevor die Deload-Woche kommt.` };
  return { tag: 'sehr lang', text: `${build} Ein sehr langer Zyklus: Die Steigerung von Woche zu Woche ist nur noch klein, und die
    Erholungswoche kommt erst spät. Eher für Erfahrene, die ihren Körper gut einschätzen können – achte auf Zeichen von Ermüdung
    wie stagnierende Kraft, schlechten Schlaf oder zwickende Gelenke.` };
}

function setCycleAdj(adj) {
  const ci = cycleInfo();
  const min = ci.deload ? data.cycle.buildWeeks : Math.max(1, ci.week);
  const len = Math.min(CYCLE_MAX + 4, Math.max(min, data.cycle.defWeeks + adj));
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
// v199 (User-Wunsch 2026-11-10): generell 0,5 weniger im Tank – vorher [2, 1.5, 1, 0.5]
const RIR_PLAN = { 4: [1.5, 1, 0.5, 0] };  // Eckwerte Start … Höhepunkt (siehe curveAt)

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
// Wie hat sich der Zyklus angefühlt? (User-Regel 2026-11-08): zu schwer +0,5 Wdh. im Tank, zu leicht −0,5, passt so ±0 – für alle
// Übungen des Plans, summiert über die Zyklen (Claudes Grenze: insgesamt höchstens ±2), nie unter 0 (siehe rirRange).
// Gefragt beim ersten Deload-Training (dann spürt man die Belastung noch voll), wirksam erst ab dem nächsten Zyklus:
// plan.feelLog [{ cs: Zyklus, step }] zählt nur für spätere Zyklen. plan.rirAdj = schon verrechnete Anpassung aus v171.
const FEEL_STEP = 0.5, FEEL_MAX = 2;
function rirFeelAdj() {
  const p = activePlan();
  if (!p || !(p.rirAdj || (p.feelLog || []).length)) return 0;
  const cur = cycleInfo().cycleStart;
  let adj = p.rirAdj || 0;
  for (const e of p.feelLog || []) if (e.cs && e.cs !== cur) adj = Math.max(-FEEL_MAX, Math.min(FEEL_MAX, adj + e.step));
  return adj;
}
const COMPOUND = /^(kniebeugen|frontkniebeugen|bankdrucken[^(]*\(langhantel|kreuzheben|schulterdrucken langhantel|rudern langhantel|dips|umsetzen|reissen)/;
const ASSIST = /curls|bizeps|seitheben|frontheben|trizeps|kickbacks|stirndrucken|beinstrecker|beinbeuger|butterfly|fliegende|crossover|wadenheben|face pulls|reverse|crunches|sit-ups|beinheben|knieheben|plank|seitstutz|russian|bauchroller|rotation|holzhacker|shrugs|abduktoren|adduktoren|handgelenk|uberzuge|glute|sissy/;

// Eigengewichtsübungen: Steigerung nur über die Wdh. (kg-Spalte = Körpergewicht), kein automatisches Aufwärmen.
// ex.bwLoad = true: Gewichtsprogression trotzdem an (z. B. mit Zusatzgewicht) – dann wie eine normale Übung.
const BODYWEIGHT = /^(klimmzuge(?!.*(zusatzgewicht|assist))|dips \((brust|trizeps)\)|bankdips|liegestutze|hyperextensions \(|sissy squats|nordic|crunches( schragbank)?$|sit-ups|beinheben|knieheben|plank|seitstutz|bauchroller|burpees|glute bridge|pike-liegestutze|diamant-liegestutze|rudern umgekehrt|kniebeugen eigengewicht|einbeinige kniebeugen|bulgarian split squats ohne|ausfallschritte eigengewicht|beincurls am boden|hip thrust am sofa|seitliches beinheben|clamshells|copenhagen|wadenheben an der treppe|dead bug|superman|y-t-w|archer-|pseudo-planche|einarmige (liegestutze|klimmzuge)|klatsch-|handstand|ring-|dips an der geraden|planche|negative klimmzuge|schulterblatt-klimmzuge|muscle-ups|front lever|back lever|toter hang|shrimp|sprung-kniebeugen|wandsitzen|hollow|l-sit|toes to bar|dragon flag|scheibenwischer|burpee-weitsprunge|freier handstand|stutz halten|tuck l-sit|v-sit)/;  // v222: Calisthenics
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
  const off = KIND_OFFSET[kind || 'normal'] + rirFeelAdj();  // + Anpassung aus „Wie hat sich der Zyklus angefühlt?“
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

// Tank je Satz (v199, User-Regel 2026-11-10): immer ganze Zahlen, absteigend – der erste Satz hat nie weniger im Tank als
// der zweite. Ist das Ziel ein halber Wert (z. B. 1,5), bekommen die vorderen Sätze die höhere, die hinteren die niedrigere
// Zahl, so dass der Schnitt das Ziel ergibt; bei ungerader Satzzahl aufgerundet (3 Sätze bei 1,5 → 2 · 2 · 1).
// Ganzzahlige Ziele: alle Sätze gleich. Nur für Ziele mit t.rirSplit (ab v199) – ältere gespeicherte Trainings wurden mit
// dem Schnitt in jedem Satz geplant und werden auch so weitergerechnet. Zusätzliche Sätze über t.sets: niedrigere Zahl.
function rirAt(t, i) {
  if (!t || t.rir == null) return 2;
  const r = t.rir;
  if (!t.rirSplit) return r;
  const lo = Math.floor(r + 1e-9), hi = Math.ceil(r - 1e-9);
  if (lo === hi) return lo;
  const n = Math.max(1, t.sets || 1);
  const extra = Math.ceil((r - lo) * n - 1e-9);  // so viele Sätze bekommen die höhere Zahl
  return i < extra ? hi : lo;
}
// Ziel für Satz i: wie t, aber mit dem Tank dieses Satzes (für alle Berechnungen eines einzelnen Satzes)
const tAt = (t, i) => t && t.rirSplit ? { ...t, rir: rirAt(t, i) } : t;
// Tank je Satz als Text, z. B. „2 · 2 · 1“ (gleiche Zahl in allen Sätzen: nur die Zahl)
function rirSeqText(t, n = t.sets) {
  const seq = Array.from({ length: Math.max(1, n || 1) }, (_, i) => rirAt(t, i));
  return seq.every(x => x === seq[0]) ? fmtNum(seq[0]) : seq.map(fmtNum).join(' · ');
}

// Bestehende Pläne einmalig an die um 0,5 gesenkte Grundkurve anpassen (v199): eigene Tank-Werte aus dem Plan-Assistenten
// (plan.rirPlan) ebenfalls −0,5, nie unter 0. data.rirV merkt sich, dass das passiert ist (auch in Sicherungen).
function rirMigrate() {
  if ((data.rirV || 0) >= 1) return;
  const dn = v => Math.max(0, Math.round((v - 0.5) * 2) / 2);
  for (const p of data.plans || []) {
    for (const g of Object.keys(p.rirPlan || {})) {
      const arr = p.rirPlan[g];
      if (Array.isArray(arr)) p.rirPlan[g] = arr.map(b => Array.isArray(b) ? b.map(dn) : dn(b));
    }
  }
  data.rirV = 1;
  saveData();
}

/* Diät/Minicut mit angepasstem Training (User-Regel 2026-11-13, ersetzt „1 Wdh. weniger im Tank“):
   Tank startet in der Intro-Woche bei 2 und sinkt je Woche um 0,5 – nie unter den Wert von Woche 4 (0,5).
   Grundübungen +0,5, Assistenzübungen −0,5 (statt ±1). Neuling und Einsteiger behalten ihr Plus aus der Erfahrungsstufe,
   der Abzug für „Alter Hase“ entfällt. Eine eigene Tank-Tabelle des Plans gilt in der Diät nicht. */
const DIET_KIND_OFFSET = { compound: 0.5, normal: 0, assist: -0.5 };
function dietLevelBonus() {
  const lv = activePlan() && activePlan().level;
  const r = typeof LEVELS !== 'undefined' && LEVELS[lv] ? LEVELS[lv].rir || 0 : 0;
  return Math.max(0, r);
}
function dietRirRange(kind, week) {
  const base = Math.max(0.5, 2 - 0.5 * (Math.max(1, week) - 1)) + dietLevelBonus();
  const v = Math.max(0, base + DIET_KIND_OFFSET[kind || 'normal'] + rirFeelAdj());
  return [v, v];
}
const dietAdaptNow = () => typeof nutTrainAdapt === 'function' && nutTrainAdapt() && !ownPlan();

function weekRirText(kind, group) {
  const ci = cycleInfo();
  if (ci.deload) return `Deload – mind. ${DELOAD_RIR}`;
  if (dietAdaptNow()) return `${fmtNum(dietRirRange(kind, ci.week)[0])} (${weekLabel(ci.week)}, an die Diät angepasst)`;
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
// … für Neulinge und Einsteiger: auch Grund- und normale Übungen im Bereich 10–12, nie unter 8 (siehe minReps)
const REP_RANGES_BEGINNER = {
  heavy: { compound: [10, 12], normal: [10, 12], assist: [12, 15] },
  light: { compound: [10, 12], normal: [12, 15], assist: [12, 15] },
};
const repRanges = (beginner = beginnerPlan()) => beginner ? REP_RANGES_BEGINNER : REP_RANGES;

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
  return int ? repRanges()[int][kindOf(ex)][0] : ex.reps;
}

function repRangeText(day, ex) {
  const [lo, hi] = repRanges()[dayIntensity(day)][kindOf(ex)];
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
  return h + `<p class="hint vol-dur" data-voldur>${volDurText()}</p>
    <div class="row"><button class="btn outline" data-action="vol-reset">Standardwerte wiederherstellen</button></div></div></details>`;
}

// Hinweis unter der Volumen-Tabelle (Experte, v212): wie lange die Trainingstage damit etwa dauern – reine Info, keine Grenze.
function volDurText() {
  const p = activePlan();
  const days = p ? activeDays(p) : [];
  if (!days.length) return '';
  const bw = data.cycle.buildWeeks || 4;
  const dur = days.map(d => [Math.round(estDuration(d, 1, p)), Math.round(estDuration(d, bw, p))]);
  const list = days.map((d, i) => `<b>${esc(d.name)}</b> ca. ${dur[i][0] === dur[i][1] ? fmtDur(dur[i][1]) : `${fmtDur(dur[i][0])} → ${fmtDur(dur[i][1])}`}`).join(' · ');
  let t = `⏱ So lange dauern deine Trainingstage damit etwa (Intro → Höhepunkt): ${list}.`;
  if (p.timeMax && Math.max(...dur.map(x => x[1])) > p.timeMax * 1.1) t += ` Das ist etwas länger als die ${p.timeMax} min, die du beim Erstellen gewählt hast – die App übernimmt deine Zahlen trotzdem so.`;
  return t;
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
// half = Training an Diät/Minicut angepasst (User-Regel 2026-11-13): Intro-Woche mit dem Volumen von Woche 2 des Plans,
// Woche 2 mit dem von Woche 3, danach kein weiterer Anstieg
const dietVolWeek = w => Math.min(w + 1, 3);
function autoSetsForDay(day, week, deload, vol = data.volume, half = false) {
  const res = new Map();
  const vw = (g, w) => dayVolume(day, g, half ? dietVolWeek(w) : w, vol);
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
      sets = distributeStart(exs, vw(g, 1));
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
  const items = exs.map(ex => {
    const n = auto.has(ex.id) ? auto.get(ex.id) : deload ? deloadSets(setsForWeek(ex, bw, bw)) : setsForWeek(ex, w, bw);
    return { n, rest: REST_MIN[kindOf(ex)] || 3, extra: deload ? 0 : techPlanMin(ex, n) };  // Teil-Sätze (v211)
  });
  return seqMinutes(items, dayPairs(exs, ssOn(plan)));  // Supersätze (v210): kürzere Pausen im Wechsel
}

/* ---------- Supersätze (v210, User-Wunsch 2026-11-11) ----------
   Zwei Übungen im Wechsel: A1 → B1 → A2 → B2 …, nach jedem einzelnen Satz SS_REST Minuten Pause (statt 2–4 min je Übungsart).
   Erlaubt: Gegenspieler (Brust/Rücken, Bizeps/Trizeps …) und Muskelgruppen, die nichts miteinander zu tun haben (z. B. Bauch
   und Waden) – nie zwei aus derselben Arbeitsgruppe (SS_CLUSTERS) und keine schweren Grundübungen der Beine.
   Im Plan stehen beide Übungen direkt hintereinander und tragen denselben Schlüssel ex.ss; ex.ssRest = Pause in Minuten
   (2, nach „Pausen zu kurz“ 3). Nur Standard/Experte und nicht im eigenen Plan – sonst laufen die Übungen einzeln.
   Automatisch gekoppelt wird nur nach Rückfrage (Assistent, „Supersätze vorschlagen“, „Wenig Zeit?“) und nur, wenn es Zeit spart. */
const SS_REST = 2, SS_REST_ASSIST = 1.5;  // Pause nach jedem Satz; zwei Assistenzübungen: 90 s (User 2026-11-11)
const ssDefRest = (a, b) => kindOf(a) === 'assist' && kindOf(b) === 'assist' ? SS_REST_ASSIST : SS_REST;
const ssRestText = r => r % 1 ? `${Math.round(r * 60)} s` : `${r} min`;
const SS_CLUSTERS = [
  ['brust', 'trizeps', 'schulter_vorne'],                    // Drücken
  ['lat', 'trapez', 'bizeps', 'unterarme'],                  // Ziehen
  ['schulter_vorne', 'schulter_seite', 'schulter_hinten'],   // Schulter
  ['quadrizeps', 'gesaess', 'adduktoren'],                   // Beine vorn
  ['beinbeuger', 'gesaess', 'ruecken_unten'],                // Beine hinten
];
const SS_ANTAG = [['brust', 'lat'], ['brust', 'trapez'], ['schulter_vorne', 'lat'], ['bizeps', 'trizeps'],
  ['quadrizeps', 'beinbeuger'], ['schulter_vorne', 'schulter_hinten'], ['adduktoren', 'abduktoren']];
const SS_LEG_HEAVY = ['quadrizeps', 'beinbeuger', 'gesaess', 'ruecken_unten'];  // Grundübungen dieser Gruppen: nie im Supersatz
const ssOn = (plan = activePlan()) => feat('supersets') && !(plan && plan.own);
function ssExOk(ex) {
  const g = groupOf(ex);
  return !!g && !!MUSCLES[g] && g !== 'ganzkoerper' && g !== 'ausdauer' && !(kindOf(ex) === 'compound' && SS_LEG_HEAVY.includes(g));
}
function ssPairOk(a, b) {
  if (!ssExOk(a) || !ssExOk(b)) return false;
  const ga = groupOf(a), gb = groupOf(b);
  return ga !== gb && !SS_CLUSTERS.some(c => c.includes(ga) && c.includes(gb));
}
const ssAntag = (a, b) => { const ga = groupOf(a), gb = groupOf(b); return SS_ANTAG.some(([x, y]) => (x === ga && y === gb) || (x === gb && y === ga)); };
// Ersparnis je Runde (ein Satz A + ein Satz B) in Minuten gegenüber einzeln
const ssSaves = (a, b, rest = ssDefRest(a, b)) => Math.max(0, (REST_MIN[kindOf(a)] || 3) + (REST_MIN[kindOf(b)] || 3) - 2 * rest);
// Paare einer Übungsliste: Index → { i (A), j (B), role 'A'|'B', rest }. Gilt nur, wenn beide direkt hintereinander stehen.
function dayPairs(exs, on = ssOn()) {
  const m = new Map();
  if (!on) return m;
  for (let i = 0; i + 1 < exs.length; i++) {
    const a = exs[i], b = exs[i + 1];
    if (!a.ss || a.ss !== b.ss || !ssPairOk(a, b)) continue;
    const rest = a.ssRest || ssDefRest(a, b);
    m.set(i, { i, j: i + 1, role: 'A', rest });
    m.set(i + 1, { i, j: i + 1, role: 'B', rest });
    i++;
  }
  return m;
}
// Minuten für eine Folge: items = [{ n Sätze, rest Pause }] in Trainingsreihenfolge. Satz = 1 min + Pause; im Supersatz
// SS-Pause nach jedem Satz, solange beide Übungen noch Sätze haben; nach dem letzten Satz des Trainings keine Pause.
function seqMinutes(items, pairs = new Map()) {
  let t = 0, last = 0;
  const add = (n, rest) => { if (n > 0) { t += n * (1 + rest); last = rest; } };
  for (const x of items) t += x.n > 0 ? x.extra || 0 : 0;  // Teil-Sätze von Intensitätstechniken (v211)
  for (let i = 0; i < items.length; i++) {
    const p = pairs.get(i);
    if (p && p.role === 'A' && items[i + 1]) {
      const a = items[i], b = items[i + 1], r = Math.min(a.n, b.n);
      add(2 * r, p.rest); add(a.n - r, a.rest); add(b.n - r, b.rest);
      i++;
    } else add(items[i].n, items[i].rest);
  }
  return t - last;
}
// Paare im laufenden Training (Übungen aus dem Plan, Schlüssel en.ss; „Heute einzeln“ = draft.ssSolo)
function entryPairs(entries, withSolo = false) {
  if (!draft || draft.own || !ssOn()) return new Map();
  const solo = withSolo ? [] : draft.ssSolo || [];
  return dayPairs(entries.map(en => ({ ...(planExercise(en.name) || { name: en.name }), name: en.name,
    ss: en.ss && !solo.includes(en.ss) ? en.ss : null, ssRest: en.ssRest })));
}
const draftPairs = () => entryPairs(draft ? draft.entries : []);
// Sätze im Supersatz der Reihe nach: A1, B1, A2, B2 … (übrige Sätze der längeren Übung am Ende)
function ssOrder(p) {
  const a = draft.entries[p.i], b = draft.entries[p.j], out = [];
  for (let k = 0; k < Math.max(a.sets.length, b.sets.length); k++) {
    if (k < a.sets.length) out.push([p.i, k]);
    if (k < b.sets.length) out.push([p.j, k]);
  }
  return out;
}
const ssNext = p => ssOrder(p).find(([ei, si]) => !isDone(draft.entries[ei].sets[si])) || null;
function ssRoundText(p) {
  const nx = ssNext(p), rounds = Math.max(draft.entries[p.i].sets.length, draft.entries[p.j].sets.length);
  return `${nx ? `Runde ${nx[1] + 1} von ${rounds}` : 'erledigt ✓'} · Pause je ${ssRestText(p.rest)}`;
}
// Automatisch koppeln: zuerst Gegenspieler, dann unabhängige Muskelgruppen – nur Paare, die Zeit sparen. Jede Übung höchstens
// einmal; bestehende Paare bleiben. Liefert [[i, j], …] (Indizes in exs, i < j).
function ssAutoPairs(exs) {
  const taken = new Set();
  dayPairs(exs, true).forEach((p, i) => taken.add(i));
  const free = exs.map((e, i) => i).filter(i => (exs[i].name || '').trim() && !taken.has(i));
  const pairs = [];
  for (const anta of [true, false]) {
    for (const i of free) {
      if (taken.has(i)) continue;
      let best = null;
      for (const j of free) {
        if (j <= i || taken.has(j)) continue;
        const a = exs[i], b = exs[j];
        if (!ssPairOk(a, b) || ssAntag(a, b) !== anta || !ssSaves(a, b)) continue;
        // Reihenfolge Grund- → normale → Isolationsübung bleibt: eine Isolationsübung rückt nie vor eine größere Übung
        if (kindOf(b) === 'assist' && exs.slice(i + 1, j).some(e => kindOf(e) !== 'assist')) continue;
        if (best == null || ssSaves(a, b) > ssSaves(a, exs[best])) best = j;
      }
      if (best != null) { taken.add(i); taken.add(best); pairs.push([i, best]); }
    }
  }
  return pairs.sort((x, y) => x[0] - y[0]);
}
// Paare anwenden: Partner rückt direkt hinter die erste Übung, beide bekommen denselben Schlüssel. Liefert die neue Liste.
function ssApply(exs, pairs) {
  const partner = new Map(pairs.map(([i, j]) => [i, j])), moved = new Set(pairs.map(([, j]) => j));
  const out = [];
  exs.forEach((ex, i) => {
    if (moved.has(i)) return;
    out.push(ex);
    if (partner.has(i)) {
      const b = exs[partner.get(i)], key = uid(), rest = ssDefRest(ex, b);
      Object.assign(ex, { ss: key, ssRest: rest });
      Object.assign(b, { ss: key, ssRest: rest });
      out.push(b);
    }
  });
  return out;
}
// Schlüssel ohne direkten Partner entfernen (nach Löschen, Verschieben, Ersetzen)
function ssClean(exs) {
  const ok = dayPairs(exs, true);
  exs.forEach((ex, i) => { if (ex.ss && !ok.has(i)) { delete ex.ss; delete ex.ssRest; } });
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
  const pairs = entryPairs(entries);  // Supersätze (v210): kürzere Pausen im Wechsel
  const time = () => seqMinutes(info.map(x => ({ n: x.n, rest: x.rest, extra: techMinutes(x.en.sets.slice(0, x.n)) })), pairs);
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

// Deload: Volumen halbieren (Sätze), Gewicht −15 % (siehe deloadTarget), mindestens DELOAD_RIR im Tank.
// base = normales Ziel, damit man es beim Ersetzen der Übung neu berechnen kann.
const deloadSets = sets => Math.max(1, Math.round(sets / 2));
// Sätze pro Woche: Start in der Intro-Woche, Steigerung erst am Zyklusende –
// bei +1 nur in der letzten Woche, bei +2 in den letzten beiden Wochen je +1 usw.
// half = Training an Diät/Minicut angepasst (v229): Wert wie sonst eine Woche später, ab Woche 3 gleich
function setsForWeek(ex, week, buildWeeks, half = false) {
  const full = Math.max(0, ex.setsEnd - ex.sets);
  const w = half ? Math.min(dietVolWeek(week), buildWeeks) : week;  // Diät: wie sonst eine Woche später, ab Woche 3 gleich (v229)
  return ex.sets + Math.max(0, full - (buildWeeks - w));
}

// ref: erster normaler Satz der letzten Trainingswoche (lastWorkSet) – Bezug für Gewicht und Wdh. (User-Regel
// 2026-11-03); ohne Training mit Gewicht wie bisher aus „Max. bei 10 Wdh.“
// Bleibt das Gewicht gerundet gleich (kleine Gewichte): nächstniedrigere Stufe, wenn sie höchstens ein Drittel leichter ist –
// sonst gleiches Gewicht mit etwa einem Drittel weniger Wdh., nie unter minReps() (User-Regel 2026-11-06)
function deloadTarget(t, ref) {
  const normal = ref ? ref.weight : targetWeight(t);
  let weight = normal != null ? wSnap(normal * DELOAD_WEIGHT, t) : null;
  let reps = ref ? Math.max(minReps(), ref.reps) : t.reps;
  if (normal != null && weight >= normal - 1e-9) {
    const down = wDown(normal, t);
    if (down != null && down >= normal * 2 / 3 - 1e-9) weight = down;
    else reps = Math.max(minReps(), Math.round(reps * 2 / 3));
  }
  return {
    ...t,
    reps,
    sets: t.fixedSets ? t.sets : deloadSets(t.sets),  // automatisch verteilt: schon halbiert
    rir: Math.max(t.rir, DELOAD_RIR),
    weight,
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

// Zyklustag mit Beschwerden (session.mc.pen): als Bezug so rechnen, als wäre es ein normaler Tag gewesen – die abgezogenen
// Wdh. kommen wieder dazu, damit die Folgewoche nicht unnötig leicht wird (User-Regel 2026-11-09)
const mcBack = (sets, s) => !(s && s.mc && s.mc.pen) || !sets ? sets
  : sets.map(x => x && x.reps != null ? { ...x, reps: (typeof x.reps === 'string' ? parseNum(x.reps) : x.reps) + s.mc.pen } : x);

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
      sets: mcBack(e.sets, s), planned: mcBack(e.planned, s), target: e.target, fat: sessionFat(s, s.entries.indexOf(e)) };
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
  const sh = feat('tr-rir-input') ? cycleShift(start) : null;  // Einfach: läuft im Hintergrund, ohne Erklärtext
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
  return { date: first.date, sets: mcBack(planned.length ? planned : e.sets, first), fat: sessionFat(first, first.entries.indexOf(e)) };
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
  const d = setDeficit(ofVariant(prev.rawSets || prev.sets, v)[k], p || (k === 0 ? { reps: t.reps } : null), rirAt(t, k));
  return d != null && d <= -MISS_REPS;
}

// Gewicht, mit dem nach einer Leistung (cap Wdh. bis zum Versagen bei Gewicht w) wieder goal Wdh. mit Ziel-Tank
// (nach k Sätzen Ermüdung) klappen – in Steigerungsschritten nach unten, nie schwerer als w
function weightForGoal(cap, w, t, k, goal) {
  const repsAt = x => Math.floor(capacityAt(cap, w, x) - t.rir - FATIGUE * k + 1e-9);
  // Leichtes Gewicht (eine Stufe ist ein großer Sprung): erst die Wdh. senken, solange es höchstens 3 unter dem
  // Ziel und mind. minReps() sind – statt zwischen zwei Gewichten hin- und herzuspringen (User-Regel 2026-11-03)
  const below = wDown(w, t);
  // Wäre die nächste Stufe über 25 % leichter: Gewicht halten, Wdh. notfalls bis zur Mindestgrenze (User-Regel 2026-11-06)
  if ((below == null || (w - below) / w > 0.25) && repsAt(w) >= minReps()) return { weight: w, reps: Math.min(goal, repsAt(w)) };
  if ((below == null || bigStep(w, w - below)) && repsAt(w) >= Math.max(minReps(), goal - 3)) return { weight: w, reps: Math.min(goal, repsAt(w)) };
  let wt = w;
  while (repsAt(wt) < goal) { const d = wDown(wt, t); if (d == null) break; wt = d; }
  return { weight: wt, reps: Math.max(minReps(), Math.min(goal, repsAt(wt))) };
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
const VARIANTS = { '': 'Normal', pause: 'mit Pause', slow: 'langsam', drop: 'Reduktion', myo: 'Myo' };
const VARIANT_SHORT = { pause: 'P', slow: 'L', drop: 'R', myo: 'M' };
const EXEC_VARIANTS = { '': 'Normal', pause: 'mit Pause', slow: 'langsam' };  // Ausführung im Plan (Techniken extra)
const variantOf = s => (s && s.variant) || '';
// v215: als Ausreißer markierte Sätze (s.outlier) zählen bei keinem Vergleich mit
const ofVariant = (sets, v) => (sets || []).filter(s => variantOf(s) === v && !s.outlier);

/* ---------- Intensitätstechniken (v211, User-Wunsch 2026-11-11) ----------
   Reduktionssatz (drop) und Myo-Satz (myo) sind Ausführungen eines Satzes wie „langsam“: Der Hauptsatz behält seine Vorgabe
   und wird nur mit Sätzen derselben Technik verglichen. Daran hängen Teil-Sätze s.subs = [{ weight, reps }]:
   Reduktion = 1–2 Stufen ohne Pause, je etwa 20 % leichter, bis knapp vors Versagen; Myo = 3–5 Mini-Sätze mit demselben
   Gewicht, je 3–5 Wdh. nach 20 s (3–5 Atemzüge). Die App plant Techniken nie selbst: Plan/Assistent (ex.tech =
   { k, at: 'last'|'all', n }) gilt dauerhaft mit Steigerung, sonst nur im einzelnen Training. Nicht im Deload, nicht im
   Modus Einfach. Vorermüdung: Reduktion zählt wie 1,5 Sätze, Myo wie 2 Sätze (User-Regel 2026-11-11). */
const TECHS = { drop: 'Reduktionssatz', myo: 'Myo-Satz' };
const isTech = v => v === 'drop' || v === 'myo';
const TECH_N = { drop: [1, 2], myo: [3, 4, 5] }, TECH_DEF_N = { drop: 1, myo: 4 };
const TECH_FAT = { drop: 0.5, myo: 1 };    // zusätzliche Satz-Einheiten für die Vorermüdung
const TECH_MIN = { drop: 1, myo: 0.5 };    // Minuten je Teil-Satz (Dauer-Schätzung)
const DROP_FACTOR = 0.8, MYO_REST_S = 20, MYO_MIN = 3, MYO_MAX = 5, MYO_FIRST = 4;
const techOn = () => feat('tr-variants');
// Technik eines Satzes laut Plan (i = Satz, n = Sätze heute)
const techVariant = (ex, i, n) => {
  const t = ex.tech;
  return t && TECHS[t.k] && techOn() && !(draft && draft.deload) && (t.at === 'all' || i === n - 1) ? t.k : ex.variant || '';
};
const techExtra = sets => (sets || []).reduce((a, s) => a + (TECH_FAT[variantOf(s)] || 0), 0);
const techMinutes = sets => (sets || []).reduce((a, s) => a + (TECH_MIN[variantOf(s)] || 0) * ((s.subs || []).length || 0), 0);
// Plan: zusätzliche Vorermüdung bzw. Minuten einer Übung mit n Sätzen
const techPlanCount = (ex, n) => !ex.tech || !TECHS[ex.tech.k] || !techOn() || !n ? 0 : ex.tech.at === 'all' ? n : 1;
const techPlanFat = (ex, n) => techPlanCount(ex, n) * TECH_FAT[(ex.tech || {}).k] || 0;
const techPlanMin = (ex, n) => techPlanCount(ex, n) * (TECH_MIN[(ex.tech || {}).k] || 0) * ((ex.tech || {}).n || 0) || 0;
const subDone = x => x && x.reps !== '' && x.reps != null;
// k-ter Satz dieser Technik im letzten Training mit der Übung, das sie enthält (mit Teil-Sätzen)
function lastTechSet(name, v, k) {
  const key = nameKey(name);
  for (const s of sessionsNewestFirst()) {
    const e = s.entries.find(x => nameKey(x.name) === key);
    const list = e ? e.sets.filter(x => variantOf(x) === v) : [];
    if (list.length) return list[Math.min(k, list.length - 1)];
  }
  return null;
}
// Reduktion: nächstleichteres Gewicht (etwa −20 %, auf die Steigerungsstufe bzw. vorhandene Gewichte gerundet)
function dropWeight(w, t) {
  if (w == null) return null;
  let x = wSnap(w * DROP_FACTOR, t || {}, Math.floor);
  if (!(x < w - 1e-9)) x = wDown(w, t || {});
  return x != null && x > 0 ? x : null;
}
// Teil-Sätze vorschlagen. Steigerung (wenn im Training an): Reduktion = Wdh. vom letzten Mal +1 (anderes Gewicht: umgerechnet),
// Myo = insgesamt +1 Wdh. (beim schwächsten Mini-Satz), bis jeder Mini-Satz MYO_MAX hat – danach steigt das Gewicht über den
// Aktivierungssatz. Schwerer als letztes Mal: Mini-Sätze je 1 Wdh. weniger (mind. MYO_MIN).
function techSubs(en, i, v, set) {
  const ex = planExercise(en.name) || {};
  const k = en.sets.slice(0, i).filter(s => variantOf(s) === v).length;
  const last = lastTechSet(en.name, v, k), lastSubs = (last && last.subs) || [];
  const n = (ex.tech && ex.tech.k === v && ex.tech.n) || lastSubs.length || TECH_DEF_N[v];
  const t = en.target || {}, hold = !!t.hold || !!t.own;
  const w0 = parseNum(set.weight);
  if (v === 'drop') {
    const out = [];
    let w = w0;
    for (let j = 0; j < n; j++) {
      w = w != null ? dropWeight(w, t) : null;
      const ls = lastSubs[j];
      let reps = '';
      if (ls && ls.reps != null) {
        const same = ls.weight == null || w == null || Math.abs(ls.weight - w) < 1e-9;
        reps = String(hold ? ls.reps : same ? ls.reps + 1 : Math.max(1, repsAtWeight(ls.reps, 0, ls.weight, w)));
      }
      out.push({ weight: '', reps: '', goal: reps });  // Gewicht folgt dem Hauptsatz (subWeight), Wdh. trägt man ein
    }
    return out;
  }
  let reps = Array.from({ length: n }, (_, j) => lastSubs[j] && lastSubs[j].reps != null ? lastSubs[j].reps : MYO_FIRST);
  if (lastSubs.length && !hold) {
    const heavier = w0 != null && last.weight != null && w0 > last.weight + 1e-9;
    if (heavier) reps = reps.map(r => Math.max(MYO_MIN, r - 1));
    else {
      const lo = Math.min(...reps);
      if (lo < MYO_MAX) reps[reps.indexOf(lo)] = lo + 1;
    }
  }
  return reps.map(r => ({ weight: '', reps: '', goal: String(Math.min(MYO_MAX, r)) }));
}
// Gewicht eines Teil-Satzes: selbst eingetragen, sonst aus dem Hauptsatz abgeleitet (Myo: immer das Gewicht des Hauptsatzes)
function subWeight(en, si, j) {
  const s = en.sets[si], v = variantOf(s), main = parseNum(s.weight);
  if (v === 'myo') return main;
  let w = main;
  for (let x = 0; x <= j; x++) {
    const sub = s.subs[x];
    w = sub && sub.wTouched && parseNum(sub.weight) != null ? parseNum(sub.weight) : dropWeight(w, en.target);
  }
  return w;
}
// Technik am Satz setzen bzw. entfernen
function techEnsure(en, i) {
  const s = en.sets[i], v = variantOf(s);
  if (!isTech(v)) { delete s.subs; return; }
  if (!s.subs || s.subVariant !== v) { s.subs = techSubs(en, i, v, s); s.subVariant = v; }
}
// Erklärungen (User-Wunsch: ausführlich – was, warum, wann sinnvoll, wann nicht)
const TECH_INFO = {
  drop: {
    what: 'Du trainierst den Satz bis kurz vor das Muskelversagen, nimmst sofort etwa 20 % Gewicht weg und machst ohne Pause weiter – ein- bis zweimal, jeweils wieder bis kurz vors Versagen.',
    why: 'Du sammelst in sehr kurzer Zeit zusätzliche Wiederholungen nahe am Versagen – genau die zählen für den Muskelaufbau. Ein Reduktionssatz bringt ungefähr so viel Reiz wie zwei normale Sätze, dauert aber nur ein bis zwei Minuten statt fünf bis acht.',
    when: 'Wenn die Zeit knapp ist und du trotzdem genug Reiz setzen willst. Am besten bei Maschinen, am Kabelzug oder mit Kurzhanteln, wo das Gewicht in Sekunden umgesteckt ist – und im letzten Satz einer Übung.',
    not: 'Nicht bei schweren Grundübungen wie Kniebeuge, Kreuzheben oder Bankdrücken mit der Langhantel: Die Technik leidet, das Verletzungsrisiko steigt. Nicht, solange du die Bewegung noch lernst, nicht im Deload – und nicht bei jeder Übung: Die Ermüdung steigt deutlich, die Erholung dauert länger.',
    app: 'Der Hauptsatz behält seine Vorgabe und wird nur mit Reduktionssätzen verglichen. Für jede Stufe schlägt die App etwa 20 % weniger Gewicht vor, als Ziel die Wiederholungen vom letzten Mal plus eine. Zwischen den Stufen läuft keine Pause. Für die Vorermüdung zählt ein Reduktionssatz wie 1,5 Sätze.',
  },
  myo: {
    what: 'Ein Aktivierungssatz bis kurz vors Muskelversagen, dann nur 3–5 Atemzüge Pause (etwa 20 Sekunden) und ein Mini-Satz mit 3–5 Wiederholungen – mit demselben Gewicht. Das wiederholst du drei- bis fünfmal.',
    why: 'Nach dem Aktivierungssatz arbeitet der Muskel schon mit allen Fasern – jede Wiederholung der Mini-Sätze ist deshalb eine besonders wirksame. Ein Myo-Satz bringt ungefähr so viel Reiz wie zwei bis drei normale Sätze, in zwei bis drei Minuten statt zehn bis zwölf.',
    warn: '<b>Wichtig:</b> Ein Myo-Satz bringt deutlich mehr Reiz – aber auch deutlich mehr Ermüdung als ein normaler Satz. Setz ihn bewusst ein, eher für einzelne Übungen und eher zusätzlich zu wenigen normalen Sätzen statt zu vielen.',
    when: 'Wenn die Zeit knapp ist. Gut bei Isolations- und Maschinenübungen mit mittleren bis höheren Wiederholungen (Aktivierungssatz etwa 12–20 Wdh.), z. B. Seitheben, Beinstrecker, Curls oder Kabelübungen.',
    not: 'Nicht bei schweren Grundübungen und niedrigen Wiederholungen, nicht, solange du die Technik noch lernst, nicht im Deload und nicht bei jeder Übung eines Trainings.',
    app: 'Der Aktivierungssatz ist der Hauptsatz: Er behält seine Vorgabe und wird nur mit Myo-Sätzen verglichen. Die Mini-Sätze haben dasselbe Gewicht, Ziel 3–5 Wiederholungen. Steigerung: insgesamt eine Wiederholung mehr als letztes Mal, bis jeder Mini-Satz 5 hat – danach steigt das Gewicht über den Aktivierungssatz. Zwischen den Mini-Sätzen läuft ein 20-Sekunden-Timer. Für die Vorermüdung zählt ein Myo-Satz wie 2 Sätze.',
  },
};
function techInfoHtml(k, open = false) {
  const x = TECH_INFO[k];
  if (!x) return '';
  return `<details class="tech-info"${open ? ' open' : ''}><summary>ⓘ ${TECHS[k]} – was ist das, und wann lohnt er sich?</summary>
    <p><b>So geht’s:</b> ${x.what}</p><p><b>Warum:</b> ${x.why}</p>${x.warn ? `<p class="tech-warn">⚠️ ${x.warn}</p>` : ''}
    <p><b>Sinnvoll:</b> ${x.when}</p><p><b>Eher nicht:</b> ${x.not}</p><p><b>So rechnet die App:</b> ${x.app}</p></details>`;
}
// Schwere Grundübung? (Hinweis im Plan, wenn dort eine Technik eingestellt ist)
const techRisky = ex => kindOf(ex) === 'compound';
// Teil-Satz-Zeilen im Training (im Satz-Raster unter dem Hauptsatz): Reduktion mit Gewicht, Myo mit dem Gewicht des Hauptsatzes
function techRowsHtml(en, ei, si) {
  const s = en.sets[si], v = variantOf(s);
  if (!isTech(v) || !s.subs) return '';
  const drop = v === 'drop', at = `data-ei="${ei}" data-si="${si}"`;
  let h = s.subs.map((x, j) => {
    const w = subWeight(en, si, j);
    return `<span class="subno ${v}" aria-label="${drop ? `Reduktion ${j + 1}` : `Mini-Satz ${j + 1}`}">${drop ? '↘' : 'M'}${j + 1}</span>
      ${drop ? `<input type="text" inputmode="decimal" autocomplete="off" class="sub-in ${x.wTouched ? '' : 'prop'}" data-field="tr-sub-w" ${at} data-j="${j}"
          value="${x.wTouched ? esc(x.weight) : w != null ? fmtNum(w) : ''}" placeholder="kg">`
        : `<span class="sub-kg" data-subkg="${ei}-${si}-${j}">${w != null ? `${fmtNum(w)} kg` : '–'}</span>`}
      <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" class="sub-in ${subDone(x) ? 'done' : ''}" data-field="tr-sub-r" ${at} data-j="${j}"
        value="${esc(x.reps)}" placeholder="${x.goal || (drop ? 'max' : '3–5')}">
      <button class="sub-del" data-action="sub-del" ${at} data-j="${j}" aria-label="Teil-Satz entfernen">✕</button>`;
  }).join('');
  const more = s.subs.length < Math.max(...TECH_N[v]);
  h += `<div class="sub-foot">${more ? `<button class="btn small outline" data-action="sub-add" ${at}>+ ${drop ? 'Reduktion' : 'Mini-Satz'}</button>` : ''}
    <small>${drop ? 'Ohne Pause weiter, je ca. 20 % leichter – bis knapp vors Versagen.' : `Je ${MYO_REST_S} s Pause (3–5 Atemzüge), 3–5 Wdh. – bis knapp vors Versagen.`}</small></div>`;
  return h;
}
// Gewichte der Teil-Sätze nachziehen, wenn sich das Gewicht des Hauptsatzes ändert (ohne alles neu zu zeichnen)
function techSubSync(ei) {
  const en = draft.entries[ei];
  en.sets.forEach((s, si) => (isTech(variantOf(s)) ? s.subs || [] : []).forEach((x, j) => {
    const w = subWeight(en, si, j);
    const inp = $view.querySelector(`[data-field="tr-sub-w"][data-ei="${ei}"][data-si="${si}"][data-j="${j}"]`);
    if (inp && !x.wTouched && document.activeElement !== inp) inp.value = w != null ? fmtNum(w) : '';
    const kg = $view.querySelector(`[data-subkg="${ei}-${si}-${j}"]`);
    if (kg) kg.textContent = w != null ? `${fmtNum(w)} kg` : '–';
  }));
}
// Plan (Tagesplan): Intensitätstechnik je Übung – keine / Reduktion / Myo, in welchen Sätzen, wie viele Teil-Sätze
function techPlanHtml(ex, i) {
  const t = ex.tech && TECHS[ex.tech.k] ? ex.tech : null;
  const chip = (act, v, label, on) => `<button class="vchip ${on ? 'on' : ''}" data-action="${act}" data-i="${i}" data-v="${v}">${label}</button>`;
  let h = `<div class="variants plan tech-row"><span>Intensitäts­technik</span>${chip('plan-tech', '', 'Keine', !t)}${chip('plan-tech', 'drop', 'Reduktion', t && t.k === 'drop')}${chip('plan-tech', 'myo', 'Myo', t && t.k === 'myo')}</div>`;
  if (!t) return h + `<details class="tech-info"><summary>ⓘ Intensitätstechniken – was ist das?</summary>
      <p>Reduktions- und Myo-Sätze holen in kurzer Zeit mehr aus einem Satz heraus – sinnvoll vor allem, wenn die Zeit knapp ist.
        Sie ermüden aber auch deutlich mehr. Die App plant sie nie von selbst ein: Du entscheidest je Übung hier im Plan
        (gilt dann dauerhaft, mit Steigerung) oder im Training für einzelne Sätze (Satznummer antippen).</p>
      <p><b>Reduktionssatz:</b> ${TECH_INFO.drop.what}</p><p><b>Myo-Satz:</b> ${TECH_INFO.myo.what}</p></details>`;
  h += `<div class="variants plan"><span>In</span>${chip('plan-tech-at', 'last', 'Letzter Satz', t.at !== 'all')}${chip('plan-tech-at', 'all', 'Alle Sätze', t.at === 'all')}</div>
    <div class="variants plan"><span>${t.k === 'drop' ? 'Reduktionen' : 'Mini-Sätze'}</span>${TECH_N[t.k].map(n => chip('plan-tech-n', n, String(n), t.n === n)).join('')}</div>`;
  if (techRisky(ex)) h += `<p class="complaint-note">⚠️ ${esc(ex.name)} ist eine Grundübung – hier leidet bei einem ${TECHS[t.k]} schnell die Technik. Besser bei Maschinen-, Kabel- oder Isolationsübungen einsetzen.</p>`;
  if (t.k === 'myo') h += `<p class="hint tech-warn">⚠️ ${TECH_INFO.myo.warn}</p>`;
  return h + techInfoHtml(t.k);
}

// k-ter Bezugssatz einer Liste; fehlt er, den letzten nehmen und je Satz Ermüdung abziehen
function refAt(list, k) {
  if (k < list.length) return list[k];
  const last = list[list.length - 1];
  const extra = k - list.length + 1;
  return { ...last, reps: last.reps != null ? Math.max(minReps(), last.reps - FATIGUE * extra) : null };
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
  const t = { ...en.plan, rir: rirFor(kindOf(ex), nw, bw, groupOf(ex)), rirSplit: true, sets: en.sets.length };
  delete t.hold; delete t.intro;
  const hold = !weekProgression(roundKey(draft.cycleStart, nw)).load;
  // derselbe Durchgang nächste Woche (beim 2. Training kann dort noch das 1. Training der Woche begrenzen)
  const occ = draft.occurrence || 1;
  const cmp = hold ? null : condRef(comparisonEntry(en.name, draft.dayId, { week: nw, cycleStart: draft.cycleStart, occurrence: occ }), { step: 2.5, ...en.target });
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
      const ti = tAt(t, iNext);  // Tank dieses Satzes nächste Woche (v199)
      const r = refProposal(ti, { sets: doneSets, planned: en.planned, target: en.target }, cmp, iNext, k, v);
      p = adjustProposal(r.p, r.rule, ti, ofVariant(doneSets, v), ofVariant(cmp && cmp.sets, v), iNext, k).p;
      why = r.rule === 'brake' ? 'Ziel verfehlt → leichter' : r.hold ? 'halten' : r.fromCmp ? 'Vergleich letzter Zyklus' : '';
    }
    const tI = tAt(t, iNext);
    p = atLeastMinReps(p, tI);
    if (p.weight != null && lastW[v] != null && p.weight > lastW[v]) {
      p = { weight: lastW[v], reps: Math.max(minReps(), repsAtWeight(p.reps, tI.rir, p.weight, lastW[v])) };
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
  const abs = draftPbFlags(en);
  abs.forEach((pb, si) => {
    const el = $view.querySelector(`[data-pb="${ei}-${si}"]`);
    if (el) el.hidden = !pb;
  });
  draftFatPbFlags(en, abs).forEach((pb, si) => {
    const el = $view.querySelector(`[data-fpb="${ei}-${si}"]`);
    if (el) el.hidden = !pb;
  });
}

/* ---------- Persönliche Bestleistung (PB) ---------- */
// Ein Satz ist eine neue Bestleistung, wenn er jede frühere Leistung dieser Übung übertrifft (gleiche Ausführung):
// mit Gewicht entweder das daraus geschätzte „Max. bei 10 Wdh.“ (Gewicht und Wdh., der Tank nicht – nur was wirklich
// geschafft wurde) oder ein neues Höchstgewicht; ohne Gewicht die Wdh. (Band: je stärkere Stufe BAND_STEP_REPS Wdh.
// mehr). Wer eine Übung zum ersten Mal macht, hat noch keine Bestleistung zu schlagen – dann gibt es noch keinen Stern.
const pbKey = s => `${s.outlier ? 'aus:' : ''}${variantOf(s)}|${s.weight != null && s.weight > 0 ? 'w' : 'r'}`;
function pbScore(s, band) {
  if (!s || s.reps == null || s.reps <= 0) return null;
  if (s.weight != null && s.weight > 0) return s.weight / repFactor(s.reps);
  return s.reps + (band ? (band - 1) * BAND_STEP_REPS : 0);
}
// Beste frühere Leistung je Ausführung aus den gespeicherten Trainings (vor dem Datum before, ohne das Training skipId)
function pbBest(name, before = null, skipId = null) {
  const k = nameKey(name), best = {};
  for (const ses of data.sessions) {
    if (ses.id === skipId || (before && ses.date >= before)) continue;
    ses.entries.forEach((e, ei) => {
      if (nameKey(e.name) !== k) return;
      const band = e.target && e.target.band;
      const fat = sessionFat(ses, ei);
      for (const x of e.sets) {
        const sc = pbScore(x, band);
        if (sc == null) continue;
        const b = best[pbKey(x)] || (best[pbKey(x)] = { sc: -Infinity, w: -Infinity, fa: -Infinity });
        b.sc = Math.max(b.sc, sc);
        b.fa = Math.max(b.fa, sc / (1 - fat));  // auf frisch umgerechnet (Vorermüdungs-PB)
        if (x.weight != null) b.w = Math.max(b.w, x.weight);
      }
    });
  }
  return best;
}
// Vorermüdungs-PB (User-Wunsch 2026-11-09): vorermüdeter Satz, der auf frisch umgerechnet alles Bisherige übertrifft –
// zusätzlich zum echten PB (abs = dessen Sterne; ein Satz bekommt nur eins von beiden)
function pbFatFlags(sets, best, band, fat, abs) {
  if (!(fat >= PREFAT_SHOW - 1e-9)) return sets.map(() => false);
  const b = Object.fromEntries(Object.entries(best).map(([k, v]) => [k, { ...v }]));
  return sets.map((x, i) => {
    const sc = pbScore(x, band), key = x && pbKey(x);
    if (sc == null || !(key in best)) return false;
    const r = b[key], adj = sc / (1 - fat);
    const pb = adj > r.fa + 1e-9 && !abs[i];
    r.fa = Math.max(r.fa, adj);
    return pb;
  });
}
// Stern je Satz: schlägt die beste frühere Leistung – und auch die stärkeren Sätze davor im selben Training
function pbFlags(sets, best, band) {
  const b = Object.fromEntries(Object.entries(best).map(([k, v]) => [k, { ...v }]));
  return sets.map(x => {
    const sc = pbScore(x, band), key = x && pbKey(x);
    if (sc == null || !(key in best)) return false;
    const r = b[key], heavier = x.weight != null && x.weight > r.w + 1e-9;
    const pb = sc > r.sc + 1e-9 || heavier;
    r.sc = Math.max(r.sc, sc);
    if (x.weight != null) r.w = Math.max(r.w, x.weight);
    return pb;
  });
}
// Im Training: nur erledigte Sätze zählen
const draftPbFlags = en => pbFlags(en.sets.map(x => isDone(x)
  ? { weight: parseNum(x.weight), reps: parseNum(x.reps), variant: x.variant } : null),
  pbBest(en.name), en.target && en.target.band);
const draftFatPbFlags = (en, abs) => pbFatFlags(en.sets.map(x => isDone(x)
  ? { weight: parseNum(x.weight), reps: parseNum(x.reps), variant: x.variant } : null),
  pbBest(en.name), en.target && en.target.band, en.target ? en.target.fat || 0 : 0, abs);
const PB_TAG = ' <span class="pb-tag" title="Neue persönliche Bestleistung">★ PB</span>';
const FPB_TAG = ' <span class="pb-tag fpb" title="Vorermüdet und auf frisch umgerechnet deine beste Leistung bisher">💪 Vorermüdungs-PB</span>';
const setsWithPb = (sets, flags, fflags = []) => sets.map((x, i) => fmtSet(x) + (flags[i] ? PB_TAG : fflags[i] ? FPB_TAG : '')).join('<br>');
// Sterne für ein gespeichertes Training (Verlauf, Training ansehen)
function sessionPbHtml(s, e) {
  const best = pbBest(e.name, s.date, s.id), band = e.target && e.target.band;
  const abs = pbFlags(e.sets, best, band);
  return setsWithPb(e.sets, abs, pbFatFlags(e.sets, best, band, sessionFat(s, s.entries.indexOf(e)), abs));
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
      // Eigengewicht: Wdh. so weit senken, dass das Tank-Ziel wieder stimmt (mind. minReps())
      const capBw = src.reps + (src.rir != null ? src.rir : t.rir);
      return { p: { weight: null, reps: Math.max(minReps(), Math.floor(capBw - t.rir + 1e-9)) }, rule: 'brake' };
    }
    const cap = src.reps + (src.rir != null ? src.rir : t.rir);
    return { p: weightForGoal(cap, src.weight, { step: 2.5, ...t }, 0, goal), rule: 'brake' };
  }
  const rirOf = e => e && e.target && e.target.rir != null ? rirAt(e.target, i) : null;  // damaliges Tank-Ziel dieses Satzes
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
// Letzte Regeln für einen Vorschlag (Training und Vorschau „Nächste Woche“): Diät, weiche Grenze, Anfänger.
// prevV/cmpV: Sätze der Vorwoche bzw. des Vergleichstrainings (derselben Ausführung)
function adjustProposal(p, rule, t, prevV, cmpV, i, k) {
  // Training an die Diät angepasst: der Plan erzwingt keine Gewichtssteigerung (Vorwoche, sonst letzter Zyklus) –
  // höher nur, wenn die echte letzte Leistung das Ziel auf der nächsten Stufe hergibt (User-Regel 2026-11-06),
  // sonst höchstens 1 Wdh. mehr, soweit es das Tank-Ziel hergibt (User-Regel 2026-11-02)
  if (t.noLoadUp && p && p.weight != null && rule !== 'brake') {
    const ref = prevV.length ? refAt(prevV, k) : cmpV.length ? refAt(cmpV, k) : null;
    if (ref && ref.weight != null && ref.reps != null && p.weight > ref.weight) {
      const cap = ref.reps + (ref.rir != null ? ref.rir : t.rir);
      const earned = stepUp(cap, ref.weight, { step: 2.5, ...t }, 0, goalReps(t, i), true);
      if (earned) p = earned;
      else {
        p = { weight: ref.weight, reps: Math.max(ref.reps, Math.min(ref.reps + 1, Math.floor(cap - t.rir + 1e-9))) };
        rule = 'diet';
      }
    }
  }
  // Über REP_SOFT_MAX Wdh.: nächste Stufe, wenn sie laut „Max. bei 10 Wdh.“ für die Mindest-Wdh. reicht – sonst bleibt
  // es beim höheren Vorschlag, dazu ein Hinweis auf schwerere Varianten (bwHint). Nicht im 2. Training der Woche.
  // Diät: nur wenn das volle Ziel auf der nächsten Stufe sicher klappt.
  if (!t.own && !t.hold && !t.deload && rule !== 'week' && p && p.weight != null && p.reps > REP_SOFT_MAX) {
    const up = wUp(p.weight, t);
    if (up != null && t.noLoadUp) {
      const earned = stepUp(p.reps + t.rir, p.weight, { step: 2.5, ...t }, k, goalReps(t, i), true);
      if (earned) p = earned;
    } else if (up != null && t.max10 != null) {
      const reps = Math.floor(10 + (1 - up / effMax(t)) / 0.025 - t.rir - FATIGUE * k + 1e-9);
      // Wdh. höchstens so viele, wie die Leistung auf der alten Stufe hergibt („Max.“ kann zu hoch sein)
      const byCap = Math.floor(capacityAt(p.reps + t.rir, p.weight, up) - t.rir + 1e-9);
      if (reps >= minReps()) p = { weight: up, reps: Math.max(minReps(), Math.min(reps, byCap)) };
    }
  }
  // Neulinge und Einsteiger: alle Sätze der Vorwoche bei mindestens 15 Wdh. -> nächste Gewichtsstufe (User-Regel 2026-11-06).
  // Nur wenn dort die Mindest-Wdh. überhaupt möglich sind – sonst wäre der Sprung zu groß und es ginge gleich wieder zurück.
  if (!t.own && !t.hold && !t.deload && rule !== 'week' && rule !== 'brake' && p && p.weight != null && beginnerPlan()
    && prevV.length && prevV.every(x => x.weight != null && x.reps != null && x.reps >= BEGINNER_UP_REPS)) {
    const src = refAt(prevV, k);
    const up = p.weight <= src.weight ? wUp(src.weight, t) : null;
    if (up != null) {
      const n = capacityAt(src.reps + (src.rir != null ? src.rir : t.rir), src.weight, up);
      if (n >= minReps()) p = { weight: up, reps: Math.max(minReps(), Math.floor(n - t.rir + 1e-9)) };
    }
  }
  return { p, rule };
}

// Einfach-Modus (User-Regel 2026-11-09): „😊 locker“ heißt nur „mindestens 4 im Tank“ – nach oben offen. Stützt sich der
// Vorschlag auf so einen Satz, gilt als Untergrenze die letzte genaue Leistung der Übung (💪 gut, 😤 hart, 🔥 ging nichts mehr
// oder Tank-Zahl, höchstens OPEN_DAYS alt), umgerechnet auf Ziel, Tank und Vorermüdung von heute. Gewicht immer abgerundet.
const OPEN_DAYS = 42;
function openMax(name) {
  const k = nameKey(name), since = addDaysISO(todayISO(), -OPEN_DAYS);
  for (const s of sessionsNewestFirst()) {
    if (s.date.slice(0, 10) < since) break;
    if (s.deload) continue;
    const ei = s.entries.findIndex(e => nameKey(e.name) === k);
    if (ei < 0) continue;
    const sets = s.entries[ei].sets.filter(x => !x.variant);
    const j = sets.findIndex(x => !x.open && x.weight > 0 && x.reps != null && x.rir != null);
    if (j < 0) continue;
    const x = sets[j], f = repFactor(x.reps + x.rir + FATIGUE * j);
    return x.weight / f / (1 - sessionFat(s, ei));  // frisch, ohne Vorermüdung
  }
  return null;
}
function openFloor(en, t, i, k) {
  if (t.own || t.hold || t.deload || t.bodyweight || t.noLoadUp) return null;
  const refs = [en.prevWeek, en.compare].map(r => r && ofVariant(r.sets, '')).filter(x => x && x.length);
  if (!refs.some(r => refAt(r, k).open)) return null;
  const m = openMax(en.name);
  if (m == null) return null;
  const em = effMax({ ...t, max10: m });
  const w = wSnap(em * repFactor(t.reps + t.rir), t, Math.floor);
  if (!(w > 0)) return null;
  const reps = Math.floor(10 + (1 - w / em) / 0.025 - t.rir - FATIGUE * k + 1e-9);
  if (reps < minReps()) return null;
  return { weight: w, reps: Math.min(reps, Math.max(goalReps(t, i), REP_SOFT_MAX)) };
}

function proposeSet(en, i, v) {
  const t = tAt(en.target, i);  // Tank dieses Satzes (ganze Zahl, absteigend)
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
  if (p && !v && rule !== 'brake') {
    const fl = openFloor(en, t, i, k);
    if (fl && lighterSet(p, fl)) { p = fl; rule = 'open'; }
  }
  const firstV = ofVariant(en.weekFirst && en.weekFirst.sets, v);
  if (firstV.length && !t.hold) {
    // 2. Training der Woche: höchstens der Plan des 1. Trainings dieser Woche (keine Steigerung dagegen)
    const f = refAt(firstV, k);
    const cap = { weight: f.weight, reps: f.reps };
    if (cap.reps != null && (!p || lighterSet(cap, p))) { p = cap; rule = 'week'; }
  }
  ({ p, rule } = adjustProposal(p, rule, t, ofVariant(en.prevWeek && en.prevWeek.sets, v), ofVariant(en.compare && en.compare.sets, v), i, k));
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

// Schlecht geschlafen / Stress: erwartete Wdh. um pen senken. Fiele der Satz unter minReps(),
// geht wie sonst auch das Gewicht runter.
function applyPenalty(set, t, pen) {
  const r = parseNum(set.reps);
  if (!pen || r == null) return set;
  let reps = r - pen;
  let w = parseNum(set.weight);
  if (reps < minReps() && w != null) ({ weight: w, reps } = planSet(reps + t.rir, w, { step: 2.5, ...t }, 0));
  if (w == null) reps = Math.max(minReps(), reps);
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
// v216 (User 2026-11-12): bei gleichem Gewicht höchstens SAME_W_PLUS Wdh. mehr als der Satz davor – sonst z. B. nach der
// Bremse „2,5 kg × 5, dann 2,5 kg × 23“ (Satz 1 nach Plan, Satz 2 aus seiner eigenen, viel leichteren Vorwoche)
const SAME_W_PLUS = 2;
function notHeavierThanBefore(en, i, v, set) {
  const w = parseNum(set.weight);
  if (w == null) return set;
  let before = null;
  for (let j = i - 1; j >= 0; j--) if (en.sets[j] && variantOf(en.sets[j]) === v) { before = en.sets[j]; break; }
  const pw = before && parseNum(before.weight);
  const cap = s => {
    const pr = parseNum(before.reps), r = parseNum(s.reps);
    return pr != null && r != null && parseNum(s.weight) === pw && r > pr + SAME_W_PLUS ? { ...s, reps: String(pr + SAME_W_PLUS) } : s;
  };
  if (pw == null) return set;
  if (w <= pw) return cap(set);
  const rir = rirAt(en.target, i);
  const reps = Math.max(minReps(), repsAtWeight(parseNum(set.reps), rir, w, pw));
  return cap({ ...set, weight: fmtNum(pw), reps: String(reps), baseWeight: pw });
}

// Satz i (neu) vorschlagen und den ursprünglichen Vorschlag für die Bremse merken
function applyProposal(en, i, v) {
  const { set: proposed, rule } = proposeSet(en, i, v);
  const set = notHeavierThanBefore(en, i, v, applyPenalty(proposed, tAt(en.target, i), draft.penalty || 0));
  en.sets[i] = set;
  if (isTech(v)) { set.subs = techSubs(en, i, v, set); set.subVariant = v; }  // Intensitätstechnik (v211): Teil-Sätze
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
  // läuft weiter, solange ein Training offen ist – auch in anderen Ansichten (z. B. Übung nachschlagen), damit das
  // Pausen-Signal trotzdem kommt (v202)
  const tick = () => {
    if (!draft) { clearInterval(trTimer); return; }
    const el = document.getElementById('tr-timer');
    if (el) el.textContent = fmtClock(Date.now() - Date.parse(draft.date));
    restTick();
  };
  tick();
  trTimer = setInterval(tick, 1000);
}

/* ---------- Pausen-Timer (v202, User-Wunsch 2026-11-11) ---------- */
// Nach jedem erledigten Satz (offen → erledigt) läuft oben im Training eine Pause nach Übungsart (REST_MIN wie bei der
// Dauerschätzung); die Gesamtzeit läuft weiter. Nach dem letzten Satz des Trainings keine Pause.
// draft.rest = { ei, end (ms), total (ms), signaled }. Einstellungen: profile.rest = { off, vib, sound, tone } – alles optional.
const REST_LINGER = 6000;  // so lange steht „Pause vorbei“ noch da
const REST_TONES = { beep: 'Piepen', gong: 'Gong', bell: 'Glocke', fanfare: 'Fanfare' };
const restCfg = () => ({ off: false, vib: true, sound: false, tone: 'beep', ...((data.profile || {}).rest || {}) });
function restStart(ei, si = null, sub = null) {
  if (restCfg().off || !draft) return;
  // Intensitätstechnik (v211): Reduktion ohne Pause weiter, Myo 20 s bis zum nächsten Mini-Satz – erst danach die normale Pause
  const ts = si != null && draft.entries[ei] ? draft.entries[ei].sets[si] : null;
  if (ts && isTech(variantOf(ts)) && (ts.subs || []).length) {
    const open = ts.subs.findIndex((x, j) => j > (sub == null ? -1 : sub) && !subDone(x));
    if (open >= 0) {
      if (variantOf(ts) === 'drop') { delete draft.rest; return; }
      draft.rest = { ei, end: Date.now() + MYO_REST_S * 1000, total: MYO_REST_S * 1000, myo: [si, open] };
      if (restCfg().sound) restAudio(true);
      return;
    }
  }
  if (trProgress().cur < 0) { delete draft.rest; return; }
  const en = draft.entries[ei];
  // Supersatz (v210): Pause je Satz, solange als Nächstes die andere Übung dran ist (danach normale Pause)
  const p = draftPairs().get(ei), nx = p && ssNext(p);
  const min = nx && nx[0] !== ei ? p.rest : REST_MIN[kindOf(planExercise(en.name) || { name: en.name })] || 3;
  draft.rest = { ei, end: Date.now() + min * 60000, total: min * 60000, ...(nx ? { next: nx } : {}) };
  if (restCfg().sound) restAudio(true);  // im Tipp freischalten – das iPhone spielt Töne sonst später nicht ab
}
function restTick() {
  const r = draft && draft.rest;
  if (!r) return;
  const left = r.end - Date.now();
  // lange vorbei (z. B. App war im Hintergrund): still entfernen, kein verspätetes Signal
  if (left <= -REST_LINGER) { delete draft.rest; saveDraft(); syncTrHead(); return; }
  if (left <= 0) {
    if (!r.signaled) { r.signaled = true; saveDraft(); restSignal(); syncTrHead(); }
    return;
  }
  const t = document.getElementById('tr-rest-left'), b = document.getElementById('tr-rest-bar');
  if (t) t.textContent = fmtClock(Math.ceil(left / 1000) * 1000);
  if (b) b.style.width = Math.round(left / r.total * 100) + '%';
}
function restHtml() {
  const r = draft && draft.rest;
  if (!r) return '';
  const left = r.end - Date.now();
  if (left <= -REST_LINGER) return '';
  if (left <= 0) {
    return `<div class="trh-rest over"><span class="trh-rest-t">Pause vorbei – weiter geht’s 💪</span>
      <button data-action="rest-skip">OK</button></div>${restNextHtml(r)}`;
  }
  return `<div class="trh-rest"><span class="trh-rest-t">Pause <b id="tr-rest-left">${fmtClock(Math.ceil(left / 1000) * 1000)}</b></span>
      <button data-action="rest-add" data-s="-30">−30 s</button><button data-action="rest-add" data-s="30">+30 s</button>
      <button data-action="rest-skip">Weiter</button></div>
    <div class="trh-bar rest"><i id="tr-rest-bar" style="width:${Math.round(left / r.total * 100)}%"></i></div>${restNextHtml(r)}`;
}
// Supersatz (v210): welcher Satz als Nächstes dran ist, z. B. „Danach: B2 · Rudern am Kabel“
function restNextHtml(r) {
  if (r.myo) {
    const en = draft.entries[r.ei];
    return en ? `<button class="trh-next" data-action="tr-jump">Danach: <b>Mini-Satz ${r.myo[1] + 1} · ${esc(en.name)}</b></button>` : '';
  }
  if (!r.next) return '';
  const [ei, si] = r.next, en = draft.entries[ei], p = draftPairs().get(ei);
  if (!en || !p || isDone(en.sets[si] || {})) return '';
  return `<button class="trh-next" data-action="tr-jump">Danach: <b>${p.role}${si + 1} · ${esc(en.name)}</b></button>`;
}
// Signal am Ende: Vibration (nur Android – iPhone erlaubt Web-Apps keine Vibration) und/oder Ton
function restSignal() {
  const c = restCfg();
  if (c.vib && navigator.vibrate) { try { navigator.vibrate([250, 120, 250]); } catch (e) { /* ohne */ } }
  if (c.sound) restPlay(c.tone);
}
let restCtx = null;
function restAudio(unlock) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!restCtx) restCtx = new AC();
    if (restCtx.state === 'suspended') restCtx.resume();
    if (unlock) {  // unhörbarer Mini-Ton im Tipp: schaltet die Wiedergabe frei
      const o = restCtx.createOscillator(), g = restCtx.createGain();
      g.gain.value = 0; o.connect(g); g.connect(restCtx.destination); o.start(); o.stop(restCtx.currentTime + 0.01);
    }
    return restCtx;
  } catch (e) { return null; }
}
// Töne werden erzeugt (keine Dateien): je Ton eine Folge von Noten [Start s, Frequenz Hz, Dauer s, Wellenform, Lautstärke]
function restPlay(tone) {
  const c = restAudio();
  if (!c) return;
  const notes = {
    beep: [[0, 880, .16, 'sine', .35], [.25, 880, .16, 'sine', .35], [.5, 1175, .3, 'sine', .35]],
    gong: [[0, 196, 2.2, 'sine', .45], [0, 392, 1.6, 'sine', .25], [0, 588, 1.1, 'triangle', .12], [0, 987, .7, 'sine', .06]],
    bell: [[0, 1318, 1.3, 'sine', .3], [0, 2637, .8, 'sine', .1], [.45, 1318, 1.3, 'sine', .3], [.45, 2637, .8, 'sine', .1]],
    fanfare: [[0, 523, .14, 'square', .1], [.15, 659, .14, 'square', .1], [.3, 784, .14, 'square', .1], [.45, 1047, .45, 'square', .1]],
  }[tone] || [];
  const now = c.currentTime + .03;
  for (const [t, f, d, type, vol] of notes) {
    const o = c.createOscillator(), g = c.createGain(), s = now + t;
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(.0001, s);
    g.gain.exponentialRampToValueAtTime(vol, s + .015);
    g.gain.exponentialRampToValueAtTime(.0001, s + d);
    o.connect(g); g.connect(c.destination);
    o.start(s); o.stop(s + d + .05);
  }
}
// Optionen: eigene Karte nach „Aussehen“
function restCard() {
  const c = restCfg();
  const seg = (k, on, a, b) => `<div class="seg two"><button class="${on ? 'on' : ''}" data-action="rest-set" data-k="${k}" data-v="${k === 'off' ? 0 : 1}">${a}</button>
    <button class="${on ? '' : 'on'}" data-action="rest-set" data-k="${k}" data-v="${k === 'off' ? 1 : 0}">${b}</button></div>`;
  return `<div class="card rest-card">
      <h2>Pausen-Timer</h2>
      ${seg('off', !c.off, 'An', 'Aus')}
      <p class="hint explain">Nach jedem erledigten Satz läuft oben im Training die Pause: Grundübungen 4, normale Übungen 3, Isolationsübungen
        2 Minuten${ssOn() ? ', im Supersatz 2 Minuten bzw. 90 Sekunden bei zwei Isolationsübungen' : ''}. Mit −30 s und +30 s passt du sie an, „Weiter“ beendet sie. Die Gesamtzeit läuft immer mit.</p>
      ${c.off ? '' : `<p class="lbl">Vibration am Ende</p>${seg('vib', c.vib, 'An', 'Aus')}
      <p class="lbl">Ton am Ende</p>${seg('sound', c.sound, 'An', 'Aus')}
      ${c.sound ? `<div class="variants rest-tones">${Object.entries(REST_TONES).map(([k, l]) =>
        `<button class="vchip ${c.tone === k ? 'on' : ''}" data-action="rest-tone" data-k="${k}">${l}</button>`).join('')}</div>
        <p class="hint">Antippen spielt den Ton zur Probe. Lautstärke wie bei anderen Tönen am Handy – im Lautlos-Modus bleibt das iPhone stumm.</p>` : ''}
      <p class="hint explain">Vibration gibt es nur auf Android – das iPhone erlaubt sie Web-Apps nicht. Ton und Vibration kommen, solange die App
        geöffnet und der Bildschirm an ist.</p>`}
    </div>`;
}

// Kopfleiste im Training (v200, User-Wunsch 2026-11-10): „Übung x von y · a von b Sätzen“, Balken, Uhr und Menü „⋯“.
// Aktuelle Übung = erste mit noch offenen Sätzen; antippen springt dorthin.
let trMenuOpen = false;
function trProgress() {
  let all = 0, done = 0;
  for (const en of draft.entries) { all += en.sets.length; done += en.sets.filter(isDone).length; }
  // Supersatz (v210): dran ist der nächste offene Satz in der Reihenfolge A1, B1, A2 …
  const pairs = draftPairs();
  let cur = -1;
  for (let i = 0; i < draft.entries.length && cur < 0; i++) {
    const p = pairs.get(i);
    if (p && p.role === 'A') { const nx = ssNext(p); if (nx) cur = nx[0]; i++; continue; }
    if (draft.entries[i].sets.some(s => !isDone(s))) cur = i;
  }
  return { all, done, cur };
}
function trHeadHtml() {
  const { all, done, cur } = trProgress();
  const pct = all ? Math.round(done / all * 100) : 0;
  const where = cur < 0 ? 'Alles erledigt ✓' : `Übung ${cur + 1} von ${draft.entries.length}`;
  return `<div class="trh-row">
      <button class="trh-where" data-action="tr-jump">${where}<span> · ${done} von ${all} Sätzen</span></button>
      <span class="trh-time">⏱ <b id="tr-timer">${fmtClock(Date.now() - Date.parse(draft.date))}</b></span>
      <button class="trh-menu-btn" data-action="tr-menu" aria-label="Mehr" aria-expanded="${trMenuOpen}">⋯</button>
    </div>
    <div class="trh-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div>
    ${restHtml()}${trMenuOpen ? trMenuHtml() : ''}`;
}
function trMenuHtml() {
  const lastDur = lastDuration(draft.dayId);
  const items = [];
  if (!draft.reorder) items.push(['reorder-toggle', '⇅ Reihenfolge ändern']);
  items.push(['trm-details-all', draft.entries.every(detOpen) ? '▴ Alle Details zuklappen' : '▾ Alle Details aufklappen']);
  if (!draft.own) items.push(['trm-entry-help', 'ℹ️ So trägst du dein Training ein']);
  if (prefatToday()) items.push(['trm-prefat', '💤 Vorermüdung – so rechnet die App']);
  return `<div class="trh-menu" role="menu">${items.map(([a, t]) => `<button role="menuitem" data-action="${a}">${t}</button>`).join('')}
    <p>${lastDur ? `Letztes Mal hat dieser Tag ${fmtDur(lastDur)} gedauert.` : 'Erstes Mal – die Dauer wird gemessen.'}</p></div>`;
}
function syncTrHead() {
  const on = current.view === 'training' && !!draft;
  document.querySelector('header').classList.toggle('tr', on);
  $trHead.hidden = !on;
  if (!on) { trMenuOpen = false; $trHead.innerHTML = ''; return; }
  $trHead.innerHTML = trHeadHtml();
}

// Details je Übung (v200): Kommentar, Ersetzen, Max., Steigerung, Ausführung und Werte vom letzten Mal sind zugeklappt.
// Die letzte Wahl (auf/zu) gilt als Vorgabe fürs nächste Training (profile.trDetails).
const detOpen = en => en.detOpen != null ? en.detOpen : !!(data.profile && data.profile.trDetails);
// Satz-Zustand für die Felder: erledigt (grün) – Vorschlag, noch nicht angefasst (grau) – selbst eingetragen
const setState = s => isDone(s) ? 'done' : s.touched ? '' : 'prop';
function markSets(ei) {
  const en = draft.entries[ei];
  en.sets.forEach((s, si) => {
    const st = setState(s);
    $view.querySelectorAll(`[data-field="tr-weight"][data-ei="${ei}"][data-si="${si}"], [data-field="tr-reps"][data-ei="${ei}"][data-si="${si}"]`)
      .forEach(x => { x.classList.toggle('prop', st === 'prop'); x.classList.toggle('done', st === 'done'); });
    const no = $view.querySelector(`[data-setno="${ei}-${si}"]`);
    if (no) no.classList.toggle('done', st === 'done');
  });
  ssSyncNow();
  if (!$trHead.hidden) $trHead.innerHTML = trHeadHtml();
}
// Supersatz (v210): nächsten Satz markieren und „Runde x von y“ nachziehen, ohne alles neu zu zeichnen
function ssSyncNow() {
  const pairs = draftPairs();
  $view.querySelectorAll('.setno.now').forEach(x => x.classList.remove('now'));
  pairs.forEach((p, i) => {
    if (p.role !== 'A') return;
    const nx = ssNext(p);
    const no = nx && $view.querySelector(`[data-setno="${nx[0]}-${nx[1]}"]`);
    if (no) no.classList.add('now');
    const rd = $view.querySelector(`[data-ss-round="${i}"]`);
    if (rd) rd.textContent = ssRoundText(p);
  });
}
// Kopf des Paars im Training
function ssHeadHtml(p, first = true) {
  return `<div class="ss-head"><span class="ss-title">🔗 Supersatz<small data-ss-round="${p.i}">${ssRoundText(p)}</small></span>
      <button class="btn small outline" data-action="ss-solo" data-ei="${p.i}">Heute einzeln</button></div>` + (first
    ? `<p class="hint explain ss-how">Immer im Wechsel: Satz A, Pause, Satz B, Pause, dann wieder A. Der nächste Satz ist markiert,
      der Pausen-Timer zeigt, was danach dran ist. Ist ein Gerät besetzt: „Heute einzeln“.</p>` : '');
}
// Paar heute einzeln (z. B. Gerät besetzt): normale Pausen, der Plan bleibt
function ssSoloHtml(p, hidden) {
  const a = draft.entries[p.i], b = draft.entries[p.j];
  return `<div class="ss-solo"${hidden ? ' hidden' : ''}><span>🔗 Supersatz heute aus – ${esc(a.name)} und ${esc(b.name)} einzeln mit normalen Pausen</span>
    <button class="btn small" data-action="ss-unsolo" data-ei="${p.i}">Wieder koppeln</button></div>`;
}

// Tagesplan: mögliche Partner einer Übung (erlaubt, noch ohne Paar) – Gegenspieler zuerst, dann die größte Ersparnis
var ssPick = null;  // { day, i }: offene Auswahl „Als Supersatz koppeln“
function ssCandidates(day, i) {
  const exs = day.exercises, pairs = dayPairs(exs), ex = exs[i];
  return exs.map((e, j) => j).filter(j => j !== i && exs[j].name.trim() && !pairs.has(j) && ssPairOk(ex, exs[j]))
    .sort((x, y) => ssAntag(ex, exs[y]) - ssAntag(ex, exs[x]) || ssSaves(ex, exs[y]) - ssSaves(ex, exs[x]) || Math.abs(x - i) - Math.abs(y - i));
}
const ssSaveText = (a, b, rest) => { const v = ssSaves(a, b, rest); return v ? `spart ca. ${fmtNum(v)} min je Runde` : 'spart keine Zeit'; };
function ssPlanHead(day, p) {
  const a = day.exercises[p.i], b = day.exercises[p.j];
  return `<div class="ss-head"><span class="ss-title">🔗 Supersatz<small>${ssAntag(a, b) ? 'Gegenspieler' : 'Unabhängige Muskelgruppen'}
      · Pause je ${ssRestText(p.rest)} · ${ssSaveText(a, b, p.rest)}</small></span>
    <button class="btn small outline" data-action="ss-unpair" data-i="${p.i}">Lösen</button></div>`;
}
function ssPickHtml(day, i) {
  const ex = day.exercises[i], c = ssCandidates(day, i);
  return `<div class="replace ss-pick"><p class="lbl">„${esc(ex.name)}“ im Wechsel mit …</p>
      ${c.length ? `<div class="quick-picks">${c.map(j => { const b = day.exercises[j];
        return `<button class="vchip" data-action="ss-pair" data-i="${i}" data-j="${j}">${esc(b.name)}<small>${ssAntag(ex, b) ? 'Gegenspieler · ' : ''}${ssSaveText(ex, b)}</small></button>`; }).join('')}</div>`
        : '<p class="hint">An diesem Tag passt keine Übung dazu.</p>'}
      <p class="hint">Erlaubt sind Gegenspieler (z. B. Brust und Rücken) und Muskelgruppen, die nichts miteinander zu tun haben
        (z. B. Bauch und Waden) – nicht zwei Drück- oder zwei Zugübungen und keine schweren Grundübungen der Beine. Pause nach jedem
        Satz: 2 min, bei zwei Isolationsübungen 90 s. Die zweite Übung rückt direkt hinter die erste.</p>
      <div class="row"><button class="btn" data-action="ss-pick-cancel">Abbrechen</button></div>
    </div>`;
}
function ssCouple(day, i, j) {
  const exs = day.exercises, a = exs[i], b = exs[j];
  exs.splice(j, 1);
  exs.splice(exs.indexOf(a) + 1, 0, b);
  const key = uid(), rest = ssDefRest(a, b);
  Object.assign(a, { ss: key, ssRest: rest });
  Object.assign(b, { ss: key, ssRest: rest });
  day.ssRuns = 0; day.ssAsked = false;  // Nachfrage nach dem 2. Training mit Supersatz
}
// Vorschlag für einen ganzen Tag (Kopie, ändert nichts): { pairs: [[A, B] …], list, save (Minuten pro Training) }
function ssAutoPreview(day, plan = activePlan()) {
  if (!ssOn(plan)) return null;
  const copy = day.exercises.map(e => ({ ...e }));
  const pairs = ssAutoPairs(copy);
  if (!pairs.length) return null;
  const named = pairs.map(([i, j]) => [copy[i].name.trim(), copy[j].name.trim()]);
  const list = ssApply(copy, pairs), ci = cycleInfo();
  const save = estDuration(day, ci.week, plan, ci.deload) - estDuration({ ...day, exercises: list }, ci.week, plan, ci.deload);
  return { pairs: named, list, save };
}
// „Wenig Zeit?“ mit Supersätzen: passt das Training nicht in die Zeit, koppelt die App heute zusätzlich passende Übungen
// (nur dieses Training, en.ssToday) – trimToTime kürzt danach nur noch, was dann immer noch zu viel ist
function ssForTime(limit) {
  if (!ssOn() || draft.own) return;
  const items = () => draft.entries.map(en => ({ n: en.sets.length, rest: REST_MIN[kindOf(planExercise(en.name) || { name: en.name })] || 3 }));
  if (seqMinutes(items(), draftPairs()) <= limit) return;
  const mk = () => draft.entries.map(en => ({ ...(planExercise(en.name) || { name: en.name }), name: en.name, ss: en.ss, ssRest: en.ssRest, en }));
  let exs = mk();
  // nur so viele Paare wie nötig – die mit der größten Ersparnis zuerst
  const all = ssAutoPairs(exs).sort(([i, j], [k, l]) =>
    Math.min(draft.entries[k].sets.length, draft.entries[l].sets.length) * ssSaves(exs[k], exs[l])
    - Math.min(draft.entries[i].sets.length, draft.entries[j].sets.length) * ssSaves(exs[i], exs[j]));
  if (!all.length) return;
  let pairs = all;
  for (let k = 1; k <= all.length; k++) {
    const pick = all.slice(0, k).sort((x, y) => x[0] - y[0]), list = ssApply(mk(), pick);
    const t = seqMinutes(list.map(x => ({ n: x.en.sets.length, rest: REST_MIN[kindOf(x)] || 3 })), dayPairs(list));
    pairs = pick;
    if (t <= limit) break;
  }
  exs = mk();
  draft.ssToday = pairs.map(([i, j]) => [exs[i].name, exs[j].name]);
  draft.entries = ssApply(exs, pairs).map(x => {
    if (x.ss && x.ss !== x.en.ss) Object.assign(x.en, { ss: x.ss, ssRest: x.ssRest, ssToday: true });
    return x.en;
  });
}
// Nach dem 2. Training mit Supersätzen aus dem Plan einmal fragen, ob die Pausen gepasst haben (User-Wunsch 2026-11-11)
function ssCheckCard(s) {
  const day = findDay(s.dayId);
  if (!day || day.ssAsked || (day.ssRuns || 0) < 2 || !s.entries.some(e => e.ss) || !dayPairs(day.exercises).size) return '';
  const est = estDuration(day, s.week || 1, activePlan(), !!s.deload);
  const b = (v, t) => `<button class="btn ${v === 'ok' ? 'primary' : 'outline'}" data-action="ss-check" data-day="${day.id}" data-v="${v}">${t}</button>`;
  return `<div class="card hints ss-check"><p><b>🔗 Supersätze: Haben die Pausen gepasst?</b></p>
      <p class="hint">Geplant waren für „${esc(day.name)}“ ca. ${fmtDur(est)}${s.duration ? `, gebraucht hast du ${fmtDur(s.duration)}` : ''}.</p>
      <div class="ss-check-btns">${b('ok', '✔ Passt')}${b('longer', 'Pausen zu kurz – länger')}${b('solo', 'Lieber wieder einzeln')}</div></div>`;
}
function ssAutoBtnHtml(day) {
  const pv = ssAutoPreview(day);
  if (!pv || pv.save < 1) return '';
  return `<button class="btn outline nav ss-auto-btn" data-action="ss-auto">🔗 Supersätze vorschlagen
    <small>${pv.pairs.length} Paar${pv.pairs.length === 1 ? '' : 'e'} möglich · spart ca. ${pv.save} min pro Training</small></button>`;
}
// Übungsname: Zusatz in Klammern kleiner und grau, z. B. „Bankdrücken Flachbank (Langhantel)“
function exTitleHtml(name) {
  const m = /^(.*\S)\s*(\([^()]*\))$/.exec(name);
  return m ? `${esc(m[1])} <span class="ex-paren">${esc(m[2])}</span>` : esc(name);
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

// Beschwerden für den aktuellen Zyklus (null = noch nicht abgefragt). Seit v208 lassen sie sich zwischendurch ändern
// (Beschwerden-Verlauf): jede Änderung ist ein weiterer Eintrag mit Datum – es gilt der neueste des Zyklus.
function currentComplaints() {
  const ci = cycleInfo();
  const list = data.complaints.filter(x => x.cycleStart === ci.cycleStart);
  return list.length ? list[list.length - 1].areas : null;
}

// Betrifft die Beschwerde-Stelle a diese Übung? (Muskelgruppe oder Name)
const areaHits = (a, name) => !!BODY_AREAS[a] && (BODY_AREAS[a].groups.includes(groupOf({ name })) || (!!BODY_AREAS[a].match && BODY_AREAS[a].match.test(norm(name))));

// Hinweise für eine Übung aus den Beschwerden dieses Zyklus
function complaintTips(name) {
  const areas = currentComplaints() || [];
  return areas.filter(a => areaHits(a, name)).map(a => ({ label: BODY_AREAS[a].label, tip: BODY_AREAS[a].tip }));
}

/* ---------- Beschwerde-Tagebuch (v208 Verlauf; v209 Stärke, Seite, Notiz, „Zwickt“ im Training, Bericht) ---------- */
// User-Vorgabe 2026-11-11: Die App DOKUMENTIERT nur – sie bewertet nichts und passt deshalb nichts automatisch an
// (sonst Medizinprodukt). Hinweise verweisen auf Ärztin/Arzt bzw. Physiotherapie.
// data.complaints: [{ cycleStart, date, areas, pain?: { stelle: 0–10 }, side?: { stelle: 'l'|'r'|'b' }, note? }] – höchstens ein Eintrag je Tag
// data.painLog:    [{ id, date, ex, area, pain: 0–10|null, side? }] – „Zwickt“ während des Trainings
const SIDES = { l: 'links', r: 'rechts', b: 'beidseits' };
const areaSided = k => k !== 'ruecken';
const PAIN_HIGH = 7;
const COMPL_DISCLAIMER = 'Die App dokumentiert nur – sie bewertet nichts und ersetzt keine Untersuchung. Was deine Einträge bedeuten, '
  + 'besprichst du am besten mit deiner Ärztin oder deinem Arzt bzw. in der Physiotherapie.';
const COMPL_HIGH_NOTE = '🩺 Starke Beschwerden besprichst du am besten bald mit deiner Ärztin oder deinem Arzt.';
const areaName = (k, side) => (BODY_AREAS[k] || { label: k }).label + (side && SIDES[side] ? ' ' + SIDES[side] : '');
const dShort = iso => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const heavierSet = (a, b) => (b.weight || 0) > (a.weight || 0) || ((b.weight || 0) === (a.weight || 0) && (b.reps || 0) > (a.reps || 0)) ? b : a;

// neuester Eintrag dieses Zyklus (Grundlage für die Hinweise im Training)
function currentComplaintEntry() {
  const ci = cycleInfo();
  const list = data.complaints.filter(x => x.cycleStart === ci.cycleStart);
  return list.length ? list[list.length - 1] : null;
}
// zuletzt angegebene Seite einer Stelle (Tagebuch oder Training)
function lastSideOf(k) {
  const all = [...data.complaints.filter(e => e.side && e.side[k]).map(e => ({ d: e.date, s: e.side[k] })),
    ...data.painLog.filter(z => z.area === k && z.side).map(z => ({ d: z.date, s: z.side }))].sort((a, b) => a.d.localeCompare(b.d));
  return all.length ? all[all.length - 1].s : null;
}
// alle Stärke-Werte einer Stelle (Tagebuch und „Zwickt“), älteste zuerst
function painPoints(k, from = '') {
  const pts = [];
  for (const e of data.complaints) if (e.date >= from && e.areas.includes(k) && e.pain && e.pain[k] != null) pts.push({ date: e.date, pain: e.pain[k], side: e.side && e.side[k] });
  for (const z of data.painLog) if (z.date >= from && z.area === k && z.pain != null) pts.push({ date: z.date, pain: z.pain, side: z.side, ex: z.ex });
  return pts.sort((a, b) => a.date.localeCompare(b.date));
}
// „Zwickt“ je Übung: wie oft, höchster Wert, zuletzt
function painExercises(k, from = '') {
  const m = new Map();
  for (const z of data.painLog) {
    if (z.area !== k || z.date < from) continue;
    const key = nameKey(z.ex), x = m.get(key) || { name: z.ex, n: 0, max: null, last: z.date };
    x.n++;
    if (z.pain != null) x.max = Math.max(x.max == null ? 0 : x.max, z.pain);
    if (z.date > x.last) x.last = z.date;
    m.set(key, x);
  }
  return [...m.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last));
}
// schwerster Satz einer Übung im ersten und letzten Training ab „from“ (für den Bericht)
function exWeights(name, from) {
  const k = nameKey(name);
  const list = data.sessions.filter(s => s.date >= from).sort((a, b) => a.date.localeCompare(b.date)).map(s => {
    const e = s.entries.find(x => nameKey(x.name) === k);
    return e && e.sets.length ? { date: s.date, set: e.sets.reduce(heavierSet) } : null;
  }).filter(Boolean);
  return list.length ? { first: list[0], last: list[list.length - 1], n: list.length } : null;
}

let complEdit = null;  // { areas: Set, pain, side, note, today } – solange die Seite offen ist
function complEditInit() {
  const e = currentComplaintEntry();
  const today = !!e && localDay(e.date) === localDay(new Date().toISOString());
  return { areas: new Set(e ? e.areas : []), pain: { ...((e && e.pain) || {}) }, side: { ...((e && e.side) || {}) }, note: today ? e.note || '' : '', today };
}
function complaintSummary() {
  const entries = [...data.complaints].sort((a, b) => a.date.localeCompare(b.date));
  const cur = currentComplaints();
  const now = cur || (entries.length ? entries[entries.length - 1].areas : []);
  return Object.keys(BODY_AREAS).filter(k => entries.some(e => e.areas.includes(k)) || data.painLog.some(z => z.area === k)).map(k => {
    let since = null;
    for (let i = entries.length - 1; i >= 0 && entries[i].areas.includes(k); i--) since = entries[i].date;
    const withK = entries.filter(e => e.areas.includes(k));
    const zw = data.painLog.filter(z => z.area === k).map(z => z.date);
    const dates = [...withK.map(e => e.date), ...zw].sort();
    const pts = painPoints(k);
    return { k, label: BODY_AREAS[k].label, now: now.includes(k), since, first: dates[0], last: dates[dates.length - 1],
      lastDiary: withK.length ? withK[withK.length - 1].date : null, n: withK.length, nZw: zw.length,
      pts, lastP: pts.length ? pts[pts.length - 1] : null, side: lastSideOf(k) };
  });
}
// Stärke 0–10 (die übliche Skala aus Arztpraxis und Physiotherapie); erneut antippen = Auswahl aufheben
function painScaleHtml(val, attrs) {
  let h = '<div class="pain-scale" role="group" aria-label="Stärke von 0 bis 10">';
  for (let v = 0; v <= 10; v++) h += `<button class="${val === v ? 'on' : ''}" ${attrs} data-v="${v}" aria-label="Stärke ${v}">${v}</button>`;
  return h + '</div><p class="pain-legend"><span>0 = gar nicht</span><span>10 = so stark wie vorstellbar</span></p>';
}
const sideSegHtml = (cur, attrs) => `<div class="seg three side-seg">${Object.entries(SIDES).map(([s, l]) =>
  `<button class="${cur === s ? 'on' : ''}" ${attrs} data-v="${s}">${l}</button>`).join('')}</div>`;
// kleine Verlaufslinie der Stärke (eine Reihe, keine Legende); Punkt antippen zeigt Datum und Wert
function painSpark(pts) {
  if (pts.length < 2) return '';
  const W = 320, H = 92, L = 24, R = 10, T = 10, B = 22;
  const t0 = Date.parse(pts[0].date), t1 = Math.max(Date.parse(pts[pts.length - 1].date), t0 + 86400000);
  const X = d => L + (Date.parse(d) - t0) / (t1 - t0) * (W - L - R), Y = p => T + (10 - p) / 10 * (H - T - B);
  const tip = p => `${fmtDate(p.date)} · ${p.pain}/10${p.ex ? ` · im Training bei ${p.ex}` : ''}`;
  return `<svg class="pain-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf der Stärke, ${pts.length} Werte">
    ${[0, 5, 10].map(v => `<line class="ps-grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text class="ps-ax" x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    <polyline class="ps-line" points="${pts.map(p => `${X(p.date).toFixed(1)},${Y(p.pain).toFixed(1)}`).join(' ')}"/>
    ${pts.map(p => `<g data-action="pain-pt" data-t="${esc(tip(p))}"><circle class="ps-hit" cx="${X(p.date).toFixed(1)}" cy="${Y(p.pain).toFixed(1)}" r="13"/>
      <circle class="ps-dot${p.ex ? ' ex' : ''}" cx="${X(p.date).toFixed(1)}" cy="${Y(p.pain).toFixed(1)}" r="4.5"><title>${esc(tip(p))}</title></circle></g>`).join('')}
    <text class="ps-ax" x="${L}" y="${H - 4}">${dShort(pts[0].date)}</text>
    <text class="ps-ax" x="${W - R}" y="${H - 4}" text-anchor="end">${dShort(pts[pts.length - 1].date)}</text>
  </svg><p class="ps-cap" hidden></p>`;
}
function renderComplaints() {
  if (!complEdit) complEdit = complEditInit();
  const E = complEdit;
  let h = `<div class="card compl-card"><h2>Wo zwickt es heute?</h2>
      <p class="hint explain">Tipp an, wo es zwickt, und gib – wenn du magst – Seite und Stärke an. Ein Eintrag pro Tag; die Hinweise im Training passen sich sofort an.</p>
      <div class="group-chips">${Object.entries(BODY_AREAS).map(([k, a]) =>
        `<button class="gchip ${E.areas.has(k) ? 'on' : ''}" data-action="compl-pick" data-k="${k}">${a.label}</button>`).join('')}</div>`;
  for (const k of Object.keys(BODY_AREAS).filter(k => E.areas.has(k))) {
    h += `<div class="compl-detail"><p class="compl-dt"><b>${BODY_AREAS[k].label}</b>${E.pain[k] != null ? `<span>${E.pain[k]}/10</span>` : '<span class="muted">Stärke?</span>'}</p>
      ${areaSided(k) ? sideSegHtml(E.side[k], `data-action="compl-side" data-k="${k}"`) : ''}
      ${painScaleHtml(E.pain[k], `data-action="compl-pain" data-k="${k}"`)}</div>`;
  }
  if (E.areas.size) {
    h += `<textarea class="inp compl-note" rows="2" data-field="compl-note"
      placeholder="Notiz für deinen Termin (freiwillig), z. B. „morgens steif, nach dem Training besser“">${esc(E.note)}</textarea>`;
  }
  if ([...E.areas].some(k => E.pain[k] >= PAIN_HIGH)) h += `<p class="compl-doc">${COMPL_HIGH_NOTE}</p>`;
  h += `<button class="btn primary" data-action="compl-save">${E.areas.size ? (E.today ? 'Eintrag von heute ändern' : 'Heute eintragen') : 'Speichern – nichts zwickt'}</button>
    </div>`;
  const sum = complaintSummary();
  if (!sum.length) return h + `<p class="hint">Bisher hast du keine Beschwerden angegeben. Die App fragt einmal pro Zyklus vor dem Training nach –
    und hier kannst du jederzeit selbst etwas eintragen.</p><p class="hint compl-disc">🩺 ${COMPL_DISCLAIMER}</p>`;
  h += `<button class="btn nav compl-rep-btn" data-action="compl-report">📄 Bericht für deinen Termin
    <small>Verlauf, betroffene Übungen und Notizen als Bild oder Text</small></button>`;
  const exNames = [...new Set(data.days.flatMap(d => d.exercises.map(e => e.name.trim()).filter(Boolean)))];
  h += '<h2>Verlauf</h2>';
  for (const x of sum.sort((a, b) => b.now - a.now || (b.last || '').localeCompare(a.last || ''))) {
    const hits = exNames.filter(n => areaHits(x.k, n));
    const exs = painExercises(x.k);
    const high = x.pts.some(p => p.pain >= PAIN_HIGH && daysSinceISO(localDay(p.date)) <= 14);
    const when = x.now ? `Seit ${fmtDate(x.since)}` : x.n ? `Zuletzt angegeben am ${fmtDate(x.lastDiary)}` : `Zuletzt am ${fmtDate(x.last)}`;
    h += `<div class="card compl-area ${x.now ? 'now' : 'gone'}">
        <p class="compl-head"><b>${areaName(x.k, x.side)}</b><span class="compl-badges">${x.lastP ? `<span class="compl-val">${x.lastP.pain}/10</span>` : ''}<span class="badge ${x.now ? 'warn' : 'ok'}">${x.now ? 'aktuell' : x.n ? 'abgeklungen ✓' : 'im Training notiert'}</span></span></p>
        <p class="hint">${when}${x.n ? ` · ${x.n}× im Tagebuch` : ''}${x.nZw ? ` · ${x.nZw}× im Training` : ''}.</p>
        ${painSpark(x.pts)}
        ${exs.length ? `<p class="compl-ex">Gezwickt bei: ${exs.map(e => `${esc(e.name)} ${e.n}×${e.max != null ? ` (bis ${e.max}/10)` : ''}`).join(', ')}</p>` : ''}
        ${x.now && hits.length ? `<p class="compl-ex">Betrifft im Plan: ${hits.map(esc).join(', ')}</p><p class="hint">Tipp: ${BODY_AREAS[x.k].tip}.</p>` : ''}
        ${high ? `<p class="compl-doc">${COMPL_HIGH_NOTE}</p>` : ''}
      </div>`;
  }
  const rows = [...data.complaints.map(e => ({ d: e.date, h: `<div><span>${fmtDate(e.date)}</span>
      <b>${e.areas.length ? e.areas.map(a => areaName(a, e.side && e.side[a]) + (e.pain && e.pain[a] != null ? ` ${e.pain[a]}/10` : '')).join(', ') : 'nichts'}</b>
      ${e.note ? `<small>„${esc(e.note)}“</small>` : ''}</div>` })),
    ...data.painLog.map(z => ({ d: z.date, h: `<div><span>${fmtDate(z.date)} · im Training</span>
      <b>🩹 ${areaName(z.area, z.side)}${z.pain != null ? ` ${z.pain}/10` : ''}</b><small>bei ${esc(z.ex)}</small></div>
      <button class="icon-btn" data-action="pain-del" data-id="${z.id}" aria-label="Eintrag löschen">✕</button>` }))]
    .sort((a, b) => b.d.localeCompare(a.d));
  h += `<details class="card about-sec compl-log"><summary><b>Alle Angaben</b><small>${rows.length}</small></summary>
    <ul class="list">${rows.map(r => `<li class="compl-row">${r.h}</li>`).join('')}</ul></details>
    <p class="hint compl-disc">🩺 ${COMPL_DISCLAIMER}</p>`;
  return h;
}
// Ansicht und Aktionen: views.complaints / complreport / compl-* / pain-* stehen hinter der Definition von views bzw. actions (weiter unten)
// Verlauf → Kalender: Zeile mit dem aktuellen Stand – auch ohne Angaben, damit man das Tagebuch jederzeit beginnen kann
function complaintsHistBtn() {
  const sum = complaintSummary();
  const now = sum.filter(x => x.now);
  const txt = !sum.length ? 'Schmerzen und Beschwerden festhalten – z. B. für deinen nächsten Termin'
    : now.length ? now.map(x => `${areaName(x.k, x.side)} seit ${fmtDate(x.since)}${x.lastP ? ` · ${x.lastP.pain}/10` : ''}`).join(' · ') : 'Zurzeit nichts – alles abgeklungen ✓';
  return `<button class="btn nav compl-btn" data-action="compl-open" data-from="history">🩹 Beschwerden<small>${txt}</small></button>`;
}

/* „Zwickt“ im Training (v209): je Übung festhalten, wo und wie stark – landet im Beschwerde-Tagebuch */
let painQuick = null;  // { ei, area, pain, side } – offenes Eingabefeld im Training
function painTrainingHtml(en, ei, affected) {
  const day = localDay(draft.date);
  const noted = data.painLog.filter(z => nameKey(z.ex) === nameKey(en.name) && localDay(z.date) === day);
  let h = noted.map(z => `<p class="pain-noted"><span>🩹 Notiert: ${areaName(z.area, z.side)}${z.pain != null ? ` · ${z.pain}/10` : ''}</span>
    <button class="icon-btn" data-action="pain-del" data-id="${z.id}" aria-label="Eintrag löschen">✕</button></p>`).join('');
  if (painQuick && painQuick.ei === ei) {
    const q = painQuick;
    return h + `<div class="pain-quick">
      <p class="lbl">Wo zwickt es?</p>
      <div class="group-chips">${Object.entries(BODY_AREAS).map(([k, a]) =>
        `<button class="gchip ${q.area === k ? 'on' : ''}" data-action="pain-area" data-k="${k}">${a.label}</button>`).join('')}</div>
      ${q.area && areaSided(q.area) ? sideSegHtml(q.side, 'data-action="pain-side"') : ''}
      <p class="lbl">Wie stark? <small>freiwillig</small></p>
      ${painScaleHtml(q.pain, 'data-action="pain-val"')}
      ${q.pain >= PAIN_HIGH ? `<p class="compl-doc">${COMPL_HIGH_NOTE}</p>` : ''}
      <div class="row"><button class="btn" data-action="pain-cancel">Abbrechen</button>
        <button class="btn primary" data-action="pain-save" ${q.area ? '' : 'disabled'}>Eintragen</button></div>
      <p class="hint">Bei Schmerz den Satz lieber abbrechen. Der Eintrag landet in deinem Beschwerde-Tagebuch (Verlauf → Beschwerden).</p>
    </div>`;
  }
  if (affected && !noted.length) h += `<button class="link-btn pain-link" data-action="pain-open" data-ei="${ei}">🩹 Zwickt es heute? Kurz eintragen</button>`;
  return h;
}

/* Bericht für den Termin (v209): Bild (Teilen/Speichern) oder Text – Zeitraum 4, 8 oder 12 Wochen */
function complReportData(weeks) {
  const d = new Date();
  d.setDate(d.getDate() - weeks * 7); d.setHours(0, 0, 0, 0);
  const from = d.toISOString(), cur = currentComplaints() || [];
  const diary = data.complaints.filter(e => e.date >= from);
  const keys = Object.keys(BODY_AREAS).filter(k => cur.includes(k) || diary.some(e => e.areas.includes(k)) || data.painLog.some(z => z.area === k && z.date >= from));
  const areas = keys.map(k => {
    const pts = painPoints(k, from);
    return { k, side: lastSideOf(k), now: cur.includes(k), pts, nDiary: diary.filter(e => e.areas.includes(k)).length,
      exs: painExercises(k, from).map(x => ({ ...x, w: exWeights(x.name, from) })) };
  });
  const notes = diary.filter(e => (e.note || '').trim()).map(e => ({ date: e.date, note: e.note.trim() })).sort((a, b) => a.date.localeCompare(b.date));
  return { weeks, from, areas, notes, sessions: data.sessions.filter(s => s.date >= from).length, name: ((data.profile || {}).name || '').trim() };
}
function complReportText(R) {
  const L = [`Beschwerde-Tagebuch${R.name ? ` – ${R.name}` : ''}`,
    `Zeitraum: ${fmtDate(R.from)} bis ${fmtDate(new Date().toISOString())} (${R.weeks} Wochen) · ${R.sessions} Trainings`, ''];
  if (!R.areas.length) L.push('Im Zeitraum gibt es keine Einträge.', '');
  for (const a of R.areas) {
    L.push(`${areaName(a.k, a.side)}${a.now ? ' (aktuell)' : ''}`);
    L.push(a.pts.length ? `- Stärke: ${a.pts.map(p => `${dShort(p.date)} ${p.pain}/10${p.ex ? ' (Training)' : ''}`).join(', ')}` : '- ohne Angabe der Stärke');
    for (const x of a.exs) {
      L.push(`- Gezwickt bei ${x.name}: ${x.n}×${x.max != null ? `, bis ${x.max}/10` : ''}`);
      if (x.w) L.push(`  Trainingsgewicht: ${shareSetText(x.w.first.set)} (${dShort(x.w.first.date)})${x.w.n > 1 ? ` → ${shareSetText(x.w.last.set)} (${dShort(x.w.last.date)})` : ''}`);
    }
    L.push('');
  }
  if (R.notes.length) { L.push('Notizen:'); R.notes.forEach(n => L.push(`- ${dShort(n.date)}: „${n.note}“`)); L.push(''); }
  L.push(`Selbst erfasst mit ${APP_NAME}. ${COMPL_DISCLAIMER}`);
  return L.join('\n');
}
// Bild: weißer Hintergrund (gut zu drucken), Akzentfarbe der Farbwelt nur für Linie und Kopf
function complReportCanvas(R) {
  const W = 1080, X = 80, MAXH = 9000, IW = W - 2 * X;
  const c = document.createElement('canvas');
  c.width = W; c.height = MAXH;
  const g = c.getContext('2d');
  const acc = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#3a6df0';
  const INK = '#1d1d1f', MUTED = '#5f6368', LINE = '#dcdfe4';
  const F = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const wrap = (t, max) => {
    const out = [];
    let line = '';
    for (const w of String(t).split(/\s+/)) {
      const test = line ? `${line} ${w}` : w;
      if (line && g.measureText(test).width > max) { out.push(line); line = w; } else line = test;
    }
    if (line) out.push(line);
    return out;
  };
  let y = 0;
  const text = (t, font, color, lh, max = IW, x = X) => { g.font = font; g.fillStyle = color; for (const l of wrap(t, max)) { y += lh; g.fillText(l, x, y); } };
  const rule = () => { y += 34; g.fillStyle = LINE; g.fillRect(X, y, IW, 3); };
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, MAXH);
  g.fillStyle = acc; g.fillRect(0, 0, W, 16);
  g.textBaseline = 'alphabetic';
  y = 40;
  text('Beschwerde-Tagebuch', F(800, 64), INK, 84);
  if (R.name) text(R.name, F(600, 40), INK, 56);
  text(`${fmtDate(R.from)} bis ${fmtDate(new Date().toISOString())} · ${R.weeks} Wochen · ${R.sessions} Trainings`, F(500, 32), MUTED, 50);
  rule();
  if (!R.areas.length) text('Im gewählten Zeitraum gibt es keine Einträge.', F(500, 36), INK, 80);
  for (const a of R.areas) {
    y += 20;
    text(areaName(a.k, a.side), F(800, 48), INK, 76, IW - 260);
    g.font = F(700, 30); g.fillStyle = MUTED; g.textAlign = 'right';
    g.fillText(a.now ? 'AKTUELL' : 'ABGEKLUNGEN', W - X, y); g.textAlign = 'left';
    const lp = a.pts[a.pts.length - 1];
    text(lp ? `Zuletzt ${lp.pain}/10 am ${fmtDate(lp.date)} · ${a.pts.length} ${a.pts.length === 1 ? 'Wert' : 'Werte'}` : 'Ohne Angabe der Stärke', F(500, 32), MUTED, 50);
    if (a.pts.length) {
      // Diagramm: Stärke 0–10 über den Zeitraum
      const top = y + 36, ch = 250, cl = X + 50, cr = W - X - 10;
      const t0 = Date.parse(R.from), t1 = Date.now();
      const PX = d => cl + (Date.parse(d) - t0) / (t1 - t0) * (cr - cl), PY = p => top + (10 - p) / 10 * ch;
      g.font = F(500, 26);
      for (const v of [0, 5, 10]) {
        g.fillStyle = LINE; g.fillRect(cl, PY(v) - 1, cr - cl, 2);
        g.fillStyle = MUTED; g.textAlign = 'right'; g.fillText(String(v), cl - 14, PY(v) + 9); g.textAlign = 'left';
      }
      g.strokeStyle = acc; g.lineWidth = 5; g.lineJoin = 'round'; g.beginPath();
      a.pts.forEach((p, i) => { const px = PX(p.date), py = PY(p.pain); if (i) g.lineTo(px, py); else g.moveTo(px, py); });
      if (a.pts.length > 1) g.stroke();
      for (const p of a.pts) {
        g.beginPath(); g.arc(PX(p.date), PY(p.pain), 11, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
        g.beginPath(); g.arc(PX(p.date), PY(p.pain), 8, 0, Math.PI * 2); g.fillStyle = acc; g.fill();
      }
      g.fillStyle = MUTED; g.font = F(500, 26);
      g.fillText(dShort(R.from), cl, top + ch + 42);
      g.textAlign = 'right'; g.fillText('heute', cr, top + ch + 42); g.textAlign = 'left';
      y = top + ch + 50;
    }
    if (a.exs.length) {
      text('Gezwickt bei', F(700, 34), INK, 62);
      for (const x of a.exs) {
        text(`${x.name} – ${x.n}×${x.max != null ? `, bis ${x.max}/10` : ''}`, F(500, 32), INK, 46);
        if (x.w) text(`Trainingsgewicht: ${shareSetText(x.w.first.set)} (${dShort(x.w.first.date)})${x.w.n > 1 ? ` → ${shareSetText(x.w.last.set)} (${dShort(x.w.last.date)})` : ''}`, F(500, 28), MUTED, 40, IW - 30, X + 30);
      }
    }
    rule();
  }
  if (R.notes.length) {
    y += 20;
    text('Notizen', F(800, 44), INK, 70);
    for (const n of R.notes) text(`${dShort(n.date)}: „${n.note}“`, F(500, 32), INK, 46);
    rule();
  }
  y += 10;
  text(`🩺 ${COMPL_DISCLAIMER}`, F(500, 28), MUTED, 42);
  text(`Selbst erfasst mit ${APP_NAME} · erstellt am ${fmtDate(new Date().toISOString())}`, F(600, 28), MUTED, 52);
  const H = Math.min(MAXH, Math.ceil(y + 70));
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  out.getContext('2d').drawImage(c, 0, 0);
  return out;
}
function renderComplReport({ weeks = 8 }) {
  return `<div class="seg three rep-weeks">${[4, 8, 12].map(w =>
      `<button class="${w === weeks ? 'on' : ''}" data-action="crep-weeks" data-w="${w}">${w} Wochen</button>`).join('')}</div>
    <div class="share-wrap"><img class="share-img rep-img" id="share-img" alt="Bericht deiner Beschwerden"></div>
    <div class="row"><button class="btn primary" data-action="crep-send" disabled>📤 Bild teilen</button>
      <button class="btn" data-action="share-save" disabled>Bild speichern</button></div>
    <button class="btn" data-action="crep-text">📝 Als Text teilen</button>
    <p class="hint">🔒 Der Bericht enthält Gesundheitsdaten. Teile ihn nur mit Menschen, denen du vertraust – z. B. deiner Ärztin, deinem Arzt
      oder in der Physiotherapie. Der Hinweis, dass die App nur dokumentiert, steht im Bericht mit drin.</p>`;
}
function complReportDraw({ weeks = 8 }) {
  const img = document.getElementById('share-img');
  if (!img) return;
  img.src = canvasToShare(complReportCanvas(complReportData(weeks)), `Beschwerde-Bericht ${localDay(new Date().toISOString())}.jpg`);
  $view.querySelectorAll('[data-action="crep-send"], [data-action="share-save"]').forEach(b => { b.disabled = false; });
}

/* ---------- Stillstand erkennen ---------- */

// Geschätztes Max. bei 10 Wdh. pro Übung und abgeschlossenem Zyklus (Deload zählt nicht).
// Weniger als 1 % Zuwachs gegenüber dem Zyklus davor = Stillstand.
// Diät und Minicut (User 2026-11-13): Im Kaloriendefizit ist Kraft halten normal – dann keine Stillstand-Hinweise
// und Trainings aus einer Diät- bzw. Minicut-Zeit zählen auch danach nicht für den Vergleich
const DEFICIT_PHASES = ['diet', 'minicut'];
const inDeficitPhase = () => !!(data.nutrition && DEFICIT_PHASES.includes(data.nutrition.phase));
function phaseOnDate(iso) {
  const n = data.nutrition, d = String(iso).slice(0, 10);
  if (!n) return null;
  if (n.since && d >= n.since) return n.phase;
  const h = (n.history || []).find(x => d >= x.from && d < x.to);
  return h ? h.phase : null;
}
function stagnationHints() {
  if (inDeficitPhase()) return [];
  const ci = cycleInfo();
  const byEx = {};
  for (const s of data.sessions) {
    if (s.deload) continue;
    if (DEFICIT_PHASES.includes(phaseOnDate(s.date))) continue;
    const cs = sessionCycle(s).cycleStart;
    if (cs >= ci.cycleStart) continue;  // nur abgeschlossene Zyklen
    s.entries.forEach((e, ei) => {
      const fat = sessionFat(s, ei);  // auf frisch umgerechnet (Vorermüdung)
      const est = e.sets.filter(x => !x.variant && x.weight != null && x.reps != null)
        .map(x => x.weight / repFactor(x.reps + (x.rir != null ? x.rir : 0)) / (1 - fat));
      if (!est.length) return;
      const k = nameKey(e.name);
      const o = byEx[k] = byEx[k] || { name: e.name, cycles: {} };
      o.cycles[cs] = Math.max(o.cycles[cs] || 0, ...est);
    });
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
      <small>Rechts: Scheiben pro Seite (Stange ${barKg()} kg)</small>`;
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
  const bar = barKg();
  if (!work || work <= bar) return [];
  const list = [bar];
  let w = bar;
  while (work - w >= 20 && w + 20 < work) { w += 20; list.push(w); }
  if (w + 10 < work) list.push(w + 10);
  return list;
}

// Wiederholungen beim Aufwärmen: Stange 10, danach weniger, je näher am Arbeitsgewicht
function warmupReps(w, work) {
  if (w <= barKg()) return 10;
  const p = w / work;
  return p <= 0.5 ? 8 : p <= 0.7 ? 5 : p <= 0.85 ? 3 : 2;
}

// Scheiben-Rechner (v204, User-Wunsch 2026-11-11): Stange und vorhandene Scheiben einstellbar (profile.plates = { bar, have })
const PLATE_ALL = [25, 20, 15, 10, 5, 2.5, 1.25, 0.5];
const BAR_OPTS = [20, 15, 10];
const barKg = () => { const b = ((data.profile || {}).plates || {}).bar; return BAR_OPTS.includes(b) ? b : BAR_KG; };
const platesHave = () => {
  const h = ((data.profile || {}).plates || {}).have;
  return Array.isArray(h) && h.length ? PLATE_ALL.filter(p => h.includes(p)) : PLATES;
};
const isBarbellEx = en => /langhantel/.test(norm(en.name));
// Zeile im Training: Scheiben für den nächsten offenen Satz (alle erledigt: letzter Satz)
function platesLineText(en) {
  const s = en.sets.find(x => !isDone(x)) || en.sets[en.sets.length - 1];
  const w = s && parseNum(s.weight);
  return w ? `🏋️ Scheiben je Seite (${fmtNum(w)} kg): <b>${platesPerSide(w)}</b>` : '';
}
function platesSync(ei) {
  const el = $view.querySelector(`[data-plates-line="${ei}"]`);
  if (!el) return;
  const t = platesLineText(draft.entries[ei]);
  el.innerHTML = t;
  el.hidden = !t;
}
// Optionen: Stange und Scheiben
function platesCard() {
  const bar = barKg(), have = platesHave();
  return `<div class="card plates-card">
      <h2>Langhantel</h2>
      <p class="lbl">Stange</p>
      <div class="seg three">${BAR_OPTS.map(b => `<button class="${bar === b ? 'on' : ''}" data-action="plates-bar" data-v="${b}">${b} kg</button>`).join('')}</div>
      <p class="lbl">Deine Scheiben</p>
      <div class="variants plate-chips">${PLATE_ALL.map(p => `<button class="vchip ${have.includes(p) ? 'on' : ''}" data-action="plates-toggle" data-v="${p}">${fmtNum(p)}</button>`).join('')}</div>
      <p class="hint explain">Danach rechnet die App bei Langhantel-Übungen aus, welche Scheiben auf jede Seite gehören – im Training und beim Aufwärmen.
        Passt es nicht genau, steht der Rest in Klammern.</p>
    </div>`;
}

// Scheiben pro Seite, z. B. 80 kg -> „25 + 5“
function platesPerSide(total) {
  let rest = Math.round((total - barKg()) / 2 * 100) / 100;
  if (rest <= 0) return 'nur Stange';
  const out = [];
  for (const p of platesHave()) {
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
  exercise: { title: p => p.name,     tab: 'history', back: p => [p.from || 'history', p.fromParams || {}], render: renderExercise,
    after: () => drawChart() },  // v203: Diagramm der Übung oben (charts.js)
  week:     { title: 'Trainingswoche', tab: 'start',  back: 'start', render: renderWeek },
  library:  { title: 'Übungsbibliothek', tab: 'plan', back: 'plan', render: renderLibrary },
  homeeq:   { title: 'Deine Ausrüstung', tab: 'plan', back: 'plan', render: () => renderHomeEq() },  // steht in wizard.js (später geladen)
  // Übung aus der Bibliothek: zurück dorthin, woher sie geöffnet wurde (from/fromParams)
  libadd:   { title: p => p.name ? 'Eigene Übung bearbeiten' : 'Eigene Übung', tab: 'plan',
    back: p => p.ret && swapReturn ? [swapReturn.view, swapReturn.params] : p.name ? ['libex', { name: p.name }] : ['library', {}], render: renderLibAdd },
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
  pausecheck: { title: 'Wieder da', tab: 'start', back: 'start', render: p => renderPauseCheck(p) },
  cyclefeel: { title: 'Neuer Zyklus', tab: 'start', back: 'start', render: p => renderCycleFeel(p) },
  entryweek: { title: 'Neuer Plan',      tab: 'start', back: 'start', render: renderEntryWeek, cancel: () => CANCEL_START },
  data:     { title: 'Optionen',      tab: 'data',    render: renderData, after: () => { showAppVersion(); storageInfoFill(); persistFill(); } },
};

/* ---------- Erklärtexte einklappen (v209, User-Wunsch 2026-11-11) ---------- */
// Längere Erklärungen (class="hint explain") stehen bei den ersten EXPLAIN_AFTER Besuchen einer Seite offen, danach klappen sie zu
// einem kleinen „? Erklärung“ zusammen – in allen Modi (v218, User 2026-11-12: 2 Besuche, auch Einfach). Warnungen, Status und
// Sicherheitshinweise sind bewusst NICHT markiert. Besuche je Seite (Optionen je Bereich) zählt das Gerät
// (localStorage, gehört nicht in die Sicherung). „Alle Einführungen noch einmal zeigen“ setzt sie zurück.
const VISIT_KEY = 'trainingsapp-besuche', EXPLAIN_AFTER = 2;
let explainOpen = new Set();  // auf dieser Seite wieder aufgeklappte Erklärungen (bis zum Seitenwechsel)
const visitKey = (view, p) => view + (p && p.sec ? ':' + p.sec : '');
function visitsLoad() {
  try { const o = JSON.parse(localStorage.getItem(VISIT_KEY)); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
function visitAdd(k) {
  const o = visitsLoad();
  o[k] = Math.min(99, (o[k] || 0) + 1);
  try { localStorage.setItem(VISIT_KEY, JSON.stringify(o)); } catch (e) { /* ohne Speicher bleibt alles offen */ }
}
function visitsReset() { try { localStorage.removeItem(VISIT_KEY); } catch (e) { /* egal */ } }
const explainKeep = () => !!(data.profile && data.profile.explainKeep);
const explainId = p => p.textContent.replace(/\s+/g, ' ').trim().slice(0, 80);
function explainFold() {
  if (explainKeep()) return;
  if ((visitsLoad()[visitKey(current.view, current.params)] || 0) <= EXPLAIN_AFTER) return;
  $view.querySelectorAll('.explain').forEach(p => {
    if (explainOpen.has(explainId(p))) return;
    p.classList.add('folded');
    p.insertAdjacentHTML('beforebegin', '<button class="explain-q" data-action="explain-show" aria-expanded="false">? Erklärung</button>');
  });
}
function explainCard() {
  const keep = explainKeep();
  return `<div class="card"><h2>❔ Erklärtexte</h2>
      <div class="seg two"><button class="${keep ? '' : 'on'}" data-action="explain-mode" data-v="0">Einklappen</button>
        <button class="${keep ? 'on' : ''}" data-action="explain-mode" data-v="1">Immer zeigen</button></div>
      <p class="hint">Längere Erklärungen klappen ab dem dritten Besuch einer Seite zu einem kleinen „? Erklärung“ zusammen – antippen
        zeigt sie wieder. Warnungen und wichtige Hinweise bleiben immer sichtbar.</p></div>`;
}

function go(view, params = {}) {
  exRename = null;  // offenes Umbenennen-Feld schließt beim Wechsel der Ansicht
  if (!current || current.view !== view || (params.id && params.id !== current.params.id)) dayReorder = null;
  const vk = visitKey(view, params);
  if (!current || visitKey(current.view, current.params) !== vk) { visitAdd(vk); explainOpen = new Set(); painQuick = null; }
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
  syncTrHead();
  const tab = typeof v.tab === 'function' ? v.tab(current.params) : v.tab;
  document.querySelectorAll('#tabs button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  $view.innerHTML = v.render(current.params);
  if (v.after) v.after(current.params);  // z. B. Diagramm zeichnen, wenn die Breite bekannt ist
  explainFold();  // v209: Erklärtexte ab dem 4. Besuch einklappen
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
    ? (feat('tr-rir-input') ? `Halbe Sätze, 15 % weniger Gewicht oder weniger Wdh. als in der letzten Trainingswoche, mind. ${DELOAD_RIR} Wdh. im Tank. Danach beginnt der nächste Zyklus.`
      : 'Halbe Sätze und etwas leichter – jeder Satz sollte sich locker anfühlen. Danach beginnt der nächste Zyklus.')
    : shiftText(ci.cycleStart, ci.week) && !ci.extra
      ? `${ci.intro ? 'Start-Sätze laut Plan. ' : ''}${shiftText(ci.cycleStart, ci.week)}`
    : ci.intro
      ? (ci.cycle === 1 ? 'Du steigst etwas leichter ein und findest deine Gewichte.'
        : feat('tr-rir-input') ? `Start-Sätze laut Plan. Werte der letzten Intro-Woche, je Satz +1 Wdh. pro ${cmpWeeksPerRep()} Wochen Abstand.`
        : 'Start-Sätze laut Plan. Die App schlägt dir passende Werte vor.')
      : ci.extra
        ? (feat('tr-rir-input') ? 'Weiter mit Sätzen und Tank der letzten Aufbauwoche – Gewicht und Wdh. steigen weiter, bis du den Deload einlegst.'
          : 'Weiter wie in der letzten Aufbauwoche, bis du den Deload einlegst.')
        : ci.cycle === 1 ? 'Die App baut auf deinen Werten der Vorwoche auf.'
        : feat('tr-rir-input') ? `Werte derselben Woche im letzten Zyklus, je Satz +1 Wdh. pro ${cmpWeeksPerRep()} Wochen Abstand.`
        : 'Die App schlägt dir passende Werte vor.';
  const wp = weekProgression(roundKey(ci.cycleStart, ci.week));
  const off = ci.deload ? '' : progOffText({ ...wp, volume: wp.volume || ci.week === 1 });
  // v201 (User-Wunsch 2026-11-11): zugeklappt nur Kopf, Wochen und Stand; Erklärung, offene Tage und „Zyklus anpassen“
  // nach Antippen des Kopfes (profile.cycOpen wird gemerkt). Deload-Knopf und Progressions-Hinweis bleiben immer sichtbar.
  const open = cycOpen();
  const status = roundStatus(ci);
  return `<div class="card cycle ${ci.deload ? 'is-deload' : ''} ${open ? 'open' : 'compact'}">
    <div class="cyc-head" data-action="cyc-toggle" role="button" tabindex="0" aria-expanded="${open}">
      <h2>${head}</h2><span class="chev" aria-hidden="true">▾</span></div>
    ${cyclePills(ci, 'week-open')}
    <p class="round-status">🔄 ${open ? status : status.split(' · offen: ')[0]}</p>
    ${open ? `<p class="sub">${sub} Eine Woche ist geschafft, sobald ${roundDoneText()} – egal, wie viele Tage du dafür brauchst.</p>` : ''}
    ${off ? `<p class="prog-note">⏸ Diese Woche ${off}</p>` : ''}
    ${self && !ci.deload ? `<button class="btn outline deload-btn" data-action="deload-now">😮‍💨 Deload-Woche einlegen</button>
      ${open ? '<p class="tap-hint">Deload selbst bestimmen: Leg ihn ein, wann du ihn brauchst.</p>' : ''}` : ''}
    ${open ? `<p class="tap-hint">Woche antippen: Trainings ansehen – künftige Wochen zeigen, was geplant ist</p>
    ${cycleAdjustHtml(ci)}` : ''}
  </div>`;
}
const cycOpen = () => !!(data.profile && data.profile.cycOpen) || cycAdjustOpen;

// Start-Bildschirm: Stillstand-Hinweise und Beschwerden dieses Zyklus
function hintsCard() {
  const hints = feat('stall-hints') ? stagnationHints() : [];
  const areas = currentComplaints() || [];
  if (!hints.length && !areas.length) return '';
  let h = '<div class="card hints"><h2>💡 Hinweise</h2>';
  if (areas.length) {
    const ce = currentComplaintEntry() || {};
    h += `<p><b>Beschwerden in diesem Zyklus:</b> ${areas.map(a => areaName(a, ce.side && ce.side[a]) + (ce.pain && ce.pain[a] != null ? ` (${ce.pain[a]}/10)` : '')).join(', ')}.
      Betroffene Übungen sind im Training markiert. Bei Schmerzen den Satz abbrechen.</p>
      <button class="btn small compl-link" data-action="compl-open" data-from="start">Besser geworden? Verlauf & ändern</button>`;
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

/* ---------- Zum Home-Bildschirm (v198, User-Wunsch 2026-11-10) ---------- */
// Als App auf dem Home-Bildschirm löscht das iPhone die Daten nicht nach 7 Tagen ohne Besuch (Safari-Regel für Websites),
// und Android sagt eher „dauerhafter Speicher“ zu. Wichtig: Auf dem iPhone hat die Home-Bildschirm-App einen EIGENEN Speicher,
// getrennt von Safari – wer schon Daten hat, muss sie per Sicherung mitnehmen. Android teilt den Speicher, dort kein Umzug.
const isStandalone = () => (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /Android/.test(navigator.userAgent);
const hasOwnData = () => data.sessions.length > 0 || data.plans.length > 0;
let installEvt = null;  // Android/Chrome: gemerktes „beforeinstallprompt“ -> eigener Knopf „Jetzt installieren“
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installEvt = e;
  if (current && (current.view === 'start' || current.view === 'data')) render();
});
window.addEventListener('appinstalled', () => { installEvt = null; toast('App installiert ✔'); if (current) render(); });
const INSTALL_SNOOZE = 7;
const SHARE_ICON = '<svg class="ios-share" viewBox="0 0 24 24" aria-label="Teilen-Symbol"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M7 10H5.5A1.5 1.5 0 0 0 4 11.5v8A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H17"/></svg>';

// Anleitung je nach Gerät (Startkarte und Optionen)
function installStepsHtml() {
  if (isAndroid()) {
    if (installEvt) return '<button class="btn primary" data-action="install-now">📲 Jetzt installieren</button>';
    return `<ol class="install-steps"><li>Oben rechts auf das Menü <b>⋮</b> tippen.</li>
      <li><b>„App installieren“</b> oder <b>„Zum Startbildschirm hinzufügen“</b> wählen.</li><li>Bestätigen – fertig.</li></ol>`;
  }
  const move = hasOwnData() ? `<li><b>Zuerst sichern:</b> Auf dem iPhone hat die App auf dem Home-Bildschirm einen eigenen Speicher und
      startet dort leer. Exportiere deshalb jetzt eine Sicherung und importiere sie danach dort unter Optionen → Deine Daten → „Sicherung importieren“.
      <button class="btn outline" data-action="export">Sicherung exportieren</button></li>` : '';
  return `<ol class="install-steps">${move}
    <li>Unten in Safari auf das Teilen-Symbol ${SHARE_ICON} tippen (iPad: oben rechts).</li>
    <li>Etwas nach unten scrollen und <b>„Zum Home-Bildschirm“</b> wählen.</li>
    <li>Oben rechts auf <b>„Hinzufügen“</b> tippen. Ab jetzt die App über das Symbol auf dem Home-Bildschirm öffnen.</li></ol>`;
}
const installWhy = () => isIOS()
  ? 'Dann öffnet sie im Vollbild wie eine normale App – und das iPhone löscht deine Daten nicht, wenn du die App mal länger als 7 Tage nicht öffnest. Bei Websites in Safari tut es das.'
  : 'Dann öffnet sie im Vollbild wie eine normale App, hat ein eigenes Symbol, und dein Handy behandelt deine Daten als dauerhaft.';

// Startbildschirm: nur auf dem Handy im Browser, mit „Später“ und „Nicht mehr zeigen“
function installCard() {
  if (isStandalone() || !(isIOS() || isAndroid()) || data.installHide || daysSinceISO(data.installSnooze) < INSTALL_SNOOZE) return '';
  return `<div class="card hints install-card"><p><b>📲 Hol dir die App auf den Home-Bildschirm</b></p>
      <p class="hint">${installWhy()}</p>
      ${installStepsHtml()}
      <div class="row"><button class="btn" data-action="install-later">Später</button>
        <button class="btn" data-action="install-hide">Nicht mehr zeigen</button></div></div>`;
}
// Optionen: immer da, solange die App nicht vom Home-Bildschirm läuft (auch nach „Nicht mehr zeigen“)
function installOptionsCard() {
  if (isStandalone() || !(isIOS() || isAndroid())) return '';
  return `<details class="card about-sec install-opt"><summary><b>📲 Zum Home-Bildschirm hinzufügen</b></summary>
      <p class="hint">${installWhy()}</p>${installStepsHtml()}</details>`;
}
// iPhone, App vom Home-Bildschirm, noch leer: vielleicht vorher in Safari benutzt -> Sicherung importieren anbieten
function iosMoveCard() {
  if (!isIOS() || !isStandalone() || hasOwnData() || data.moveHintSeen) return '';
  return `<div class="card hints"><p><b>📂 Hast du die App vorher in Safari benutzt?</b></p>
      <p class="hint">Auf dem iPhone hat die App auf dem Home-Bildschirm einen eigenen Speicher. Deine bisherigen Daten holst du mit
        der Sicherung, die du in Safari exportiert hast.</p>
      <div class="row"><button class="btn primary" data-action="import">Sicherung importieren</button>
        <button class="btn" data-action="move-hint-no">Nein, ich fange neu an</button></div>
      <input type="file" id="import-file" accept="application/json,.json" hidden></div>`;
}

// Nach dem Speichern eines Trainings: Sicherung anbieten, wenn sie fällig ist (ab dem 2. Training)
function backupAfterTrainingCard() {
  if (data.sessions.length < 2 || !backupDue()) return '';
  return `<div class="card hints backup-after"><p><b>💾 Gleich mitsichern?</b></p>
      <p class="hint">${backupAgoText()} Ein Tipp genügt – auf dem iPhone dann „In Dateien sichern“ wählen.</p>
      <button class="btn primary" data-action="export">Jetzt sichern</button></div>`;
}

/* ---------- Motivation (v208, User-Wunsch 2026-11-11) ---------- */
// profile.motiv: 'soft' (freundlich, Standard) | 'hard' (fordernd) | 'off'. Zwei Varianten gibt es nur für Motivations-Texte –
// Erklärungen, Zahlen und Warnungen bleiben sachlich. Auch „fordernd“ nie abwertend: kein Vorwurf, keine Warnfarben.
// Bei neuem Rekord steht in beiden Varianten die Freude vorn (User-Wunsch).
const MOTIV_OPTS = { soft: ['🤗', 'Freundlich', 'Mit Lob, ohne Druck'], hard: ['🔥', 'Fordernd', 'Klare Ansagen, die mich antreiben'],
  off: ['🔕', 'Gar nicht', 'Keine solchen Hinweise'] };
const motivMode = () => { const m = (data.profile || {}).motiv; return MOTIV_OPTS[m] ? m : 'soft'; };
const MOTIV = {
  weekPart: { soft: (d, t) => `${d} von ${t} Trainings diese Woche – stark! 💪`,
    hard: (d, t) => `${d} von ${t}. ${t - d === 1 ? 'Eins fehlt noch' : `${t - d} fehlen noch`} – zieh's durch.` },
  weekDone: { soft: () => 'Woche geschafft! Gönn dir die Erholung.',
    hard: (d, t) => `${d === t ? `${d} von ${t}.` : 'Woche komplett.'} Genau so – nächste Woche wieder.` },
  pb: { soft: (ex, more) => `Neue Bestleistung bei ${ex}${more} – richtig gut!`,
    hard: (ex, more) => `Neue Bestleistung bei ${ex}${more} – du siehst: Die harte Arbeit zahlt sich aus!` },
  back: { soft: day => `Schön, dass du da bist! Als Nächstes wartet <b>${day}</b> – wann immer es dir passt.`,
    hard: (day, n) => `${n} Tage ohne Training. <b>${day}</b> wartet – heute ist ein guter Tag dafür.` },
  short: { soft: () => 'Wenig Zeit heute? Die App kürzt das Training auf deine Minuten.',
    hard: () => 'Wenig Zeit ist kein Grund auszulassen – die App kürzt das Training auf deine Minuten.' },
  deload: { soft: () => 'Leichte Woche – dein Körper baut jetzt auf. Genieß es.',
    hard: () => 'Deload ist Teil des Plans. Leicht trainieren, nicht auslassen.' },
};
const motivText = (k, ...a) => MOTIV[k][motivMode() === 'hard' ? 'hard' : 'soft'](...a);
const shortExName = n => esc(String(n).replace(/\s*\([^()]*\)$/, ''));
// Nächster offener Trainingstag (wie auf der Startseite: ab dem zuletzt trainierten Tag weiter)
function nextOpenDay(ci = cycleInfo()) {
  const open = new Set(roundOpen(ci.cycleStart, ci.week).map(x => x.day.id));
  const lastOwn = sessionsNewestFirst().find(s => findDay(s.dayId));
  const from = lastOwn ? data.days.indexOf(findDay(lastOwn.dayId)) + 1 : 0;
  return data.days.map((_, i) => data.days[(from + i) % data.days.length]).find(d => open.has(d.id)) || null;
}
// Gleich nach dem Speichern eines Trainings (Trainingsansicht, fresh): Rekorde und Stand der Woche
function motivAfterHtml(s) {
  if (motivMode() === 'off') return '';
  const lines = [];
  const pbs = typeof shareData === 'function' ? shareData(s).pbs : [];
  if (pbs.length) lines.push(motivText('pb', shortExName(pbs[0].name), pbs.length > 1 ? ` und ${pbs.length - 1} weiteren Übung${pbs.length === 2 ? '' : 'en'}` : ''));
  if (s.deload) lines.push(motivText('deload'));
  else if (s.cycleStart && !ownPlan()) {
    const total = activeDays().reduce((a, d) => a + dayTimes(d, s.week), 0);
    const left = roundOpen(s.cycleStart, s.week).reduce((a, x) => a + x.left, 0);
    const done = roundSessions(s.cycleStart, s.week).length;
    if (total) lines.push(left ? motivText('weekPart', Math.min(done, total), total) : motivText('weekDone', Math.min(done, total), total));
  }
  return lines.length ? `<div class="card motiv-card ${motivMode()}">${lines.map(l => `<p>${l}</p>`).join('')}</div>` : '';
}
// Startseite (Hinweis-Karte, niedrigster Rang): Deload-Woche noch ohne Training, oder nach ein paar Tagen Pause eine Einladung.
// Ab der Pausen-Frage („Wieder da“, 7 bzw. 14 Tage) nichts, die übernimmt dann. ✕ blendet bis zum nächsten Durchlauf aus.
function motivStartCard() {
  if (motivMode() === 'off' || draft || !hasActivePlan() || ownPlan()) return '';
  const ci = cycleInfo(), key = roundKey(ci.cycleStart, ci.week);
  if ((data.profile || {}).motivHide === key) return '';
  const x = `<button class="icon-btn motiv-x" data-action="motiv-hide" data-k="${esc(key)}" aria-label="Bis zur nächsten Woche ausblenden">✕</button>`;
  if (ci.deload) return roundSessions(ci.cycleStart, ci.week).length ? '' : `<div class="card hints motiv-card ${motivMode()}">${x}<p>${motivText('deload')}</p></div>`;
  const last = sessionsNewestFirst().find(s => findDay(s.dayId));
  if (!last) return '';
  const days = Math.floor((Date.parse(todayISO() + 'T12:00:00') - Date.parse(last.date.slice(0, 10) + 'T12:00:00')) / DAY);
  const perWeek = Math.max(1, activeDays().reduce((a, d) => a + dayTimes(d, ci.week), 0));
  const from = Math.max(4, Math.round(7 / perWeek) + 2), to = perWeek <= 1 ? 14 : 7;  // seltener Trainierende: später einladen
  const nd = nextOpenDay(ci);
  if (days < from || days >= to || !nd) return '';
  const est = estDuration(nd, ci.week, activePlan(), ci.deload);
  return `<div class="card hints motiv-card ${motivMode()}">${x}<p>${motivText('back', esc(nd.name), days)}</p>
    ${est > 60 && !(data.timeLimit && data.timeLimit.min) ? `<p class="hint">${motivText('short')}</p>
      <button class="btn small" data-action="time-open">⏱ Training kürzen</button>` : ''}</div>`;
}
// Bisherige Nutzer einmal fragen (neue: in der Begrüßung)
function motivAskCard() {
  if ((data.profile || {}).motiv || !hasOwnData()) return '';
  return `<div class="card hints motiv-ask"><p><b>Wie möchtest du motiviert werden?</b></p>
      <p class="hint">Nach dem Training und nach einer kleinen Pause meldet sich die App mit ein paar Worten. Du entscheidest, in welchem Ton.</p>
      <div class="mode-opts">${Object.entries(MOTIV_OPTS).map(([k, [ic, l, t]]) =>
        `<button class="split-opt" data-action="motiv-set" data-m="${k}"><b>${ic} ${l}</b><small>${t}</small></button>`).join('')}</div>
      <p class="hint">Jederzeit änderbar unter Optionen → Training.</p></div>`;
}
// Optionen → Training
function motivCard() {
  const m = motivMode();
  return `<div class="card motiv-opt">
      <h2>Motivation</h2>
      <div class="seg three">${Object.entries(MOTIV_OPTS).map(([k, [, l]]) => `<button class="${m === k ? 'on' : ''}" data-action="motiv-set" data-m="${k}">${l}</button>`).join('')}</div>
      <p class="hint explain">${m === 'off' ? 'Keine Lob- oder Erinnerungs-Texte. Zahlen und Hinweise zum Training bleiben.'
        : m === 'hard' ? 'Klare Ansagen nach dem Training und nach einer Pause – z. B. „2 von 3. Eins fehlt noch – zieh\'s durch.“'
        : 'Lob nach dem Training und eine freundliche Einladung nach einer Pause – z. B. „2 von 3 Trainings diese Woche – stark!“'}</p>
    </div>`;
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
        ${ssOn() ? `<p class="lbl">🔗 Supersätze</p><div class="seg two"><button class="${timeEdit.ss !== false ? 'on' : ''}" data-action="time-ss" data-v="1">Erst Supersätze</button>
          <button class="${timeEdit.ss === false ? 'on' : ''}" data-action="time-ss" data-v="0">Ohne</button></div>
          <p class="hint">Reicht die Zeit nicht, koppelt die App zuerst passende Übungen im Wechsel – das spart Pausen. Erst wenn es dann
          immer noch nicht passt, fallen Sätze weg.</p>` : ''}
        <p class="hint">Die App kürzt das Training passend: Jede geplante Muskelgruppe bekommt zuerst 1–2 Sätze – mit einer
          Grundübung, wenn es eine gibt –, dann folgen die übrigen Sätze der Grundübungen, danach normale Übungen und zuletzt
          Isolationsübungen. Gerechnet wird mit 1 Minute pro Satz plus Pause (Grundübung 4, normale Übung 3, Isolation 2 Minuten).</p>
        <div class="row"><button class="btn" data-action="time-cancel">Abbrechen</button>
          <button class="btn primary" data-action="time-save">Übernehmen</button></div>
      </div>`;
  }
  if (tl && tl.min) {
    return `<div class="time-strip"><span>⏱ <b>Zeitlimit ${tl.min} min</b> · ${tl.once ? 'nur nächstes Training' : 'bis du es änderst'}${tl.ss && ssOn() ? ' · 🔗 erst Supersätze' : ''}</span>
        <button class="btn small" data-action="time-open">Ändern</button><button class="btn small" data-action="time-off">Aus</button></div>`;
  }
  return `<button class="btn outline time-btn" data-action="time-open">⏱ Wenig Zeit?<small>Training kürzen</small></button>`;
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
    return `<button class="btn outline skip-btn" data-action="skip-open"><span class="ico">⏭</span> Tage auslassen
      <small>nach einer Pause</small></button>`;
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

// Startseite (v201, User-Wunsch 2026-11-11): höchstens EINE Hinweis-Karte gleichzeitig, die wichtigste zuerst –
// die übrigen kommen nach Erledigen bzw. „Später“ der Reihe nach dran
function startHintCard() {
  for (const f of [storageWarnCard, iosMoveCard, whatsNewCard, motivAskCard, backupCard, installCard, colorHintCard, modeUpCard, motivStartCard]) {
    const h = f();
    if (h) return h;
  }
  return '';
}

// Reihenfolge (v201): Begrüßung → laufendes Training bzw. nächster Trainingstag → Zeitlimit (falls aktiv) → eine Hinweis-Karte →
// Zyklus (zugeklappt) → Rückblick/Hinweise → Ernährung → weitere Trainingstage → „Wenig Zeit?“ und „Tage auslassen“ → Cardio
function renderStart() {
  const hint = startHintCard();
  let h = (typeof sportSwitch === 'function' ? sportSwitch('kraft') : '')  // v224 Beta-Entwurf: Kraft | Hyrox
    + greeting() + moveCard() + betaCard()  // v217: Umzugshilfe (alte Adresse) bzw. Beta-Hinweis
    + (typeof caliUpCards === 'function' ? caliUpCards() : '');  // v225: Calisthenics – nächste Stufe? (nur nach Rückfrage)
  if (draft) {
    h += `<div class="card highlight">
      <h2>Laufendes Training: ${esc(draft.dayName)}</h2>
      <p class="sub">begonnen ${fmtDate(draft.date)}</p>
      <button class="btn primary" data-action="resume">Fortsetzen</button>
    </div>`;
  }
  if (!hasActivePlan()) {
    return h + hint + `<div class="card no-plan">
        <div class="check-emoji" aria-hidden="true">🏁</div>
        <h2>${data.plans.length ? 'Kein Plan aktiv' : 'Noch kein Plan'}</h2>
        <p class="hint">${data.plans.length ? 'Erstelle einen neuen Plan oder aktiviere einen bisherigen im Reiter „Plan“. Deine Trainings und Erfolge bleiben erhalten.'
          : 'Erstelle deinen ersten Trainingsplan – der Assistent führt dich Schritt für Schritt hindurch.'}</p>
        <button class="btn primary" data-action="wiz-start">✨ Neuen Plan erstellen</button>
        ${data.plans.length ? '<button class="btn center" data-action="tab" data-tab="plan">Bisherigen Plan aktivieren</button>' : ''}
      </div>`;
  }
  if (!data.days.length) {
    return h + hint + `<p class="hint">Noch kein Trainingsplan vorhanden. Lege zuerst deine Trainingstage und Übungen an.</p>
      <button class="btn primary" data-action="tab" data-tab="plan">Trainingsplan anlegen</button>`;
  }
  const limit = data.timeLimit && data.timeLimit.min;
  const sessions = sessionsNewestFirst();
  // als Nächstes dran: der nächste noch offene Tag des Durchlaufs, gezählt ab dem zuletzt trainierten Tag
  const ci = cycleInfo();
  const open = new Set(roundOpen(ci.cycleStart, ci.week).map(x => x.day.id));
  const lastOwn = sessions.find(s => findDay(s.dayId));
  const from = lastOwn ? data.days.indexOf(findDay(lastOwn.dayId)) + 1 : 0;
  const order = data.days.map((_, i) => data.days[(from + i) % data.days.length]);
  const nextDay = !draft ? order.find(d => open.has(d.id)) : null;
  const skippedIds = roundSkipped(ci.cycleStart, ci.week);
  const dayBtn = (day, i) => {
    // noch nicht erstellter Tag (User-Wunsch 2026-11-10): Hinweis statt Training, antippen = Übungen eintragen
    if (!day.exercises.some(e => e.name.trim())) {
      return `<button class="btn nav day-btn pending" data-action="own-resume" data-id="${day.id}">
        <span class="day-no">⏳</span><span class="day-txt">${esc(day.name)}<small>Noch nicht erstellt – antippen, um die Übungen einzutragen</small></span></button>`;
    }
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
    return `<button class="btn nav day-btn ${next ? 'next' : ''} ${done ? 'done' : ''} ${skipped ? 'skipped' : ''}" data-action="start-day" data-id="${day.id}">
      <span class="day-no">${skipped ? '⏭' : done ? '✓' : dayNoText(i)}</span>
      <span class="day-txt">${next ? '<span class="badge next-badge">▶ Steht als Nächstes an</span>' : ''}${esc(day.name)}${skipped ? '<span class="badge skip">diese Woche ausgelassen</span>'
        : done ? '<span class="badge done">diese Woche erledigt</span>' : ''}<small>${info}</small></span></button>`;
  };
  // 1. nächster Tag ganz oben (bei laufendem Training steht dort die Karte „Fortsetzen“)
  if (nextDay) h += dayBtn(nextDay, data.days.indexOf(nextDay));
  // Zeitlimit: aktiv bzw. in Bearbeitung direkt unter dem nächsten Tag, sonst als kleiner Knopf unten
  const tlShown = !draft && (timeEdit || limit);
  if (tlShown) h += timeLimitHtml();
  // 2. eine Hinweis-Karte, 3. Zyklus und Co.
  h += hint + cycleCard(ci) + (typeof reviewStartCard === 'function' ? reviewStartCard() : '') + hintsCard();
  h += nutStartLine();  // Ernährungsphase kurz anzeigen (nutrition.js)
  // 4. übrige Tage
  const rest = data.days.filter(d => d !== nextDay);
  if (rest.length) {
    h += `<h2 class="start-days-h">${nextDay ? 'Weitere Trainingstage' : 'Welcher Trainingstag?'} <small class="hint">· ${esc(activePlan().name)}</small></h2>`
      + rest.map(d => dayBtn(d, data.days.indexOf(d))).join('');
  }
  // 5. kleine Knöpfe „Wenig Zeit?“ und „Tage auslassen“ nebeneinander (aufgeklappte Auswahl darunter in voller Breite)
  if (!draft) {
    const tb = tlShown ? '' : timeLimitHtml(), sk = skipHtml(ci);
    if (skipPick) h += (tb ? `<div class="start-mini">${tb}</div>` : '') + sk;
    else if (tb || sk) h += `<div class="start-mini">${tb}${sk}</div>`;
  }
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
  const ss = (draft.ssToday || []).length ? `<br><small>🔗 Heute im Supersatz: ${draft.ssToday.map(([a, b]) => `${esc(a)} + ${esc(b)}`).join(' · ')}</small>` : '';
  if (ss && !c) return `<p class="intro-note time-note">⏱ Zeitlimit ${draft.timeLimit} min – mit Supersätzen passt das Training ohne Kürzen.${ss}</p>`;
  if (!c) return `<p class="intro-note time-note">⏱ Zeitlimit ${draft.timeLimit} min – das Training passt schon so, nichts gekürzt.</p>`;
  return `<p class="intro-note time-note">⏱ Auf ca. ${fmtDur(c.after)} gekürzt (Zeitlimit ${c.limit} min, sonst ca. ${fmtDur(c.before)}).
    ${c.cut.length ? `<br><small>Weniger Sätze: ${c.cut.map(x => `${esc(x.name)} ${x.from} → ${x.to}`).join(' · ')}</small>` : ''}
    ${c.dropped.length ? `<br><small>Heute ausgelassen: ${c.dropped.map(esc).join(' · ')}</small>` : ''}${ss}</p>`;
}

function renderTraining() {
  if (!draft) return '<p class="hint">Kein laufendes Training.</p>';
  let h = draft.own
    ? (activePlan().cali ? '<p class="intro-note">Calisthenics: Die App steigert pro Woche um 1 Wdh. bzw. 5 Sekunden je Satz, bis das Stufenziel erreicht ist. Nicht geschafft? Dann bleibt das Ziel gleich.</p>'
      : '<p class="intro-note">Eigener Plan: Vorgeschlagen sind immer deine Werte vom letzten Mal (beim ersten Mal Sätze × Wdh. aus deinem Plan). Die App steigert nichts – Gewicht und Wdh. änderst du selbst.</p>')
    : draft.deload
    ? `<p class="deload-note">${feat('tr-rir-input') ? `Deload-Woche: halbe Sätze, 15 % weniger Gewicht oder weniger Wdh. als in der letzten Trainingswoche, mindestens ${DELOAD_RIR} Wdh. im Tank. Keine Steigerung.`
      : 'Deload-Woche: halbe Sätze und etwas leichter – jeder Satz sollte sich locker anfühlen.'}</p>`
    : draft.intro
      ? `<p class="intro-note">Intro-Woche: ${draft.cycleNo === 1 ? 'Du steigst etwas leichter ein und findest deine Gewichte.'
        : `Start-Sätze laut Plan. ${shiftText(draft.cycleStart, 1)
          || (feat('tr-rir-input') ? `Vergleich ist die Intro-Woche des letzten Zyklus, je Satz +1 Wdh. pro ${cmpWeeksPerRep()} Wochen Abstand.` : '')}`}</p>`
      : '';
  // Uhr und „Letztes Mal“ stehen seit v200 in der Kopfleiste bzw. im Menü „⋯“
  h = timeCutNote() + h;
  h += draft.own
    ? `<p class="sub">${fmtDate(draft.date, true)}<br>Trag nach jedem Satz ein, was du geschafft hast${feat('tr-rir-input')
      ? ' und wie viele Wdh. noch im Tank waren' : ' und tippe an, wie er sich angefühlt hat'} – damit gilt der Satz als erledigt.</p>`
    : `<p class="sub">${fmtDate(draft.date, true)}</p>` + entryHelpHtml() + prefatHelpHtml();
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
      <p class="hint">Gilt nur für dieses Training. Eingetragene Werte bleiben erhalten. Dauerhaft änderst du die Reihenfolge im Plan beim Trainingstag.</p></div>`;
  }
  // „Reihenfolge ändern“ steht seit v200 im Menü „⋯“ der Kopfleiste
  // Ansicht: alle Übungen untereinander (scrollen) oder eine Übung je Bildschirm (wischen) – profile.swipe, einstellbar in den Optionen
  const swipe = trSwipeOn();
  const cur = swipe ? trCur() : -1;
  if (swipe) h += swipeNavHtml(cur);

  const stalls = stagnationHints();
  // Supersätze (v210): Paar in einem Rahmen, Kopf mit Runde und „Heute einzeln“; beim Wischen beide auf einem Bildschirm
  const pairs = draftPairs(), raw = entryPairs(draft.entries, true);
  const vis = i => { if (!swipe) return true; const p = pairs.get(i); return p ? cur === p.i || cur === p.j : i === cur; };
  draft.entries.forEach((en, ei) => {
    const last = lastEntry(en.name);
    const det = detOpen(en);
    const hasComment = feat('tr-comment') && !!(en.comment || '').trim();
    const pr = pairs.get(ei), ssNx = pr && ssNext(pr);
    if (pr && pr.role === 'A') h += `<div class="ss-wrap"${vis(ei) ? '' : ' hidden'}>${ssHeadHtml(pr, swipe || pr.i === [...pairs.keys()][0])}`;
    else if (!pr && raw.get(ei) && raw.get(ei).role === 'A') h += ssSoloHtml(raw.get(ei), !vis(ei));
    h += `<section class="card ex-card tint-${ei % 4}${pr ? ' ss-card' : ''}${swipe && ei === cur && draft.slide ? ` slide-${draft.slide}` : ''}" data-ei="${ei}"${vis(ei) ? '' : ' hidden'}>
      <div class="ex-head">
        <h2>${pr ? `<span class="ss-badge" aria-label="Übung ${pr.role} im Supersatz">${pr.role}</span>` : ''}${libEntry(en.name) ? `<button class="lib-link" data-action="lib-open" data-name="${esc(en.name)}"
          aria-label="Ausführung ansehen">${exTitleHtml(en.name)} <span class="info-dot">i</span></button>` : exTitleHtml(en.name)}</h2>
        <button class="det-btn" data-action="ex-details" data-ei="${ei}" aria-expanded="${det}">Details${hasComment && !det ? ' · 💬' : ''}
          <span class="chev" aria-hidden="true">▾</span></button>
        ${det ? `<div class="ex-tools">
          ${feat('tr-comment') ? `<button class="icon-btn bubble ${hasComment ? 'has' : ''}" data-action="comment-toggle"
            data-ei="${ei}" aria-label="Kommentar">💬 Kommentar</button>` : ''}
          <button class="icon-btn swap" data-action="rep-open" data-ei="${ei}">⇄ Ersetzen</button>
          <button class="icon-btn pain-btn" data-action="pain-open" data-ei="${ei}">🩹 Zwickt</button>
          <button class="icon-btn vid-btn" data-action="vid-open-list" data-name="${esc(en.name)}">🎥 Video</button>
        </div>` : ''}
      </div>`;
    if (en.added) {
      h += `<div class="added-row"><span>Heute zusätzlich</span>
        <button class="icon-btn" data-action="added-remove" data-ei="${ei}">Entfernen</button></div>`;
    }
    if (en.commentOpen && det) {
      h += `<textarea class="inp comment" rows="3" data-field="tr-comment" data-ei="${ei}"
        placeholder="Kommentar zur Übung, z. B. Sitzhöhe 4, Schulter zwickt …">${esc(en.comment)}</textarea>`;
    }
    const tips = complaintTips(en.name);
    for (const c of tips) {
      h += `<p class="complaint-note">⚠️ ${c.label}: ${c.tip}. Bei Schmerz Satz abbrechen.</p>`;
    }
    h += painTrainingHtml(en, ei, tips.length > 0);  // „Zwickt“ (v209)
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
    if (last && (last.ss || pr) && last.ss !== !!pr) h += `<p class="last ss-last">🔗 Letztes Mal ${last.ss ? 'im Supersatz' : 'einzeln'} trainiert</p>`;
    if (en.replacing) h += renderReplace(en, ei);
    const bandEx = body && en.target && en.target.band;
    if (bandEx) h += `<p class="bw-note">🎗️ Bandübung: Steigerung über die Wiederholungen – ab etwa ${BAND_MAX_REPS} Wdh. kommt das nächststärkere Band.</p>` + bandRow(en, ei);
    else if (body) h += `<p class="bw-note">🧍 Eigengewichtsübung: Steigerung über die ${typeof isHoldName === 'function' && isHoldName(en.name) ? 'Haltezeit (Sekunden)' : 'Wiederholungen'}.</p>`;
    if (en.target && !en.target.own) { const bh = bwHint(en); h += `<p class="bw-hint" data-bwhint="${ei}"${bh ? '' : ' hidden'}>${bh}</p>`; }
    if (en.caliInfo && typeof caliTargetHtml === 'function') {
      h += caliTargetHtml(en);
    } else if (en.target && en.target.own) {
      h += `<p class="target">Plan: ${en.target.sets} × ${en.target.reps} ${typeof holdUnit === 'function' ? holdUnit(en.name) : 'Wdh.'}</p>`;
    } else if (en.target) {
      const t = en.target;
      // Heute: wirklich vorgeschlagene Wdh. (User-Regel 2026-11-06), nicht der Startwert des Plans
      const pr = (en.planned || []).map(x => x && x.reps).filter(x => x != null);
      const today = pr.length ? (Math.min(...pr) === Math.max(...pr) ? pr[0] : `${Math.max(...pr)}–${Math.min(...pr)}`) : t.reps;
      h += feat('tr-tank-target')
        ? `<p class="target">Heute: ${t.sets} × ${today} Wdh. · ${t.deload || !t.rirSplit ? `Ø ${targetRirText(t)} im Tank` : `Tank ${rirSeqText(t)}`}</p>`
        : `<p class="target">Heute: ${t.sets} × ${today} Wdh. · ${feelTargetText(t)}</p>`;
      if (feat('tr-prefat') && (t.fat || 0) >= PREFAT_SHOW - 1e-9) {
        const pi = preFatigueInfo(draftPrefatList(), ei);
        const parts = [pi.same ? `${fmtNum(pi.same)} ${pi.same === 1 ? 'Satz' : 'Sätze'} ${MUSCLES[pi.g] || ''}` : '', pi.help ? `${fmtNum(pi.help)} ${pi.help === 1 ? 'Satz' : 'Sätze'} für Hilfsmuskeln` : ''].filter(Boolean);
        h += `<p class="prefat-note">💤 Vorermüdet: ${parts.join(' und ')} vorher – die App rechnet mit etwa ${Math.round(t.fat * 100)} % weniger Kraft als frisch.</p>`;
      }
    }
    // Scheiben-Rechner (v204): bei Langhantel-Übungen immer sichtbar, rechnet beim Eintippen mit (platesSync)
    if (!body && isBarbellEx(en)) {
      const pt = platesLineText(en);
      h += `<p class="plates-line" data-plates-line="${ei}"${pt ? '' : ' hidden'}>${pt}</p>`;
    }
    // Max. bei 10 Wdh., Steigerung und Ausführung kompakt nebeneinander; die Auswahl klappt darunter auf
    const t = en.target;
    const withMax = t && !t.own && !body && feat('tr-max');
    const vAll = en.sets.length && en.sets.every(s => variantOf(s) === variantOf(en.sets[0])) ? variantOf(en.sets[0]) : null;
    const maxToday = !withMax ? '' : t.max10 != null && (t.fat || 0) >= PREFAT_SHOW - 1e-9
      ? `<small class="max-today">frisch · heute ≈ ${fmtNum(Math.round(effMax(t) * 2) / 2)}</small>` : '<small class="max-today">frisch</small>';
    // Zugeklappt: nur zeigen, wenn das Max. fehlt (dann muss es eingetragen bzw. bewusst leer gelassen werden)
    if ((det || (withMax && t.max10 == null)) && (withMax || feat('tr-variants'))) h += `<div class="ex-meta ${withMax ? '' : 'wide'}">${withMax ? `<label class="max-mini"><span>Max. kg bei 10 Wdh.${maxToday}</span>
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
    if (withMax && en.stepOpen && det) h += stepPick(en, ei);
    if (en.variantOpen && det) {
      h += `<div class="variants ex-var-pick">${Object.entries(VARIANTS).map(([v, label]) =>
        `<button class="vchip ${vAll === v ? 'on' : ''}" data-action="ex-variant" data-ei="${ei}" data-v="${v}">${label}</button>`).join('')}
        <p class="hint">Gilt für alle noch offenen Sätze. Einzelne Sätze: Satznummer antippen.</p></div>`;
    }
    if (en.weekFirst && feat('tr-compare') && det) {
      h += `<div class="compare">Plan des 1. Trainings dieser Woche (${fmtDate(en.weekFirst.date)}):
        ${setRows([{ sets: en.weekFirst.sets }])}<b>2. Training der Woche: höchstens dieser Plan – keine Steigerung dagegen</b></div>`;
    }
    // Werte vom letzten Mal: immer sichtbar, auch bei zugeklappten Details (User-Wunsch 2026-11-11, v206)
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
      const cols = [{ label: `Letzter Zyklus<small>${weekLabel(en.compare.week)}${occ} · ${fmtDate(en.compare.date)}</small>`, sets: en.compare.rawSets || en.compare.sets }];
      if (en.prevWeek) cols.push({ label: `Vorwoche<small>${weekLabel(en.prevWeek.week)} · ${fmtDate(en.prevWeek.date)}</small>`, sets: en.prevWeek.rawSets || en.prevWeek.sets });
      const conv = [en.compare, en.prevWeek].some(x => x && x.rawSets);
      h += `<div class="compare">${setRows(cols, true)}<b>${rule}</b>${conv && feat('tr-prefat') ? '<br><small>Damals stand die Übung an anderer Stelle im Training – die App hat die Werte auf die heutige Vorermüdung umgerechnet.</small>' : ''}</div>`;
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
    h += `<div class="setgrid"><span class="head">Satz</span><span class="head">kg</span><span class="head">${typeof holdHead === 'function' ? holdHead(en.name) : 'Wdh.'}</span><span class="head">${rirInput ? 'Tank' : 'Gefühl'}</span>`;
    const tankHint = si => !en.target || en.target.own ? '–' : en.target.deload || !en.target.rirSplit
      ? targetRirText(en.target).replace('mind. ', '≥') : fmtNum(rirAt(en.target, si));  // Tank je Satz (v199)
    const next = feat('tr-next') ? nextPreview(en) : [];
    const bodyKg = body ? currentBodyweight() : null;
    const pb = draftPbFlags(en), fpb = draftFatPbFlags(en, pb);
    en.sets.forEach((s, si) => {
      const v = variantOf(s);
      const st = setState(s);  // v200: erledigt = grün, unberührter Vorschlag = grau
      const nowC = ssNx && ssNx[0] === ei && ssNx[1] === si ? ' now' : '';  // v210: nächster Satz im Supersatz
      const star = `<span class="pb-star" data-pb="${ei}-${si}"${pb[si] ? '' : ' hidden'}>★ PB</span>`
        + `<span class="pb-star fpb" data-fpb="${ei}-${si}" title="Vorermüdungs-PB"${fpb[si] ? '' : ' hidden'}>💪 PB</span>`;
      h += (feat('tr-variants') ? `<button class="setno ${v ? 'has-v' : ''} ${st}${nowC}" data-action="set-variant" data-ei="${ei}" data-si="${si}" data-setno="${ei}-${si}"
          aria-label="Satz ${si + 1}: ${VARIANTS[v]} – antippen zum Wechseln">${pr ? pr.role : ''}${si + 1}${v ? `<small>${VARIANTS[v]}</small>` : ''}${star}</button>`
          : `<span class="setno ${st}${nowC}" data-setno="${ei}-${si}">${pr ? pr.role : ''}${si + 1}${v ? `<small>${VARIANTS[v]}</small>` : ''}${star}</span>`) + `
        ${body ? (en.target && en.target.band ? `<span class="bw-cell">Band<small>${BAND_LEVELS[en.target.band]}</small></span>`
          : `<span class="bw-cell">Körper${bodyKg != null ? `<small>${fmtNum(bodyKg)} kg</small>` : ''}</span>`)
        : `<input type="text" inputmode="decimal" autocomplete="off" placeholder="–" class="${st}"
          data-field="tr-weight" data-ei="${ei}" data-si="${si}" value="${esc(s.weight)}">`}
        <input type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="–" class="${st}"
          data-field="tr-reps" data-ei="${ei}" data-si="${si}" value="${esc(s.reps)}">
        ${rirInput ? `<input type="text" inputmode="decimal" autocomplete="off" placeholder="${tankHint(si)}"
          class="tank" data-field="tr-rir" data-ei="${ei}" data-si="${si}" value="${esc(s.rir)}">`
          : `<button class="feel-btn ${s.rir !== '' && s.rir != null ? 'set' : ''}" data-action="tr-feel-open" data-ei="${ei}" data-si="${si}"
            aria-label="Wie hat sich Satz ${si + 1} angefühlt?">${feelIcon(en, s, si)}</button>`}
        <div class="next-hint" data-next="${ei}-${si}">${next[si] || ''}</div>
        <div class="typo-hint" data-typo="${ei}-${si}">${typoHtml(en, ei, si)}</div>
        ${!rirInput && en.feelOpen === si ? `<div class="feel-pick">${FEELS.map(f =>
          `<button class="vchip" data-action="tr-feel" data-ei="${ei}" data-si="${si}" data-f="${f.k}">${f.icon}<small>${f.label}</small></button>`).join('')}</div>` : ''}`
        + techRowsHtml(en, ei, si);  // Teil-Sätze einer Intensitätstechnik (v211)
    });
    const techs = [...new Set(en.sets.map(variantOf).filter(isTech))];
    h += `</div>${techs.map(k => `<div class="tech-train">${techInfoHtml(k)}</div>`).join('')}${rirInput ? `<p class="avg" data-avg="${ei}">${avgTankText(en)}</p>` : ''}
      ${feat('tr-sets') ? `<div class="row set-btns">
        <button class="btn" data-action="tr-del-set" data-ei="${ei}">− Satz</button>
        <button class="btn" data-action="tr-add-set" data-ei="${ei}">+ Satz</button>
      </div>` : ''}${swipe && !(pr && pr.role === 'A') ? swipeNextHtml(ei) : ''}</section>`;
    if (pr && pr.role === 'B') h += '</div>';
  });
  if (feat('tr-add')) h += draft.adding ? renderAddExercise()
    : '<button class="btn center" data-action="add-open">+ Übung hinzufügen</button>';
  h += `${feat('tr-variants') ? '<p class="hint">Satznummer antippen: Ausführung wechseln (normal → mit Pause → langsam → Reduktion → Myo). Jede Ausführung wird nur mit gleich ausgeführten Sätzen verglichen.</p>' : ''}
    <button class="btn primary" data-action="tr-save">Training speichern</button>
    <div class="spacer"></div>
    <button class="btn danger" data-action="tr-cancel">Training verwerfen</button>`;
  return h;
}

// Erklärung oben im Training (User-Wunsch 2026-11-09): offen, bis „Verstanden“ (profile.entryHelpKnown), danach aufklappbar
let entryHelpOpen = false;
function entryHelpHtml() {
  const known = data.profile && data.profile.entryHelpKnown;
  if (known && !entryHelpOpen) return '';  // v200: aufrufbar über das Menü „⋯“ in der Kopfleiste
  const simple = !feat('tr-rir-input');
  const last = simple
    ? `<li>Tippe im letzten Feld an, <b>wie schwer dir der Satz gefallen ist</b>:
        <ul class="feel-legend">
          <li>😊 <b>locker</b> – es wären noch deutlich mehr gegangen (4 oder mehr)</li>
          <li>💪 <b>gut</b> – genau richtig: noch so viele, wie bei der Übung steht</li>
          <li>😤 <b>hart</b> – es ging gerade noch (vielleicht noch 1)</li>
          <li>🔥 <b>ging nichts mehr</b> – keine einzige Wdh. mehr</li>
        </ul></li>`
    : '<li>Trag im letzten Feld ein, <b>wie viele Wdh. noch im Tank waren</b> – wie viele du noch geschafft hättest, bevor nichts mehr ging (0 = gar keine mehr).</li>';
  return `<div class="entry-help">
    <b class="entry-help-title">So trägst du dein Training ein</b>
    <ol>
      <li>Die App gibt dir für jeden Satz <b>Gewicht und Wiederholungen</b> vor.</li>
      <li>Versuch, diese Vorgabe zu erfüllen. Nimmst du ein anderes Gewicht oder schaffst mehr oder weniger Wdh., trag die echten Werte ein.</li>
      ${last}
    </ol>
    <p class="entry-help-key"><b>Wichtig:</b> Daraus berechnet die App deine weiteren Vorgaben – für die nächsten Sätze und fürs nächste Training.
      Gib es deshalb ehrlich an${simple ? ', auch wenn es sich nicht wie „gut“ angefühlt hat' : ' und schätz lieber, statt einfach das Ziel einzutragen'}.</p>
    <button class="btn ${known ? 'outline' : 'primary'}" data-action="${known ? 'entry-help-toggle' : 'entry-help-ok'}">${known ? 'Zuklappen' : '✔ Verstanden'}</button>
  </div>`;
}

// Einfach-Modus: Gefühl statt Tank-Zahl. Intern wird daraus „Wdh. im Tank“ relativ zum Ziel der Übung.
const FEELS = [
  { k: 'easy', icon: '😊', label: 'locker' },
  { k: 'good', icon: '💪', label: 'gut' },
  { k: 'hard', icon: '😤', label: 'hart' },
  { k: 'max', icon: '🔥', label: 'ging nichts mehr' },
];
function feelRir(t, k, si = 0) {
  const r = Math.round(rirAt(t, si));
  // locker = noch mind. 4 · gut = genau das Ziel · hart = noch 1 · ging nichts mehr = 0
  return { easy: Math.max(4, r + 2), good: r, hard: Math.max(0, Math.min(1, r - 1)), max: 0 }[k];
}
function feelIcon(en, s, si = 0) {
  if (s.rir === '' || s.rir == null) return '<span class="feel-q">Wie?</span>';
  const v = parseNum(s.rir), r = Math.round(rirAt(en.target, si));
  return v <= 0 ? '🔥' : v < r ? '😤' : v > r + 1 ? '😊' : '💪';
}
const feelTargetText = t => {
  const r = Math.round(rirAt(t, 0)), last = Math.round(rirAt(t, Math.max(0, (t.sets || 1) - 1)));
  if (r <= 0) return 'jeder Satz bis „ging nichts mehr“ 🔥';
  const tail = last < r ? (last <= 0 ? ' – in den letzten Sätzen bis „ging nichts mehr“ 🔥' : ` – in den letzten Sätzen noch etwa ${last}`) : '';
  return `hör auf, wenn noch etwa ${r} Wdh. gegangen wären (= 💪 gut)${tail}`;
};

// Aufklappbare Erklärung der Knöpfe „Volumen“ und „Gewicht & Wdh.“ (where: 'today' = nur dieses Training, 'plan' = Zyklus/Wochen)
function progHelpHtml(where) {
  const scope = where === 'today' ? 'Gilt nur für dieses Training – der Plan bleibt, wie er ist.'
    : 'Die Grundeinstellung gilt für den ganzen Zyklus; in der Tabelle darunter kannst du einzelne Wochen abweichend schalten (umrandet = eigene Einstellung der Woche). Im Training selbst lässt sich beides zusätzlich nur für dieses eine Training ändern.';
  return `<details class="prog-help"><summary>ⓘ Was bedeuten die Knöpfe?</summary>
    <p>Antippen schaltet um: <b>✓ = an</b> (die App steigert), <b>✕ = aus</b> (es bleibt, wie es ist).</p>
    <p><b>Volumen</b> – die Zahl der Sätze. <b>An:</b> Von Woche zu Woche kommen Sätze dazu, von der Intro-Woche bis zum Höhepunkt
      am Ende des Zyklus. <b>Aus:</b> Die Sätze bleiben wie in der Vorwoche. In der Intro-Woche gibt es den Knopf nicht – dort gelten die Start-Sätze.</p>
    <p><b>Gewicht & Wdh.</b> – die Vorschläge im Training. <b>An:</b> Hast du dein Ziel geschafft, schlägt die App beim nächsten Mal
      etwas mehr Gewicht oder mehr Wiederholungen vor. <b>Aus:</b> Es stehen deine Werte vom letzten Mal da, „Max. bei 10 Wdh.“ bleibt
      unverändert – das Ziel im Tank läuft trotzdem weiter.</p>
    <p><b>Wann ausschalten?</b> Z. B. wenn du krank warst, schlecht geschlafen hast, wenig Zeit hast, eine neue Technik lernst oder
      nach einer Verletzung vorsichtig sein willst. Normalerweise bleibt beides an.</p>
    <p class="hint">${scope}</p></details>`;
}

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
      ${progHelpHtml('today')}
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
    <button class="btn outline swap-new" data-action="swap-new" data-ctx="tr" data-ei="${ei}">＋ Neue Übung erstellen</button>
    <label class="row" ${feat('tr-max') ? '' : 'style="display:none"'}>
      <span>Max. kg bei 10 Wdh.<br><small class="hint">frisch, ohne Vorermüdung</small></span>
      <input class="inp kg" type="text" inputmode="decimal" autocomplete="off"
        data-field="rep-max" data-ei="${ei}" placeholder="kg">
    </label>
    ${feat('tr-max') ? `<p class="hint rep-max-hint" hidden>Für diese Übung ist noch kein Max. bei 10 Wdh. bekannt – trag es ein, wenn du es weißt. ${MAX_UNKNOWN_HINT}</p>` : ''}
    ${t ? `<p class="hint">Übernimmt das Ziel: ${t.sets} × ${t.reps} Wdh.${feat('tr-rir-input') ? ` · ${t.rir} im Tank` : ''}. Der Plan bleibt unverändert.</p>` : ''}
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
      <span>Max. kg bei 10 Wdh.<br><small class="hint">frisch, ohne Vorermüdung</small></span>
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
  // v225 Calisthenics (Beta)
  if (typeof caliOn === 'function' && caliOn()) h = `<button class="btn nav cali-entry" data-action="cali-open" data-from="plan">🤸 Calisthenics<small>Plan nach deinem Schwerpunkt oder selbst zusammengestellt · Skill-Stufen</small></button>` + h;
  // Einfach: nur der aktive Plan („Neuen Plan erstellen“ ersetzt ihn)
  for (const p of data.plans.filter(x => feat('plans-multi') || x.id === active.id)) {
    const isActive = p.id === active.id;
    const state = isActive ? ' · aktiv'
      : (p.endedAt ? ` · beendet am ${fmtDate(p.endedAt + 'T12:00:00')}` : '') + ' · antippen zum Aktivieren';
    // geschätzte Dauer pro Training: kürzester Tag in der Intro-Woche bis längster am Höhepunkt
    const est = p.days.map(d => estRange(d, p)).filter(([, hi]) => hi);
    const estTxt = est.length ? ` · ${estText(Math.min(...est.map(x => x[0])), Math.max(...est.map(x => x[1])))} pro Training` : '';
    const openN = p.days.filter(d => !d.exercises.some(e => e.name.trim())).length;  // noch zu erstellen
    const openTxt = openN && p.days.length > openN ? ` (${openN} noch offen)` : '';
    h += `<div class="plan-row ${isActive ? 'active' : ''} ${p.endedAt && !isActive ? 'ended' : ''}">
      <button class="plan-pick" data-action="plan-activate" data-id="${p.id}">
        <b>${esc(p.name)}</b><small>${p.days.length} Trainingstag${p.days.length === 1 ? '' : 'e'}${openTxt}${estTxt}${state}</small>
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
  // v207: Neuer Plan / Beenden dezent – bei aktivem Plan selten gebraucht
  h += `<div class="row plan-btns"><button class="btn outline" data-action="wiz-start">✨ Neuer Plan</button>
      <button class="btn outline" data-action="plan-end">⏹ Beenden</button></div>
    ${libBtn}
    <h2>Trainingstage · ${esc(active.name)}</h2>`;
  if (!data.days.length) {
    h += '<p class="hint">Dieser Plan hat noch keine Trainingstage.</p>';
  }
  if (typeof pendingDaysHtml === 'function') h += pendingDaysHtml();  // Tage, die noch erstellt werden müssen (wizard.js)
  // Dauer je Tag: eine Zahl für die aktuelle Woche (v207, vorher Spanne Intro bis Höhepunkt)
  const ci = active.own ? null : cycleInfo();
  h += '<div class="plan-days">';
  data.days.forEach((day, i) => {
    const open = !day.exercises.some(e => e.name.trim());
    const est = open ? 0 : ci ? estDuration(day, ci.week, active, ci.deload) : estRange(day, active)[1];
    const n = day.exercises.filter(e => e.name.trim()).length;
    h += `<button class="btn nav day-btn ${open ? 'pending' : ''}" data-action="${open && active.byHand ? 'own-resume' : 'open-day'}" data-id="${day.id}">
      <span class="day-no">${open ? '⏳' : dayNoText(i)}</span><span class="day-txt">${esc(day.name)}${open ? '<small>noch zu erstellen</small>'
        : `<small>${n} Übung${n === 1 ? '' : 'en'}${est ? ` · ${estText(est)}${ci ? (ci.deload ? ' im Deload' : ci.week === 1 ? ' in der Intro-Woche' : ` in Woche ${ci.week}`) : ''}` : ''}</small>`}</span></button>`;
  });
  h += '</div>';
  if (active.equip === 'home') h += homeEqCard();
  if (data.days.some(d => estDuration(d, 1, active))) {
    h += `<p class="hint explain">Geschätzte Trainingsdauer: je Satz 1 Minute, dazu Pause nach jedem Satz – Grundübungen 4, normale Übungen 3,
      Isolationsübungen 2 Minuten (ohne Aufwärmen)${ssOn() ? '; im Supersatz 2 Minuten nach jedem Satz, bei zwei Isolationsübungen 90 Sekunden' : ''}.</p>`;
  }
  if (active.own) {
    return h + `<button class="btn center" data-action="add-day">+ Trainingstag hinzufügen</button>
      <h2>Steigerung</h2>
      <div class="card">
        <p class="per-week-title">✋ Eigener Plan – ohne Steigerung durch die App</p>
        <p class="hint">Keine Zyklen, keine Deload-Woche, keine Vorschläge für mehr Gewicht, Wiederholungen oder Sätze. Im Training stehen immer deine Werte vom letzten Mal – beim ersten Mal Sätze × Wdh. und Startgewicht aus deinem Plan.</p>
        <button class="btn outline" data-action="plan-own-off">📈 Doch die Steigerung der App nutzen</button>
      </div>${overloadHtml(true)}`;
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
    <h2>Steigerung</h2>${overloadHtml()}
    ${periodCard(c, active)}`;
  return h;
}

// Aufklappbare Erklärung „Progressive Overload“ – own = eigener Plan (die App steigert nicht selbst)
function overloadHtml(own = false) {
  return `<details class="card lib-guide overload"><summary>📈 Progressive Overload – das Prinzip dahinter</summary>
    <p><b>Progressive Overload</b> heißt „schrittweise steigende Belastung“ und ist <b>das</b> Grundprinzip für Kraft- und
      Muskelaufbau: Dein Körper wird nur stärker, wenn er etwas mehr leisten muss, als er gewohnt ist.</p>
    <h3>Warum das funktioniert</h3>
    <p>Ein Training, das dich ein Stück über das Gewohnte hinaus fordert, ist für den Körper ein Signal: „Das reicht noch nicht.“
      In der Erholung danach passt er sich an – Muskeln, Sehnen und Knochen werden kräftiger, damit dieselbe Belastung beim nächsten
      Mal leichter fällt. Bleibt das Training immer gleich, hat er keinen Grund mehr, sich anzupassen, und der Fortschritt bleibt stehen.
      Deshalb muss die Anforderung über die Wochen langsam mitwachsen.</p>
    <h3>Womit sich steigern lässt</h3>
    <ul><li><b>Wiederholungen:</b> mit demselben Gewicht ein, zwei Wiederholungen mehr.</li>
      <li><b>Gewicht:</b> sind die Wiederholungen geschafft, geht es eine kleine Stufe schwerer – dafür wieder mit etwas weniger Wiederholungen.</li>
      <li><b>Sätze:</b> von Woche zu Woche kommen Sätze dazu (Volumen).</li>
      <li><b>Anstrengung:</b> die Sätze werden etwas näher an deine Grenze gebracht${feat('tr-rir-input') ? ' – es bleibt weniger im Tank' : ''}.</li></ul>
    <p>Beispiel: 40 kg × 10 → 40 kg × 11 → 40 kg × 12 → 42,5 kg × 10 → …</p>
    <h3>Worauf es ankommt</h3>
    <ul><li><b>Kleine Schritte:</b> nicht jedes Mal alles auf einmal – lieber langsam und dafür lange steigern.</li>
      <li><b>Saubere Technik zuerst:</b> mehr Gewicht zählt nur, wenn die Ausführung gleich gut bleibt.</li>
      <li><b>Erholung gehört dazu:</b> stärker wirst du in der Pause, nicht im Training. Deshalb gibt es die leichte Deload-Woche.</li>
      <li><b>Nicht jede Einheit ist ein Rekord:</b> Schlechter Schlaf oder Stress drücken die Leistung – entscheidend ist der Trend über Wochen.</li></ul>
    <h3>${own ? 'Bei deinem eigenen Plan' : 'So macht es die App'}</h3>
    <p>${own ? 'Die App steigert hier nicht selbst – im Training stehen deine Werte vom letzten Mal. Das Prinzip gilt trotzdem: Steigere selbst, '
        + 'z. B. erst die Wiederholungen bis zum oberen Ende deines Bereichs und dann das Gewicht um eine kleine Stufe.'
      : 'Sie übernimmt das für dich: Hast du dein Ziel geschafft, schlägt sie beim nächsten Training etwas mehr Wiederholungen oder Gewicht vor. '
        + 'Im Zyklus kommen Woche für Woche Sätze dazu, und die Sätze werden etwas fordernder – bis zur Deload-Woche. Der nächste Zyklus '
        + 'startet dann auf etwas höherem Niveau. Um wie viel kg das Gewicht steigt, stellst du pro Übung ein (1,25 bis 10 kg).'}</p>
  </details>`;
}

// Standard-Zykluslänge ändern (Regler): gilt ab sofort, auch für den laufenden Zyklus (seine Anpassung bleibt)
function applyCycleLen(v) {
  data.cycle.defWeeks = Math.min(CYCLE_MAX, Math.max(4, v));
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
  const lo = scope === 'all' ? 4 : min, hi = scope === 'all' ? CYCLE_MAX : CYCLE_MAX + 4;
  const wk = n => `${n} Woche${n === 1 ? '' : 'n'}`;
  const changed = adj ? `${wk(Math.abs(adj))} ${adj > 0 ? 'verlängert' : 'verkürzt'}` : '';
  const state = scope === 'all'
    ? `Standard für alle Zyklen${adj ? ` · dieser Zyklus: ${wk(len)} (${changed})` : ''}`
    : adj ? `nur dieser Zyklus, ${changed} · Standard ${def}` : `nur dieser Zyklus · wie Standard`;
  const chip = (k, l) => `<button class="vchip ${scope === k ? 'on' : ''}" data-action="cyc-scope" data-s="${k}">${l}</button>`;
  return `<p><b>Zykluslänge</b></p>
      <div class="row cyc-adj-row">
        <button class="icon-btn" data-action="cyc-adj" data-scope="${scope}" data-d="-1" ${val <= lo ? 'disabled' : ''} aria-label="Eine Woche kürzer">−</button>
        <span><b>${wk(val)}</b> + Deload<small>${scope === 'all' ? cycleLenInfo(val).tag + ' · ' : ''}${state}</small></span>
        <button class="icon-btn" data-action="cyc-adj" data-scope="${scope}" data-d="1" ${val >= hi ? 'disabled' : ''} aria-label="Eine Woche länger">+</button>
      </div>
      ${lenOn ? `<p class="lbl chips-title">Gilt für</p><div class="variants cyc-scope">${chip('all', 'Alle Zyklen')}${chip('this', 'Nur diesen Zyklus')}</div>` : ''}
      <p class="hint">${scope === 'all'
        ? `${cycleLenInfo(val).text} Einstellbar sind 4 bis ${CYCLE_MAX} Trainingswochen. Gilt ab sofort, auch für den laufenden Zyklus.`
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
          15 % weniger Gewicht oder weniger Wdh.), danach geht es mit der Intro-Woche weiter.</p>`}
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
  if (feat('cycle-adjust')) h += '<p class="hint explain">Woche wechseln, Zykluslänge, Verlängern/Verkürzen und „Zyklus beenden“ findest du im Reiter Training an der Zykluskarte unter „⚙️ Zyklus anpassen“.</p>';
  if (cfg) {
    h += `<p class="hint">Eine Woche ist ein Durchlauf: geschafft, sobald ${roundDoneText(active)} – egal, ob du dafür 6, 7 oder 9 Tage brauchst.</p>
      <p class="lbl chips-title">Deload</p>
      <div class="variants">${[['auto', 'Automatisch'], ['self', 'Selbst bestimmen']].map(([m, l]) =>
        `<button class="vchip ${(active.deload || 'auto') === m ? 'on' : ''}" data-action="plan-deload" data-m="${m}">${l}</button>`).join('')}</div>
      <p class="hint explain">${selfDeload()
        ? 'Kein automatischer Deload: Nach den Trainingswochen geht es Woche für Woche weiter (Sätze und Tank wie in der letzten Aufbauwoche, Gewicht und Wdh. steigen weiter). Den Deload legst du selbst ein – auf dem Startbildschirm, z. B. unter „⚙️ Zyklus anpassen“ über „Deload“.'
        : 'Nach den Trainingswochen folgt automatisch 1 Deload-Woche.'}
        Deload: halbe Sätze, 15 % weniger Gewicht oder weniger Wdh. als in der letzten Trainingswoche, mindestens ${DELOAD_RIR} Wdh. im Tank, keine Steigerung. Anschließend beginnt der nächste Zyklus.</p>`;
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
    ${progHelpHtml('plan')}
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
    <p class="hint explain">Volumen = mehr Sätze von Woche zu Woche (aus: Sätze wie in der Vorwoche). Gewicht & Wdh. = Steigerung von Training zu Training (aus: Werte vom letzten Mal halten). Einzelne Wochen antippen, um nur dort abzuweichen (umrandet). Für ein einzelnes Training lässt es sich direkt im Training umschalten.</p>`;
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
    if (ex.name.trim() && exRename === ex.name) return renameFormHtml(ex.name);
    const ssBtn = ex.name.trim() && ssOn() && !dayPairs(day.exercises).has(i) && ssCandidates(day, i).length
      && !(ssPick && ssPick.day === day.id && ssPick.i === i);
    return ex.name.trim() ? `<div class="row plan-ex-btns">
        <button class="btn outline plan-swap-btn" data-action="plan-swap-open" data-i="${i}">⇄ Ersetzen</button>
        <button class="btn outline plan-swap-btn" data-action="ex-rename-open" data-name="${esc(ex.name)}">✎ Umbenennen</button></div>
        ${ssBtn ? `<button class="btn outline plan-swap-btn ss-btn" data-action="ss-pick-open" data-i="${i}">🔗 Als Supersatz koppeln</button>` : ''}`
      : `<button class="btn outline plan-swap-btn" data-action="plan-swap-open" data-i="${i}">⇄ Übung ersetzen</button>`;
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
      <button class="btn outline swap-new" data-action="swap-new" data-ctx="plan" data-i="${i}">＋ Neue Übung erstellen</button>
      <div class="row"><button class="btn" data-action="plan-swap-cancel">Abbrechen</button>
        <button class="btn primary" data-action="plan-swap-ok" data-i="${i}">⇄ Ersetzen</button></div>
      <p class="hint">Die neue Übung übernimmt den Platz im Plan mit denselben Sätzen. Gespeicherte Trainings bleiben, wie sie sind;
        das Startgewicht kommt aus früheren Trainings mit dieser Übung oder wird beim ersten Mal ermittelt.</p>
    </div>`;
}

// Übung umbenennen (User-Wunsch 2026-11-09): überall – alle Pläne, Verlauf, laufendes Training, eigene Übungen,
// ausgeblendete Hinweise. Verlauf, Rekorde und Diagramme stehen danach unter dem neuen Namen. Eine Übung aus der
// Bibliothek wird dabei zur eigenen Übung (Art, Muskelgruppe und – als „ähnliche Übung“ – Figur und Tipps bleiben).
var exRename = null;  // Name der Übung, deren Umbenennen-Feld offen ist
const exNameUsed = k => data.plans.some(p => p.days.some(d => d.exercises.some(e => nameKey(e.name) === k)))
  || data.sessions.some(s => s.entries.some(en => nameKey(en.name) === k));

function renameFormHtml(name) {
  return `<div class="replace ex-rename">
      <label class="lbl" for="ren-name">„${esc(name)}“ umbenennen</label>
      <input class="inp" id="ren-name" type="text" autocomplete="off" autocorrect="off" spellcheck="false" value="${esc(name)}">
      <div class="row"><button class="btn" data-action="ex-rename-cancel">Abbrechen</button>
        <button class="btn primary" data-action="ex-rename-ok">✔ Speichern</button></div>
      <p class="hint">Der neue Name gilt überall: in allen Plänen und im Verlauf. Deine bisherigen Trainings, Rekorde und
        Diagramme bleiben erhalten und stehen dann unter dem neuen Namen.</p>
    </div>`;
}

// Neuer Name prüfen: bereinigt zurück, null = nicht möglich (Hinweis kommt)
function renameCheck(from, to) {
  to = String(to || '').trim().replace(/\s+/g, ' ');
  if (!to) { alert('Bitte gib einen Namen ein.'); return null; }
  const kf = nameKey(from), kt = nameKey(to);
  if (kt !== kf && (builtinExercise(to) || customExercise(to) || exNameUsed(kt))) {
    alert(`„${to}“ gibt es schon. Bitte wähle einen anderen Namen.\n\nWillst du stattdessen eine andere Übung trainieren, nimm im Plan „⇄ Ersetzen“.`);
    return null;
  }
  return to;
}
const exSessionCount = name => { const k = nameKey(name); return data.sessions.filter(s => s.entries.some(en => nameKey(en.name) === k)).length; };
const trainingsText = n => n === 1 ? '1 Training' : `${n} Trainings`;
/* Umbenennen (v219, User 2026-11-12): fragen, ob die bisherigen Daten mitgehen.
   'all' = ja, übertragen (Name gilt überall) · 'new' = nein, neue Übung (bisherige Trainings bleiben beim alten Namen) · null = abbrechen.
   where 'slot' = Namensfeld im Trainingstag („nein“ gilt dann nur für diesen Platz), 'form' = Umbenennen-Feld. */
function askRename(from, to, where) {
  from = from.trim();
  const n = exSessionCount(from), test = window.confirm !== NATIVE_CONFIRM;
  if (!n) return Promise.resolve('all');  // keine Daten → nichts zu fragen
  const msg = `„${from}“ in „${to}“ umbenennen?\n\nSollen deine bisherigen Daten (${trainingsText(n)}: Gewichte, Rekorde, Diagramme) auf „${to}“ übertragen werden?\n\n`
    + (where === 'slot' ? `Nein: „${to}“ beginnt hier im Plan als neue Übung, die bisherigen Daten bleiben bei „${from}“.`
      : `Nein: „${to}“ beginnt als neue Übung, die bisherigen Trainings bleiben unter „${from}“ im Verlauf.`);
  if (test) return Promise.resolve(window.confirm(msg) ? 'all' : 'new');
  return uiDialog({ msg, confirm: true, choices: [{ label: 'Abbrechen', value: null },
    { label: 'Nein, als neue Übung', value: 'new' }, { label: 'Ja, Daten übertragen', value: 'all', primary: true }] }).then(v => v || null);
}
// Nur dieser Platz im Trainingstag bekommt den neuen Namen (Art und Muskelgruppe bleiben)
function exSlotRename(day, i, from, to) {
  const ex = day.exercises[i], kind = kindOf(ex), group = groupOf(ex);
  ex.name = to;
  if (!ex.kind && kindOf({ name: to }) !== kind) ex.kind = kind;
  if (!ex.group && group && groupOf({ name: to }) !== group) ex.group = group;
  saveData();
  toast(`Übung „${from}“ in „${to}“ umbenannt ✔ – die bisherigen Daten bleiben bei „${from}“`);
}

function renameExercise(from, to, ask = true, mode = 'all') {
  to = renameCheck(from, to);
  if (to == null) return false;
  if (to === from.trim()) return true;
  const kf = nameKey(from), kt = nameKey(to), all = mode !== 'new';
  const custom = customExercise(from), builtin = builtinExercise(from);
  const n = exSessionCount(from);
  if (ask && !askOk(`„${from.trim()}“ wirklich in „${to}“ umbenennen?\n\nDer neue Name gilt überall – in allen Plänen und im Verlauf.`
    + (n ? ` Deine ${n === 1 ? 'bisherigen Einträge aus 1 Training werden' : `bisherigen Einträge aus ${n} Trainings werden`} auf den neuen Namen übertragen (Gewichte, Rekorde, Diagramme).` : '')
    + (builtin && kt !== kf ? `\n\nDie Übung erscheint danach unter „★ Eigene Übungen“; Figur und Tipps von „${from.trim()}“ bleiben verknüpft.` : ''))) return false;
  // Art und Muskelgruppe festhalten, bevor sich der Name ändert (sonst würde neu geraten)
  const kind = kindOf({ name: from }), group = groupOf({ name: from });
  const fix = o => {
    if (!o) return;
    if (nameKey(o.name) === kf) {
      if (!custom && !builtin) { if (!o.kind && kindOf({ name: to }) !== kind) o.kind = kind; if (!o.group && group && groupOf({ name: to }) !== group) o.group = group; }
      o.name = to;
    }
    if (o.replacedFrom && nameKey(o.replacedFrom) === kf) o.replacedFrom = to;
  };
  for (const p of data.plans) for (const d of p.days) d.exercises.forEach(fix);
  if (all) for (const s of data.sessions) s.entries.forEach(fix);
  if (draft) { draft.entries.forEach(fix); saveDraft(); }
  if (custom && all) custom.name = to;
  else if (custom) data.customExercises.push({ ...custom, name: to });
  else if (builtin && kt !== kf) data.customExercises.push({ name: to, kind, group, like: libEntry(from) ? from.trim() : '', note: '' });
  if (all) {
    for (const m of [data.hintsDismissed, hintOff().ex, hintOff().low]) if (kt !== kf && m[kf] !== undefined) { m[kt] = m[kf]; delete m[kf]; }
    if (typeof chartState !== 'undefined' && nameKey(chartState.name) === kf) chartState.name = to;
  }
  registerCustomExercises();
  saveData();
  exRename = null;
  toast(`Übung „${from.trim()}“ in „${to}“ umbenannt ✔${!n || kt === kf ? '' : all ? ` – ${trainingsText(n)} übertragen` : ` – die bisherigen Daten bleiben bei „${from.trim()}“`}`);
  return true;
}

// Namensfeld im Trainingstag (v219): erst beim Verlassen des Feldes bzw. bei der Auswahl übernehmen – nicht bei jedem Buchstaben.
// Bekannte Übung = ersetzen, neuer Name = umbenennen (mit Rückfrage, ob die bisherigen Daten mitgehen).
async function exNameCommit(el) {
  if (el.dataset.busy) return;
  const day = findDay(current.params.id), i = Number(el.dataset.i), ex = day && day.exercises[i];
  if (!ex) return;
  const from = String(el.dataset.orig || '').trim(), to = el.value.trim().replace(/\s+/g, ' ');
  if (!from) { if (ex.name !== to) { ex.name = to; saveData(); } return; }  // neue Übung: wird beim Tippen schon gespeichert
  if (!to || to === from) { el.value = from; return; }
  el.dataset.busy = '1';
  el.dataset.orig = to;  // nicht zweimal übernehmen (Auswahl + Verlassen des Feldes)
  try {
    if (nameKey(to) !== nameKey(from) && (builtinExercise(to) || customExercise(to) || exNameUsed(nameKey(to)))) {
      if (planReplaceExercise(day, i, to)) render();
      return;
    }
    const how = nameKey(to) === nameKey(from) ? 'all' : await askRename(from, to, 'slot');
    if (!how) { el.value = from; el.dataset.orig = from; const info = el.parentElement && el.parentElement.querySelector('.info-btn'); if (info) info.hidden = !libEntry(from); return; }
    if (how === 'all') renameExercise(from, to, false);
    else exSlotRename(day, i, from, to);
    render();
  } finally { delete el.dataset.busy; }
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
  delete ex.tech;  // Intensitätstechnik gehört zur Übung (v211)
  // unbekannte Übung: Muskelgruppe der alten behalten, damit das Wochenvolumen stimmt
  ex.group = EXERCISE_GROUPS.has(nameKey(name)) ? null : oldGroup;
  planSwap = null;
  const hadSs = !!ex.ss;
  ssClean(day.exercises);  // Supersatz (v210): passt die neue Übung nicht mehr als Paar, wird es gelöst
  saveData();
  toast(hadSs && !ex.ss ? `Ersetzt durch „${name}“ – der Supersatz ist gelöst, weil die Übungen nicht als Paar passen` : `Ersetzt durch „${name}“ ✔`);
  return true;
}

// Übung im Trainingstag eines eigenen Plans: nur Sätze × Wdh., Startgewicht und Ausführung
function ownExerciseCard(ex, i) {
  return `<div class="card">
    <div class="ex-name-row">
      <input class="inp" type="text" data-field="ex-name" data-i="${i}" data-orig="${esc(ex.name)}"
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
    <div class="variants plan"><span>Ausführung</span>${Object.entries(EXEC_VARIANTS).map(([v, label]) =>
      `<button class="vchip ${(ex.variant || '') === v ? 'on' : ''}" data-action="plan-variant" data-i="${i}" data-v="${v}">${label}</button>`).join('')}
    </div>
    <div class="row">
      <button class="icon-btn danger" data-action="ex-del" data-i="${i}">Entfernen</button>
    </div>
  </div>`;
}

// Reihenfolge der Übungen im Plan ändern (User-Wunsch 2026-11-09): kompakte Liste mit Pfeilen, bleibt dauerhaft im Plan
var dayReorder = null;  // id des Trainingstags, dessen Reihenfolge gerade geändert wird
function dayReorderHtml(day) {
  const n = day.exercises.length;
  if (n < 2) return '';
  if (dayReorder !== day.id) return '<button class="btn outline" data-action="day-reorder">⇅ Reihenfolge ändern</button>';
  return `<div class="card"><h2>Reihenfolge</h2><ul class="list reorder">${day.exercises.map((ex, i) => `<li class="bw-row">
        <span>${i + 1}. ${dayPairs(day.exercises, true).has(i) ? '🔗 ' : ''}${esc(ex.name.trim() || 'Neue Übung')}</span>
        <button class="icon-btn" data-action="ex-up" data-i="${i}" aria-label="Nach oben" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-action="ex-down" data-i="${i}" aria-label="Nach unten" ${i === n - 1 ? 'disabled' : ''}>↓</button>
      </li>`).join('')}</ul>
    <button class="btn primary" data-action="day-reorder">✔ Fertig</button>
    <p class="hint">Die Reihenfolge bleibt im Plan, bis du sie wieder änderst – in allen kommenden Trainings dieses Tages.${dayPairs(day.exercises, true).size ? ' 🔗 Supersätze wandern als Paar.' : ''}
      Ein schon begonnenes Training behält seine Reihenfolge.</p></div>`;
}

function renderDay({ id }) {
  const day = findDay(id);
  if (!day) return '<p class="hint">Trainingstag nicht gefunden.</p>';
  if (ownPlan()) {
    return `<label class="lbl">Name des Trainingstags
        <input class="inp" type="text" data-field="day-name" value="${esc(day.name)}"></label>
      <p class="hint">Eigener Plan: Sätze und Wiederholungen legst du pro Übung selbst fest – die App steigert nichts.</p>
      <h2>Übungen</h2>${dayReorderHtml(day)}${dayReorder === day.id ? '' : day.exercises.map(ownExerciseCard).join('')}
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
    <p class="hint explain">${!feat('day-reprange') ? 'Sätze, Wiederholungen und Gewichte rechnet die App automatisch aus.' : dayIntensity(day)
      ? `${{ heavy: 'Niedrig: mehr Gewicht, weniger Wiederholungen', light: 'Hoch: weniger Gewicht, mehr Wiederholungen' }[dayIntensity(day)]} – beides sind intensive Trainingstage, nur mit unterschiedlicher Belastung.
        Sätze und Wiederholungen werden automatisch aus Muskelgruppe, Übungsart und Zykluswoche berechnet.`
      : 'Frei: Sätze und Wiederholungen legst du pro Übung selbst fest.'}</p>
    ${feat('day-volume') ? volumeSummary(day) : ''}
    <h2>Übungen</h2>${dayReorderHtml(day)}`;
  if (dayReorder === day.id) return h;
  const bw = data.cycle.buildWeeks;
  const autoWeeks = Array.from({ length: bw }, (_, w) => autoSetsForDay(day, w + 1, false));
  const autoDeload = autoSetsForDay(day, 0, true);
  const pairs = dayPairs(day.exercises);  // Supersätze (v210)
  day.exercises.forEach((ex, i) => {
    const isAuto = autoDeload.has(ex.id);
    const pr = pairs.get(i);
    if (pr && pr.role === 'A') h += `<div class="ss-wrap plan">${ssPlanHead(day, pr)}`;
    h += `<div class="card${pr ? ' ss-card' : ''}">
      <div class="ex-name-row">${pr ? `<span class="ss-badge">${pr.role}</span>` : ''}
        ${feat('plan-add-ex') || !ex.name.trim() ? `<input class="inp" type="text" data-field="ex-name" data-i="${i}" data-orig="${esc(ex.name)}"
          autocomplete="off" autocorrect="off" spellcheck="false"
          value="${esc(ex.name)}" placeholder="Übung eintippen, z. B. Bank…">` : `<h3 class="plan-ex-name">${esc(ex.name)}</h3>`}
        <button class="info-btn" data-action="lib-open" data-i="${i}" aria-label="Ausführung ansehen"
          ${libEntry(ex.name) ? '' : 'hidden'}>i</button>
      </div>
      <div class="suggest" hidden></div>
      ${planSwapHtml(day, ex, i)}
      ${ssPick && ssPick.day === day.id && ssPick.i === i ? ssPickHtml(day, i) : ''}
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
      ${feat('tr-variants') ? `<div class="variants plan"><span>Ausführung</span>${Object.entries(EXEC_VARIANTS).map(([v, label]) =>
        `<button class="vchip ${(ex.variant || '') === v ? 'on' : ''}" data-action="plan-variant" data-i="${i}" data-v="${v}">${label}</button>`).join('')}
      </div>${ex.name.trim() ? techPlanHtml(ex, i) : ''}` : ''}
      ${bodyweightRow(ex, i)}
      ${isBodyweight(ex) || !feat('tr-max') ? '' : `<label class="row">
        <span>Max. kg bei 10 Wdh.<br><small class="hint">frisch, ohne Vorermüdung</small></span>
        <input class="inp kg ${ex.max10 == null ? 'missing' : ''}" type="text" inputmode="decimal"
          autocomplete="off" data-field="ex-max" data-i="${i}" placeholder="kg"
          value="${ex.max10 == null ? '' : fmtNum(ex.max10)}">
      </label>
      ${feat('tr-step') ? `<div class="variants plan"><span>Steigerung${ex.step == null ? ' <small class="hint">(auto)</small>' : ''}</span>${STEP_OPTIONS.map(v =>
        `<button class="vchip ${stepFor(ex) === v ? 'on' : ''}" data-action="set-step" data-i="${i}" data-v="${v}">${fmtNum(v)} kg</button>`).join('')}
      </div>` : ''}`}
      <div class="row">
        <button class="icon-btn danger" data-action="ex-del" data-i="${i}">Entfernen</button>
      </div>
    </div>`;
    if (pr && pr.role === 'B') h += '</div>';
  });
  h += `${ssAutoBtnHtml(day)}${feat('plan-add-ex') ? '<button class="btn center" data-action="add-ex">+ Übung hinzufügen</button>' : ''}
    <button class="btn primary" data-action="day-done">✔ Fertig</button>
    <p class="hint explain">${feat('tr-max') ? `Änderungen werden automatisch gespeichert. „Max. kg bei 10 Wdh.“ wird nach jedem Training automatisch angepasst. ${MAX_FRESH_NOTE} Steigerung: Kurzhantel-Übungen 2 kg, alle anderen 2,5 kg – pro Übung änderbar auf 1,25 / 2 / 2,5 / 5 / 10 kg. ${STEP_HINT}`
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
  const seg = typeof histSegHtml === 'function' ? histSegHtml('cal') : '';  // v203: Kalender | Übungen | Statistik | Erfolge
  if (!data.sessions.length && !cardioList.length) {
    return seg + cardio + '<p class="hint">Noch keine Trainings gespeichert.</p>';
  }
  const byDay = new Map();
  for (const s of sessionsNewestFirst()) {
    const d = localDay(s.date);
    if (!byDay.has(d)) byDay.set(d, []);
    byDay.get(d).push(s);
  }
  const icon = c => (typeof CARDIO_TYPES !== 'undefined' && (CARDIO_TYPES[c.type] || CARDIO_TYPES.other).icon) || '🏃';
  const st = calGet('hist');
  let h = seg + calendarHtml('hist', iso => {
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
  h += typeof reviewHistoryHtml === 'function' ? reviewHistoryHtml() : '';  // Zyklus-Rückblicke (charts.js)
  h += complaintsHistBtn();  // Beschwerden-Verlauf (v208)
  // die Übungsliste steht seit v203 im Bereich „Übungen“ (charts.js, histExListHtml)
  return h;
}

function renderExercise({ name }) {
  const k = nameKey(name);
  const rows = [];
  for (const s of sessionsNewestFirst()) {
    const e = s.entries.find(en => nameKey(en.name) === k);
    if (e) rows.push({ session: s, entry: e, sets: e.sets, comment: e.comment, band: e.target && e.target.band });
  }
  if (!rows.length) return '<p class="hint">Keine Einträge.</p>';

  const weights = rows.flatMap(r => r.sets.map(s => s.weight)).filter(w => w != null);
  let h = weights.length
    ? `<p class="sub">Höchstes Gewicht: <b>${fmtNum(Math.max(...weights))} kg</b> · ${rows.length} Trainings</p>`
    : '';
  if (libEntry(name)) h += `<button class="link-btn lib-small" data-action="lib-open" data-name="${esc(name)}">ⓘ Ausführung ansehen</button>`;
  h += `<button class="link-btn lib-small" data-action="vid-open-list" data-name="${esc(name)}">🎥 Technik-Videos</button>`;  // v213 (media.js)
  // v203: Diagramm oben, darunter alle Einträge (früher zwei getrennte Seiten)
  if (weights.length && typeof exChartHtml === 'function') h += exChartHtml(name);
  h += `<h2 class="ex-list-h">Alle Einträge</h2>`;
  h += '<ul class="list">';
  for (const r of rows) {
    h += `<li><div class="date">${fmtDate(r.session.date)} <small>${esc(r.session.dayName)}</small></div>
      <div class="sets">${sessionPbHtml(r.session, r.entry)}</div>
      ${r.comment ? `<div class="comment-text">💬 ${esc(r.comment)}</div>` : ''}</li>`;
  }
  h += '</ul>';
  // Umbenennen selten gebraucht -> ans Ende (v203)
  return h + (exRename === name ? renameFormHtml(name)
    : `<button class="btn outline" data-action="ex-rename-open" data-name="${esc(name)}">✎ Übung umbenennen</button>`);
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
  const qw = q.split(/[^a-z0-9]+/).filter(Boolean);  // v222: auch englische Begriffe, jedes Wort für sich
  const hits = EXERCISE_LIST.filter(([n]) => { const t = norm(exSearchText(n)); return t.includes(q) || (qw.length > 1 && qw.every(w => t.includes(w))); }).slice(0, 40);
  return hits.length ? hits.map(([n]) => libRow(n)).join('') : '<p class="hint">Keine Übung gefunden.</p>';
}

function renderLibrary() {
  let h = `<input class="inp lib-search" type="search" data-field="lib-search" autocomplete="off" autocorrect="off"
      spellcheck="false" placeholder="Übung suchen, z. B. Rudern …" value="${esc(libQuery)}">
    <div id="lib-results">${libResults()}</div>
    <div id="lib-groups" ${libQuery.trim() ? 'hidden' : ''}>
    <p class="hint explain">Jede Übung mit animierter Ausführung, Zielmuskeln und Tipps. Muskelgruppe antippen zum Aufklappen.</p>
    ${feat('custom-ex') ? '<button class="btn outline lib-add-btn" data-action="libc-new">＋ Eigene Übung hinzufügen</button>' : ''}
    <p class="hint explain">Dir fehlt eine Übung, z. B. ein besonderes Gerät in deinem Studio? Leg sie einmal an – danach kannst du sie
      jederzeit wieder aufrufen: im Plan, im Plan-Assistenten und beim Ersetzen oder Hinzufügen im Training.</p>`;
  if (data.customExercises.length) {
    const open = libOpenGroups.has('own');
    h += `<details class="award-cat lib-group" ${open ? 'open' : ''}>
      <summary data-action="lib-toggle" data-g="own">★ Eigene Übungen <small class="hint">(${data.customExercises.length})</small></summary>
      ${open ? data.customExercises.map(c => libRow(c.name)).join('') : ''}</details>`;
  }
  // Sportarten (v222): Calisthenics und Hyrox mit Unterabschnitten
  for (const [k, sp] of Object.entries(typeof EX_SPORTS !== 'undefined' ? EX_SPORTS : {})) {
    const names = sp.parts.flatMap(([, list]) => list).filter(n => EXERCISE_KINDS.has(nameKey(n)));
    const open = libOpenGroups.has('sp-' + k);
    h += `<details class="award-cat lib-group lib-sport" ${open ? 'open' : ''}>
      <summary data-action="lib-toggle" data-g="sp-${k}">${sp.icon} ${sp.label} <small class="hint">(${names.length})</small></summary>
      ${open ? `<p class="hint lib-sport-hint">${esc(sp.hint)}</p>` + sp.parts.map(([title, list]) => {
        const ok = list.filter(n => EXERCISE_KINDS.has(nameKey(n)));
        return ok.length ? `<h3 class="lib-sub">${esc(title)}</h3>${ok.map(n => libRow(n)).join('')}` : '';
      }).join('') : ''}</details>`;
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
      <p class="hint explain">Danach ist die Übung dauerhaft gespeichert und du kannst sie einfach immer wieder abrufen: in der Bibliothek
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
  if (!sessions.length && !ahead && !isNow) h += '<p class="hint">In dieser Woche wurde nicht trainiert.</p>';
  if (isNow && data.days.length) h += `<p class="hint">🔄 ${roundStatus(ci)}</p>`;
  // laufende und künftige Wochen des aktuellen Zyklus: geplante Trainingstage (laufende Woche: nur die noch offenen)
  if ((ahead || isNow) && hasActivePlan() && !ownPlan()) {
    const deload = !selfDeload() && week > ci.buildWeeks;
    const open = isNow ? new Set(roundOpen(start, week).map(x => x.day.id)) : null;
    h += weekPlanHtml(week, deload || (isNow && ci.deload), open);
  }
  if (sessions.length) h += '<p class="hint">Training antippen, um es anzusehen oder nachträglich zu ändern.</p>';
  return h;
}

// Geplante Trainingstage einer Woche: je Übung Sätze × Wdh. (und Tank-Ziel) – die Gewichte ergeben sich erst im Training
// aus dem, was du davor schaffst. only = nur diese Tage (laufende Woche: noch offene)
function weekPlanHtml(week, deload, only = null) {
  const bw = data.cycle.buildWeeks || 4;
  const w = deload ? bw : Math.min(Math.max(1, week), bw);  // Verlängerung: wie die letzte Aufbauwoche
  const days = activeDays().filter(d => dayTimes(d, week) && (!only || only.has(d.id)));
  if (!days.length) return '';
  let h = `<h2>${only ? 'Noch offen in dieser Woche' : 'Geplant'}</h2>`;
  for (const day of days) {
    const auto = autoSetsForDay(day, w, deload, data.volume);
    const items = day.exercises.filter(e => e.name.trim()).map(ex => {
      const n = auto.has(ex.id) ? auto.get(ex.id) : deload ? deloadSets(setsForWeek(ex, bw, bw)) : setsForWeek(ex, w, bw);
      const reps = dayIntensity(day) ? repRangeText(day, ex) : ex.reps;
      const tank = deload ? `mind. ${DELOAD_RIR}` : rirLabel(kindOf(ex), w, bw, groupOf(ex));
      return `<li><span>${esc(ex.name)}</span><b>${n} × ${reps}</b>${feat('tr-tank-target') ? `<small>${tank} im Tank</small>` : ''}</li>`;
    }).join('');
    const times = dayTimes(day, week);
    const est = estDuration(day, week, activePlan(), deload);
    h += `<div class="card week-plan"><p class="week-plan-head"><b>${esc(day.name)}</b>${times > 1 ? ` <span class="badge">${times}×</span>` : ''}
      ${est ? `<small>${estText(est)}</small>` : ''}</p><ul class="week-plan-list">${items}</ul></div>`;
  }
  return h + `<p class="hint">${deload ? 'Deload: halbe Sätze, etwa 15 % weniger Gewicht oder weniger Wdh. als in der letzten Trainingswoche.'
    : 'Sätze × Wiederholungen laut Plan. Die Gewichte schlägt die App im Training vor – passend zu dem, was du davor geschafft hast.'}</p>`;
}

// Arbeitskopie beim Bearbeiten eines gespeicherten Trainings (Werte als Text wie in den Eingabefeldern)
let sessionEdit = null;

function startSessionEdit(s) {
  const txt = n => n == null ? '' : fmtNum(n);
  sessionEdit = {
    id: s.id,
    entries: s.entries.map(e => ({
      comment: e.comment || '',
      sets: e.sets.map(st => ({ weight: txt(st.weight), reps: txt(st.reps), rir: txt(st.rir), variant: st.variant, ...(st.subs ? { subs: st.subs } : {}),
        ...(st.outlier ? { outlier: 1, w0: st.weight } : {}) })),
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
    const orig = s.entries[ei] || {};
    const sets = e.sets
      .map((st, i) => {
        const x = { weight: parseNum(st.weight), reps: parseNum(st.reps), rir: parseNum(st.rir),
          ...(st.variant ? { variant: st.variant } : {}), ...(st.subs && isTech(st.variant) ? { subs: st.subs } : {}) };
        // v215: Ausreißer neu prüfen – korrigiert zählt der Satz wieder; ohne Vorschlag bleibt die Markierung, solange das Gewicht gleich ist
        const pl = (orig.planned || [])[i];
        if (pl && (pl.weight > 0 || pl.reps > 0) ? setOutlier(x, pl) : st.outlier && x.weight === st.w0) x.outlier = 1;
        return x;
      })
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
  s.entries.forEach((en, i) => { const f = sessionFat(s, i); if (f) en.fat = f; else delete en.fat; });
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
  const top = (fresh ? motivAfterHtml(s) : '') + (won.length ? `<div class="card award-new">${won.map(a =>
      `<div class="award-row"><span class="award-icon">${a.icon}</span><div><b>Neuer Erfolg: ${esc(a.name)}</b><small>${esc(a.desc)}</small></div></div>`).join('')}</div>` : '') +
    (fresh ? backupAfterTrainingCard() + ssCheckCard(s) : '') +
    `<div class="stats two"><div class="stat"><span>Bewegt (Tonnage)</span><b>${fmtTons(sessionTonnage(s))}</b></div>
      <div class="stat"><span>Dauer</span><b>${s.duration ? fmtDur(s.duration) : '–'}</b></div></div>
    <button class="btn ${fresh ? 'primary' : 'outline'} share-btn" data-action="share-open" data-id="${s.id}">📤 Ergebnis teilen</button>`;
  const progNote = s.progression ? ` · ${progOffText(s.progression)}` : '';
  let h = top + `<p class="sub">${fmtDate(s.date, true)}<br>${esc(s.dayName)}${s.deload ? ' · Deload-Woche (keine Steigerung)' : progNote}` +
    (s.readiness ? `<br>Tagesform: ${readinessText(s.readiness)}` : '') + (s.timeLimit ? `<br>⏱ auf ${s.timeLimit} min gekürzt` : '') + '</p>' +
    `${feat('session-edit') ? `<button class="btn outline" data-action="se-edit" data-id="${s.id}">✎ Training bearbeiten</button>` : ''}<ul class="list">`;
  for (const e of s.entries) {
    const res = e.result
      ? `<div class="result">${resultText(e.result)}</div>`
      : '';
    const instead = e.replacedFrom ? ` <small>statt ${esc(e.replacedFrom)}</small>` : '';
    const comment = e.comment ? `<div class="comment-text">💬 ${esc(e.comment)}</div>` : '';
    const warm = e.warmup && e.warmup.length
      ? `<div class="warm-line">🔥 Aufwärmen: ${e.warmup.map(fmtSet).join(' · ')}</div>` : '';
    h += `<li><div class="date">${esc(e.name)}${instead}${e.ss ? ' <small class="ss-tag">🔗 Supersatz</small>' : ''}</div>${warm}
      <div class="sets">${sessionPbHtml(s, e)}</div>${comment}${res}</li>`;
  }
  return h + `</ul><button class="btn danger" data-action="del-session" data-id="${s.id}">Dieses Training löschen</button>`;
}

/* ---------- Ergebnis teilen (v206, User-Wunsch 2026-11-11) ---------- */
// Aus einem gespeicherten Training malt die App ein Bild im Story-Format (1080 × 1920) in der Farbwelt der App: Tagesname,
// Datum/Woche, Dauer, Tonnage, Sätze, Übungen und neue Bestleistungen (sonst die schwersten Sätze). Nie Körpergewicht oder
// Gesundheitsdaten. Teilen über das Teilen-Menü (Web Share mit Datei), sonst als Bild-Download.
const APP_NAME = 'LockYourGains';  // v217: neuer Name (vorher StepUp Strength)
const APP_SHORT = 'Gainslocker';   // Kurzname: unter dem Symbol und in Dateinamen
// Beta (eigene Adresse lockyourgains-beta.github.io, eigener Speicher) und alte Adresse (Umzugshilfe) – an der Adresse erkannt
// (zum Testen ohne echte Adresse: localStorage „trainingsapp-kanal“ = 'beta' bzw. 'alt')
const CHANNEL_TEST = (() => { try { return localStorage.getItem('trainingsapp-kanal') || ''; } catch (e) { return ''; } })();
const IS_BETA = /-beta\.github\.io$/i.test(location.hostname) || CHANNEL_TEST === 'beta';
const OLD_HOST = /^stepup-strength\.github\.io$/i.test(location.hostname) || CHANNEL_TEST === 'alt';
const NEW_URL = 'https://lockyourgains.github.io/';
let shareUrl = null, shareFile = null;
const shareSetText = x => x.weight != null ? `${fmtNum(x.weight)} kg × ${x.reps != null ? x.reps : '–'}` : `${x.reps != null ? x.reps : '–'} Wdh.`;
function shareData(s) {
  const heavier = (a, b) => (b.weight || 0) > (a.weight || 0) || ((b.weight || 0) === (a.weight || 0) && (b.reps || 0) > (a.reps || 0)) ? b : a;
  const pbs = [], tops = [];
  for (const e of s.entries) {
    if (!e.sets.length) continue;
    const flags = pbFlags(e.sets, pbBest(e.name, s.date, s.id), e.target && e.target.band);
    const hit = e.sets.filter((x, i) => flags[i]);
    if (hit.length) pbs.push({ name: e.name, set: hit.reduce(heavier) });
    tops.push({ name: e.name, set: e.sets.reduce(heavier) });
  }
  return { sets: s.entries.reduce((a, e) => a + e.sets.length, 0), pbs, tops };
}
function shareCanvas(s) {
  const W = 1080, H = 1920, X = 90, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const cs = getComputedStyle(document.body);
  const a1 = cs.getPropertyValue('--accent').trim() || '#3a6df0', a2 = cs.getPropertyValue('--accent-2').trim() || a1;
  const F = (w, px) => `${w} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;
  const fit = (t, max) => { if (g.measureText(t).width <= max) return t; while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1); return t.trimEnd() + '…'; };
  const wrap = (t, max) => {
    const out = [];
    let line = '';
    for (const w of String(t).split(/\s+/)) {
      const test = line ? `${line} ${w}` : w;
      if (line && g.measureText(test).width > max) { out.push(line); line = w; } else line = test;
    }
    if (line) out.push(line);
    return out;
  };
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  // Hintergrund: Verlauf der Farbwelt, zwei helle Kreise
  const grd = g.createLinearGradient(0, 0, W, H);
  grd.addColorStop(0, a1); grd.addColorStop(1, a2);
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.fillStyle = 'rgba(255,255,255,.08)';
  g.beginPath(); g.arc(W - 40, 170, 360, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(60, H - 300, 250, 0, Math.PI * 2); g.fill();
  g.textBaseline = 'alphabetic';
  // Kopf
  let y = 200;
  g.fillStyle = 'rgba(255,255,255,.78)'; g.font = F(800, 38);
  g.fillText('TRAINING GESCHAFFT', X, y);
  y += 120;
  g.fillStyle = '#fff'; g.font = F(800, 92);
  for (const line of wrap(s.dayName, W - 2 * X).slice(0, 2)) { g.fillText(fit(line, W - 2 * X), X, y); y += 104; }
  g.font = F(500, 42); g.fillStyle = 'rgba(255,255,255,.88)';
  const wk = s.deload ? 'Deload-Woche' : s.week ? weekLabel(s.week) : '';
  g.fillText(fit(fmtDate(s.date, true) + (wk ? ` · ${wk}` : ''), W - 2 * X), X, y);
  y += 80;
  // Kacheln
  const d = shareData(s);
  const tiles = [s.duration ? ['Dauer', fmtDur(s.duration)] : ['Bestleistungen', String(d.pbs.length)],
    ['Bewegt', fmtTons(sessionTonnage(s))], ['Sätze', String(d.sets)], ['Übungen', String(s.entries.length)]];
  const tw = (W - 2 * X - 30) / 2, th = 190;
  tiles.forEach(([label, val], i) => {
    const tx = X + (i % 2) * (tw + 30), ty = y + Math.floor(i / 2) * (th + 30);
    g.fillStyle = 'rgba(255,255,255,.16)'; rr(tx, ty, tw, th, 36); g.fill();
    g.fillStyle = 'rgba(255,255,255,.8)'; g.font = F(700, 32); g.fillText(label.toUpperCase(), tx + 40, ty + 62);
    g.fillStyle = '#fff'; g.font = F(800, 72); g.fillText(fit(val, tw - 80), tx + 40, ty + 146);
  });
  y += 2 * th + 30 + 100;
  // Bestleistungen, sonst die schwersten Sätze
  const list = d.pbs.length ? d.pbs : d.tops;
  g.fillStyle = '#fff'; g.font = F(800, 50);
  g.fillText(d.pbs.length ? `★ ${d.pbs.length === 1 ? 'Neue Bestleistung' : `${d.pbs.length} neue Bestleistungen`}` : 'Heute trainiert', X, y);
  y += 30;
  const fits = n => Math.max(1, Math.floor((H - 230 - n - y) / 120));
  const room = Math.min(5, list.length <= fits(0) ? fits(0) : fits(60));  // passt nicht alles: Platz für „+ N weitere“
  const shown = list.slice(0, Math.min(5, room));
  for (const it of shown) {
    y += 120;
    g.fillStyle = 'rgba(255,255,255,.14)'; rr(X, y - 94, W - 2 * X, 106, 28); g.fill();
    g.font = F(800, 44); g.fillStyle = '#fff';
    const val = shareSetText(it.set), vw = g.measureText(val).width;
    g.fillText(val, W - X - 36 - vw, y - 27);
    g.font = F(600, 40); g.fillStyle = 'rgba(255,255,255,.92)';
    g.fillText(fit(it.name, W - 2 * X - 108 - vw), X + 36, y - 27);
  }
  if (list.length > shown.length) {
    y += 64; g.font = F(600, 36); g.fillStyle = 'rgba(255,255,255,.8)';
    g.fillText(`+ ${list.length - shown.length} weitere`, X + 36, y);
  }
  // Fuß: App-Name
  g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(X, H - 190, W - 2 * X, 3);
  g.fillStyle = '#fff'; g.font = F(800, 46); g.fillText(APP_NAME, X, H - 110);
  return c;
}
function renderShare({ id }) {
  const s = data.sessions.find(x => x.id === id);
  if (!s) return '<p class="hint">Training nicht gefunden.</p>';
  return `<div class="share-wrap"><img class="share-img" id="share-img" alt="Bild deines Trainings ${esc(s.dayName)}"></div>
    <div class="row"><button class="btn primary" data-action="share-send" disabled>📤 Teilen</button>
      <button class="btn" data-action="share-save" disabled>Bild speichern</button></div>
    <p class="hint explain">Das Bild zeigt nur Trainingstag, Dauer, bewegtes Gewicht, Sätze und deine Bestleistungen – kein Körpergewicht und
      keine Gesundheitsdaten. Die Farben kommen aus deiner Farbwelt (Optionen → Aussehen).</p>`;
}
function shareDraw({ id }) {
  const s = data.sessions.find(x => x.id === id), img = document.getElementById('share-img');
  if (!s || !img) return;
  img.src = canvasToShare(shareCanvas(s), `${APP_SHORT}-Training ${localDay(s.date)}.jpg`);
  $view.querySelectorAll('[data-action="share-send"], [data-action="share-save"]').forEach(b => { b.disabled = false; });
}
// Bild zum Teilen bereitlegen (shareUrl/shareFile) und als Daten-URL für die Vorschau zurückgeben
// sofort (toDataURL) statt asynchron (toBlob): zuverlässiger, und das Teilen-Menü bekommt die Datei ohne Wartezeit
// JPEG statt PNG: der Farbverlauf wäre als PNG über 1 MB groß
function canvasToShare(c, fileName) {
  const url = c.toDataURL('image/jpeg', 0.92);
  const bin = atob(url.slice(url.indexOf(',') + 1)), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], { type: 'image/jpeg' });
  if (shareUrl) URL.revokeObjectURL(shareUrl);
  shareUrl = URL.createObjectURL(blob);
  shareFile = new File([blob], fileName, { type: 'image/jpeg' });
  return url;
}
views.share = { title: 'Ergebnis teilen', tab: 'history', back: p => ['session', { id: p.id, week: p.week }], render: renderShare, after: shareDraw };
// Beschwerde-Tagebuch (v208/v209) – hier, weil views erst oben im Abschnitt „Bildschirme“ entsteht
views.complaints = { title: 'Beschwerden', tab: p => p.from === 'start' ? 'start' : 'history', back: p => [p.from || 'history', {}], render: renderComplaints };
views.complreport = { title: 'Bericht', tab: p => p.from === 'start' ? 'start' : 'history', back: p => ['complaints', { from: p.from }],
  render: renderComplReport, after: complReportDraw };
function shareSave() {
  if (!shareUrl) return;
  const a = document.createElement('a');
  a.href = shareUrl; a.download = shareFile.name;
  document.body.appendChild(a); a.click(); a.remove();
  toast('Bild gespeichert ✔');
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
      <p class="hint wiz-q-explain">${MAX_FRESH_NOTE}</p>
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
      <h2 class="question">Fühlst du dich fit?</h2>
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
  if (r.mc && r.mc.lvl && typeof MC_LEVELS !== 'undefined') parts.push(`Zyklus: ${MC_LEVELS[r.mc.lvl].short}`);
  return parts.join(', ');
};

// Modus wählen (Optionen)
// v207: kompakt – drei Knöpfe nebeneinander, darunter die Beschreibung des gewählten Modus
function modeCard() {
  const m = appMode();
  return `<div class="card mode-card">
      <h2>Modus</h2>
      <div class="seg three mode-seg">${Object.entries(APP_MODES).map(([k, x]) =>
        `<button class="${m === k ? 'on' : ''}" data-action="mode-set" data-m="${k}">${x.label}</button>`).join('')}</div>
      <p class="hint mode-desc"><b>${APP_MODES[m].icon} ${APP_MODES[m].label}:</b> ${APP_MODES[m].text} Ein Wechsel ändert nichts an deinen Daten –
        die Trainingssteuerung ist in allen Modi dieselbe.</p>
    </div>`;
}

// Ausgeblendete Hinweise im Training wieder einschalten (erscheint nur, wenn etwas ausgeblendet ist)
function hintOffCard() {
  const h = hintOff(), n = Object.keys(h.ex).length;
  if (!h.all && !n) return '';
  return `<div class="card"><h2>Hinweise im Training</h2>
      <p class="hint">Hinweise auf schwerere Varianten bei mehr als ${REP_SOFT_MAX} Wdh. sind ${h.all ? 'für alle Übungen' : `für ${n} Übung${n === 1 ? '' : 'en'}`} ausgeblendet.</p>
      <button class="btn outline" data-action="hint-on">Wieder anzeigen</button></div>`;
}

// Erklärung der Vorermüdung (User-Wunsch 2026-11-10: nicht mehr in den Optionen, sondern einmal oben im Training hinter
// einem Knopf) – nur, wenn heute mindestens eine Übung vorermüdet ist
let prefatHelpOpen = false;
const prefatToday = () => feat('tr-prefat') && !!draft && draft.entries.some(en => en.target && (en.target.fat || 0) >= PREFAT_SHOW - 1e-9);
function prefatHelpHtml() {
  if (!prefatToday() || !prefatHelpOpen) return '';  // v200: aufrufbar über das Menü „⋯“ in der Kopfleiste
  const L = prefatLearn(), pct = fmtNum(Math.round(L.rate * 1000) / 10);
  const sure = L.w < 5 ? 'noch wenig Daten' : L.w < 15 ? 'mittlere Sicherheit' : 'gut abgesichert';
  return `<div class="entry-help">
    <b class="entry-help-title">Vorermüdung – so rechnet die App</b>
    <p>Hat eine Muskelgruppe vorher im Training schon gearbeitet, ist sie bei der nächsten Übung nicht mehr ganz frisch. Die App rechnet
      je Satz, den dieselbe Muskelgruppe vorher gemacht hat, mit <b>${pct} % weniger Kraft</b> (je Satz für einen Hilfsmuskel halb so viel,
      insgesamt höchstens ${Math.round(PREFAT_MAX * 100)} %). Bei vorermüdeten Übungen steht der Abzug direkt unter der Vorgabe.</p>
    <p class="hint">${L.n ? `Dein persönlicher Wert, gelernt aus ${L.n} ${L.n === 1 ? 'Vergleich' : 'Vergleichen'} deiner Trainings (${sure}): dieselbe Übung an
      verschiedenen Stellen im Training. Gestartet wird mit 5 %.`
      : 'Startwert. Sobald eine Übung an verschiedenen Stellen im Training stand (z. B. an Tag A vorn, an Tag B weiter hinten), lernt die App deinen eigenen Wert.'}
      „Max. bei 10 Wdh.“ ist immer der Frisch-Wert – steht eine Übung weiter hinten, zieht die App die Vorermüdung selbst ab.</p>
    <button class="btn outline" data-action="prefat-help-toggle">Zuklappen</button>
  </div>`;
}

/* ---------- Optionen (v207, User-Wunsch 2026-11-11): Hauptseite + Unterseiten ---------- */
// Vorher eine ~5.900 px lange Seite. Jetzt: Modus kompakt, darunter je Bereich eine Zeile -> views.opt { sec }.
const SIZES = { '': 'Normal', l: 'Groß', xl: 'Sehr groß' };
const OPT_SECS = {
  look: { icon: '🎨', title: 'Aussehen', render: () => appearanceCard(),
    sub: () => { const p = data.profile || {}; return [PROFILE_COLORS[profileColor()].label, THEME_MODES[p.theme || ''], LOOKS[p.look || ''], `Schrift ${SIZES[p.size || '']}`].join(' · '); } },
  train: { icon: '🏋️', title: 'Training', render: () => motivCard() + restCard() + platesCard() + (typeof tourCard === 'function' ? tourCard() : '') + explainCard() + hintOffCard(),
    sub: () => `Motivation ${MOTIV_OPTS[motivMode()][1].toLowerCase()} · Pausen-Timer ${restCfg().off ? 'aus' : 'an'} · Langhantel ${barKg()} kg` },
  me: { icon: '👤', title: 'Profil & Ernährung', render: () => profileCard() + (typeof nutHintsCard === 'function' ? nutHintsCard() : '') + (typeof mcOptionsCard === 'function' ? mcOptionsCard() : ''),
    sub: () => [(data.profile || {}).name || 'Name, Geschlecht', 'Hinweise zur Ernährung', typeof mcAvailable === 'function' && mcAvailable() ? 'Zykluskalender' : ''].filter(Boolean).join(' · ') },
  data: { icon: '💾', title: 'Deine Daten', render: () => dataSecHtml(),
    sub: () => `${data.sessions.length} Trainings · ${data.lastExport ? `letzte Sicherung vor ${daysSinceISO(data.lastExport)} Tag${daysSinceISO(data.lastExport) === 1 ? '' : 'en'}` : 'noch nie gesichert'}`,
    warn: () => backupDue() && data.sessions.length >= 2 },
  info: { icon: 'ℹ️', title: 'Hilfe & Info', render: () => infoSecHtml(),
    sub: () => { const n = errLoad().length; return `Feedback · Was ist neu · Fehlerprotokoll${n ? ` (${n})` : ''} · Über die App`; } },
};
function renderData() {
  const rows = Object.entries(OPT_SECS).map(([k, s]) => `<button class="btn nav opt-row ${s.warn && s.warn() ? 'warn' : ''}" data-action="opt-open" data-sec="${k}">
      <span class="opt-ico" aria-hidden="true">${s.icon}</span><span class="opt-txt">${s.title}<small>${esc(s.sub())}</small></span></button>`).join('');
  return modeCard() + `<div class="opt-list">${rows}</div><p class="hint app-version" id="app-version"></p>`;
}
views.opt = { title: p => (OPT_SECS[p.sec] || { title: 'Optionen' }).title, tab: 'data', back: 'data',
  render: p => OPT_SECS[p.sec] ? OPT_SECS[p.sec].render() : '<p class="hint">Bereich nicht gefunden.</p>',
  after: () => { showAppVersion(); storageInfoFill(); persistFill(); } };
function infoSecHtml() {
  const mail = typeof LEGAL !== 'undefined' && LEGAL.email;
  return `${mail ? `<button class="btn nav fb-btn" data-action="about-feedback">💬 Feedback geben<small>Fehler, Ideen oder Fragen – per E-Mail an ${esc(LEGAL.email)}</small></button>` : ''}
    ${whatsNewOptionsCard()}${errCard()}
    <button class="btn nav about-btn" data-action="about">ℹ️ Über die App<small>Gesundheitshinweis, Datenschutz, Rechte${typeof legalReady === 'function' && legalReady() ? ', Impressum' : ''}</small></button>
    <p class="hint app-version" id="app-version"></p>`;
}
function dataSecHtml() {
  return `<div class="card">
      <h2>Deine Daten</h2>
      <p>${data.days.length} Trainingstage · ${data.sessions.length} gespeicherte Trainings</p>
      <p class="hint">Alles wird nur auf diesem Gerät gespeichert. Mach regelmäßig eine Sicherung, z. B. in der Dateien-App oder iCloud Drive.</p>
      ${storageInfoHtml()}
      <p class="lbl">Sicherungen mit Passwort schützen</p>
      <div class="seg two"><button class="${backupPwOn() ? '' : 'on'}" data-action="backup-pw-mode" data-v="0">Ohne Passwort</button>
        <button class="${backupPwOn() ? 'on' : ''}" data-action="backup-pw-mode" data-v="1">Mit Passwort</button></div>
      ${backupPwOn() ? `<input class="inp" type="password" data-field="backup-pw" autocomplete="new-password" placeholder="Passwort (mind. 4 Zeichen)" value="${esc(backupPw)}">` : ''}
      <p class="hint explain">Freiwillig. Mit Passwort wird die Sicherungsdatei verschlüsselt – wer sie in die Hände bekommt, kann sie ohne Passwort
        nicht lesen. Das Passwort wird nirgends gespeichert: Vergisst du es, lässt sich die Sicherung nicht mehr öffnen.
        ${backupPwOn() ? 'Leer gelassen fragt die App beim Exportieren nach dem Passwort.' : ''}</p>
    </div>
    ${installOptionsCard()}
    <button class="btn primary" data-action="export">Sicherung exportieren</button>
    <button class="btn center" data-action="import">Sicherung importieren</button>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
    <p class="hint explain">${data.lastExportName ? `Letzte Sicherung: <b>${esc(data.lastExportName)}</b>. ` : ''}Sicherungen heißen immer
      „Gainslocker-Sicherung …“ mit Datum und Uhrzeit – such beim Importieren in der Dateien-App einfach nach „Gainslocker“.
      Beim Importieren werden die aktuellen Daten durch die Sicherung ersetzt.</p>
    <h2>Daten löschen</h2>
    <button class="btn danger" data-action="reset-trainings">Trainings löschen, Plan behalten</button>
    <button class="btn danger" data-action="reset-all">Alles zurücksetzen</button>
    <p class="hint">„Trainings löschen“ entfernt alle gespeicherten Trainings, Körpergewicht, Körpermaße und Schritte – die Trainingstage mit ihren Übungen bleiben (${feat('tr-max') ? 'das „Max. kg bei 10 Wdh.“ wird geleert' : 'die gemerkten Gewichte werden geleert'}). „Alles zurücksetzen“ macht die App wieder wie neu. Vorher am besten eine Sicherung exportieren.</p>
`;
}

/* ---------- Was ist neu (v204, User-Wunsch 2026-11-11) ---------- */
// Je Version mit sichtbarer Änderung ein Eintrag OBEN ergänzen (v = CACHE-Nummer in sw.js), Alltagssprache, kurz.
// Einträge: [Text, feat?] – feat blendet aus, was im Modus nicht zu sehen ist ('!x' = nur, wenn x NICHT sichtbar).
// data.seenV = zuletzt gesehene Version; neu Angefangene sehen nichts, bisherige Nutzer beim ersten Mal alles ab v197.
const CHANGES = [
  { v: 229, date: '2026-11-13', items: [
    ['Training an die Diät angepasst – neue Regel: Das Volumen startet auf dem Stand von Woche 2, steigt in Woche 2 auf den Stand von Woche 3 und bleibt dann gleich. Im Tank bleiben in der Intro-Woche 2 Wiederholungen, danach jede Woche 0,5 weniger bis 0,5 (Grundübungen +0,5, Assistenzübungen −0,5).'],
  ] },
  { v: 228, date: '2026-11-13', items: [
    ['In einer Diät oder einem Minicut gibt es keine Stillstand-Hinweise mehr – im Kaloriendefizit ist Kraft halten normal und schon ein Erfolg. Auch danach zählen Trainings aus dieser Zeit nicht für den Vergleich.'],
  ] },
  { v: 222, date: '2026-11-13', items: [
    ['🤸 Übungsbibliothek: neuer Bereich Calisthenics – vom Toten Hang bis zu Muscle-up, Handstand, Front Lever und Planche, mit Figuren und ausführlicher Anleitung.'],
    ['🏁 Neuer Bereich Hyrox: alle Stationen in Wettkampf-Reihenfolge mit Strecken und Gewichten je Klasse, dazu passende Übungen.'],
    ['Gesäß-Kickbacks Kabelzug „überkreuzt“ ersetzt durch „seitlich“.'],
  ] },
  { v: 221, date: '2026-11-12', items: [
    ['💬 Feedback geben: unter Optionen → Hilfe & Info. Öffnet dein Mailprogramm mit vorausgefüllter Nachricht an lockyourgains@gmail.com – auf Wunsch mit Fehlerprotokoll, nie mit deinen Trainingsdaten.'],
  ] },
  { v: 220, date: '2026-11-12', items: [
    ['Neues App-Symbol: ein Handy mit Hantel und steigender Verlaufskurve – in der Farbe deiner Farbwelt. Das Handy übernimmt Symbol und Farbe, wenn du die App zum Home-Bildschirm hinzufügst (z. B. beim Umzug auf die neue Adresse); danach bleibt es so, auch wenn du die Farbe änderst.'],
  ] },
  { v: 219, date: '2026-11-12', items: [
    ['✏️ Übung umbenennen: Die App fragt jetzt, ob deine bisherigen Daten (Gewichte, Rekorde, Diagramme) auf den neuen Namen übertragen werden sollen – oder ob sie als neue Übung beginnt. Danach bestätigt sie „Übung X in Y umbenannt“.'],
    ['Hinweise und Rückfragen erscheinen jetzt in einem eigenen Fenster im Stil der App statt als System-Meldung.'],
    ['Stil „Schlicht“ neu: dünnere Schrift, schmale Überschriften in Großbuchstaben, feine Linien und eckige Nummern.'],
  ] },
  { v: 218, date: '2026-11-12', items: [
    ['🍎 Das Ernährungstagebuch steht jetzt ganz oben im Reiter Ernährung – mit 📅 Kalender und 📊 Woche & Monat (Kalorien, Eiweiß, Kohlenhydrate, Fett je Tag und im Schnitt).'],
    ['Beim Ersetzen einer Übung kannst du direkt eine eigene Übung anlegen – sie ersetzt danach gleich die alte.'],
    ['Neue Übungen: Latziehen mittelbreit, Gesäß-Kickbacks Kabelzug diagonal und überkreuzt.'],
    ['Erklärtexte sind ab dem dritten Besuch einer Seite eingeklappt – in allen Modi. Antippen von „? Erklärung“ zeigt sie wieder.'],
  ] },
  { v: 217, date: '2026-11-12', items: [
    ['Neuer Name: Die App heißt jetzt LockYourGains – auf dem Home-Bildschirm kurz „Gainslocker“.'],
    ['Neue Adresse: lockyourgains.github.io. Sicherungen heißen jetzt „Gainslocker-Sicherung …“; ältere „StepUp-Sicherungen“ lassen sich weiter laden.'],
  ] },
  { v: 216, date: '2026-11-12', items: [
    ['Kleine Gewichte bis 10 kg: Ist der nächste Gewichtsschritt sehr groß, fragt die App einmal, ob du an dem Gerät 1,25 kg feiner einstellen kannst.'],
    ['Nach einem verfehlten Satz bekommen die folgenden Sätze mit gleichem Gewicht höchstens 2 Wdh. mehr als der Satz davor.'],
  ] },
  { v: 215, date: '2026-11-12', items: [
    ['Tippfehler, die trotz Rückfrage gespeichert wurden (z. B. 100 statt 10 kg), zählen nicht mehr für Vorschläge und Bestleistungen. Im Verlauf steht dann „zählt nicht“ – korrigierst du den Satz, zählt er wieder.'],
    ['Deload-Woche: Ein deutlich verfehlter Satz der Vorwoche ist kein Maßstab mehr – so wird der Deload nie schwerer als das, was du geschafft hast.'],
    ['Große Schrift: Knöpfe und Tabellen passen jetzt überall auf den Bildschirm.'],
    ['Vitamine & Mineralstoffe: Die Richtwerte passen jetzt zu deinem Alter.', 'nut-micro'],
  ] },
  { v: 214, date: '2026-11-11', items: [
    ['🔬 Vitamine & Mineralstoffe im Ernährungstagebuch: 29 Nährstoffe mit den Richtwerten der DGE – als Durchschnitt über 7 Tage oder je Tag.', 'nut-micro'],
    ['💊 Nahrungsergänzung eintragen oder scannen – gespeichert wie ein Lebensmittel, gezählt in Stück.', 'nut-micro'],
    ['Eigene Lebensmittel können jetzt auch Vitamine und Mineralstoffe haben (freiwillig).', 'nut-micro'],
  ] },
  { v: 213, date: '2026-11-11', items: [
    ['📷 Fortschrittsfotos: vorne, seitlich und hinten – mit Vergleich zweier Termine. Zu finden im Reiter Ernährung beim Körpergewicht.'],
    ['🎥 Technik-Videos je Übung: in Zeitlupe, Bild für Bild und mit Hilfslinien ansehen oder zwei Videos vergleichen (im Training unter „Details“ → „Video“).'],
    ['Fotos und Videos bleiben nur auf deinem Handy. Eine Anleitung zeigt, wie du sie in deiner Galerie sicherst.'],
  ] },
  { v: 212, date: '2026-11-11', items: [
    ['⏱ Sätze je Muskelgruppe selbst eintragen: Darunter steht jetzt, wie lange deine Trainingstage damit etwa dauern.', 'plan-volume'],
    ['Die Einführung erklärt jetzt auch Zyklus-Rückblick, Cardio, Zykluskalender und den Beschwerde-Bericht.'],
    ['Plan-Vorschau im Assistenten: Die Übungsnamen haben wieder Platz, die Knöpfe stehen darunter.', 'tr-variants'],
  ] },
  { v: 211, date: '2026-11-11', items: [
    ['⚡ Intensitätstechniken: Reduktions- und Myo-Sätze – im Training je Satz (Satznummer antippen) oder dauerhaft je Übung im Tagesplan.', 'tr-variants'],
    ['Alle Teil-Sätze werden gespeichert und angezeigt; verglichen und gesteigert wird nur mit gleich ausgeführten Sätzen.', 'tr-variants'],
    ['Ausführliche Erklärungen, wann sich welche Technik lohnt – und warum ein Myo-Satz mehr ermüdet als ein normaler Satz.', 'tr-variants'],
    ['„mit Pause“ und „langsam“ gibt es jetzt schon im Modus Standard.', 'tr-variants'],
  ] },
  { v: 210, date: '2026-11-11', items: [
    ['🔗 Supersätze: Zwei Übungen im Wechsel mit kurzer Pause – im Tagesplan „Als Supersatz koppeln“ oder „Supersätze vorschlagen“.', 'supersets'],
    ['Die geschätzte Trainingsdauer rechnet Supersätze mit ein, und „Wenig Zeit?“ koppelt auf Wunsch erst Übungen, bevor Sätze wegfallen.', 'supersets'],
    ['Im Training stehen beide Übungen in einem Rahmen, der nächste Satz ist markiert. Gerät besetzt? „Heute einzeln“.', 'supersets'],
  ] },
  { v: 209, date: '2026-11-11', items: [
    ['Beschwerde-Tagebuch: Stärke von 0 bis 10, Seite und Notiz je Stelle – mit Verlaufslinie (Verlauf → Beschwerden).'],
    ['„🩹 Zwickt“ im Training: Bei jeder Übung festhalten, wo und wie stark es zwickt. So siehst du, welche Übungen sich melden.'],
    ['Bericht für deinen Termin: Verlauf, betroffene Übungen und Notizen als Bild oder Text – zum Zeigen in Arztpraxis oder Physiotherapie.'],
    ['Weniger Text: Längere Erklärungen klappen nach dem dritten Besuch einer Seite zu „? Erklärung“ zusammen.', 'tr-comment'],
  ] },
  { v: 208, date: '2026-11-11', items: [
    ['Motivation nach deinem Geschmack: freundlich mit Lob, fordernd mit klaren Ansagen – oder gar nicht (Optionen → Training).'],
    ['Beschwerden-Verlauf: Im Verlauf siehst du, seit wann es wo zwickt – und änderst es jederzeit, wenn es besser wird.'],
  ] },
  { v: 207, date: '2026-11-11', items: [
    ['Optionen aufgeräumt: Die Einstellungen sind jetzt nach Bereichen sortiert – Aussehen, Training, Profil, Deine Daten, Hilfe.'],
    ['Textgröße: Unter Optionen → Aussehen kannst du Schrift und Knöpfe größer stellen.'],
    ['Ernährung und Plan übersichtlicher: Das Körpergewicht steht direkt unter „Heute gegessen“, die Grundlagen als Zeile ganz unten.'],
  ] },
  { v: 206, date: '2026-11-11', items: [
    ['Ergebnis teilen: Nach dem Training malt die App ein Bild mit Dauer, bewegtem Gewicht und neuen Bestleistungen – zum Teilen in WhatsApp, Instagram & Co.'],
    ['Die Werte vom letzten Mal stehen im Training wieder immer sichtbar bei jeder Übung.'],
  ] },
  { v: 205, date: '2026-11-11', items: [
    ['Unter Optionen → Deine Daten siehst du jetzt, ob dein Browser die Daten dauerhaft speichert – und was du sonst tun kannst.'],
    ['Fehlerprotokoll: Hakt einmal etwas, merkt sich die App den Fehler (ohne Trainingsdaten). Unter Optionen kannst du ihn an den Entwickler schicken.'],
  ] },
  { v: 204, date: '2026-11-11', items: [
    ['Scheiben-Rechner: Bei Langhantel-Übungen steht im Training, welche Scheiben auf jede Seite gehören. Stange und deine Scheiben stellst du unter Optionen → Training ein.'],
    ['Nebenbei: Ganz unten bei Ernährung lassen sich auch Körpermaße wie die Taille festhalten.'],
  ] },
  { v: 203, date: '2026-11-11', items: [
    ['Diagramme, Statistik und Erfolge stehen jetzt im Verlauf. Eine Übung zeigt Diagramm und alle Sätze auf einer Seite – unten sind es nur noch fünf Reiter.'],
  ] },
  { v: 202, date: '2026-11-11', items: [
    ['Pausen-Timer: Nach jedem Satz läuft oben die Pause – auf Wunsch mit Vibration oder Ton (Optionen → Training).'],
  ] },
  { v: 201, date: '2026-11-11', items: [
    ['Startseite aufgeräumt: Der nächste Trainingstag steht ganz oben, die Zyklus-Karte klappt auf, wenn du sie antippst.'],
  ] },
  { v: 200, date: '2026-11-10', items: [
    ['Training kompakter: Oben siehst du, bei welcher Übung du bist. Mehr zu jeder Übung steht unter „Details“, erledigte Sätze werden grün.'],
  ] },
  { v: 199, date: '2026-11-10', items: [
    ['Tank-Vorgaben je Satz als ganze Zahlen, von Satz zu Satz absteigend (z. B. 2 · 2 · 1). Alle Pläne gehen dabei etwas näher ans Muskelversagen.', 'tr-rir-input'],
    ['Die Sätze gehen jetzt etwas näher an „ging nichts mehr“ – die letzten Sätze einer Übung dürfen richtig hart sein.', '!tr-rir-input'],
  ] },
  { v: 198, date: '2026-11-10', items: [
    ['Neuer Hinweis „Zum Home-Bildschirm“: Als App auf dem Home-Bildschirm bleiben deine Daten auf dem iPhone sicher gespeichert.'],
  ] },
  { v: 197, date: '2026-11-10', items: [
    ['Sicherungen lassen sich freiwillig mit einem Passwort verschlüsseln (Optionen → Deine Daten).'],
  ] },
];
const APP_V = CHANGES[0].v;
const WN_BASE = 196;  // letzte Version ohne „Was ist neu“
const wnShow = f => !f || (f[0] === '!' ? !feat(f.slice(1)) : feat(f));
const whatsNewItems = from => CHANGES.filter(c => c.v > from).flatMap(c => c.items.filter(([, f]) => wnShow(f)).map(([t]) => t));
function whatsNewInit() {
  if (data.seenV != null) return;
  data.seenV = hasOwnData() ? WN_BASE : APP_V;
  saveData();
}
// Startseite: einmal nach einem Update (Teil der Hinweis-Karten, eine gleichzeitig)
function whatsNewCard() {
  if (data.seenV == null || data.seenV >= APP_V) return '';
  const items = whatsNewItems(data.seenV);
  if (!items.length) return '';
  const show = items.slice(0, 5);
  return `<div class="card hints whats-new"><p><b>✨ Neu in der App</b></p>
      <ul class="wn-list">${show.map(t => `<li>${t}</li>`).join('')}</ul>
      ${items.length > show.length ? `<p class="hint">… und ${items.length - show.length} weitere – alle unter Optionen → Hilfe & Info.</p>` : ''}
      <button class="btn primary" data-action="wn-ok">Alles klar</button></div>`;
}
// Optionen: alle Neuerungen zum Nachlesen
function whatsNewOptionsCard() {
  return `<details class="card about-sec wn-opt"><summary><b>✨ Was ist neu</b></summary>
      ${CHANGES.map(c => {
        const items = c.items.filter(([, f]) => wnShow(f));
        return items.length ? `<p class="lbl wn-v">Version ${c.v} · ${fmtDate(c.date + 'T12:00:00')}</p><ul class="wn-list">${items.map(([t]) => `<li>${t}</li>`).join('')}</ul>` : '';
      }).join('')}</details>`;
}

// Fehlerprotokoll in den Optionen (v205): die letzten 10 Einträge, Teilen/Kopieren als Text, Löschen
const fmtErrTime = iso => { const d = new Date(iso); return `${fmtDate(iso)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
function deviceText() {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) ? `${/iPad/.test(ua) ? 'iPad' : 'iPhone'} iOS ${((ua.match(/OS (\d+)[_.](\d+)/) || []).slice(1).join('.')) || '?'}`
    : /Android (\d+)/.test(ua) ? `Android ${ua.match(/Android (\d+)/)[1]}` : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : 'anderes Gerät';
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${os} · ${br}${isStandalone() ? ' · Home-Bildschirm' : ''}`;
}
function errReport() {
  const list = errLoad();
  return [`${APP_SHORT} Fehlerprotokoll · App-Version ${APP_V} · ${deviceText()} · Modus ${appMode()}`,
    ...list.map((x, i) => `${i + 1}) ${fmtErrTime(x.t)} · ${x.view || '–'} · v${x.v || '?'} · ${x.msg}${x.n > 1 ? ` (${x.n}×)` : ''}${x.at ? `\n   ${x.at}` : ''}`)].join('\n');
}
function errCard() {
  const list = errLoad();
  return `<details class="card about-sec err-card"><summary><b>🧰 Fehlerprotokoll</b>
      <small>${list.length ? `${list.length} ${list.length === 1 ? 'Eintrag' : 'Einträge'}` : 'keine Fehler ✓'}</small></summary>
    ${list.length ? `<ul class="err-list">${[...list].reverse().slice(0, 10).map(x => `<li><small>${fmtErrTime(x.t)} · ${esc(x.view || '–')}${x.n > 1 ? ` · ${x.n}×` : ''}</small>${esc(x.msg)}</li>`).join('')}</ul>
      <p class="hint">Hakt etwas? Schick das Protokoll an den Entwickler. Es enthält keine Trainingsdaten – nur Fehlertext, Ansicht, App-Version und Gerätetyp.</p>
      <div class="row"><button class="btn primary" data-action="err-share">Weitergeben</button>
        <button class="btn" data-action="err-clear">Löschen</button></div>`
    : '<p class="hint">Bisher ist kein Fehler aufgetreten. Falls doch einmal etwas hakt, steht es hier – zum Weitergeben an den Entwickler.</p>'}
  </details>`;
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
  if (draft && !askOk(`Es läuft bereits ein Training (${draft.dayName}). Verwerfen und neu beginnen?`)) return;
  if (ownPlan()) { startDay(id); return; }  // eigener Plan: keine Fragen vorab, es wird nichts angepasst
  const pause = pauseInfo();
  if (pause && !activePlan().askEntry) { go('pausecheck', { id, days: pause.days }); return; }
  const feel = feelInfo(id);
  if (feel) { go('cyclefeel', { id, ...feel }); return; }
  // neuer Plan aus dem Assistenten: erst fragen, mit welcher Zykluswoche er beginnt
  if (activePlan().askEntry) {
    if (!feat('entry-week')) { delete activePlan().askEntry; saveData(); }  // Einfach: immer mit der Intro-Woche
    else { go('entryweek', { id, w: 1 }); return; }
  }
  if (!askSkipRound(day)) return;
  beginAfterRound(id);
}

// Einmal je Zyklus fragen: beim ersten Deload-Training (nach mindestens einem Aufbau-Training in diesem Zyklus). Wurde der
// Zyklus ohne Deload beendet, beim ersten Training des neuen Zyklus nach dem alten fragen (late, gilt dann sofort).
// Nicht nach einem Neustart wegen einer Pause (plan.feelSkip).
function feelInfo(id) {
  const p = activePlan();
  if (!p || ownPlan() || p.askEntry) return null;
  const done = cs => (p.feelLog || []).some(e => e.cs === cs) || (p.feelSkip || []).includes(cs);
  const mine = s => !!findDay(s.dayId);
  const ci = trainingRound(id);
  if (ci.deload) {
    if (done(ci.cycleStart) || data.sessions.some(s => s.cycleStart === ci.cycleStart && s.deload)) return null;
    return data.sessions.some(s => mine(s) && s.cycleStart === ci.cycleStart && !s.deload) ? { cs: ci.cycleStart } : null;
  }
  if (data.sessions.some(s => s.cycleStart === ci.cycleStart)) return null;  // Zyklus läuft schon
  const prev = sessionsNewestFirst().find(s => mine(s) && s.cycleStart && s.cycleStart !== ci.cycleStart);
  return prev && !done(prev.cycleStart) && !prev.deload ? { cs: prev.cycleStart, late: true } : null;
}
function renderCycleFeel({ id, late }) {
  const adj = rirFeelAdj(), rir = feat('tr-rir-input');
  const opt = (m, title, text) => `<button class="split-opt freq-opt" data-action="cycle-feel" data-m="${m}"><b>${title}</b><small>${text}</small></button>`;
  const atMax = adj >= FEEL_MAX, atMin = adj <= -FEEL_MAX;
  return `<div class="card wiz-q">
      <p class="sub">${esc(findDay(id).name)}</p>
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🏁</span><h2>${late ? 'Zyklus geschafft!' : 'Gleich kommt die Deload-Woche.'} Wie hat sich das Training in diesem Zyklus angefühlt?</h2></div>
      <p class="hint wiz-q-explain">${late ? 'Danach richtet die App den neuen Zyklus aus.'
        : 'Jetzt spürst du die Belastung noch am deutlichsten. Deine Antwort gilt ab der nächsten Intro-Woche – die Deload-Woche bleibt, wie sie ist.'}${rir && adj ? ` Bisher angepasst: ${adj > 0 ? '+' : '−'}${fmtNum(Math.abs(adj))} Wdh. im Tank.` : ''}</p>
      ${opt('hard', 'Zu schwer', atMax ? 'Mehr Luft gibt die App nicht dazu, sie ist schon an ihrer Grenze. Es bleibt wie im letzten Zyklus.'
        : rir ? 'Im neuen Zyklus bleibt in jedem Satz 0,5 Wdh. mehr im Tank.' : 'Der neue Zyklus wird etwas leichter.')}
      ${opt('easy', 'Zu leicht', atMin ? 'Näher ans Muskelversagen geht die App nicht, sie ist schon an ihrer Grenze. Es bleibt wie im letzten Zyklus.'
        : rir ? 'Im neuen Zyklus bleibt in jedem Satz 0,5 Wdh. weniger im Tank (nie unter 0).' : 'Der neue Zyklus wird etwas fordernder.')}
      ${opt('ok', 'Passt so', 'Alles bleibt wie im letzten Zyklus.')}
    </div>`;
}

// Wiedereinstieg (User-Regel 2026-11-06): ab 7 Tagen ohne Training einmal fragen; bei nur 1 Training pro Woche ab 14 Tagen
function pauseInfo() {
  const lastOwn = sessionsNewestFirst().find(s => findDay(s.dayId));
  if (!lastOwn || data.pauseAsked === lastOwn.id || cycleInfo().deload) return null;
  const days = Math.floor((Date.parse(todayISO() + 'T12:00:00') - Date.parse(lastOwn.date.slice(0, 10) + 'T12:00:00')) / DAY);
  const perWeek = activeDays().reduce((a, d) => a + dayTimes(d, cycleInfo().week), 0);
  return days >= (perWeek <= 1 ? 14 : 7) ? { days, id: lastOwn.id } : null;
}
function renderPauseCheck({ id, days }) {
  const opt = (m, title, text) => `<button class="split-opt freq-opt" data-action="pause-choice" data-m="${m}"><b>${title}</b><small>${text}</small></button>`;
  const long = days >= 14;
  return `<div class="card wiz-q">
      <p class="sub">${esc(findDay(id).name)}</p>
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">👋</span><h2>Schön, dass du wieder da bist!</h2></div>
      <p class="hint wiz-q-explain">Dein letztes Training ist <b>${days} Tage</b> her. Wie möchtest du weitermachen?</p>
      ${opt('dl', `Mit leichter Woche einsteigen${long ? ' (empfohlen)' : ''}`, 'Es geht mit einer leichten Deload-Woche los, danach beginnt der Zyklus mit der Intro-Woche.')}
      ${feat('tr-rir-input') ? opt('new', 'Neuer Zyklus mit der Intro-Woche', 'Für kürzere Pausen oder wenn du dich fit fühlst: Der Zyklus beginnt neu, ohne leichte Woche davor.') : ''}
      ${opt('go', `Einfach weitermachen${long ? '' : ' (empfohlen)'}`, 'Alles bleibt wie geplant, du machst dort weiter, wo du aufgehört hast.')}
    </div>`;
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
  if (!askOk(`„${day.name}“ war in dieser Woche (${ciLabel(ci)}) schon dran. Noch offen: ${open.map(x => x.day.name).join(', ')}.\n\n` +
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
  // Zyklus und Training (menstrual.js, v191): in einem Zeitfenster mit Beschwerden erst nachfragen, sonst nur markieren (zum Lernen)
  if (!ci.deload && !own && readiness.mc === undefined && typeof mcCheckNeeded === 'function') {
    const win = mcCheckNeeded();
    if (win) { go('mccheck', { id, readiness, win }); return; }
    readiness = { ...readiness, mc: mcAutoTag() };
  }
  const mc = !ci.deload && !own && readiness.mc ? readiness.mc : null;
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
    penalty: ci.deload || own ? 0 : (readiness.sleptWell ? 0 : 1) + (readiness.stress ? 1 : 0) + (mc ? mc.pen : 0),
    ...(mc ? { mc } : {}),
    // Progression für dieses Training: Einstellung der Woche, im Training noch änderbar (Deload: ohnehin keine)
    progression: own ? { volume: false, load: false }
      : ci.deload ? { volume: true, load: true } : weekProgression(roundKey(ci.cycleStart, ci.week)),
    occurrence: nextOccurrence(day.id, ci),  // 2 = dieser Tag wurde diese Woche schon einmal trainiert
    entries: [],
  };
  // erst nach dem Anlegen von draft, weil setupEntry die Zykluswoche aus draft liest
  draft.entries = draftEntries(day);
  // Zyklus „stark eingeschränkt“: 1 Satz weniger bei Übungen mit mindestens 3 Sätzen (User-Regel 2026-11-09)
  if (mc && mc.cut) {
    for (const en of draft.entries) {
      if (en.sets.length < 3) continue;
      const n = en.sets.length - 1;
      en.sets.length = n;
      en.planned.length = Math.min(en.planned.length, n);
      en.target = { ...en.target, sets: n };
    }
    // Vorermüdung bewusst NICHT neu berechnen: weniger Sätze davor hieße sonst teils schwereres Gewicht – an einem schwachen
    // Tag das falsche Signal; so bleiben die Gewichte, nur Wdh. und Sätze sinken (leicht vorsichtig)
  }
  // Zeitlimit („⏱ Wenig Zeit?“ auf der Startseite): Training kürzen; „nur nächstes Training“ ist damit verbraucht
  const tl = data.timeLimit;
  if (tl && tl.min) {
    draft.timeLimit = tl.min;
    if (tl.ss) ssForTime(tl.min);  // Supersätze (v210): erst Pausen sparen, dann Sätze kürzen
    draft.timeCut = trimToTime(draft.entries, tl.min);
    refreshPrefat();
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
  // Ernährungsphase Diät/Minicut mit angepasstem Training (v229): Volumen wie sonst eine Woche später, ab Woche 2 ohne Anstieg; Tank 2 → 0,5
  // (nicht im Deload und nicht bei eigenen Plänen)
  const adapt = !draft.deload && !draft.own && nutTrainAdapt();
  draft.nutAdapt = adapt;
  const auto = autoSetsForDay(day, setsWeek, draft.deload, data.volume, adapt);
  const exs = day.exercises.filter(e => e.name.trim());
  const nList = exs.map(x => {
    const n = auto.has(x.id) ? auto.get(x.id) : setsForWeek(x, draft.deload ? bw : setsWeek, bw, adapt);
    return { name: x.name.trim(), n: n + (draft.deload ? 0 : techPlanFat(x, n)) };  // Myo/Reduktion ermüden mehr (v211)
  });
  return exs.map((ex, xi) => {
    const en = { name: ex.name.trim(), ...(ex.ss ? { ss: ex.ss, ssRest: ex.ssRest } : {}) };  // Supersatz (v210)
    // Ziel im Tank aus Zykluswoche und Übungsart (Deload: Wert der letzten Trainingswoche, dann mind. 3)
    const week = draft.deload ? bw : draft.week;
    const [lo, hi] = adapt ? dietRirRange(kindOf(ex), week) : rirRange(kindOf(ex), week, bw, groupOf(ex));  // Diät: eigene Tank-Regel (v229)
    const rir = (lo + hi) / 2;
    const rirText = lo === hi ? fmtNum(lo) : `${fmtNum(lo)}–${fmtNum(hi)}`;
    // Sätze: automatisch aus dem Muskelgruppen-Volumen, sonst laut Wochenplan der Übung
    // (Deload: Sätze der letzten Woche, werden dort halbiert)
    const fixedSets = auto.has(ex.id);
    const sets = fixedSets ? auto.get(ex.id) : setsForWeek(ex, draft.deload ? bw : setsWeek, bw, adapt);
    const target = { sets, fixedSets, reps: repsFor(day, ex), rir, rirText, max10: ex.max10, step: stepFor(ex), weights: weightsFor(ex.name),
      fat: draft.own ? 0 : preFatigue(nList, xi) };
    if (!draft.deload && !prog.load) target.hold = true;  // Gewicht/Wdh. vom letzten Mal halten
    if (adapt) target.noLoadUp = true;  // Diät/Minicut angepasst: Gewicht nicht steigern, höchstens 1 Wdh. mehr
    if (draft.own) Object.assign(target, { own: true, startWeight: ex.startWeight != null ? ex.startWeight : null });
    setupEntry(en, target, (i, n) => techVariant(ex, i, n));  // Ausführung bzw. Intensitätstechnik laut Plan (v211)
    if (typeof caliApply === 'function') caliApply(en, ex);  // Calisthenics (v225): Wdh./Haltezeit je Satz
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
  if (draft.deload) target = deloadTarget(target, body ? null : lastWorkSet(en.name, draft.dayId, target));
  else if (draft.intro) target = { ...target, intro: true };
  // ohne Gewichtsprogression (hold) keine Bezugswochen – es gelten die Werte vom letzten Mal
  const cmp = draft.deload || target.hold ? null : condRef(strip(comparisonEntry(en.name, draft.dayId, draft)), { step: 2.5, ...target });
  const prev = draft.deload || draft.intro || target.hold ? null : condRef(strip(previousWeekEntry(en.name, draft.dayId, draft)), { step: 2.5, ...target });
  // Satzzahl laut Wochenplan der Übung (Deload: halbiert); rirSplit = Tank je Satz in ganzen Zahlen (rirAt, v199)
  const n = target.sets;
  en.target = { ...target, sets: n, rirSplit: true };
  en.compare = cmp;
  en.prevWeek = prev;
  // 2. Training dieses Tages in der Woche: nie mehr als im 1. Training dieser Woche geschafft
  en.weekFirst = draft.occurrence > 1 && !draft.deload ? condRef(strip(weekFirstEntry(en.name, draft.dayId, draft)), { step: 2.5, ...target }) : null;
  en.rule = null;
  en.base = buildSets(en.name, en.target);  // Vorschlag ohne Bezugswoche
  en.sets = [];
  en.planned = [];  // ursprünglicher Vorschlag, damit die Bremse nächste Woche vergleichen kann
  for (let i = 0; i < n; i++) applyProposal(en, i, variantFor(i, n) || '');
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
// v215: ein deutlich verfehlter Satz (Bremse) ist kein Maßstab – sonst wäre der Deload schwerer als zuletzt geschafft;
// verfehlt jeder Satz das Ziel, gilt der leichteste
function lastWorkSet(name, dayId, t = null) {
  const e = findWeekEntry(name, dayId, () => true);
  const sets = e ? ofVariant(e.sets, '') : [];
  const idx = sets.map((x, i) => i).filter(i => sets[i].weight != null && sets[i].reps != null);
  const ok = idx.filter(i => !missed(e, '', i));
  const i = ok.length ? ok[0] : idx.length ? idx.reduce((a, b) => (sets[b].weight < sets[a].weight ? b : a)) : -1;
  let s = i >= 0 ? sets[i] : null;
  // alle verfehlt: erst das Gewicht, mit dem das geplante Ziel geklappt hätte (wie die Bremse), dann gilt der Deload-Abschlag
  if (s && !ok.length && t) {
    const pl = ofVariant(e.planned, '')[i];
    const goal = pl && pl.reps != null ? pl.reps : s.reps;
    const cap = s.reps + (s.rir != null ? s.rir : t.rir || 0);
    const fit = weightForGoal(cap, s.weight, { step: 2.5, ...t }, 0, goal);
    if (fit && fit.weight != null && fit.weight < s.weight) s = { ...s, weight: fit.weight, reps: fit.reps };
  }
  return s && t ? condSet(s, e.fat || 0, t.fat || 0, { step: 2.5, ...t }) : s;
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

// Hinweis bei Eigengewicht: unter minReps() Wdh. geschafft -> leichtere Variante; über BW_MAX_REPS -> schwerere
const BEGINNER_UP_REPS = 15;  // Neulinge/Einsteiger: ab hier in allen Sätzen geht das Gewicht hoch
const REP_SOFT_MAX = 20;  // weiche Obergrenze: höhere Vorschläge bleiben möglich, dazu ein Hinweis (User-Regel 2026-11-06)
const BW_MAX_REPS = REP_SOFT_MAX;
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
  if (highHintHidden(en.name)) return '';
  const t = en.target, top = t.weights[t.weights.length - 1];
  const last = lastEntry(en.name);
  const hit = en.sets.some(x => isDone(x) && parseNum(x.weight) >= top && parseNum(x.reps) >= MAXED_REPS)
    || (!en.sets.some(isDone) && last && !last.deload && last.sets.some(x => x.weight >= top && x.reps >= MAXED_REPS));
  if (!hit) return '';
  const n = norm(en.name), h = HOME_HARDER.find(([re]) => re.test(n));
  return `💡 ${MAXED_REPS} Wdh. mit deinem schwersten Gewicht (${fmtNum(top)} kg): Zeit für eine schwerere Variante – ${h ? h[1]
    : 'einarmig bzw. einbeinig ausführen oder langsamer (3 Sekunden absenken)'}. Oder trag schwerere Gewichte unter „Plan → 🏠 Deine Ausrüstung“ ein.
    Tauschen kannst du die Übung oben über „⇄ Ersetzen“.${hintBtns(en, 'high')}`;
}
// Band: ab BAND_MAX_REPS Wdh. das nächststärkere Band vorschlagen (Knopf wechselt es)
function bandHint(en) {
  if (highHintHidden(en.name)) return '';
  const t = en.target, ei = draft.entries.indexOf(en);
  const last = lastEntry(en.name);
  const lastSame = last && !last.deload && (last.target || {}).band === t.band;
  const hit = en.sets.some(x => isDone(x) && parseNum(x.reps) >= BAND_MAX_REPS)
    || (!en.sets.some(isDone) && lastSame && last.sets.some(x => x.reps >= BAND_MAX_REPS));
  if (!hit || en.bandNext) return '';
  const next = bandLevels().find(b => b > t.band);
  return next ? `💡 ${BAND_MAX_REPS} Wdh. geschafft – Zeit fürs nächststärkere Band. Die App rechnet dann mit etwa ${BAND_STEP_REPS} Wdh. weniger.
      <button class="vchip" data-action="tr-band" data-ei="${ei}" data-v="${next}">Band „${BAND_LEVELS[next]}“ nehmen</button>${hintBtns(en, 'high')}`
    : `💡 ${BAND_MAX_REPS} Wdh. mit deinem stärksten Band: Nimm zwei Bänder zusammen, greif das Band kürzer oder führe die Bewegung langsamer aus (3 Sekunden absenken).${hintBtns(en, 'high')}`;
}
// Bandstufe im Training wählen: ohne erledigten Satz gilt sie sofort, sonst ab dem nächsten Training
function bandRow(en, ei) {
  const cur = en.bandNext || en.target.band;
  return `<div class="variants plan band-row"><span>Band</span>${bandLevels().map(b =>
    `<button class="vchip ${cur === b ? 'on' : ''}" data-action="tr-band" data-ei="${ei}" data-v="${b}">${BAND_LEVELS[b]}</button>`).join('')}</div>
    ${en.bandNext ? `<p class="hint">Ab dem nächsten Training: Band „${BAND_LEVELS[en.bandNext]}“ (heute „${BAND_LEVELS[en.target.band]}“).</p>` : ''}`;
}

// Ausblenden der Hinweise: all/ex = zu viele Wdh. (dauerhaft, alle bzw. je Übung), low = zu schwer (Zyklus, bis zu dem es gilt)
const hintOff = () => data.hintOff || (data.hintOff = { all: false, ex: {}, low: {} });
const highHintHidden = name => !!(hintOff().all || hintOff().ex[nameKey(name)]);
const lowHintHidden = name => !!draft && hintOff().low[nameKey(name)] === draft.cycleStart;

// Knöpfe am Hinweis: Übung tauschen (auch im Plan) und ausblenden
function hintBtns(en, kind, swap = null) {
  const ei = draft.entries.indexOf(en);
  const off = (k, label) => `<button class="vchip hint-off" data-action="hint-off" data-ei="${ei}" data-k="${k}">${label}</button>`;
  return `<span class="hint-btns">${swap ? `<button class="vchip" data-action="hint-swap" data-ei="${ei}" data-name="${esc(swap)}">⇄ Jetzt tauschen: ${esc(swap)}</button>` : ''}
    ${kind === 'high' ? off('ex', 'Für diese Übung ausblenden') + off('all', 'Für alle Übungen ausblenden') : off('low', 'Bis zum nächsten Zyklus ausblenden')}</span>`;
}

// Tausch-Vorschläge je Übung: leichter, schwerer. Zu Hause zählt nur, was mit der Ausrüstung geht; Reihenfolge = Vorrang
const BW_SWAPS = [
  [/^klimmzuge/, ['Klimmzüge assistiert (Maschine)', 'Latziehen breit', 'Klimmzüge mit Band (unterstützt)', 'Latziehen Band (Türanker)', 'Rudern umgekehrt (Tisch oder Stange)'], []],
  [/^dips/, ['Dips assistiert (Maschine)', 'Trizepsdrücken Kabelzug (Seil)', 'Bankdips', 'Trizepsdrücken Band (Türanker)', 'Trizepsdrücken über Kopf Band'], []],
  [/^bankdips/, ['Trizepsdrücken Kabelzug (Seil)', 'Trizepsdrücken über Kopf Kurzhantel', 'Trizepsdrücken Band (Türanker)', 'Trizepsdrücken über Kopf Band'], ['Dips (Trizeps)', 'Diamant-Liegestütze']],
  [/^liegestutze erhoht/, ['Liegestütze auf Knien'], ['Liegestütze']],
  [/^liegestutze auf knien/, [], ['Liegestütze erhöht', 'Liegestütze']],
  [/^liegestutze fusse/, ['Liegestütze'], ['Diamant-Liegestütze']],
  [/^liegestutze/, ['Liegestütze erhöht', 'Liegestütze auf Knien'], ['Liegestütze Füße erhöht', 'Diamant-Liegestütze']],
  [/^rudern umgekehrt untergriff/, ['Bizepscurls Band', 'Bizepscurls Kurzhantel'], ['Klimmzüge Untergriff (Chin-ups)']],
  [/^rudern umgekehrt/, ['Rudern Band sitzend', 'Rudern Kurzhantel einarmig'], ['Klimmzüge']],
  [/^kniebeugen eigengewicht/, [], ['Goblet Squats', 'Bulgarian Split Squats ohne Gewicht', 'Einbeinige Kniebeugen zum Stuhl']],
  [/^bulgarian split squats ohne/, ['Kniebeugen Eigengewicht'], ['Bulgarian Split Squats', 'Einbeinige Kniebeugen zum Stuhl', 'Einbeinige Kniebeugen (Pistol Squats)']],
  [/^ausfallschritte eigengewicht/, ['Kniebeugen Eigengewicht'], ['Ausfallschritte Kurzhantel', 'Bulgarian Split Squats ohne Gewicht']],
  [/^einbeinige kniebeugen zum/, ['Kniebeugen Eigengewicht'], ['Einbeinige Kniebeugen (Pistol Squats)']],
  [/^einbeinige kniebeugen/, ['Einbeinige Kniebeugen zum Stuhl'], []],
  [/^nordic/, ['Beinbeuger sitzend', 'Beincurls am Boden (Handtuch)'], []],
  [/^beincurls am boden/, ['Beinbeuger Band (Bauchlage)', 'Glute Bridge'], ['Kreuzheben rumänisch einbeinig (Kurzhantel)', 'Nordic Hamstring Curls']],
  [/^crunches/, [], ['Crunches Kabelzug (kniend)', 'Crunches Maschine', 'Beinheben liegend', 'Dead Bug']],
  [/^beinheben hangend/, ['Crunches Maschine', 'Beinheben liegend', 'Crunches'], []],
  [/^beinheben/, ['Crunches'], ['Beinheben hängend']],
  [/^wadenheben an der treppe/, [], ['Wadenheben einbeinig']],
  [/^glute bridge einbeinig/, ['Glute Bridge'], ['Hip Thrust Kurzhantel']],
  [/^glute bridge/, [], ['Hip Thrust Langhantel', 'Hip Thrust Kurzhantel', 'Glute Bridge einbeinig']],
  [/^clamshells/, [], ['Monster Walk (Band)', 'Seitliches Beinheben liegend']],
];
function swapFor(name, kind) {
  const n = norm(name), hit = BW_SWAPS.find(([re]) => re.test(n));
  if (!hit) return null;
  const plan = activePlan() || {};
  const inDay = new Set(draft.entries.map(e => nameKey(e.name)));
  return hit[kind === 'easy' ? 1 : 2].find(x => !inDay.has(nameKey(x)) && (plan.equip !== 'home' || homeOk(x, data.home))
    && (plan.equip !== 'machine' || isMachine(x))) || null;
}

// Zu Hause: selbst das leichteste Gewicht ist zu schwer (zweimal unter der Mindestgrenze) -> tauschen oder leichteres Gewicht
function weightLowHint(en) {
  const t = en.target, low = t.weights[0];
  if (lowHintHidden(en.name)) return '';
  const k = nameKey(en.name), under = sets => sets.some(x => x.weight != null && x.weight <= low && x.reps != null && x.reps < minReps());
  const past = [];
  for (const s of sessionsNewestFirst()) {
    if (past.length >= 2) break;
    const e = !s.deload && s.entries.find(x => nameKey(x.name) === k);
    if (e) past.push(under(e.sets));
  }
  const now = en.sets.filter(isDone).map(x => ({ weight: parseNum(x.weight), reps: parseNum(x.reps) }));
  const hit = now.length ? under(now) && past[0] : past[0] && past[1];
  if (!hit) return '';
  const g = groupOf(planExercise(en.name) || { name: en.name });
  const inDay = new Set(draft.entries.map(e => nameKey(e.name)));
  const swap = typeof HOME_PICKS !== 'undefined' ? (HOME_PICKS[g] || []).find(x => !inDay.has(nameKey(x)) && homeOk(x, data.home) && !homeWeights(x, data.home)) : null;
  const kg = t.max10 != null ? Math.max(1, Math.round(t.max10)) : null;
  return `💡 Mit deinem leichtesten Gewicht (${fmtNum(low)} kg) schaffst du keine ${minReps()} Wdh. – das ist für diese Übung noch zu schwer.
    ${swap ? '' : `Dir fehlt ein leichteres Gewicht${kg != null && kg < low ? ` von etwa ${fmtNum(kg)} kg` : ''} – du kannst es unter „Plan → 🏠 Deine Ausrüstung“ eintragen.`}${hintBtns(en, 'low', swap)}`;
}

// Mit Gewicht über REP_SOFT_MAX Wdh.: die nächste Stufe reicht noch nicht – was stattdessen geht (weiche Grenze, ausblendbar)
function highRepHint(en) {
  if (highHintHidden(en.name) || !en.sets.some(x => parseNum(x.reps) > REP_SOFT_MAX)) return '';
  const t = en.target;
  return `💡 Mehr als ${REP_SOFT_MAX} Wdh.: Ab hier trainierst du vor allem Ausdauer, die nächste Gewichtsstufe ist aber noch zu schwer.
    ${feat('tr-step') && !t.weights ? 'Wähle oben eine kleinere Steigerung (z. B. 1,25 kg), führe' : 'Führe'} die Übung langsamer aus (3 Sekunden absenken) oder tausche sie über „⇄ Ersetzen“ gegen eine schwerere Variante.${hintBtns(en, 'high')}`;
}

/* v216 (User 2026-11-12): kleine Gewichte bis STEP_ASK_KG mit großem Sprung (Stufe > 25 % des Gewichts) – einmal je Übung
   fragen, ob das Gerät 1,25 kg feiner kann. Ja = Steigerung 1,25 kg dauerhaft; Nein = bleibt (die App steigert dann eher
   über Wdh.). Nicht bei Kurzhanteln (feste Größen), Heim-Gewichten, eigener Steigerung oder wenn schon gefragt. */
const STEP_FINE = 1.25, STEP_ASK_KG = 10, STEP_ASK_JUMP = 0.25;
function stepAskHint(en) {
  const t = en.target, ex = planExercise(en.name);
  if (!ex || ex.step != null || ex.stepAsked || t.weights || DUMBBELL.test(norm(en.name))) return '';
  const w = parseNum((en.sets[0] || {}).weight), st = t.step || 2.5;
  if (!(w > 0) || w > STEP_ASK_KG || st <= STEP_FINE || st / w <= STEP_ASK_JUMP) return '';
  const ei = draft.entries.indexOf(en);
  return `⚖️ Kleine Gewichte: Von ${fmtNum(w)} auf ${fmtNum(w + st)} kg wären ${Math.round(st / w * 100)} % mehr – ein großer Sprung.
    Kannst du an diesem Gerät auch 1,25 kg feiner einstellen, z. B. mit einer kleinen Zusatzscheibe?
    <span class="hint-btns"><button class="vchip" data-action="step-ask" data-ei="${ei}" data-v="1">Ja, in 1,25-kg-Schritten</button>
      <button class="vchip" data-action="step-ask" data-ei="${ei}" data-v="0">Nein, geht nicht</button></span>`;
}

function bwHint(en) {
  const t = en.target;
  if (!t || t.own || t.deload) return '';
  if (!t.bodyweight) {
    if (!t.weights) return stepAskHint(en) || highRepHint(en);
    return weightLowHint(en) || maxedHint(en) || highRepHint(en);
  }
  if (t.band) return bandHint(en);
  const done = en.sets.filter(isDone).map(x => parseNum(x.reps));
  const last = lastEntry(en.name);
  const lastReps = last && !last.deload ? last.sets.map(x => x.reps).filter(r => r != null) : [];
  const home = (activePlan() || {}).equip === 'home';
  const v = bwVariants(en.name);
  const swapTxt = ' Tauschen kannst du die Übung auch oben über „⇄ Ersetzen“.';
  if (!lowHintHidden(en.name) && (done.some(r => r < minReps()) || (!done.length && lastReps.some(r => r < minReps())))) {
    const swap = swapFor(en.name, 'easy');
    const easy = home ? (swap ? `„${swap}“` : 'eine kleinere Bewegung oder nur langsam ablassen') : v.easy;
    return `💡 Weniger als ${minReps()} Wdh. sind für einen sinnvollen Satz zu wenig. Nimm besser eine leichtere Variante: ${easy}.${swapTxt}${hintBtns(en, 'low', swap)}`;
  }
  if (!highHintHidden(en.name) && en.sets.some(x => parseNum(x.reps) > BW_MAX_REPS)) {
    const swap = swapFor(en.name, 'hard');
    const hard = home ? (swap ? `„${swap}“` : 'langsamer ausführen (3 Sekunden absenken) oder oben kurz halten') : v.hard;
    return `💡 Mehr als ${BW_MAX_REPS} Wdh.: Ab hier trainierst du vor allem Ausdauer. Zeit für eine schwerere Variante: ${hard}.${swapTxt}${hintBtns(en, 'high', swap)}`;
  }
  return '';
}

// Vorgeschlagene Sätze für den Trainingsstart
function buildSets(name, target) {
  // Gewicht aus der Progression; ohne Max.-Wert das Gewicht vom letzten Mal
  // (Eigengewichtsübung: kein Gewicht, nur Wdh.)
  const last = lastEntry(name);
  const t0 = tAt(target, 0);  // Satz 1 mit seinem Tank (v199: ganze Zahlen je Satz)
  let tw = target.bodyweight ? null : target.deload ? target.weight : targetWeight(t0);
  const sets = [];
  const lastSets = last && !target.bodyweight ? ofVariant(last.sets, '') : [];  // nur normale Sätze als Bezug
  // Zu Hause: liegt das passende Gewicht zwischen zwei vorhandenen, gilt das leichtere – dafür mehr Wdh.
  let reps0 = target.reps;
  if (target.weights && tw != null && target.max10 != null && !target.deload) {
    const ideal = effMax(target) * repFactor(target.reps + t0.rir);
    const need = repsAtWeight(target.reps, t0.rir, ideal, tw);
    const up = wUp(tw, target), upReps = up != null ? repsAtWeight(target.reps, t0.rir, ideal, up) : null;
    // große Lücke: das leichtere Gewicht nur, solange damit höchstens MAXED_REPS Wdh. nötig sind (User-Regel 2026-11-06)
    if (need > MAXED_REPS && up != null && upReps >= minReps()) { tw = up; reps0 = upReps; }
    else reps0 = Math.min(MAXED_REPS, Math.max(target.reps, need));
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
      const reps = ref != null ? Math.max(minReps(), ref - DELOAD_RIR - FATIGUE * i) : target.reps;
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
    // Ziel-Wdh. gelten für Satz 1, danach je Satz 1 Wdh. weniger (Ermüdung), mind. minReps()
    const p = i === 0 ? { weight: w, reps: reps0 } : planSet(reps0 + t0.rir, w, tAt(target, i), i);
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

// Gewichtssprung der Übung im Training: kleiner Knopf, aufgeklappt die Auswahl 1,25 / 2 / 2,5 / 5 / 10 kg
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

// Vorermüdung im laufenden Training neu bestimmen (Reihenfolge, Ersetzen, Sätze): Übungen ohne angefassten Satz bekommen
// einen neuen Vorschlag, bei begonnenen bleibt der Vorschlag (gespeichert wird ohnehin die tatsächliche Vorermüdung)
function refreshPrefat() {
  if (!draft || draft.own) return;
  const list = draftPrefatList();
  draft.entries.forEach((en, i) => {
    if (!en.target) return;
    const f = preFatigue(list, i);
    if (Math.abs((en.target.fat || 0) - f) < 1e-9) return;
    if (en.sets.some(s => s.touched || isDone(s))) { en.target.fat = f; return; }
    rebuildEntry(en, { ...(en.plan || en.target), fat: f });
  });
}

// Satz anhängen wie „+ Satz“: Gewicht des letzten Satzes, 1 Wdh. weniger
function addAutoSet(en) {
  const prev = en.sets[en.sets.length - 1];
  const prevReps = prev ? parseNum(prev.reps) : null;
  en.sets.push({
    weight: prev ? prev.weight : '',
    reps: prevReps != null ? String(Math.max(1, prevReps - FATIGUE)) : (en.target ? String(en.target.reps) : ''),
    rir: '',
    auto: true,
    variant: variantOf(prev),
  });
}

// Übung im laufenden Training neu vorschlagen (Vorermüdung, Max., Gewichtsstufe, Band, Tausch) – die aktuelle Satzzahl
// bleibt: vom Zeitlimit gekürzte Sätze kommen nicht zurück, von Hand angehängte bleiben (Fehler bis v181: volle Plan-Sätze)
function rebuildEntry(en, target) {
  const keep = en.sets.length, variants = en.sets.map(variantOf);
  setupEntry(en, target, j => variants[Math.min(j, variants.length - 1)] || '');
  if (!keep) return;
  if (en.sets.length > keep) {
    en.sets.length = keep;
    en.planned.length = Math.min(en.planned.length, keep);
    en.target = { ...en.target, sets: keep };
  } else if (en.sets.length < keep) {
    while (en.sets.length < keep) addAutoSet(en);
    const ei = draft.entries.indexOf(en);
    if (ei >= 0) recalcSets(ei);
  }
}

// Übung im laufenden Training gegen eine andere tauschen (Plan bleibt unverändert)
function replaceExercise(en, name, max10) {
  const original = en.replacedFrom || en.name;
  const ex = planExercise(name);
  const plan = en.plan || en.target;  // Ziel laut Plan (ohne Deload-/Intro-Anpassung)
  en.name = name;
  en.replacedFrom = nameKey(name) === nameKey(original) ? null : original;
  rebuildEntry(en, { ...plan, max10, step: stepFor(ex || { name, step: null }), weights: weightsFor(name) });
}

// Ergebnis einer Übung fürs nächste Mal, gemessen am ersten normalen Satz (null, wenn Werte fehlen).
// max10 steht auch im Ergebnis – für Ersatzübungen, die nicht im Plan stehen.
function entryResult(en) {
  const first = en.sets.find(s => !s.variant && !s.outlier);
  if (!en.target || !first || first.weight == null || first.reps == null || first.rir == null) return null;
  const t = { step: 2.5, ...en.target };
  const result = progression(first, t);
  const fat = en.fat != null ? en.fat : t.fat || 0;  // Max. bei 10 Wdh. = Frisch-Wert
  result.max10 = Math.round(result.next / repFactor(t.reps + t.rir) / (1 - fat) * 10) / 10;
  return result;
}

// Max. bei 10 Wdh. aus dem ersten normalen Satz: Wdh. + Tank = Wdh. bis zum Versagen bei diesem Gewicht
// (Tank nicht eingetragen -> Ziel-Tank der Woche)
function estimateMax10(en) {
  const first = en.sets.find(s => !s.variant && !s.outlier);
  if (!first || !first.weight || first.reps == null) return null;
  const rir = first.rir != null ? first.rir : en.target ? en.target.rir : 0;
  const fat = en.fat != null ? en.fat : (en.target && en.target.fat) || 0;
  return roundTo(first.weight / repFactor(first.reps + rir) / (1 - fat), 0.5);
}

const setPlanMax10 = (name, max10) => {
  for (const day of data.days) {
    for (const ex of day.exercises) if (nameKey(ex.name) === nameKey(name)) ex.max10 = max10;
  }
};

function saveTraining() {
  const ssNow = draftPairs();  // Supersätze (v210): im Verlauf markieren
  const entries = draft.entries
    .map((en, i) => ({
      name: en.name,
      ...(ssNow.has(i) ? { ss: en.ss } : {}),
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
          ...(setOutlier({ weight: parseNum(s.weight), reps: parseNum(s.reps) }, outlierRef(en.name, (en.planned || [])[en.sets.indexOf(s)])) ? { outlier: 1 } : {}),
          ...(s.open ? { open: 1 } : {}),
          ...(isTech(s.variant) && s.subs ? { subs: s.subs.map((x, j) => ({ weight: subWeight(en, en.sets.indexOf(s), j), reps: parseNum(x.reps) }))
            .filter(x => x.reps != null) } : {}),  // Teil-Sätze (v211)
        }))
        .filter(s => s.weight != null || s.reps != null),
    }))
    .filter(en => en.sets.length);
  // tatsächliche Vorermüdung je Übung (Reihenfolge und Sätze, wie sie gespeichert werden)
  if (!draft.own) entries.forEach((e, i, all) => {
    const f = preFatigue(all.map(x => ({ name: x.name, n: x.sets.length + techExtra(x.sets) })), i);
    if (f) e.fat = f;
  });

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
    // Zyklustag mit Beschwerden: „Max“ darf steigen, aber nicht sinken (User-Regel 2026-11-09)
    const known = knownMax10(en.name);
    if (draft.mc && draft.mc.lvl > 0 && known != null && result.max10 < known) continue;
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
  if (draft.mc) session.mc = draft.mc;  // Zyklus-Zeitfenster und gewählte Stufe (Lernen, Folgewoche)
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
  // Supersätze aus dem Plan: nach dem 2. Training damit einmal nachfragen, ob die Pausen gepasst haben (ssCheckCard)
  const sday = findDay(draft.dayId);
  if (sday && [...ssNow.values()].some(p => !draft.entries[p.i].ssToday)) sday.ssRuns = (sday.ssRuns || 0) + 1;
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
function markExported(filename) {
  data.lastExport = new Date().toLocaleDateString('sv-SE');  // für die Sicherungs-Erinnerung
  data.lastExportName = filename;                             // in Optionen angezeigt – damit man die Datei wiederfindet
  saveData();
}

// Dateiname der Sicherung (User-Wunsch 2026-11-09): gleich erkennbar und in der Dateien-App leicht zu finden –
// immer mit „Gainslocker-Sicherung“ (bis v216 „StepUp-Sicherung“) vorn, dann Name und Ortszeit (Datum zuerst, damit sie nach Namen sortiert zeitlich stehen),
// z. B. „Gainslocker-Sicherung Alex 2026-11-09 14.30.json“
function backupFileName(now = new Date()) {
  const who = String((data.profile && data.profile.name) || '').replace(/[\\/:*?"<>|.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30).trim();
  const hm = `${String(now.getHours()).padStart(2, '0')}.${String(now.getMinutes()).padStart(2, '0')}`;
  return `${APP_SHORT}-Sicherung ${who ? who + ' ' : ''}${now.toLocaleDateString('sv-SE')} ${hm}.json`;
}

/* ---------- Sicherung mit Passwort (v197, freiwillig): AES-GCM 256, Schlüssel aus dem Passwort per PBKDF2-SHA256 ---------- */
// Die Datei bleibt JSON: { app, enc: 1, kdf, iter, salt, iv, data (alles Base64), exportedAt }. Das Passwort wird nie gespeichert.
const BACKUP_ITER = 300000;
const b64enc = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const b64dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function backupKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encryptBackup(json, pw, exportedAt) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await backupKey(pw, salt, BACKUP_ITER);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json)));
  return JSON.stringify({ app: 'trainingsapp', enc: 1, kdf: 'PBKDF2-SHA256', iter: BACKUP_ITER, salt: b64enc(salt), iv: b64enc(iv), data: b64enc(ct), exportedAt });
}
async function decryptBackup(d, pw) {
  const key = await backupKey(pw, b64dec(d.salt), d.iter || BACKUP_ITER);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64dec(d.iv) }, key, b64dec(d.data));
  return new TextDecoder().decode(pt);
}
// Verschlüsselte Sicherung öffnen: nach dem Passwort fragen (bis zu 3 Versuche); null = abgebrochen
async function openEncryptedBackup(raw) {
  for (let i = 0; i < 3; i++) {
    const pw = await uiPrompt(`Diese Sicherung ist mit einem Passwort geschützt.${i ? '\n\nFalsches Passwort – bitte noch einmal.' : ''}`, '', 'password');
    if (pw === null) return null;
    try { return JSON.parse(await decryptBackup(raw, pw)); } catch (e) { /* falsches Passwort */ }
  }
  alert('Dreimal ein falsches Passwort – die Sicherung wurde nicht geladen.');
  return null;
}
const backupPwOn = () => !!data.backupPw;  // Einstellung „Sicherungen mit Passwort“ (das Passwort selbst wird nicht gespeichert)
let backupPw = '';                         // nur im Arbeitsspeicher, solange die App offen ist
// Passwort für den Export holen: Feld in den Optionen, sonst nachfragen; null = abgebrochen
async function askBackupPw() {
  let pw = backupPw;
  if (pw.length < 4) {
    pw = await uiPrompt('Passwort für diese Sicherung\n\nWird nicht gespeichert – ohne Passwort lässt sich die Datei nicht mehr öffnen.', '', 'password');
    if (pw === null) return null;
    pw = pw.trim();
  }
  if (pw.length < 4) { alert('Bitte ein Passwort mit mindestens 4 Zeichen wählen.'); return null; }
  backupPw = pw;
  return pw;
}

async function exportData() {
  const exportedAt = new Date().toISOString();
  let json = JSON.stringify({ ...data, exportedAt }, null, 2);
  let filename = backupFileName();
  if (backupPwOn()) {
    const pw = await askBackupPw();
    if (pw === null) return;
    json = await encryptBackup(json, pw, exportedAt);
    filename = filename.replace(/\.json$/, ' (Passwort).json');
  }
  const file = new File([json], filename, { type: 'application/json' });

  // iPhone: Teilen-Menü -> „In Dateien sichern“
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: `${APP_SHORT}-Sicherung` });
      markExported(filename);
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
  markExported(filename);
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let d;
    try {
      let raw = JSON.parse(reader.result);
      if (raw && raw.enc === 1) { raw = await openEncryptedBackup(raw); if (raw === null) return; }
      d = cleanImport(raw);
    } catch (e) { d = null; }
    if (!isValidData(d)) {
      alert('Diese Datei ist keine gültige Trainings-Sicherung.');
      return;
    }
    const plans = Array.isArray(d.plans) ? `${d.plans.length} ${d.plans.length === 1 ? 'Plan' : 'Plänen'}` : `${d.days.length} Trainingstagen`;
    const at = d.exportedAt && !isNaN(new Date(d.exportedAt)) ? new Date(d.exportedAt) : null;
    const from = at ? ` vom ${at.toLocaleDateString('de-DE')}, ${at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr,` : '';
    if (!(await uiConfirm(`Sicherung${from} mit ${plans} und ${d.sessions.length} Trainings laden?\n\nDie aktuellen Daten werden ersetzt.`))) return;
    data = upgradeData({
      app: 'trainingsapp', version: 1,
      plans: d.plans, activePlanId: d.activePlanId,
      days: d.days, volume: d.volume, rirPlan: d.rirPlan,  // ältere Sicherungen mit nur einem Plan
      sessions: d.sessions, bodyweight: d.bodyweight, cycle: d.cycle, steps: d.steps,
      complaints: d.complaints, hintsDismissed: d.hintsDismissed, dayTemplates: d.dayTemplates,
      cycleShift: d.cycleShift, roundSkips: d.roundSkips, caliSnooze: d.caliSnooze, hyrox: d.hyrox, timeLimit: d.timeLimit, home: d.home, tour: d.tour, hintOff: d.hintOff, pauseAsked: d.pauseAsked, welcomeSeen: d.welcomeSeen, nutrition: d.nutrition, intake: d.intake, foodLog: d.foodLog, foods: d.foods, foodClosed: d.foodClosed, foodMeals: d.foodMeals, mcal: d.mcal, cardio: d.cardio, nutPlan: d.nutPlan,
      customExercises: d.customExercises, profile: d.profile, prefatV: d.prefatV, rirV: d.rirV,
      measures: Array.isArray(d.measures) ? d.measures : [],
      painLog: Array.isArray(d.painLog) ? d.painLog : [],
      photoCfg: d.photoCfg && typeof d.photoCfg === 'object' ? d.photoCfg : undefined,  // nur Einstellungen – Fotos selbst haben eine eigene Sicherung
    });
    registerCustomExercises();
    prefatMigrate();  // ältere Sicherung: Max.-Werte auf frisch umrechnen
    rirMigrate();     // ältere Sicherung: Tank-Ziele −0,5 (v199)
    applyTheme();
    saveData();
    if (welc) welcomeClose();  // v217: Sicherung aus der Begrüßung geladen (Umzug) – Begrüßung zu
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
    const words = norm(typeof exSearchText === 'function' ? exSearchText(name) : name).split(/[^a-z0-9]+/);
    // Jedes eingetippte Wort muss ein Wortanfang sein (ab 3 Buchstaben auch Wortteil)
    const full = words.join(' ');
    const match = qWords.every(qw => words.some(w => w.startsWith(qw)) || (qw.length >= 3 && full.includes(qw)));
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
  if (!en.base || s.touched) { s.variant = v; techEnsure(en, i); return; }
  applyProposal(en, i, v);
  techEnsure(en, i);
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
    rebuildEntry(en, { ...en.plan, max10: v });
  } else {
    en.target.max10 = v;
    if (en.plan) en.plan.max10 = v;
  }
  saveDraft(); render();
}

// Supersatz (v210): ein Paar bewegt sich als Ganzes
function moveExercise(day, i, dir) {
  const exs = day.exercises, pairs = dayPairs(exs, true);
  const unit = k => { const p = pairs.get(k); return p ? [p.i, p.j] : [k, k]; };
  const [a, b] = unit(i), nb = dir < 0 ? a - 1 : b + 1;
  if (nb < 0 || nb >= exs.length) return;
  const [c, d] = unit(nb), mine = exs.slice(a, b + 1), other = exs.slice(c, d + 1);
  exs.splice(Math.min(a, c), mine.length + other.length, ...(dir < 0 ? [...mine, ...other] : [...other, ...mine]));
}

const actions = {
  // Reiterwechsel: Zeitfenster und Auswahl im Diagramm zurücksetzen (Diagramme und Ernährung teilen sie sich)
  tab: el => {
    Object.assign(chartState, { end: null, sel: null });
    // Verlauf: zuletzt offener Bereich (Kalender, Übungen, Statistik, Erfolge – v203)
    if (el.dataset.tab === 'history' && typeof goHist === 'function') { goHist((data.profile || {}).histTab); return; }
    go(el.dataset.tab);
  },
  // back: Name der Ansicht oder Funktion (params) => [Ansicht, params]
  cancel: () => {
    const c = viewCancel();
    if (c && askOk(c.ask)) c.run();
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
    exRename = null;
    if (current.params.ret && swapReturn) { const r = swapReturn; swapReturn = null; libForm = null; go(r.view, r.params); return; }
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
      // Name geändert: überall umbenennen – Pläne und Verlauf ziehen mit (mit Rückfrage)
      if (name !== f.orig && !renameExercise(f.orig, name)) return;
      const i = data.customExercises.findIndex(x => nameKey(x.name) === nameKey(name));
      data.customExercises[i] = c;
    } else data.customExercises.push(c);
    registerCustomExercises();
    saveData();
    libForm = null;
    if (like && !c.like) toast('Ähnliche Übung nicht gefunden – bitte aus den Vorschlägen wählen');
    else toast(f.orig ? 'Übung gespeichert ✔' : `${name} angelegt ✔`);
    libOpenGroups.add('own');
    if (current.params.ret && swapReturn) { swapNewFinish(name); return; }  // v218: aus dem Ersetzen-Menü – gleich tauschen
    swapReturn = null;
    go('libex', { name });
  },
  'libc-del': el => {
    const name = el.dataset.name;
    if (!askOk(`„${name}“ aus deinen eigenen Übungen löschen?\n\nIn deinen Plänen und im Verlauf bleibt sie erhalten – sie erscheint nur nicht mehr in der Bibliothek und in den Vorschlägen.`)) return;
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
    timeEdit = { min: tl && tl.min ? String(tl.min) : '45', once: tl ? !!tl.once : true, ss: tl ? tl.ss !== false : true };
    render();
  },
  'time-chip': el => { timeEdit.min = el.dataset.m; render(); },
  'time-once': el => { timeEdit.once = el.dataset.v === '1'; render(); },
  'time-ss': el => { timeEdit.ss = el.dataset.v === '1'; render(); },
  'time-cancel': () => { timeEdit = null; render(); },
  'time-save': () => {
    const m = Math.round(parseNum(timeEdit.min));
    if (!(m >= 10 && m <= 240)) { alert('Bitte eine Zeit zwischen 10 und 240 Minuten eintragen.'); return; }
    data.timeLimit = { min: m, once: timeEdit.once, ss: timeEdit.ss !== false };
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
  'pause-choice': el => {
    const { id } = current.params, p = pauseInfo();
    const endedCycle = cycleInfo().cycleStart;  // wird bei „leichte Woche“/„neuer Zyklus“ beendet
    if (p) data.pauseAsked = p.id;
    if (el.dataset.m === 'dl') actions['cyc-end']({ dataset: { m: 'newdl' } });
    else if (el.dataset.m === 'new') actions['cyc-end']({ dataset: { m: 'new' } });
    if (el.dataset.m !== 'go' && endedCycle) { const pl = activePlan(); pl.feelSkip = [...(pl.feelSkip || []), endedCycle]; }  // Neustart nach Pause: keine Zyklus-Frage
    saveData();
    beginCheck(id);
  },
  // Wie hat sich der Zyklus angefühlt? -> Tank-Anpassung für den neuen Zyklus
  'cycle-feel': el => {
    const p = activePlan(), m = el.dataset.m, { id, cs, late } = current.params;
    const step = m === 'hard' ? FEEL_STEP : m === 'easy' ? -FEEL_STEP : 0;
    p.feelLog = [...(p.feelLog || []), { cs, step, m, at: todayISO() }];
    saveData();
    if (step) toast(`${late ? 'Der neue' : 'Der nächste'} Zyklus wird etwas ${m === 'hard' ? 'leichter' : 'fordernder'}`);
    beginCheck(id);
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
  'entry-help-ok': () => { data.profile = data.profile || {}; data.profile.entryHelpKnown = true; entryHelpOpen = false; saveData(); render(); },
  'entry-help-toggle': () => { entryHelpOpen = !entryHelpOpen; render(); },
  'prefat-help-toggle': () => { prefatHelpOpen = !prefatHelpOpen; render(); },
  'tr-feel': el => {
    const ei = Number(el.dataset.ei), si = Number(el.dataset.si);
    const en = draft.entries[ei];
    fields['tr-rir']({ value: String(feelRir(en.target, el.dataset.f, si)), dataset: { ei: String(ei), si: String(si) } });
    if (el.dataset.f === 'easy') en.sets[si].open = 1;  // „locker“ = mindestens so viel im Tank, nach oben offen (openFloor)
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
  // Training: Übungen untereinander oder wischen (gilt für alle Trainings, profile.swipe)
  'tr-swipe': el => {
    data.profile = data.profile || {};
    data.profile.swipe = el.dataset.v === '1';
    saveData(); render();
  },
  'tr-go': el => trGo(Number(el.dataset.d)),
  'tr-go-to': el => trGo(0, Number(el.dataset.i)),
  'tr-to-save': () => { const b = $view.querySelector('[data-action="tr-save"]'); if (b) b.scrollIntoView({ block: 'center', behavior: 'smooth' }); },
  'reorder-toggle': () => {
    draft.reorder = !draft.reorder;
    saveDraft(); render();
    if (draft.reorder) window.scrollTo(0, 0);
  },
  // Kopfleiste im Training (v200)
  'tr-menu': () => { trMenuOpen = !trMenuOpen; syncTrHead(); },
  // Pausen-Timer (v202)
  'rest-add': el => {
    const r = draft && draft.rest;
    if (!r) return;
    r.end += Number(el.dataset.s) * 1000;
    if (r.end <= Date.now()) delete draft.rest;  // auf 0 gekürzt = Pause beenden, ohne Signal
    else r.total = Math.max(r.total, r.end - Date.now());
    saveDraft(); syncTrHead();
  },
  'rest-skip': () => { if (draft) { delete draft.rest; saveDraft(); syncTrHead(); } },
  'rest-set': el => {
    const r = { ...restCfg(), [el.dataset.k]: el.dataset.v === '1' };
    data.profile = { ...(data.profile || {}), rest: r };
    if (el.dataset.k === 'sound' && r.sound) { restAudio(true); restPlay(r.tone); }
    if (el.dataset.k === 'vib' && r.vib && navigator.vibrate) { try { navigator.vibrate(200); } catch (e) { /* ohne */ } }
    if (r.off && draft) { delete draft.rest; saveDraft(); }
    saveData(); render();
  },
  'wn-ok': () => { data.seenV = APP_V; saveData(); render(); },
  // Ergebnis teilen (v206)
  'share-open': el => go('share', { id: el.dataset.id, week: current.params && current.params.week }),
  'share-send': async () => {
    if (!shareFile) return;
    if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
      try { await navigator.share({ files: [shareFile], title: 'Mein Training' }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    shareSave();  // ohne Teilen-Menü (z. B. am Computer): als Bild herunterladen
  },
  'share-save': () => shareSave(),
  // Fehlerprotokoll und dauerhafter Speicher (v205)
  'err-share': async () => {
    const text = errReport();
    if (navigator.share) {
      try { await navigator.share({ title: `${APP_SHORT} Fehlerprotokoll`, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text); toast('Fehlerprotokoll kopiert ✔ – z. B. in eine Nachricht einfügen'); }
    catch (e) { uiCopy(text); }
  },
  'err-clear': () => {
    if (!askOk('Fehlerprotokoll löschen?')) return;
    try { localStorage.removeItem(ERR_KEY); } catch (e) { /* egal */ }
    render();
  },
  'persist-ask': async () => {
    let ok = false;
    try { ok = await navigator.storage.persist(); } catch (e) { /* nein */ }
    toast(ok ? 'Dauerhafter Speicher erlaubt ✔' : 'Der Browser hat es (noch) nicht erlaubt');
    persistFill();
  },
  // Scheiben-Rechner (v204)
  'plates-bar': el => {
    data.profile = { ...(data.profile || {}), plates: { have: platesHave(), ...((data.profile || {}).plates || {}), bar: Number(el.dataset.v) } };
    saveData(); render();
  },
  'plates-toggle': el => {
    const p = Number(el.dataset.v), have = platesHave();
    const next = have.includes(p) ? have.filter(x => x !== p) : [...have, p];
    if (!next.length) { toast('Mindestens eine Scheibe muss ausgewählt sein'); return; }
    data.profile = { ...(data.profile || {}), plates: { bar: barKg(), have: PLATE_ALL.filter(x => next.includes(x)) } };
    saveData(); render();
  },
  'rest-tone': el => {
    data.profile = { ...(data.profile || {}), rest: { ...restCfg(), tone: el.dataset.k } };
    restAudio(true); restPlay(el.dataset.k);
    saveData(); render();
  },
  'tr-jump': () => {
    const { cur } = trProgress();
    if (cur < 0) { actions['tr-to-save'](); return; }
    if (draft.reorder) return;
    if (trSwipeOn()) { trGo(0, cur); return; }
    const card = $view.querySelector(`section.ex-card[data-ei="${cur}"]`);
    if (card) window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - document.querySelector('header').offsetHeight - 8, behavior: 'smooth' });
  },
  'trm-entry-help': () => { entryHelpOpen = true; render(); window.scrollTo(0, 0); },
  'trm-prefat': () => { prefatHelpOpen = true; render(); window.scrollTo(0, 0); },
  'trm-details-all': () => {
    const open = !draft.entries.every(detOpen);
    draft.entries.forEach(en => { en.detOpen = open; });
    data.profile = data.profile || {}; data.profile.trDetails = open;
    saveData(); saveDraft(); render();
  },
  // Details einer Übung auf/zu; die Wahl gilt als Vorgabe fürs nächste Training, die übrigen Übungen bleiben, wie sie sind
  'ex-details': el => {
    const ei = +el.dataset.ei, open = !detOpen(draft.entries[ei]);
    draft.entries.forEach(en => { if (en.detOpen == null) en.detOpen = detOpen(en); });
    draft.entries[ei].detOpen = open;
    data.profile = data.profile || {}; data.profile.trDetails = open;
    saveData(); saveDraft(); render();
  },
  'tr-move': el => {
    const i = +el.dataset.ei, j = i + Number(el.dataset.dir);
    if (j < 0 || j >= draft.entries.length) return;
    [draft.entries[i], draft.entries[j]] = [draft.entries[j], draft.entries[i]];
    refreshPrefat();
    saveDraft(); render();
  },
  // Hinweis im Training ausblenden: je Übung, für alle (zu viele Wdh.) oder bis zum nächsten Zyklus (zu schwer)
  'hint-off': el => {
    const en = draft.entries[el.dataset.ei], k = nameKey(en.name), h = hintOff();
    if (el.dataset.k === 'all') h.all = true;
    else if (el.dataset.k === 'low') h.low[k] = draft.cycleStart;
    else h.ex[k] = true;
    saveData(); render();
  },
  'hint-on': () => { Object.assign(hintOff(), { all: false, ex: {}, low: {} }); saveData(); render(); toast('Hinweise werden wieder angezeigt'); },
  // Übung tauschen: heute und im Plan (an allen Tagen, an denen sie steht und die neue noch nicht)
  'hint-swap': el => {
    const en = draft.entries[el.dataset.ei], name = el.dataset.name, old = nameKey(en.name);
    if (en.sets.some(s => s.touched) && !askOk('Bereits eingetragene Sätze dieser Übung gehen verloren. Trotzdem tauschen?')) return;
    for (const d of data.days) {
      if (d.exercises.some(x => nameKey(x.name) === nameKey(name))) continue;
      const i = d.exercises.findIndex(x => nameKey(x.name) === old);
      if (i >= 0) planReplaceExercise(d, i, name);
    }
    replaceExercise(en, name, knownMax10(name));
    saveDraft(); saveData(); render();
  },
  'comment-dismiss': el => {
    const s = data.sessions.find(x => x.id === el.dataset.sid);
    const e = s && s.entries.find(en => nameKey(en.name) === nameKey(el.dataset.name));
    if (!e) return;
    e.commentHidden = true;
    saveData(); render();
  },
  // v216: Antwort auf die Frage nach 1,25-kg-Schritten (einmal je Übung)
  'step-ask': el => {
    const en = draft.entries[el.dataset.ei];
    const ex = en && planExercise(en.name);
    if (ex) { ex.stepAsked = 1; saveData(); }
    if (el.dataset.v === '1') { actions['tr-step']({ dataset: { ei: el.dataset.ei, v: String(STEP_FINE) } }); toast('Steigerung jetzt 1,25 kg ✔'); }
    else { saveDraft(); render(); }
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
        rebuildEntry(en, { ...en.plan, step: v });
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
      rebuildEntry(en, en.plan);
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
    addAutoSet(draft.entries[el.dataset.ei]);
    recalcSets(+el.dataset.ei);
    refreshPrefat();
    saveDraft(); render();
  },
  'tr-del-set': el => {
    const sets = draft.entries[el.dataset.ei].sets;
    if (sets.length) sets.pop();
    refreshPrefat();
    saveDraft(); render();
  },
  'typo-ok': el => {
    const s = draft.entries[el.dataset.ei].sets[el.dataset.si];
    s.typoOk = `${s.weight}|${s.reps}`;
    saveDraft();
    $view.querySelector(`[data-typo="${el.dataset.ei}-${el.dataset.si}"]`).innerHTML = '';
  },
  'typo-fix': el => {
    const input = $view.querySelector(`[data-field="${el.dataset.f}"][data-ei="${el.dataset.ei}"][data-si="${el.dataset.si}"]`);
    if (input) { input.focus(); input.select(); }
  },
  'tr-save': () => {
    // noch nicht bestätigte Auffälligkeiten einmal gesammelt nachfragen
    const open = draft.entries.flatMap(en => en.sets.map((x, i) => (x.touched ? typoInfo(en, i) : null)).filter(Boolean).map(t => `• ${en.name}: ${t.text}`));
    if (open.length && !askOk(`Bitte einmal prüfen:\n${open.join('\n')}\n\nOK = so speichern, Abbrechen = zurück`)) return;
    saveTraining();
  },
  'tr-cancel': () => {
    if (!askOk('Training wirklich verwerfen? Die Eingaben gehen verloren.')) return;
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
    dayReorder = null;
    const missing = ownPlan() ? [] : findDay(current.params.id).exercises.filter(e => e.name.trim() && e.max10 == null && !isBodyweight(e));
    if (missing.length && !askOk(
      `Bei ${missing.length === 1 ? '1 Übung' : missing.length + ' Übungen'} fehlt noch „Max. kg bei 10 Wdh.“:\n\n` +
      missing.map(e => '• ' + e.name.trim()).join('\n') +
      '\n\nTrotzdem fertig? (Bei Übungen ohne Gewicht, z. B. Klimmzüge, einfach leer lassen.)'
    )) return;
    toast('Trainingstag gespeichert ✔'); go('plan');
  },
  'del-day': () => {
    const day = findDay(current.params.id);
    if (!askOk(`„${day.name}“ löschen? Bereits gespeicherte Trainings bleiben im Verlauf.`)) return;
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
    if (input.dataset.field === 'ex-name') exNameCommit(input);  // vor blur: das löst sonst „change“ aus (zweimal fragen)
    input.blur();
    if (input.dataset.field === 'ex-name') {
      const info = prev.querySelector && prev.querySelector('.info-btn');
      if (info) info.hidden = !libEntry(el.dataset.name);
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
    if (trSwipeOn()) draft.cur = draft.entries.length - 1;  // Wischen: gleich zur neuen Übung
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
    if (en.sets.some(s => s.touched) && !askOk(`„${en.name}“ mit den eingetragenen Sätzen entfernen?`)) return;
    draft.entries.splice(el.dataset.ei, 1);
    saveDraft(); render();
  },
  'rep-ok': el => {
    const en = draft.entries[el.dataset.ei];
    const panel = el.closest('.replace');
    const name = panel.querySelector('[data-field="rep-name"]').value.trim();
    if (!name) { alert('Bitte eine Ersatzübung eingeben.'); return; }
    if (en.sets.some(s => s.touched) && !askOk('Bereits eingetragene Sätze dieser Übung gehen verloren. Trotzdem ersetzen?')) return;
    replaceExercise(en, name, parseNum(panel.querySelector('[data-field="rep-max"]').value));
    en.replacing = false;
    refreshPrefat();
    saveDraft(); render();
    toast(`Ersetzt durch ${name}`);
  },
  'plan-swap-open': el => { exRename = null; planSwap = { day: current.params.id, i: Number(el.dataset.i) }; render(); },
  'plan-swap-cancel': () => { planSwap = null; render(); },
  'plan-swap-pick': el => { if (planReplaceExercise(findDay(current.params.id), Number(el.dataset.i), el.dataset.name)) render(); },
  'plan-swap-ok': el => {
    const input = $view.querySelector(`[data-field="plan-swap-name"][data-i="${el.dataset.i}"]`);
    if (planReplaceExercise(findDay(current.params.id), Number(el.dataset.i), input && input.value)) render();
  },
  'ex-del': el => {
    const day = findDay(current.params.id);
    const ex = day.exercises[el.dataset.i];
    if (ex.name.trim() && !askOk(`„${ex.name}“ aus dem Plan entfernen?`)) return;
    day.exercises.splice(el.dataset.i, 1);
    ssClean(day.exercises);  // Partner eines Supersatzes läuft wieder einzeln
    saveData(); render();
  },
  'day-reorder': () => { dayReorder = dayReorder === current.params.id ? null : current.params.id; render(); },
  'ex-up': el => { moveExercise(findDay(current.params.id), +el.dataset.i, -1); saveData(); render(); },
  'ex-down': el => { moveExercise(findDay(current.params.id), +el.dataset.i, 1); saveData(); render(); },
  'plan-activate': el => {
    if (data.activePlanId === el.dataset.id) return;
    if (draft && !askOk(`Es läuft noch ein Training (${draft.dayName}). Trotzdem den Plan wechseln?`)) return;
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
    if (!askOk(`Plan „${p.name}“ beenden?\n\nEr bleibt in der Liste und kann jederzeit wieder aktiviert werden. Trainings, Verlauf und Erfolge bleiben erhalten.`)) return;
    p.endedAt = todayISO();
    data.activePlanId = null;
    saveData(); render();
    toast(`„${p.name}“ beendet`);
  },
  // eigener Plan -> ab jetzt mit Zyklen, Deload und Steigerung der App (Tage bleiben „Frei“: Sätze × Wdh. pro Übung)
  'plan-own-off': () => {
    const p = activePlan();
    if (!askOk(`„${p.name}“ ab jetzt mit der Steigerung der App trainieren?\n\nDann gibt es Zyklen mit Intro-, Aufbau- und Deload-Woche, und die App schlägt Woche für Woche mehr Gewicht bzw. Wiederholungen vor.`)) return;
    delete p.own;
    p.progression = { volume: true, load: true };
    setRound(newCycleId(), 1, (data.cycle.no || 0) + 1);
    saveData(); render();
    toast('Steigerung eingeschaltet – es beginnt die Intro-Woche');
  },
  'plan-rename': async el => {
    const p = data.plans.find(x => x.id === el.dataset.id);
    const name = await uiPrompt('Neuer Name für den Plan', p.name);
    if (name && name.trim()) { p.name = name.trim(); saveData(); render(); }
  },
  'plan-delete': el => {
    const p = data.plans.find(x => x.id === el.dataset.id);
    if (!askOk(`Plan „${p.name}“ mit ${p.days.length} Trainingstagen löschen?`)) return;
    if (!askOk('Wirklich löschen? Das lässt sich nicht rückgängig machen.\n\nGespeicherte Trainings, Verlauf und Erfolge bleiben erhalten.')) return;
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
  'load-template': async () => {
    let replace = false;
    if (data.days.length) {
      const msg = 'Vorhandene Trainingstage durch den Standard-Plan ersetzen?\n\nOder die 4 Tage zusätzlich anlegen. Gespeicherte Trainings bleiben in beiden Fällen erhalten.';
      if (window.confirm !== NATIVE_CONFIRM) replace = window.confirm(msg);
      else {
        const v = await uiDialog({ msg, confirm: true, choices: [{ label: 'Abbrechen', value: false }, { label: 'Zusätzlich anlegen', value: 'add' }, { label: 'Ersetzen', value: 'rep', primary: true }] });
        if (!v) return;
        replace = v === 'rep';
      }
    }
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
    if (!askOk(`„${MUSCLES[g] || g}“ entfernen? Übungen dieser Muskelgruppe bekommen ihre Sätze dann wieder von Hand.`)) return;
    delete data.volume[g];
    if (activePlan().volExtra) delete activePlan().volExtra[g];
    saveData(); go('plan', { volOpen: true });
  },
  'vol-reset': () => {
    if (!askOk('Alle Sätze pro Muskelgruppe auf die Standardwerte zurücksetzen?')) return;
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
  // Zyklus-Karte auf dem Start auf-/zuklappen (v201), Stand wird gemerkt
  'cyc-toggle': () => {
    const open = !cycOpen();
    data.profile = data.profile || {}; data.profile.cycOpen = open;
    if (!open) { cycAdjustOpen = false; cycEndAsk = false; }
    saveData(); render();
  },
  'cyc-adj': el => {
    const d = Number(el.dataset.d);
    if (el.dataset.scope === 'all') {
      // Standardlänge für alle Zyklen (4–10), gilt sofort auch für den laufenden – dessen Verlängerung/Verkürzung bleibt
      data.cycle.defWeeks = Math.min(CYCLE_MAX, Math.max(4, data.cycle.defWeeks + d));
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
    if (!askOk(`Ab jetzt mit der ${label} weitermachen?${started ? `\n\nDie Trainings, die du in der ${ciLabel(ci)} schon gemacht hast, bleiben dort gespeichert.` : ''}`)) return;
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
    if (!askOk('Deload-Woche jetzt einlegen?\n\nHalbe Sätze, 15 % weniger Gewicht oder weniger Wdh., mind. 3 Wdh. im Tank – jeder Trainingstag einmal. Danach beginnt ein neuer Zyklus mit der Intro-Woche.')) return;
    startDeloadNow();
    saveData(); render();
    toast('Deload-Woche eingelegt');
  },
  // Deload automatisch (nach den Trainingswochen) oder selbst bestimmen
  'plan-deload': el => {
    const p = activePlan(), mode = el.dataset.m;
    if ((p.deload || 'auto') === mode) return;
    const ci = cycleInfo();
    if (mode === 'auto' && ci.extra && !askOk(`Du bist gerade in ${weekLabel(ci.week)}, also schon nach den geplanten Trainingswochen.\n\nMit „Automatisch“ beginnt jetzt die Deload-Woche. Fortfahren?`)) return;
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
  'ex-rename-open': el => {
    exRename = el.dataset.name; planSwap = null; render();
    const inp = document.getElementById('ren-name');
    if (inp) { inp.focus(); inp.select(); }
  },
  'ex-rename-cancel': () => { exRename = null; render(); },
  'ex-rename-ok': async () => {
    const from = exRename, to = renameCheck(from, document.getElementById('ren-name').value);
    if (to == null) return;
    if (to !== from.trim()) {
      const how = nameKey(to) === nameKey(from) ? 'all' : await askRename(from, to, 'form');
      if (!how || !renameExercise(from, to, false, how)) return;
    } else exRename = null;
    if (current.view === 'exercise') go('exercise', { ...current.params, name: to });
    else render();
  },
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
    if (!askOk('Dieses Training endgültig löschen?')) return;
    data.sessions = data.sessions.filter(s => s.id !== el.dataset.id);
    saveData(); toast('Training gelöscht');
    if (current.params.week) go('week', { key: current.params.week }); else go('history');
  },
  // Progression nur für dieses Training umschalten -> Vorschläge neu berechnen
  'prog-today': el => {
    const day = findDay(draft.dayId);
    if (!day) { alert('Der Trainingstag steht nicht mehr im Plan.'); return; }
    const changed = draft.entries.some(en => en.added || en.replacedFrom || en.sets.some(s => s.touched));
    if (changed && !askOk('Die Vorschläge werden neu berechnet. Schon eingetragene Werte, ersetzte und hinzugefügte Übungen gehen dabei verloren. Fortfahren?')) return;
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
  'install-later': () => { data.installSnooze = todayISO(); saveData(); render(); },
  'install-hide': () => { data.installHide = true; saveData(); render(); toast('Die Anleitung findest du weiter in den Optionen'); },
  'install-now': async () => {
    if (!installEvt) return;
    const e = installEvt;
    installEvt = null;
    try { e.prompt(); await e.userChoice; } catch (err) { /* abgebrochen */ }
    render();
  },
  'move-hint-no': () => { data.moveHintSeen = true; saveData(); render(); },
  'backup-pw-mode': el => { data.backupPw = el.dataset.v === '1'; if (!data.backupPw) backupPw = ''; saveData(); render(); },
  import: () => document.getElementById('import-file').click(),
  'reset-trainings': () => {
    if (!askOk(`Alle ${data.sessions.length} Trainings, Körpergewicht, Schritte und Ernährungseinträge löschen?\n\nDie Trainingstage mit ihren Übungen bleiben erhalten.`)) return;
    if (!askOk('Wirklich löschen? Das lässt sich nicht rückgängig machen.')) return;
    Object.assign(data, { sessions: [], bodyweight: [], steps: [], measures: [], intake: [], foodLog: [], foodClosed: {}, cardio: [], complaints: [], painLog: [], hintsDismissed: {}, cycleShift: {}, roundSkips: {} });
    // Max.-Werte stammen aus den gelöschten Trainings -> neu eintragen lassen
    data.plans.forEach(p => p.days.forEach(d => d.exercises.forEach(e => { e.max10 = null; })));
    setRound(todayISO(), 1, 1);
    saveData();
    draft = null; saveDraft();
    toast('Trainings gelöscht – Plan ist noch da');
    go('plan');
  },
  'reset-all': () => {
    if (!askOk('Wirklich ALLES löschen?\n\nPlan, Trainings, Körpergewicht, Schritte, Einstellungen sowie Fortschrittsfotos und Technik-Videos werden entfernt.')) return;
    if (!askOk('Letzte Nachfrage: Das lässt sich nicht rückgängig machen. Fortfahren?')) return;
    data = upgradeData(emptyData());
    if (typeof mediaWipe === 'function') mediaWipe();  // Fotos und Videos (v213)
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
  'compl-note': el => { if (complEdit) complEdit.note = el.value; },  // Beschwerde-Tagebuch (v209), gespeichert mit „Heute eintragen“
  'day-name': el => { findDay(current.params.id).name = el.value; saveData(); },
  'backup-pw': el => { backupPw = el.value.trim(); },  // nur im Arbeitsspeicher
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
    const dur = $view.querySelector('[data-voldur]');
    if (dur) dur.innerHTML = volDurText();
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
    const dur = $view.querySelector('[data-voldur]');
    if (dur) dur.innerHTML = volDurText();
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
    // vorhandene Übung: erst beim Verlassen übernehmen (Rückfrage beim Umbenennen, v219); neuer Platz: sofort
    if (!String(el.dataset.orig || '').trim()) { findDay(current.params.id).exercises[el.dataset.i].name = el.value; saveData(); }
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
    if (s.refW === undefined) s.refW = s.weight;  // Wert vor dem Eintippen: Maßstab für die Tippfehler-Frage
    s.weight = el.value;
    // Aufwärmen richtet sich nach dem ersten Arbeitssatz
    const en = draft.entries[el.dataset.ei];
    const warm = +el.dataset.si === 0 && $view.querySelector(`[data-warm="${el.dataset.ei}"]`);
    if (warm) { syncWarmup(en); warm.outerHTML = warmupBlock(en, +el.dataset.ei); }
    s.manualWeight = true;  // selbst gewähltes Gewicht -> nur noch Wdh. anpassen
    s.touched = true;
    recalcSets(+el.dataset.ei);
    techSubSync(+el.dataset.ei);  // Reduktions-Gewichte folgen dem Hauptsatz (v211)
    platesSync(+el.dataset.ei);
    saveDraft();
  },
  'tr-reps': el => {
    const s = draft.entries[el.dataset.ei].sets[el.dataset.si];
    if (s.refR === undefined) s.refR = s.reps;
    const was = isDone(s);
    s.reps = el.value;
    s.auto = false;  // selbst geändert -> nicht mehr automatisch überschreiben
    s.touched = true;
    if (!was && isDone(s)) restStart(+el.dataset.ei, +el.dataset.si);  // Satz gerade erledigt -> Pause (v202)
    recalcSets(+el.dataset.ei);
    platesSync(+el.dataset.ei);
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
    const was = isDone(s);
    s.rir = el.value;
    delete s.open;
    s.touched = true;
    if (!was && isDone(s)) restStart(+el.dataset.ei, +el.dataset.si);  // Satz gerade erledigt -> Pause (v202)
    recalcSets(+el.dataset.ei);
    platesSync(+el.dataset.ei);
    saveDraft();
  },
  // Teil-Sätze einer Intensitätstechnik (v211)
  'tr-sub-r': el => {
    const ei = +el.dataset.ei, si = +el.dataset.si, j = +el.dataset.j, sub = draft.entries[ei].sets[si].subs[j];
    const was = subDone(sub);
    sub.reps = el.value.replace(/[^0-9]/g, '');
    el.classList.toggle('done', subDone(sub));
    if (!was && subDone(sub)) { restStart(ei, si, j); if (!$trHead.hidden) $trHead.innerHTML = trHeadHtml(); }
    saveDraft();
  },
  'tr-sub-w': el => {
    const ei = +el.dataset.ei, si = +el.dataset.si, j = +el.dataset.j, en = draft.entries[ei], sub = en.sets[si].subs[j];
    sub.weight = el.value; sub.wTouched = parseNum(el.value) != null;
    techSubSync(ei);
    saveDraft();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  // Menü „⋯“ im Training schließt bei jedem Tipp außer auf „⋯“ selbst (v200)
  if (trMenuOpen && !(el && el.dataset.action === 'tr-menu')) { trMenuOpen = false; syncTrHead(); }
  if (el && actions[el.dataset.action]) {
    const keep = actionNow;
    actionNow = { name: el.dataset.action, el };
    try { actions[el.dataset.action](el); } finally { actionNow = keep; }
  }
});

/* ---------- Wischen ---------- */
// Training: eine Übung je Bildschirm, nach links wischen = nächste, nach rechts = vorige (zusätzlich zu Pfeilen und Punkten).
// Kalender (Verlauf, Cardio): nach links wischen = nächster Monat.
const trSwipeOn = () => !!(data.profile && data.profile.swipe);
const trCur = () => Math.min(Math.max(0, draft.cur || 0), Math.max(0, draft.entries.length - 1));
// Supersatz (v210): beide Übungen stehen auf einem Bildschirm – das Paar zählt beim Weiterwischen als eine Station
function trGo(d, abs = null) {
  const n = draft.entries.length, pairs = draftPairs(), now = trCur(), pn = pairs.get(now);
  const nowA = pn ? pn.i : now;
  let to = Math.min(n - 1, Math.max(0, abs != null ? abs : (pn ? (d > 0 ? pn.j : pn.i) : now) + d));
  if (pairs.get(to)) to = pairs.get(to).i;
  if (to === nowA) return;
  draft.slide = to > nowA ? 'l' : 'r';
  draft.cur = to;
  saveDraft(); render();
  draft.slide = null;
  const nav = $view.querySelector('.swipe-nav');
  if (nav) window.scrollTo(0, nav.getBoundingClientRect().top + window.scrollY - 70);
}
// Kopf: Pfeile, „Übung 2 von 7“, Punkte (✓ = alle Sätze erledigt)
function swipeNavHtml(cur) {
  const n = draft.entries.length, p = draftPairs().get(cur);
  const a = p ? p.i : cur, b = p ? p.j : cur;  // Supersatz: beide Übungen auf einem Bildschirm
  const dots = draft.entries.map((en, i) => `<button class="swipe-dot ${i >= a && i <= b ? 'now' : ''} ${en.sets.length && en.sets.every(isDone) ? 'done' : ''}"
    data-action="tr-go-to" data-i="${i}" aria-label="Übung ${i + 1}: ${esc(en.name)}"></button>`).join('');
  return `<div class="swipe-nav">
    <button class="icon-btn" data-action="tr-go" data-d="-1" ${a === 0 ? 'disabled' : ''} aria-label="Vorige Übung">‹</button>
    <div><b>${p ? `Übung ${a + 1} + ${b + 1}` : `Übung ${cur + 1}`} von ${n}</b><div class="swipe-dots">${dots}</div></div>
    <button class="icon-btn" data-action="tr-go" data-d="1" ${b >= n - 1 ? 'disabled' : ''} aria-label="Nächste Übung">›</button>
  </div>${data.profile && data.profile.swipeKnown ? '' : '<p class="hint swipe-hint">Wischen: nach links = nächste Übung, nach rechts = vorige</p>'}`;
}
function swipeNextHtml(ei) {
  const n = draft.entries.length;
  return ei < n - 1
    ? `<button class="btn primary swipe-next" data-action="tr-go" data-d="1">Nächste Übung: ${esc(draft.entries[ei + 1].name)} ›</button>`
    : '<button class="btn swipe-next" data-action="tr-to-save">Letzte Übung – zum Speichern ↓</button>';
}
let swipeStart = null;
document.addEventListener('touchstart', e => {
  const t = e.touches[0];
  swipeStart = e.touches.length === 1 ? { x: t.clientX, y: t.clientY, el: e.target, time: Date.now() } : null;
}, { passive: true });
document.addEventListener('touchend', e => {
  const st = swipeStart;
  swipeStart = null;
  if (!st) return;
  const t = e.changedTouches[0], dx = t.clientX - st.x, dy = t.clientY - st.y;
  if (Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy) || Date.now() - st.time > 900) return;
  const dir = dx < 0 ? 1 : -1;  // nach links wischen = weiter
  const el = st.el && st.el.closest ? st.el : null;
  // Einführung: nach links = nächster Schritt
  const tourEl = document.getElementById('tour');
  if (tourEl) { if (dir > 0) { const b = tourEl.querySelector('[data-tour="next"]'); if (b) b.click(); } return; }
  if (document.querySelector('.welcome')) return;
  // nicht in seitlich scrollbaren Bereichen (Tabellen, Auswahlleisten), Textfeldern und Diagrammen
  if (el && el.closest('.table-wrap, .quick-picks, textarea, #chart-area, .chart-area')) return;
  const click = sel => { const b = $view.querySelector(sel); if (b && !b.disabled) { b.click(); return true; } return false; };
  const cal = el && el.closest('.cal');
  if (cal) {
    const b = cal.querySelector(`[data-action="cal-nav"][data-d="${dir}"]`);
    if (b && !b.disabled) b.click();
    return;
  }
  swipeView(dir, click);
}, { passive: true });

// Wischen je Fenster: nach links = weiter (nächste Übung, nächster Tag …), nach rechts = zurück
function swipeView(dir, click) {
  const v = current.view, p = current.params;
  if (v === 'training') {
    if (draft && !draft.reorder && trSwipeOn()) {
      // einmal gewischt = verstanden: der Hinweis „Wischen: nach links …“ verschwindet (User-Wunsch 2026-11-09)
      if (data.profile && !data.profile.swipeKnown) { data.profile.swipeKnown = true; saveData(); }
      trGo(dir);
    }
    return;
  }
  if (v === 'food') { click(`[data-action="food-day"][data-d="${dir}"]`); return; }
  if (v === 'week') { click(`[data-action="week-shift"][data-dir="${dir}"]`); return; }
  if (v === 'session' && !p.edit && !p.week) {
    // gespeicherte Trainings nach Datum: nach links = nächstes (neueres), nach rechts = voriges
    const list = [...data.sessions].sort((a, b) => a.date.localeCompare(b.date));
    const to = list[list.findIndex(x => x.id === p.id) + dir];
    if (to) go('session', { id: to.id }); else toast(dir > 0 ? 'Das ist das neueste Training' : 'Das ist das älteste Training');
    return;
  }
  if (v === 'day') {
    const i = data.days.findIndex(d => d.id === p.id), to = data.days[i + dir];
    if (i >= 0 && to) go('day', { id: to.id });
    return;
  }
  // Verlauf (v203): zwischen Kalender, Übungen, Statistik und Erfolge wischen
  if (v === 'charts' || v === 'history') {
    const tabs = [...$view.querySelectorAll('.hist-seg [data-action="hist-sec"]')];
    const i = tabs.findIndex(b => b.classList.contains('on')), to = tabs[i + dir];
    if (to) to.click();
    return;
  }
  if (v === 'wizard') {
    if (dir < 0) { if (!$back.hidden) $back.click(); return; }
    const next = [...$view.querySelectorAll('.row .btn.primary[data-action="wiz-step"], .row .btn.primary[data-action="wiz-pday"]')].pop();  // Vorschau: nächster Tag
    if (next && !next.disabled) next.click();
  }
}

document.addEventListener('input', e => {
  const el = e.target.closest('[data-field]');
  if (el && fields[el.dataset.field]) fields[el.dataset.field](el);
});

document.addEventListener('change', e => {
  if (e.target.dataset && e.target.dataset.field === 'ex-name') { exNameCommit(e.target); return; }  // v219
  // Auswahllisten: manche Safari-Versionen melden nur „change“, nicht „input“
  if (e.target.matches('select[data-field]') && fields[e.target.dataset.field]) {
    fields[e.target.dataset.field](e.target);
    return;
  }
  if (e.target.dataset && e.target.dataset.field === 'tr-max') { applyTrainingMax(e.target); return; }
  if (e.target.dataset && (e.target.dataset.field === 'tr-weight' || e.target.dataset.field === 'tr-reps') && draft) {
    const { ei, si } = e.target.dataset, box = $view.querySelector(`[data-typo="${ei}-${si}"]`);
    if (box) box.innerHTML = typoHtml(draft.entries[ei], ei, si);
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
/* App-Symbol in der Farbwelt (v220, User 2026-11-12): Das Handy übernimmt Symbol und Manifest beim Hinzufügen zum
   Home-Bildschirm – deshalb zeigen die Verweise immer auf die gerade gewählte Farbwelt (Ordner icons/). Später ändert sich
   das Symbol auf dem Home-Bildschirm nicht mehr mit (das erlauben iPhone und Android nicht). */
function iconSync() {
  const k = PROFILE_COLORS[profileColor()] ? profileColor() : 'blue';
  const set = (sel, href) => { const el = document.querySelector(sel); if (el && el.getAttribute('href') !== href) el.setAttribute('href', href); };
  set('link[rel="manifest"]', `icons/manifest${IS_BETA ? '-beta' : ''}-${k}.json`);
  set('link[rel="apple-touch-icon"]', `icons/apple-touch-icon-${k}.png`);
  set('link[rel="icon"]', `icons/icon-${k}-192.png`);
}

function applyTheme() {
  const root = document.documentElement;
  root.dataset.accent = profileColor();
  const mode = (data.profile && data.profile.theme) || '';
  if (mode) root.dataset.theme = mode; else delete root.dataset.theme;
  const size = data.profile && data.profile.size;  // Textgröße (v207): '' | 'l' | 'xl'
  if (size === 'l' || size === 'xl') root.dataset.size = size; else delete root.dataset.size;
  plainSync();
  iconSync();
  // Statusleiste des Handys in der Hintergrundfarbe der Farbwelt einfärben
  const [light, dark] = plainOn() ? ['#f4f4f5', '#0e0e10'] : PROFILE_COLORS[profileColor()].bg;  // Schlicht: neutral
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => {
    const isDark = /dark/.test(m.getAttribute('media') || '');
    m.setAttribute('content', mode === 'dark' ? dark : mode === 'light' ? light : isDark ? dark : light);
  });
}

/* ---------- Stil „Schlicht“ (User-Wunsch 2026-11-10): keine Emojis, ruhiges, flaches Design ---------- */
// Die Texte im Code bleiben, wie sie sind: Ein Beobachter entfernt beim Anzeigen alle bunten Emojis aus Seiten,
// Mitteilungen und Rückfragen. Einfache Zeichen (✔ ✕ ✎ ↑ ↓ ★ …) bleiben – mit U+FE0E immer einfarbig.
// Behälter, die danach leer sind (z. B. das große Symbol über einer Frage), werden ausgeblendet (.plain-empty).
const plainOn = () => !!(data.profile && data.profile.look === 'plain');
// Schlicht (v219): Tagesnummern zweistellig wie „01“
const dayNoText = i => plainOn() ? String(i + 1).padStart(2, '0') : i + 1;
const PLAIN_KEEP = new Set([...'✔✓✕✎★☆↑↓⇅⇄↔↕⬆⬇▶◀‹›→←↘↗↩−+']);  // ↘ = Reduktions-Teil-Satz (v212)
const PLAIN_MAP = { '🗑': '✕', '⏳': '–', '⏭': '–' };  // Symbole, die allein in Knöpfen/Kästchen stehen
const PLAIN_RE = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})[︎️]?\p{Emoji_Modifier}?(?:‍\p{Extended_Pictographic}[︎️]?\p{Emoji_Modifier}?)*( ?)|️|⃣/gu;
function plainStrip(s) {
  if (!s) return s;
  return s.replace(PLAIN_RE, (m, sp = '') => {
    const base = String.fromCodePoint(m.codePointAt(0));
    if (PLAIN_MAP[base]) return PLAIN_MAP[base] + sp;
    if (PLAIN_KEEP.has(base)) return base + '︎' + sp;
    return '';
  });
}
function plainNode(root) {
  const fix = t => {
    const v = plainStrip(t.nodeValue);
    if (v === t.nodeValue) return;
    t.nodeValue = v;
    const p = t.parentElement;
    if (p && !p.matches('button, input, textarea, select, option') && !p.textContent.trim() && !p.querySelector('svg, img, canvas, input, select, textarea')) {
      p.classList.add('plain-empty');
    }
  };
  if (root.nodeType === 3) { fix(root); return; }
  if (root.nodeType !== 1) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let t = w.nextNode(); t; t = w.nextNode()) fix(t);
  root.querySelectorAll && root.querySelectorAll('[placeholder]').forEach(el => {
    const v = plainStrip(el.getAttribute('placeholder'));
    if (v !== el.getAttribute('placeholder')) el.setAttribute('placeholder', v);
  });
}
let plainObs = null;
function plainSync() {
  const on = plainOn();
  if (on) document.documentElement.dataset.look = 'plain'; else delete document.documentElement.dataset.look;
  if (on && !plainObs && typeof MutationObserver === 'function') {
    plainObs = new MutationObserver(list => {
      for (const m of list) {
        if (m.type === 'characterData') plainNode(m.target);
        else m.addedNodes.forEach(plainNode);
      }
    });
    plainObs.observe(document.body, { childList: true, subtree: true, characterData: true });
    plainNode(document.body);
  } else if (!on && plainObs) {
    plainObs.disconnect();
    plainObs = null;
    document.querySelectorAll('.plain-empty').forEach(el => el.classList.remove('plain-empty'));
  }
}
// Rückfragen und Hinweise des Browsers ebenfalls ohne Emojis
for (const k of ['alert', 'confirm', 'prompt']) {
  const orig = window[k];
  if (typeof orig === 'function') window[k] = function (msg, ...rest) { return orig.call(window, plainOn() ? plainStrip(String(msg)) : msg, ...rest); };
}
const LOOKS = { '': 'Standard', plain: 'Schlicht' };

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
      <p class="hint explain">Blau und Beere haben einen neutralen grauen Hintergrund, alle anderen Farbwelten färben auch den Hintergrund ein.
        „Automatisch“ folgt der Einstellung deines Handys (hell/dunkel),
        „Hell“ und „Dunkel“ gelten immer – jede Farbwelt gibt es in beiden Varianten.</p>
      <p class="lbl">Textgröße</p>
      <div class="seg three size-seg">${Object.entries(SIZES).map(([k, l]) =>
        `<button class="${((p.size || '') === k) ? 'on' : ''}" data-action="profile-size" data-k="${k}">${l}</button>`).join('')}</div>
      <p class="hint">Macht Schrift, Felder und Knöpfe auf allen Seiten größer – gut lesbar auch ohne Brille.</p>
      <p class="lbl">Stil</p>
      <div class="seg two">${Object.entries(LOOKS).map(([k, l]) =>
        `<button class="${((p.look || '') === k) ? 'on' : ''}" data-action="profile-look" data-k="${k}">${l}</button>`).join('')}</div>
      <p class="hint explain">„Standard“: mit Symbolen, Farben und Farbverläufen. „Schlicht“: ohne Emojis, ganz in Schwarz, Weiß und Grau,
        flache Flächen und feine Linien – nur die Überschriften haben die Farbe deiner Farbwelt.</p>
      <p class="lbl">Übungen im Training</p>
      <div class="seg two tr-viewmode"><button class="${trSwipeOn() ? '' : 'on'}" data-action="tr-swipe" data-v="0">↕ Untereinander</button>
        <button class="${trSwipeOn() ? 'on' : ''}" data-action="tr-swipe" data-v="1">↔ Wischen</button></div>
      <p class="hint explain">„Untereinander“: alle Übungen auf einer Seite zum Scrollen. „Wischen“: eine Übung je Bildschirm – nach links wischen
        für die nächste Übung, nach rechts für die vorige.</p>
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
      <p class="hint explain">Das Geschlecht bestimmt, welcher Klassiker im Plan-Assistenten angeboten wird (Diskopumper oder Booty-Plan),
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
  if (welc.fresh && welc.step === 1) { welc.step = 0; welc.slide = 0; }  // v213: neue Nutzer sehen zuerst, was die App besonders macht
  const el = document.createElement('div');
  el.className = 'welcome';
  el.innerHTML = `<div class="welcome-card" role="dialog" aria-modal="true" aria-labelledby="welcome-title">${welcomeHtml()}</div>`;
  // Wischen auf den Startseiten: links = weiter, rechts = zurück
  let sx = null, sy = null;
  el.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  el.addEventListener('touchend', e => {
    if (sx == null || !welc || welc.step !== 0) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) actions['intro-next'](); else if (welc.slide > 0) { welc.slide--; welcomeRedraw(); }
  }, { passive: true });
  document.body.appendChild(el);
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
}

// Startseiten für neue Nutzer (v213, „Startseite A“): drei Bilder mit je einem Satz, was die App besonders macht
const INTRO = [
  { img: 'intro-1.jpg', h: 'Weniger rätseln, mehr trainieren',
    p: 'Für jeden Satz sagt dir die App, welches <b>Gewicht</b> und wie viele <b>Wiederholungen</b> – passend zu deiner Kraft. Nach jedem Training lernt sie dazu.' },
  { img: 'intro-2.jpg', h: 'Ein Plan, der mitwächst',
    p: 'Woche für Woche ein bisschen mehr, dann eine leichtere Woche zur Erholung. Deinen Plan erstellt der Assistent in wenigen Minuten – fürs Studio oder zu Hause.' },
  { img: 'intro-3.jpg', h: 'Fortschritt, den du siehst',
    p: 'Bestleistungen, Kraftverlauf und ein Rückblick nach jedem Zyklus zeigen dir, dass es wirkt. <b>Ohne Konto, ohne Werbung</b> – alles bleibt auf deinem Handy.' },
];
function introHtml() {
  const i = welc.slide || 0, s = INTRO[i], last = i === INTRO.length - 1;
  return `<div class="intro">
      <div class="intro-shot"><img src="${s.img}" alt="Beispiel aus der App"></div>
      <h2 id="welcome-title">${s.h}</h2>
      <p>${s.p}</p>
      <div class="intro-dots" aria-hidden="true">${INTRO.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
      <div class="row intro-btns">${last ? '' : '<button class="btn" data-action="intro-skip">Überspringen</button>'}
        <button class="btn primary" data-action="intro-next">${last ? "Los geht's" : 'Weiter ›'}</button></div>
      <button class="link-btn intro-import" data-action="welcome-import">📥 Ich habe schon eine Sicherung</button>
      ${IS_BETA ? '<button class="link-btn intro-import" data-action="beta-testdata">🧪 Testdaten laden (Beta)</button>' : ''}
    </div>`;
}

// App-Symbol (v219): Handy mit Hantel und steigender Verlaufskurve – weiß, Hantel und Kurve in der Akzentfarbe
function appLogoSvg() {
  const db = '<g transform="translate(50 33) scale(1.05)"><rect x="-8" y="-1.7" width="16" height="3.4" rx="1"/><rect x="-9.5" y="-7" width="4" height="14" rx="1.3"/>'
    + '<rect x="5.5" y="-7" width="4" height="14" rx="1.3"/><rect x="-12.5" y="-4.5" width="2.6" height="9" rx="1"/><rect x="9.9" y="-4.5" width="2.6" height="9" rx="1"/></g>';
  return `<svg class="app-logo" viewBox="0 0 100 100"><rect class="al-phone" x="28" y="12" width="44" height="76" rx="10"/>
    <g class="al-ink"><rect x="44" y="17.5" width="12" height="3" rx="1.5" opacity=".35"/>${db}
    <circle cx="36" cy="74" r="3.5"/><circle cx="45" cy="64" r="3.5"/><circle cx="53" cy="68" r="3.5"/><circle cx="64" cy="52" r="4.5"/></g>
    <path class="al-line" d="M36 74L45 64L53 68L64 52"/></svg>`;
}

function welcomeHtml() {
  if (welc.step === 0) return introHtml();
  const icon = `<div class="welcome-icon" aria-hidden="true">${appLogoSvg()}</div>`;
  const two = welcomeNeedsPhase();  // gibt es einen zweiten Schritt?
  const dots = (welc.step === 1 ? two : welcomeNeedsProfile() || welc.fresh)
    ? `<p class="welcome-step">Schritt ${welc.step} von 2</p>` : '';
  if (welc.step === 1) {
    return `${icon}${dots}
      ${welc.fresh ? `<h2 id="welcome-title">Willkommen bei ${APP_NAME}</h2>
      <ul class="welcome-why">
        <li>Für jeden Satz sagt dir die App <b>Gewicht und Wiederholungen</b> – passend zu deiner Kraft.</li>
        <li>Sie <b>lernt aus jedem Training</b> und steigert dich Schritt für Schritt, mit Erholungswochen zur richtigen Zeit.</li>
        <li>Dein <b>Plan in wenigen Minuten</b> – fürs Studio, an Maschinen oder zu Hause. Oder du übernimmst deinen eigenen.</li>
        <li>Auf Wunsch auch <b>Ernährung</b>: Kalorienziel, Tagebuch und Barcode-Scanner.</li>
        <li><b>Ohne Konto, ohne Werbung</b> – deine Daten bleiben auf deinem Handy.</li>
      </ul>
      <details class="welcome-health"><summary>⚕️ Wichtig: Gesundheitshinweis</summary>${typeof healthListHtml === 'function' ? healthListHtml() : ''}</details>`
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
            Einstellungen du siehst. Du kannst ihn jederzeit in den Optionen ändern.</p>
          <p class="lbl">Wie möchtest du motiviert werden?</p>
          <div class="seg three" id="welcome-motiv">${Object.entries(MOTIV_OPTS).map(([k, [, l]]) =>
            `<button class="${(welc.motiv || 'soft') === k ? 'on' : ''}" data-action="welcome-motiv" data-m="${k}">${l}</button>`).join('')}</div>
          <p class="hint welcome-note">Freundlich: mit Lob, ohne Druck. Fordernd: klare Ansagen, die dich antreiben. Gar nicht: keine solchen Hinweise.</p>` : ''}
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

actions['intro-next'] = () => {
  if (!welc) return;
  if ((welc.slide || 0) < INTRO.length - 1) { welc.slide = (welc.slide || 0) + 1; welcomeRedraw(); return; }
  actions['intro-skip']();
};
actions['intro-skip'] = () => {
  if (!welc) return;
  welc.step = 1;
  welcomeRedraw();
  const card = document.querySelector('.welcome-card');
  if (card) card.scrollTop = 0;
};

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
    ...(welc.fresh ? { motiv: welc.motiv || 'soft' } : {}),
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
actions['profile-look'] = el => {
  data.profile = { ...(data.profile || {}), look: el.dataset.k || null };
  saveData(); applyTheme(); render();
};
actions['profile-color'] = el => {
  data.profile = { ...(data.profile || {}), color: el.dataset.k, colorHint: true };
  saveData(); applyTheme(); render();
};
actions['color-hint'] = el => {
  data.profile = { ...(data.profile || {}), colorHint: true };
  saveData();
  if (el.dataset.go) go('opt', { sec: 'look' }); else render();
};
actions['opt-open'] = el => go('opt', { sec: el.dataset.sec });

// Intensitätstechniken (v211)
actions['plan-tech'] = el => {
  const ex = findDay(current.params.id).exercises[+el.dataset.i], k = el.dataset.v;
  if (!k) delete ex.tech;
  else ex.tech = { k, at: (ex.tech && ex.tech.at) || 'last', n: ex.tech && ex.tech.k === k ? ex.tech.n : TECH_DEF_N[k] };
  saveData(); render();
};
actions['plan-tech-at'] = el => { const ex = findDay(current.params.id).exercises[+el.dataset.i]; ex.tech.at = el.dataset.v; saveData(); render(); };
actions['plan-tech-n'] = el => { const ex = findDay(current.params.id).exercises[+el.dataset.i]; ex.tech.n = +el.dataset.v; saveData(); render(); };
actions['sub-add'] = el => {
  const s = draft.entries[+el.dataset.ei].sets[+el.dataset.si];
  s.subs.push({ weight: '', reps: '', goal: variantOf(s) === 'myo' ? String(MYO_MIN) : '' });
  saveDraft(); render();
};
actions['sub-del'] = el => {
  const s = draft.entries[+el.dataset.ei].sets[+el.dataset.si];
  s.subs.splice(+el.dataset.j, 1);
  saveDraft(); render();
};

// Supersätze (v210)
actions['ss-pick-open'] = el => { planSwap = null; exRename = null; ssPick = { day: current.params.id, i: +el.dataset.i }; render(); };
actions['ss-pick-cancel'] = () => { ssPick = null; render(); };
actions['ss-pair'] = el => {
  const day = findDay(current.params.id), a = day.exercises[+el.dataset.i], b = day.exercises[+el.dataset.j];
  ssCouple(day, +el.dataset.i, +el.dataset.j);
  ssPick = null;
  saveData(); render();
  toast(`🔗 Supersatz: ${a.name.trim()} + ${b.name.trim()}`);
};
actions['ss-unpair'] = el => {
  const day = findDay(current.params.id);
  for (const x of day.exercises.slice(+el.dataset.i, +el.dataset.i + 2)) { delete x.ss; delete x.ssRest; }
  saveData(); render();
  toast('Supersatz gelöst – die Übungen laufen wieder einzeln');
};
actions['ss-auto'] = () => {
  const day = findDay(current.params.id), pv = ssAutoPreview(day);
  if (!pv) return;
  if (!askOk(`Diese Übungen als Supersatz koppeln?\n\n${pv.pairs.map(([a, b]) => `• ${a} + ${b}`).join('\n')}\n\nSpart ca. ${pv.save} min pro Training. `
    + 'Die zweite Übung rückt jeweils direkt hinter die erste. Jedes Paar lässt sich jederzeit wieder lösen.')) return;
  day.exercises = pv.list;
  day.ssRuns = 0; day.ssAsked = false;
  saveData(); render();
  toast(`🔗 ${pv.pairs.length} Supersatz-Paar${pv.pairs.length === 1 ? '' : 'e'} angelegt`);
};
actions['ss-solo'] = el => {
  const en = draft.entries[+el.dataset.ei];
  draft.ssSolo = [...(draft.ssSolo || []), en.ss];
  saveDraft(); render();
  toast('Heute einzeln – normale Pausen, der Plan bleibt');
};
actions['ss-unsolo'] = el => {
  const en = draft.entries[+el.dataset.ei];
  draft.ssSolo = (draft.ssSolo || []).filter(k => k !== en.ss);
  saveDraft(); render();
};
actions['ss-check'] = el => {
  const day = findDay(el.dataset.day), v = el.dataset.v;
  if (!day) return;
  if (v === 'longer') {
    dayPairs(day.exercises, true).forEach(p => {
      if (p.role !== 'A') return;
      const r = p.rest + (p.rest < SS_REST ? 0.5 : 1);  // 90 s → 2 min, 2 min → 3 min
      day.exercises[p.i].ssRest = day.exercises[p.j].ssRest = r;
    });
  }
  if (v === 'solo') day.exercises.forEach(x => { delete x.ss; delete x.ssRest; });
  day.ssAsked = true;
  saveData(); render();
  toast(v === 'ok' ? 'Danke – die Supersätze bleiben, wie sie sind' : v === 'longer' ? 'Pausen im Supersatz verlängert'
    : 'Supersätze gelöst – die Übungen laufen wieder einzeln');
};
// Beschwerden-Verlauf (v208)
actions['compl-open'] = el => { complEdit = null; go('complaints', { from: el.dataset.from || current.view }); };
actions['compl-pick'] = el => {
  const k = el.dataset.k, E = complEdit;
  if (E.areas.has(k)) { E.areas.delete(k); delete E.pain[k]; delete E.side[k]; }
  else { E.areas.add(k); if (!E.side[k] && areaSided(k)) { const s = lastSideOf(k); if (s) E.side[k] = s; } }
  render();
};
actions['compl-pain'] = el => { const k = el.dataset.k, v = +el.dataset.v; if (complEdit.pain[k] === v) delete complEdit.pain[k]; else complEdit.pain[k] = v; render(); };
actions['compl-side'] = el => { const k = el.dataset.k, v = el.dataset.v; if (complEdit.side[k] === v) delete complEdit.side[k]; else complEdit.side[k] = v; render(); };
// höchstens ein Eintrag je Tag: ein zweites Speichern am selben Tag ersetzt den Eintrag von heute
actions['compl-save'] = () => {
  const E = complEdit, areas = Object.keys(BODY_AREAS).filter(k => E.areas.has(k));
  const entry = { cycleStart: cycleInfo().cycleStart, date: new Date().toISOString(), areas };
  const pain = {}, side = {};
  for (const k of areas) { if (E.pain[k] != null) pain[k] = E.pain[k]; if (E.side[k] && areaSided(k)) side[k] = E.side[k]; }
  if (Object.keys(pain).length) entry.pain = pain;
  if (Object.keys(side).length) entry.side = side;
  if ((E.note || '').trim()) entry.note = E.note.trim();
  const last = data.complaints[data.complaints.length - 1];
  if (last && last.cycleStart === entry.cycleStart && localDay(last.date) === localDay(entry.date)) data.complaints[data.complaints.length - 1] = entry;
  else data.complaints.push(entry);
  saveData();
  complEdit = null;
  toast('Eingetragen ✔ – die Hinweise im Training sind angepasst');
  render();
};
actions['compl-report'] = () => go('complreport', { from: current.params.from, weeks: 8 });
actions['crep-weeks'] = el => go('complreport', { ...current.params, weeks: +el.dataset.w });
actions['crep-send'] = async () => {
  if (!shareFile) return;
  if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
    try { await navigator.share({ files: [shareFile], title: 'Beschwerde-Bericht' }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  shareSave();
};
actions['crep-text'] = async () => {
  const text = complReportText(complReportData(current.params.weeks || 8));
  if (navigator.share) {
    try { await navigator.share({ title: 'Beschwerde-Bericht', text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Bericht kopiert ✔ – z. B. in eine Mail einfügen'); }
  catch (e) { uiCopy(text); }
};
actions['pain-pt'] = el => {
  const cap = el.closest('.compl-area') && el.closest('.compl-area').querySelector('.ps-cap');
  if (cap) { cap.textContent = el.dataset.t; cap.hidden = false; }
};
actions['pain-del'] = el => {
  if (!askOk('Diesen Eintrag löschen?')) return;
  data.painLog = data.painLog.filter(z => z.id !== el.dataset.id);
  saveData(); render();
};
// „Zwickt“ im Training (v209)
actions['pain-open'] = el => {
  const ei = +el.dataset.ei, name = draft.entries[ei].name, cur = currentComplaints() || [];
  const area = cur.find(a => areaHits(a, name)) || Object.keys(BODY_AREAS).find(a => areaHits(a, name)) || null;
  painQuick = { ei, area, pain: null, side: area && areaSided(area) ? lastSideOf(area) : null };
  render();
};
actions['pain-area'] = el => {
  const k = el.dataset.k;
  painQuick.area = painQuick.area === k ? null : k;
  painQuick.side = painQuick.area && areaSided(painQuick.area) ? lastSideOf(painQuick.area) : null;
  render();
};
actions['pain-side'] = el => { painQuick.side = painQuick.side === el.dataset.v ? null : el.dataset.v; render(); };
actions['pain-val'] = el => { const v = +el.dataset.v; painQuick.pain = painQuick.pain === v ? null : v; render(); };
actions['pain-cancel'] = () => { painQuick = null; render(); };
actions['pain-save'] = () => {
  const q = painQuick;
  if (!q || !q.area || !draft) return;
  const z = { id: uid(), date: new Date().toISOString(), ex: draft.entries[q.ei].name, area: q.area, pain: q.pain };
  if (q.side && areaSided(q.area)) z.side = q.side;
  data.painLog.push(z);
  saveData();
  painQuick = null;
  toast('Notiert ✔ – steht in deinem Beschwerde-Tagebuch');
  render();
};
// Erklärtexte (v209)
actions['explain-show'] = el => {
  const p = el.nextElementSibling;
  if (p && p.classList.contains('explain')) { p.classList.remove('folded'); explainOpen.add(explainId(p)); }
  el.remove();
};
actions['explain-mode'] = el => {
  data.profile = { ...(data.profile || {}), explainKeep: el.dataset.v === '1' };
  saveData(); render();
};
// Motivation (v208)
actions['motiv-set'] = el => {
  data.profile = { ...(data.profile || {}), motiv: el.dataset.m };
  saveData(); render();
  if (current.view === 'start') toast(`Motivation: ${MOTIV_OPTS[el.dataset.m][1]} – änderbar unter Optionen → Training`);
};
actions['motiv-hide'] = el => { data.profile = { ...(data.profile || {}), motivHide: el.dataset.k }; saveData(); render(); };
actions['welcome-motiv'] = el => {
  welc.motiv = el.dataset.m;
  el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
};
// Textgröße (v207): vergrößert den Inhalt (#view), Kopf- und Fußleiste bleiben gleich
actions['profile-size'] = el => {
  data.profile = { ...(data.profile || {}), size: el.dataset.k || null };
  saveData(); applyTheme(); render();
};
fields['profile-name'] = el => {
  data.profile = { ...(data.profile || {}), name: el.value.trim() };
  saveData();
};

/* ---------- Start ---------- */

// Einmalig beim Umstieg auf die Vorermüdung (v179): „Max. bei 10 Wdh.“ war bisher so gemessen, wie die Übung im Training
// stand – jetzt ist es der Frisch-Wert. Daher mit der Vorermüdung des Trainings hochrechnen, aus dem der Wert stammt
// (neuestes Training dieser Übung mit Ergebnis). data.prefatV = schon umgerechnet (auch in Sicherungen).
function prefatMigrate() {
  if (data.prefatV) return;
  const done = new Map();
  for (const p of data.plans || []) {
    if (p.own) continue;
    for (const d of p.days || []) for (const ex of d.exercises || []) {
      if (ex.max10 == null || !ex.name.trim()) continue;
      const k = nameKey(ex.name);
      if (!done.has(k)) {
        let f = 0;
        for (const ses of sessionsNewestFirst()) {
          const i = ses.entries.findIndex(e => nameKey(e.name) === k && e.result);
          if (i >= 0) { f = sessionFat(ses, i); break; }
        }
        done.set(k, f);
      }
      const f = done.get(k);
      if (f > 0) ex.max10 = Math.round(ex.max10 / (1 - f) * 10) / 10;
    }
  }
  data.prefatV = 1;
  saveData();
}

// Erst zeichnen, wenn alle Skripte geladen sind (die Startseite nutzt z. B. nutrition.js) –
// sonst bleibt die Seite beim Öffnen leer, bis man einen Reiter antippt.
/* ---------- Neue Übung direkt aus einem Ersetzen-Menü (v218, User 2026-11-12) ----------
   Training (ctx tr), Trainingstag (plan) und Assistent (wiz): Formular „Eigene Übung“ mit Muskelgruppe, Art und Figur der
   Übung, die ersetzt werden soll; nach dem Speichern zurück und gleich tauschen. */
let swapReturn = null;
actions['swap-new'] = el => {
  const ctx = el.dataset.ctx;
  let ex = null;
  if (ctx === 'tr' && draft) { const n = draft.entries[el.dataset.ei].name; ex = planExercise(n) || { name: n }; }
  else if (ctx === 'plan') ex = findDay(current.params.id).exercises[Number(el.dataset.i)] || null;
  else if (ctx === 'wiz' && wiz && wiz.swapOpen) ex = { name: wiz.swapOpen.n };
  const base = ex && ex.name && ex.name.trim() ? ex : null;
  const panel = el.closest('.replace'), typed = panel && panel.querySelector('input[type="text"]');
  const tv = typed ? typed.value.trim() : '';
  swapReturn = { ctx, view: current.view, params: { ...current.params }, ei: el.dataset.ei, i: el.dataset.i };
  libForm = { name: tv && !builtinExercise(tv) && !customExercise(tv) ? tv : '', kind: base ? kindOf(base) : 'normal',
    group: base ? groupOf(base) || '' : '', like: base && builtinExercise(base.name) ? base.name : '', note: '', orig: null };
  go('libadd', { ret: 1 });
};
function swapNewFinish(name) {
  const r = swapReturn;
  swapReturn = null;
  go(r.view, r.params);
  if (r.ctx === 'tr' && draft && draft.entries[r.ei]) {
    const en = draft.entries[r.ei];
    if (en.sets.some(s => s.touched) && !askOk('Bereits eingetragene Sätze dieser Übung gehen verloren. Trotzdem ersetzen?')) return;
    replaceExercise(en, name, null);
    en.replacing = false;
    refreshPrefat();
    saveDraft(); render();
    toast(`Ersetzt durch ${name}`);
  } else if (r.ctx === 'plan') {
    if (planReplaceExercise(findDay(r.params.id), Number(r.i), name)) { render(); toast(`Ersetzt durch ${name}`); }
  } else if (r.ctx === 'wiz' && wiz && wiz.swapOpen) wizSwap(name);
}

/* ---------- Beta und Umzug (v217) ---------- */
// Beta: Schild in der Kopfzeile, eigener Name unter dem Symbol (manifest-beta.json), Titel
function channelInit() {
  if (!IS_BETA) return;
  document.documentElement.classList.add('beta');
  document.title = APP_NAME + ' Beta';
  const m = document.querySelector('link[rel="manifest"]');
  if (m) m.href = 'manifest-beta.json';
  try { iconSync(); } catch (e) { /* Daten noch nicht geladen – applyTheme holt es nach */ }
  const a = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if (a) a.content = 'Gains Beta';
  const hd = document.querySelector('header');
  if (hd && !hd.querySelector('.beta-badge')) hd.insertAdjacentHTML('beforeend', '<span class="beta-badge" aria-label="Beta-Version">BETA</span>');
}
function betaCard() {
  if (!IS_BETA) return '';
  return `<div class="card beta-card"><p><b>🧪 Beta-Version ${APP_V}</b> – hier testest du Neues, bevor alle es bekommen. Deine Daten hier sind
      getrennt von der normalen App.</p>
    <button class="btn" data-action="beta-feedback">💬 Rückmeldung geben</button>
    <button class="btn" data-action="beta-testdata">🧪 Testdaten laden<small>Max, 6 Monate Training und Ernährung (Mai bis Nov. 2026) – ersetzt die Daten der Beta</small></button></div>`;
}
// Beta (v223, User 2026-11-13): simulierte Testperson aus testdaten-max.json laden – läuft wie „Sicherung laden“ (mit Rückfrage)
actions['beta-testdata'] = async () => {
  if (!IS_BETA) return;
  try {
    const res = await fetch('testdaten-max.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    importData(new File([await res.text()], 'testdaten-max.json', { type: 'application/json' }));
  } catch (e) { alert('Die Testdaten konnten nicht geladen werden – bitte mit Internetverbindung noch einmal versuchen.'); }
};
// Alte Adresse (stepup-strength.github.io): Daten ziehen nicht von selbst mit (jede Adresse hat ihren eigenen Speicher)
function moveCard() {
  if (!OLD_HOST) return '';
  const host = NEW_URL.replace('https://', '').replace(/\/$/, '');
  return `<div class="card move-card"><h2>📦 Die App zieht um</h2>
    <p>Sie heißt jetzt <b>${APP_NAME}</b> und hat eine neue Adresse. Deine Daten nimmst du einmal mit – so geht's:</p>
    <ol><li><b>Sicherung erstellen</b> – speichert alle Trainings, Pläne und Einträge als Datei.
        <button class="btn primary" data-action="export">💾 Sicherung erstellen</button></li>
      <li><b>Neue Adresse öffnen</b> <a class="btn" href="${NEW_URL}" target="_blank" rel="noopener">${host} öffnen</a></li>
      <li>Dort bei der Begrüßung <b>„Ich habe schon eine Sicherung“</b> tippen und die Datei wählen.</li></ol>
    <p class="hint">iPhone: Öffne die neue Adresse in Safari, füge sie über „Teilen → Zum Home-Bildschirm“ hinzu und lade die Sicherung
      <b>in der neuen App</b> – sie hat ihren eigenen Speicher. Fortschrittsfotos haben eine eigene Sicherung (Ernährung → Fortschrittsfotos →
      Fotos sichern). Lösch die alte App erst, wenn drüben alles da ist.</p></div>`;
}
actions['beta-feedback'] = async () => {
  if (typeof LEGAL !== 'undefined' && LEGAL.email) { feedbackMail(true); return; }
  const text = `Rückmeldung zur ${APP_NAME} Beta (Version ${APP_V} · ${deviceText()} · Modus ${appMode()}):

`;
  if (typeof LEGAL !== 'undefined' && LEGAL.email) {
    location.href = `mailto:${LEGAL.email}?subject=${encodeURIComponent(APP_NAME + ' Beta – Rückmeldung')}&body=${encodeURIComponent(text)}`;
    return;
  }
  if (navigator.share) {
    try { await navigator.share({ title: `${APP_NAME} Beta – Rückmeldung`, text }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Text kopiert – füg ihn in deine Nachricht ein'); } catch (e) { uiCopy(text, 'Diesen Text kopieren und in deine Nachricht einfügen:'); }
};
// Begrüßung: vorhandene Sicherung laden (z. B. beim Umzug von der alten Adresse)
actions['welcome-import'] = () => {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'application/json,.json'; inp.hidden = true;
  inp.addEventListener('change', () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) importData(f); });
  document.body.appendChild(inp);
  inp.click();
};

async function boot() {
  channelInit();
  await storeInit();  // Daten aus IndexedDB (bzw. Umzug dorthin) – erst danach zeichnen
  applyTheme();
  registerCustomExercises();  // Übungsliste und Bibliothek um eigene Übungen ergänzen (library.js ist jetzt geladen)
  prefatMigrate();
  rirMigrate();  // v199: Tank-Ziele bestehender Pläne −0,5
  whatsNewInit();  // v204: „Was ist neu“ – neue Nutzer ohne Karte, bisherige ab v197
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
