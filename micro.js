/* StepUp Strength · © 2026 Alex Hundt · Alle Rechte vorbehalten – siehe LICENSE */
'use strict';

/* ---------- Mikronährstoffe im Ernährungstagebuch (v214, User-Wunsch 2026-11-11) ----------
   Werte: Bundeslebensmittelschlüssel (bls-micro.js, wird erst hier geladen) für Grundliste und BLS-Einträge; Open Food Facts,
   eigene Lebensmittel und Nahrungsergänzung tragen ihre Werte selbst (food.mic, je 100 g bzw. je 100 Stück).
   Richtwerte: D-A-CH-Referenzwerte der DGE (3. Auflage 2025, Werte von dge.de abgerufen am 11.11.2026) – nur neutrale
   Orientierung, keine Bewertung, kein Urteil über einen Mangel (User: „neutraler Richtwert“). */

// [Schlüssel, Name, Einheit, Gruppe]
const MICROS = [
  ['vitA', 'Vitamin A', 'µg', 'vit'], ['vitD', 'Vitamin D', 'µg', 'vit'], ['vitE', 'Vitamin E', 'mg', 'vit'],
  ['vitK', 'Vitamin K', 'µg', 'vit'], ['b1', 'Vitamin B1 (Thiamin)', 'mg', 'vit'], ['b2', 'Vitamin B2 (Riboflavin)', 'mg', 'vit'],
  ['nia', 'Niacin', 'mg', 'vit'], ['b6', 'Vitamin B6', 'mg', 'vit'], ['fol', 'Folat', 'µg', 'vit'], ['pant', 'Pantothensäure', 'mg', 'vit'],
  ['biot', 'Biotin', 'µg', 'vit'], ['b12', 'Vitamin B12', 'µg', 'vit'], ['vitC', 'Vitamin C', 'mg', 'vit'],
  ['ca', 'Calcium', 'mg', 'min'], ['mg', 'Magnesium', 'mg', 'min'], ['k', 'Kalium', 'mg', 'min'], ['na', 'Natrium', 'mg', 'min'],
  ['p', 'Phosphor', 'mg', 'min'],
  ['fe', 'Eisen', 'mg', 'trace'], ['zn', 'Zink', 'mg', 'trace'], ['jod', 'Jod', 'µg', 'trace'], ['cu', 'Kupfer', 'mg', 'trace'],
  ['mn', 'Mangan', 'mg', 'trace'],
  ['ala', 'Omega-3 (Alpha-Linolensäure)', 'g', 'fat'], ['epa', 'Omega-3 aus Fisch (EPA + DHA)', 'mg', 'fat'],
  ['la', 'Omega-6 (Linolsäure)', 'g', 'fat'], ['sat', 'Gesättigte Fettsäuren', 'g', 'fat'], ['chol', 'Cholesterin', 'mg', 'fat'],
  ['salt', 'Salz', 'g', 'fat'],
];
const MICRO_MAP = new Map(MICROS.map(m => [m[0], m]));
const MICRO_GROUPS = { vit: 'Vitamine', min: 'Mineralstoffe', trace: 'Spurenelemente', fat: 'Fette und Salz' };
const MICRO_OK = 0.8;  // unter diesem Anteil bekannter Kalorien gilt ein Wert als lückenhaft

