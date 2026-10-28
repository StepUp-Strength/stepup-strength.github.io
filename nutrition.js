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
      ['Kalorien', '+150 bis +500 kcal über deinem Erhaltungsbedarf. Je länger du schon trainierst, desto langsamer wachsen Muskeln – dann reicht ein kleinerer Überschuss, sonst landet das Mehr vor allem auf den Hüften.'],
      ['Tempo', 'Neulinge ca. 1–1,5 % des Körpergewichts pro Monat, Fortgeschrittene ca. 0,5–1 %. Bei 80 kg sind das grob 0,4–1,2 kg im Monat.'],
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
      ['Kalorien', 'Meist 300–750 kcal unter dem Erhaltungsbedarf. Das entspricht etwa 0,5–1 % deines Körpergewichts pro Woche.'],
      ['Tempo', 'Wer mehr Fett hat, kann zügiger abnehmen; je schlanker du bist, desto langsamer sollte es gehen. Langsamer = mehr Muskelerhalt und weniger Hunger.'],
      ['Dauer', 'Meist 8–16 Wochen. Danach ein paar Wochen auf Erhaltung essen (Diätpause), bevor es weitergeht oder in den Aufbau geht.'],
      ['Training', 'Gewichte so gut es geht halten. Gegen Ende kann die Kraft etwas sinken – das ist normal. Mehr Sätze bringen jetzt nichts.'],
      ['Fortschritt erkennst du an', 'gleichmäßig sinkendem Gewicht, schmalerer Taille und weitgehend gleicher Kraft.'],
    ],
  },
  minicut: {
    label: 'Minicut', icon: '⚡', short: 'Kurze, harte Diät über 2–6 Wochen – meist mitten in einer Aufbauphase.',
    long: [
      ['Worum geht es?', 'Eine kurze, bewusst harte Diät mit großem Defizit. Ziel ist, in kurzer Zeit etwas Fett loszuwerden, ohne lange aus dem Aufbau herauszugehen.'],
      ['Für wen?', 'Meist mitten im Aufbau, wenn sich zu viel Fett angesammelt hat, oder vor einem Anlass (Urlaub, Fotos). Nicht als Dauerlösung und nicht für Trainingsneulinge.'],
      ['Kalorien', 'Etwa 750–1.000 kcal unter dem Erhaltungsbedarf – ca. 1 % des Körpergewichts pro Woche, höchstens gut ein Drittel weniger als dein Bedarf.'],
      ['Tempo', 'In den ersten Tagen fällt das Gewicht schnell (vor allem Wasser), danach etwa 1 % pro Woche.'],
      ['Dauer', '2–6 Wochen. Danach 1–2 Wochen auf Erhaltung essen und weiter mit dem Aufbau.'],
      ['Training', 'Gewichte halten, eher ein paar Sätze weniger – mit wenig Energie erholst du dich schlechter. Kein guter Zeitpunkt für Rekordversuche.'],
      ['Fortschritt erkennst du an', 'deutlich sinkendem Gewicht und Bauchumfang bei gehaltener Kraft.'],
    ],
  },
};

// Tempo je Phase: kcal = fester Überschuss/Defizit, pct = % Körpergewicht pro Woche (Defizit daraus berechnet)
const NUT_PACES = {
  bulk: [
    { k: 'slow', label: 'Langsam', kcal: 150, text: 'Für Fortgeschrittene und alte Hasen – kaum Fettzunahme.' },
    { k: 'normal', label: 'Normal', kcal: 300, text: 'Der gute Mittelweg für die meisten.' },
    { k: 'fast', label: 'Zügig', kcal: 500, text: 'Für junge Neulinge mit wenig Körperfett – es kommt spürbar mehr Fett mit.' },
  ],
  recomp: [
    { k: 'maint', label: 'Erhaltung', kcal: 0, text: 'Wenn du schon recht schlank bist.' },
    { k: 'light', label: 'Leicht darunter', kcal: -150, text: 'Der übliche Weg – ein Hauch Defizit hilft beim Fettabbau.' },
    { k: 'more', label: 'Etwas mehr darunter', kcal: -300, text: 'Bei etwas mehr Körperfett.' },
  ],
  diet: [
    { k: 'slow', label: 'Sanft', pct: 0.5, text: 'Bestmöglicher Muskelerhalt, wenig Hunger – ideal, wenn du schon recht schlank bist.' },
    { k: 'normal', label: 'Normal', pct: 0.75, text: 'Der gute Mittelweg für die meisten.' },
    { k: 'fast', label: 'Zügig', pct: 1, text: 'Bei deutlich mehr Körperfett – mehr Hunger, eher Kraftverlust.' },
  ],
  minicut: [
    { k: 'normal', label: 'Standard', pct: 1, text: 'Ca. 1 % des Körpergewichts pro Woche.' },
    { k: 'hard', label: 'Hart', pct: 1.25, text: 'Nur für kurze 2–3 Wochen und wenn du dich gut fühlst.' },
  ],
};

