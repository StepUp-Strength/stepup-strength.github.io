'use strict';

/* ---------- Diagramme (Übungen & Körpergewicht) ---------- */

const DAY = 86400000;
const RANGES = [['1M', 30], ['3M', 91], ['6M', 182], ['1J', 365], ['Alle', 0]];

// mode: 'ex' = Übung, 'bw' = Körpergewicht, 'ton' = Tonnage, 'awards' = Erfolge
// metric: 'weight' = schwerster Satz, 'max10' = geschätztes Max.; tonBy: 'session' | 'week'
// end = rechter Rand des Zeitfensters (null = heute); sel = Zeitpunkt des angetippten Punkts
// withDeload: Übungen – Trainings aus Deload-Wochen mitzeigen (sonst verzerren sie den Verlauf)
const chartState = { mode: 'ex', name: '', metric: 'weight', variant: '', withDeload: false, tonBy: 'session', range: 91, end: null, sel: null };
let chartGeo = null;  // Geometrie der zuletzt gezeichneten Grafik (für Antippen und Ziehen)

const todayISO = () => new Date().toLocaleDateString('sv-SE');  // JJJJ-MM-TT
const round1 = x => Math.round(x * 10) / 10;

function historyNames() {
  const seen = new Map();
  for (const s of sessionsNewestFirst()) {
    for (const e of s.entries) if (!seen.has(nameKey(e.name))) seen.set(nameKey(e.name), e.name);
  }
  return [...seen.values()];
}

/* ---------- Erfolge ---------- */

// Erfolge sind Serien mit Stufen: Nach jeder erreichten Stufe kommt die nächste – endlos, wenn step gesetzt ist.
// def: { id, cat, goals, step, names, icons, name(g), desc(g), value(ctx), fmt(v) }
const AWARD_CATS = ['Trainings', 'Tonnage', 'Kraft', 'Übungen', 'Schritte'];

const goalAt = (def, i) => i < def.goals.length ? def.goals[i]
  : def.step ? def.goals[def.goals.length - 1] + def.step * (i - def.goals.length + 1) : null;

const fmtCount = v => `${v}`;
const fmtT = v => fmtTons(v * 1000);
const deNum = v => v.toLocaleString('de-DE');

const STATIC_SERIES = [
  { id: 'count', cat: 'Trainings', goals: [1, 10, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 750, 1000], step: 250,
    names: ['Erster Schritt', 'Dranbleiber', 'Stammgast', 'Eisenhart', 'Gewohnheitstier', 'Hundertschaft', 'Eisenfreund',
      'Doppelhundert', 'Legende', 'Dreihundert', 'Unaufhaltsam', 'Halbes Tausend', 'Urgestein', 'Tausendsassa'],
    icons: ['👟', '🎯', '⭐', '🏅', '🐾', '🏆', '🤝', '✌️', '👑', '🔱', '🚀', '🌟', '🗿', '🎖️'],
    name: g => `Trainings-Veteran ${deNum(g)}`, desc: g => g === 1 ? 'Erstes Training gespeichert' : `${deNum(g)} Trainings gespeichert`,
    value: c => c.count, fmt: fmtCount },
  { id: 'streak', cat: 'Trainings', goals: [2, 4, 8, 12, 26, 52], step: 26,
    names: ['Im Rhythmus', 'Gewohnheit', 'Zwei Monate stark', 'Quartalsheld', 'Halbjahres-Held', 'Ganzjahres-Athlet'],
    icons: ['🔗', '📈', '🧭', '🛡️', '🌗', '🌍'],
    name: g => `${g} Wochen am Stück`, desc: g => `${g} Wochen in Folge mit mindestens 3 Trainings`,
    value: c => c.streak, fmt: v => `${v} Wochen` },
  { id: 'fullweek', cat: 'Trainings', goals: [1, 5, 10, 25, 50], step: 25,
    names: ['Volle Woche', 'Fünf volle Wochen', 'Zehn volle Wochen', 'Vollzeit-Athlet', 'Wochen-Weltmeister'], icons: ['📆'],
    name: g => `${g} volle Wochen`, desc: g => g === 1 ? '4 Trainings in einer Woche' : `${g} Wochen mit 4 Trainings`,
    value: c => c.fullWeeks, fmt: fmtCount },
  { id: 'cycles', cat: 'Trainings', goals: [1, 3, 6, 12], step: 6,
    names: ['Zyklus geschafft', 'Dreifach-Zykliker', 'Halbjahres-Zykliker', 'Zyklus-Meister'], icons: ['🔄'],
    name: g => `${g} Zyklen`, desc: g => g === 1 ? 'Eine Deload-Woche absolviert' : `${g} Zyklen inklusive Deload`,
    value: c => c.cycles, fmt: fmtCount },
  { id: 'total', cat: 'Tonnage', goals: [1, 10, 50, 100, 250, 500, 1000, 2500, 5000, 7500, 10000], step: 5000,
    names: ['Erste Tonne', 'Möbelpacker', 'Umzugsprofi', 'Kraftprotz', 'Gabelstapler', 'Elefantenstemmer',
      'Tonnen-Titan', 'Containerschiff', 'Kranführer', 'Lokomotive', 'Eiffelturm'],
    icons: ['🧱', '📦', '🚚', '💪', '🏗️', '🐘', '🦍', '🚢', '🏗️', '🚂', '🗼'],
    name: g => `Schwerlast ${deNum(g)} t`, desc: g => `${deNum(g)} t insgesamt bewegt`,
    value: c => c.total / 1000, fmt: fmtT },
  { id: 'month', cat: 'Tonnage', goals: [10, 25, 50, 75, 100], step: 25,
    names: ['Fleißiger Monat', 'Monats-Malocher', 'Vulkanmonat', 'Monats-Monster', 'Hundert-Tonnen-Monat'],
    icons: ['📅', '🔥', '🌋', '👹', '💥'],
    name: g => `Monat mit ${g} t`, desc: g => `${g} t in einem Kalendermonat`,
    value: c => c.month / 1000, fmt: fmtT },
  { id: 'session', cat: 'Tonnage', goals: [5, 10, 15, 20, 25], step: 5,
    names: ['Schwerstarbeiter', 'Eisenfresser', 'Maschine', 'Bulldozer', 'Abrissbirne'],
    icons: ['⚒️', '🏋️', '🦾', '🚜', '💣'],
    name: g => `${g} t an einem Tag`, desc: g => `${g} t in einem Training`,
    value: c => c.session / 1000, fmt: fmtT },
  // Kraft im Verhältnis zum Körpergewicht (braucht Einträge unter Diagramme → Körpergewicht)
  { id: 'rel-bench', cat: 'Kraft', goals: [1, 1.25, 1.5], names: ['Eigengewicht gedrückt', 'Bankdrück-Ass', 'Bank-Bestie'],
    icons: ['⚖️'], desc: g => `Bankdrücken (Langhantel) mit ${fmtNum(g)} × Körpergewicht`,
    value: c => c.rel.bench, fmt: v => `${fmtNum(round2(v))} ×` },
  { id: 'rel-squat', cat: 'Kraft', goals: [1, 1.5, 2], names: ['Eigengewicht gebeugt', 'Anderthalbfach', 'Doppelt gebeugt'],
    icons: ['⚖️'], desc: g => `Kniebeugen mit ${fmtNum(g)} × Körpergewicht`,
    value: c => c.rel.squat, fmt: v => `${fmtNum(round2(v))} ×` },
  { id: 'rel-rdl', cat: 'Kraft', goals: [1.25, 1.5, 1.75, 2],
    names: ['Eigengewicht plus Viertel', 'Anderthalbfach gehoben', 'Fast doppelt', 'Doppeltes Ich'],
    icons: ['⚖️'], desc: g => `Rumänisches Kreuzheben mit ${fmtNum(g)} × Körpergewicht`,
    value: c => c.rel.dead, fmt: v => `${fmtNum(round2(v))} ×` },
  // Wiederholungen in einem Satz
  { id: 'reps-pullup', cat: 'Kraft', goals: [5, 10, 15, 20, 25, 30],
    names: ['Klimmzug-Starter', 'Zweistellig', 'Klimmzug-Könner', 'Klimmzug-Kanone', 'Affenkönig', 'Klimmzug-Legende'],
    icons: ['🐒'], desc: g => `${g} Klimmzüge in einem Satz`, value: c => c.reps.pullup, fmt: v => `${v} Wdh.` },
  { id: 'reps-dips', cat: 'Kraft', goals: [10, 20, 30, 40],
    names: ['Dips-Starter', 'Dips-Dauerläufer', 'Dips-Dynamo', 'Dips-Dampfhammer'],
    icons: ['🪜'], desc: g => `${g} Dips in einem Satz`, value: c => c.reps.dips, fmt: v => `${v} Wdh.` },
  { id: 'reps-pushup', cat: 'Kraft', goals: [20, 40, 60, 80, 100],
    names: ['Liegestütz-Lehrling', 'Liegestütz-Profi', 'Liegestütz-Pumpe', 'Liegestütz-Panzer', 'Hundert am Stück'],
    icons: ['🙌'], desc: g => `${g} Liegestütze in einem Satz`, value: c => c.reps.pushup, fmt: v => `${v} Wdh.` },
];

