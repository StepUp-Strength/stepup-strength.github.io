/* StepUp Strength · © 2026 Alex Hundt · Alle Rechte vorbehalten – siehe LICENSE */
/* ---------- Trainingsplan importieren (Excel, CSV, Google Sheets, Kopieren & Einfügen) ----------
   Wie beim Ernährungsplan (nutplan.js, dessen Leser npParseDelimited/npParseXlsx/npNum hier mitbenutzt werden):
   Spalten Tag, Übung, Sätze, Wdh., Gewicht (kg) – Sätze und Wdh. dürfen auch zusammen in einer Zelle stehen („3×10“),
   Wdh.-Bereiche („8–12“) zählen mit der ersten Zahl. Ohne Tag-Spalte gelten Zeilen mit nur einem Eintrag als Tag-Überschrift,
   mehrere Tabellenblätter können je ein Tag sein. Übungsnamen werden mit der Übungsliste abgeglichen (Vorschlag antippen).
   Ergebnis: ein Plan wie „Eigenen Plan übernehmen“ (Tage „Frei“ mit Sätzen × Wdh. + Startgewicht) – wahlweise gleich mit
   der Steigerung der App (wie „Doch die Steigerung der App nutzen“). Die Datei wird nur auf dem Gerät gelesen. */

const TP_ROLES = [['day', 'Trainingstag'], ['ex', 'Übung'], ['sets', 'Sätze'], ['reps', 'Wiederholungen'], ['kg', 'Gewicht (kg)']];
const TP_GUESS = {
  day: /^(tag|trainingstag|day|einheit|workout|session)/, ex: /ubung|exercise|bewegung|name/,
  sets: /satz|satze|sets?$|serie/, reps: /wdh|wiederh|reps?$|repetition/, kg: /gewicht|kg|last|weight|load/,
};

let tpImport = null;   // { sheets, si, head, map, name, perSheet, swaps: { Name: Ersatz }, prog: 'own'|'app', level }
let tpPasteOpen = false;

function tpStart(sheets, name) {
  sheets = sheets.filter(s => s.rows.length);
  if (!sheets.length) { alert('In der Datei wurde keine Tabelle mit Inhalt gefunden.'); return; }
  tpImport = { sheets, si: 0, name: (name || 'Importierter Plan').replace(/\.(xlsx|csv|txt)$/i, ''), swaps: {}, prog: 'own', level: null,
    perSheet: false };
  tpGuess();
  // mehrere Blätter ohne Tag-Spalte: vermutlich je Blatt ein Trainingstag
  tpImport.perSheet = sheets.length > 1 && tpImport.map.day == null;
  go('trainplan');
}

// Kopfzeile = Zeile mit den meisten bekannten Überschriften (in den ersten 10), dann Spalten raten
function tpGuess() {
  const rows = tpImport.sheets[tpImport.si].rows;
  let head = 0, best = -1;
  rows.slice(0, 10).forEach((r, i) => {
    const hits = r.filter(c => Object.values(TP_GUESS).some(re => re.test(norm(c)))).length;
    if (hits > best) { best = hits; head = i; }
  });
  const map = {};
  (rows[head] || []).forEach((c, i) => {
    const h = norm(c);
    for (const [role] of TP_ROLES) if (map[role] == null && TP_GUESS[role].test(h)) { map[role] = i; break; }
  });
  // ohne erkannte Übungs-Spalte: die erste Spalte mit überwiegend Text (außer der Tag-Spalte)
  if (map.ex == null) {
    const body = rows.slice(head + 1);
    const cols = Math.max(...rows.map(r => r.length));
    for (let i = 0; i < cols && map.ex == null; i++) {
      if (i === map.day) continue;
      const txt = body.filter(r => r[i] && npNum(r[i]) == null).length;
      if (txt >= body.length / 2) map.ex = i;
    }
  }
  Object.assign(tpImport, { head, map });
}

