'use strict';

/* ---------- Ernährung: Phase, Kalorienbedarf, Makros, Körpergewicht ----------
   data.nutrition = { sex: 'm'|'f', age, ageYear, height, bodyFat|null, activity (1–5),
     phase: 'bulk'|'recomp'|'diet'|'minicut', pace, goalKg|null, weeks (nur Minicut),
     since (JJJJ-MM-TT, Beginn der Phase), startKg, adjust (kcal aus dem Gewichtsverlauf), adjustAt,
     history: [{ phase, from, to }] }
   Gerechnet wird immer mit dem aktuellen Körpergewicht (Ø der letzten 7 Tage mit Einträgen). */

const NUT_PHASES = {
  bulk: {
    label: 'Aufbau', icon: '💪', short: 'Muskeln aufbauen mit einem kleinen Kalorienüberschuss.',
    long: [
      ['Worum geht es?', 'Du isst etwas mehr, als du verbrauchst. Der Überschuss liefert Energie und Baumaterial, damit aus deinem Training möglichst viel Muskulatur wird. Ein wenig Fett kommt dabei immer mit – ein kleiner Überschuss („Lean Bulk“) hält das gering.'],
      ['Für wen?', 'Wenn du eher schlank bist (Männer bis ca. 15–18 % Körperfett, Frauen bis ca. 25–28 %) und vor allem Muskeln und Kraft zulegen willst.'],
      ['Kalorien', 'Standard: +200 bis +300 kcal über deinem Erhaltungsbedarf. Sehr ambitionierte Einsteiger mit viel Aufbaupotenzial: +300 bis +500 kcal. Mehr bringt keine zusätzlichen Muskeln – das Mehr landet vor allem auf den Hüften.'],
      ['Tempo', 'Richtwert: möglichst nicht mehr als 1 % deines Körpergewichts pro Monat zunehmen (bei 80 kg also höchstens ca. 0,8 kg). So kannst du den Aufbau lange durchziehen und musst hinterher nicht wieder so viel abnehmen.'],
      ['Dauer', 'Meist mehrere Monate (4–12). Fühlst du dich zu „weich“, folgt ein Minicut oder eine Diät.'],
      ['Training', 'Die beste Phase für Kraftsteigerungen – die Steigerungslogik der App läuft voll.'],
      ['Fortschritt erkennst du an', 'langsam steigendem Gewicht, steigenden Trainingsgewichten und einem Bauchumfang, der kaum zunimmt.'],
    ],
  },
  recomp: {
    label: 'Body Recomposition', icon: '⚖️', short: 'Fett verlieren und gleichzeitig Muskeln aufbauen – rund um den Erhaltungsbedarf.',
    long: [
      ['Worum geht es?', 'Du isst ungefähr so viel, wie du verbrauchst. Die Energie für neue Muskeln holt sich der Körper zum Teil aus den Fettreserven. Das Gewicht bleibt fast gleich, aber die Zusammensetzung ändert sich: weniger Fett, mehr Muskeln.'],
      ['Für wen?', 'Klappt am besten bei Trainingsneulingen, Wiedereinsteigern nach einer Pause und bei etwas mehr Körperfett. Bei sehr erfahrenen und schlanken Sportlern geht es kaum noch voran – dann lieber Aufbau und Diät abwechseln.'],
      ['Kalorien', 'Erhaltungsbedarf oder leicht darunter (bis −300 kcal). Viel Eiweiß ist hier besonders wichtig.'],
      ['Tempo', 'Langsam – die Waage bewegt sich kaum. Fortschritt siehst du am Spiegel, am Maßband (Bauch) und an steigenden Gewichten im Training.'],
      ['Dauer', 'Offen, oft mehrere Monate.'],
      ['Training', 'Ganz normal mit Steigerung – das Training ist hier der wichtigste Antrieb.'],
      ['Fortschritt erkennst du an', 'gleichbleibendem Gewicht bei schmalerer Taille und steigender Kraft.'],
    ],
  },
  diet: {
    label: 'Diät', icon: '🔥', short: 'Körperfett abbauen mit einem moderaten Defizit – und dabei die Muskeln behalten.',
    long: [
      ['Worum geht es?', 'Du isst bewusst weniger, als du verbrauchst, damit der Körper Fettreserven abbaut. Schweres Training und viel Eiweiß signalisieren ihm, die Muskeln zu behalten.'],
      ['Für wen?', 'Wenn du Körperfett loswerden willst – z. B. Männer über ca. 20 %, Frauen über ca. 30 % – oder nach einer längeren Aufbauphase.'],
      ['Kalorien', 'Je nach Tempo ca. 300, 500 oder 700 kcal unter deinem Erhaltungsbedarf.'],
      ['Tempo', 'Wer mehr Fett hat, kann zügiger abnehmen; je schlanker du bist, desto langsamer sollte es gehen. Langsamer = mehr Muskelerhalt und weniger Hunger.'],
      ['Dauer', 'Meist 8–16 Wochen. Danach ein paar Wochen auf Erhaltung essen (Diätpause), bevor es weitergeht oder in den Aufbau geht.'],
      ['Training', 'Gewichte so gut es geht halten. Gegen Ende kann die Kraft etwas sinken – das ist normal. Mehr Sätze bringen jetzt nichts.'],
      ['Fortschritt erkennst du an', 'gleichmäßig sinkendem Gewicht, schmalerer Taille und weitgehend gleicher Kraft.'],
    ],
  },
  minicut: {
    label: 'Minicut', icon: '⚡', short: 'Kurze, harte Diät über 2–4 Wochen – meist mitten in einer Aufbauphase.',
    long: [
      ['Worum geht es?', 'Eine kurze, bewusst harte Diät mit großem Defizit. Ziel ist, in kurzer Zeit etwas Fett loszuwerden, ohne lange aus dem Aufbau herauszugehen.'],
      ['Für wen?', 'Meist mitten im Aufbau, wenn sich zu viel Fett angesammelt hat, oder vor einem Anlass (Urlaub, Fotos). Nicht als Dauerlösung und nicht für Trainingsneulinge.'],
      ['Kalorien', 'Ca. 800 kcal unter deinem Erhaltungsbedarf, bei mehr Körperfett ca. 1.000 kcal.'],
      ['Tempo', 'In den ersten Tagen fällt das Gewicht schnell (vor allem Wasser), danach geht es zügig, aber gleichmäßig weiter.'],
      ['Dauer', 'Höchstens 4 Wochen am Stück. Danach 1 Woche auf Erhaltungskalorien essen, am besten kombiniert mit einer Deload-Woche im Training. Bist du dann noch nicht zufrieden, höchstens noch einen weiteren Durchgang mit diesem Defizit – danach in den Aufbau oder auf Erhaltung.'],
      ['Training', 'Gewichte halten, eher ein paar Sätze weniger – mit wenig Energie erholst du dich schlechter. Kein guter Zeitpunkt für Rekordversuche.'],
      ['Fortschritt erkennst du an', 'deutlich sinkendem Gewicht und Bauchumfang bei gehaltener Kraft.'],
    ],
  },
};