const GROUP_ICONS = {
  brust: '🛡️', lat: '🦅', trapez: '🐂', schulter_vorne: '🎳', schulter_seite: '🎳', schulter_hinten: '🎳',
  bizeps: '💪', trizeps: '🔱', unterarme: '✊', quadrizeps: '🦵', beinbeuger: '🦿', gesaess: '🍑',
  adduktoren: '🦋', abduktoren: '🦋', waden: '🦶', bauch: '🍫', ruecken_unten: '🌉', ganzkoerper: '⚡', ausdauer: '🏃',
};

// Besondere Namen für Gewichts-Meilensteine der großen drei (Grundübungen steigen in 5-kg-Schritten)
const LIFT_NAMES = [
  [/^bankdrucken flachbank \(langhantel\)$/, {
    75: 'Bank-Aufsteiger', 80: 'Achtziger-Drücker', 85: 'Bank-Routinier', 90: 'Neunziger-Club', 95: 'Kurz vor der Hundert',
    100: 'Hunderter-Club', 110: 'Bank-Graf', 120: 'Bank-Baron', 130: 'Bank-Fürst', 140: 'Bank-König',
  }],
  [/^(kniebeugen \(langhantel\)|frontkniebeugen)$/, {
    105: 'Beuge-Beginner', 110: 'Stahlschenkel', 115: 'Tiefgänger', 120: 'Säulenheiliger', 125: 'Kniebeugen-Kämpfer',
    130: 'Beinpresse auf zwei Beinen', 140: 'Kniebeugen-Koloss', 150: 'Anderthalb-Zentner', 160: 'Oberschenkel-Titan',
    180: 'Kniebeugen-Kaiser', 200: 'Zwei-Zentner-Beuger',
  }],
  [/^kreuzheben rumanisch \(langhantel\)$/, {
    125: 'Hinterketten-Starter', 130: 'Rücken wie ein Brett', 135: 'Beinbeuger-Bändiger', 140: 'Erdbeweger',
    150: 'Anderthalb-Zentner-Heber', 160: 'Hüftgelenk-Held', 170: 'Hinterketten-Held', 180: 'Erdanheber',
    200: 'Doppelzentner',
  }],
];
const REL_LIFTS = {
  bench: /^bankdrucken flachbank \(langhantel\)$/,
  squat: /^(kniebeugen \(langhantel\)|frontkniebeugen|kniebeugen safety bar|kniebeugen box)$/,
  dead: /^kreuzheben rumanisch \(langhantel\)$/,
};

const shortName = n => n.replace(/\s*\(.*?\)\s*/g, ' ').trim();

// Für jede trainierte Übung: Gewichts-Meilensteine ab dem ersten Gewicht –
// Grundübungen, Kurzhantel- und Assistenzübungen in 5-kg-Schritten, sonst in 10-kg-Schritten
function weightSeries(name, k, firstWeight) {
  const kind = kindOf({ name });
  const step = kind === 'compound' || kind === 'assist' || /kurzhantel/.test(norm(name)) ? 5 : 10;
  const special = (LIFT_NAMES.find(([re]) => re.test(norm(name))) || [null, {}])[1];
  return {
    id: `w-${k}`, cat: 'Übungen', goals: [(Math.floor(firstWeight / step) + 1) * step], step,
    names: [], icons: [GROUP_ICONS[groupOf({ name })] || '🏋️'],
    name: g => special[g] || `${shortName(name)}: ${g} kg`, desc: g => `Erstmals ${g} kg bei ${name}`,
    value: c => c.maxW[k] || 0, fmt: v => `${fmtNum(v)} kg`,
  };
}

// Für jede trainierte Übung: Treue (Anzahl Trainings mit dieser Übung)
function loyaltySeries(name, k) {
  const s = shortName(name);
  return {
    id: `n-${k}`, cat: 'Übungen', goals: [10, 25, 50, 100, 200], step: 100,
    names: [`${s}-Fan`, `${s}-Profi`, `${s}-Meister`, `${s}-Legende`, `${s}-Ikone`],
    icons: [GROUP_ICONS[groupOf({ name })] || '🏋️'],
    name: g => `${s}: ${g} Trainings`, desc: g => `${g} Trainings mit ${name}`,
    value: c => c.exCount[k] || 0, fmt: fmtCount,
  };
}