// „3×10“, „3 x 8-12“, „4 Sätze à 10“ -> { sets, reps }; Bereich „8–12“ -> erste Zahl
function tpSetsReps(setsCell, repsCell) {
  const both = String(setsCell || '').match(/(\d+)\s*(?:[x×*]|sätze?\s*(?:à|a|zu|x)?)\s*(\d+)/i)
    || String(repsCell || '').match(/(\d+)\s*[x×*]\s*(\d+)/i);
  if (both) return { sets: +both[1], reps: +both[2] };
  const first = s => { const m = String(s || '').match(/\d+/); return m ? +m[0] : null; };
  return { sets: first(setsCell), reps: first(repsCell) };
}

// Zeilen eines Blatts -> [{ day, ex, sets, reps, kg }]
function tpRows(sheet, head, fixedDay) {
  const { map } = tpImport;
  let day = fixedDay || '';
  const out = [];
  for (const r of sheet.rows.slice(head + 1)) {
    const get = k => map[k] != null ? String(r[map[k]] || '').trim() : '';
    const filled = r.filter(c => String(c).trim() !== '');
    // ohne Tag-Spalte: Zeile mit nur einem (Text-)Eintrag = Überschrift eines neuen Tages
    if (map.day == null && !fixedDay && filled.length === 1 && npNum(filled[0]) == null) { day = filled[0].trim(); continue; }
    if (map.day != null && get('day')) day = get('day');
    const ex = get('ex');
    if (!ex || npNum(ex) != null) continue;
    const { sets, reps } = tpSetsReps(get('sets'), get('reps'));
    out.push({ day: day || 'Trainingstag', ex, sets, reps, kg: npNum(get('kg')) });
  }
  return out;
}

// Übungsname -> Name aus der Übungsliste (gleich geschrieben) oder Vorschlag (ähnlichster Name), sonst null
const tpWords = s => norm(s).replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w.length > 2);
const TP_ALIAS = { lh: 'langhantel', kh: 'kurzhantel', bb: 'langhantel', db: 'kurzhantel', latzug: 'latziehen', schulterpresse: 'schulterdrucken',
  brustpresse: 'brustpresse', beinbizeps: 'beinbeuger', squat: 'kniebeugen', squats: 'kniebeugen', deadlift: 'kreuzheben', bench: 'bankdrucken' };
function tpMatch(name) {
  const k = nameKey(name);
  const exact = EXERCISE_LIST.find(([n]) => nameKey(n) === k) || (typeof data !== 'undefined' && data.customExercises || []).find(c => nameKey(c.name) === k);
  if (exact) return { known: Array.isArray(exact) ? exact[0] : exact.name };
  const words = norm(name).replace(/[^a-z0-9-]+/g, ' ').split(' ').filter(Boolean).map(w => TP_ALIAS[w] || w).filter(w => w.length > 2);
  if (!words.length) return {};
  let best = null, score = 0;
  for (const [n] of EXERCISE_LIST) {
    const ws = tpWords(n);
    const hit = words.filter(w => ws.some(x => x.startsWith(w) || w.startsWith(x))).length;
    const sc = hit / Math.max(words.length, ws.length) + (ws[0] && words[0] && ws[0].startsWith(words[0]) ? 0.25 : 0);
    if (hit && sc > score) { score = sc; best = n; }
  }
  return score >= 0.5 ? { suggest: best } : {};
}

// Tage des Plans aus der Zuordnung
function tpBuild() {
  const im = tpImport;
  const rows = im.perSheet
    ? im.sheets.flatMap(s => tpRows(s, im.head, s.name))
    : tpRows(im.sheets[im.si], im.head);
  const days = [];
  for (const r of rows) {
    let d = days.find(x => x.name === r.day);
    if (!d) days.push(d = { name: r.day, exercises: [] });
    d.exercises.push({ orig: r.ex, name: im.swaps[r.ex] || r.ex, sets: Math.min(20, Math.max(1, r.sets || 3)), reps: Math.min(50, Math.max(1, r.reps || 10)),
      kg: r.kg != null && r.kg > 0 ? r.kg : null, guessedSets: !r.sets, guessedReps: !r.reps });
  }
  return days;
}