// Tempo je Phase: kcal = Überschuss/Defizit pro Tag; range = empfohlene Spanne (gerechnet wird mit kcal)
const NUT_PACES = {
  bulk: [
    { k: 'normal', label: 'Standard', kcal: 250, range: [200, 300],
      text: 'Für die meisten. Richtwert: möglichst nicht mehr als 1 % deines Körpergewichts pro Monat zunehmen – so kannst du den Aufbau lange durchziehen und musst hinterher nicht wieder so viel abnehmen.' },
    { k: 'ambitious', label: 'Ambitioniert', kcal: 400, range: [300, 500],
      text: 'Für sehr ambitionierte Einsteiger – am Anfang ist noch mehr Aufbaupotenzial da. Es kommt etwas mehr Fett mit.' },
  ],
  recomp: [
    { k: 'maint', label: 'Erhaltung', kcal: 0, text: 'Wenn du schon recht schlank bist.' },
    { k: 'light', label: 'Leicht darunter', kcal: -150, text: 'Der übliche Weg – ein Hauch Defizit hilft beim Fettabbau.' },
    { k: 'more', label: 'Etwas mehr darunter', kcal: -300, text: 'Bei etwas mehr Körperfett.' },
  ],
  diet: [
    { k: 'slow', label: 'Sanft', kcal: -300, text: 'Bestmöglicher Muskelerhalt, wenig Hunger – ideal, wenn du schon recht schlank bist.' },
    { k: 'normal', label: 'Normal', kcal: -500, text: 'Der gute Mittelweg für die meisten.' },
    { k: 'fast', label: 'Zügig', kcal: -700, text: 'Bei deutlich mehr Körperfett – mehr Hunger, eher Kraftverlust.' },
  ],
  minicut: [
    { k: 'normal', label: 'Standard', kcal: -800, text: 'Für die meisten.' },
    { k: 'more', label: 'Mehr Körperfett', kcal: -1000, text: 'Wenn du etwas mehr Körperfett loswerden willst.' },
  ],
};
const NUT_MINICUT_MAX = 4;  // Minicut: höchstens 4 Wochen am Stück, danach 1 Erhaltungswoche (+ Deload), höchstens 2 Durchgänge

// Aktivität = Alltag + Training zusammen (Faktor auf den Grundumsatz)
const NUT_ACT = {
  1: { label: 'Kaum aktiv', f: 1.2, text: 'Sitzender Alltag, kaum Bewegung, kein Sport.' },
  2: { label: 'Leicht aktiv', f: 1.375, text: 'Bürojob, 1–3 Trainings pro Woche oder ca. 5.000–7.500 Schritte am Tag.' },
  3: { label: 'Mäßig aktiv', f: 1.55, text: '3–5 Trainings pro Woche und ca. 7.500–10.000 Schritte – oder ein Job mit viel Stehen und Gehen.' },
  4: { label: 'Sehr aktiv', f: 1.725, text: 'Fast täglich Training und über 10.000 Schritte – oder körperlich anstrengende Arbeit.' },
  5: { label: 'Extrem aktiv', f: 1.9, text: 'Harte körperliche Arbeit plus Training oder Leistungssport.' },
};

// Eiweiß in g pro kg (Bezugsgewicht, siehe nutProteinKg)
// lo–hi = empfohlene Spanne, def = damit rechnet die App
const NUT_PROTEIN = {
  bulk: { lo: 1.6, hi: 2.0, def: 1.8 },
  recomp: { lo: 1.8, hi: 2.2, def: 2.0 },
  diet: { lo: 1.8, hi: 2.4, def: 2.0 },
  minicut: { lo: 2.0, hi: 2.5, def: 2.2 },
};
const NUT_KCAL_KG = 7700;  // grob: 1 kg Körpergewicht ≈ 7.700 kcal

let nutDraft = null;  // Eingaben während der Einrichtung (Phase → Angaben → Ziel & Tempo)