// Was der Nährstoff macht und wo er drinsteckt (kurz, allgemein gehalten)
const MICRO_INFO = {
  vitA: 'Für Sehen, Haut und Abwehr. In Leber, Milchprodukten, Eiern und als Beta-Carotin in Karotten, Süßkartoffeln, Spinat und Grünkohl.',
  vitD: 'Für Knochen, Muskeln und Abwehr. Der Körper bildet es vor allem selbst mit Sonnenlicht auf der Haut – über das Essen kommen meist nur wenige µg. Der Richtwert gilt nur, wenn die eigene Bildung fehlt (z. B. im Winter). Gute Quellen: fetter Fisch, Eier, Pilze.',
  vitE: 'Schützt Zellen vor Schäden. In Pflanzenölen (z. B. Weizenkeim-, Sonnenblumen-, Rapsöl), Nüssen und Samen.',
  vitK: 'Für Blutgerinnung und Knochen. In grünem Blattgemüse, Kohl, Kräutern und fermentierten Lebensmitteln.',
  b1: 'Für den Energiestoffwechsel und die Nerven. In Vollkorn, Hülsenfrüchten, Schweinefleisch und Nüssen.',
  b2: 'Für den Energiestoffwechsel. In Milchprodukten, Fleisch, Fisch, Eiern und Vollkorn.',
  nia: 'Für den Energiestoffwechsel. In Fleisch, Fisch, Erdnüssen und Vollkorn; der Körper bildet es auch aus Eiweiß.',
  b6: 'Für den Eiweißstoffwechsel – wer viel Eiweiß isst, braucht etwas mehr. In Fleisch, Fisch, Kartoffeln, Bananen, Vollkorn und Hülsenfrüchten.',
  fol: 'Für Zellteilung und Blutbildung. In grünem Gemüse, Hülsenfrüchten, Vollkorn und Eiern. Gezählt in Folat-Äquivalenten: Folsäure aus Präparaten zählt laut DGE doppelt (400 µg Folsäure = 800 µg Folat-Äquivalente).',
  pant: 'Für den Energiestoffwechsel. Steckt in fast allen Lebensmitteln, z. B. Fleisch, Vollkorn, Eiern und Hülsenfrüchten.',
  biot: 'Für den Stoffwechsel, Haut und Haare. In Eiern, Nüssen, Haferflocken und Hülsenfrüchten.',
  b12: 'Für Blutbildung und Nerven. Kommt fast nur in tierischen Lebensmitteln vor (Fleisch, Fisch, Milchprodukte, Eier). Wer vegan isst, braucht eine Ergänzung.',
  vitC: 'Für Abwehr, Bindegewebe und eine bessere Eisenaufnahme aus Pflanzen. In Paprika, Zitrusfrüchten, Beeren, Kohl und Kartoffeln.',
  ca: 'Für Knochen, Zähne und Muskeln. In Milchprodukten, Käse, calciumreichem Mineralwasser, grünem Gemüse und angereicherten Pflanzendrinks.',
  mg: 'Für Muskeln, Nerven und Energiestoffwechsel. In Vollkorn, Nüssen, Samen, Hülsenfrüchten und manchen Mineralwässern.',
  k: 'Für Muskeln, Nerven und den Blutdruck. In Obst, Gemüse, Kartoffeln, Hülsenfrüchten und Nüssen.',
  na: 'Für den Wasserhaushalt. Kommt vor allem über Salz – meist mehr als nötig; Brot, Käse, Wurst und Fertiggerichte liefern viel.',
  p: 'Für Knochen und Energiestoffwechsel. In Milchprodukten, Fleisch, Fisch, Vollkorn und Hülsenfrüchten – meist reichlich.',
  fe: 'Für den Sauerstofftransport im Blut. In Fleisch (gut verwertbar), Hülsenfrüchten, Vollkorn und Haferflocken. Vitamin C zur Mahlzeit verbessert die Aufnahme aus Pflanzen, Kaffee und Tee kurz davor oder danach verschlechtern sie.',
  zn: 'Für Abwehr, Wundheilung und Stoffwechsel. In Fleisch, Käse, Haferflocken, Vollkorn und Nüssen. Der Richtwert gilt für eine mittlere Phytatzufuhr (Vollkorn, Hülsenfrüchte).',
  jod: 'Für die Schilddrüse. In Seefisch, Milchprodukten und Jodsalz – die Werte der Datenbank enthalten Jodsalz nur, wo es üblich ist. Das ist der Nährstoff mit den meisten Lücken.',
  cu: 'Für Blutbildung und Bindegewebe. In Nüssen, Vollkorn, Hülsenfrüchten und Kakao.',
  mn: 'Für Knochen und Stoffwechsel. In Vollkorn, Haferflocken, Nüssen und Tee.',
  ala: 'Pflanzliche Omega-3-Fettsäure. In Leinöl, Rapsöl, Walnüssen, Lein- und Chiasamen. Richtwert: 0,5 % der Kalorien.',
  epa: 'Omega-3-Fettsäuren aus Fisch, vor allem aus fettem Seefisch wie Lachs, Hering und Makrele. Für Erwachsene nennt die DGE keinen eigenen Richtwert; in der Schwangerschaft und Stillzeit gelten im Schnitt mindestens 200 mg DHA am Tag.',
  la: 'Omega-6-Fettsäure. In Sonnenblumen-, Distel- und Maiskeimöl, Nüssen und Samen – meist reichlich vorhanden. Richtwert: 2,5 % der Kalorien.',
  sat: 'Vor allem in Butter, Sahne, Käse, Wurst, fettem Fleisch, Kokos- und Palmfett. Die DGE nennt keinen Zahlenwert, rät aber, weniger davon zu essen und eher Pflanzenöle zu nehmen.',
  chol: 'In tierischen Lebensmitteln wie Eiern, Innereien, Butter und fettem Fleisch. Der Körper bildet Cholesterin auch selbst; die DGE nennt für die Zufuhr keinen Richtwert.',
  salt: 'Kochsalz (Natriumchlorid). Brot, Käse, Wurst, Fertiggerichte und Soßen liefern das meiste. Orientierung der DGE: höchstens etwa 6 g am Tag.',
};

