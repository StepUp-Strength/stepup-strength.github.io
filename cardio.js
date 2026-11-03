/* ---------- Cardio: Ausdauereinheiten eintragen, Kalorienverbrauch schätzen ----------
   data.cardio = [{ id, date: 'JJJJ-MM-TT', type, level: 'easy'|'mid'|'hard', min, kcal, own }]
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

let cardioForm = null;  // { id?, date, type, level, min (Text), kcal (Text), own }

function cardioFormFresh(c) {
  return c ? { id: c.id, date: c.date, type: c.type, level: c.level, min: String(c.min), kcal: c.own ? String(c.kcal) : '', own: !!c.own }
    : { id: null, date: todayISO(), type: (data.cardio[data.cardio.length - 1] || {}).type || 'run', level: 'mid', min: '30', kcal: '', own: false };
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
    h += `<h2>Deine Einheiten</h2><ul class="list">${list.map(c => {
      const t = CARDIO_TYPES[c.type] || CARDIO_TYPES.other;
      return `<li class="bw-row cardio-row"><span>${t.icon} ${t.label}<small class="hint">${fmtDate(c.date + 'T12:00:00')} · ${c.min} min · ${CARDIO_LEVELS[c.level] ? CARDIO_LEVELS[c.level].label : ''} · ca. ${deNum(c.kcal)} kcal${c.own ? ' (eigener Wert)' : ''}</small></span>
        <button class="icon-btn" data-action="cardio-edit" data-id="${c.id}" aria-label="Bearbeiten">✎</button>
        <button class="icon-btn danger" data-action="cardio-del" data-id="${c.id}" aria-label="Löschen">✕</button></li>`;
    }).join('')}</ul>`;
  } else {
    h += '<p class="hint">Noch keine Cardio-Einheiten eingetragen.</p>';
  }
  return h + `<p class="hint nut-small">Die Kalorien sind Schätzwerte aus Aktivität, Anstrengung, Dauer und Körpergewicht (MET-Werte) – gezählt wird nur,
    was du zusätzlich zum Ruhezustand verbrauchst. Cardio hat keinen Einfluss auf deinen Trainingsplan.</p>`;
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
    const entry = { id: f.id || uid(), date: f.date || todayISO(), type: f.type, level: f.level, min: Math.round(min),
      kcal: ownK != null ? Math.round(ownK) : cardioEstimate(f.type, f.level, min), own: ownK != null };
    const i = data.cardio.findIndex(c => c.id === entry.id);
    if (i >= 0) data.cardio[i] = entry; else data.cardio.push(entry);
    saveData();
    const added = data.nutrition && data.nutrition.cardioAdd && entry.date === todayISO();
    toast(`${CARDIO_TYPES[entry.type].icon} Eingetragen: ${entry.min} min · ca. ${deNum(entry.kcal)} kcal${added ? ' – Tagesziel erhöht' : ''}`);
    cardioForm = cardioFormFresh();
    cardioForm.type = entry.type;
    render();
  },
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