const nutKcal = v => deNum(Math.round(v / 10) * 10);
const nutSigned = (v, unit) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${unit === 'kg' ? fmtNum(round1(Math.abs(v))) : nutKcal(Math.abs(v))} ${unit}`;
const addDaysISO = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
const daysSince = iso => Math.floor((Date.parse(todayISO() + 'T12:00:00') - Date.parse(iso + 'T12:00:00')) / DAY);

// Aktuelles Gewicht: Ø der Einträge aus den 7 Tagen bis zum letzten Eintrag (glättet Wasserschwankungen)
function nutWeight() {
  const list = [...data.bodyweight].sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return null;
  const from = addDaysISO(list[list.length - 1].date.slice(0, 10), -6);
  const week = list.filter(b => b.date.slice(0, 10) >= from);
  return round1(week.reduce((a, b) => a + b.kg, 0) / week.length);
}

const nutPace = n => NUT_PACES[n.phase].find(p => p.k === n.pace) || NUT_PACES[n.phase].find(p => p.k === 'normal' || p.k === 'light');
// Minicut-Abschnitt: 'cut' (Defizit), 'maint' (Erhaltungswoche danach), 'done'
// Training an Diät/Minicut angepasst (n.trainAdapt, beim Einrichten gefragt): halber Volumenanstieg von der Intro-
// bis zur letzten Zykluswoche und 1 Wdh. weniger im Tank – nur während des Defizits (nicht in der Erhaltungswoche)
function nutTrainAdapt() {
  const n = data.nutrition;
  if (!n || !n.trainAdapt) return false;
  return n.phase === 'diet' || (n.phase === 'minicut' && nutMinicutStage(n) === 'cut');
}

const NUT_ADAPT_TEXT = 'Das Volumen steigt von der Intro- bis zur letzten Zykluswoche nur halb so stark an (z. B. 10 → 13 statt 10 → 16 Sätze pro Woche), dafür trainierst du immer 1 Wiederholung näher am Muskelversagen (1 Wdh. weniger im Tank). So bleibt der Trainingsreiz hoch, ohne dass die Ermüdung im Defizit überhandnimmt. Deload-Wochen bleiben wie gehabt.';

// Frage beim Einrichten von Diät und Minicut
function nutTrainQuestion(d) {
  if (d.phase !== 'diet' && d.phase !== 'minicut') return '';
  const opt = (v, title, text) => `<button class="split-opt ${d.trainAdapt === v ? 'on' : ''}" data-action="nut-train-pick" data-v="${v ? 1 : 0}">
      <b>${title}</b><small>${text}</small></button>`;
  const own = data.plans.length && hasActivePlan() && ownPlan();
  return `<div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🏋️</span><h2>Trainingsplan an ${d.phase === 'minicut' ? 'den Minicut' : 'die Diät'} anpassen?</h2></div>
      <p class="hint wiz-q-explain">Im Kaloriendefizit erholst du dich schlechter. Angepasst heißt: ${NUT_ADAPT_TEXT}
        ${own ? '<br><b>Hinweis:</b> Dein aktiver Plan ist ein eigener Plan ohne Steigerung – dort ändert sich nichts.' : ''}</p>
      ${opt(true, 'Ja, Training anpassen', 'Gilt, solange die Phase läuft – danach wieder wie gewohnt.')}
      ${opt(false, 'Nein, Plan läuft unverändert', 'Volumen und Tank bleiben wie im Plan.')}
    </div>`;
}

// Zeile auf der Trainings-Startseite: Phase, Tagesziel, ggf. angepasstes Training
function nutStartLine() {
  const n = data.nutrition;
  const kg = nutWeight();
  if (!n || kg == null) return '';
  const ph = NUT_PHASES[n.phase];
  const maint = n.phase === 'minicut' && nutMinicutStage(n) !== 'cut';
  return `<button class="nut-strip" data-action="tab" data-tab="nutrition"><span class="nut-strip-icon" aria-hidden="true">${ph.icon}</span>
      <span><b>${ph.label}</b>${maint ? ' · Erhaltungswoche' : ''} · Tagesziel ${nutKcal(nutCalc(n, kg).kcal)} kcal
        ${nutTrainAdapt() ? '<small>Training angepasst: halber Volumenanstieg, 1 Wdh. weniger im Tank</small>' : ''}</span></button>`;
}

function nutMinicutStage(n) {
  const d = n.since ? daysSince(n.since) : 0;
  const w = Math.min(n.weeks || NUT_MINICUT_MAX, NUT_MINICUT_MAX);
  return d < w * 7 ? 'cut' : d < w * 7 + 7 ? 'maint' : 'done';
}
const nutAge = n => n.age + (new Date().getFullYear() - (n.ageYear || new Date().getFullYear()));

// Bezugsgewicht fürs Eiweiß: bei viel Körperfett nicht das volle Gewicht, sonst wird es unnötig viel
function nutProteinKg(n, kg, lbm) {
  if (lbm != null) {
    const high = n.sex === 'm' ? 25 : 32;
    return n.bodyFat > high ? lbm / (1 - (n.sex === 'm' ? 0.15 : 0.25)) : kg;
  }
  const m = n.height / 100;
  return kg / (m * m) > 30 ? 27 * m * m : kg;
}

// Grundumsatz, Erhaltungsbedarf, Tagesziel und Makros
function nutCalc(n, kg) {
  const age = nutAge(n);
  const lbm = n.bodyFat != null ? kg * (1 - n.bodyFat / 100) : null;
  // mit Körperfett: Katch-McArdle (aus der fettfreien Masse), sonst Mifflin-St Jeor
  const bmr = lbm != null ? 370 + 21.6 * lbm : 10 * kg + 6.25 * n.height - 5 * age + (n.sex === 'm' ? 5 : -161);
  const tdee = bmr * NUT_ACT[n.activity].f;
  // Minicut: nach den Defizit-Wochen eine Woche auf Erhaltung
  const delta = n.phase === 'minicut' && nutMinicutStage(n) !== 'cut' ? 0 : nutPace(n).kcal;
  let note = null;
  const planned = delta * 7 / NUT_KCAL_KG;  // geplante Veränderung in kg pro Woche
  let kcal = tdee + delta + (n.adjust || 0);
  const floor = n.sex === 'm' ? 1500 : 1200;
  if (kcal < floor) { kcal = floor; note = 'floor'; }
  kcal = Math.round(kcal / 10) * 10;

  const ref = nutProteinKg(n, kg, lbm);
  const pr = NUT_PROTEIN[n.phase];
  const pLo = Math.round(pr.lo * ref / 5) * 5, pHi = Math.round(pr.hi * ref / 5) * 5;
  let protein, fat, carbs;
  if (n.macroPct) {
    // eigene Aufteilung in % der Kalorien
    protein = Math.round(kcal * n.macroPct.p / 100 / 4);
    fat = Math.round(kcal * n.macroPct.f / 100 / 9);
    carbs = Math.round(kcal * n.macroPct.c / 100 / 4);
  } else {
    protein = Math.round(pr.def * ref / 5) * 5;
    const fatShare = n.phase === 'minicut' ? 0.2 : 0.25;
    const fatMin = (n.phase === 'minicut' ? 0.6 : 0.8) * ref;
    fat = Math.round(Math.max(fatMin, kcal * fatShare / 9) / 5) * 5;
    carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4 / 5) * 5);
  }
  return { age, lbm, bmr, tdee, delta, planned, kcal, note, protein, fat, carbs, ref, pLo, pHi };
}

// Trend der letzten 3 Wochen in kg pro Woche (lineare Regression) – frühestens ab Tag 8 der Phase
// (die ersten Tage verschiebt vor allem Wasser) bzw. ab der letzten Anpassung
function nutTrend(n) {
  const from = [addDaysISO(n.since, 7), n.adjustAt || '', addDaysISO(todayISO(), -21)].sort().pop();
  const pts = data.bodyweight.filter(b => b.date.slice(0, 10) >= from)
    .map(b => ({ x: Date.parse(b.date) / DAY, y: b.kg }));
  if (pts.length < 4) return null;
  const xs = pts.map(p => p.x);
  const span = Math.max(...xs) - Math.min(...xs);
  if (span < 10) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0);
  const sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0);
  return { perWeek: sxy / sxx * 7, days: Math.round(span) };
}

// Vorschlag für die Aktivitätsstufe aus Schritten (letzte 14 Tage) und Trainings (letzte 4 Wochen)
function nutActivityGuess() {
  const from = addDaysISO(todayISO(), -14);
  const steps = data.steps.filter(s => s.date >= from);
  const avg = steps.length >= 3 ? steps.reduce((a, s) => a + s.steps, 0) / steps.length : null;
  const since = addDaysISO(todayISO(), -28);
  const perWeek = data.sessions.filter(s => s.date.slice(0, 10) >= since).length / 4;
  if (avg == null && !data.sessions.length) return null;
  let lvl = 1;
  if (perWeek >= 1 || avg >= 5000) lvl = 2;
  if ((perWeek >= 3 && (avg == null || avg >= 7500)) || avg >= 10000) lvl = 3;
  if (perWeek >= 5 && avg >= 10000) lvl = 4;
  return { lvl, avg, perWeek };
}

// Körperfett per Maßband (US-Navy-Formel, Angaben in cm)
function navyBodyFat(sex, height, waist, neck, hip) {
  const v = sex === 'm'
    ? 495 / (1.0324 - 0.19077 * Math.log10(waist - neck) + 0.15456 * Math.log10(height)) - 450
    : 495 / (1.29579 - 0.35004 * Math.log10(waist + hip - neck) + 0.221 * Math.log10(height)) - 450;
  return isFinite(v) && v > 2 && v < 65 ? round1(v) : null;
}

/* ---------- Einrichtung ---------- */

function nutInit(view) {
  const n = data.nutrition;
  const level = data.plans.length && activePlan().level;
  nutDraft = n ? { ...n, kg: nutWeight() } : {
    sex: null, age: null, ageYear: new Date().getFullYear(), height: null, bodyFat: null, activity: null,
    phase: null, pace: null, goalKg: null, weeks: 4, kg: nutWeight(),
  };
  nutDraft.level = level;
  for (const k of ['age', 'height', 'bodyFat', 'kg', 'goalKg']) nutDraft[k] = nutDraft[k] == null ? '' : fmtNum(nutDraft[k]);
  nutDraft.flow = view;  // 'nutphase' = mit Phasenwahl, 'nutbody' = nur Angaben ändern
}

const NUT_CANCEL = {
  ask: 'Einrichtung abbrechen?\n\nDeine Eingaben werden nicht gespeichert.',
  run: () => { nutDraft = null; go('nutrition'); },
};

// Eingaben des Entwurfs als Zahlen (leer -> null)
function nutNumbers(d) {
  const num = k => (String(d[k]).trim() === '' ? null : parseNum(d[k]));
  return { ...d, age: num('age'), height: num('height'), bodyFat: num('bodyFat'), kg: num('kg'), goalKg: num('goalKg') };
}

function nutBodyErrors(d) {
  if (!d.sex) return 'Bitte Mann oder Frau auswählen.';
  if (d.age == null || d.age < 14 || d.age > 99) return 'Bitte dein Alter eintragen (14–99 Jahre).';
  if (d.height == null || d.height < 120 || d.height > 230) return 'Bitte deine Größe in cm eintragen (z. B. 178).';
  if (d.kg == null || d.kg < 30 || d.kg > 300) return 'Bitte dein aktuelles Gewicht in kg eintragen.';
  if (d.bodyFat != null && (d.bodyFat < 3 || d.bodyFat > 60)) return 'Der Körperfettanteil muss zwischen 3 und 60 % liegen – oder lass das Feld leer.';
  if (!d.activity) return 'Bitte deine Aktivität im Alltag auswählen.';
  return null;
}

const nutStep = (no, of) => `<p class="sub">Schritt ${no} von ${of}</p>`;

function renderNutPhase() {
  if (!nutDraft) nutInit('nutphase');
  const d = nutDraft;
  const more = (p, ph) => `<details class="nut-more"><summary>Ausführlich: ${ph.label}</summary>
      ${ph.long.map(([t, x]) => `<p><b>${t}:</b> ${x}</p>`).join('')}
      <button class="btn outline" data-action="nut-phase" data-p="${p}">${ph.label} wählen</button>
    </details>`;
  return `<div class="card wiz-q">
      ${nutStep(1, 3)}
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🧭</span><h2>In welcher Phase bist du?</h2></div>
      <p class="hint wiz-q-explain">Davon hängt ab, ob du mehr oder weniger essen solltest, als du verbrauchst. Unter jeder Phase
        kannst du eine ausführliche Erklärung aufklappen.</p>
      ${Object.entries(NUT_PHASES).map(([p, ph]) => `<button class="split-opt cat ${d.phase === p ? 'on' : ''}" data-action="nut-phase" data-p="${p}">
          <span class="cat-icon">${ph.icon}</span><b>${ph.label}</b><small>${ph.short}</small></button>${more(p, ph)}`).join('')}
    </div>
    <details class="card nut-help"><summary>Unsicher? So findest du deine Phase</summary>
      <ul>
        <li><b>Neu im Training oder nach langer Pause</b> → Body Recomposition</li>
        <li><b>Eher schlank und du willst mehr Muskeln</b> → Aufbau</li>
        <li><b>Deutlich zu viel Körperfett</b> → Diät</li>
        <li><b>Im Aufbau zu viel Fett angesetzt</b> → Minicut, danach weiter Aufbau</li>
      </ul>
      <p class="hint">Faustregel: Bist du mit deinem Körperfett zufrieden, baue auf. Wenn nicht, nimm erst ab.</p>
    </details>`;
}

function renderNutBody() {
  if (!nutDraft) nutInit('nutbody');
  const d = nutDraft;
  const n = nutNumbers(d);
  const inp = (k, ph, mode = 'decimal') => `<input class="inp kg" type="text" inputmode="${mode}" autocomplete="off"
      data-field="nut-in" data-k="${k}" value="${esc(d[k])}" placeholder="${ph}">`;
  const guess = nutActivityGuess();
  const guessText = guess ? [guess.perWeek ? `ca. ${fmtNum(round1(guess.perWeek))} Trainings pro Woche` : null,
    guess.avg != null ? `Ø ${deNum(Math.round(guess.avg / 100) * 100)} Schritte am Tag` : null].filter(Boolean).join(' und ') : '';
  const navy = n.sex && n.height
    ? `<div class="nut-navy">
        <label class="row"><span>Bauch (auf Nabelhöhe)</span>${inp('waist', 'cm')}</label>
        <label class="row"><span>Hals (unter dem Kehlkopf)</span>${inp('neck', 'cm')}</label>
        ${n.sex === 'f' ? `<label class="row"><span>Hüfte (breiteste Stelle)</span>${inp('hip', 'cm')}</label>` : ''}
        <div class="row"><button class="btn" data-action="nut-navy">Körperfett berechnen</button></div>
      </div>`
    : '<p class="hint">Trag zuerst Geschlecht und Größe ein.</p>';
  return `<div class="card wiz-q">
      ${d.flow === 'nutphase' ? nutStep(2, 3) : ''}
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">📏</span><h2>Deine Angaben</h2></div>
      <p class="hint wiz-q-explain">Daraus schätzt die App deinen Kalorienbedarf. Die Daten bleiben nur auf deinem Handy.</p>
      <div class="seg">${[['m', 'Mann'], ['f', 'Frau']].map(([k, l]) =>
        `<button class="${d.sex === k ? 'on' : ''}" data-action="nut-sex" data-k="${k}">${l}</button>`).join('')}</div>
      <label class="row"><span>Alter</span>${inp('age', 'Jahre', 'numeric')}</label>
      <label class="row"><span>Größe</span>${inp('height', 'cm', 'numeric')}</label>
      <label class="row"><span>Gewicht</span>${inp('kg', 'kg')}</label>
      <label class="row"><span>Körperfett <small class="hint">(optional)</small></span>${inp('bodyFat', '%')}</label>
      <p class="hint nut-small">Kennst du deinen Körperfettanteil (z. B. von einer Körperfettwaage), wird die Rechnung genauer.
        Sonst einfach leer lassen.</p>
      <details class="nut-more" ${d.navyOpen ? 'open' : ''}><summary>Körperfett mit dem Maßband schätzen</summary>
        <p class="hint nut-small">Morgens, entspannt, Maßband waagerecht und ohne einzuschnüren messen.</p>
        ${navy}
      </details>
    </div>
    <div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🚶</span><h2>Wie aktiv bist du?</h2></div>
      <p class="hint wiz-q-explain">Gemeint ist alles zusammen: Alltag, Arbeit und Training. Wenn du schwankst, nimm lieber die
        niedrigere Stufe – die meisten schätzen sich zu aktiv ein.${guess ? ` Vorschlag aus deinen Daten (${guessText}): <b>${NUT_ACT[guess.lvl].label}</b>.` : ''}</p>
      ${Object.entries(NUT_ACT).map(([k, a]) => `<button class="split-opt ${String(d.activity) === k ? 'on' : ''}" data-action="nut-act" data-k="${k}">
          ${guess && guess.lvl === Number(k) ? '<span class="split-tag">Vorschlag</span>' : ''}<b>${a.label}</b><small>${a.text}</small></button>`).join('')}
    </div>
    <div class="row"><button class="btn" data-action="back">Zurück</button>
      <button class="btn primary" data-action="nut-body-next">${d.flow === 'nutphase' ? 'Weiter' : 'Weiter zu Ziel & Tempo'}</button></div>`;
}

function renderNutGoal() {
  if (!nutDraft || !nutDraft.phase || nutBodyErrors(nutNumbers(nutDraft))) {
    if (!nutDraft) nutInit('nutphase');
    current.view = nutDraft.phase ? 'nutbody' : 'nutphase';
    return views[current.view].render();
  }
  const d = nutDraft;
  // Anpassung aus dem Gewichtsverlauf gilt nur, solange die Phase bleibt
  // Anpassung aus dem Gewichtsverlauf und Phasenbeginn gelten nur, solange die Phase bleibt
  const same = data.nutrition && data.nutrition.phase === d.phase;
  const n = { ...nutNumbers(d), adjust: same ? data.nutrition.adjust : 0, since: same ? data.nutrition.since : todayISO() };
  const ph = NUT_PHASES[d.phase];
  const c = nutCalc(n, n.kg);
  const paces = NUT_PACES[d.phase].map(p => {
    const kgWeek = p.kcal * 7 / NUT_KCAL_KG;
    const kcal = p.range ? `+${p.range[0]} bis +${p.range[1]} kcal` : nutSigned(p.kcal, 'kcal');
    // Aufbau: Zunahme pro Monat (Richtwert höchstens 1 % des Körpergewichts), sonst pro Woche
    const info = !p.kcal ? `${kcal} · Gewicht bleibt gleich`
      : p.kcal > 0 ? `${kcal} · ≈ ${nutSigned(kgWeek * 4.3, 'kg')} im Monat (${fmtNum(round1(kgWeek * 4.3 / n.kg * 100))} %)`
      : `${kcal} · ≈ ${nutSigned(kgWeek, 'kg')} pro Woche`;
    return `<button class="split-opt ${d.pace === p.k ? 'on' : ''}" data-action="nut-pace" data-k="${p.k}">
        <b>${p.label}</b><small><b class="nut-pace-info">${info}</b>${p.text}${p.range ? ` Die App rechnet mit ${nutSigned(p.kcal, 'kcal')}.` : ''}</small></button>`;
  }).join('');
  const goal = d.phase === 'recomp' ? ''
    : `<label class="row"><span>Zielgewicht <small class="hint">(optional)</small></span>
        <input class="inp kg" type="text" inputmode="decimal" autocomplete="off" data-field="nut-in" data-k="goalKg"
          value="${esc(d.goalKg)}" placeholder="kg"></label>`;
  const weeks = d.phase !== 'minicut' ? '' : `<p class="lbl chips-title">Dauer (höchstens ${NUT_MINICUT_MAX} Wochen am Stück)</p>
      <div class="variants count">${[2, 3, 4].map(w => `<button class="vchip ${Math.min(d.weeks, NUT_MINICUT_MAX) === w ? 'on' : ''}"
        data-action="nut-weeks" data-w="${w}">${w} Wochen</button>`).join('')}</div>
      <p class="hint nut-small">Danach stellt die App automatisch 1 Woche auf Erhaltungskalorien um – am besten zusammen mit einer
        Deload-Woche im Training.</p>`;
  return `<div class="card wiz-q">
      ${d.flow === 'nutphase' ? nutStep(3, 3) : ''}
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">${ph.icon}</span><h2>${ph.label}: Ziel & Tempo</h2></div>
      <p class="hint wiz-q-explain">Wie schnell soll es gehen? Ausgangspunkt ist dein geschätzter Erhaltungsbedarf von
        <b>${nutKcal(c.tdee)} kcal</b> pro Tag.</p>
      ${paces}
      ${weeks}
      ${goal}
    </div>
    ${nutTrainQuestion(d)}
    ${nutTargetCard(n, c)}
    <div class="row"><button class="btn" data-action="back">Zurück</button>
      <button class="btn primary" data-action="nut-save">Speichern</button></div>`;
}

/* ---------- Übersicht ---------- */

let nutMacroEdit = null;  // eigene Aufteilung wird gerade eingetippt: { p, f, c } als Text, kcal

const NUT_MACROS = [['p', 'Eiweiß', 4], ['f', 'Fett', 9], ['c', 'Kohlenhydrate', 4]];

// Aktuelle Aufteilung in ganzen Prozent (Summe 100)
function nutPctOf(c) {
  const p = Math.round(c.protein * 4 / c.kcal * 100), f = Math.round(c.fat * 9 / c.kcal * 100);
  return { p, f, c: 100 - p - f };
}

// Eiweiß-Spanne mit Erklärung; persönlicher Hinweis, wenn eher der obere Rand passt
function nutProteinNote(n, c) {
  const pr = NUT_PROTEIN[n.phase];
  const why = [nutAge(n) >= 50 ? 'du über 50 bist' : null,
    n.bodyFat != null && n.bodyFat < (n.sex === 'm' ? 15 : 23) ? 'du wenig Körperfett hast' : null].filter(Boolean);
  const low = c.protein < c.pLo - 2;
  return `<p class="nut-protein ${low ? 'low' : ''}"><b>Eiweiß-Empfehlung: ${c.pLo}–${c.pHi} g am Tag</b>
      (${fmtNum(pr.lo)}–${fmtNum(pr.hi)} g pro kg${Math.abs(c.ref - (n.kg || nutWeight())) > 1 ? ` bezogen auf ${fmtNum(Math.round(c.ref))} kg` : ''}).
      ${low ? 'Dein Eiweiß liegt gerade darunter. ' : ''}Orientiere dich eher am oberen Rand, wenn du relativ wenig Körperfett hast,
      älter bist (ab ca. 50) oder dich vegan ernährst – pflanzliches Eiweiß verwertet der Körper etwas schlechter.
      ${why.length ? `<b>Bei dir passt eher der obere Rand, weil ${why.join(' und ')}.</b>` : ''}</p>`;
}

// Eingabe der eigenen Aufteilung (Gramm und Summe werden beim Tippen aktualisiert, siehe nutPctUpdate)
function nutPctEditor() {
  const e = nutMacroEdit;
  return `<div class="nut-pct">
      <p class="hint nut-small">Teile deine ${nutKcal(e.kcal)} kcal selbst auf – zusammen 100 %.</p>
      ${NUT_MACROS.map(([k, l]) => `<label class="row nut-pct-row ${k}"><span>${l}</span>
        <input class="inp kg" type="text" inputmode="decimal" autocomplete="off" data-field="nut-pct" data-k="${k}" value="${esc(e[k])}">
        <em>%</em><b id="nut-pct-${k}"></b></label>`).join('')}
      <p class="nut-pct-sum" id="nut-pct-sum"></p>
      <div class="row"><button class="btn" data-action="nut-pct-cancel">Abbrechen</button>
        <button class="btn primary" data-action="nut-pct-save">Übernehmen</button></div>
    </div>`;
}

function nutPctUpdate() {
  const e = nutMacroEdit;
  if (!e) return;
  let sum = 0;
  for (const [k, , f] of NUT_MACROS) {
    const v = parseNum(e[k]) || 0;
    sum += v;
    const el = document.getElementById('nut-pct-' + k);
    if (el) el.textContent = `= ${Math.round(e.kcal * v / 100 / f)} g`;
  }
  const s = document.getElementById('nut-pct-sum');
  if (!s) return;
  sum = round1(sum);
  s.textContent = sum === 100 ? 'Summe: 100 % ✔' : `Summe: ${fmtNum(sum)} % – ${sum < 100 ? `es fehlen noch ${fmtNum(round1(100 - sum))}` : `${fmtNum(round1(sum - 100))} zu viel`} %`;
  s.classList.toggle('off', sum !== 100);
}

// editable: in der Übersicht lassen sich die Makros in % selbst festlegen (nicht in der Vorschau beim Einrichten)
function nutTargetCard(n, c, editable = false) {
  const notes = {
    floor: `Weniger als ${deNum(n.sex === 'm' ? 1500 : 1200)} kcal empfiehlt die App nicht – sonst fehlen schnell Nährstoffe.`,
  };
  const adj = n.adjust ? ` · inkl. ${nutSigned(n.adjust, 'kcal')} aus deinem Gewichtsverlauf` : '';
  const pct = nutPctOf(c);
  const kg = n.kg || nutWeight();
  const fatLow = kg && c.fat < 0.6 * kg;
  let macros;
  if (editable && nutMacroEdit) macros = nutPctEditor();
  else {
    macros = `<div class="nut-macros">
        ${NUT_MACROS.map(([k, l, f]) => {
          const g = { p: c.protein, f: c.fat, c: c.carbs }[k];
          return `<div class="nut-macro ${k}"><span>${l}</span><b>${g} g</b><small>${pct[k]} % · ${nutKcal(g * f)} kcal</small></div>`;
        }).join('')}
      </div>
      <div class="nut-bar" aria-hidden="true">${[['p', c.protein * 4], ['f', c.fat * 9], ['c', c.carbs * 4]].map(([k, v]) =>
        `<div class="${k}" style="flex:${v}"></div>`).join('')}</div>
      ${fatLow ? `<p class="nut-warn">Sehr wenig Fett: Auf Dauer sollten es mindestens ca. ${Math.round(0.6 * kg / 5) * 5} g am Tag sein (u. a. für die Hormone).</p>` : ''}
      ${editable ? `<div class="nut-macro-btns">${n.macroPct
        ? `<span class="hint">Eigene Aufteilung ${n.macroPct.p} / ${n.macroPct.f} / ${n.macroPct.c} %</span>
           <button class="btn" data-action="nut-pct-edit">Ändern</button>
           <button class="btn" data-action="nut-pct-reset">App-Empfehlung</button>`
        : '<button class="btn" data-action="nut-pct-edit">Makros selbst festlegen (in %)</button>'}</div>` : ''}`;
  }
  return `<div class="card nut-target">
      <span class="lbl">Dein Tagesziel</span>
      <b class="nut-kcal">${nutKcal(c.kcal)} kcal</b>
      <small>Erhaltungsbedarf ca. ${nutKcal(c.tdee)} kcal · ${nutSigned(c.delta, 'kcal')}${adj}</small>
      ${c.note ? `<p class="nut-warn">${notes[c.note]}</p>` : ''}
      ${macros}
      ${nutProteinNote(n, c)}
      <p class="nut-relax">😌 <b>Kein Stress:</b> Du musst diese Werte nicht aufs Gramm genau treffen. Entscheidend ist, dass Kalorien
        und Eiweiß über die Woche gesehen ungefähr passen – ±10 % sind völlig in Ordnung. Ein Tag mit mehr Kohlenhydraten oder
        weniger Fett macht nichts kaputt; wichtig ist, was du an den meisten Tagen isst.</p>
    </div>`;
}

// Fortschritt zum Zielgewicht
function nutGoalCard(n, c, kg) {
  if (n.goalKg == null || n.phase === 'recomp') return '';
  const total = n.goalKg - n.startKg;
  const done = kg - n.startKg;
  const reached = total ? (done / total >= 1) : true;
  const frac = total ? Math.max(0, Math.min(1, done / total)) : 1;
  const left = n.goalKg - kg;
  let eta = '';
  if (!reached && c.planned && Math.sign(left) === Math.sign(c.planned)) {
    const weeks = Math.ceil(Math.abs(left / c.planned));
    eta = ` · im geplanten Tempo ca. ${weeks} Woche${weeks === 1 ? '' : 'n'} (um den ${fmtDate(addDaysISO(todayISO(), weeks * 7) + 'T12:00:00')})`;
  }
  return `<div class="card nut-goal">
      <div class="nut-goal-row"><span>Start<b>${fmtNum(n.startKg)} kg</b></span><span>Jetzt<b>${fmtNum(kg)} kg</b></span>
        <span>Ziel<b>${fmtNum(n.goalKg)} kg</b></span></div>
      <div class="bar"><div style="width:${Math.round(frac * 100)}%"></div></div>
      <p class="hint nut-small">${reached ? '🎉 Ziel erreicht! Zeit für die nächste Phase – tippe unten auf „Phase wechseln“.'
        : `Noch ${fmtNum(round1(Math.abs(left)))} kg${eta}.`}</p>
    </div>`;
}

// Passt das Tempo? Vergleich Trend ↔ Plan, ggf. Vorschlag zur Anpassung
function nutTrendCard(n, c) {
  if (n.phase === 'minicut' && nutMinicutStage(n) !== 'cut') return '';  // Erhaltungswoche: Wasser verfälscht den Trend
  const t = nutTrend(n);
  if (!t) {
    return `<div class="card nut-check"><p><b>📈 Tempo-Check</b></p>
      <p class="hint nut-small">Wiege dich 3–4× pro Woche, am besten morgens nach dem Aufstehen. Nach gut zwei Wochen in dieser
        Phase vergleicht die App deinen Gewichtsverlauf mit dem Plan und schlägt bei Bedarf eine Anpassung vor.</p></div>`;
  }
  const diff = t.perWeek - c.planned;
  const fmt = v => `${nutSigned(v, 'kg')} pro Woche`;
  if (Math.abs(diff) < 0.15) {
    return `<div class="card nut-check ok"><p><b>✅ Du liegst im Plan</b></p>
      <p class="hint nut-small">Letzte ${t.days} Tage: ${fmt(t.perWeek)} (geplant ${fmt(c.planned)}). Weiter so!</p></div>`;
  }
  const corr = Math.max(-300, Math.min(300, Math.round(-diff * NUT_KCAL_KG / 7 / 50) * 50));
  const what = diff > 0
    ? (c.planned < 0 ? 'Du nimmst langsamer ab als geplant.' : c.planned > 0 ? 'Du nimmst schneller zu als geplant.' : 'Du nimmst zu, obwohl dein Gewicht gleich bleiben soll.')
    : (c.planned > 0 ? 'Du nimmst langsamer zu als geplant.' : c.planned < 0 ? 'Du nimmst schneller ab als geplant.' : 'Du nimmst ab, obwohl dein Gewicht gleich bleiben soll.');
  return `<div class="card nut-check off"><p><b>⚠️ ${what}</b></p>
    <p class="hint nut-small">Letzte ${t.days} Tage: ${fmt(t.perWeek)} (geplant ${fmt(c.planned)}). Vorschlag: täglich etwa
      <b>${Math.abs(corr)} kcal ${corr < 0 ? 'weniger' : 'mehr'}</b>. Die App rechnet dann ab heute neu und prüft in zwei Wochen wieder.</p>
    <button class="btn primary" data-action="nut-adjust" data-v="${corr}">${nutSigned(corr, 'kcal')} übernehmen</button></div>`;
}

// Hinweise zum Ende einer Phase (Minicut vorbei, Diät sehr lang)
function nutPhaseHint(n) {
  const week = Math.floor(daysSince(n.since) / 7) + 1;
  const stage = n.phase === 'minicut' ? nutMinicutStage(n) : null;
  if (stage === 'maint') {
    // Erhaltungswoche: Deload im Training direkt anbieten, wenn der Plan ihn selbst bestimmen lässt
    const deload = hasActivePlan() && !ownPlan() && selfDeload() && !cycleInfo().deload;
    return `<div class="card nut-check ok"><p><b>🏁 Minicut geschafft – jetzt Erhaltungswoche</b></p>
      <p class="hint nut-small">Diese Woche isst du auf Erhaltungskalorien (das Tagesziel ist schon umgestellt). Kombiniere sie
        am besten mit einer Deload-Woche im Training, damit sich der Körper erholt.${deload ? '' : ` Liegt bei dir gerade kein Deload an,
        trainiere diese Woche bewusst leichter (weniger Sätze, etwas weniger Gewicht).`}</p>
      ${deload ? '<button class="btn primary" data-action="deload-now">😮‍💨 Deload-Woche einlegen</button>' : ''}</div>`;
  }
  if (stage === 'done') {
    const again = (n.round || 1) < 2;
    return `<div class="card nut-check ok"><p><b>✅ Minicut und Erhaltungswoche sind vorbei</b></p>
      <p class="hint nut-small">${again
        ? 'Zufrieden? Dann weiter mit dem Aufbau. Wenn nicht, kannst du noch einen – aber höchstens einen – weiteren Durchgang mit diesem Defizit machen.'
        : 'Das war dein zweiter Durchgang. Mehr empfiehlt die App am Stück nicht – weiter geht es mit Aufbau oder ein paar Wochen auf Erhaltung (Body Recomposition).'}</p>
      <button class="btn primary" data-action="nut-to-bulk">Weiter mit Aufbau</button>
      ${again ? '<button class="btn" data-action="nut-minicut-again">Noch ein Minicut-Durchgang (der letzte)</button>' : ''}</div>`;
  }
  if (n.phase === 'diet' && week > 16) {
    return `<div class="card nut-check"><p><b>💡 Schon ${week - 1} Wochen Diät</b></p>
      <p class="hint nut-small">Nach so langer Zeit tut eine Diätpause gut: 1–2 Wochen auf Erhaltung essen (Phase „Body Recomposition“,
      Tempo „Erhaltung“), danach geht es leichter weiter.</p></div>`;
  }
  return '';
}

function nutExplain(n, c, kg) {
  const pace = nutPace(n);
  return `<details class="card nut-help"><summary>So rechnet die App</summary>
      <p><b>Grundumsatz ${nutKcal(c.bmr)} kcal:</b> ${c.lbm != null
        ? `aus deiner fettfreien Masse (${fmtNum(round1(c.lbm))} kg bei ${fmtNum(n.bodyFat)} % Körperfett, Formel nach Katch-McArdle).`
        : `aus Gewicht, Größe, Alter (${c.age}) und Geschlecht (Formel nach Mifflin-St Jeor).`}</p>
      <p><b>Erhaltungsbedarf ${nutKcal(c.tdee)} kcal:</b> Grundumsatz × ${fmtNum(NUT_ACT[n.activity].f)} für „${NUT_ACT[n.activity].label}“.</p>
      <p><b>Tagesziel:</b> ${c.delta ? `${nutSigned(c.delta, 'kcal')} für „${pace.label}“${pace.range ? ` (Spanne +${pace.range[0]} bis +${pace.range[1]} kcal)` : ''}`
        : n.phase === 'minicut' ? 'Erhaltungswoche nach dem Minicut, also ±0 kcal' : `±0 kcal für „${pace.label}“`}${n.adjust ? `, dazu ${nutSigned(n.adjust, 'kcal')} aus deinem Gewichtsverlauf` : ''}.</p>
      ${n.macroPct
        ? `<p><b>Makros:</b> deine eigene Aufteilung – ${n.macroPct.p} % Eiweiß, ${n.macroPct.f} % Fett und ${n.macroPct.c} % Kohlenhydrate
          von ${nutKcal(c.kcal)} kcal (1 g Eiweiß oder Kohlenhydrate = 4 kcal, 1 g Fett = 9 kcal).</p>`
        : `<p><b>Eiweiß:</b> ${fmtNum(NUT_PROTEIN[n.phase].def)} g pro kg (Mitte der Spanne ${fmtNum(NUT_PROTEIN[n.phase].lo)}–${fmtNum(NUT_PROTEIN[n.phase].hi)} g)${Math.abs(c.ref - kg) > 1 ? `, bezogen auf ${fmtNum(Math.round(c.ref))} kg statt deines vollen Gewichts, weil viel Körperfett kein Eiweiß braucht` : ''}.
        <b>Fett:</b> ${n.phase === 'minicut' ? '20' : '25'} % der Kalorien, mindestens ${fmtNum(n.phase === 'minicut' ? 0.6 : 0.8)} g pro kg.
        <b>Kohlenhydrate:</b> der Rest.</p>`}
      <p>1 kg Körpergewicht entspricht grob ${deNum(NUT_KCAL_KG)} kcal. Rechne immer nur mit Schätzwerten (±10 %): Entscheidend ist,
        wie sich dein Gewicht über 2–3 Wochen entwickelt – dafür gibt es den Tempo-Check.</p>
      ${n.adjust ? `<button class="btn" data-action="nut-adjust-reset">Anpassung aus dem Gewichtsverlauf zurücksetzen</button>` : ''}
    </details>`;
}

function renderNutrition() {
  const n = data.nutrition;
  const kg = nutWeight();
  let h = '';
  if (!n) {
    h += `<div class="card wiz-q">
        <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🍽️</span><h2>Ernährung</h2></div>
        <p class="hint wiz-q-explain">Wähle deine Phase – Aufbau, Body Recomposition, Diät oder Minicut. Die App schätzt dann
          deinen Kalorienbedarf und sagt dir, wie viele Kalorien, Eiweiß, Fett und Kohlenhydrate pro Tag zu deinem Ziel passen.</p>
        <button class="btn primary" data-action="nut-setup">Los geht's</button>
      </div>`;
  } else if (kg == null) {
    h += `<div class="card"><p>Trag unten dein aktuelles Körpergewicht ein, dann berechnet die App wieder dein Tagesziel.</p></div>`;
  } else {
    const ph = NUT_PHASES[n.phase];
    const c = nutCalc(n, kg);
    const week = Math.floor(daysSince(n.since) / 7) + 1;
    const stage = n.phase === 'minicut' ? nutMinicutStage(n) : null;
    const weekText = !stage ? `Woche ${week}` : stage === 'cut'
      ? `Woche ${week} von ${Math.min(n.weeks, NUT_MINICUT_MAX)}${n.round === 2 ? ' · 2. Durchgang' : ''}` : stage === 'maint' ? 'Erhaltungswoche' : 'abgeschlossen';
    h += `<div class="nut-phase-head"><span class="wiz-q-icon" aria-hidden="true">${ph.icon}</span>
        <div><b>${ph.label}</b><small>seit ${fmtDate(n.since + 'T12:00:00')} · ${weekText} · ${nutPace(n).label}</small></div></div>
      ${nutPhaseHint(n)}
      ${nutTargetCard(n, c, true)}
      ${nutGoalCard(n, c, kg)}
      ${nutTrendCard(n, c)}
      ${n.phase === 'diet' || n.phase === 'minicut' ? `<div class="card nut-train">
        <p><b>🏋️ Training ${n.trainAdapt ? (n.phase === 'minicut' ? 'an den Minicut' : 'an die Diät') + ' angepasst' : 'läuft unverändert'}</b></p>
        <p class="hint nut-small">${n.trainAdapt ? (nutTrainAdapt() ? NUT_ADAPT_TEXT : 'In der Erhaltungswoche läuft das Training wieder normal (am besten als Deload).')
          : 'Du kannst den Plan an die Phase anpassen lassen: halber Volumenanstieg und 1 Wdh. näher am Muskelversagen.'}</p>
        <button class="btn" data-action="nut-train-toggle">${n.trainAdapt ? 'Anpassung ausschalten' : 'Training anpassen'}</button></div>` : ''}
      <div class="row nut-actions"><button class="btn" data-action="nut-edit">Angaben ändern</button>
        <button class="btn" data-action="nut-setup">Phase wechseln</button></div>
      ${nutExplain(n, c, kg)}
      <p class="hint nut-small nut-disclaimer">Alle Werte sind Richtwerte für gesunde Erwachsene. Bei Vorerkrankungen, in
        Schwangerschaft und Stillzeit oder bei Essstörungen bitte vorher ärztlich abklären.</p>`;
  }
  h += `<h2>Körpergewicht</h2>${bwCard()}${healthCard()}${rangeRow()}
    <div id="chart-area" class="chart-area"></div><div id="chart-extra"></div>${bwList()}`;
  return h;
}

// Linien im Gewichtsdiagramm: Zielgewicht (waagerecht) und Beginn der Phasen (senkrecht)
function nutMarks() {
  const n = data.nutrition;
  if (!n) return null;
  const starts = [...(n.history || []).map(x => ({ t: x.from, phase: x.phase })), { t: n.since, phase: n.phase }];
  return {
    goal: n.phase !== 'recomp' ? n.goalKg : null,
    phases: starts.map(s => ({ t: Date.parse(s.t + 'T00:00:00'), label: NUT_PHASES[s.phase].label })),
  };
}

// Neue Phase beginnen (alte Phase in die Historie)
function nutBeginPhase(n, phase, kg) {
  const prev = data.nutrition;
  const history = prev ? [...(prev.history || [])] : [];
  if (prev && prev.since !== todayISO()) history.push({ phase: prev.phase, from: prev.since, to: todayISO() });
  return { ...n, phase, since: todayISO(), startKg: kg, adjust: 0, adjustAt: null, history };
}

views.nutrition = { title: 'Ernährung', tab: 'nutrition', render: renderNutrition, after: () => { drawChart(); nutPctUpdate(); } };
views.nutphase = { title: 'Phase wählen', tab: 'nutrition', back: 'nutrition', cancel: () => NUT_CANCEL, render: renderNutPhase };
views.nutbody = { title: 'Deine Angaben', tab: 'nutrition', cancel: () => NUT_CANCEL, render: renderNutBody,
  back: () => [nutDraft && nutDraft.flow === 'nutphase' ? 'nutphase' : 'nutrition', {}] };
views.nutgoal = { title: 'Ziel & Tempo', tab: 'nutrition', back: 'nutbody', cancel: () => NUT_CANCEL, render: renderNutGoal };

Object.assign(actions, {
  'nut-setup': () => { nutMacroEdit = null; nutInit('nutphase'); go('nutphase'); },
  'nut-edit': () => { nutMacroEdit = null; nutInit('nutbody'); go('nutbody'); },
  'nut-phase': el => {
    const p = el.dataset.p;
    if (nutDraft.phase !== p) {
      nutDraft.phase = p;
      nutDraft.pace = p === 'recomp' ? 'light' : 'normal';  // Standard-Tempo; Recomp leicht unter Erhaltung
      nutDraft.goalKg = '';  // Zielgewicht der alten Phase passt meist nicht (z. B. Diät -> Aufbau)
      nutDraft.trainAdapt = null;  // bei Diät/Minicut jedes Mal neu fragen
    }
    go('nutbody');
  },
  'nut-sex': el => { nutDraft.sex = el.dataset.k; render(); },
  'nut-act': el => { nutDraft.activity = Number(el.dataset.k); render(); },
  'nut-navy': () => {
    const d = nutNumbers(nutDraft);
    const [waist, neck, hip] = ['waist', 'neck', 'hip'].map(k => parseNum(nutDraft[k] || ''));
    const bf = waist && neck && (d.sex === 'm' || hip) ? navyBodyFat(d.sex, d.height, waist, neck, hip) : null;
    if (bf == null) { alert(`Bitte ${d.sex === 'f' ? 'Bauch, Hals und Hüfte' : 'Bauch und Hals'} in cm eintragen.`); return; }
    nutDraft.bodyFat = fmtNum(bf);
    nutDraft.navyOpen = true;
    render();
    toast(`Geschätzt: ca. ${fmtNum(bf)} % Körperfett`);
  },
  'nut-body-next': () => {
    const err = nutBodyErrors(nutNumbers(nutDraft));
    if (err) { alert(err); return; }
    go('nutgoal');
  },
  'nut-pace': el => { nutDraft.pace = el.dataset.k; render(); },
  'nut-weeks': el => { nutDraft.weeks = Number(el.dataset.w); render(); },
  'nut-train-pick': el => { nutDraft.trainAdapt = el.dataset.v === '1'; render(); },
  'nut-train-toggle': () => {
    const n = data.nutrition;
    n.trainAdapt = !n.trainAdapt;
    saveData();
    toast(n.trainAdapt ? 'Training wird angepasst – ab dem nächsten Training' : 'Training läuft wieder wie im Plan');
    render();
  },
  'nut-save': () => {
    const d = nutNumbers(nutDraft);
    if ((d.phase === 'diet' || d.phase === 'minicut') && d.trainAdapt == null) {
      alert('Bitte noch auswählen, ob dein Trainingsplan an die Phase angepasst werden soll.');
      return;
    }
    if (d.goalKg != null && (d.goalKg < 30 || d.goalKg > 300)) { alert('Bitte ein gültiges Zielgewicht eintragen – oder das Feld leer lassen.'); return; }
    if (d.goalKg != null && d.phase === 'bulk' && d.goalKg <= d.kg) { alert('Im Aufbau sollte das Zielgewicht über deinem aktuellen Gewicht liegen.'); return; }
    if (d.goalKg != null && (d.phase === 'diet' || d.phase === 'minicut') && d.goalKg >= d.kg) { alert('In der Diät sollte das Zielgewicht unter deinem aktuellen Gewicht liegen.'); return; }
    // eingetipptes Gewicht als heutigen Eintrag speichern, wenn es vom letzten abweicht
    const last = currentBodyweight();
    if (last == null || Math.abs(last - d.kg) >= 0.05) saveBodyweight(todayISO(), d.kg);
    const n = {
      sex: d.sex, age: d.age, ageYear: new Date().getFullYear(), height: d.height, bodyFat: d.bodyFat, activity: d.activity,
      phase: d.phase, pace: d.pace, goalKg: d.phase === 'recomp' ? null : d.goalKg, weeks: Math.min(d.weeks || NUT_MINICUT_MAX, NUT_MINICUT_MAX),
      macroPct: d.macroPct || null,  // eigene Makro-Aufteilung bleibt auch beim Phasenwechsel
      trainAdapt: d.trainAdapt == null ? null : d.trainAdapt,
    };
    const prev = data.nutrition;
    data.nutrition = prev && prev.phase === d.phase
      ? { ...prev, ...n }
      : nutBeginPhase(n, d.phase, nutWeight());
    nutDraft = null;
    saveData();
    toast('Ernährung gespeichert ✔');
    go('nutrition');
  },
  'nut-adjust': el => {
    const n = data.nutrition;
    n.adjust = (n.adjust || 0) + Number(el.dataset.v);
    n.adjustAt = todayISO();
    saveData();
    toast(`Tagesziel angepasst: ${nutSigned(Number(el.dataset.v), 'kcal')}`);
    render();
  },
  'nut-adjust-reset': () => {
    if (!confirm('Anpassung aus dem Gewichtsverlauf zurücksetzen?\n\nDas Tagesziel wird wieder nur aus deinen Angaben berechnet.')) return;
    Object.assign(data.nutrition, { adjust: 0, adjustAt: todayISO() });
    saveData(); render();
  },
  // Minicut: zweiter (und letzter) Durchgang mit demselben Defizit
  'nut-minicut-again': () => {
    const n = data.nutrition;
    data.nutrition = nutBeginPhase({ ...n, round: 2 }, 'minicut', nutWeight());
    saveData();
    toast('Zweiter Minicut-Durchgang ⚡');
    render();
  },
  'nut-to-bulk': () => {
    const n = data.nutrition;
    data.nutrition = nutBeginPhase({ ...n, pace: 'normal', goalKg: null, round: 1 }, 'bulk', nutWeight());
    saveData();
    toast('Weiter mit Aufbau 💪');
    render();
  },
  'nut-pct-edit': () => {
    const c = nutCalc(data.nutrition, nutWeight());
    const pct = nutPctOf(c);
    nutMacroEdit = { p: String(pct.p), f: String(pct.f), c: String(pct.c), kcal: c.kcal };
    render();
    nutPctUpdate();
  },
  'nut-pct-cancel': () => { nutMacroEdit = null; render(); },
  'nut-pct-save': () => {
    const e = nutMacroEdit;
    const v = Object.fromEntries(NUT_MACROS.map(([k]) => [k, parseNum(e[k])]));
    if (Object.values(v).some(x => x == null || x < 0 || x > 100)) { alert('Bitte für alle drei Werte eine Zahl zwischen 0 und 100 eintragen.'); return; }
    const sum = round1(v.p + v.f + v.c);
    if (sum !== 100) { alert(`Zusammen müssen es 100 % sein – gerade sind es ${fmtNum(sum)} %.`); return; }
    data.nutrition.macroPct = v;
    nutMacroEdit = null;
    saveData();
    toast('Eigene Aufteilung gespeichert ✔');
    render();
  },
  'nut-pct-reset': () => {
    data.nutrition.macroPct = null;
    saveData();
    toast('Wieder die Empfehlung der App');
    render();
  },
});

fields['nut-in'] = el => { nutDraft[el.dataset.k] = el.value; };
fields['nut-pct'] = el => { nutMacroEdit[el.dataset.k] = el.value; nutPctUpdate(); };
