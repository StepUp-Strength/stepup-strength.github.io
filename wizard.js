'use strict';

/* ---------- Plan-Assistent: neuen Plan aus Trainingstagen, Volumen und RIR erstellen ---------- */

// Ablauf: 1 Tage → 2 Volumen → 3 RIR → 4 „automatisch erstellen?“ → (5 Übungen je Muskelgruppe) → 6 Vorschau
// Der fertige Plan kommt als zusätzlicher Plan in data.plans und wird aktiv.

const KIND_ORDER = { compound: 0, normal: 1, assist: 2 };
const KIND_SHORT = { compound: 'Grund', normal: 'Normal', assist: 'Assistenz' };
const PLAN_GROUPS = Object.keys(MUSCLES).filter(g => g !== 'ausdauer' && g !== 'ganzkoerper');

// Muskelgruppen für die Vorlagen
const G_UPPER = ['brust', 'lat', 'trapez', 'schulter_seite', 'schulter_hinten', 'bizeps', 'trizeps'];
const G_LOWER = ['quadrizeps', 'beinbeuger', 'waden', 'bauch', 'adduktoren', 'abduktoren'];
const G_FULL = ['brust', 'lat', 'schulter_seite', 'bizeps', 'trizeps', 'quadrizeps', 'beinbeuger', 'bauch'];
const G_PUSH = ['brust', 'schulter_vorne', 'schulter_seite', 'trizeps'];
const G_PULL = ['lat', 'trapez', 'schulter_hinten', 'bizeps'];
const G_FB_PUSH = ['brust', 'schulter_vorne', 'schulter_seite', 'trizeps', 'quadrizeps', 'waden'];
const G_FB_PULL = ['lat', 'trapez', 'schulter_hinten', 'bizeps', 'beinbeuger', 'bauch'];
const G_CHEST_BACK = ['brust', 'lat', 'trapez'];
const G_SHOULDER_ARMS = ['schulter_vorne', 'schulter_seite', 'schulter_hinten', 'bizeps', 'trizeps'];

// Feste Vorlagen: [Name, Intensität, Muskelgruppen] je Trainingstag
const SPLITS = [
  { id: 'fb1', label: 'Ganzkörper', days: [['Ganzkörper', 'heavy', G_FULL]] },
  { id: 'fb2', label: 'Ganzkörper A/B', days: [['Ganzkörper A', 'heavy', G_FULL], ['Ganzkörper B', 'light', G_FULL]] },
  { id: 'fbpp', label: 'Ganzkörper Push/Pull', days: [['Ganzkörper Push', 'heavy', G_FB_PUSH], ['Ganzkörper Pull', 'heavy', G_FB_PULL]] },
  { id: 'ppl', label: 'Push/Pull/Beine', days: [['Push', 'heavy', G_PUSH], ['Pull', 'heavy', G_PULL], ['Beine', 'heavy', G_LOWER]] },
  { id: 'arnold', label: 'Arnold-Split', days: [['Brust/Rücken', 'heavy', G_CHEST_BACK], ['Schultern/Arme', 'heavy', G_SHOULDER_ARMS], ['Beine', 'heavy', G_LOWER]] },
  { id: 'ul', label: 'Ober-/Unterkörper', days: [['Oberkörper schwer', 'heavy', G_UPPER], ['Unterkörper schwer', 'heavy', G_LOWER],
    ['Oberkörper leicht', 'light', G_UPPER], ['Unterkörper leicht', 'light', G_LOWER]] },
  { id: 'pplul', label: 'Push/Pull/Beine + Ober-/Unterkörper', days: [['Push', 'heavy', G_PUSH], ['Pull', 'heavy', G_PULL], ['Beine', 'heavy', G_LOWER],
    ['Oberkörper', 'light', G_UPPER], ['Unterkörper', 'light', G_LOWER]] },
  { id: 'ppl2', label: 'Push/Pull/Beine ×2', days: [['Push A', 'heavy', G_PUSH], ['Pull A', 'heavy', G_PULL], ['Beine A', 'heavy', G_LOWER],
    ['Push B', 'light', G_PUSH], ['Pull B', 'light', G_PULL], ['Beine B', 'light', G_LOWER]] },
  { id: 'arnold2', label: 'Arnold-Split ×2', days: [['Brust/Rücken A', 'heavy', G_CHEST_BACK], ['Schultern/Arme A', 'heavy', G_SHOULDER_ARMS], ['Beine A', 'heavy', G_LOWER],
    ['Brust/Rücken B', 'light', G_CHEST_BACK], ['Schultern/Arme B', 'light', G_SHOULDER_ARMS], ['Beine B', 'light', G_LOWER]] },
];

