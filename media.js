/* StepUp Strength · © 2026 Alex Hundt · Alle Rechte vorbehalten – siehe LICENSE */
'use strict';

/* ---------- Fortschrittsfotos und Technik-Videos (v213, User-Wunsch 2026-11-11) ----------
   Bilder und Videos liegen in einer eigenen IndexedDB „trainingsapp-medien“ – nicht in data und nicht in der normalen
   Sicherungsdatei (sonst würde sie riesig). In data steht nur data.photoCfg = { on, blur, last }.
   Fotos: je Tag bis zu drei Ansichten (vorne, seitlich, hinten), verkleinert auf PH_MAX px (+ Vorschaubild), eigene Sicherung
   als ZIP. Hinweise (Zyklus-Rückblick) nur, wenn schon einmal Fotos gemacht wurden („eingerichtet“, photoCfg.on).
   Videos: je Übung die letzten VID_KEEP, Wiedergabe mit Zeitlupe, Einzelbild und Hilfslinien, Vergleich zweier Videos.
   Damit Videos nicht verloren gehen: am besten mit der Kamera-App filmen und hier auswählen, sonst „In Fotos speichern“. */

const POSES = { front: 'Vorne', side: 'Seitlich', back: 'Hinten' };
const PH_MAX = 1280, PH_THUMB = 320;  // längste Seite in px
const VID_KEEP = 2;                    // so viele Videos behält die App je Übung

let mediaDb = null;
function mediaOpen() {
  if (mediaDb) return Promise.resolve(mediaDb);
  return new Promise((res, rej) => {
    const r = indexedDB.open('trainingsapp-medien', 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('photos', { keyPath: 'id' });
      db.createObjectStore('videos', { keyPath: 'id' }).createIndex('ex', 'ex');
    };
    r.onsuccess = () => { mediaDb = r.result; res(mediaDb); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Speicher blockiert'));
  });
}
const mReq = (store, mode, fn) => mediaOpen().then(db => new Promise((res, rej) => {
  const tx = db.transaction(store, mode), q = fn(tx.objectStore(store));
  tx.oncomplete = () => res(q && q.result);
  tx.onerror = tx.onabort = () => rej(tx.error || new Error('Speichern fehlgeschlagen'));
}));
const mAll = store => mReq(store, 'readonly', s => s.getAll());
const mByEx = key => mReq('videos', 'readonly', s => s.index('ex').getAll(key));
const mPut = (store, rec) => mReq(store, 'readwrite', s => s.put(rec));
const mDel = (store, id) => mReq(store, 'readwrite', s => s.delete(id));

// „Alles zurücksetzen“ (app.js reset-all)
function mediaWipe() {
  if (mediaDb) { mediaDb.close(); mediaDb = null; }
  phCache = null; vidCache = null;
  try { indexedDB.deleteDatabase('trainingsapp-medien'); } catch (e) { /* nichts zu löschen */ }
}

// Objekt-URLs der gerade gezeigten Bilder/Videos (werden beim nächsten Zeichnen freigegeben)
let mediaUrls = [];
const mUrl = b => { const u = URL.createObjectURL(b); mediaUrls.push(u); return u; };
function mediaUrlsFree() { mediaUrls.forEach(u => URL.revokeObjectURL(u)); mediaUrls = []; }

const mediaFail = e => { console.error(e); alert('Das hat leider nicht geklappt: ' + (e && e.message ? e.message : e)); };

// Datei auswählen bzw. aufnehmen (capture = Kamera direkt). Das Eingabefeld hängt kurz im Dokument (iPhone).
function mediaPick(accept, capture, cb) {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = accept; inp.hidden = true;
  if (capture) inp.setAttribute('capture', 'environment');
  inp.addEventListener('change', () => {
    const f = inp.files && inp.files[0];
    inp.remove();
    if (f) Promise.resolve(cb(f)).catch(mediaFail);
  });
  document.body.appendChild(inp);
  inp.click();
}

// Datei in Fotos/Dateien bringen: Teilen-Menü (iPhone: „Bild/Video sichern“), sonst herunterladen (Android: Downloads).
// Muss direkt im Tipp aufgerufen werden – deshalb liegen die Dateien vorher schon bereit.
async function mediaSave(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return 'shared'; }
    catch (e) { if (e && e.name === 'AbortError') return 'abort'; }
  }
  const u = URL.createObjectURL(file), a = document.createElement('a');
  a.href = u; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 60000);
  return 'download';
}
const fileSafe = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
const dayText = d => fmtDate(d + 'T12:00:00');
const mbText = n => `${fmtNum(Math.max(0.1, Math.round(n / 1e5) / 10))} MB`;

/* ---------- Fortschrittsfotos ---------- */

let phCache = null, phLoading = false;  // alle Fotos, neueste zuerst; null = noch nicht geladen
let phForm = { date: null };
let phCmp = { a: null, b: null, pose: 'front' };
let phZip = null;                       // fertige Foto-Sicherung (ZIP) zum Speichern
const photoCfg = () => data.photoCfg || {};

function phLoad() {
  if (phLoading) return;
  phLoading = true;
  mAll('photos').then(list => {
    phCache = list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  }).catch(e => { phCache = []; mediaFail(e); }).finally(() => {
    phLoading = false;
    if (current.view === 'photos' || current.view === 'photo') render();
  });
}