// Hinweise speziell für Frauen (nur angezeigt, wenn im Profil „Frau“ gewählt ist)
const MICRO_WOMEN = {
  fe: 'Frauen mit Periode verlieren regelmäßig Eisen und haben deshalb einen höheren Richtwert (16 statt 11 mg). Ohne Periode – z. B. bei durchgehender Pilleneinnahme oder nach den Wechseljahren – gelten 11 bzw. 14 mg. Bei starken Blutungen oder ständiger Müdigkeit lohnt es sich, den Eisenwert ärztlich prüfen zu lassen.',
  fol: 'Wichtig bei Kinderwunsch: Die DGE empfiehlt Frauen, die schwanger werden wollen oder könnten, zusätzlich zum Essen täglich 400 µg Folsäure als Präparat – mindestens 4 Wochen vor einer Schwangerschaft bis zum Ende des ersten Drittels. Das bitte mit Ärztin oder Arzt absprechen.',
  ca: 'Calcium und Vitamin D sind für die Knochen besonders wichtig – vor allem bei längeren Diäten, sehr wenig Kalorien und nach den Wechseljahren, wenn die Knochendichte schneller abnimmt. Krafttraining hilft den Knochen zusätzlich.',
  vitD: 'Zusammen mit Calcium wichtig für die Knochen, gerade nach den Wechseljahren.',
  jod: 'In Schwangerschaft und Stillzeit steigt der Bedarf deutlich; ob eine Ergänzung sinnvoll ist, klärt die Frauenarztpraxis.',
  b12: 'Bei veganer Ernährung, in Schwangerschaft und Stillzeit besonders wichtig.',
};

// Altersgruppe der DGE-Tabellen: 0 = 19 bis unter 25, 1 = 25 bis unter 51, 2 = 51 bis unter 65, 3 = ab 65
function microAgeIdx() {
  const n = data.nutrition || {};
  const age = n.ageYear ? new Date().getFullYear() - n.ageYear : n.age;
  return !age ? 1 : age < 25 ? 0 : age < 51 ? 1 : age < 65 ? 2 : 3;
}
// Frauen 51–64: Periode noch eingetragen (Zykluskalender, letzte 90 Tage)?
function microMens(ai) {
  if (ai <= 1) return true;
  if (ai >= 3) return false;
  try { return typeof mcOn === 'function' && mcOn() && mcCal().starts.some(d => d >= addDaysISO(todayISO(), -90)); } catch (e) { return false; }
}
// Richtwert: { v } (Referenzwert), { lo, hi } (Spanne), { max } (höchstens) oder null (keiner)
function microRef(k, c) {
  const f = c.f, ai = c.ai, at = a => a[ai];
  const R = {
    vitA: f ? 700 : ai === 3 ? 800 : 850, vitD: 20, vitE: 8, vitK: f ? at([60, 60, 65, 65]) : at([70, 70, 80, 80]),
    b1: f ? 1.0 : at([1.3, 1.2, 1.2, 1.1]), b2: f ? at([1.1, 1.1, 1.0, 1.0]) : at([1.4, 1.4, 1.3, 1.3]),
    nia: f ? at([13, 12, 11, 11]) : at([16, 15, 15, 14]), b6: f ? 1.4 : 1.6, fol: 300, pant: 5, biot: 40, b12: 4, vitC: f ? 95 : 110,
    ca: 1000, mg: f ? 300 : 350, k: 4000, na: 1500, p: 550,
    fe: f ? (c.mens ? 16 : 14) : 11, zn: f ? 8 : 14, jod: 150,
  };
  if (R[k] != null) return { v: R[k] };
  if (k === 'cu') return { lo: 1, hi: 1.5 };
  if (k === 'mn') return { lo: 2, hi: 5 };
  if (k === 'ala' && c.kcal) return { v: 0.005 * c.kcal / 9 };
  if (k === 'la' && c.kcal) return { v: 0.025 * c.kcal / 9 };
  if (k === 'salt') return { max: 6 };
  return null;
}