function awardAt(def, i, g) {
  return {
    id: `${def.id}:${g}`, cat: def.cat, icon: def.icons[Math.min(i, def.icons.length - 1)],
    name: def.names[i] || def.name(g), desc: def.desc(g),
  };
}

// Wochen in Folge (bis einschließlich w) mit mindestens 3 Trainings
function streakEnding(weeks, w) {
  let n = 0;
  for (let cur = w; (weeks[cur] || 0) >= 3; cur = addWeeks(cur, -1)) n++;
  return n;
}

// Schritt-Erfolge (aus Diagramme → Schritte bzw. Apple Health)
const STEP_SERIES = [
  { id: 'steps-day', cat: 'Schritte', goals: [5000, 7500, 10000, 12500, 15000, 20000, 25000, 30000], step: 5000,
    names: ['Spaziergänger', 'Flotter Geher', 'Zehntausender', 'Wandersmann', 'Marschierer', 'Halbmarathon zu Fuß', 'Langstreckler', 'Ultra-Geher'],
    icons: ['🚶', '👞', '👟', '🥾', '🎒', '🏞️', '🗺️', '🦶'],
    name: g => `${deNum(g)} Schritte`, desc: g => `${deNum(g)} Schritte an einem Tag`,
    value: c => c.maxDay, fmt: v => deNum(v) },
  { id: 'steps-total', cat: 'Schritte', goals: [100000, 250000, 500000, 1000000, 2500000, 5000000, 10000000], step: 5000000,
    names: ['Hunderttausend', 'Viertelmillion', 'Halbe Million', 'Schritt-Millionär', 'Weltenbummler', 'Fünf Millionen', 'Zehn Millionen'],
    icons: ['📍', '🧭', '🗺️', '💰', '🌍', '🚀', '🌌'],
    name: g => `${deNum(g)} Schritte gesamt`, desc: g => `${deNum(g)} Schritte insgesamt`,
    value: c => c.total, fmt: v => deNum(v) },
  { id: 'steps-10k-days', cat: 'Schritte', goals: [1, 7, 30, 100, 365], step: 365,
    names: ['Erster 10.000er-Tag', 'Eine Woche voll', 'Ein Monat voll', 'Hundert starke Tage', 'Ein Jahr voll'], icons: ['✅'],
    name: g => `${deNum(g)} Tage mit 10.000`, desc: g => g === 1 ? 'Ein Tag mit mindestens 10.000 Schritten' : `${deNum(g)} Tage mit mindestens 10.000 Schritten`,
    value: c => c.days10k, fmt: fmtCount },
  { id: 'steps-streak', cat: 'Schritte', goals: [3, 7, 14, 30], step: 30,
    names: ['Drei am Stück', 'Wochen-Streak', 'Zwei Wochen am Stück', 'Monats-Streak'], icons: ['🔥'],
    name: g => `${g} Tage am Stück`, desc: g => `${g} Tage in Folge mit mindestens 10.000 Schritten`,
    value: c => c.streak, fmt: v => `${v} Tage` },
];

function stepsProgress() {
  const c = { maxDay: 0, total: 0, days10k: 0, streak: 0 };
  const series = STEP_SERIES.map(def => ({ def, i: 0 }));
  const done = [];
  let run = 0, prevDate = null;
  for (const s of [...data.steps].sort((a, b) => a.date.localeCompare(b.date))) {
    c.total += s.steps;
    c.maxDay = Math.max(c.maxDay, s.steps);
    if (s.steps >= 10000) {
      c.days10k++;
      const yesterday = new Date(s.date + 'T12:00:00');
      yesterday.setDate(yesterday.getDate() - 1);
      run = prevDate === yesterday.toLocaleDateString('sv-SE') && run > 0 ? run + 1 : 1;
      c.streak = Math.max(c.streak, run);
    } else {
      run = 0;
    }
    prevDate = s.date;
    for (const st of series) {
      for (let g = goalAt(st.def, st.i); g != null && st.def.value(c) >= g && st.i < 1000; g = goalAt(st.def, st.i)) {
        done.push({ ...awardAt(st.def, st.i, g), date: s.date + 'T12:00:00' });
        st.i++;
      }
    }
  }
  const next = series.map(st => {
    const g = goalAt(st.def, st.i);
    return g == null ? null : { ...awardAt(st.def, st.i, g), value: st.def.value(c), goal: g, fmt: st.def.fmt };
  }).filter(Boolean);
  return { done, next };
}

// Alle Erfolge: Training und Schritte
function achievementProgress() {
  const a = trainingProgress(), b = stepsProgress();
  return { done: [...a.done, ...b.done], next: [...a.next, ...b.next] };
}