// Wochenziele (Sätze pro Woche: Intro, W2, W3, W4). Die Vorlagen teilen sie auf die Trainings der Woche auf.
const WEEKLY_TARGET = {
  brust: [10, 10, 12, 14], lat: [10, 10, 12, 12], trapez: [4, 4, 6, 6],
  schulter_vorne: [4, 4, 6, 6], schulter_seite: [4, 6, 6, 8], schulter_hinten: [4, 6, 6, 8],
  bizeps: [4, 6, 6, 8], trizeps: [4, 6, 6, 8], unterarme: [2, 2, 3, 3],
  quadrizeps: [10, 10, 12, 14], beinbeuger: [6, 8, 8, 10], gesaess: [4, 4, 6, 6],
  adduktoren: [2, 2, 4, 4], abduktoren: [2, 2, 4, 4], waden: [4, 4, 6, 6], bauch: [4, 4, 6, 6],
  ruecken_unten: [2, 2, 3, 3],
};
const SESSION_CAP = 24;  // höchstens so viele Sätze pro Training in der Intro-Woche

// Standard-Auswahl je Muskelgruppe (komplexe Übungen zuerst)
const DEFAULT_PICKS = {
  brust: ['Bankdrücken Flachbank (Langhantel)', 'Bankdrücken Schrägmaschine', 'Butterfly Maschine', 'Bankdrücken Schrägbank (Kurzhantel)', 'Kabelzug Crossover'],
  lat: ['Rudern Langhantel vorgebeugt', 'Latziehen breit', 'Rudern Kabelzug eng (V-Griff)', 'Klimmzüge', 'Überzüge Kabelzug (Straight-Arm Pulldown)'],
  trapez: ['Rudern Maschine breit', 'Shrugs Kurzhantel'],
  schulter_vorne: ['Schulterdrücken Langhantel stehend (Military Press)', 'Schulterdrücken Maschine', 'Frontheben Kurzhantel'],
  schulter_seite: ['Seitheben Kabelzug', 'Seitheben Kurzhantel', 'Seitheben Maschine'],
  schulter_hinten: ['Reverse Butterfly Maschine', 'Face Pulls', 'Reverse Flys Kabelzug'],
  bizeps: ['Bizepscurls SZ-Stange', 'Hammercurls Kurzhantel', 'Bizepscurls Kabelzug'],
  trizeps: ['Trizepsdrücken Kabelzug (Seil)', 'Stirndrücken SZ-Stange (French Press)', 'Trizepsdrücken über Kopf Kabelzug'],
  unterarme: ['Handgelenkcurls (Unterarme)', 'Reverse Curls'],
  quadrizeps: ['Kniebeugen (Langhantel)', 'Beinpresse 45°', 'Beinstrecker', 'Hackenschmidt-Kniebeugen (Hack Squat)'],
  beinbeuger: ['Kreuzheben rumänisch (Langhantel)', 'Beinbeuger sitzend', 'Beinbeuger liegend'],
  gesaess: ['Hip Thrust Langhantel', 'Gesäßmaschine (Glute Kickback)'],
  adduktoren: ['Adduktoren Maschine'],
  abduktoren: ['Abduktoren Maschine'],
  waden: ['Wadenheben stehend', 'Wadenheben sitzend'],
  bauch: ['Crunches Kabelzug (kniend)', 'Beinheben hängend'],
  ruecken_unten: ['Hyperextensions (Rückenstrecker)', 'Rückenstrecker Maschine'],
};

let wiz = null;  // Entwurf des Assistenten – erst „Plan speichern“ schreibt in data

const byKind = names => [...names].sort((a, b) => KIND_ORDER[kindOf({ name: a })] - KIND_ORDER[kindOf({ name: b })]);
const uniqueNames = names => names.filter((n, i) => names.findIndex(m => nameKey(m) === nameKey(n)) === i);

// Übungen dieser Muskelgruppe aus dem aktiven Plan
const existingFor = g => byKind(uniqueNames(data.days.flatMap(d => d.exercises)
  .filter(e => e.name.trim() && groupOf(e) === g).map(e => e.name.trim())));

