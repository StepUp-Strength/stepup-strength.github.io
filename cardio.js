/* StepUp Strength · © 2026 Alex Hundt · Alle Rechte vorbehalten – siehe LICENSE */
/* ---------- Cardio: Ausdauereinheiten eintragen, Kalorienverbrauch schätzen ----------
   data.cardio = [{ id, date: 'JJJJ-MM-TT', type, level: 'easy'|'mid'|'hard', min, kcal, own, km? }]  (km: Strecke, freiwillig)
   kcal = Mehrverbrauch gegenüber Ruhe: (MET − 1) × kg × Stunden (MET-Werte nach dem Compendium of Physical Activities).
   own = true: Kalorien selbst eingetragen (z. B. von der Uhr). Optional fließt der Verbrauch ins Tagesziel ein
   (data.nutrition.cardioAdd, siehe nutForDay in nutrition.js). */

const CARDIO_TYPES = {
  walk: { label: 'Gehen / Walking', icon: '🚶', met: [3.0, 3.8, 5.0] },
  run: { label: 'Joggen / Laufen', icon: '🏃', met: [7.0, 9.0, 11.0] },
  bike: { label: 'Radfahren', icon: '🚴', met: [4.0, 6.8, 10.0] },
  ergo: { label: 'Ergometer / Indoor-Bike', icon: '🚲', met: [4.0, 6.8, 8.8] },
  stepper: { label: 'Stepper / Treppensteiger', icon: '🪜', met: [5.0, 7.0, 9.0] },
  row: { label: 'Rudergerät', icon: '🚣', met: [4.8, 7.0, 8.5] },
  cross: { label: 'Crosstrainer', icon: '⛷️', met: [4.5, 5.5, 7.5] },
  swim: { label: 'Schwimmen', icon: '🏊', met: [6.0, 8.0, 10.0] },
  hike: { label: 'Wandern', icon: '🥾', met: [4.5, 6.0, 7.5] },
  rope: { label: 'Seilspringen', icon: '🪢', met: [8.8, 11.0, 12.3] },
  hiit: { label: 'HIIT / Zirkeltraining', icon: '⚡', met: [6.0, 8.0, 10.0] },
  other: { label: 'Sonstiges', icon: '❤️', met: [4.0, 6.0, 8.0] },
};
const CARDIO_LEVELS = {
  easy: { label: 'Locker', text: 'du kannst dich dabei gut unterhalten' },
  mid: { label: 'Mittel', text: 'Sprechen geht noch in kurzen Sätzen' },
  hard: { label: 'Intensiv', text: 'kaum Luft zum Reden' },
};
const CARDIO_LEVEL_KEYS = Object.keys(CARDIO_LEVELS);

// Körpergewicht für die Schätzung (sonst 75 kg)
const cardioKg = () => (typeof nutWeight === 'function' && nutWeight()) || currentBodyweight() || 75;
function cardioEstimate(type, level, min) {
  const t = CARDIO_TYPES[type] || CARDIO_TYPES.other;
  const met = t.met[Math.max(0, CARDIO_LEVEL_KEYS.indexOf(level))];
  return Math.round((met - 1) * cardioKg() * (min / 60) / 5) * 5;
}
const cardioOn = date => data.cardio.filter(c => c.date === date);
const cardioKcalOn = date => cardioOn(date).reduce((a, c) => a + (c.kcal || 0), 0);

// Diese Woche (ab Montag): Anzahl, Minuten, kcal
function cardioWeek() {
  const d = new Date(todayISO() + 'T12:00:00');
  const monday = addDaysISO(todayISO(), -((d.getDay() + 6) % 7));
  const list = data.cardio.filter(c => c.date >= monday && c.date <= todayISO());
  return { n: list.length, min: list.reduce((a, c) => a + c.min, 0), kcal: list.reduce((a, c) => a + (c.kcal || 0), 0) };
}

// Knopf + Wochenübersicht (Trainings-Startseite und Verlauf)
function cardioStartHtml() {
  const w = cardioWeek();
  return `<button class="btn nav cardio-btn" data-action="cardio-open">🏃 Cardio eintragen
      <small>${w.n ? `Diese Woche: ${w.n}× · ${w.min} min · ca. ${deNum(w.kcal)} kcal` : 'Joggen, Rad, Stepper, Rudergerät …'}</small></button>`;
}