/* ----- Daten ----- */

let microRows = null;  // Map BLS-Code -> Werte (Reihenfolge BLS_MICRO_KEYS)
let microLoading = null;
function microLoad() {
  if (microRows) return Promise.resolve();
  if (!microLoading) {
    microLoading = (typeof BLS_MICRO === 'string' ? Promise.resolve() : loadScript('bls-micro.js')).then(() => {
      microRows = new Map();
      for (const line of BLS_MICRO.split('\n')) {
        const [code, ...v] = line.split('|');
        microRows.set(code, v.map(x => (x === '' ? null : +x)));
      }
    }).catch(e => { microLoading = null; throw e; });
  }
  return microLoading;
}
const microFromRow = row => row ? Object.fromEntries(BLS_MICRO_KEYS.map((k, i) => [k, row[i]])) : null;
// Werte je 100 g (bzw. je 100 Stück bei Nahrungsergänzung) eines Tagebuch-Eintrags; null = keine Mikro-Angaben
function entryMicro(e) {
  if (!e || e.key === FOOD_FILL) return null;
  if (e.mic) return e.mic;
  const key = String(e.key || '');
  if (microRows && key.startsWith('bls:')) return microFromRow(microRows.get(key.slice(4)));
  if (microRows && key.startsWith('b:') && typeof BASE_MICRO_CODE === 'object') return microFromRow(microRows.get(BASE_MICRO_CODE[key.slice(2)]));
  const f = data.foods[key];  // eigenes Lebensmittel, bevor es Werte trug
  return f && f.mic ? f.mic : null;
}
const micKnown = m => m ? MICROS.filter(([k]) => m[k] != null).length : 0;

// Summen über Tage: { days, kcal, val: {k: Summe}, kc: {k: kcal mit bekanntem Wert}, cover (Anteil kcal mit Mikro-Daten), by: {k: {Name: Menge}} }
function microSum(dates) {
  const s = { days: 0, kcal: 0, coverKcal: 0, val: {}, kc: {}, by: {}, supp: 0 };
  MICROS.forEach(([k]) => { s.val[k] = 0; s.kc[k] = 0; s.by[k] = {}; });
  for (const d of dates) {
    const list = foodOn(d);
    if (!list.some(e => e.key !== FOOD_FILL)) continue;
    s.days++;
    for (const e of list) {
      const kcal = (e.per[0] || 0) * e.g / 100;
      s.kcal += kcal;
      const m = entryMicro(e);
      if (!m) continue;
      if (e.supp) s.supp++;
      if (micKnown(m) >= MICROS.length / 2) s.coverKcal += kcal;
      for (const [k] of MICROS) {
        if (m[k] == null) continue;
        const v = m[k] * e.g / 100;
        s.val[k] += v;
        s.kc[k] += kcal;
        if (v > 0) s.by[k][e.name] = (s.by[k][e.name] || 0) + v;
      }
    }
  }
  return s;
}

/* ----- Ansicht ----- */

let microRange = 'week';
const microFmt = v => v >= 100 ? deNum(Math.round(v)) : v >= 10 ? fmtNum(Math.round(v)) : v >= 1 ? fmtNum(Math.round(v * 10) / 10) : fmtNum(Math.round(v * 100) / 100);
function microRefText(r, u) {
  if (!r) return 'kein Richtwert';
  if (r.max != null) return `Orientierung: höchstens ${microFmt(r.max)} ${u}`;
  if (r.lo != null) return `Richtwert ${microFmt(r.lo)}–${microFmt(r.hi)} ${u}`;
  return `Richtwert ${microFmt(r.v)} ${u}`;
}
function microRow(k, s, c) {
  const [, label, u] = MICRO_MAP.get(k);
  const n = Math.max(1, s.days);
  const v = s.val[k] / n;
  const r = microRef(k, c);
  const base = r ? (r.v != null ? r.v : r.lo != null ? r.lo : r.max) : null;
  const pct = base ? v / base * 100 : null;
  const gap = s.kcal > 0 && s.kc[k] / s.kcal < MICRO_OK;
  const top = Object.entries(s.by[k]).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const women = c.f && MICRO_WOMEN[k];
  return `<details class="mic-row">
      <summary><span class="mic-name">${label}${gap ? ' <small class="mic-gap">lückenhaft</small>' : ''}</span>
        <b class="mic-val">${microFmt(v)} ${u}</b>
        ${pct != null ? `<span class="mic-bar${r.max != null ? ' max' : ''}"><i style="width:${Math.min(100, Math.round(pct))}%"></i></span>` : ''}
        <small class="mic-ref">${microRefText(r, u)}${pct != null && r.max == null ? ` · ${Math.round(pct)} %` : ''}</small></summary>
      <div class="mic-info"><p>${MICRO_INFO[k]}</p>
        ${top.length ? `<p class="hint nut-small"><b>Bei dir vor allem aus:</b> ${top.map(([nm, x]) => `${esc(nm)} (${microFmt(x / n)} ${u})`).join(' · ')}</p>` : ''}
        ${gap ? `<p class="hint nut-small">Für ${Math.round((1 - s.kc[k] / s.kcal) * 100)} % deiner Kalorien kennt die App diesen Wert nicht (z. B. gescannte Produkte) – die Zahl ist eher zu niedrig.</p>` : ''}
        ${women ? `<p class="mic-women">♀ ${women}</p>` : ''}</div>
    </details>`;
}