// Muskelgruppen, die an mindestens einem Tag trainiert werden (in fester Reihenfolge)
const wizGroups = () => PLAN_GROUPS.filter(g => wiz.days.some(d => d.groups.includes(g)));
const daysWith = g => wiz.days.filter(d => d.groups.includes(g)).length;

// Weniger Volumen = weniger, dafür komplexere Übungen
function exercisesNeeded(g) {
  const v = wiz.volume[g][0];
  return v <= 2 ? 1 : v <= 4 ? 2 : 3;
}

// Automatische Auswahl: je Übung eine Stufe – 1. Grundübung, 2. normale, 3. Assistenzübung.
// Pro Stufe zuerst eine Übung aus dem aktiven Plan, sonst ein Standard-Vorschlag; fehlt die Art ganz,
// wird mit der nächstbesten Übung aufgefüllt.
function autoPicks(g) {
  const n = exercisesNeeded(g);
  const existing = existingFor(g);
  const pool = byKind(DEFAULT_PICKS[g] || EXERCISE_LIST.filter(([, , gr]) => gr === g).map(([name]) => name));
  const picks = [];
  const free = list => list.filter(x => !picks.some(p => nameKey(p) === nameKey(x)));
  const ofKind = (list, k) => free(list).find(x => kindOf({ name: x }) === k);
  const slots = ['compound', 'normal', 'assist'];
  for (let i = 0; i < n; i++) {
    const k = slots[Math.min(i, 2)];
    const pick = ofKind(existing, k) || ofKind(pool, k) || free(existing)[0] || free(pool)[0];
    if (pick) picks.push(pick);
  }
  return byKind(picks);
}

const splitDays = id => SPLITS.find(s => s.id === id).days.map(([name, intensity, groups]) => ({ name, intensity, groups: [...groups] }));

function wizStart() {
  const n = data.days.length;
  const split = SPLITS.find(s => s.days.length === n) || SPLITS.find(s => s.id === 'ul');
  wiz = {
    step: 1,
    name: `Plan ${data.plans.length + 1}`,
    weeks: data.cycle.buildWeeks,
    split: split.id,
    days: splitDays(split.id),
    volume: {}, volFreq: {}, rir: {}, picks: {}, gi: 0,
  };
  go('wizard');
}

// Sätze pro Training aus den Wochenzielen: Wochenziel ÷ Trainings pro Woche mit dieser Muskelgruppe.
// Hätte ein Tag in der Intro-Woche mehr als SESSION_CAP Sätze, werden seine Muskelgruppen anteilig gekürzt.
function templateVolume(groups) {
  const vol = {};
  for (const g of groups) {
    const freq = Math.max(1, daysWith(g));
    vol[g] = (WEEKLY_TARGET[g] || [2, 2, 3, 3]).map(w => Math.max(1, Math.round(w / freq)));
  }
  const factor = Object.fromEntries(groups.map(g => [g, 1]));
  for (const d of wiz.days) {
    const total = d.groups.reduce((a, g) => a + (vol[g] ? vol[g][0] : 0), 0);
    if (total > SESSION_CAP) d.groups.forEach(g => { factor[g] = Math.min(factor[g], SESSION_CAP / total); });
  }
  for (const g of groups) {
    if (factor[g] < 1) vol[g] = vol[g].map(v => Math.max(1, Math.round(v * factor[g])));
  }
  return vol;
}

// Volumen/RIR/Auswahl an die Muskelgruppen der Tage anpassen. Volumen wird neu berechnet, wenn eine
// Muskelgruppe neu ist oder sich die Zahl ihrer Trainingstage geändert hat.
function syncGroups() {
  const groups = wizGroups();
  const tv = templateVolume(groups);
  for (const g of groups) {
    if (!wiz.volume[g] || wiz.volFreq[g] !== daysWith(g)) {
      wiz.volume[g] = tv[g];
      wiz.volFreq[g] = daysWith(g);
    }
    if (!wiz.rir[g]) wiz.rir[g] = [...RIR_PLAN[4]];
    if (!wiz.picks[g]) wiz.picks[g] = existingFor(g);
  }
  for (const g of Object.keys(wiz.volume)) {
    if (!groups.includes(g)) { delete wiz.volume[g]; delete wiz.volFreq[g]; delete wiz.rir[g]; delete wiz.picks[g]; }
  }
}

