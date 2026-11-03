/* ---------- Ernährungsplan importieren (Excel, CSV, Google Sheets, Kopieren & Einfügen) ----------
   data.nutPlan = { name, importedAt, start, assign: 'weekday' | 'daytype' | 'rotation' | 'same',
                    days: [{ label, kind?: 'train'|'rest', weekday?: 0–6 (Mo = 0), kcal, p, c, f,
                             meals: { b|l|d|s: [{ name, g, kcal, p, c, f }] } }], typeFor: { Datum: 'train'|'rest' } }
   Ist ein Plan aktiv, ist er maßgeblich: das Tagesziel kommt aus ihm (nutForDay in nutrition.js), Gewichtsverlauf und
   gemessener Bedarf geben nur noch Hinweise. Die Datei wird nur auf dem Gerät gelesen, nichts wird hochgeladen. */

const NP_ROLES = [
  ['day', 'Tag'], ['meal', 'Mahlzeit'], ['food', 'Lebensmittel'], ['g', 'Menge (g)'],
  ['kcal', 'Kalorien (kcal)'], ['p', 'Eiweiß (g)'], ['c', 'Kohlenhydrate (g)'], ['f', 'Fett (g)'],
];
const NP_GUESS = {
  day: /^(tag|wochentag|day|plan ?tag)/, meal: /mahlzeit|meal|essen$|uhrzeit/, food: /lebensmittel|zutat|produkt|food|gericht|speise/,
  g: /menge|gramm|^g$|\(g\)$|gewicht|amount|portion/, kcal: /kcal|kalorie|energie|brennwert/, p: /eiwei|protein/,
  c: /kohlenhydrat|^kh|carb/, f: /^fett|fat|fette/,
};
const NP_WEEKDAYS = ['montag', 'dienstag', 'mittwoch', 'donnerstag', 'freitag', 'samstag', 'sonntag'];
const NP_ASSIGN = {
  weekday: 'Nach Wochentag', daytype: 'Trainingstag / Ruhetag', rotation: 'Der Reihe nach (Tag 1, 2 …)', same: 'Jeden Tag gleich',
};

const nutPlanActive = () => !!(data.nutPlan && data.nutPlan.days && data.nutPlan.days.length);

// Welcher Plantag gilt an einem Datum?
function nutPlanDay(date = todayISO()) {
  const pl = data.nutPlan;
  if (!nutPlanActive()) return null;
  const days = pl.days;
  if (pl.assign === 'weekday') {
    const wd = (new Date(date + 'T12:00:00').getDay() + 6) % 7;
    return days.find(d => d.weekday === wd) || days[0];
  }
  if (pl.assign === 'daytype') {
    const kind = npDayKind(date);
    return days.find(d => d.kind === kind) || days[0];
  }
  if (pl.assign === 'rotation') {
    const i = Math.max(0, Math.round((Date.parse(date + 'T12:00:00') - Date.parse(pl.start + 'T12:00:00')) / 86400000));
    return days[i % days.length];
  }
  return days[0];
}
// Trainingstag? Selbst gewählt, sonst: an diesem Tag trainiert bzw. Training läuft
function npDayKind(date) {
  const pl = data.nutPlan;
  if (pl.typeFor && pl.typeFor[date]) return pl.typeFor[date];
  const trained = data.sessions.some(s => new Date(s.date).toLocaleDateString('sv-SE') === date)
    || (typeof draft !== 'undefined' && draft && new Date(draft.date).toLocaleDateString('sv-SE') === date);
  return trained ? 'train' : 'rest';
}

// Tagesziel aus dem Plan (gleiche Felder wie nutCalc)
function nutPlanTarget(date = todayISO()) {
  const d = nutPlanDay(date);
  if (!d) return null;
  return { kcal: Math.round(d.kcal), protein: Math.round(d.p), carbs: Math.round(d.c), fat: Math.round(d.f),
    pLo: Math.round(d.p * 0.9 / 5) * 5, tdee: null, delta: 0, planned: 0, fromPlan: true, label: d.label };
}