function renderMicro(p) {
  if (!microRows) {
    microLoad().then(() => { if (current.view === 'micro') render(); }).catch(() => { if (current.view === 'micro') render(); });
    return microLoading ? '<p class="hint">Nährstoffdaten werden geladen …</p>'
      : '<p class="hint">Die Nährstoffdaten konnten nicht geladen werden. Prüfe die Verbindung und öffne die Seite noch einmal.</p>';
  }
  const date = p.date || todayISO();
  const dates = microRange === 'week' ? Array.from({ length: 7 }, (_, i) => addDaysISO(date, -i)) : [date];
  const s = microSum(dates);
  const c = { f: profileSex() === 'f', ai: microAgeIdx(), kcal: s.days ? s.kcal / s.days : null };
  c.mens = c.f && microMens(c.ai);
  let h = `<div class="seg two mic-seg"><button class="${microRange === 'week' ? 'on' : ''}" data-action="micro-range" data-r="week">Ø 7 Tage</button>
      <button class="${microRange === 'day' ? 'on' : ''}" data-action="micro-range" data-r="day">${date === todayISO() ? 'Heute' : fmtDate(date + 'T12:00:00')}</button></div>`;
  if (!s.days) {
    return h + `<p class="hint">${microRange === 'week' ? 'In den letzten 7 Tagen' : 'An diesem Tag'} ist nichts eingetragen. Sobald du Lebensmittel
      einträgst, siehst du hier Vitamine, Mineralstoffe und Fette.</p>`;
  }
  const cover = s.kcal ? s.coverKcal / s.kcal : 1;
  h += `<div class="card mic-cov"><p>${microRange === 'week' ? `Durchschnitt aus <b>${s.days} Tag${s.days === 1 ? '' : 'en'}</b> mit Einträgen` : 'Summe dieses Tages'}
      · Mikros bekannt für <b>${Math.round(cover * 100)} %</b> deiner Kalorien${s.supp ? ` · ${s.supp} × Nahrungsergänzung eingerechnet` : ''}.</p>
    ${cover < MICRO_OK ? '<p class="hint nut-small">Ein Teil deiner Einträge hat keine Angaben dazu (z. B. gescannte Markenprodukte oder „Aufgefüllt“). Die Werte sind deshalb eher zu niedrig.</p>' : ''}
    ${microRange === 'day' ? '<p class="hint nut-small">Mikros schwanken von Tag zu Tag stark – aussagekräftiger ist der Durchschnitt über 7 Tage.</p>' : ''}</div>`;
  for (const [g, title] of Object.entries(MICRO_GROUPS)) {
    h += `<h2 class="mic-h">${title}</h2><div class="card mic-list">${MICROS.filter(m => m[3] === g).map(([k]) => microRow(k, s, c)).join('')}</div>`;
  }
  return h + `<details class="card nut-help"><summary>So sind die Werte zu verstehen</summary>
      <p>Die Richtwerte sind die Referenzwerte der Deutschen Gesellschaft für Ernährung (DGE), passend zu ${c.f ? 'Frauen' : 'Männern'}
        ${['von 19 bis 24', 'von 25 bis 50', 'von 51 bis 64', 'ab 65'][c.ai]} Jahren${(data.nutrition || {}).age || (data.nutrition || {}).ageYear ? '' : ' (Alter nicht eingetragen – angenommen 25 bis 50)'}.
        Sie sind so bemessen, dass fast alle gesunden Menschen damit gut versorgt sind – wer darunter liegt, hat deshalb nicht automatisch zu wenig.</p>
      <p>Die Lebensmittelwerte sind Durchschnittswerte (Bundeslebensmittelschlüssel des Max Rubner-Instituts). Wie viel der Körper davon
        wirklich aufnimmt, hängt von vielem ab. <b>Ob dir etwas fehlt, kann nur ein Bluttest zeigen</b> – die App hält nur fest, was du gegessen hast.</p>
      <p>In Schwangerschaft und Stillzeit gelten andere Werte – bitte mit Ärztin, Arzt oder Hebamme besprechen.</p>
      <p class="hint nut-small">Nahrungsergänzung trägst du beim Hinzufügen über „💊 Ergänzung“ ein – sie zählt dann hier mit.</p></details>`;
}