// Trainingstage aus dem Entwurf: Übungen der Muskelgruppen des Tages, sortiert Grund → Normal → Assistenz
function buildPlanDays() {
  return wiz.days.map(d => {
    const list = [];
    for (const g of PLAN_GROUPS.filter(x => d.groups.includes(x))) {
      for (const name of wiz.picks[g] || []) list.push([name, g]);
    }
    list.sort((a, b) => KIND_ORDER[kindOf({ name: a[0] })] - KIND_ORDER[kindOf({ name: b[0] })]);
    return {
      id: uid(),
      name: d.name.trim() || 'Trainingstag',
      intensity: d.intensity,
      groups: [...d.groups],
      exercises: list.map(([name, g]) => withDefaults({ id: uid(), name, group: g, max10: knownMax10(name) })),
    };
  });
}

/* --- Darstellung --- */

function wizSteps() {
  const labels = ['Tage', 'Volumen', 'RIR', 'Übungen'];
  const cur = Math.min(wiz.step, 4);
  return `<div class="pills wiz-steps">${labels.map((l, i) =>
    `<span class="pill ${i + 1 === cur ? 'now' : i + 1 < cur ? 'past' : ''}">${l}</span>`).join('')}</div>`;
}

const weekHead = () => '<tr><th></th><th>Intro</th><th>W2</th><th>W3</th><th>W4</th></tr>';

function wizWeekText(g) {
  const n = daysWith(g);
  const v = wiz.volume[g];
  return `pro Woche (${n} Training${n === 1 ? '' : 's'}): ${v.map(x => x * n).join(' · ')} · Deload ${Math.ceil(v[3] / 2) * n}`;
}

function renderWizStep1() {
  let h = `<div class="card">
    <h2>1 · Trainingstage</h2>
    <label class="lbl">Name des Plans
      <input class="inp" type="text" data-field="wiz-name" value="${esc(wiz.name)}"></label>
    <div class="row" style="margin-top:0"><span>Trainingswochen<br><small class="hint">inkl. Intro, danach Deload</small></span>
      <div class="stepper">${[4, 5].map(n =>
        `<button class="toggle ${wiz.weeks === n ? 'on' : ''}" data-action="wiz-weeks" data-n="${n}">${n}</button>`).join('')}</div></div>
    <p class="lbl chips-title">Vorlage</p>
    ${SPLITS.map(s => `<button class="split-opt ${wiz.split === s.id ? 'on' : ''}" data-action="wiz-split" data-id="${s.id}">
      <b>${s.label}</b><small>${s.days.length} Tag${s.days.length > 1 ? 'e' : ''} · ${[...new Set(s.days.map(d => d[0].replace(/ [AB]$/, '')))].join(' · ')}</small>
    </button>`).join('')}
    <button class="split-opt ${wiz.split === 'custom' ? 'on' : ''}" data-action="wiz-split" data-id="custom">
      <b>Eigene Aufteilung</b><small>Tage und Muskelgruppen selbst festlegen</small></button>
    ${wiz.split === 'custom' ? `<p class="lbl chips-title">Trainingstage pro Woche</p>
      <div class="variants count">${[1, 2, 3, 4, 5, 6].map(n =>
        `<button class="vchip ${wiz.days.length === n ? 'on' : ''}" data-action="wiz-count" data-n="${n}">${n}</button>`).join('')}</div>` : ''}
    <p class="hint">Volumen, RIR und Übungen werden passend zur Vorlage vorgeschlagen. Namen, Intensität und Muskelgruppen der Tage kannst du unten frei ändern.</p>
  </div>`;
  wiz.days.forEach((d, di) => {
    h += `<div class="card wiz-day">
      <input class="inp" type="text" data-field="wiz-dayname" data-d="${di}" value="${esc(d.name)}">
      <div class="variants">${[['heavy', 'Schwer'], ['light', 'Leicht']].map(([k, l]) =>
        `<button class="vchip ${d.intensity === k ? 'on' : ''}" data-action="wiz-dayint" data-d="${di}" data-k="${k}">${l}</button>`).join('')}</div>
      <div class="group-chips">${PLAN_GROUPS.map(g =>
        `<button class="gchip ${d.groups.includes(g) ? 'on' : ''}" data-action="wiz-daygroup" data-d="${di}" data-g="${g}">${MUSCLES[g]}</button>`).join('')}</div>
    </div>`;
  });
  return h + `<div class="row"><button class="btn" data-action="wiz-cancel">Abbrechen</button>
    <button class="btn primary" data-action="wiz-step" data-to="2">Weiter</button></div>`;
}