// Bild verkleinern (Ausrichtung übernimmt der Browser beim Zeichnen), JPEG
function imgLoad(blob) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { URL.revokeObjectURL(u); res(img); };
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Das Bild lässt sich nicht öffnen (Format?)')); };
    img.src = u;
  });
}
function imgScale(img, max, q) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob(b => b ? res({ blob: b, w: c.width, h: c.height }) : rej(new Error('Bild konnte nicht verkleinert werden')), 'image/jpeg', q));
}
async function photoMake(file) {
  const img = await imgLoad(file);
  const big = await imgScale(img, PH_MAX, 0.82), th = await imgScale(img, PH_THUMB, 0.72);
  return { blob: big.blob, w: big.w, h: big.h, thumb: th.blob };
}

function photoChanged() {
  const cfg = { ...photoCfg(), on: true };
  cfg.last = phCache && phCache.length ? phCache[0].date : cfg.last;
  data.photoCfg = cfg;
  saveData();
}

// Körpergewicht um das Datum (± 7 Tage) und Ernährungsphase von damals
function bwNear(day) {
  let best = null, bd = 7.5;
  const t = Date.parse(day + 'T12:00:00');
  for (const b of data.bodyweight) {
    const d = Math.abs(Date.parse(b.date.slice(0, 10) + 'T12:00:00') - t) / 864e5;
    if (d < bd) { bd = d; best = b; }
  }
  return best ? best.kg : null;
}
function phaseAt(day) {
  const n = data.nutrition;
  if (!n || typeof NUT_PHASES === 'undefined') return null;
  const starts = [...(n.history || []).map(x => ({ t: x.from, p: x.phase })), { t: n.since, p: n.phase }]
    .filter(x => x.t && x.t.slice(0, 10) <= day).sort((a, b) => a.t.localeCompare(b.t));
  const s = starts[starts.length - 1];
  return s && NUT_PHASES[s.p] ? NUT_PHASES[s.p].label : null;
}
const phInfo = day => [bwNear(day) != null ? `${fmtNum(bwNear(day))} kg` : null, phaseAt(day)].filter(Boolean).join(' · ');

function phThumb(p, label) {
  return `<button class="ph-thumb${photoCfg().blur ? ' blur' : ''}" data-action="ph-open" data-id="${p.id}" aria-label="${label || POSES[p.pose]} ansehen">
    <img src="${mUrl(p.thumb)}" alt="">${label ? `<span>${label}</span>` : ''}</button>`;
}