views.micro = { title: 'Vitamine & Mineralstoffe', tab: 'nutrition', back: p => ['food', { date: p.date }], render: renderMicro };
actions['micro-open'] = () => go('micro', { date: current.params.date || todayISO() });
actions['micro-range'] = el => { microRange = el.dataset.r; render(); };

// Knopf im Tagebuch (unter Ballaststoffe/Zucker)
function microBtnHtml() {
  if (!feat('nut-micro')) return '';
  return '<button class="btn nav mic-btn" data-action="micro-open">🔬 Vitamine & Mineralstoffe<small>Mikronährstoffe ansehen – mit Richtwerten der DGE</small></button>';
}

/* ----- Open Food Facts: Mikros aus den Nährwerten (Werte dort in Gramm) ----- */
const OFF_MICRO = {
  vitA: [['vitamin-a'], 1e6], vitD: [['vitamin-d'], 1e6], vitE: [['vitamin-e'], 1e3], vitK: [['vitamin-k'], 1e6],
  b1: [['vitamin-b1'], 1e3], b2: [['vitamin-b2'], 1e3], nia: [['vitamin-pp'], 1e3], b6: [['vitamin-b6'], 1e3],
  fol: [['folates', 'vitamin-b9'], 1e6], pant: [['pantothenic-acid'], 1e3], biot: [['biotin'], 1e6], b12: [['vitamin-b12'], 1e6],
  vitC: [['vitamin-c'], 1e3], ca: [['calcium'], 1e3], mg: [['magnesium'], 1e3], k: [['potassium'], 1e3], na: [['sodium'], 1e3],
  p: [['phosphorus'], 1e3], fe: [['iron'], 1e3], zn: [['zinc'], 1e3], jod: [['iodine'], 1e6], cu: [['copper'], 1e3],
  mn: [['manganese'], 1e3], ala: [['alpha-linolenic-acid'], 1], la: [['linoleic-acid'], 1],
  epa: [['eicosapentaenoic-acid', 'docosahexaenoic-acid'], 1e3, true], sat: [['saturated-fat'], 1], chol: [['cholesterol'], 1e3],
  salt: [['salt'], 1],
};
// suffix '_100g' oder '_serving'; scale = Faktor auf das Ergebnis; null, wenn gar nichts angegeben ist
function offMicro(n, suffix = '_100g', scale = 1) {
  const out = {};
  let any = false;
  for (const [k, [names, f, sum]] of Object.entries(OFF_MICRO)) {
    const vals = names.map(x => n[x + suffix]).filter(x => x != null && x !== '' && !isNaN(Number(x))).map(Number);
    if (!vals.length) continue;
    const v = (sum ? vals.reduce((a, b) => a + b, 0) : vals[0]) * f * scale;
    if (v < 0 || !isFinite(v)) continue;
    out[k] = Math.round(v * 1000) / 1000;
    if (!['sat', 'salt', 'na'].includes(k)) any = true;  // Pflichtangaben allein zählen nicht als „Mikros bekannt“
  }
  return Object.keys(out).length ? (any ? out : { ...out, partial: true }) : null;
}