// Alle Trainings-Erfolge chronologisch aus dem Verlauf nachrechnen.
// Ergebnis: done = freigeschaltete Stufen (mit Datum), next = jeweils nächste Stufe jeder Serie (mit Fortschritt)
function trainingProgress() {
  const c = {
    count: 0, total: 0, month: 0, session: 0, streak: 0, fullWeeks: 0, cycles: 0,
    rel: { bench: 0, squat: 0, dead: 0 }, reps: { pullup: 0, dips: 0, pushup: 0 }, maxW: {}, exCount: {},
  };
  const months = {}, weeks = {}, deloadWeeks = new Set(), known = new Set();
  const series = STATIC_SERIES.map(def => ({ def, i: 0 }));
  const body = [...data.bodyweight].sort((a, b) => a.date.localeCompare(b.date));
  const done = [];
  let bi = 0, bodyKg = null;

  for (const s of [...data.sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const ton = sessionTonnage(s);
    c.count++;
    c.total += ton;
    c.session = Math.max(c.session, ton);
    const m = s.date.slice(0, 7);
    months[m] = (months[m] || 0) + ton;
    c.month = Math.max(c.month, months[m]);
    const w = mondayISO(new Date(s.date));
    weeks[w] = (weeks[w] || 0) + 1;
    if (weeks[w] === 4) c.fullWeeks++;
    c.streak = Math.max(c.streak, streakEnding(weeks, w));
    if (s.deload) deloadWeeks.add(w);
    c.cycles = deloadWeeks.size;
    while (bi < body.length && body[bi].date.slice(0, 10) <= s.date.slice(0, 10)) bodyKg = body[bi++].kg;

    for (const e of s.entries) {
      const k = nameKey(e.name), n = norm(e.name);
      const maxW = Math.max(0, ...e.sets.map(x => x.weight || 0));
      const maxReps = Math.max(0, ...e.sets.map(x => x.reps || 0));
      c.exCount[k] = (c.exCount[k] || 0) + 1;
      if (!known.has(k)) { known.add(k); series.push({ def: loyaltySeries(e.name, k), i: 0 }); }
      // Gewichtsserie startet beim ersten Gewicht – Meilensteine liegen immer darüber
      if (maxW > 0 && !known.has('w' + k)) { known.add('w' + k); series.push({ def: weightSeries(e.name, k, maxW), i: 0 }); }
      c.maxW[k] = Math.max(c.maxW[k] || 0, maxW);
      if (/^klimmzuge/.test(n)) c.reps.pullup = Math.max(c.reps.pullup, maxReps);
      if (/^(dips|bankdips)/.test(n)) c.reps.dips = Math.max(c.reps.dips, maxReps);
      if (/^liegestutze/.test(n)) c.reps.pushup = Math.max(c.reps.pushup, maxReps);
      if (bodyKg) {
        for (const [key, re] of Object.entries(REL_LIFTS)) if (re.test(n)) c.rel[key] = Math.max(c.rel[key], maxW / bodyKg);
      }
    }

    for (const st of series) {
      for (let g = goalAt(st.def, st.i); g != null && st.def.value(c) >= g - 1e-9 && st.i < 1000; g = goalAt(st.def, st.i)) {
        done.push({ ...awardAt(st.def, st.i, g), date: s.date });
        st.i++;
      }
    }
  }

  const next = series.map(st => {
    const g = goalAt(st.def, st.i);
    return g == null ? null : { ...awardAt(st.def, st.i, g), value: st.def.value(c), goal: g, fmt: st.def.fmt };
  }).filter(Boolean);
  return { done, next };
}

const unlockedIds = () => new Set(achievementProgress().done.map(a => a.id));

function awardCard(a, open) {
  if (!open) {
    return `<div class="card award-row done"><span class="award-icon">${a.icon}</span>
      <div><b>${esc(a.name)}</b><small>${esc(a.desc)} · ${fmtDate(a.date)}</small></div></div>`;
  }
  const pct = Math.max(0, Math.min(100, Math.round(a.value / a.goal * 100)));
  return `<div class="card award-row"><span class="award-icon locked">${a.icon}</span>
    <div class="award-body"><b>${esc(a.name)}</b><small>${esc(a.desc)}</small>
      <div class="bar"><div style="width:${pct}%"></div></div>
      <small>${a.fmt(a.value)} von ${a.fmt(a.goal)}</small></div></div>`;
}

function renderAwards() {
  const { done, next } = achievementProgress();
  const open = next.sort((x, y) => y.value / y.goal - x.value / x.goal);
  let h = `<div class="stats one"><div class="stat"><span>Freigeschaltet</span><b>${done.length} Erfolge</b>
    <small>Jede Serie geht endlos weiter – nach jeder Stufe wartet die nächste.</small></div></div>`;
  h += '<h2>Als Nächstes</h2>' + open.slice(0, 6).map(a => awardCard(a, true)).join('');
  if (open.length > 6) {
    h += `<details class="award-cat"><summary>Alle nächsten Ziele (${open.length})</summary>
      ${open.slice(6).map(a => awardCard(a, true)).join('')}</details>`;
  }
  h += '<h2>Freigeschaltet</h2>';
  if (!done.length) h += '<p class="hint">Noch keine – speichere dein erstes Training!</p>';
  for (const cat of AWARD_CATS) {
    const list = done.filter(a => a.cat === cat).sort((x, y) => y.date.localeCompare(x.date));
    if (!list.length) continue;
    h += `<details class="award-cat" ${cat === 'Trainings' ? 'open' : ''}><summary>${cat} (${list.length})</summary>
      ${list.map(a => awardCard(a, false)).join('')}</details>`;
  }
  return h;
}

function showChartFor(name) {
  Object.assign(chartState, { name, variant: '', sel: null, end: null });
  render();
}

// Datenpunkte der gewählten Reihe, zeitlich aufsteigend
function chartPoints() {
  if (chartState.mode === 'steps') {
    return [...data.steps]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => ({ t: Date.parse(s.date + 'T12:00:00'), v: s.steps, unit: 'Schritte' }));
  }
  if (chartState.mode === 'ton') {
    const sessions = [...data.sessions].sort((a, b) => a.date.localeCompare(b.date));
    if (chartState.tonBy === 'week') {
      const weeks = new Map();
      for (const s of sessions) {
        const w = mondayISO(new Date(s.date));
        const p = weeks.get(w) || { t: Date.parse(w + 'T12:00:00'), kg: 0, n: 0 };
        p.kg += sessionTonnage(s); p.n++;
        weeks.set(w, p);
      }
      return [...weeks.values()].map(p => ({
        t: p.t, v: round1(p.kg / 1000), unit: 't', note: `Woche ab ${fmtDate(new Date(p.t).toISOString())} · ${p.n} Trainings`,
      }));
    }
    return sessions.map(s => ({
      t: Date.parse(s.date), v: round1(sessionTonnage(s) / 1000), unit: 't', deload: !!s.deload, note: s.dayName,
    }));
  }
  if (chartState.mode === 'bw') {
    return data.bodyweight
      .map(b => ({ t: Date.parse(b.date), v: b.kg, unit: 'kg' }))
      .sort((a, b) => a.t - b.t);
  }
  const k = nameKey(chartState.name);
  if (!k) return [];
  const pts = [];
  for (const s of [...data.sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    if (s.deload && !chartState.withDeload) continue;
    const e = s.entries.find(en => nameKey(en.name) === k);
    if (!e) continue;
    const sets = ofVariant(e.sets, chartState.variant);  // nur die gewählte Ausführung
    if (!sets.length) continue;
    const weighted = sets.filter(x => x.weight != null);
    let v, unit = 'kg';
    if (!weighted.length) {
      v = Math.max(...sets.map(x => x.reps || 0));  // Übung ohne Gewicht -> Wiederholungen
      unit = 'Wdh.';
    } else if (chartState.metric === 'max10') {
      const est = weighted.filter(x => x.reps != null).map(x => x.weight / repFactor(x.reps + (x.rir || 0)));
      if (!est.length) continue;
      v = round1(Math.max(...est));
    } else {
      v = Math.max(...weighted.map(x => x.weight));
    }
    pts.push({
      t: Date.parse(s.date), v, unit, sets,
      dayName: s.dayName, replacedFrom: e.replacedFrom, deload: !!s.deload,
    });
  }
  // Gemischte Einheiten: Einträge mit Gewicht haben Vorrang
  return pts.some(p => p.unit === 'kg') ? pts.filter(p => p.unit === 'kg') : pts;
}

// Sichtbares Zeitfenster [x0, x1] plus erlaubter Bereich für den rechten Rand
function chartWindow(pts) {
  const first = pts[0].t, last = pts[pts.length - 1].t;
  const rangeMs = chartState.range * DAY;
  if (!rangeMs) {
    const pad = Math.max((last - first) * 0.05, DAY);
    return { x0: first - pad, x1: last + pad, minEnd: last + pad, maxEnd: last + pad };
  }
  const maxEnd = Math.max(Date.now(), last) + DAY / 2;
  const minEnd = Math.min(maxEnd, first - DAY / 2 + rangeMs);
  const end = Math.min(maxEnd, Math.max(minEnd, chartState.end != null ? chartState.end : maxEnd));
  chartState.end = end;
  return { x0: end - rangeMs, x1: end, minEnd, maxEnd };
}

function niceStep(x) {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
}

function niceTicks(lo, hi) {
  if (hi - lo < 2) { lo -= 1; hi += 1; }
  const step = niceStep((hi - lo) / 4);
  const ticks = [];
  for (let v = Math.floor(lo / step) * step; v <= Math.ceil(hi / step) * step + 1e-9; v += step) ticks.push(round1(v));
  return ticks;
}

function fmtTick(t, spanDays) {
  return spanDays <= 100
    ? new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })
    : new Date(t).toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
}