function renderPhotos() {
  mediaUrlsFree();
  if (!phCache) { phLoad(); return '<p class="hint">Fotos werden geladen …</p>'; }
  if (!phForm.date) phForm.date = todayISO();
  const day = phForm.date, cfg = photoCfg();
  const dates = [...new Set(phCache.map(p => p.date))].sort().reverse();
  let h = '';
  if (!phCache.length) {
    h += `<div class="card ph-intro"><h2>📷 Sieh deine Veränderung</h2>
      <p>Die Waage zeigt nur eine Zahl. Fotos zeigen, was sich wirklich tut – mehr Muskeln, weniger Bauch –, auch wenn das Gewicht gleich bleibt.
        Am besten alle 4 bis 8 Wochen, z. B. am Ende jedes Zyklus.</p>
      <p class="hint">Die Fotos bleiben nur auf deinem Handy. Sie kommen nicht in die normale Sicherung – dafür gibt es unten einen eigenen Knopf.</p></div>`;
  }
  h += `<div class="card ph-add"><h2>Fotos ${day === todayISO() ? 'von heute' : `vom ${dayText(day)}`}</h2>
    <div class="ph-slots">${Object.entries(POSES).map(([k, l]) => {
      const p = phCache.find(x => x.date === day && x.pose === k);
      return p ? phThumb(p, l) : `<button class="ph-slot" data-action="ph-pick" data-pose="${k}"><b>＋</b><span>${l}</span></button>`;
    }).join('')}</div>
    <label class="row ph-date"><span>Datum<small>für ältere Fotos aus deiner Galerie</small></span>
      <input class="inp date" type="date" data-field="ph-date" value="${day}" max="${todayISO()}"></label>
    <p class="hint explain">Jede Ansicht ist freiwillig. Tippe auf ＋ – dann kannst du ein Foto aufnehmen oder aus deiner Galerie wählen.</p>
  </div>`;
  if (dates.length >= 2) {
    const a = dates.includes(phCmp.a) ? phCmp.a : dates[dates.length - 1];
    const b = dates.includes(phCmp.b) ? phCmp.b : dates[0];
    const poses = Object.keys(POSES).filter(k => phCache.some(p => (p.date === a || p.date === b) && p.pose === k));
    const pose = poses.includes(phCmp.pose) ? phCmp.pose : poses[0];
    const sel = (f, v) => `<select class="inp sel" data-field="${f}">${dates.map(d => `<option value="${d}" ${d === v ? 'selected' : ''}>${dayText(d)}</option>`).join('')}</select>`;
    const side = d => {
      const p = phCache.find(x => x.date === d && x.pose === pose);
      return `<div class="ph-cmp-col">${p ? `<button class="ph-cmp-img" data-action="ph-open" data-id="${p.id}"><img src="${mUrl(p.blob)}" alt="${POSES[pose]} am ${dayText(d)}"></button>`
        : '<div class="ph-none">kein Foto</div>'}<small>${phInfo(d) || '&nbsp;'}</small></div>`;
    };
    const ka = bwNear(a), kb = bwNear(b);
    const weeks = Math.round((Date.parse(b) - Date.parse(a)) / (7 * 864e5));
    h += `<div class="card ph-cmp"><h2>Vergleichen</h2>
      <div class="ph-cmp-sel">${sel('ph-cmp-a', a)}<span>→</span>${sel('ph-cmp-b', b)}</div>
      ${poses.length > 1 ? `<div class="seg ${poses.length === 3 ? 'three' : 'two'}">${poses.map(k =>
        `<button class="${k === pose ? 'on' : ''}" data-action="ph-pose" data-k="${k}">${POSES[k]}</button>`).join('')}</div>` : ''}
      <div class="ph-cmp-row">${side(a)}${side(b)}</div>
      ${ka != null && kb != null && a !== b ? `<p class="hint">In ${weeks} Woche${weeks === 1 ? '' : 'n'}: ${kb - ka > 0 ? '+' : ''}${fmtNum(Math.round((kb - ka) * 10) / 10)} kg Körpergewicht.</p>` : ''}
    </div>`;
  }
  if (dates.length) {
    h += `<h2>Alle Fotos</h2><div class="ph-days">${dates.map(d => `<div class="card ph-day"><p><b>${dayText(d)}</b>${phInfo(d) ? ` <small>${phInfo(d)}</small>` : ''}</p>
      <div class="ph-row">${Object.keys(POSES).map(k => phCache.find(p => p.date === d && p.pose === k)).filter(Boolean).map(p => phThumb(p)).join('')}</div></div>`).join('')}</div>
      ${cfg.blur ? '<p class="hint">Vorschaubilder sind unscharf – einmal antippen zeigt sie, zweimal öffnet das Foto.</p>' : ''}`;
  }
  h += `<div class="card"><h2>Einstellungen und Sicherung</h2>
    <div class="row"><span>Vorschaubilder unscharf<small>falls jemand anderes auf dein Handy schaut</small></span>
      <div class="seg two small"><button class="${cfg.blur ? 'on' : ''}" data-action="ph-blur" data-v="1">Ja</button>
        <button class="${cfg.blur ? '' : 'on'}" data-action="ph-blur" data-v="0">Nein</button></div></div>
    <p class="hint">Deine Fotos sind <b>nicht</b> in der normalen Sicherung. Sichere sie hier als eigene Datei – oder speichere einzelne Fotos
      über „In Fotos speichern“ in deiner Galerie.</p>
    ${phZip ? `<button class="btn primary" data-action="ph-zip-send">📤 Foto-Sicherung speichern (${mbText(phZip.size)})</button>`
      : `<button class="btn" data-action="ph-export" ${phCache.length ? '' : 'disabled'}>💾 Fotos sichern</button>`}
    <button class="btn" data-action="ph-import">Foto-Sicherung laden</button>
  </div>
  <details class="card nut-help"><summary>So werden deine Fotos vergleichbar</summary>
    <ul><li><b>Gleiche Zeit:</b> morgens, nach dem Aufstehen und vor dem Frühstück.</li>
      <li><b>Gleiches Licht:</b> am besten derselbe Raum, Licht von vorne oder oben, keine Gegenlicht-Fenster.</li>
      <li><b>Gleicher Abstand und gleiche Höhe:</b> Handy auf Brusthöhe abstellen (Selbstauslöser) oder vor dem Spiegel immer an derselben Stelle stehen.</li>
      <li><b>Gleiche Haltung:</b> locker stehen, Arme leicht vom Körper, nicht anspannen – oder immer gleich anspannen.</li>
      <li><b>Gleiche Kleidung:</b> z. B. immer dieselbe Sporthose.</li>
      <li><b>Geduld:</b> Von Woche zu Woche sieht man kaum etwas – vergleiche lieber über 2 bis 3 Monate.</li></ul></details>`;
  return h;
}

function renderPhoto({ id }) {
  mediaUrlsFree();
  if (!phCache) { phLoad(); return '<p class="hint">Foto wird geladen …</p>'; }
  const p = phCache.find(x => x.id === id);
  if (!p) return '<p class="hint">Dieses Foto gibt es nicht mehr.</p>';
  return `<div class="ph-full"><img src="${mUrl(p.blob)}" alt="${POSES[p.pose]} am ${dayText(p.date)}"></div>
    <p class="sub">${POSES[p.pose]} · ${dayText(p.date)}${phInfo(p.date) ? ` · ${phInfo(p.date)}` : ''}</p>
    <button class="btn primary" data-action="ph-save" data-id="${p.id}">📥 In Fotos speichern</button>
    <button class="btn danger outline" data-action="ph-del" data-id="${p.id}">Foto löschen</button>`;
}

/* ZIP ohne Komprimierung (JPEG/Videos lassen sich ohnehin kaum packen) */
const CRC_T = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(u8) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipMake(files) {  // [{ name, data: Uint8Array }]
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), n = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, n, true); lh.setUint32(22, n, true);
    lh.setUint16(26, nm.length, true);
    parts.push(lh.buffer, nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, n, true); ch.setUint32(24, n, true);
    ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(ch.buffer, nm);
    off += 30 + nm.length + n;
  }
  const size = central.reduce((a, b) => a + b.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, off, true);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}