/* ----- Formularfelder: eigene Lebensmittel (je 100 g) und Nahrungsergänzung (je Stück) ----- */
const SUPP_MAIN = ['vitD', 'b12', 'fol', 'fe', 'mg', 'zn', 'jod', 'ca', 'vitC', 'epa', 'b6', 'vitK'];
const micInput = (form, field, k) => {
  const [, label, u] = MICRO_MAP.get(k);
  const name = form.supp && k === 'fol' ? 'Folsäure' : label;
  return `<label class="row mic-in"><span>${name} (${u})</span><input class="inp kg" type="text" inputmode="decimal" autocomplete="off"
    data-field="${field}" data-k="m_${k}" value="${esc(form['m_' + k] || '')}" placeholder="–"></label>`;
};
// eigenes Lebensmittel: aufklappbar, alles freiwillig
function microFormHtml(form) {
  const filled = MICROS.some(([k]) => form['m_' + k]);
  return `<details class="mic-form"${filled ? ' open' : ''}><summary>Vitamine und Mineralstoffe pro 100 g <small class="hint">freiwillig</small></summary>
    <p class="hint nut-small">Nur eintragen, was auf der Packung steht – leere Felder gelten als unbekannt.</p>
    ${MICROS.map(([k]) => micInput(form, 'food-form', k)).join('')}</details>`;
}
// Formularwerte -> food.mic (factor: 1 bei je 100 g, 100 bei je Stück; Folsäure zählt laut DGE doppelt als Folat-Äquivalent)
function microFromForm(form, factor = 1) {
  const out = {};
  for (const [k] of MICROS) {
    const raw = String(form['m_' + k] || '').trim();
    if (!raw) continue;
    const v = parseNum(raw);
    if (v == null || v < 0) return { error: `Bitte bei „${MICRO_MAP.get(k)[1]}“ eine Zahl eintragen.` };
    out[k] = Math.round(v * factor * (form.supp && k === 'fol' ? 2 : 1) * 1000) / 1000;
  }
  return Object.keys(out).length ? out : null;
}
function microToForm(mic, factor = 1, supp = false) {
  const out = {};
  for (const [k] of MICROS) {
    if (!mic || mic[k] == null) continue;
    out['m_' + k] = fmtNum(Math.round(mic[k] / factor / (supp && k === 'fol' ? 2 : 1) * 1000) / 1000);
  }
  return out;
}

/* ----- Nahrungsergänzung: gespeichert wie ein eigenes Lebensmittel, Menge in Stück ----- */
let suppForm = null;
function suppFormFrom(f) {
  return { supp: true, key: f.key || null, name: f.name || '', brand: f.brand || '', code: f.code || null,
    ...microToForm(f.mic, 100, true) };
}
function renderSuppOwn() {
  if (!suppForm) suppForm = suppFormFrom({});
  const f = suppForm;
  const rest = MICROS.map(m => m[0]).filter(k => !SUPP_MAIN.includes(k));
  const restFilled = rest.some(k => f['m_' + k]);
  return `<div class="card food-form">
      <label class="lbl">Name<input class="inp" type="text" data-field="supp-form" data-k="name" autocomplete="off" value="${esc(f.name)}" placeholder="z. B. Vitamin D3 1000 I.E."></label>
      <label class="lbl">Marke <small class="hint">(freiwillig)</small><input class="inp" type="text" data-field="supp-form" data-k="brand" autocomplete="off" value="${esc(f.brand)}"></label>
      ${f.code ? `<p class="hint nut-small">Barcode ${esc(f.code)} – beim nächsten Scan erkennt die App das Präparat.</p>`
        : '<button class="btn" data-action="supp-scan">📷 Barcode scannen</button>'}
      <p class="food-sec">Gehalt je Stück <small>(Tablette, Kapsel, Messlöffel …)</small></p>
      <p class="hint nut-small">Steht auf der Packung meist als „pro Tagesdosis“ – dann durch die Zahl der Stück teilen. Vitamin D in I.E.:
        40 I.E. = 1 µg (1.000 I.E. = 25 µg).</p>
      ${SUPP_MAIN.map(k => micInput(f, 'supp-form', k)).join('')}
      <details class="mic-form"${restFilled ? ' open' : ''}><summary>Weitere Nährstoffe</summary>${rest.map(k => micInput(f, 'supp-form', k)).join('')}</details>
    </div>
    <button class="btn primary" data-action="supp-save">✔ Speichern</button>
    ${f.key && data.foods[f.key] ? '<button class="btn danger" data-action="supp-del">Präparat löschen</button>' : ''}
    <p class="hint nut-small">Die App rechnet die Werte nur mit – ob und wie viel du ergänzen solltest, klärst du am besten ärztlich.</p>`;
}
views.suppown = { title: () => suppForm && suppForm.key ? 'Präparat ändern' : 'Nahrungsergänzung', tab: 'nutrition',
  back: p => p.id || p.key ? ['foodamt', p] : ['foodadd', { date: p.date, meal: p.meal }], render: renderSuppOwn };