function drawChart() {
  const area = document.getElementById('chart-area');
  const extra = document.getElementById('chart-extra');
  if (!area) return;
  const pts = chartPoints();
  if (!pts.length) {
    chartGeo = null;
    area.innerHTML = `<p class="hint chart-empty">${chartState.mode === 'bw'
      ? 'Noch kein Körpergewicht eingetragen.'
      : chartState.mode === 'ton' ? 'Noch keine Trainings gespeichert.'
      : chartState.mode === 'steps' ? 'Noch keine Schritte eingetragen.'
      : 'Für diese Übung gibt es noch keine Trainings mit Werten.'}</p>`;
    extra.innerHTML = '';
    updateRangeControls(null);
    return;
  }

  const win = chartWindow(pts);
  const { x0, x1 } = win;
  const vis = pts.filter(p => p.t >= x0 && p.t <= x1);
  const unit = pts[0].unit;

  // Maße
  const W = area.clientWidth, H = 250, L = 46, R = 14, T = 18, B = 30;
  const pw = W - L - R, ph = H - T - B;
  const ticks = niceTicks(...(vals => [Math.min(...vals), Math.max(...vals)])((vis.length ? vis : pts).map(p => p.v)));
  const lo = ticks[0], hi = ticks[ticks.length - 1];
  const X = t => L + (t - x0) / (x1 - x0) * pw;
  const Y = v => T + (1 - (v - lo) / (hi - lo)) * ph;

  let svg = `<svg class="chart-svg" width="${W}" height="${H}" role="img"
    aria-label="Verlauf ${esc(chartState.mode === 'bw' ? 'Körpergewicht' : chartState.name)}">
    <defs><clipPath id="plot-clip"><rect x="${L - 6}" y="0" width="${pw + 12}" height="${H}"/></clipPath></defs>`;

  // Raster und y-Achse
  for (const v of ticks) {
    svg += `<line class="c-grid" x1="${L}" x2="${L + pw}" y1="${Y(v)}" y2="${Y(v)}"/>
      <text class="c-text" x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${v >= 10000 ? deNum(v / 1000) + 'k' : fmtNum(v)}</text>`;
  }
  // x-Achse
  const spanDays = (x1 - x0) / DAY;
  const n = Math.max(2, Math.floor(pw / 85));
  for (let i = 0; i <= n; i++) {
    const t = x0 + i * (x1 - x0) / n;
    const anchor = i === 0 ? 'start' : i === n ? 'end' : 'middle';
    svg += `<text class="c-text" x="${X(t)}" y="${H - 8}" text-anchor="${anchor}">${fmtTick(t, spanDays)}</text>`;
  }

  // Fläche, Linie, Punkte (alle Punkte zeichnen, das Fenster schneidet ab -> Linie läuft durch)
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join('');
  svg += `<g clip-path="url(#plot-clip)">`;
  if (pts.length > 1) {
    svg += `<path class="c-area" d="${line}L${X(pts[pts.length - 1].t).toFixed(1)},${T + ph}L${X(pts[0].t).toFixed(1)},${T + ph}Z"/>
      <path class="c-line" d="${line}"/>`;
  }
  const sel = vis.find(p => p.t === chartState.sel);
  if (sel) svg += `<line class="c-cross" x1="${X(sel.t)}" x2="${X(sel.t)}" y1="${T}" y2="${T + ph}"/>`;
  const dots = vis.length <= 45 ? vis : [vis[vis.length - 1]];
  // Deload-Trainings als hohle Punkte
  for (const p of dots) svg += `<circle class="c-dot ${p.deload ? 'deload' : ''}" cx="${X(p.t)}" cy="${Y(p.v)}" r="4.5"/>`;
  if (sel) svg += `<circle class="c-dot sel" cx="${X(sel.t)}" cy="${Y(sel.v)}" r="7"/>`;
  svg += '</g></svg>';

  area.innerHTML = svg;
  if (!vis.length) {
    area.insertAdjacentHTML('beforeend', '<p class="chart-note">Keine Einträge in diesem Zeitraum – mit ‹ › oder Wischen verschieben.</p>');
  }
  if (sel) area.appendChild(tooltip(sel, unit, X(sel.t), Y(sel.v), W, H));

  chartGeo = { X, pw, x0, x1, vis, end: chartState.end };
  extra.innerHTML = chartStats(vis, unit);
  updateRangeControls(win);
}