async function zipRead(buf) {  // -> { Name: Uint8Array }
  const v = new DataView(buf), u8 = new Uint8Array(buf), dec = new TextDecoder();
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Das ist keine Foto-Sicherung (ZIP-Datei).');
  const n = v.getUint16(eocd + 10, true), out = {};
  let p = v.getUint32(eocd + 16, true);
  for (let k = 0; k < n; k++) {
    const method = v.getUint16(p + 10, true), size = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true), extra = v.getUint16(p + 30, true), comment = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true), name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    let d = u8.subarray(start, start + size);
    if (method === 8) d = new Uint8Array(await new Response(new Blob([d]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
    out[name] = d;
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

const POSE_FILE = { front: 'vorne', side: 'seitlich', back: 'hinten' };
async function phExport() {
  const files = [], list = [];
  for (const p of phCache) {
    const name = `fotos/${p.date} ${POSE_FILE[p.pose]}.jpg`;
    files.push({ name, data: new Uint8Array(await p.blob.arrayBuffer()) });
    list.push({ date: p.date, pose: p.pose, file: name });
  }
  files.push({ name: 'fotos.json', data: new TextEncoder().encode(JSON.stringify({ app: 'trainingsapp-fotos', v: 1, exportedAt: new Date().toISOString(), photos: list })) });
  const who = data.profile && data.profile.name ? ` ${fileSafe(data.profile.name)}` : '';
  phZip = new File([zipMake(files)], `${APP_NAME.split(' ')[0]}-Fotos${who} ${todayISO()}.zip`, { type: 'application/zip' });
}
async function phImport(file) {
  const z = await zipRead(await file.arrayBuffer());
  const meta = z['fotos.json'] && JSON.parse(new TextDecoder().decode(z['fotos.json']));
  if (!meta || meta.app !== 'trainingsapp-fotos' || !Array.isArray(meta.photos)) throw new Error('Das ist keine Foto-Sicherung dieser App.');
  let added = 0, skipped = 0;
  for (const m of meta.photos) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.date) || !POSES[m.pose] || !z[m.file]) continue;
    if (phCache.some(p => p.date === m.date && p.pose === m.pose)) { skipped++; continue; }
    const made = await photoMake(new Blob([z[m.file]], { type: 'image/jpeg' }));
    const rec = { id: uid(), date: m.date, pose: m.pose, ...made };
    await mPut('photos', rec);
    phCache.push(rec);
    added++;
  }
  phCache.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  if (added) photoChanged();
  alert(`${added} Foto${added === 1 ? '' : 's'} geladen${skipped ? `, ${skipped} schon vorhanden (übersprungen)` : ''}.`);
  render();
}

actions['ph-open-list'] = () => go('photos');
async function photoAdd(file, pose) {
  const made = await photoMake(file);
  const old = phCache.find(p => p.date === phForm.date && p.pose === pose);
  const rec = { id: old ? old.id : uid(), date: phForm.date, pose, ...made };
  await mPut('photos', rec);
  phCache = [rec, ...phCache.filter(p => p.id !== rec.id)].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  phZip = null;
  photoChanged();
  render();
  toast('Foto gespeichert ✔');
}
actions['ph-pick'] = el => mediaPick('image/*', false, f => photoAdd(f, el.dataset.pose));
actions['ph-open'] = el => {
  if (el.classList.contains('blur')) { el.classList.remove('blur'); return; }  // unscharf: erst zeigen, dann öffnen
  go('photo', { id: el.dataset.id });
};
actions['ph-pose'] = el => { phCmp.pose = el.dataset.k; render(); };
actions['ph-blur'] = el => { data.photoCfg = { ...photoCfg(), blur: el.dataset.v === '1' }; saveData(); render(); };
actions['ph-save'] = el => {
  const p = (phCache || []).find(x => x.id === el.dataset.id);
  if (!p) return;
  mediaSave(new File([p.blob], `Fortschrittsfoto ${p.date} ${POSE_FILE[p.pose]}.jpg`, { type: 'image/jpeg' }))
    .then(r => { if (r === 'download') toast('Foto gespeichert ✔'); });
};
actions['ph-del'] = el => {
  if (!confirm('Dieses Foto löschen? Das lässt sich nicht rückgängig machen.')) return;
  mDel('photos', el.dataset.id).then(() => {
    phCache = phCache.filter(p => p.id !== el.dataset.id);
    phZip = null;
    data.photoCfg = { ...photoCfg(), last: phCache.length ? phCache[0].date : null };
    saveData();
    go('photos');
  }).catch(mediaFail);
};
actions['ph-export'] = () => { phExport().then(render).catch(mediaFail); };
actions['ph-zip-send'] = () => {
  if (!phZip) return;
  mediaSave(phZip).then(r => { if (r !== 'abort') toast('Foto-Sicherung bereit ✔'); });
};
actions['ph-import'] = () => mediaPick('.zip,application/zip', false, phImport);
fields['ph-date'] = el => { if (/^\d{4}-\d{2}-\d{2}$/.test(el.value) && el.value <= todayISO()) { phForm.date = el.value; render(); } };
fields['ph-cmp-a'] = el => { phCmp.a = el.value; render(); };
fields['ph-cmp-b'] = el => { phCmp.b = el.value; render(); };