fields['supp-form'] = el => { suppForm[el.dataset.k] = el.value; };
actions['supp-new'] = () => { suppForm = suppFormFrom({ name: foodQuery.trim() }); go('suppown', { date: current.params.date, meal: current.params.meal }); };
actions['supp-edit'] = () => {
  const { f } = foodAmtFood(current.params);
  suppForm = suppFormFrom(f);
  go('suppown', current.params);
};
actions['supp-save'] = () => {
  const f = suppForm;
  if (!f.name.trim()) { alert('Bitte einen Namen eintragen.'); return; }
  const mic = microFromForm(f, 100);
  if (mic && mic.error) { alert(mic.error); return; }
  if (!mic) { alert('Bitte mindestens einen Nährstoff je Stück eintragen.'); return; }
  const old = f.key ? foodGet(f.key) : null;
  const food = { key: f.key || 'own:' + uid(), name: f.name.trim(), brand: f.brand.trim(), code: f.code, src: 'own', supp: true,
    per: [0, 0, 0, 0, null, null], portion: { label: '1 Stück', g: 1 }, mic };
  foodRemember(food, { fav: old ? !!old.fav : false });
  const p = current.params;
  const e = p.id && data.foodLog.find(x => x.id === p.id);
  if (e) Object.assign(e, { name: food.name, brand: food.brand, mic, supp: true });
  saveData();
  suppForm = null;
  foodAmt = null;
  toast('Gespeichert ✔');
  go('foodamt', e ? { date: p.date, id: e.id } : { date: p.date, meal: p.meal, key: food.key });
};
actions['supp-del'] = () => {
  const f = suppForm;
  if (!confirm(`„${f.name}“ aus deinen Präparaten löschen?\n\nBereits eingetragene Tage bleiben erhalten.`)) return;
  delete data.foods[f.key];
  saveData();
  suppForm = null;
  const p = current.params;
  go(p.id ? 'food' : 'foodadd', p.id ? { date: p.date } : { date: p.date, meal: p.meal });
};
actions['supp-scan'] = () => { foodScanTarget = suppByCode; foodScanStart(); };

// Barcode eines Präparats: schon gemerkt -> Menge; sonst Open Food Facts (Werte je Portion, sonst je 100 g × Portionsgröße)
async function suppByCode(code) {
  code = String(code).replace(/\D/g, '');
  if (!code) return;
  const known = Object.values(data.foods).find(x => x && x.code === code);
  if (known) { foodAmt = null; suppForm = null; go('foodamt', { date: current.params.date, meal: current.params.meal, key: known.key }); return; }
  toast('Präparat wird gesucht …');
  let j;
  try { j = await offFetch(`/api/v2/product/${code}.json?fields=${OFF_FIELDS}`); }
  catch (e) { alert('Keine Verbindung zu Open Food Facts. Zum Nachschlagen eines Barcodes braucht die App Internet.'); return; }
  const pr = j && j.product;
  const n = (pr && pr.nutriments) || {};
  const sq = parseFloat(pr && pr.serving_quantity);
  let mic = offMicro(n, '_serving');
  if (!mic && sq > 0 && sq < 100) mic = offMicro(n, '_100g', sq / 100);
  if (mic) delete mic.partial;
  const name = pr ? String(pr.product_name_de || pr.product_name || '').trim() : '';
  const brand = pr ? String(Array.isArray(pr.brands) ? pr.brands.join(',') : pr.brands || '').split(',')[0].trim() : '';
  suppForm = { ...suppFormFrom({ name: name || (suppForm && suppForm.name) || '', brand, code }),
    ...(mic ? microToForm(Object.fromEntries(Object.entries(mic).map(([k, v]) => [k, v * 100])), 100, false) : {}) };
  if (mic && mic.fol != null) suppForm.m_fol = fmtNum(Math.round(mic.fol * 1000) / 1000);  // Folsäure wie auf der Packung
  render();
  alert(mic ? 'Werte aus Open Food Facts übernommen. Bitte kurz mit der Packung vergleichen – die Angaben dort stammen von Freiwilligen.'
    : pr ? `„${name || 'Das Präparat'}“ ist in Open Food Facts ohne Nährstoffangaben je Portion. Bitte die Werte von der Packung abtragen.`
      : 'Dieses Präparat ist in Open Food Facts nicht eingetragen. Bitte die Werte von der Packung abtragen – beim nächsten Scan kennt die App es.');
}