function renderWizard() {
  if (!wiz) return '<p class="hint">Der Assistent wurde beendet.</p><button class="btn primary" data-action="wiz-start">Neu starten</button>';
  let h = wizSteps();
  if (wiz.step === 1) return h + renderWizStep1();
  const groups = wizGroups();

  if (wiz.step === 2) {
    h += `<div class="card"><h2>2 · Volumen</h2>
      <p class="hint">Sätze <b>pro Training</b> je Muskelgruppe – antippen und Zahl ändern. Die Wochensumme ergibt sich aus der Zahl der Tage mit dieser Muskelgruppe.</p>
      <table class="rir vol">${weekHead()}`;
    for (const g of groups) {
      h += `<tr><td>${MUSCLES[g]}</td>` + wiz.volume[g].map((v, w) =>
        `<td><input class="vol-inp" type="text" inputmode="numeric" pattern="[0-9]*" data-field="wiz-vol" data-g="${g}" data-w="${w}" value="${v}"></td>`).join('') +
        `</tr><tr class="vol-week"><td colspan="5"><span data-wizweek="${g}">${wizWeekText(g)}</span></td></tr>`;
    }
    return h + `</table></div><div class="row"><button class="btn" data-action="wiz-step" data-to="1">Zurück</button>
      <button class="btn primary" data-action="wiz-step" data-to="3">Weiter</button></div>`;
  }

  if (wiz.step === 3) {
    h += `<div class="card"><h2>3 · Reps in Reserve</h2>
      <p class="hint">Ziel im Tank je Muskelgruppe und Woche für <b>normale</b> Übungen. Grundübungen bekommen +1, Assistenzübungen −1 (nie unter 0). Deload immer mind. ${DELOAD_RIR}.</p>
      <table class="rir vol">${weekHead()}
      <tr class="all-row"><td><b>Alle</b></td>${[0, 1, 2, 3].map(w =>
        `<td><input class="vol-inp" type="text" inputmode="decimal" data-field="wiz-rir-all" data-w="${w}" placeholder="–"></td>`).join('')}</tr>`;
    for (const g of groups) {
      h += `<tr><td>${MUSCLES[g]}</td>` + wiz.rir[g].map((v, w) =>
        `<td><input class="vol-inp" type="text" inputmode="decimal" data-field="wiz-rir" data-g="${g}" data-w="${w}" value="${fmtNum(v)}"></td>`).join('') + '</tr>';
    }
    return h + `</table><p class="hint">„Alle“: eine Zahl eintragen setzt die ganze Spalte auf einmal.</p></div>
      <div class="row"><button class="btn" data-action="wiz-step" data-to="2">Zurück</button>
      <button class="btn primary" data-action="wiz-step" data-to="4">Weiter</button></div>`;
  }

  if (wiz.step === 4) {
    return h + `<div class="card check">
      <div class="check-emoji" aria-hidden="true">🤖</div>
      <h2 class="question">Soll ein passender Plan automatisch erstellt werden?</h2>
      <div class="row">
        <button class="btn primary" data-action="wiz-auto" data-yes="1">Ja</button>
        <button class="btn primary" data-action="wiz-auto">Nein</button>
      </div>
      <p class="hint">Ja: Die App wählt die Übungen (bevorzugt aus deinem aktiven Plan, wenig Volumen = komplexe Übungen zuerst).
        Nein: Du wählst die Übungen pro Muskelgruppe selbst aus.</p>
    </div>
    <div class="row"><button class="btn" data-action="wiz-step" data-to="3">Zurück</button></div>`;
  }

  if (wiz.step === 5) {
    const g = groups[wiz.gi];
    const picks = wiz.picks[g] || [];
    const sugg = (DEFAULT_PICKS[g] || EXERCISE_LIST.filter(([, , gr]) => gr === g).map(([n]) => n).slice(0, 5))
      .filter(n => !picks.some(p => nameKey(p) === nameKey(n)));
    const n = exercisesNeeded(g);
    return h + `<div class="card"><h2>${MUSCLES[g]}</h2>
      <p class="sub">Muskelgruppe ${wiz.gi + 1} von ${groups.length} · Sätze pro Training: ${wiz.volume[g].join(' · ')}<br>
        Trainiert an: ${wiz.days.filter(d => d.groups.includes(g)).map(d => esc(d.name)).join(', ')}<br>
        Empfehlung: ${n} Übung${n > 1 ? 'en' : ''}</p>
      <ul class="list reorder">${picks.map((p, i) => `<li class="bw-row"><span>${esc(p)} <small class="hint">· ${KIND_SHORT[kindOf({ name: p })]}</small></span>
        <button class="icon-btn danger" data-action="wiz-unpick" data-i="${i}" aria-label="Entfernen">✕</button></li>`).join('') ||
        '<li class="hint">Noch keine Übung ausgewählt.</li>'}</ul>
      <input class="inp" type="text" data-field="wiz-add" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Übung eintippen …">
      <div class="suggest" hidden></div>
      <div class="row"><button class="btn" data-action="wiz-add-typed">Eingetippte Übung hinzufügen</button></div>
      ${sugg.length ? `<p class="lbl chips-title">Vorschläge</p><div class="variants">${sugg.map(s =>
        `<button class="vchip" data-action="wiz-chip" data-name="${esc(s)}">+ ${esc(s)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="row"><button class="btn" data-action="wiz-gprev">Zurück</button>
      <button class="btn primary" data-action="wiz-gnext">${wiz.gi < groups.length - 1 ? 'Nächste Muskelgruppe' : 'Zur Vorschau'}</button></div>`;
  }

  // Schritt 6: Vorschau
  h += `<h2>Vorschau · ${esc(wiz.name)}</h2>`;
  for (const day of buildPlanDays()) {
    const weeks = [1, 2, 3, 4].map(w => autoSetsForDay(day, w, false, wiz.volume));
    const dl = autoSetsForDay(day, 0, true, wiz.volume);
    h += `<div class="card"><h2>${esc(day.name)} <small class="hint">· ${day.intensity === 'heavy' ? 'schwer' : 'leicht'}</small></h2>
      <p class="hint">Sätze: Intro · W2 · W3 · W4 · Deload</p>
      <ul class="list reorder">${day.exercises.map(e => `<li><b>${esc(e.name)}</b><br>
        <small class="hint">${MUSCLES[e.group]} · ${KIND_SHORT[kindOf(e)]} · Sätze ${weeks.map(m => m.get(e.id)).join(' · ')} · D ${dl.get(e.id)}</small></li>`).join('') ||
        '<li class="hint">Keine Übungen</li>'}</ul>
      <p class="hint">Summe pro Training: ${weeks.map(m => [...m.values()].reduce((a, b) => a + b, 0)).join(' · ')}</p>
    </div>`;
  }
  const empty = groups.filter(g => !(wiz.picks[g] || []).length);
  if (empty.length) h += `<p class="complaint-note">Ohne Übung: ${empty.map(g => MUSCLES[g]).join(', ')} – diese Sätze fallen weg.</p>`;
  return h + `<button class="btn outline" data-action="wiz-adjust">Übungen anpassen</button>
    <div class="row"><button class="btn" data-action="wiz-step" data-to="4">Zurück</button>
    <button class="btn primary" data-action="wiz-commit">Plan speichern</button></div>
    <p class="hint">Der Plan wird zusätzlich zu deinen bisherigen Plänen gespeichert und aktiv gesetzt.</p>`;
}

/* --- Aktionen & Felder --- */

function wizAddPick(name) {
  const g = wizGroups()[wiz.gi];
  name = String(name).trim();
  if (!name) return;
  const picks = wiz.picks[g] = wiz.picks[g] || [];
  if (!picks.some(p => nameKey(p) === nameKey(name))) picks.push(name);
  wiz.picks[g] = byKind(picks);
  render();
}

views.wizard = { title: 'Neuer Plan', tab: 'plan', back: 'plan', render: renderWizard };

Object.assign(actions, {
  'wiz-start': () => wizStart(),
  'wiz-cancel': () => { wiz = null; go('plan'); },
  'wiz-weeks': el => { wiz.weeks = Number(el.dataset.n); render(); },
  // Vorlage wählen: Tage neu setzen, Volumen/RIR/Übungen werden danach neu vorgeschlagen
  'wiz-split': el => {
    wiz.split = el.dataset.id;
    wiz.days = wiz.split === 'custom'
      ? wiz.days.map(d => ({ ...d, groups: [...d.groups] }))
      : splitDays(wiz.split);
    Object.assign(wiz, { volume: {}, volFreq: {}, rir: {}, picks: {} });
    render();
  },
  'wiz-count': el => {
    const n = Number(el.dataset.n);
    wiz.days = Array.from({ length: n }, (_, i) => wiz.days[i] || { name: `Tag ${i + 1}`, intensity: 'heavy', groups: [] });
    render();
  },
  'wiz-dayint': el => { wiz.days[el.dataset.d].intensity = el.dataset.k; render(); },
  'wiz-daygroup': el => {
    const d = wiz.days[el.dataset.d], g = el.dataset.g;
    d.groups = d.groups.includes(g) ? d.groups.filter(x => x !== g) : [...d.groups, g];
    render();
  },
  'wiz-step': el => {
    const to = Number(el.dataset.to);
    if (wiz.step === 1 && to === 2) {
      if (!wizGroups().length) { alert('Bitte mindestens einem Trainingstag Muskelgruppen zuweisen.'); return; }
      syncGroups();
    }
    wiz.step = to;
    go('wizard');
  },
  'wiz-auto': el => {
    if (el.dataset.yes) {
      for (const g of wizGroups()) wiz.picks[g] = autoPicks(g);
      wiz.step = 6;
    } else {
      wiz.gi = 0;
      wiz.step = 5;
    }
    go('wizard');
  },
  'wiz-adjust': () => { wiz.gi = 0; wiz.step = 5; go('wizard'); },
  'wiz-gprev': () => { if (wiz.gi > 0) wiz.gi--; else wiz.step = 4; go('wizard'); },
  'wiz-gnext': () => { if (wiz.gi < wizGroups().length - 1) wiz.gi++; else wiz.step = 6; go('wizard'); },
  'wiz-unpick': el => { wiz.picks[wizGroups()[wiz.gi]].splice(Number(el.dataset.i), 1); render(); },
  'wiz-chip': el => wizAddPick(el.dataset.name),
  'wiz-add-typed': () => {
    const input = $view.querySelector('[data-field="wiz-add"]');
    if (!input.value.trim()) { alert('Bitte erst eine Übung eintippen.'); return; }
    wizAddPick(input.value);
  },
  'wiz-commit': () => {
    const days = buildPlanDays();
    if (!days.some(d => d.exercises.length)) { alert('Der Plan enthält noch keine Übungen.'); return; }
    if (draft && !confirm(`Es läuft noch ein Training (${draft.dayName}). Trotzdem den neuen Plan aktiv setzen?`)) return;
    const plan = newPlan(wiz.name.trim() || 'Neuer Plan', days);
    plan.volume = wiz.volume;
    plan.rirPlan = wiz.rir;
    data.plans.push(plan);
    data.activePlanId = plan.id;
    data.cycle.buildWeeks = wiz.weeks;
    saveData();
    wiz = null;
    toast(`„${plan.name}“ erstellt und aktiv ✔`);
    go('plan');
  },
});

Object.assign(fields, {
  'wiz-name': el => { wiz.name = el.value; },
  'wiz-dayname': el => { wiz.days[el.dataset.d].name = el.value; },
  'wiz-vol': el => {
    const n = parseInt(el.value, 10);
    if (!isFinite(n) || n < 0 || n > 30) return;
    wiz.volume[el.dataset.g][+el.dataset.w] = n;
    const t = $view.querySelector(`[data-wizweek="${el.dataset.g}"]`);
    if (t) t.textContent = wizWeekText(el.dataset.g);
  },
  'wiz-rir': el => {
    const n = parseNum(el.value);
    if (n == null || n < 0 || n > 6) return;
    wiz.rir[el.dataset.g][+el.dataset.w] = n;
  },
  // „Alle“: ganze Spalte auf einmal setzen
  'wiz-rir-all': el => {
    const n = parseNum(el.value);
    if (n == null || n < 0 || n > 6) return;
    const w = +el.dataset.w;
    for (const g of wizGroups()) {
      wiz.rir[g][w] = n;
      const inp = $view.querySelector(`[data-field="wiz-rir"][data-g="${g}"][data-w="${w}"]`);
      if (inp) inp.value = fmtNum(n);
    }
  },
  'wiz-add': el => {
    const g = wizGroups()[wiz.gi];
    // Übungen dieser Muskelgruppe zuerst vorschlagen
    const pool = [...EXERCISE_LIST.filter(([, , gr]) => gr === g).map(([n]) => n), ...ownExerciseNames(), ...EXERCISES];
    showSuggestions(el, uniqueNames(pool));
  },
});