function renderTrainPlan() {
  if (tpImport) return tpMappingHtml();
  return `<div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">📄</span><h2>Trainingsplan übernehmen</h2></div>
      <p class="hint wiz-q-explain">Du hast deinen Plan schon als Tabelle – z. B. vom Trainer, aus Excel oder Google Sheets? Übernimm ihn einmal:
        Die App liest Trainingstage, Übungen, Sätze, Wiederholungen und Gewichte ein und erkennt die Übungen aus ihrer Bibliothek.</p>
      <button class="btn primary" data-action="tp-pick">📄 Datei wählen (Excel oder CSV)</button>
      <button class="btn" data-action="tp-paste-open">📋 Tabelle einfügen</button>
      ${tpPasteOpen ? `<textarea class="inp comment" id="tp-paste" rows="6" placeholder="In Excel oder Google Sheets die Zellen markieren (mit Überschriften), kopieren und hier einfügen"></textarea>
        <button class="btn primary" data-action="tp-paste-go">Übernehmen</button>` : ''}
      <p class="hint nut-small"><b>Google Sheets:</b> Datei → Herunterladen → Microsoft Excel (.xlsx) bzw. am Handy „Teilen und exportieren →
        Kopie senden“ – oder einfach die Zellen kopieren und oben einfügen. Die Datei wird nur auf deinem Handy gelesen, nichts wird hochgeladen.</p>
    </div>
    <div class="card">
      <h2>Vorlage</h2>
      <p class="hint nut-small">Noch keine Tabelle? Lade die Vorlage herunter, trag deine Tage und Übungen ein und importiere sie hier.
        Sätze und Wiederholungen dürfen auch zusammen in einer Spalte stehen (z. B. „3×10“), Bereiche wie „8–12“ sind erlaubt.</p>
      <button class="btn" data-action="tp-template">⬇ Vorlage herunterladen</button>
    </div>`;
}