// Aktivität = Alltag + Training zusammen (Faktor auf den Grundumsatz)
const NUT_ACT = {
  1: { label: 'Kaum aktiv', f: 1.2, text: 'Sitzender Alltag, kaum Bewegung, kein Sport.' },
  2: { label: 'Leicht aktiv', f: 1.375, text: 'Bürojob, 1–3 Trainings pro Woche oder ca. 5.000–7.500 Schritte am Tag.' },
  3: { label: 'Mäßig aktiv', f: 1.55, text: '3–5 Trainings pro Woche und ca. 7.500–10.000 Schritte – oder ein Job mit viel Stehen und Gehen.' },
  4: { label: 'Sehr aktiv', f: 1.725, text: 'Fast täglich Training und über 10.000 Schritte – oder körperlich anstrengende Arbeit.' },
  5: { label: 'Extrem aktiv', f: 1.9, text: 'Harte körperliche Arbeit plus Training oder Leistungssport.' },
};

// Eiweiß in g pro kg (Bezugsgewicht, siehe nutProteinKg)
const NUT_PROTEIN = { bulk: 1.8, recomp: 2.0, diet: 2.0, minicut: 2.2 };
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
  const pace = nutPace(n);
  let delta = pace.kcal != null ? pace.kcal : -pace.pct / 100 * kg * NUT_KCAL_KG / 7;
  let note = null;
  const cap = n.phase === 'minicut' ? 0.35 : 0.25;  // Defizit höchstens 25 % (Minicut 35 %) des Bedarfs
  if (delta < -cap * tdee) { delta = -cap * tdee; note = 'cap'; }
  const planned = delta * 7 / NUT_KCAL_KG;  // geplante Veränderung in kg pro Woche
  let kcal = tdee + delta + (n.adjust || 0);
  const floor = n.sex === 'm' ? 1500 : 1200;
  if (kcal < floor) { kcal = floor; note = 'floor'; }
  kcal = Math.round(kcal / 10) * 10;

  const ref = nutProteinKg(n, kg, lbm);
  const protein = Math.round(NUT_PROTEIN[n.phase] * ref / 5) * 5;
  const fatShare = n.phase === 'minicut' ? 0.2 : 0.25;
  const fatMin = (n.phase === 'minicut' ? 0.6 : 0.8) * ref;
  const fat = Math.round(Math.max(fatMin, kcal * fatShare / 9) / 5) * 5;
  const carbs = Math.max(0, Math.round((kcal - protein * 4 - fat * 9) / 4 / 5) * 5);
  return { age, lbm, bmr, tdee, delta, planned, kcal, note, protein, fat, carbs, ref };
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
  const n = { ...nutNumbers(d), adjust: data.nutrition && data.nutrition.phase === d.phase ? data.nutrition.adjust : 0 };
  const ph = NUT_PHASES[d.phase];
  const c = nutCalc(n, n.kg);
  const paces = NUT_PACES[d.phase].map(p => {
    const pc = nutCalc({ ...n, pace: p.k }, n.kg);  // Defizit nach der Begrenzung
    const delta = pc.delta, kgWeek = pc.planned;
    const info = p.pct != null
      ? `${pc.note === 'cap' ? `begrenzt auf ${nutSigned(delta, 'kcal')}` : `${fmtNum(p.pct)} % · ${nutSigned(delta, 'kcal')}`} · ≈ ${nutSigned(kgWeek, 'kg')} pro Woche`
      : `${nutSigned(delta, 'kcal')} · ${delta ? `≈ ${nutSigned(kgWeek * 4.3, 'kg')} im Monat` : 'Gewicht bleibt gleich'}`;
    return `<button class="split-opt ${d.pace === p.k ? 'on' : ''}" data-action="nut-pace" data-k="${p.k}">
        <b>${p.label}</b><small><b class="nut-pace-info">${info}</b>${p.text}</small></button>`;
  }).join('');
  const goal = d.phase === 'recomp' ? ''
    : `<label class="row"><span>Zielgewicht <small class="hint">(optional)</small></span>
        <input class="inp kg" type="text" inputmode="decimal" autocomplete="off" data-field="nut-in" data-k="goalKg"
          value="${esc(d.goalKg)}" placeholder="kg"></label>`;
  const weeks = d.phase !== 'minicut' ? '' : `<p class="lbl chips-title">Dauer</p>
      <div class="variants count">${[2, 3, 4, 5, 6].map(w => `<button class="vchip ${d.weeks === w ? 'on' : ''}"
        data-action="nut-weeks" data-w="${w}">${w} Wo.</button>`).join('')}</div>`;
  return `<div class="card wiz-q">
      ${d.flow === 'nutphase' ? nutStep(3, 3) : ''}
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">${ph.icon}</span><h2>${ph.label}: Ziel & Tempo</h2></div>
      <p class="hint wiz-q-explain">Wie schnell soll es gehen? Ausgangspunkt ist dein geschätzter Erhaltungsbedarf von
        <b>${nutKcal(c.tdee)} kcal</b> pro Tag.</p>
      ${paces}
      ${weeks}
      ${goal}
    </div>
    ${nutTargetCard(n, c)}
    <div class="row"><button class="btn" data-action="back">Zurück</button>
      <button class="btn primary" data-action="nut-save">Speichern</button></div>`;
}