// Ernährungs-Reiter (beim Körpergewicht) – Einstieg immer da, aber unaufdringlich
function photoBtnHtml() {
  const last = photoCfg().last;
  return `<button class="link-btn meas-link ph-link" data-action="ph-open-list">${last
    ? `📷 Fortschrittsfotos · zuletzt am ${dayText(last)} ›` : '📷 Fortschrittsfotos festhalten ›'}</button>`;
}
// Zyklus-Rückblick: nur wenn schon Fotos gemacht wurden und das letzte mindestens 3 Wochen her ist
function photoReviewCard() {
  const c = photoCfg();
  if (!c.on || (c.last && c.last > addDaysISO(todayISO(), -21))) return '';
  return `<div class="card ph-remind"><p><b>📷 Zeit für ein Vergleichsfoto?</b> ${c.last ? `Dein letztes ist vom ${dayText(c.last)}.` : ''}
    Am Ende eines Zyklus lässt sich die Veränderung gut festhalten.</p>
    <button class="btn" data-action="ph-open-list">Zu den Fotos</button></div>`;
}

views.photos = { title: 'Fortschrittsfotos', tab: 'nutrition', back: 'nutrition', render: renderPhotos };
views.photo = { title: 'Foto', tab: 'nutrition', back: 'photos', render: renderPhoto };

/* ---------- Technik-Videos ---------- */

let vidCache = null, vidLoading = false;  // { key, list (neueste zuerst) }
let vidState = { rate: 1, draw: null };   // draw = { id, p1 } während eine Linie gezeichnet wird

function vidLoad(name) {
  if (vidLoading) return;
  vidLoading = true;
  const key = nameKey(name);
  mByEx(key).then(list => { vidCache = { key, list: list.sort((a, b) => b.date.localeCompare(a.date)) }; })
    .catch(e => { vidCache = { key, list: [] }; mediaFail(e); })
    .finally(() => { vidLoading = false; if (['videos', 'video'].includes(current.view)) render(); });
}
const vidReady = name => vidCache && vidCache.key === nameKey(name);
const vidExt = t => /quicktime/.test(t) ? 'mov' : /webm/.test(t) ? 'webm' : /3gp/.test(t) ? '3gp' : 'mp4';
const vidFile = v => new File([v.blob], `Technik ${fileSafe(v.name)} ${localDay(v.date)}.${vidExt(v.type)}`, { type: v.type || 'video/mp4' });
const vidSafe = v => v.saved;  // aus der Galerie gewählt oder „In Fotos speichern“ benutzt

function renderVideos({ name }) {
  mediaUrlsFree();
  if (!vidReady(name)) { vidLoad(name); return '<p class="hint">Videos werden geladen …</p>'; }
  const list = vidCache.list;
  let h = `<p class="sub">${esc(name)}</p>
    <div class="card vid-add"><h2>🎥 Technik checken</h2>
      <p>Film einen Satz und schau ihn dir in Zeitlupe an – oder vergleiche ihn mit deinem letzten Video.</p>
      <p class="hint"><b>Am sichersten:</b> mit der normalen Kamera-App filmen und hier auswählen. Dann liegt das Video schon in deinen Fotos
        und geht nicht verloren.</p>
      <button class="btn primary" data-action="vid-pick" data-cam="0">🎞 Video aus deinen Fotos wählen</button>
      <button class="btn" data-action="vid-pick" data-cam="1">🎥 In der App aufnehmen</button>
      <button class="btn nav" data-action="vid-help">📖 So gehen deine Videos nicht verloren<small>Speichern auf iPhone und Android, Tipps zum Filmen</small></button>
    </div>`;
  if (!list.length) return h + '<p class="hint">Noch keine Videos zu dieser Übung.</p>';
  h += `<h2>Deine Videos</h2>${list.map(v => `<div class="card vid-item">
      <button class="vid-thumb" data-action="vid-open" data-id="${v.id}" aria-label="Video ansehen">
        <video src="${mUrl(v.blob)}#t=0.1" preload="metadata" muted playsinline></video><span aria-hidden="true">▶</span></button>
      <div class="vid-meta"><b>${fmtDate(v.date)}</b><small>${mbText(v.size || v.blob.size)}</small>
        <small class="${vidSafe(v) ? 'ok' : 'warn'}">${vidSafe(v) ? '✔ auch in deinen Fotos' : '⚠ nur in der App gespeichert'}</small></div>
      <div class="vid-btns"><button class="btn${vidSafe(v) ? '' : ' primary'}" data-action="vid-save" data-id="${v.id}">📥 In Fotos speichern</button>
        <button class="btn danger outline" data-action="vid-del" data-id="${v.id}" aria-label="Video löschen">✕</button></div>
    </div>`).join('')}
    ${list.length >= 2 ? `<button class="btn" data-action="vid-open" data-id="${list[1].id}" data-cmp="${list[0].id}">⇆ Beide nebeneinander vergleichen</button>` : ''}
    <p class="hint">Die App behält die letzten ${VID_KEEP} Videos je Übung – ein neues ersetzt das älteste. Videos sind nicht in der
      normalen Sicherung.</p>`;
  return h;
}

