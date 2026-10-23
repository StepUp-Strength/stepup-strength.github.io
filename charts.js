'use strict';

/* ---------- Diagramme (Übungen & Körpergewicht) ---------- */

const DAY = 86400000;
const RANGES = [['1M', 30], ['3M', 91], ['6M', 182], ['1J', 365], ['Alle', 0]];

// mode: 'ex' = Übung, 'bw' = Körpergewicht; metric: 'weight' = schwerster Satz, 'max10' = geschätztes Max.
// end = rechter Rand des Zeitfensters (null = heute); sel = Zeitpunkt des angetippten Punkts
const chartState = { mode: 'ex', name: '', metric: 'weight', variant: '', range: 91, end: null, sel: null };
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

function showChartFor(name) {
  Object.assign(chartState, { name, variant: '', sel: null, end: null });
  render();
}

// Datenpunkte der gewählten Reihe, zeitlich aufsteigend
function chartPoints() {
  if (chartState.mode === 'bw') {
    return data.bodyweight
      .map(b => ({ t: Date.parse(b.date), v: b.kg, unit: 'kg' }))
      .sort((a, b) => a.t - b.t);
  }
  const k = nameKey(chartState.name);
  if (!k) return [];
  const pts = [];
  for (const s of [...data.sessions].sort((a, b) => a.date.localeCompare(b.date))) {
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
      <text class="c-text" x="${L - 8}" y="${Y(v) + 4}" text-anchor="end">${fmtNum(v)}</text>`;
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
  value.textContent = `${fmtNum(p.v)} ${unit}` + (chartState.mode === 'ex' && chartState.metric === 'max10' ? ' (Max. bei 10)' : '');
  tip.appendChild(value);
  const date = document.createElement('div');
  date.className = 'muted';
  date.textContent = fmtDate(new Date(p.t).toISOString());
  tip.appendChild(date);
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

function chartStats(vis, unit) {
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

function renderCharts() {
  const s = chartState;
  let h = `<div class="seg">
    <button class="${s.mode === 'ex' ? 'on' : ''}" data-action="chart-mode" data-mode="ex">Übungen</button>
    <button class="${s.mode === 'bw' ? 'on' : ''}" data-action="chart-mode" data-mode="bw">Körpergewicht</button>
  </div>`;

  if (s.mode === 'ex') {
    const names = historyNames();
    if (!names.length) {
      return h + '<p class="hint">Sobald du Trainings gespeichert hast, siehst du hier deine Entwicklung pro Übung.</p>';
    }
    h += `<input class="inp" type="text" data-field="chart-name" autocomplete="off" autocorrect="off"
        spellcheck="false" placeholder="Übung eintippen …" value="${esc(s.name)}">
      <div class="suggest" hidden></div>`;
    if (!s.name) {
      return h + '<p class="lbl chips-title">Zuletzt trainiert</p>' + names.slice(0, 8).map(n =>
        `<button class="btn" data-action="chart-pick" data-name="${esc(n)}">${esc(n)}</button>`).join('');
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
  } else {
    h += `<div class="card">
      <label class="row"><span>Körpergewicht</span>
        <input class="inp kg" id="bw-kg" type="text" inputmode="decimal" autocomplete="off" placeholder="kg"></label>
      <label class="row"><span>Datum</span>
        <input class="inp date" id="bw-date" type="date" value="${todayISO()}" max="${todayISO()}"></label>
      <div class="row"><button class="btn primary" data-action="bw-save">Speichern</button></div>
    </div>`;
  }

  h += rangeRow() + '<div id="chart-area" class="chart-area"></div><div id="chart-extra"></div>';
  if (s.mode === 'bw') h += bwList();
  else h += '<p class="hint">Punkt antippen für Details. Zum Verschieben des Zeitraums seitlich wischen. Hohle Punkte = Deload-Woche.</p>';
  return h;
}

views.charts = { title: 'Diagramme', tab: 'charts', render: renderCharts, after: drawChart };

Object.assign(actions, {
  'chart-mode': el => { Object.assign(chartState, { mode: el.dataset.mode, sel: null, end: null }); render(); },
  'chart-pick': el => showChartFor(el.dataset.name),
  'chart-variant': el => { Object.assign(chartState, { variant: el.dataset.v, sel: null }); render(); },
  'chart-metric': el => { Object.assign(chartState, { metric: el.dataset.metric, sel: null }); render(); },
  'chart-range': el => { Object.assign(chartState, { range: Number(el.dataset.days), end: null }); render(); },
  'chart-shift': el => {
    if (!chartGeo) return;
    chartState.end = chartGeo.end + Number(el.dataset.dir) * (chartGeo.x1 - chartGeo.x0) / 2;
    drawChart();
  },
  'bw-save': () => {
    const kg = parseNum(document.getElementById('bw-kg').value);
    if (kg == null || kg < 20 || kg > 400) { alert('Bitte ein gültiges Körpergewicht in kg eintragen.'); return; }
    const day = document.getElementById('bw-date').value || todayISO();
    const existing = data.bodyweight.find(b => b.date.slice(0, 10) === day);
    if (existing) existing.kg = kg;
    else data.bodyweight.push({ id: uid(), date: `${day}T12:00:00`, kg });
    saveData();
    toast('Körpergewicht gespeichert ✔');
    render();
  },
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