let cardioForm = null;  // { id?, date, type, level, min (Text), km (Text), kcal (Text), own }

function cardioFormFresh(c) {
  return c ? { id: c.id, date: c.date, type: c.type, level: c.level, min: String(c.min), km: c.km != null ? fmtNum(c.km) : '',
      kcal: c.own ? String(c.kcal) : '', own: !!c.own }
    : { id: null, date: todayISO(), type: (data.cardio[data.cardio.length - 1] || {}).type || 'run', level: 'mid', min: '30', km: '', kcal: '', own: false };
}

function cardioEstimateText() {
  const f = cardioForm, min = parseNum(f.min);
  if (!min || min <= 0) return 'Dauer eintragen, dann schätzt die App den Verbrauch.';
  const est = cardioEstimate(f.type, f.level, min);
  return `Geschätzt: <b>ca. ${deNum(est)} kcal</b> zusätzlich zum Grundumsatz (bei ${fmtNum(round1(cardioKg()))} kg Körpergewicht).`;
}

function renderCardio() {
  if (!cardioForm) cardioForm = cardioFormFresh();
  const f = cardioForm;
  const n = data.nutrition;
  const typeBtn = ([k, t]) => `<button class="cardio-type ${f.type === k ? 'on' : ''}" data-action="cardio-type" data-k="${k}"><span>${t.icon}</span>${t.label}</button>`;
  let h = `<div class="card cardio-form">
      <p class="lbl">Aktivität</p>
      <div class="cardio-types">${Object.entries(CARDIO_TYPES).map(typeBtn).join('')}</div>
      <p class="lbl">Wie anstrengend?</p>
      <div class="seg three">${Object.entries(CARDIO_LEVELS).map(([k, l]) =>
        `<button class="${f.level === k ? 'on' : ''}" data-action="cardio-level" data-k="${k}">${l.label}</button>`).join('')}</div>
      <p class="hint nut-small">${CARDIO_LEVELS[f.level].label}: ${CARDIO_LEVELS[f.level].text}.</p>
      <label class="row"><span>Dauer (Minuten)</span>
        <input class="inp kg" type="text" inputmode="numeric" autocomplete="off" data-field="cardio-in" data-k="min" value="${esc(f.min)}"></label>
      <label class="row"><span>Strecke (km)<br><small class="hint">freiwillig</small></span>
        <input class="inp kg" type="text" inputmode="decimal" autocomplete="off" data-field="cardio-in" data-k="km" value="${esc(f.km)}" placeholder="–"></label>
      <label class="row"><span>Datum</span><input class="inp date" type="date" data-field="cardio-in" data-k="date" value="${f.date}" max="${todayISO()}"></label>
      <p class="hint nut-small" id="cardio-est">${cardioEstimateText()}</p>
      <label class="row"><span>Eigener Wert (kcal)<br><small class="hint">freiwillig, z. B. von der Uhr</small></span>
        <input class="inp kg" type="text" inputmode="numeric" autocomplete="off" data-field="cardio-in" data-k="kcal" value="${esc(f.kcal)}" placeholder="–"></label>
      <div class="row">${f.id ? '<button class="btn" data-action="cardio-cancel">Abbrechen</button>' : ''}
        <button class="btn primary" data-action="cardio-save">${f.id ? '✔ Speichern' : '＋ Eintragen'}</button></div>
    </div>`;
  // Tagesziel: Cardio einrechnen (nur mit eingerichteter Ernährung)
  if (n && nutReady(n)) {
    const on = !!n.cardioAdd;
    h += `<div class="card">
        <h2>Ins Tagesziel einrechnen?</h2>
        <div class="seg two"><button class="${on ? 'on' : ''}" data-action="cardio-add" data-v="1">Ja</button>
          <button class="${on ? '' : 'on'}" data-action="cardio-add" data-v="0">Nein</button></div>
        <p class="hint nut-small"><b>Ja:</b> An Tagen mit Cardio erhöht sich dein Tagesziel um den Verbrauch – vor allem als Kohlenhydrate,
          die du zum Auftanken brauchst. <b>Nein</b> ist sinnvoll, wenn du dein Cardio schon bei der Aktivität in deinen Angaben
          berücksichtigt hast (sonst zählt es doppelt) oder wenn du in der Diät bewusst etwas mehr Defizit möchtest.
          Fitness-Uhren schätzen oft eher zu hoch – lieber vorsichtig eintragen.</p>
      </div>`;
  }
  // Einträge
  const list = [...data.cardio].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 40);
  if (list.length) {
    h += `<h2>Deine Einheiten</h2><ul class="list">${list.map(c => cardioRowHtml(c, true)).join('')}</ul>`;
  } else {
    h += '<p class="hint">Noch keine Cardio-Einheiten eingetragen.</p>';
  }
  return h + `<p class="hint nut-small">Die Kalorien sind Schätzwerte aus Aktivität, Anstrengung, Dauer und Körpergewicht (MET-Werte) – gezählt wird nur,
    was du zusätzlich zum Ruhezustand verbrauchst. Cardio hat keinen Einfluss auf deinen Trainingsplan.</p>`;
}