// Infofeld zum angetippten Punkt (Namen per textContent, nicht als HTML)
function tooltip(p, unit, x, y, W, H) {
  const tip = document.createElement('div');
  tip.className = 'tip';
  const value = document.createElement('strong');
  value.textContent = `${unit === 'Schritte' ? deNum(p.v) : fmtNum(p.v)} ${unit}` +
    (chartState.mode === 'ex' && chartState.metric === 'max10' ? ' (Max. bei 10)' : '');
  tip.appendChild(value);
  const date = document.createElement('div');
  date.className = 'muted';
  date.textContent = fmtDate(new Date(p.t).toISOString());
  tip.appendChild(date);
  if (p.note) {
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent = p.note + (p.deload ? ' · Deload-Woche' : '');
    tip.appendChild(note);
  }
  if (p.sets) {
    const sets = document.createElement('div');
    sets.className = 'tip-sets';
    sets.textContent = p.sets.map(fmtSet).join('\n');
    tip.appendChild(sets);
    const day = document.createElement('div');
    day.className = 'muted';
    day.textContent = p.dayName + (p.deload ? ' · Deload-Woche' : '') +
      (p.replacedFrom ? ` · statt ${p.replacedFrom}` : '');
    tip.appendChild(day);
  }
  tip.style.visibility = 'hidden';
  document.getElementById('chart-area').appendChild(tip);
  // Neben den Punkt setzen (auf die Seite mit mehr Platz), senkrecht im Diagramm halten
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  const left = x > W / 2 ? x - tw - 16 : x + 16;
  tip.style.left = Math.min(W - tw - 6, Math.max(6, left)) + 'px';
  tip.style.top = Math.min(H - th, Math.max(6, y - th / 2)) + 'px';
  tip.style.visibility = '';
  return tip;
}

// Kennzahlen zur Tonnage (unabhängig vom Zeitfenster)
function tonnageStats() {
  const month = new Date().toLocaleDateString('sv-SE').slice(0, 7);
  const all = data.sessions.map(sessionTonnage);
  const total = all.reduce((a, b) => a + b, 0);
  const thisMonth = data.sessions.filter(s => s.date.slice(0, 7) === month).reduce((a, s) => a + sessionTonnage(s), 0);
  return `<div class="stats">
    <div class="stat"><span>Gesamt</span><b>${fmtTons(total)}</b></div>
    <div class="stat"><span>Dieser Monat</span><b>${fmtTons(thisMonth)}</b></div>
    <div class="stat"><span>Rekord-Training</span><b>${fmtTons(Math.max(0, ...all))}</b></div>
  </div>
  <button class="btn center" data-action="chart-mode" data-mode="awards">🏆 Erfolge ansehen</button>`;
}

// Kennzahlen zu den Schritten (unabhängig vom Zeitfenster)
function stepsStats() {
  const list = [...data.steps].sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return '';
  const last = list[list.length - 1];
  const week = list.slice(-7);
  const avg = Math.round(week.reduce((a, s) => a + s.steps, 0) / week.length);
  return `<div class="stats">
    <div class="stat"><span>${last.date === todayISO() ? 'Heute' : 'Zuletzt'}</span><b>${deNum(last.steps)}</b></div>
    <div class="stat"><span>Ø letzte 7</span><b>${deNum(avg)}</b></div>
    <div class="stat"><span>Rekord</span><b>${deNum(Math.max(...list.map(s => s.steps)))}</b></div>
  </div>`;
}

function chartStats(vis, unit) {
  if (chartState.mode === 'ton') return tonnageStats();
  if (chartState.mode === 'steps') return stepsStats();
  // Deload-Trainings sind bewusst leichter und zählen für Aktuell/Veränderung/Bestwert nicht
  if (vis.some(p => !p.deload)) vis = vis.filter(p => !p.deload);
  if (!vis.length) return '';
  const first = vis[0].v, last = vis[vis.length - 1].v;
  const diff = round1(last - first);
  const pct = first ? Math.round(diff / first * 100) : 0;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '±';
  const best = chartState.mode === 'bw'
    ? `<div class="stat"><span>Spanne</span><b>${fmtNum(Math.min(...vis.map(p => p.v)))}–${fmtNum(Math.max(...vis.map(p => p.v)))}</b></div>`
    : `<div class="stat"><span>Bestwert</span><b>${fmtNum(Math.max(...vis.map(p => p.v)))} ${unit}</b></div>`;
  let h = `<div class="stats">
    <div class="stat"><span>Aktuell</span><b>${fmtNum(last)} ${unit}</b></div>
    <div class="stat"><span>Veränderung</span><b>${sign}${fmtNum(Math.abs(diff))}</b><small>${sign}${Math.abs(pct)} %</small></div>
    ${best}
  </div>`;
  if (chartState.mode === 'ex') {
    h += `<button class="btn center" data-action="open-exercise" data-name="${esc(chartState.name)}">Alle Einträge als Liste</button>`;
  }
  return h;
}

function updateRangeControls(win) {
  const prev = document.querySelector('[data-action="chart-shift"][data-dir="-1"]');
  const next = document.querySelector('[data-action="chart-shift"][data-dir="1"]');
  const span = document.getElementById('chart-span');
  if (!prev) return;
  // Toleranz von einer Stunde, weil „heute“ bei jedem Zeichnen ein paar Millisekunden weiter ist
  prev.disabled = !win || !chartState.range || win.x1 <= win.minEnd + 3600000;
  next.disabled = !win || !chartState.range || win.x1 >= win.maxEnd - 3600000;
  span.textContent = win
    ? `${fmtDate(new Date(win.x0).toISOString())} – ${fmtDate(new Date(Math.min(win.x1, Date.now())).toISOString())}`
    : '';
}

function rangeRow() {
  return `<div class="range">
      <button class="icon-btn" data-action="chart-shift" data-dir="-1" aria-label="Früher">‹</button>
      ${RANGES.map(([label, days]) => `<button class="chip ${chartState.range === days ? 'on' : ''}"
        data-action="chart-range" data-days="${days}">${label}</button>`).join('')}
      <button class="icon-btn" data-action="chart-shift" data-dir="1" aria-label="Später">›</button>
    </div>
    <p class="span" id="chart-span"></p>`;
}

function bwList() {
  const list = [...data.bodyweight].sort((a, b) => b.date.localeCompare(a.date));
  if (!list.length) return '';
  return '<h2>Einträge</h2><ul class="list">' + list.map(b => `<li class="bw-row">
      <span>${fmtDate(b.date)}</span><b>${fmtNum(b.kg)} kg</b>
      <button class="icon-btn danger" data-action="bw-del" data-id="${b.id}" aria-label="Löschen">✕</button>
    </li>`).join('') + '</ul>';
}

function stepsList() {
  const list = [...data.steps].sort((a, b) => b.date.localeCompare(a.date));
  if (!list.length) return '';
  return '<h2>Einträge</h2><ul class="list">' + list.map(s => `<li class="bw-row">
      <span>${fmtDate(s.date + 'T12:00:00')}</span><b>${deNum(s.steps)}</b>
      <button class="icon-btn danger" data-action="steps-del" data-date="${s.date}" aria-label="Löschen">✕</button>
    </li>`).join('') + '</ul>';
}

/* ---------- Apple Health über die Zwischenablage ---------- */

