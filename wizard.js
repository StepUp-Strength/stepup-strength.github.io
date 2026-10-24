'use strict';

/* ---------- Plan-Assistent: neuen Plan aus Trainingstagen, Schwerpunkten, Volumen und RIR erstellen ---------- */

// Ablauf: days → prio → low → volume → rir → auto → (manual: Übungen je Muskelgruppe) → preview
// Der fertige Plan kommt als zusätzlicher Plan in data.plans und wird aktiv.

const KIND_ORDER = { compound: 0, normal: 1, assist: 2 };
const KIND_SHORT = { compound: 'Grund', normal: 'Normal', assist: 'Assistenz' };
const PLAN_GROUPS = Object.keys(MUSCLES).filter(g => g !== 'ausdauer' && g !== 'ganzkoerper');
const MAX_FOCUS = 2;       // höchstens 2 Muskelgruppen priorisieren bzw. „low“
const FOCUS_SETS = 2;      // ± Sätze pro Woche

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
  { id: 'fb1', tag: 'Ganzkörper', label: 'Ganzkörper', days: [['Ganzkörper', 'heavy', G_FULL]] },
  { id: 'fb2', tag: 'Ganzkörper', label: 'Ganzkörper A/B', days: [['Ganzkörper A', 'heavy', G_FULL], ['Ganzkörper B', 'light', G_FULL]] },
  { id: 'fbpp', tag: '2er-Split', label: 'Ganzkörper Push/Pull', days: [['Ganzkörper Push', 'heavy', G_FB_PUSH], ['Ganzkörper Pull', 'heavy', G_FB_PULL]] },
  { id: 'ppl', tag: '3er-Split', label: 'Push/Pull/Beine', days: [['Push', 'heavy', G_PUSH], ['Pull', 'heavy', G_PULL], ['Beine', 'heavy', G_LOWER]] },
  { id: 'arnold', tag: '3er-Split', label: 'Arnold-Split', days: [['Brust/Rücken', 'heavy', G_CHEST_BACK], ['Schultern/Arme', 'heavy', G_SHOULDER_ARMS], ['Beine', 'heavy', G_LOWER]] },
  { id: 'ul', tag: '2er-Split', label: 'Ober-/Unterkörper', days: [['Oberkörper schwer', 'heavy', G_UPPER], ['Unterkörper schwer', 'heavy', G_LOWER],
    ['Oberkörper leicht', 'light', G_UPPER], ['Unterkörper leicht', 'light', G_LOWER]] },
  { id: 'pplul', tag: '3er + 2er-Split', label: 'Push/Pull/Beine + Ober-/Unterkörper', days: [['Push', 'heavy', G_PUSH], ['Pull', 'heavy', G_PULL], ['Beine', 'heavy', G_LOWER],
    ['Oberkörper', 'light', G_UPPER], ['Unterkörper', 'light', G_LOWER]] },
  { id: 'ppl2', tag: '3er-Split', label: 'Push/Pull/Beine ×2', days: [['Push A', 'heavy', G_PUSH], ['Pull A', 'heavy', G_PULL], ['Beine A', 'heavy', G_LOWER],
    ['Push B', 'light', G_PUSH], ['Pull B', 'light', G_PULL], ['Beine B', 'light', G_LOWER]] },
  { id: 'arnold2', tag: '3er-Split', label: 'Arnold-Split ×2', days: [['Brust/Rücken A', 'heavy', G_CHEST_BACK], ['Schultern/Arme A', 'heavy', G_SHOULDER_ARMS], ['Beine A', 'heavy', G_LOWER],
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
const SESSION_CAP = 25;  // höchstens so viele Sätze pro Training – in jeder Woche des Zyklus

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

let wiz = null;  // Entwurf des Assistenten – erst „Plan speichern“ schreibt den Plan in data

const byKind = names => [...names].sort((a, b) => KIND_ORDER[kindOf({ name: a })] - KIND_ORDER[kindOf({ name: b })]);
const uniqueNames = names => names.filter((n, i) => names.findIndex(m => nameKey(m) === nameKey(n)) === i);

// Übungen dieser Muskelgruppe aus dem aktiven Plan
const existingFor = g => byKind(uniqueNames(data.days.flatMap(d => d.exercises)
  .filter(e => e.name.trim() && groupOf(e) === g).map(e => e.name.trim())));

// Muskelgruppen, die an mindestens einem Tag trainiert werden (in fester Reihenfolge)
const wizGroups = () => PLAN_GROUPS.filter(g => wiz.days.some(d => d.groups.includes(g)));
const daysWith = g => wiz.days.filter(d => d.groups.includes(g)).length;

// Schwerpunkt: +2 Sätze/Woche bei Priorität, −2 bei „low“
const focusAdj = g => wiz.prio.includes(g) ? FOCUS_SETS : wiz.low.includes(g) ? -FOCUS_SETS : 0;

// Weniger Volumen = weniger, dafür komplexere Übungen – aber mindestens so viele Übungen,
// dass keine mehr als MAX_SETS_PER_EX Sätze braucht (gemessen an der Woche mit den meisten Sätzen)
function exercisesNeeded(g) {
  const v = wiz.volume[g][0];
  const base = v <= 2 ? 1 : v <= 4 ? 2 : 3;
  return Math.max(base, Math.ceil(Math.max(...wiz.volume[g]) / MAX_SETS_PER_EX));
}

// Automatische Auswahl: je Übung eine Stufe – 1. Grundübung, 2. normale, 3. Assistenzübung.
// Pro Stufe zuerst eine Übung aus dem aktiven Plan, sonst ein Standard-Vorschlag; fehlt die Art ganz,
// wird mit der nächstbesten Übung aufgefüllt.
function autoPicks(g) {
  const n = exercisesNeeded(g);
  const existing = existingFor(g);
  // Standard-Vorschläge zuerst, danach alle übrigen Übungen der Muskelgruppe aus der Liste
  const pool = uniqueNames([...(DEFAULT_PICKS[g] || []), ...byKind(EXERCISE_LIST.filter(([, , gr]) => gr === g).map(([name]) => name))]);
  const picks = [];
  const free = list => list.filter(x => !picks.some(p => nameKey(p) === nameKey(x)));
  const ofKind = (list, k) => free(list).find(x => kindOf({ name: x }) === k);
  // ab der 4. Übung abwechselnd normale und Assistenzübungen
  const slots = ['compound', 'normal', 'assist', 'normal', 'assist', 'normal', 'assist'];
  for (let i = 0; i < n; i++) {
    const k = slots[Math.min(i, slots.length - 1)];
    const pick = ofKind(existing, k) || ofKind(pool, k) || free(existing)[0] || free(pool)[0];
    if (pick) picks.push(pick);
  }
  return byKind(picks);
}

const splitDays = id => SPLITS.find(s => s.id === id).days.map(([name, intensity, groups]) => ({ name, intensity, groups: [...groups] }));

// Muskelgruppen eines vorhandenen Trainingstags (neue Tage haben groups, ältere ggf. nur Übungen)
function groupsOfDay(d) {
  if (d.groups) return [...d.groups];
  if (d.type) return [...DAY_GROUPS[d.type.split('-')[0]]];
  return [...new Set(d.exercises.filter(e => e.name.trim()).map(groupOf))].filter(g => PLAN_GROUPS.includes(g));
}

// Alle Trainingstage zur Auswahl bei „Eigene Aufteilung“: eigene, aus den Plänen und aus den Vorlagen
function dayLibrary() {
  const list = [];
  const add = (name, intensity, groups, ownId) => {
    if (!groups.length || list.some(x => nameKey(x.name) === nameKey(name))) return;
    list.push({ name, intensity: intensity || 'heavy', groups, ownId });
  };
  for (const t of data.dayTemplates) add(t.name, t.intensity, [...t.groups], t.id);
  for (const p of data.plans) for (const d of p.days) add(d.name, dayIntensity(d), groupsOfDay(d), null);
  for (const s of SPLITS) for (const [name, int, groups] of s.days) add(name.replace(/ [AB]$/, ''), int, [...groups], null);
  return list;
}

// Vorauswahl: erst die Art der Aufteilung, dann die passenden Vorlagen
const SPLIT_CATS = [
  { tag: 'Ganzkörper', icon: '🧍', desc: 'Jedes Training den ganzen Körper' },
  { tag: '2er-Split', icon: '✌️', desc: 'Zwei verschiedene Trainingstage im Wechsel' },
  { tag: '3er-Split', icon: '🔺', desc: 'Drei verschiedene Trainingstage im Wechsel' },
  { tag: '3er + 2er-Split', icon: '🔀', desc: 'Kombination für 5 Trainings pro Woche' },
  { tag: 'custom', icon: '🛠️', label: 'Eigene Aufteilung', desc: 'Trainingstage selbst zusammenstellen' },
];

function wizStart() {
  wiz = {
    step: 'days',
    name: `Plan ${data.plans.length + 1}`,
    weeks: data.cycle.buildWeeks,
    cat: null,     // gewählte Aufteilung (Kennzeichen) oder 'custom'
    split: null,   // gewählte Vorlage
    days: [],
    newDay: { name: '', intensity: 'heavy', groups: [] },
    startWeek: mondayISO(new Date()),  // Montag der Intro-Woche des neuen Plans
    prio: [], low: [],
    volume: {}, volKey: {}, rir: {}, picks: {}, gi: 0,
  };
  go('wizard');
}

// Sätze pro Training aus den Wochenzielen (± Schwerpunkt): Wochenziel ÷ Trainings pro Woche mit dieser
// Muskelgruppe. Hätte ein Tag in der Intro-Woche mehr als SESSION_CAP Sätze, wird anteilig gekürzt.
function templateVolume(groups) {
  const vol = {};
  for (const g of groups) {
    const freq = Math.max(1, daysWith(g));
    const adj = focusAdj(g);
    vol[g] = (WEEKLY_TARGET[g] || [2, 2, 3, 3]).map(w => Math.max(1, Math.round(Math.max(1, w + adj) / freq)));
  }
  capSessions(vol);
  return vol;
}

// Muskelgruppen, die fast nur mit Assistenzübungen trainiert werden – sie werden zuerst gekürzt.
const ASSIST_GROUPS = ['schulter_seite', 'schulter_hinten', 'bizeps', 'trizeps', 'unterarme', 'trapez',
  'waden', 'bauch', 'adduktoren', 'abduktoren'];
const ASSIST_FLOOR = 0.5; // bis auf diesen Anteil werden Assistenzgruppen gekürzt, bevor andere nachziehen

// Kein Training über SESSION_CAP Sätze, in keiner Woche. Priorisierte Gruppen bleiben bis zuletzt verschont.
// 1. Anteilig, gemessen an der vollsten Woche (so bleibt der Anstieg über den Zyklus erhalten):
//    erst die Assistenzgruppen bis auf ASSIST_FLOOR, dann die übrigen Gruppen ebenfalls bis auf
//    ASSIST_FLOOR, reicht das nicht, beide gemeinsam weiter.
// 2. Rundungsreste: an noch zu vollen Tagen um je 1 Satz kürzen, in derselben Reihenfolge.
function capSessions(vol) {
  const orig = Object.fromEntries(Object.keys(vol).map(g => [g, vol[g].slice()]));
  const isAssist = g => ASSIST_GROUPS.includes(g);
  const factor = Object.fromEntries(Object.keys(vol).map(g => [g, 1]));
  for (const d of wiz.days) {
    const free = d.groups.filter(g => vol[g] && !wiz.prio.includes(g));
    for (let w = 0; w < 4; w++) {
      const sum = gs => gs.reduce((a, g) => a + (vol[g] ? vol[g][w] : 0), 0);
      let excess = sum(d.groups) - SESSION_CAP;
      if (excess <= 0) continue;
      const A = sum(free.filter(isAssist)), N = sum(free.filter(g => !isAssist(g)));
      const cutA = Math.min(excess, A * (1 - ASSIST_FLOOR)); excess -= cutA;
      const cutN = Math.min(excess, N * (1 - ASSIST_FLOOR)); excess -= cutN;
      let fA = A ? 1 - cutA / A : 1, fN = N ? 1 - cutN / N : 1;
      const left = (A + N) * ASSIST_FLOOR;
      if (excess > 0 && left > 0) {
        const f = Math.max(0, 1 - excess / left);
        fA *= f; fN *= f;
      }
      free.forEach(g => { factor[g] = Math.min(factor[g], isAssist(g) ? fA : fN); });
    }
  }
  for (const g of Object.keys(vol)) {
    if (factor[g] < 1) vol[g] = vol[g].map(v => Math.max(1, Math.round(v * factor[g])));
  }
  for (let w = 3; w >= 0; w--) {
    // frühere Wochen nie mehr Sätze als die Woche danach (die Verteilung kann nur hinzufügen)
    if (w < 3) for (const g of Object.keys(vol)) vol[g][w] = Math.min(vol[g][w], vol[g][w + 1]);
    for (let guard = 0; guard < 500; guard++) {
      const over = wiz.days.find(d => d.groups.reduce((a, g) => a + (vol[g] ? vol[g][w] : 0), 0) > SESSION_CAP);
      if (!over) break;
      const cands = over.groups.filter(g => vol[g] && vol[g][w] > 1);
      const free = cands.filter(g => !wiz.prio.includes(g));
      const floor = g => Math.max(1, Math.ceil(orig[g][w] * ASSIST_FLOOR));
      const pool = [
        free.filter(g => isAssist(g) && vol[g][w] > floor(g)),
        free.filter(g => !isAssist(g) && vol[g][w] > floor(g)),
        free, cands,
      ].find(p => p.length);
      if (!pool) break;
      const g = pool.reduce((a, b) => vol[b][w] > vol[a][w] ? b : a);
      vol[g][w]--;
    }
  }
}

// Volumen/RIR/Auswahl an die Muskelgruppen der Tage anpassen. Volumen wird neu berechnet, wenn eine
// Muskelgruppe neu ist oder sich ihre Trainingstage bzw. ihr Schwerpunkt geändert haben.
function syncGroups() {
  const groups = wizGroups();
  const tv = templateVolume(groups);
  for (const g of groups) {
    const key = `${daysWith(g)}|${focusAdj(g)}`;
    if (!wiz.volume[g] || wiz.volKey[g] !== key) {
      wiz.volume[g] = tv[g];
      wiz.volKey[g] = key;
    }
    if (!wiz.rir[g]) wiz.rir[g] = [...RIR_PLAN[4]];
    if (!wiz.picks[g]) wiz.picks[g] = existingFor(g);
  }
  for (const g of Object.keys(wiz.volume)) {
    if (!groups.includes(g)) { delete wiz.volume[g]; delete wiz.volKey[g]; delete wiz.rir[g]; delete wiz.picks[g]; }
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

const STEP_PILL = { days: 0, prio: 1, low: 1, volume: 2, rir: 3, auto: 4, manual: 4, preview: 4 };

function wizSteps() {
  const labels = ['Tage', 'Fokus', 'Volumen', 'RIR', 'Übungen'];
  const cur = STEP_PILL[wiz.step];
  return `<div class="pills wiz-steps">${labels.map((l, i) =>
    `<span class="pill ${i === cur ? 'now' : i < cur ? 'past' : ''}">${l}</span>`).join('')}</div>`;
}

const navRow = (back, next, nextLabel = 'Weiter') => `<div class="row">
  <button class="btn" data-action="${back === 'cancel' ? 'wiz-cancel' : 'wiz-step'}" data-to="${back}">${back === 'cancel' ? 'Abbrechen' : 'Zurück'}</button>
  ${next ? `<button class="btn primary" data-action="wiz-step" data-to="${next}">${nextLabel}</button>` : ''}</div>`;

const weekHead = () => '<tr><th></th><th>Intro</th><th>W2</th><th>W3</th><th>W4</th></tr>';

function wizWeekText(g) {
  const n = daysWith(g);
  const v = wiz.volume[g];
  return `pro Woche (${n} Training${n === 1 ? '' : 's'}): ${v.map(x => x * n).join(' · ')} · Deload ${Math.ceil(v[3] / 2) * n}`;
}

const focusBadge = g => wiz.prio.includes(g) ? ' <small class="focus up">⭐ +2/Woche</small>'
  : wiz.low.includes(g) ? ' <small class="focus down">😌 −2/Woche</small>' : '';

function dayCard(d, di, removable) {
  return `<div class="card wiz-day">
    <div class="ex-head"><input class="inp" type="text" data-field="wiz-dayname" data-d="${di}" value="${esc(d.name)}">
      ${removable ? `<button class="icon-btn danger" data-action="wiz-day-del" data-d="${di}" aria-label="Tag entfernen">✕</button>` : ''}</div>
    <div class="variants">${[['heavy', 'Schwer'], ['light', 'Leicht']].map(([k, l]) =>
      `<button class="vchip ${d.intensity === k ? 'on' : ''}" data-action="wiz-dayint" data-d="${di}" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="group-chips">${PLAN_GROUPS.map(g =>
      `<button class="gchip ${d.groups.includes(g) ? 'on' : ''}" data-action="wiz-daygroup" data-d="${di}" data-g="${g}">${MUSCLES[g]}</button>`).join('')}</div>
  </div>`;
}

// Startwoche: diese oder nächste Woche oder ein beliebiges Datum (zählt ab dessen Montag)
function startWeekRow() {
  const thisWeek = mondayISO(new Date());
  const nextWeek = addWeeks(thisWeek, 1);
  return `<p class="lbl chips-title">Start (Intro-Woche)</p>
    <div class="variants">
      <button class="vchip ${wiz.startWeek === thisWeek ? 'on' : ''}" data-action="wiz-startweek" data-w="${thisWeek}">Diese Woche</button>
      <button class="vchip ${wiz.startWeek === nextWeek ? 'on' : ''}" data-action="wiz-startweek" data-w="${nextWeek}">Nächste Woche</button>
    </div>
    <label class="row"><span>oder Woche wählen</span>
      <input class="inp date" type="date" data-field="wiz-start-date" value="${wiz.startWeek}"></label>
    <p class="hint">Intro-Woche ab <b>${fmtDate(wiz.startWeek + 'T12:00:00')}</b>, Deload ab ${fmtDate(addWeeks(wiz.startWeek, wiz.weeks) + 'T12:00:00')}.</p>`;
}

function renderWizDays() {
  // 1. Vorauswahl: nur die Arten der Aufteilung
  if (!wiz.cat) {
    return `<h2>Wie möchtest du aufteilen?</h2>` + SPLIT_CATS.map(c => {
      const list = SPLITS.filter(s => s.tag === c.tag);
      const info = c.tag === 'custom' ? c.desc
        : `${c.desc} · ${list.map(s => s.label).join(', ')}`;
      return `<button class="split-opt cat" data-action="wiz-cat" data-cat="${c.tag}">
        <span class="cat-icon">${c.icon}</span><b>${c.label || c.tag}</b><small>${info}</small></button>`;
    }).join('') + navRow('cancel', null);
  }

  // 2. Vorlagen dieser Aufteilung, danach die Trainingstage
  const custom = wiz.cat === 'custom';
  const cat = SPLIT_CATS.find(c => c.tag === wiz.cat);
  const list = SPLITS.filter(s => s.tag === wiz.cat);
  let h = `<button class="link-btn" data-action="wiz-cat" data-cat="">‹ Andere Aufteilung</button>
    <div class="card">
    <h2>${cat.icon} ${cat.label || cat.tag}</h2>
    ${!custom && list.length > 1 ? `<p class="lbl chips-title">Vorlage wählen</p>` : ''}
    ${custom ? '' : list.map(s => `<button class="split-opt ${wiz.split === s.id ? 'on' : ''}" data-action="wiz-split" data-id="${s.id}">
      <b>${s.label}</b>
      <small>${s.days.length} Tag${s.days.length > 1 ? 'e' : ''} pro Woche · ${[...new Set(s.days.map(d => d[0].replace(/ [AB]$/, '')))].join(' · ')}</small>
    </button>`).join('')}
    ${wiz.split || custom ? `<label class="lbl">Name des Plans
        <input class="inp" type="text" data-field="wiz-name" value="${esc(wiz.name)}"></label>
      <div class="row" style="margin-top:0"><span>Trainingswochen<br><small class="hint">inkl. Intro, danach Deload</small></span>
        <div class="stepper">${[4, 5].map(n =>
          `<button class="toggle ${wiz.weeks === n ? 'on' : ''}" data-action="wiz-weeks" data-n="${n}">${n}</button>`).join('')}</div></div>
      ${startWeekRow()}` : ''}
  </div>`;
  if (!custom && !wiz.split) return h + navRow('cancel', null);

  if (custom) {
    const lib = dayLibrary();
    h += `<div class="card"><h2>Vorhandene Trainingstage</h2>
      <p class="hint">Antippen fügt den Tag zum neuen Plan hinzu.</p>
      <div class="group-chips">${lib.map((t, i) =>
        `<button class="gchip" data-action="wiz-lib-add" data-i="${i}">+ ${esc(t.name)}</button>`).join('')}</div>`;
    const own = data.dayTemplates;
    if (own.length) {
      h += `<p class="lbl chips-title">Selbst erstellt</p><ul class="list reorder">${own.map(t => `<li class="bw-row">
        <span>${esc(t.name)} <small class="hint">· ${t.groups.map(g => MUSCLES[g]).join(', ')}</small></span>
        <button class="icon-btn danger" data-action="wiz-lib-del" data-id="${t.id}" aria-label="Löschen">✕</button></li>`).join('')}</ul>`;
    }
    const nd = wiz.newDay;
    h += `</div><div class="card new-day"><h2>Neuen Trainingstag erstellen</h2>
      <input class="inp" type="text" data-field="wiz-newday-name" placeholder="Name, z. B. Rücken/Bizeps" value="${esc(nd.name)}">
      <div class="variants">${[['heavy', 'Schwer'], ['light', 'Leicht']].map(([k, l]) =>
        `<button class="vchip ${nd.intensity === k ? 'on' : ''}" data-action="wiz-newday-int" data-k="${k}">${l}</button>`).join('')}</div>
      <div class="group-chips">${PLAN_GROUPS.map(g =>
        `<button class="gchip ${nd.groups.includes(g) ? 'on' : ''}" data-action="wiz-newday-group" data-g="${g}">${MUSCLES[g]}</button>`).join('')}</div>
      <div class="row"><button class="btn primary" data-action="wiz-newday-save">Trainingstag speichern und hinzufügen</button></div>
      <p class="hint">Wird dauerhaft gespeichert und steht später wieder zur Auswahl.</p>
    </div>`;
  }

  h += `<h2>Trainingstage im neuen Plan (${wiz.days.length})</h2>`;
  if (!wiz.days.length) h += '<p class="hint">Noch keine Tage – oben einen vorhandenen Tag antippen oder einen neuen erstellen.</p>';
  wiz.days.forEach((d, di) => { h += dayCard(d, di, custom); });
  return h + navRow('cancel', 'prio');
}

// Schwerpunkt-Fragen: wie die Beschwerde-Abfrage, höchstens 2 Muskelgruppen
function renderWizFocus(kind) {
  const prio = kind === 'prio';
  const sel = prio ? wiz.prio : wiz.low;
  const other = prio ? wiz.low : wiz.prio;
  return `<div class="card check">
    <div class="check-emoji" aria-hidden="true">${prio ? '⭐' : '😌'}</div>
    <h2 class="question">${prio ? 'Welche Muskelgruppen möchtest du priorisieren?' : 'Welche Muskelgruppen können gerade etwas low machen?'}</h2>
    <p class="hint">Höchstens ${MAX_FOCUS} auswählen · ${prio ? `+${FOCUS_SETS}` : `−${FOCUS_SETS}`} Sätze pro Woche${sel.length ? ` · gewählt: ${sel.length}` : ''}</p>
    <div class="area-grid">${wizGroups().map(g => `<button class="vchip ${sel.includes(g) ? 'on' : ''}"
      data-action="wiz-focus" data-kind="${kind}" data-g="${g}" ${other.includes(g) ? 'disabled' : ''}>${MUSCLES[g]}</button>`).join('')}</div>
    <div class="row">
      <button class="btn" data-action="wiz-focus-none" data-kind="${kind}" data-to="${prio ? 'low' : 'volume'}">Keine</button>
      <button class="btn primary" data-action="wiz-step" data-to="${prio ? 'low' : 'volume'}">Weiter</button>
    </div>
  </div>
  <div class="row"><button class="btn" data-action="wiz-step" data-to="${prio ? 'days' : 'prio'}">Zurück</button></div>`;
}

function renderWizard() {
  if (!wiz) return '<p class="hint">Der Assistent wurde beendet.</p><button class="btn primary" data-action="wiz-start">Neu starten</button>';
  let h = wizSteps();
  if (wiz.step === 'days') return h + renderWizDays();
  if (wiz.step === 'prio' || wiz.step === 'low') return h + renderWizFocus(wiz.step);
  const groups = wizGroups();

  if (wiz.step === 'volume') {
    h += `<div class="card"><h2>Volumen</h2>
      <p class="hint">Sätze <b>pro Training</b> je Muskelgruppe – antippen und Zahl ändern. Die Wochensumme ergibt sich aus der Zahl der Tage mit dieser Muskelgruppe.</p>
      <table class="rir vol">${weekHead()}`;
    for (const g of groups) {
      h += `<tr><td>${MUSCLES[g]}</td>` + wiz.volume[g].map((v, w) =>
        `<td><input class="vol-inp" type="text" inputmode="numeric" pattern="[0-9]*" data-field="wiz-vol" data-g="${g}" data-w="${w}" value="${v}"></td>`).join('') +
        `</tr><tr class="vol-week"><td colspan="5"><span data-wizweek="${g}">${wizWeekText(g)}</span>${focusBadge(g)}</td></tr>`;
    }
    return h + '</table></div>' + navRow('low', 'rir');
  }

  if (wiz.step === 'rir') {
    h += `<div class="card"><h2>Reps in Reserve</h2>
      <p class="hint">Ziel im Tank je Muskelgruppe und Woche für <b>normale</b> Übungen. Grundübungen bekommen +1, Assistenzübungen −1 (nie unter 0). Deload immer mind. ${DELOAD_RIR}.</p>
      <table class="rir vol">${weekHead()}
      <tr class="all-row"><td><b>Alle</b></td>${[0, 1, 2, 3].map(w =>
        `<td><input class="vol-inp" type="text" inputmode="decimal" data-field="wiz-rir-all" data-w="${w}" placeholder="–"></td>`).join('')}</tr>`;
    for (const g of groups) {
      h += `<tr><td>${MUSCLES[g]}</td>` + wiz.rir[g].map((v, w) =>
        `<td><input class="vol-inp" type="text" inputmode="decimal" data-field="wiz-rir" data-g="${g}" data-w="${w}" value="${fmtNum(v)}"></td>`).join('') + '</tr>';
    }
    return h + '</table><p class="hint">„Alle“: eine Zahl eintragen setzt die ganze Spalte auf einmal.</p></div>' + navRow('volume', 'auto');
  }

  if (wiz.step === 'auto') {
    return h + `<div class="card check">
      <div class="check-emoji" aria-hidden="true">🤖</div>
      <h2 class="question">Soll ein passender Plan automatisch erstellt werden?</h2>
      <div class="row">
        <button class="btn primary" data-action="wiz-auto" data-yes="1">Ja</button>
        <button class="btn primary" data-action="wiz-auto">Nein</button>
      </div>
      <p class="hint">Ja: Die App wählt die Übungen (bevorzugt aus deinem aktiven Plan, wenig Volumen = komplexe Übungen zuerst).
        Nein: Du wählst die Übungen pro Muskelgruppe selbst aus.</p>
    </div>` + navRow('rir', null);
  }

  if (wiz.step === 'manual') {
    const g = groups[wiz.gi];
    const picks = wiz.picks[g] || [];
    const sugg = (DEFAULT_PICKS[g] || EXERCISE_LIST.filter(([, , gr]) => gr === g).map(([n]) => n).slice(0, 5))
      .filter(n => !picks.some(p => nameKey(p) === nameKey(n)));
    const n = exercisesNeeded(g);
    return h + `<div class="card"><h2>${MUSCLES[g]}${focusBadge(g)}</h2>
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

  // Vorschau
  h += `<h2>Vorschau · ${esc(wiz.name)}</h2>`;
  if (wiz.prio.length || wiz.low.length) {
    h += `<p class="hint">${wiz.prio.length ? `⭐ Priorität: ${wiz.prio.map(g => MUSCLES[g]).join(', ')}` : ''}
      ${wiz.prio.length && wiz.low.length ? ' · ' : ''}${wiz.low.length ? `😌 Low: ${wiz.low.map(g => MUSCLES[g]).join(', ')}` : ''}</p>`;
  }
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
  // höchstens 3 Sätze pro Übung: zu wenige Übungen für das Volumen?
  const tight = groups.filter(g => (wiz.picks[g] || []).length && wiz.picks[g].length * MAX_SETS_PER_EX < Math.max(...wiz.volume[g]));
  if (tight.length) {
    h += `<p class="complaint-note">Zu wenige Übungen für höchstens ${MAX_SETS_PER_EX} Sätze pro Übung: ${tight.map(g =>
      `${MUSCLES[g]} (${Math.max(...wiz.volume[g])} Sätze → mind. ${Math.ceil(Math.max(...wiz.volume[g]) / MAX_SETS_PER_EX)} Übungen)`).join(', ')}. Überzählige Sätze fallen weg.</p>`;
  }
  return h + `<button class="btn outline" data-action="wiz-adjust">Übungen anpassen</button>
    <div class="row"><button class="btn" data-action="wiz-step" data-to="auto">Zurück</button>
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

// Tag in den Entwurf übernehmen; gleicher Name schon da -> „B“, „C“ … anhängen
function wizAddDay(t) {
  let name = t.name;
  for (let i = 1; wiz.days.some(d => nameKey(d.name) === nameKey(name)); i++) name = `${t.name} ${String.fromCharCode(65 + i)}`;
  wiz.days.push({ name, intensity: t.intensity, groups: [...t.groups] });
}

views.wizard = { title: 'Neuer Plan', tab: 'plan', back: 'plan', render: renderWizard };

Object.assign(actions, {
  'wiz-start': () => wizStart(),
  'wiz-cancel': () => { wiz = null; go('plan'); },
  'wiz-weeks': el => { wiz.weeks = Number(el.dataset.n); render(); },
  'wiz-startweek': el => { wiz.startWeek = el.dataset.w; render(); },
  // Aufteilung wählen (leer = zurück zur Vorauswahl); gibt es nur eine Vorlage, wird sie direkt gewählt
  'wiz-cat': el => {
    wiz.cat = el.dataset.cat || null;
    wiz.split = null;
    wiz.days = [];
    Object.assign(wiz, { volume: {}, volKey: {}, rir: {}, picks: {}, prio: [], low: [] });
    const list = SPLITS.filter(s => s.tag === wiz.cat);
    if (list.length === 1) { wiz.split = list[0].id; wiz.days = splitDays(wiz.split); }
    go('wizard');
  },
  // Vorlage wählen: Tage neu setzen, Volumen/RIR/Übungen werden danach neu vorgeschlagen
  'wiz-split': el => {
    wiz.split = el.dataset.id;
    wiz.days = splitDays(wiz.split);
    Object.assign(wiz, { volume: {}, volKey: {}, rir: {}, picks: {}, prio: [], low: [] });
    render();
  },
  'wiz-lib-add': el => { wizAddDay(dayLibrary()[Number(el.dataset.i)]); render(); },
  'wiz-lib-del': el => {
    const t = data.dayTemplates.find(x => x.id === el.dataset.id);
    if (!confirm(`Eigenen Trainingstag „${t.name}“ dauerhaft löschen?`)) return;
    data.dayTemplates = data.dayTemplates.filter(x => x !== t);
    saveData(); render();
  },
  'wiz-newday-int': el => { wiz.newDay.intensity = el.dataset.k; render(); },
  'wiz-newday-group': el => {
    const nd = wiz.newDay, g = el.dataset.g;
    nd.groups = nd.groups.includes(g) ? nd.groups.filter(x => x !== g) : [...nd.groups, g];
    render();
  },
  // neuen Trainingstag dauerhaft speichern (data.dayTemplates) und gleich in den Entwurf übernehmen
  'wiz-newday-save': () => {
    const nd = wiz.newDay;
    if (!nd.name.trim()) { alert('Bitte einen Namen für den Trainingstag eingeben.'); return; }
    if (!nd.groups.length) { alert('Bitte mindestens eine Muskelgruppe auswählen.'); return; }
    const t = { id: uid(), name: nd.name.trim(), intensity: nd.intensity, groups: [...nd.groups] };
    data.dayTemplates.push(t);
    saveData();
    wizAddDay(t);
    wiz.newDay = { name: '', intensity: 'heavy', groups: [] };
    render();
    toast(`„${t.name}“ gespeichert und hinzugefügt`);
  },
  'wiz-day-del': el => { wiz.days.splice(Number(el.dataset.d), 1); render(); },
  'wiz-dayint': el => { wiz.days[el.dataset.d].intensity = el.dataset.k; render(); },
  'wiz-daygroup': el => {
    const d = wiz.days[el.dataset.d], g = el.dataset.g;
    d.groups = d.groups.includes(g) ? d.groups.filter(x => x !== g) : [...d.groups, g];
    render();
  },
  'wiz-focus': el => {
    const list = el.dataset.kind === 'prio' ? wiz.prio : wiz.low;
    const g = el.dataset.g;
    const i = list.indexOf(g);
    if (i >= 0) list.splice(i, 1);
    else if (list.length >= MAX_FOCUS) { toast(`Höchstens ${MAX_FOCUS} Muskelgruppen`); return; }
    else list.push(g);
    render();
  },
  'wiz-focus-none': el => {
    if (el.dataset.kind === 'prio') wiz.prio = []; else wiz.low = [];
    actions['wiz-step'](el);
  },
  'wiz-step': el => {
    const to = el.dataset.to;
    if (wiz.step === 'days' && to === 'prio') {
      if (!wiz.days.length) { alert('Bitte mindestens einen Trainingstag hinzufügen.'); return; }
      if (!wizGroups().length) { alert('Bitte den Trainingstagen Muskelgruppen zuweisen.'); return; }
      // Schwerpunkte nur für Muskelgruppen, die noch im Plan sind
      wiz.prio = wiz.prio.filter(g => wizGroups().includes(g));
      wiz.low = wiz.low.filter(g => wizGroups().includes(g));
    }
    if (to === 'volume') syncGroups();
    wiz.step = to;
    go('wizard');
  },
  'wiz-auto': el => {
    if (el.dataset.yes) {
      for (const g of wizGroups()) wiz.picks[g] = autoPicks(g);
      wiz.step = 'preview';
    } else {
      wiz.gi = 0;
      wiz.step = 'manual';
    }
    go('wizard');
  },
  'wiz-adjust': () => { wiz.gi = 0; wiz.step = 'manual'; go('wizard'); },
  'wiz-gprev': () => { if (wiz.gi > 0) wiz.gi--; else wiz.step = 'auto'; go('wizard'); },
  'wiz-gnext': () => { if (wiz.gi < wizGroups().length - 1) wiz.gi++; else wiz.step = 'preview'; go('wizard'); },
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
    data.cycle.start = wiz.startWeek;  // der neue Plan beginnt mit seiner Intro-Woche
    saveData();
    wiz = null;
    toast(`„${plan.name}“ erstellt und aktiv ✔`);
    go('plan');
  },
});

Object.assign(fields, {
  'wiz-name': el => { wiz.name = el.value; },
  'wiz-start-date': el => {
    if (!el.value) return;
    wiz.startWeek = mondayISO(el.value + 'T12:00:00');
    render();
  },
  'wiz-dayname': el => { wiz.days[el.dataset.d].name = el.value; },
  'wiz-newday-name': el => { wiz.newDay.name = el.value; },
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