// Eine Einheit als Zeile: im Cardio-Bildschirm mit Bearbeiten/Löschen, sonst als Knopf zum Bearbeiten (z. B. Kalendertag)
function cardioRowHtml(c, edit = false) {
  const t = CARDIO_TYPES[c.type] || CARDIO_TYPES.other;
  const info = `${fmtDate(c.date + 'T12:00:00')} · ${c.min} min${c.km != null ? ` · ${fmtNum(c.km)} km` : ''} · `
    + `${CARDIO_LEVELS[c.level] ? CARDIO_LEVELS[c.level].label + ' · ' : ''}ca. ${deNum(c.kcal)} kcal${c.own ? ' (eigener Wert)' : ''}`;
  if (!edit) return `<button class="btn nav" data-action="cardio-open-edit" data-id="${c.id}">${t.icon} ${t.label}<small>${info}</small></button>`;
  return `<li class="bw-row cardio-row"><span>${t.icon} ${t.label}<small class="hint">${info}</small></span>
      <button class="icon-btn" data-action="cardio-edit" data-id="${c.id}" aria-label="Bearbeiten">✎</button>
      <button class="icon-btn danger" data-action="cardio-del" data-id="${c.id}" aria-label="Löschen">✕</button></li>`;
}

/* ---------- Cardio-Statistik (Reiter Diagramme → Cardio) ---------- */

const cardioStat = { range: 91, metric: 'min' };
const CARDIO_RANGES = [['4 Wochen', 28], ['3 Monate', 91], ['Jahr', 365], ['Alles', 0]];
const CARDIO_METRICS = { min: 'Zeit', km: 'Strecke', kcal: 'kcal' };
const cardioSum = (list, k) => list.reduce((a, c) => a + (c[k] || 0), 0);
const cardioIcon = c => (CARDIO_TYPES[c.type] || CARDIO_TYPES.other).icon;

// Balken der letzten 12 Wochen (Montag bis Sonntag) für die gewählte Größe
function cardioBars() {
  const k = cardioStat.metric, today = todayISO();
  const monday = addDaysISO(today, -((new Date(today + 'T12:00:00').getDay() + 6) % 7));
  const weeks = Array.from({ length: 12 }, (_, i) => {
    const from = addDaysISO(monday, -7 * (11 - i)), to = addDaysISO(from, 6);
    return { from, v: cardioSum(data.cardio.filter(c => c.date >= from && c.date <= to), k) };
  });
  if (k === 'km' && !data.cardio.some(c => c.km != null)) {
    return '<p class="hint">Noch keine Strecken eingetragen – beim Eintragen gibt es dafür das Feld „Strecke (km)“.</p>';
  }
  const max = Math.max(...weeks.map(w => w.v));
  if (!max) return '<p class="hint">In den letzten 12 Wochen keine Einheiten.</p>';
  const ticks = niceTicks(0, max).filter(t => t >= 0);
  const top = ticks[ticks.length - 1];
  const W = 340, H = 180, L = 36, R = 6, T = 14, B = 24, pw = W - L - R, ph = H - T - B;
  const Y = v => T + (1 - v / top) * ph, bw = pw / 12;
  const fmtV = v => k === 'km' ? fmtNum(round1(v)) : deNum(Math.round(v));
  let svg = `<svg class="chart-svg cardio-bars" viewBox="0 0 ${W} ${H}" role="img" aria-label="Cardio pro Woche: ${CARDIO_METRICS[k]}">`;
  for (const t of ticks) {
    svg += `<line class="c-grid" x1="${L}" x2="${W - R}" y1="${Y(t)}" y2="${Y(t)}"/>
      <text class="c-text" x="${L - 6}" y="${Y(t) + 4}" text-anchor="end">${fmtV(t)}</text>`;
  }
  weeks.forEach((w, i) => {
    const x = L + i * bw + bw * .18, h = Y(0) - Y(w.v);
    if (w.v) {
      svg += `<rect class="c-bar ${i === 11 ? 'now' : ''}" x="${x}" y="${Y(w.v)}" width="${bw * .64}" height="${Math.max(1.5, h)}" rx="3"/>
        <text class="c-val" x="${x + bw * .32}" y="${Y(w.v) - 3}" text-anchor="middle">${fmtV(w.v)}</text>`;
    }
    if (i % 3 === 2 || i === 11) {
      svg += `<text class="c-text" x="${x + bw * .32}" y="${H - 7}" text-anchor="middle">${i === 11 ? 'diese' : w.from.slice(8, 10) + '.' + w.from.slice(5, 7) + '.'}</text>`;
    }
  });
  return svg + `</svg><p class="hint cardio-unit">${{ min: 'Minuten', km: 'Kilometer', kcal: 'kcal (geschätzter Mehrverbrauch)' }[k]} pro Woche, Beschriftung = Montag der Woche</p>`;
}