function renderVideo({ name, id, cmp }) {
  mediaUrlsFree();
  if (!vidReady(name)) { vidLoad(name); return '<p class="hint">Video wird geladen …</p>'; }
  const recs = [id, cmp].filter(Boolean).map(x => vidCache.list.find(v => v.id === x)).filter(Boolean);
  if (!recs.length) return '<p class="hint">Dieses Video gibt es nicht mehr.</p>';
  const two = recs.length === 2;
  const box = v => `<div class="vid-box">
      <div class="vid-wrap" data-vwrap="${v.id}"><video data-vid="${v.id}" src="${mUrl(v.blob)}#t=0.001" preload="auto" muted playsinline></video>
        <canvas class="vid-lines" data-vlines="${v.id}"></canvas></div>
      <p class="vid-date">${fmtDate(v.date)}</p>
      <input class="vid-seek" type="range" min="0" max="1000" value="0" data-field="vid-seek" data-id="${v.id}" aria-label="Stelle im Video">
      <div class="vid-ctl"><button class="btn small" data-action="vid-step" data-id="${v.id}" data-d="-1" aria-label="Ein Bild zurück">‹</button>
        <button class="btn small primary" data-action="vid-play" data-id="${v.id}" data-vplay="${v.id}">▶</button>
        <button class="btn small" data-action="vid-step" data-id="${v.id}" data-d="1" aria-label="Ein Bild vor">›</button></div>
      <p class="vid-time" data-vtime="${v.id}">0,00 s</p>
    </div>`;
  return `<div class="vid-grid${two ? ' two' : ''}">${recs.map(box).join('')}</div>
    ${two ? '<button class="btn" data-action="vid-play-both">▶ Beide gleichzeitig abspielen</button>' : ''}
    <p class="lbl">Geschwindigkeit</p>
    <div class="seg three vid-speed">${[[1, '1×'], [0.5, '½×'], [0.25, '¼×']].map(([r, l]) =>
      `<button class="${vidState.rate === r ? 'on' : ''}" data-action="vid-speed" data-r="${r}">${l}</button>`).join('')}</div>
    <div class="row vid-tools"><button class="btn${vidState.draw ? ' primary' : ''}" data-action="vid-line">✏️ ${vidState.draw ? 'Jetzt ins Video tippen …' : 'Linie zeichnen'}</button>
      <button class="btn" data-action="vid-lines-clear">Linien löschen</button></div>
    <p class="hint explain">Tipp aufs Video zum Abspielen oder Anhalten. ‹ und › gehen ein einzelnes Bild zurück oder vor.
      <b>Linie:</b> Knopf antippen, dann Anfang und Ende ins Video tippen – z. B. senkrecht neben die Hantel, um zu sehen, ob sie gerade
      läuft, oder waagerecht auf Kniehöhe, um die Tiefe der Kniebeuge zu prüfen.</p>`;
}

const vidEl = id => document.querySelector(`video[data-vid="${id}"]`);
const vidRec = id => vidCache && vidCache.list.find(v => v.id === id);
function vidLinesDraw(id) {
  const v = vidEl(id), c = document.querySelector(`canvas[data-vlines="${id}"]`), rec = vidRec(id);
  if (!v || !c || !rec) return;
  const r = v.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
  c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  const col = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';
  const pts = [...(rec.lines || [])];
  if (vidState.draw && vidState.draw.id === id && vidState.draw.p1) pts.push([vidState.draw.p1, null]);
  for (const [a, b] of pts) {
    g.lineWidth = 3 * dpr; g.strokeStyle = col; g.fillStyle = col;
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 3 * dpr;
    if (b) { g.beginPath(); g.moveTo(a[0] * c.width, a[1] * c.height); g.lineTo(b[0] * c.width, b[1] * c.height); g.stroke(); }
    for (const p of [a, b].filter(Boolean)) { g.beginPath(); g.arc(p[0] * c.width, p[1] * c.height, 5 * dpr, 0, 7); g.fill(); }
  }
}
function vidTimeSync(id) {
  const v = vidEl(id);
  if (!v) return;
  const t = document.querySelector(`[data-vtime="${id}"]`), s = document.querySelector(`input[data-field="vid-seek"][data-id="${id}"]`);
  const b = document.querySelector(`[data-vplay="${id}"]`);
  if (t) t.textContent = `${v.currentTime.toFixed(2).replace('.', ',')} s${v.duration ? ` von ${v.duration.toFixed(1).replace('.', ',')} s` : ''}`;
  if (s && v.duration && document.activeElement !== s) s.value = String(Math.round(v.currentTime / v.duration * 1000));
  if (b) b.textContent = v.paused ? '▶' : '❚❚';
}
function videoAfter() {
  document.querySelectorAll('video[data-vid]').forEach(v => {
    const id = v.dataset.vid;
    v.playbackRate = vidState.rate;
    v.addEventListener('loadedmetadata', () => { vidLinesDraw(id); vidTimeSync(id); });
    ['timeupdate', 'play', 'pause', 'seeked'].forEach(ev => v.addEventListener(ev, () => vidTimeSync(id)));
    v.addEventListener('ratechange', () => { if (v.playbackRate !== vidState.rate) v.playbackRate = vidState.rate; });
    const wrap = v.closest('.vid-wrap');
    wrap.addEventListener('click', e => {
      if (vidState.draw) {
        const r = v.getBoundingClientRect(), p = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height].map(x => Math.min(1, Math.max(0, x)));
        if (!vidState.draw.p1 || vidState.draw.id !== id) { vidState.draw = { id, p1: p }; vidLinesDraw(id); return; }
        const rec = vidRec(id);
        rec.lines = [...(rec.lines || []), [vidState.draw.p1, p]];
        vidState.draw = null;
        mPut('videos', rec).catch(mediaFail);
        vidLinesDraw(id); vidDrawBtn();
        return;
      }
      if (v.paused) v.play().catch(() => {}); else v.pause();
    });
  });
}
window.addEventListener('resize', () => { if (current && current.view === 'video') document.querySelectorAll('video[data-vid]').forEach(v => vidLinesDraw(v.dataset.vid)); });