/* ----- Einlesen: CSV, eingefügter Text, Excel (.xlsx) ----- */

function npParseDelimited(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/).find(l => l.trim()) || '';
  const sep = first.includes('\t') ? '\t' : (first.split(';').length >= first.split(',').length ? ';' : ',');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows.map(r => r.map(c => c.trim())).filter(r => r.some(c => c !== ''));
}

// Minimaler Excel-Leser: .xlsx ist ein ZIP mit XML-Dateien (entpackt mit DecompressionStream des Browsers)
async function npUnzip(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Keine gültige Excel-Datei');
  const n = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < n; k++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    files[name] = { method, data: u8.subarray(start, start + size) };
    p += 46 + nameLen + extra + comment;
  }
  return async name => {
    const f = files[name];
    if (!f) return null;
    if (f.method === 0) return dec.decode(f.data);
    if (typeof DecompressionStream === 'undefined') throw new Error('Dein Browser kann Excel-Dateien nicht entpacken');
    const out = await new Response(new Blob([f.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
    return dec.decode(out);
  };
}

async function npParseXlsx(buf) {
  const read = await npUnzip(buf);
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const all = (doc, tag) => [...doc.getElementsByTagNameNS('*', tag)];
  const shared = [];
  const ss = await read('xl/sharedStrings.xml');
  if (ss) for (const si of all(xml(ss), 'si')) shared.push(all(si, 't').map(t => t.textContent).join(''));
  const wb = xml(await read('xl/workbook.xml'));
  const rels = xml(await read('xl/_rels/workbook.xml.rels'));
  const target = id => { const r = all(rels, 'Relationship').find(x => x.getAttribute('Id') === id); return r ? r.getAttribute('Target').replace(/^\/?(xl\/)?/, 'xl/') : null; };
  const sheets = [];
  for (const sh of all(wb, 'sheet')) {
    const rid = sh.getAttribute('r:id') || [...sh.attributes].find(a => a.localName === 'id')?.value;
    const path = target(rid);
    const text = path && await read(path);
    if (!text) continue;
    const rows = [];
    for (const r of all(xml(text), 'row')) {
      const row = [];
      for (const c of all(r, 'c')) {
        const ref = c.getAttribute('r') || '';
        const col = ref.replace(/\d+/g, '').split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const t = c.getAttribute('t'), vEl = all(c, 'v')[0];
        let val = t === 'inlineStr' ? all(c, 't').map(x => x.textContent).join('') : vEl ? vEl.textContent : '';
        if (t === 's') val = shared[Number(val)] || '';
        if (t !== 's' && t !== 'inlineStr' && t !== 'str' && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(val)) val = String(Math.round(Number(val) * 100) / 100).replace('.', ',');
        row[col >= 0 ? col : row.length] = val.trim();
      }
      rows.push(Array.from(row, x => x || ''));
    }
    sheets.push({ name: sh.getAttribute('name'), rows: rows.filter(r => r.some(c => c !== '')) });
  }
  return sheets;
}

/* ----- Zuordnen und Plan bauen ----- */

let npImport = null;  // { sheets, si, head, map, assign, name }

function npStart(sheets, name) {
  sheets = sheets.filter(s => s.rows.length);
  if (!sheets.length) { alert('In der Datei wurde keine Tabelle mit Inhalt gefunden.'); return; }
  npImport = { sheets, si: 0, name: (name || 'Ernährungsplan').replace(/\.(xlsx|csv|txt)$/i, '') };
  npGuess();
  go('nutplan');
}

// Kopfzeile finden (erste Zeile mit mind. 2 bekannten Überschriften) und Spalten raten
function npGuess() {
  const rows = npImport.sheets[npImport.si].rows;
  let head = 0, best = -1;
  rows.slice(0, 10).forEach((r, i) => {
    const hits = r.filter(c => Object.values(NP_GUESS).some(re => re.test(norm(c)))).length;
    if (hits > best) { best = hits; head = i; }
  });
  const map = {};
  (rows[head] || []).forEach((c, i) => {
    const h = norm(c);
    for (const [role] of NP_ROLES) if (map[role] == null && NP_GUESS[role].test(h)) { map[role] = i; break; }
  });
  Object.assign(npImport, { head, map });
  npImport.assign = npDetectAssign();
}

const npNum = s => {
  let t = String(s || '').replace(/[^\d.,-]/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) t = t.replace(/\./g, '');
  const n = parseNum(t);
  return n != null && isFinite(n) ? n : null;
};
const npMeal = s => { const t = norm(s);
  return /fruh/.test(t) ? 'b' : /mittag/.test(t) ? 'l' : /abend/.test(t) ? 'd' : t ? 's' : null; };
function npWeekday(s) { const t = norm(s); return NP_WEEKDAYS.findIndex(w => t.startsWith(norm(w).slice(0, 2)) && (t.length <= 3 || t.startsWith(norm(w).slice(0, 3)))); }
const npKind = s => { const t = norm(s); return /ruhe|frei|rest|off|pause|kein/.test(t) ? 'rest' : /train|gym|sport|workout/.test(t) ? 'train' : null; };

// Datenzeilen mit Tag-Fortschreibung (leere Tag-Zelle = gleicher Tag wie darüber)
function npDataRows() {
  const { sheets, si, head, map } = npImport;
  const rows = sheets[si].rows.slice(head + 1);
  let day = '', meal = '';
  return rows.map(r => {
    const get = k => map[k] != null ? r[map[k]] || '' : '';
    if (get('day')) day = get('day');
    if (get('meal')) meal = get('meal');
    return { day: day || 'Jeden Tag', meal: get('meal') || meal, food: get('food'), g: npNum(get('g')),
      kcal: npNum(get('kcal')), p: npNum(get('p')), c: npNum(get('c')), f: npNum(get('f')) };
  }).filter(x => x.food || x.kcal != null || x.p != null);
}

function npDetectAssign() {
  const labels = [...new Set(npDataRows().map(x => x.day))];
  if (labels.length <= 1) return 'same';
  if (labels.every(l => npKind(l))) return 'daytype';
  if (labels.filter(l => npWeekday(l) >= 0).length >= Math.min(labels.length, 2)) return 'weekday';
  return 'rotation';
}

// Plan aus den Zeilen bauen; fehlende Nährwerte über die Grundliste (Menge × je 100 g)
function npBuild() {
  const byDay = new Map();
  let unknown = [];
  for (const x of npDataRows()) {
    if (!byDay.has(x.day)) byDay.set(x.day, []);
    let { kcal, p, c, f } = x;
    if (x.food && kcal == null && p == null && x.g) {
      const hit = foodSearch(x.food)[0];
      if (hit) [kcal, p, c, f] = foodVal(hit.per, x.g);
      else unknown.push(x.food);
    }
    if (kcal == null && (p != null || c != null || f != null)) kcal = (p || 0) * 4 + (c || 0) * 4 + (f || 0) * 9;
    byDay.get(x.day).push({ ...x, kcal: kcal || 0, p: p || 0, c: c || 0, f: f || 0 });
  }
  const days = [...byDay.entries()].map(([label, items]) => {
    const sum = k => Math.round(items.reduce((a, i) => a + i[k], 0));
    const meals = {};
    if (npImport.map.food != null || npImport.map.meal != null) {
      for (const i of items) {
        const k = npMeal(i.meal) || 's';
        (meals[k] = meals[k] || []).push({ name: i.food || (i.meal ? `${i.meal} laut Plan` : 'laut Plan'), g: i.g || null,
          kcal: Math.round(i.kcal), p: round1(i.p), c: round1(i.c), f: round1(i.f) });
      }
    }
    const wd = npWeekday(label);
    return { label, kind: npKind(label), weekday: wd >= 0 ? wd : null, kcal: sum('kcal'), p: sum('p'), c: sum('c'), f: sum('f'), meals };
  }).filter(d => d.kcal > 0);
  return { days, unknown: [...new Set(unknown)] };
}

/* ----- Ansicht ----- */

function renderNutPlan() {
  if (npImport) return npMappingHtml();
  const pl = data.nutPlan;
  if (nutPlanActive()) {
    const today = nutPlanDay();
    return `<div class="card">
        <h2>📋 ${esc(pl.name)}</h2>
        <p class="hint nut-small">Importiert am ${fmtDate(pl.importedAt + 'T12:00:00')} · ${NP_ASSIGN[pl.assign]}. Solange der Plan aktiv ist,
          kommt dein Tagesziel aus ihm – die App schlägt keine eigenen Änderungen vor, sondern gibt nur Hinweise.</p>
      </div>
      ${pl.days.map(d => `<div class="card np-day ${d === today ? 'now' : ''}">
        <p><b>${esc(d.label)}</b>${d === today ? ' <span class="badge">heute</span>' : ''}</p>
        <div class="nut-goal-row food-sum"><span>Kalorien<b>${nutKcal(d.kcal)}</b></span><span>Eiweiß<b>${d.p} g</b></span>
          <span>Kohlenh.<b>${d.c} g</b></span><span>Fett<b>${d.f} g</b></span></div>
        ${Object.keys(d.meals || {}).length ? `<details class="nut-more"><summary>Mahlzeiten</summary>${Object.entries(MEALS).filter(([k]) => d.meals[k])
          .map(([k, [icon, label]]) => `<p class="np-meal"><b>${icon} ${label}</b><br>${d.meals[k].map(i => `${esc(i.name)}${i.g ? ` · ${fmtNum(i.g)} g` : ''} · ${nutKcal(i.kcal)} kcal`).join('<br>')}</p>`).join('')}</details>` : ''}
      </div>`).join('')}
      <button class="btn" data-action="np-pick">📄 Neuen Plan importieren</button>
      <button class="btn danger" data-action="np-end">Plan beenden – wieder die Berechnung der App</button>`;
  }
  return `<div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">📋</span><h2>Ernährungsplan übernehmen</h2></div>
      <p class="hint wiz-q-explain">Du hast einen festen Ernährungsplan, z. B. von deinem Ernährungsberater oder Trainer? Übernimm ihn einmal –
        dann zeigt die App an jedem Tag automatisch die Ziele aus deinem Plan. Enthält er auch die Lebensmittel, kannst du im Tagebuch
        jede Mahlzeit mit einem Tipp „wie geplant“ eintragen.</p>
      <button class="btn primary" data-action="np-pick">📄 Datei wählen (Excel oder CSV)</button>
      <button class="btn" data-action="np-paste-open">📋 Tabelle einfügen</button>
      ${npPasteOpen ? `<textarea class="inp comment" id="np-paste" rows="6" placeholder="In Excel oder Google Sheets die Zellen markieren (mit Überschriften), kopieren und hier einfügen"></textarea>
        <button class="btn primary" data-action="np-paste-go">Übernehmen</button>` : ''}
      <p class="hint nut-small"><b>Google Sheets:</b> Datei → Herunterladen → Microsoft Excel (.xlsx) bzw. am Handy „Teilen und exportieren →
        Kopie senden“ – oder einfach die Zellen kopieren und oben einfügen. Die Datei wird nur auf deinem Handy gelesen, nichts wird hochgeladen.</p>
    </div>
    <div class="card">
      <h2>Vorlagen</h2>
      <p class="hint nut-small">Noch keinen Plan als Tabelle? Lade eine Vorlage herunter, öffne sie in Excel oder Google Sheets, trag deine Werte
        ein und importiere sie hier. Die erste Zeile sind die Überschriften, die Spalten kannst du beim Import auch frei zuordnen.</p>
      <button class="btn" data-action="np-template" data-k="targets">⬇ Vorlage: nur Tagesziele</button>
      <button class="btn" data-action="np-template" data-k="meals">⬇ Vorlage: mit Mahlzeiten und Lebensmitteln</button>
    </div>`;
}
let npPasteOpen = false;

function npMappingHtml() {
  const im = npImport;
  const rows = im.sheets[im.si].rows;
  const head = rows[im.head] || [];
  const cols = Math.max(...rows.map(r => r.length));
  const colName = i => head[i] ? `${String.fromCharCode(65 + i)}: ${head[i]}` : `Spalte ${String.fromCharCode(65 + i)}`;
  const sel = role => `<select class="inp sel" data-field="np-map" data-k="${role}"><option value="">–</option>${Array.from({ length: cols }, (_, i) =>
    `<option value="${i}" ${im.map[role] === i ? 'selected' : ''}>${esc(colName(i))}</option>`).join('')}</select>`;
  const { days, unknown } = npBuild();
  const preview = rows.slice(im.head, im.head + 7);
  return `<div class="card">
      <h2>Spalten zuordnen</h2>
      ${im.sheets.length > 1 ? `<label class="row"><span>Tabellenblatt</span><select class="inp sel" data-field="np-sheet">${im.sheets.map((s, i) =>
        `<option value="${i}" ${im.si === i ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
      <div class="table-wrap"><table class="rir np-prev">${preview.map((r, ri) => `<tr>${Array.from({ length: cols }, (_, i) =>
        `<${ri === 0 ? 'th' : 'td'}>${esc(r[i] || '')}</${ri === 0 ? 'th' : 'td'}>`).join('')}</tr>`).join('')}</table></div>
      <p class="hint nut-small">Die App hat die Spalten anhand der Überschriften erraten – prüf kurz, ob es passt. Nicht vorhandene Spalten bleiben auf „–“.</p>
      ${NP_ROLES.map(([k, l]) => `<label class="row"><span>${l}</span>${sel(k)}</label>`).join('')}
      <label class="row"><span>Kopfzeile ist Zeile</span><input class="inp kg" type="text" inputmode="numeric" data-field="np-head" value="${im.head + 1}"></label>
    </div>
    <div class="card">
      <h2>Welcher Tag gilt wann?</h2>
      <div class="variants np-assign">${Object.entries(NP_ASSIGN).map(([k, l]) => `<button class="vchip ${im.assign === k ? 'on' : ''}" data-action="np-assign" data-k="${k}">${l}</button>`).join('')}</div>
      <p class="hint nut-small">${{ weekday: 'Die Tage heißen wie Wochentage (Montag, Di …) – jeder Wochentag bekommt seine Werte.',
        daytype: 'Es gibt Trainings- und Ruhetage: An Tagen, an denen du trainierst, gelten die Werte des Trainingstags (umstellbar auf der Ernährungsseite).',
        rotation: 'Die Tage wechseln sich der Reihe nach ab, beginnend heute mit dem ersten.', same: 'Ein Tag – gilt jeden Tag.' }[im.assign]}</p>
      <label class="lbl">Name des Plans<input class="inp" type="text" data-field="np-name" value="${esc(im.name)}"></label>
    </div>
    <div class="card">
      <h2>Vorschau: ${days.length} Tag${days.length === 1 ? '' : 'e'}</h2>
      ${days.length ? days.map(d => `<p class="np-sum"><b>${esc(d.label)}</b>${im.assign === 'weekday' && d.weekday == null ? ' <small class="hint">(kein Wochentag erkannt)</small>' : ''}
        ${im.assign === 'daytype' && !d.kind ? ' <small class="hint">(Training/Ruhe nicht erkannt)</small>' : ''}<br>
        ${nutKcal(d.kcal)} kcal · Eiweiß ${d.p} g · KH ${d.c} g · Fett ${d.f} g${Object.keys(d.meals).length ? ` · ${Object.values(d.meals).flat().length} Einträge in ${Object.keys(d.meals).length} Mahlzeiten` : ''}</p>`).join('')
        : '<p class="hint">Noch keine Werte erkannt – ordne mindestens Kalorien oder Eiweiß, Kohlenhydrate und Fett zu.</p>'}
      ${unknown.length ? `<p class="food-miss">Ohne Nährwerte und nicht in der Grundliste: ${unknown.slice(0, 6).map(esc).join(', ')}${unknown.length > 6 ? ' …' : ''} – zählen mit 0 kcal.</p>` : ''}
    </div>
    <button class="btn primary" data-action="np-save" ${days.length ? '' : 'disabled'}>✔ Plan übernehmen</button>
    <button class="btn center" data-action="np-cancel">Abbrechen</button>`;
}

// Vorlage herunterladen (CSV mit Semikolon – öffnet sich direkt in Excel und Google Sheets)
async function npTemplate(kind) {
  const rows = kind === 'targets'
    ? [['Tag', 'kcal', 'Eiweiß (g)', 'Kohlenhydrate (g)', 'Fett (g)'], ['Trainingstag', '2500', '180', '280', '75'], ['Ruhetag', '2200', '180', '210', '75']]
    : [['Tag', 'Mahlzeit', 'Lebensmittel', 'Menge (g)', 'kcal', 'Eiweiß (g)', 'Kohlenhydrate (g)', 'Fett (g)'],
      ['Montag', 'Frühstück', 'Haferflocken', '80', '296', '11', '47', '6'], ['Montag', 'Frühstück', 'Magerquark', '250', '168', '30', '10', '1'],
      ['Montag', 'Mittagessen', 'Hähnchenbrust', '150', '233', '45', '0', '5'], ['Montag', 'Mittagessen', 'Reis, gekocht', '250', '325', '7', '70', '1'],
      ['Montag', 'Abendessen', 'Vollkornbrot', '100', '215', '7', '38', '1'], ['Dienstag', 'Frühstück', 'Skyr natur', '250', '', '', '', '']];
  const csv = '﻿' + rows.map(r => r.join(';')).join('\r\n');
  const name = kind === 'targets' ? 'ernaehrungsplan-vorlage-tagesziele.csv' : 'ernaehrungsplan-vorlage-mahlzeiten.csv';
  const file = new File([csv], name, { type: 'text/csv' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Ernährungsplan-Vorlage' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

views.nutplan = { title: 'Ernährungsplan', tab: 'nutrition', back: 'nutrition', render: renderNutPlan,
  cancel: () => npImport ? { ask: 'Import abbrechen?', run: () => { npImport = null; go('nutplan'); } } : null };

Object.assign(actions, {
  'np-open': () => { npImport = null; npPasteOpen = false; go('nutplan'); },
  'np-pick': () => {
    let input = document.getElementById('np-file');
    if (!input) {
      document.body.insertAdjacentHTML('beforeend', '<input type="file" id="np-file" accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>');
      input = document.getElementById('np-file');
      input.addEventListener('change', async () => {
        const f = input.files[0];
        input.value = '';
        if (!f) return;
        try {
          if (/\.xlsx$/i.test(f.name)) npStart(await npParseXlsx(await f.arrayBuffer()), f.name);
          else if (/\.xls$|\.numbers$|\.ods$/i.test(f.name)) alert('Bitte die Datei als .xlsx (Excel) oder .csv speichern – dieses Format kann die App nicht lesen.');
          else npStart([{ name: f.name, rows: npParseDelimited(await f.text()) }], f.name);
        } catch (e) {
          alert(`Die Datei konnte nicht gelesen werden (${e.message}). Speichere sie als .csv oder kopiere die Zellen und füge sie ein.`);
        }
      });
    }
    input.click();
  },
  'np-paste-open': () => { npPasteOpen = !npPasteOpen; render(); },
  'np-paste-go': () => {
    const t = (document.getElementById('np-paste') || {}).value || '';
    if (!t.trim()) { alert('Bitte zuerst die Tabelle einfügen.'); return; }
    npPasteOpen = false;
    npStart([{ name: 'Eingefügt', rows: npParseDelimited(t) }], 'Ernährungsplan');
  },
  'np-assign': el => { npImport.assign = el.dataset.k; render(); },
  'np-cancel': () => { npImport = null; render(); },
  'np-template': el => npTemplate(el.dataset.k),
  'np-save': () => {
    const { days } = npBuild();
    if (!days.length) return;
    if (nutPlanActive() && !confirm('Den bisherigen Ernährungsplan durch den neuen ersetzen?')) return;
    data.nutPlan = { name: npImport.name.trim() || 'Ernährungsplan', importedAt: todayISO(), start: todayISO(), assign: npImport.assign, days, typeFor: {} };
    npImport = null;
    saveData();
    toast('Ernährungsplan übernommen ✔');
    go('nutrition');
  },
  'np-end': () => {
    if (!confirm('Ernährungsplan beenden?\n\nDas Tagesziel kommt dann wieder aus der Berechnung der App. Dein Tagebuch bleibt, wie es ist.')) return;
    data.nutPlan = null;
    saveData();
    render();
  },
  // heute Trainings- oder Ruhetag (Plan nach Trainings-/Ruhetag)
  'np-daytype': el => {
    data.nutPlan.typeFor = { ...(data.nutPlan.typeFor || {}), [todayISO()]: el.dataset.k };
    saveData(); render();
  },
  // Tagebuch: Mahlzeit wie geplant eintragen
  'food-plan-meal': el => {
    const date = current.params.date || todayISO(), k = el.dataset.meal;
    const d = nutPlanDay(date);
    const items = (d && d.meals && d.meals[k]) || [];
    if (!items.length) return;
    const reopened = typeof foodReopen === 'function' && foodReopen(date);
    for (const i of items) {
      const g = i.g || 100;
      const per = [i.kcal, i.p, i.c, i.f].map(x => round1(x / g * 100));
      data.foodLog.push({ id: uid(), date, meal: k, key: 'plan:' + nameKey(i.name), name: i.name, brand: 'laut Plan', g, per });
    }
    foodSync(date);
    saveData();
    if (reopened) foodReopenToast(); else toast(`${MEALS[k][1]} wie geplant eingetragen ✔`);
    render();
  },
});

Object.assign(fields, {
  'np-map': el => { npImport.map[el.dataset.k] = el.value === '' ? null : Number(el.value); render(); },
  'np-sheet': el => { npImport.si = Number(el.value); npGuess(); render(); },
  'np-head': el => { const n = parseInt(el.value, 10); if (n >= 1 && n <= npImport.sheets[npImport.si].rows.length) { npImport.head = n - 1; render(); } },
  'np-name': el => { npImport.name = el.value; },
});

// Karte im Ernährungs-Reiter: heutiges Ziel aus dem Plan
function nutPlanCard() {
  const pl = data.nutPlan, d = nutPlanDay(), c = nutForDay(nutPlanTarget());
  return `<div class="card nut-target np-card">
      <span class="lbl">📋 ${esc(pl.name)} · ${esc(d.label)}</span>
      <b class="nut-kcal">${nutKcal(c.kcal)} kcal</b>
      <div class="nut-macros">${[['p', 'Eiweiß', c.protein], ['f', 'Fett', c.fat], ['c', 'Kohlenhydrate', c.carbs]].map(([k, l, g]) =>
        `<div class="nut-macro ${k}"><span>${l}</span><b>${g} g</b></div>`).join('')}</div>
      ${pl.assign === 'daytype' ? `<div class="seg two np-type">${[['train', '🏋️ Trainingstag'], ['rest', '😴 Ruhetag']].map(([k, l]) =>
        `<button class="${npDayKind(todayISO()) === k ? 'on' : ''}" data-action="np-daytype" data-k="${k}">${l}</button>`).join('')}</div>` : ''}
      <p class="hint nut-small">Dein importierter Plan ist maßgeblich. ${c.cardio ? `Inklusive ${deNum(c.cardio)} kcal Cardio. ` : ''}
        <button class="link-btn" data-action="np-open">Plan ansehen</button></p>
    </div>`;
}