function renderCardioStats() {
  const all = data.cardio, today = todayISO();
  const add = '<button class="btn primary cardio-add-btn" data-action="cardio-open">🏃 Cardio eintragen</button>';
  if (!all.length) {
    return `<p class="hint">Noch keine Cardio-Einheiten eingetragen. Sobald du welche einträgst, siehst du hier Zeit, Strecke,
      verbrannte Kalorien, einen Kalender und die Aufteilung nach Aktivität.</p>${add}`;
  }
  const from = cardioStat.range ? addDaysISO(today, -(cardioStat.range - 1)) : '';
  const list = all.filter(c => c.date >= from && c.date <= today);
  const km = cardioSum(list, 'km'), withKm = list.some(c => c.km != null);
  let h = `<div class="seg cardio-range">${CARDIO_RANGES.map(([l, d]) =>
    `<button class="${cardioStat.range === d ? 'on' : ''}" data-action="cardio-range" data-d="${d}">${l}</button>`).join('')}</div>
    <div class="stats cardio-stats">
      <div class="stat"><span>Einheiten</span><b>${list.length}</b></div>
      <div class="stat"><span>Zeit</span><b>${fmtDur(cardioSum(list, 'min'))}</b></div>
      <div class="stat"><span>Strecke</span><b>${withKm ? fmtNum(round1(km)) + ' km' : '–'}</b></div>
      <div class="stat"><span>Verbrannt</span><b>${deNum(cardioSum(list, 'kcal'))} kcal</b></div>
    </div>`;
  // pro Woche
  h += `<h2>Pro Woche</h2><div class="seg three">${Object.entries(CARDIO_METRICS).map(([k, l]) =>
    `<button class="${cardioStat.metric === k ? 'on' : ''}" data-action="cardio-metric" data-k="${k}">${l}</button>`).join('')}</div>
    <div class="card cardio-chart">${cardioBars()}</div>`;
  // Kalender
  const st = calGet('cardio');
  h += '<h2>Kalender</h2>' + calendarHtml('cardio', iso => {
    const cs = all.filter(c => c.date === iso);
    return cs.length ? { cls: 'cd', sub: cardioIcon(cs[0]) + (cs.length > 1 ? '+' : '') } : null;
  });
  if (st.sel) {
    const cs = all.filter(c => c.date === st.sel);
    h += `<div class="card cal-day"><p class="cal-day-head"><b>${fmtDate(st.sel + 'T12:00:00', true)}</b></p>
      ${cs.length ? cs.map(c => cardioRowHtml(c)).join('') : '<p class="hint">An diesem Tag kein Cardio.</p>'}</div>`;
  }
  // nach Aktivität (gewählter Zeitraum)
  const byType = {};
  for (const c of list) (byType[c.type] = byType[c.type] || []).push(c);
  const types = Object.entries(byType).sort((a, b) => cardioSum(b[1], 'min') - cardioSum(a[1], 'min'));
  if (types.length) {
    h += `<h2>Nach Aktivität</h2><ul class="list">${types.map(([k, cs]) => {
      const t = CARDIO_TYPES[k] || CARDIO_TYPES.other, tkm = cardioSum(cs, 'km');
      return `<li class="bw-row cardio-row"><span>${t.icon} ${t.label}<small class="hint">${cs.length}× · ${fmtDur(cardioSum(cs, 'min'))}${
        cs.some(c => c.km != null) ? ` · ${fmtNum(round1(tkm))} km` : ''} · ca. ${deNum(cardioSum(cs, 'kcal'))} kcal</small></span></li>`;
    }).join('')}</ul>`;
  }
  return h + add;
}