async function vidAdd(name, file, cam) {
  if (!/^video\//.test(file.type) && !/\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name)) throw new Error('Das ist kein Video.');
  if (file.size > 600e6 && !confirm(`Das Video ist sehr groß (${mbText(file.size)}). Trotzdem übernehmen? Kürzer filmen spart Platz.`)) return;
  const list = await mByEx(nameKey(name));
  list.sort((a, b) => b.date.localeCompare(a.date));
  for (const old of list.slice(VID_KEEP - 1)) {
    if (!vidSafe(old) && !confirm(`Die App behält ${VID_KEEP} Videos je Übung. Das Video vom ${fmtDate(old.date)} ist nur in der App gespeichert und würde jetzt ersetzt.\n\nTrotzdem ersetzen? (Sonst zuerst „In Fotos speichern“.)`)) return;
    await mDel('videos', old.id);
  }
  await mPut('videos', { id: uid(), ex: nameKey(name), name, date: new Date().toISOString(), blob: file, type: file.type || 'video/mp4',
    size: file.size, saved: !cam, src: cam ? 'camera' : 'pick', lines: [] });
  vidCache = null;
  render();
  toast(cam ? 'Video gespeichert – denk an „In Fotos speichern“' : 'Video übernommen ✔');
}
actions['vid-open-list'] = el => go('videos', { name: el.dataset.name, from: current.view === 'training' ? 'training' : 'exercise' });
actions['vid-pick'] = el => { const name = current.params.name, cam = el.dataset.cam === '1'; mediaPick('video/*', cam, f => vidAdd(name, f, cam)); };
actions['vid-help'] = () => go('videohelp', { name: current.params.name, from: current.params.from });
actions['vid-open'] = el => (vidState.draw = null, go('video', { name: current.params.name, from: current.params.from, id: el.dataset.id, cmp: el.dataset.cmp || null }));
actions['vid-save'] = el => {
  const v = vidRec(el.dataset.id);
  if (!v) return;
  mediaSave(vidFile(v)).then(r => {
    if (r === 'abort') return;
    if (!v.saved) { v.saved = true; mPut('videos', v).then(render).catch(mediaFail); }
    if (r === 'download') toast('Video gespeichert ✔ (Ordner „Downloads“)');
  });
};
actions['vid-del'] = el => {
  const v = vidRec(el.dataset.id);
  if (!v || !confirm(`Video vom ${fmtDate(v.date)} löschen?${vidSafe(v) ? '' : '\n\nEs ist nur in der App gespeichert – danach ist es weg.'}`)) return;
  mDel('videos', v.id).then(() => { vidCache.list = vidCache.list.filter(x => x.id !== v.id); render(); }).catch(mediaFail);
};
actions['vid-play'] = el => { const v = vidEl(el.dataset.id); if (v) { if (v.paused) v.play().catch(() => {}); else v.pause(); } };
actions['vid-play-both'] = () => {
  const vs = [...document.querySelectorAll('video[data-vid]')];
  if (vs.every(v => !v.paused)) vs.forEach(v => v.pause()); else vs.forEach(v => v.play().catch(() => {}));
};
actions['vid-step'] = el => {
  const v = vidEl(el.dataset.id);
  if (!v) return;
  v.pause();
  v.currentTime = Math.min(v.duration || 0, Math.max(0, v.currentTime + Number(el.dataset.d) / 30));
};
actions['vid-speed'] = el => {
  vidState.rate = Number(el.dataset.r);
  document.querySelectorAll('video[data-vid]').forEach(v => { v.playbackRate = vidState.rate; });
  el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
};
// Knopf „Linie zeichnen“ ohne neu zu zeichnen umschalten – sonst spränge das Video an den Anfang
function vidDrawBtn() {
  const b = document.querySelector('[data-action="vid-line"]');
  if (b) { b.classList.toggle('primary', !!vidState.draw); b.textContent = `✏️ ${vidState.draw ? 'Jetzt ins Video tippen …' : 'Linie zeichnen'}`; }
}
actions['vid-line'] = () => {
  const was = vidState.draw;
  vidState.draw = was ? null : { id: null, p1: null };
  if (was && was.id) vidLinesDraw(was.id);
  vidDrawBtn();
};
actions['vid-lines-clear'] = () => {
  const ids = [current.params.id, current.params.cmp].filter(Boolean);
  Promise.all(ids.map(id => { const r = vidRec(id); if (!r || !(r.lines || []).length) return null; r.lines = []; return mPut('videos', r); }))
    .then(() => { vidState.draw = null; ids.forEach(vidLinesDraw); vidDrawBtn(); }).catch(mediaFail);
};
fields['vid-seek'] = el => { const v = vidEl(el.dataset.id); if (v && v.duration) { v.pause(); v.currentTime = Number(el.value) / 1000 * v.duration; } };

function renderVideoHelp() {
  return `<div class="card about-sec vid-help">
    <h2>Warum speichern?</h2>
    <p>Videos in der App liegen nur im Speicher dieser App – <b>nicht</b> in deiner Galerie und <b>nicht</b> in der Sicherungsdatei.
      Sie sind weg, wenn du die Website-Daten im Browser löschst, die App vom Home-Bildschirm entfernst oder das Handy wechselst.
      Außerdem behält die App nur die letzten ${VID_KEEP} Videos je Übung. Was du behalten willst, gehört deshalb in deine Fotos.</p>

    <h2>Der einfachste Weg (empfohlen)</h2>
    <ol><li>Film den Satz mit der <b>normalen Kamera-App</b> deines Handys.</li>
      <li>Das Video liegt damit automatisch in deinen Fotos (iPhone: App „Fotos“, Android: „Galerie“ oder „Google Fotos“).</li>
      <li>In der App bei der Übung „🎥 Video“ → <b>„Video aus deinen Fotos wählen“</b>.</li></ol>
    <p>So musst du an nichts weiter denken – die App arbeitet mit einer Kopie, das Original bleibt in deiner Galerie.</p>

    <h2>Direkt in der App aufgenommen?</h2>
    <p>Dann liegt das Video zunächst nur in der App (Hinweis „⚠ nur in der App gespeichert“). So kommt es in deine Fotos:</p>
    <h3>iPhone</h3>
    <ol><li>„📥 In Fotos speichern“ antippen – das Teilen-Menü öffnet sich.</li>
      <li>Nach unten wischen und <b>„Video sichern“</b> wählen. Das Video landet in der App „Fotos“.</li>
      <li>Alternativ „In Dateien sichern“, z. B. in iCloud Drive.</li></ol>
    <p class="hint">Beim ersten Mal fragt das iPhone, ob die App Fotos hinzufügen darf – mit „Erlauben“ bestätigen.</p>
    <h3>Android</h3>
    <ol><li>„📥 In Fotos speichern“ antippen – je nach Handy öffnet sich das Teilen-Menü.</li>
      <li>Dort deine Galerie-App, „Google Fotos“ oder „Dateien“/„In Downloads speichern“ wählen. Die Einträge heißen je nach Hersteller etwas anders.</li>
      <li>Öffnet sich kein Menü, speichert das Handy das Video direkt im Ordner <b>„Downloads“</b>. In der Galerie findest du es dann
        unter „Alben“ → „Download“.</li></ol>
    <p class="hint">Ist es gespeichert, steht beim Video „✔ auch in deinen Fotos“. Die App kann nicht prüfen, ob das Speichern im Menü
      wirklich geklappt hat – schau im Zweifel kurz in deiner Galerie nach.</p>

    <h2>Tipps zum Filmen</h2>
    <ul><li><b>Stabil abstellen:</b> z. B. an Flasche oder Tasche lehnen oder einen kleinen Ständer nutzen – nicht in der Hand halten.</li>
      <li><b>Seitlich</b> auf Hüfthöhe für Kniebeugen, Kreuzheben, Bankdrücken und Rudern – so siehst du Tiefe, Rücken und den Weg der Hantel.</li>
      <li><b>Schräg von vorne</b> (etwa 45°), um zu sehen, ob die Knie nach innen fallen.</li>
      <li><b>Ganzer Körper und Hantel im Bild</b>, gutes Licht, kein helles Fenster im Hintergrund.</li>
      <li><b>Immer von derselben Stelle</b> filmen – dann lassen sich zwei Videos gut vergleichen.</li>
      <li><b>Kurz halten:</b> ein Satz genügt. Ein Video mit 30 Sekunden hat je nach Handy 20 bis 60 MB.</li></ul>

    <h2>Rücksicht im Studio</h2>
    <p>Andere Menschen dürfen ohne ihr Einverständnis nicht erkennbar gefilmt werden. Viele Studios haben eigene Regeln zum Filmen –
      frag im Zweifel kurz nach und richte die Kamera so aus, dass nur du im Bild bist.</p>

    <h2>Was die App nicht macht</h2>
    <p>Die App bewertet deine Technik nicht automatisch – sie hilft dir nur beim genauen Hinsehen. Bist du unsicher, zeig das Video einer
      Trainerin oder einem Trainer.</p>
  </div>`;
}

views.videos = { title: 'Technik-Videos', tab: p => p.from === 'training' ? 'start' : 'history',
  back: p => p.from === 'training' ? ['training', {}] : ['exercise', { name: p.name }], render: renderVideos };
views.video = { title: 'Video', tab: p => p.from === 'training' ? 'start' : 'history',
  back: p => ['videos', { name: p.name, from: p.from }], render: renderVideo, after: videoAfter };
views.videohelp = { title: 'Videos sichern', tab: p => p.from === 'training' ? 'start' : 'history',
  back: p => ['videos', { name: p.name, from: p.from }], render: renderVideoHelp };