/* ---------- Übersicht ---------- */

function nutTargetCard(n, c) {
  const notes = {
    cap: `Das Defizit ist auf ${n.phase === 'minicut' ? '35' : '25'} % deines Bedarfs begrenzt – mehr kostet zu viel Muskulatur.`,
    floor: `Weniger als ${deNum(n.sex === 'm' ? 1500 : 1200)} kcal empfiehlt die App nicht – sonst fehlen schnell Nährstoffe.`,
  };
  const adj = n.adjust ? ` · inkl. ${nutSigned(n.adjust, 'kcal')} aus deinem Gewichtsverlauf` : '';
  return `<div class="card nut-target">
      <span class="lbl">Dein Tagesziel</span>
      <b class="nut-kcal">${nutKcal(c.kcal)} kcal</b>
      <small>Erhaltungsbedarf ca. ${nutKcal(c.tdee)} kcal · ${nutSigned(c.delta, 'kcal')}${adj}</small>
      ${c.note ? `<p class="nut-warn">${notes[c.note]}</p>` : ''}
      <div class="nut-macros">
        ${[['Eiweiß', c.protein, 4, 'p'], ['Fett', c.fat, 9, 'f'], ['Kohlenhydrate', c.carbs, 4, 'c']].map(([l, g, f, k]) => `
          <div class="nut-macro ${k}"><span>${l}</span><b>${g} g</b><small>${nutKcal(g * f)} kcal</small></div>`).join('')}
      </div>
      <div class="nut-bar" aria-hidden="true">${[['p', c.protein * 4], ['f', c.fat * 9], ['c', c.carbs * 4]].map(([k, v]) =>
        `<div class="${k}" style="flex:${v}"></div>`).join('')}</div>
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
  if (n.phase === 'minicut' && week > n.weeks) {
    return `<div class="card nut-check ok"><p><b>🏁 Dein Minicut ist geschafft!</b></p>
      <p class="hint nut-small">${n.weeks} Wochen sind um. Iss jetzt 1–2 Wochen auf Erhaltung und geh dann zurück in den Aufbau.</p>
      <button class="btn primary" data-action="nut-to-bulk">Weiter mit Aufbau</button></div>`;
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
      <p><b>Tagesziel:</b> ${pace.pct != null ? `${fmtNum(pace.pct)} % von ${fmtNum(kg)} kg pro Woche ≈ ${nutSigned(c.delta, 'kcal')} am Tag`
        : `${nutSigned(c.delta, 'kcal')} für „${pace.label}“`}${n.adjust ? `, dazu ${nutSigned(n.adjust, 'kcal')} aus deinem Gewichtsverlauf` : ''}.</p>
      <p><b>Eiweiß:</b> ${fmtNum(NUT_PROTEIN[n.phase])} g pro kg${Math.abs(c.ref - kg) > 1 ? ` (bezogen auf ${fmtNum(Math.round(c.ref))} kg statt deines vollen Gewichts, weil viel Körperfett kein Eiweiß braucht)` : ''}.
        <b>Fett:</b> ${n.phase === 'minicut' ? '20' : '25'} % der Kalorien, mindestens ${fmtNum(n.phase === 'minicut' ? 0.6 : 0.8)} g pro kg.
        <b>Kohlenhydrate:</b> der Rest.</p>
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
    const weekText = n.phase === 'minicut' ? `Woche ${Math.min(week, n.weeks)} von ${n.weeks}` : `Woche ${week}`;
    h += `<div class="nut-phase-head"><span class="wiz-q-icon" aria-hidden="true">${ph.icon}</span>
        <div><b>${ph.label}</b><small>seit ${fmtDate(n.since + 'T12:00:00')} · ${weekText} · ${nutPace(n).label}</small></div></div>
      ${nutPhaseHint(n)}
      ${nutTargetCard(n, c)}
      ${nutGoalCard(n, c, kg)}
      ${nutTrendCard(n, c)}
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

views.nutrition = { title: 'Ernährung', tab: 'nutrition', render: renderNutrition, after: drawChart };
views.nutphase = { title: 'Phase wählen', tab: 'nutrition', back: 'nutrition', cancel: () => NUT_CANCEL, render: renderNutPhase };
views.nutbody = { title: 'Deine Angaben', tab: 'nutrition', cancel: () => NUT_CANCEL, render: renderNutBody,
  back: () => [nutDraft && nutDraft.flow === 'nutphase' ? 'nutphase' : 'nutrition', {}] };
views.nutgoal = { title: 'Ziel & Tempo', tab: 'nutrition', back: 'nutbody', cancel: () => NUT_CANCEL, render: renderNutGoal };

Object.assign(actions, {
  'nut-setup': () => { nutInit('nutphase'); go('nutphase'); },
  'nut-edit': () => { nutInit('nutbody'); go('nutbody'); },
  'nut-phase': el => {
    const p = el.dataset.p;
    if (nutDraft.phase !== p) {
      nutDraft.phase = p;
      // Standard-Tempo: Aufbau für alte Hasen langsam, Recomp leicht darunter, sonst normal
      nutDraft.pace = p === 'bulk' ? (nutDraft.level === 'hase' ? 'slow' : 'normal') : p === 'recomp' ? 'light' : 'normal';
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
  'nut-save': () => {
    const d = nutNumbers(nutDraft);
    if (d.goalKg != null && (d.goalKg < 30 || d.goalKg > 300)) { alert('Bitte ein gültiges Zielgewicht eintragen – oder das Feld leer lassen.'); return; }
    if (d.goalKg != null && d.phase === 'bulk' && d.goalKg <= d.kg) { alert('Im Aufbau sollte das Zielgewicht über deinem aktuellen Gewicht liegen.'); return; }
    if (d.goalKg != null && (d.phase === 'diet' || d.phase === 'minicut') && d.goalKg >= d.kg) { alert('In der Diät sollte das Zielgewicht unter deinem aktuellen Gewicht liegen.'); return; }
    // eingetipptes Gewicht als heutigen Eintrag speichern, wenn es vom letzten abweicht
    const last = currentBodyweight();
    if (last == null || Math.abs(last - d.kg) >= 0.05) saveBodyweight(todayISO(), d.kg);
    const n = {
      sex: d.sex, age: d.age, ageYear: new Date().getFullYear(), height: d.height, bodyFat: d.bodyFat, activity: d.activity,
      phase: d.phase, pace: d.pace, goalKg: d.phase === 'recomp' ? null : d.goalKg, weeks: d.weeks || 4,
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
  'nut-to-bulk': () => {
    const n = data.nutrition;
    data.nutrition = nutBeginPhase({ ...n, pace: activePlan().level === 'hase' ? 'slow' : 'normal', goalKg: null }, 'bulk', nutWeight());
    saveData();
    toast('Weiter mit Aufbau 💪');
    render();
  },
});

fields['nut-in'] = el => { nutDraft[el.dataset.k] = el.value; };