// Ein Kurzbefehl kopiert z. B. „Datum: 2026-10-23 Schritte: 8.432 Gewicht: 89,4 kg“ in die Zwischenablage.
function healthCard() {
  return `<div class="card health">
    <button class="btn primary" data-action="health-paste">❤️ Aus Health einfügen</button>
    <p class="hint">Übernimmt Schritte und Gewicht, die dein Kurzbefehl in die Zwischenablage kopiert hat.</p>
    ${chartState.pasteBox ? `<textarea class="inp comment" id="health-text" rows="3"
        placeholder="Hier lange drücken → Einsetzen"></textarea>
      <div class="row"><button class="btn" data-action="health-apply">Übernehmen</button></div>` : ''}
  </div>`;
}

// Datum (JJJJ-MM-TT oder TT.MM.JJ[JJ]), Schritte und Gewicht aus dem Text lesen
function parseHealthText(text) {
  const t = String(text).replace(/ /g, ' ');
  let date = todayISO();
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  const de = t.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
  else if (de) date = `${de[3].length === 2 ? '20' + de[3] : de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`;

  let steps = null, kg = null;
  const sm = t.match(/(?:schritte|steps)\D{0,5}([\d.,' ]+)/i);
  if (sm) {
    // „8.432“ / „8 432“ = Tausenderpunkt; „8432,0“ / „8432.0“ = Nachkommastellen abschneiden
    const raw = sm[1].trim().replace(/[.,]\d{1,2}$/, '');
    const n = parseInt(raw.replace(/\D/g, ''), 10);
    if (isFinite(n) && n >= 0 && n < 200000) steps = n;
  }
  const wm = t.match(/(?:gewicht|weight)\D{0,5}(\d{2,3}(?:[.,]\d+)?)/i);
  if (wm) {
    const n = parseNum(wm[1]);
    if (n != null && n >= 20 && n <= 400) kg = Math.round(n * 10) / 10;
  }
  if (steps == null && kg == null) {
    // nur eine Zahl kopiert: große Zahl = Schritte
    const only = t.trim().match(/^[\d.,' ]+$/) && parseInt(t.replace(/[.,]\d{1,2}\s*$/, '').replace(/\D/g, ''), 10);
    if (only && only >= 300) steps = only;
  }
  return { date, steps, kg };
}

function saveSteps(date, steps) {
  const existing = data.steps.find(s => s.date === date);
  if (existing) existing.steps = steps;
  else data.steps.push({ date, steps });
}

function saveBodyweight(day, kg) {
  const existing = data.bodyweight.find(b => b.date.slice(0, 10) === day);
  if (existing) existing.kg = kg;
  else data.bodyweight.push({ id: uid(), date: `${day}T12:00:00`, kg });
}

function applyHealthText(text) {
  const { date, steps, kg } = parseHealthText(text);
  if (steps == null && kg == null) {
    alert('In der Zwischenablage wurden keine Schritte oder kein Gewicht gefunden.\n\nErwartet wird z. B.: „Datum: 2026-10-23 Schritte: 8432 Gewicht: 89,4“');
    return;
  }
  const before = unlockedIds();
  if (steps != null) saveSteps(date, steps);
  if (kg != null) saveBodyweight(date, kg);
  saveData();
  const fresh = achievementProgress().done.filter(a => !before.has(a.id));
  chartState.pasteBox = false;
  render();
  const parts = [steps != null ? `${deNum(steps)} Schritte` : null, kg != null ? `${fmtNum(kg)} kg` : null].filter(Boolean);
  toast(`Übernommen für ${fmtDate(date + 'T12:00:00')}: ${parts.join(', ')}` +
    (fresh.length ? ` · 🏆 ${fresh.map(a => a.name).join(', ')}` : ''));
}

function renderCharts() {
  const s = chartState;
  let h = `<div class="seg grid">
    <button class="${s.mode === 'ex' ? 'on' : ''}" data-action="chart-mode" data-mode="ex">Übungen</button>
    <button class="${s.mode === 'bw' ? 'on' : ''}" data-action="chart-mode" data-mode="bw">Körpergewicht</button>
    <button class="${s.mode === 'ton' ? 'on' : ''}" data-action="chart-mode" data-mode="ton">Tonnage</button>
    <button class="${s.mode === 'steps' ? 'on' : ''}" data-action="chart-mode" data-mode="steps">Schritte</button>
    <button class="${s.mode === 'awards' ? 'on' : ''}" data-action="chart-mode" data-mode="awards">🏆 Erfolge</button>
  </div>`;

  if (s.mode === 'awards') return h + renderAwards();

  if (s.mode === 'steps') {
    h += healthCard() + `<div class="card">
      <label class="row"><span>Schritte</span>
        <input class="inp kg" id="steps-n" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" placeholder="8500"></label>
      <label class="row"><span>Datum</span>
        <input class="inp date" id="steps-date" type="date" value="${todayISO()}" max="${todayISO()}"></label>
      <div class="row"><button class="btn primary" data-action="steps-save">Speichern</button></div>
    </div>`;
    h += rangeRow() + '<div id="chart-area" class="chart-area"></div><div id="chart-extra"></div>';
    return h + stepsList();
  }

  if (s.mode === 'ton') {
    h += `<div class="seg small">
      <button class="${s.tonBy === 'session' ? 'on' : ''}" data-action="ton-by" data-by="session">pro Training</button>
      <button class="${s.tonBy === 'week' ? 'on' : ''}" data-action="ton-by" data-by="week">pro Woche</button>
    </div>`;
  } else if (s.mode === 'ex') {
    const names = historyNames();
    if (!names.length) {
      return h + '<p class="hint">Sobald du Trainings gespeichert hast, siehst du hier deine Entwicklung pro Übung.</p>';
    }
    h += `<input class="inp" type="text" data-field="chart-name" autocomplete="off" autocorrect="off"
        spellcheck="false" placeholder="Übung eintippen …" value="${esc(s.name)}">
      <div class="suggest" hidden></div>`;
    if (!s.name) {
      return h + '<p class="lbl chips-title">Zuletzt trainiert</p>' + names.slice(0, 8).map(n =>
        `<button class="btn nav" data-action="chart-pick" data-name="${esc(n)}">${esc(n)}</button>`).join('');
    }
    h += `<div class="seg small">
      <button class="${s.metric === 'weight' ? 'on' : ''}" data-action="chart-metric" data-metric="weight">Gewicht</button>
      <button class="${s.metric === 'max10' ? 'on' : ''}" data-action="chart-metric" data-metric="max10">Max. bei 10 Wdh.</button>
    </div>`;
    // Ausführungsvarianten nur anbieten, wenn es für diese Übung welche gibt
    const used = new Set();
    for (const ses of data.sessions) {
      for (const e of ses.entries) if (nameKey(e.name) === nameKey(s.name)) e.sets.forEach(x => used.add(variantOf(x)));
    }
    if ([...used].some(v => v)) {
      h += `<div class="seg small">${Object.entries(VARIANTS).filter(([v]) => v === '' || used.has(v)).map(([v, label]) =>
        `<button class="${s.variant === v ? 'on' : ''}" data-action="chart-variant" data-v="${v}">${label}</button>`).join('')}
      </div>`;
    }
    h += `<div class="variants chart-opts"><button class="vchip ${s.withDeload ? 'on' : ''}" data-action="chart-deload">
      ${s.withDeload ? '✓ ' : ''}Deload einbeziehen</button></div>`;
  } else {
    h += healthCard() + `<div class="card">
      <label class="row"><span>Körpergewicht</span>
        <input class="inp kg" id="bw-kg" type="text" inputmode="decimal" autocomplete="off" placeholder="kg"></label>
      <label class="row"><span>Datum</span>
        <input class="inp date" id="bw-date" type="date" value="${todayISO()}" max="${todayISO()}"></label>
      <div class="row"><button class="btn primary" data-action="bw-save">Speichern</button></div>
    </div>`;
  }

  h += rangeRow() + '<div id="chart-area" class="chart-area"></div><div id="chart-extra"></div>';
  if (s.mode === 'bw') h += bwList();
  else if (s.mode === 'ton') h += '<p class="hint">Tonnage = Gewicht × Wiederholungen aller Sätze. Sätze ohne Gewicht zählen nicht mit.</p>';
  else h += `<p class="hint">Punkt antippen für Details. Zum Verschieben des Zeitraums seitlich wischen. ${s.withDeload
    ? 'Hohle Punkte = Deload-Woche.' : 'Deload-Wochen sind ausgeblendet.'}</p>`;
  return h;
}

views.charts = { title: 'Diagramme', tab: 'charts', render: renderCharts, after: drawChart };

Object.assign(actions, {
  'chart-mode': el => { Object.assign(chartState, { mode: el.dataset.mode, sel: null, end: null }); render(); },
  'chart-pick': el => showChartFor(el.dataset.name),
  'ton-by': el => { Object.assign(chartState, { tonBy: el.dataset.by, sel: null, end: null }); render(); },
  'chart-variant': el => { Object.assign(chartState, { variant: el.dataset.v, sel: null }); render(); },
  'chart-metric': el => { Object.assign(chartState, { metric: el.dataset.metric, sel: null }); render(); },
  'chart-deload': () => { Object.assign(chartState, { withDeload: !chartState.withDeload, sel: null }); render(); },
  'chart-range': el => { Object.assign(chartState, { range: Number(el.dataset.days), end: null }); render(); },
  'chart-shift': el => {
    if (!chartGeo) return;
    chartState.end = chartGeo.end + Number(el.dataset.dir) * (chartGeo.x1 - chartGeo.x0) / 2;
    drawChart();
  },
  'bw-save': () => {
    const kg = parseNum(document.getElementById('bw-kg').value);
    if (kg == null || kg < 20 || kg > 400) { alert('Bitte ein gültiges Körpergewicht in kg eintragen.'); return; }
    saveBodyweight(document.getElementById('bw-date').value || todayISO(), kg);
    saveData();
    toast('Körpergewicht gespeichert ✔');
    render();
  },
  'steps-save': () => {
    const n = parseInt(document.getElementById('steps-n').value.replace(/\D/g, ''), 10);
    if (!isFinite(n) || n < 0 || n > 200000) { alert('Bitte eine gültige Schrittzahl eintragen.'); return; }
    const before = unlockedIds();
    saveSteps(document.getElementById('steps-date').value || todayISO(), n);
    saveData();
    const fresh = achievementProgress().done.filter(a => !before.has(a.id));
    toast('Schritte gespeichert ✔' + (fresh.length ? ` · 🏆 ${fresh.map(a => a.name).join(', ')}` : ''));
    render();
  },
  'steps-del': el => {
    if (!confirm('Diesen Eintrag löschen?')) return;
    data.steps = data.steps.filter(s => s.date !== el.dataset.date);
    saveData(); render();
  },
  // Zwischenablage lesen; klappt das nicht (Safari fragt nicht immer), Feld zum Einsetzen zeigen
  'health-paste': async () => {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch (e) { /* nicht erlaubt */ }
    if (text && text.trim()) { applyHealthText(text); return; }
    chartState.pasteBox = true;
    render();
    const box = document.getElementById('health-text');
    if (box) box.focus();
  },
  'health-apply': () => applyHealthText(document.getElementById('health-text').value),
  'bw-del': el => {
    if (!confirm('Diesen Eintrag löschen?')) return;
    data.bodyweight = data.bodyweight.filter(b => b.id !== el.dataset.id);
    saveData(); render();
  },
});

fields['chart-name'] = el => {
  const names = historyNames();
  showSuggestions(el, names);
  const match = names.find(n => nameKey(n) === nameKey(el.value));
  if (match && nameKey(match) !== nameKey(chartState.name)) showChartFor(match);
};

/* Antippen = Punkt auswählen, seitlich ziehen = Zeitraum verschieben */

let chartDrag = null;
let drawQueued = false;

function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawChart(); });
}

document.addEventListener('pointerdown', e => {
  if (!chartGeo || !e.target.closest('.chart-svg')) return;
  chartDrag = { x: e.clientX, end: chartGeo.end, moved: false };
});

document.addEventListener('pointermove', e => {
  if (!chartDrag || !chartState.range) return;
  const dx = e.clientX - chartDrag.x;
  if (!chartDrag.moved && Math.abs(dx) < 8) return;
  chartDrag.moved = true;
  chartState.end = chartDrag.end - dx / chartGeo.pw * (chartGeo.x1 - chartGeo.x0);
  queueDraw();
});

document.addEventListener('pointerup', e => {
  if (!chartDrag) return;
  if (!chartDrag.moved) selectNearest(e.clientX);
  chartDrag = null;
});

document.addEventListener('pointercancel', () => { chartDrag = null; });

// Nächstgelegenen Punkt zur angetippten Stelle wählen (erneut antippen = abwählen)
function selectNearest(clientX) {
  const svg = document.querySelector('.chart-svg');
  if (!svg || !chartGeo.vis.length) return;
  const x = clientX - svg.getBoundingClientRect().left;
  let best = null, dist = Infinity;
  for (const p of chartGeo.vis) {
    const d = Math.abs(chartGeo.X(p.t) - x);
    if (d < dist) { dist = d; best = p; }
  }
  chartState.sel = chartState.sel === best.t ? null : best.t;
  drawChart();
}

window.addEventListener('resize', () => { if (current.view === 'charts') queueDraw(); });