views.cardio = { title: 'Cardio', tab: 'start', back: 'start', render: renderCardio };

Object.assign(actions, {
  'cardio-open': () => { cardioForm = null; go('cardio'); },
  'cardio-type': el => { cardioForm.type = el.dataset.k; render(); },
  'cardio-level': el => { cardioForm.level = el.dataset.k; render(); },
  'cardio-cancel': () => { cardioForm = null; render(); },
  'cardio-save': () => {
    const f = cardioForm;
    const min = parseNum(f.min);
    if (!min || min <= 0 || min > 600) { alert('Bitte eine Dauer zwischen 1 und 600 Minuten eintragen.'); return; }
    const ownK = String(f.kcal).trim() === '' ? null : parseNum(f.kcal);
    if (ownK != null && (ownK < 0 || ownK > 5000)) { alert('Bitte einen Kalorienwert zwischen 0 und 5.000 eintragen – oder das Feld leer lassen.'); return; }
    const km = String(f.km || '').trim() === '' ? null : parseNum(f.km);
    if (km != null && (!(km > 0) || km > 500)) { alert('Bitte eine Strecke zwischen 0,1 und 500 km eintragen – oder das Feld leer lassen.'); return; }
    const entry = { id: f.id || uid(), date: f.date || todayISO(), type: f.type, level: f.level, min: Math.round(min),
      kcal: ownK != null ? Math.round(ownK) : cardioEstimate(f.type, f.level, min), own: ownK != null };
    if (km != null) entry.km = round1(km);
    const i = data.cardio.findIndex(c => c.id === entry.id);
    if (i >= 0) data.cardio[i] = entry; else data.cardio.push(entry);
    saveData();
    const added = data.nutrition && data.nutrition.cardioAdd && entry.date === todayISO();
    toast(`${CARDIO_TYPES[entry.type].icon} Eingetragen: ${entry.min} min${entry.km ? ` · ${fmtNum(entry.km)} km` : ''} · ca. ${deNum(entry.kcal)} kcal${added ? ' – Tagesziel erhöht' : ''}`);
    cardioForm = cardioFormFresh();
    cardioForm.type = entry.type;
    render();
  },
  'cardio-open-edit': el => { cardioForm = cardioFormFresh(data.cardio.find(c => c.id === el.dataset.id)); go('cardio'); },
  'cardio-range': el => { cardioStat.range = Number(el.dataset.d); render(); },
  'cardio-metric': el => { cardioStat.metric = el.dataset.k; render(); },
  'cardio-edit': el => { cardioForm = cardioFormFresh(data.cardio.find(c => c.id === el.dataset.id)); render(); window.scrollTo(0, 0); },
  'cardio-del': el => {
    const c = data.cardio.find(x => x.id === el.dataset.id);
    if (!c || !confirm(`${(CARDIO_TYPES[c.type] || CARDIO_TYPES.other).label} vom ${fmtDate(c.date + 'T12:00:00')} löschen?`)) return;
    data.cardio = data.cardio.filter(x => x !== c);
    saveData(); render();
  },
  'cardio-add': el => {
    data.nutrition.cardioAdd = el.dataset.v === '1';
    saveData();
    toast(data.nutrition.cardioAdd ? 'Cardio zählt jetzt zum Tagesziel' : 'Cardio zählt nicht zum Tagesziel');
    render();
  },
});

fields['cardio-in'] = el => {
  cardioForm[el.dataset.k] = el.value;
  const est = document.getElementById('cardio-est');
  if (est) est.innerHTML = cardioEstimateText();
};