function tpMappingHtml() {
  const im = tpImport;
  const rows = im.sheets[im.si].rows;
  const head = rows[im.head] || [];
  const cols = Math.max(...rows.map(r => r.length));
  const colName = i => head[i] ? `${String.fromCharCode(65 + i)}: ${head[i]}` : `Spalte ${String.fromCharCode(65 + i)}`;
  const sel = role => `<select class="inp sel" data-field="tp-map" data-k="${role}"><option value="">–</option>${Array.from({ length: cols }, (_, i) =>
    `<option value="${i}" ${im.map[role] === i ? 'selected' : ''}>${esc(colName(i))}</option>`).join('')}</select>`;
  const days = tpBuild();
  const preview = rows.slice(im.head, im.head + 7);
  const exRow = (d, e) => {
    const m = tpMatch(e.name);
    const tag = m.known ? '<span class="tp-ok">✓</span>' : '<span class="tp-new">neu</span>';
    const sugg = !m.known && m.suggest
      ? `<button class="vchip tp-sugg" data-action="tp-swap" data-from="${esc(e.orig)}" data-to="${esc(m.suggest)}">→ ${esc(m.suggest)}?</button>` : '';
    const undo = im.swaps[e.orig] ? `<button class="link-btn" data-action="tp-swap" data-from="${esc(e.orig)}" data-to="">↩ „${esc(e.orig)}“</button>` : '';
    return `<li>${tag} <b>${esc(e.name)}</b> · ${e.sets} × ${e.reps}${e.kg != null ? ` · ${fmtNum(e.kg)} kg` : ''}
      ${e.guessedSets || e.guessedReps ? '<small class="hint">(fehlende Werte: 3 × 10 angenommen)</small>' : ''}${sugg}${undo}</li>`;
  };
  const unknown = days.flatMap(d => d.exercises).filter(e => !tpMatch(e.name).known).length;
  const suggs = days.flatMap(d => d.exercises).filter(e => !tpMatch(e.name).known && tpMatch(e.name).suggest).length;
  return `<div class="card">
      <h2>Spalten zuordnen</h2>
      ${im.sheets.length > 1 ? `<label class="row"><span>Tabellenblatt</span><select class="inp sel" data-field="tp-sheet" ${im.perSheet ? 'disabled' : ''}>${im.sheets.map((s, i) =>
        `<option value="${i}" ${im.si === i ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <div class="variants"><button class="vchip ${im.perSheet ? 'on' : ''}" data-action="tp-persheet">Jedes Tabellenblatt ist ein Trainingstag</button></div>` : ''}
      <div class="table-wrap"><table class="rir np-prev">${preview.map((r, ri) => `<tr>${Array.from({ length: cols }, (_, i) =>
        `<${ri === 0 ? 'th' : 'td'}>${esc(r[i] || '')}</${ri === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table></div>
      <p class="hint nut-small">Die App hat die Spalten anhand der Überschriften erraten – prüf kurz, ob es passt. Ohne Spalte „Trainingstag“
        gilt eine Zeile mit nur einem Eintrag (z. B. „Push“ oder „Tag A“) als Überschrift für die Übungen darunter.</p>
      ${TP_ROLES.map(([k, l]) => `<label class="row"><span>${l}</span>${sel(k)}</label>`).join('')}
      <label class="row"><span>Kopfzeile ist Zeile</span><input class="inp kg" type="text" inputmode="numeric" data-field="tp-head" value="${im.head + 1}"></label>
    </div>
    <div class="card">
      <h2>Vorschau: ${days.length} Trainingstag${days.length === 1 ? '' : 'e'}</h2>
      ${suggs > 1 ? `<button class="btn" data-action="tp-swap-all">✔ Alle ${suggs} Vorschläge übernehmen</button>` : ''}
      ${days.length ? days.map(d => `<p class="tp-day"><b>${esc(d.name)}</b></p><ul class="tp-list">${d.exercises.map(e => exRow(d, e)).join('')}</ul>`).join('')
        : '<p class="hint">Noch keine Übungen erkannt – ordne mindestens die Spalte „Übung“ zu.</p>'}
      ${unknown ? `<p class="hint nut-small"><span class="tp-new">neu</span> = nicht in der Übungsliste – wird als eigene Übung übernommen (ohne Animation).
        Ein Vorschlag „→ …?“ tauscht sie gegen die passende Übung aus der Bibliothek.</p>` : ''}
    </div>
    <div class="card">
      <h2>Wie möchtest du trainieren?</h2>
      <button class="split-opt cat ${im.prog === 'own' ? 'on' : ''}" data-action="tp-prog" data-k="own"><span class="cat-icon">✍️</span>
        <b>Wie im Plan, ohne Steigerung</b><small>Im Training stehen deine Sätze × Wdh. und beim nächsten Mal deine Werte vom letzten Mal. Die Steigerung lässt sich später im Plan-Reiter einschalten.</small></button>
      <button class="split-opt cat ${im.prog === 'app' ? 'on' : ''}" data-action="tp-prog" data-k="app"><span class="cat-icon">📈</span>
        <b>Mit Steigerung der App</b><small>Deine Übungen, Sätze und Wdh. als Start – die App plant Zyklen mit Intro-, Aufbau- und Deload-Woche und schlägt Woche für Woche mehr Gewicht bzw. Wiederholungen vor.</small></button>
      ${im.prog === 'app' ? `<p class="lbl">Deine Trainingserfahrung</p><div class="variants">${Object.entries(LEVELS).map(([k, l]) =>
        `<button class="vchip ${im.level === k ? 'on' : ''}" data-action="tp-level" data-k="${k}">${l.icon} ${l.label}</button>`).join('')}</div>
        <p class="hint nut-small">Bestimmt, wie schnell die App steigert (und bei Neulingen und Einsteigern: nie unter 8 Wdh.).</p>` : ''}
      <label class="lbl">Name des Plans<input class="inp" type="text" data-field="tp-name" value="${esc(im.name)}"></label>
    </div>
    <button class="btn primary" data-action="tp-save" ${days.length ? '' : 'disabled'}>✔ Plan übernehmen</button>
    <button class="btn center" data-action="tp-cancel">Abbrechen</button>`;
}

// Vorlage (CSV mit Semikolon – öffnet sich direkt in Excel und Google Sheets)
async function tpTemplate() {
  const rows = [['Trainingstag', 'Übung', 'Sätze', 'Wdh.', 'Gewicht (kg)'],
    ['Oberkörper', 'Bankdrücken Flachbank (Langhantel)', '3', '8', '60'], ['Oberkörper', 'Latziehen breit', '3', '10', '50'],
    ['Oberkörper', 'Schulterdrücken Kurzhantel sitzend', '3', '10', '16'], ['Oberkörper', 'Bizepscurls SZ-Stange', '2', '12', '25'],
    ['Unterkörper', 'Kniebeugen (Langhantel)', '3', '8', '80'], ['Unterkörper', 'Kreuzheben rumänisch (Langhantel)', '3', '10', '70'],
    ['Unterkörper', 'Beinstrecker', '2', '12-15', '40'], ['Unterkörper', 'Wadenheben stehend', '3', '15', '']];
  const csv = '﻿' + rows.map(r => r.join(';')).join('\r\n');
  const name = 'trainingsplan-vorlage.csv';
  const file = new File([csv], name, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Trainingsplan-Vorlage' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

views.trainplan = { title: 'Plan übernehmen', tab: 'plan', back: 'plan', render: renderTrainPlan,
  cancel: () => tpImport ? { ask: 'Import abbrechen?', run: () => { tpImport = null; go('trainplan'); } } : null };

Object.assign(actions, {
  'tp-open': () => { tpImport = null; tpPasteOpen = false; if (typeof wiz !== 'undefined') wiz = null; go('trainplan'); },
  'tp-pick': () => {
    let input = document.getElementById('tp-file');
    if (!input) {
      document.body.insertAdjacentHTML('beforeend', '<input type="file" id="tp-file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>');
      input = document.getElementById('tp-file');
      input.addEventListener('change', async () => {
        const f = input.files[0];
        input.value = '';
        if (!f) return;
        try {
          if (/\.xlsx$/i.test(f.name)) tpStart(await npParseXlsx(await f.arrayBuffer()), f.name);
          else if (/\.xls$|\.numbers$|\.ods$/i.test(f.name)) alert('Bitte die Datei als .xlsx (Excel) oder .csv speichern – dieses Format kann die App nicht lesen.');
          else tpStart([{ name: f.name, rows: npParseDelimited(await f.text()) }], f.name);
        } catch (e) {
          alert(`Die Datei konnte nicht gelesen werden (${e.message}). Speichere sie als .csv oder kopiere die Zellen und füge sie ein.`);
        }
      });
    }
    input.click();
  },
  'tp-paste-open': () => { tpPasteOpen = !tpPasteOpen; render(); },
  'tp-paste-go': () => {
    const t = (document.getElementById('tp-paste') || {}).value || '';
    if (!t.trim()) { alert('Bitte zuerst die Tabelle einfügen.'); return; }
    tpPasteOpen = false;
    tpStart([{ name: 'Eingefügt', rows: npParseDelimited(t) }], 'Importierter Plan');
  },
  'tp-template': () => tpTemplate(),
  'tp-cancel': () => { tpImport = null; render(); },
  'tp-map': el => { tpImport.map[el.dataset.k] = el.value === '' ? null : Number(el.value); render(); },
  'tp-sheet': el => { tpImport.si = Number(el.value); tpGuess(); render(); },
  'tp-persheet': () => { tpImport.perSheet = !tpImport.perSheet; render(); },
  'tp-head': el => { const n = parseInt(el.value, 10); if (n >= 1 && n <= tpImport.sheets[tpImport.si].rows.length) { tpImport.head = n - 1; render(); } },
  'tp-name': el => { tpImport.name = el.value; },
  'tp-swap': el => { if (el.dataset.to) tpImport.swaps[el.dataset.from] = el.dataset.to; else delete tpImport.swaps[el.dataset.from]; render(); },
  'tp-swap-all': () => {
    for (const e of tpBuild().flatMap(d => d.exercises)) {
      const m = tpMatch(e.name);
      if (!m.known && m.suggest) tpImport.swaps[e.orig] = m.suggest;
    }
    render();
  },
  'tp-prog': el => { tpImport.prog = el.dataset.k; render(); },
  'tp-level': el => { tpImport.level = el.dataset.k; render(); },
  'tp-save': () => {
    const im = tpImport;
    if (im.prog === 'app' && !im.level) { alert('Bitte wähle noch deine Trainingserfahrung – danach richtet sich die Steigerung.'); return; }
    if (draft && !confirm(`Es läuft noch ein Training (${draft.dayName}). Trotzdem den neuen Plan aktiv setzen?`)) return;
    const days = tpBuild().map(d => ({
      id: uid(), name: d.name, intensity: '',
      exercises: d.exercises.map(e => withDefaults({ id: uid(), name: e.name, sets: e.sets, setsEnd: e.sets, reps: e.reps, startWeight: e.kg,
        // mit Steigerung rechnet die App mit „Max. bei 10 Wdh.“: aus Gewicht × Wdh. geschätzt (etwa 2 Wdh. im Tank),
        // sofern dafür noch nichts bekannt ist
        max10: im.prog === 'app' && e.kg != null && knownMax10(e.name) == null
          ? Math.round(e.kg / repFactor(e.reps + 2) * 2) / 2 : knownMax10(e.name) })),
    }));
    // eingetragenes Gewicht gilt an seiner Stelle im Tag: geschätztes Max. auf frisch umrechnen (Vorermüdung)
    if (im.prog === 'app') for (const d of days) {
      const list = d.exercises.map(e => ({ name: e.name, n: e.sets }));
      d.exercises.forEach((e, i) => { const f = preFatigue(list, i); if (e.max10 != null && f && knownMax10(e.name) == null) e.max10 = Math.round(e.max10 / (1 - f) * 2) / 2; });
    }
    const plan = newPlan((im.name || '').trim() || 'Importierter Plan', days);
    if (im.prog === 'app') plan.level = im.level;
    else Object.assign(plan, { own: true, progression: { volume: false, load: false } });
    data.plans.push(plan);
    data.activePlanId = plan.id;
    setRound(newCycleId(), 1, 1);  // wie im Assistenten: neuer Plan = Zyklus 1
    saveData();
    tpImport = null;
    toast(`„${plan.name}“ übernommen und aktiv ✔`);
    go('plan');
  },
});
// Felder (Auswahllisten, Eingaben) laufen über dieselben Aktionen
Object.assign(fields, {
  'tp-map': el => actions['tp-map'](el), 'tp-sheet': el => actions['tp-sheet'](el),
  'tp-head': el => actions['tp-head'](el), 'tp-name': el => actions['tp-name'](el),
});

// Knopf für Plan-Reiter und Assistent
const TP_OPEN_BTN = `<button class="btn nav tp-open-btn" data-action="tp-open">📄 Plan aus Excel / Google Sheets übernehmen<small>Tabelle mit Tagen, Übungen, Sätzen und Wdh. – z. B. vom Trainer</small></button>`;
