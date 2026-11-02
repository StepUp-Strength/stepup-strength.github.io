/* ---------- Zykluskalender (nur für Frauen, freiwillig) ----------
   data.mcal = { on, starts: ['JJJJ-MM-TT', …] (erster Tag der Periode), len: übliche Zykluslänge, period: Dauer der Periode }
   Eingetragen wird nur der Beginn der Periode – Zyklustag, Phasen und die nächste Periode rechnet die App aus.
   Genutzt für: Wassereinlagerungen vor/zu Beginn der Periode im Tempo-Check und gemessenen Bedarf ausblenden (nutrition.js).
   Trainingsanpassung je Phase folgt später. (Nicht verwechseln mit data.cycle = Trainingszyklus.) */

const MC_PHASES = {
  mens: { label: 'Periode', icon: '🩸', text: 'Die Tage der Blutung. Viele fühlen sich am Anfang schlapper, danach steigt die Energie wieder.' },
  foll: { label: 'Follikelphase', icon: '🌱', text: 'Erste Zyklushälfte nach der Periode: Östrogen steigt, oft gute Energie und Leistungsfähigkeit.' },
  ovu: { label: 'Eisprung (ca.)', icon: '✨', text: 'Etwa um diese Tage findet der Eisprung statt – rund 14 Tage vor der nächsten Periode.' },
  lut: { label: 'Lutealphase', icon: '🌙', text: 'Zweite Zyklushälfte: Progesteron steigt, die Körpertemperatur ist leicht erhöht. In den Tagen vor der Periode lagert der Körper oft Wasser ein.' },
  late: { label: 'Periode noch nicht eingetragen', icon: '⏳', text: 'Laut Ø-Zykluslänge wäre die Periode schon fällig – trag ihren Beginn ein, sobald sie da ist.' },
};

const mcCal = () => data.mcal || { on: false, starts: [], len: 28, period: 5 };
const mcAvailable = () => !!(data.profile && data.profile.sex === 'f');
const mcOn = () => mcAvailable() && mcCal().on;
const mcDiff = (a, b) => Math.round((Date.parse(b + 'T12:00:00') - Date.parse(a + 'T12:00:00')) / DAY);
const mcStarts = () => [...mcCal().starts].sort();

// Ø Zykluslänge aus den letzten (bis zu 6) eingetragenen Zyklen zwischen 18 und 45 Tagen, sonst die eingestellte
function mcLengths() {
  const s = mcStarts();
  const out = [];
  for (let i = 1; i < s.length; i++) { const d = mcDiff(s[i - 1], s[i]); if (d >= 18 && d <= 45) out.push(d); }
  return out;
}
function mcLength() {
  const l = mcLengths().slice(-6);
  return l.length ? Math.round(l.reduce((a, b) => a + b, 0) / l.length) : mcCal().len;
}

// Zyklustag und Phase eines Datums (null ohne Periode davor). Zukunft: Vorhersage aus der Ø-Länge (pred).
function mcInfo(date = todayISO()) {
  const s = mcStarts().filter(x => x <= date);
  if (!s.length) return null;
  const len = mcLength();
  let start = s[s.length - 1];
  let day = mcDiff(start, date) + 1;
  let pred = false;
  if (day > len && date > todayISO()) {
    // vorhergesagte Zyklen ab der letzten eingetragenen Periode
    const k = Math.floor((day - 1) / len);
    start = addDaysISO(start, k * len);
    day -= k * len;
    pred = true;
  }
  const ovu = len - 14;
  const phase = day <= mcCal().period ? 'mens' : day < ovu - 1 ? 'foll' : day <= ovu + 1 ? 'ovu' : day <= len ? 'lut' : 'late';
  return { start, day, len, phase, pred, next: addDaysISO(start, len) };
}

// Wassereinlagerung wahrscheinlich: die letzten 6 Tage vor der Periode, die ersten 2 Periodentage, überfällige Tage
function mcWater(date) {
  if (!mcOn()) return false;
  const i = mcInfo(date);
  return !!i && !i.pred && (i.day >= i.len - 5 || i.day <= 2);
}

// Karte im Ernährungs-Reiter
function mcCard() {
  if (!mcAvailable()) return '';
  if (!mcOn()) return '';
  const i = mcInfo();
  if (!i) {
    return `<div class="card mc-card"><p><b>🌸 Zykluskalender</b></p>
      <p class="hint nut-small">Trag den ersten Tag deiner letzten Periode ein – dann rechnet die App Zyklustag und Phasen aus.</p>
      <button class="btn" data-action="mc-open">📅 Kalender öffnen</button></div>`;
  }
  const ph = MC_PHASES[i.phase];
  const inDays = mcDiff(todayISO(), i.next);
  const water = mcWater(todayISO()) && nutHintsOn();
  return `<div class="card mc-card mc-${i.phase}">
      <p><b>${ph.icon} Zyklustag ${i.day} · ${ph.label}</b></p>
      <p class="hint nut-small">${i.phase === 'late' ? ph.text : `Nächste Periode ca. am ${fmtDate(i.next + 'T12:00:00')}${inDays > 0 ? ` (in ${inDays} Tag${inDays === 1 ? '' : 'en'})` : ''}.`}
        ${water ? '<br>💧 In diesen Tagen lagert der Körper oft 0,5–2 kg Wasser ein. Die App lässt deine Gewichtswerte von heute beim Tempo-Check und beim gemessenen Bedarf weg – das ist kein Fett.' : ''}</p>
      <div class="row"><button class="btn" data-action="mc-open">📅 Kalender</button>
        ${i.phase === 'mens' && i.day <= 1 ? '' : '<button class="btn" data-action="mc-today">🩸 Periode heute begonnen</button>'}</div>
    </div>`;
}

// Schalter (Optionen, nur bei Frauen)
function mcOptionsCard() {
  if (!mcAvailable()) return '';
  const on = mcCal().on;
  return `<div class="card">
      <h2>Zykluskalender</h2>
      <div class="seg two"><button class="${on ? 'on' : ''}" data-action="mc-onoff" data-v="1">An</button>
        <button class="${on ? '' : 'on'}" data-action="mc-onoff" data-v="0">Aus</button></div>
      <p class="hint nut-small">Freiwillig: Trägst du den Beginn deiner Periode ein, rechnet die App Zyklustag, Phasen und die nächste
        Periode aus. In den Tagen vor und zu Beginn der Periode lagert der Körper oft Wasser ein – diese Gewichtswerte lässt die App dann
        beim Tempo-Check und beim gemessenen Bedarf weg, damit die Kalorien-Empfehlungen nicht danebenliegen. Später soll sich auch das
        Training an den Zyklus anpassen. Alles bleibt nur auf diesem Gerät.</p>
      ${on ? '<button class="btn" data-action="mc-open">📅 Kalender öffnen</button>' : ''}
    </div>`;
}

/* ----- Kalender ----- */

let mcMonth = null;  // angezeigter Monat 'JJJJ-MM'

function renderMcal() {
  if (!mcMonth) mcMonth = todayISO().slice(0, 7);
  const [y, m] = mcMonth.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const lead = (first.getDay() + 6) % 7;  // Montag = 0
  const starts = new Set(mcCal().starts);
  const today = todayISO();
  let cells = '';
  for (let i = 0; i < lead; i++) cells += '<span></span>';
  for (let d = 1; d <= days; d++) {
    const iso = `${mcMonth}-${String(d).padStart(2, '0')}`;
    const i = mcInfo(iso);
    const cls = ['mc-day', i ? `mc-${i.phase}` : '', i && i.pred ? 'pred' : '', starts.has(iso) ? 'start' : '', iso === today ? 'today' : '', iso > today ? 'future' : ''].filter(Boolean).join(' ');
    cells += `<button class="${cls}" data-action="mc-day" data-d="${iso}">${d}</button>`;
  }
  const title = first.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const lens = mcLengths();
  const s = mcStarts();
  const cur = mcInfo();
  const list = s.slice().reverse().slice(0, 12).map((x, idx, arr) => {
    const next = s[s.indexOf(x) + 1];
    return `<li class="bw-row"><span>${fmtDate(x + 'T12:00:00')}<small class="hint">${next ? ` · Zyklus ${mcDiff(x, next)} Tage` : ' · aktueller Zyklus'}</small></span>
      <button class="icon-btn danger" data-action="mc-del" data-d="${x}" aria-label="Löschen">✕</button></li>`;
  }).join('');
  return `${cur ? `<div class="card mc-card mc-${cur.phase}"><p><b>${MC_PHASES[cur.phase].icon} Heute: Zyklustag ${cur.day} · ${MC_PHASES[cur.phase].label}</b></p>
      <p class="hint nut-small">${MC_PHASES[cur.phase].text}</p></div>` : ''}
    <div class="card mc-cal">
      <div class="mc-head"><button class="icon-btn" data-action="mc-month" data-d="-1" aria-label="Voriger Monat">‹</button>
        <b>${title}</b><button class="icon-btn" data-action="mc-month" data-d="1" aria-label="Nächster Monat">›</button></div>
      <div class="mc-grid mc-wd">${['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map(x => `<span>${x}</span>`).join('')}</div>
      <div class="mc-grid">${cells}</div>
      <div class="mc-legend"><span class="mc-mens">Periode</span><span class="mc-mens pred">erwartet</span><span class="mc-foll">Follikelphase</span>
        <span class="mc-ovu">Eisprung</span><span class="mc-lut">Lutealphase</span></div>
      <p class="hint nut-small">Tippe auf den <b>ersten Tag einer Periode</b>, um ihn einzutragen (nochmal tippen entfernt ihn). Die übrigen Tage
        rechnet die App aus.</p>
      <button class="btn primary" data-action="mc-today">🩸 Periode heute begonnen</button>
    </div>
    <div class="card">
      <h2>Einstellungen</h2>
      <div class="row"><span>Übliche Zykluslänge<br><small class="hint">${lens.length ? `Ø aus deinen Einträgen: ${mcLength()} Tage` : 'gilt, bis zwei Perioden eingetragen sind'}</small></span>
        <div class="stepper"><button data-action="mc-set" data-k="len" data-d="-1" aria-label="Kürzer">−</button><b>${mcCal().len}</b>
          <button data-action="mc-set" data-k="len" data-d="1" aria-label="Länger">+</button></div></div>
      <div class="row"><span>Dauer der Periode</span>
        <div class="stepper"><button data-action="mc-set" data-k="period" data-d="-1" aria-label="Kürzer">−</button><b>${mcCal().period}</b>
          <button data-action="mc-set" data-k="period" data-d="1" aria-label="Länger">+</button></div></div>
    </div>
    ${list ? `<h2>Eingetragene Perioden</h2><ul class="list mc-list">${list}</ul>` : ''}
    ${mcHelp()}`;
}

// Wassertage des laufenden Zyklus (für die Erklärung): letzte 6 Tage vor der nächsten Periode + die ersten 2 Periodentage
function mcWaterSpan() {
  const i = mcInfo();
  if (!i) return null;
  const from = addDaysISO(i.start, i.len - 6), to = addDaysISO(i.start, i.len - 1);
  return { from, to, p1: i.next, p2: addDaysISO(i.next, 1) };
}

// Ausführliche Erklärungen im Kalender
function mcHelp() {
  const none = !mcCal().starts.length;
  const w = mcWaterSpan();
  const d = x => fmtDate(x + 'T12:00:00');
  const len = mcLength();
  const ovu = len - 14;
  return `<details class="card nut-help mc-help" ${none ? 'open' : ''}><summary>So funktioniert der Kalender</summary>
      <p><b>Was du einträgst:</b> nur den <b>ersten Tag jeder Periode</b> – also den ersten Tag mit richtiger Blutung (leichte
        Schmierblutung davor zählt noch nicht). Entweder im Kalender auf den Tag tippen oder einfach am selben Tag auf
        „🩸 Periode heute begonnen“. Vergessen? Kein Problem, du kannst jeden vergangenen Tag nachtragen. Ein falscher Eintrag
        verschwindet, wenn du ihn noch einmal antippst oder in der Liste „Eingetragene Perioden“ auf ✕ tippst.</p>
      <p><b>Was die App daraus rechnet:</b> Den Abstand von einem Periodenbeginn zum nächsten nennt man <b>Zykluslänge</b>. Sobald zwei
        Perioden eingetragen sind, nimmt die App den Durchschnitt deiner letzten (bis zu sechs) Zyklen – bei dir gerade
        <b>${len} Tage</b>${mcLengths().length ? '' : ' (noch die eingestellte Länge, weil erst eine Periode eingetragen ist)'}.
        Zyklen unter 18 oder über 45 Tagen lässt sie dabei weg, weil das meist ein vergessener oder doppelter Eintrag ist.
        Daraus ergeben sich der <b>Zyklustag</b> (Tag 1 = erster Periodentag), die <b>Phase</b> und die <b>nächste Periode</b>.</p>
      <p><b>Die Farben:</b> Rot = Periode (eingetragen bzw. aus der eingestellten Dauer), rot umrandet = erwartete Periode, grün =
        Follikelphase, lila = Tage um den Eisprung, gelb = Lutealphase. Blasse Tage in der Zukunft sind eine Vorhersage. Der Tag mit dem
        dunklen Rand ist ein eingetragener Periodenbeginn, der blaue Rahmen ist heute.</p>
      <p><b>Einstellungen:</b> „Übliche Zykluslänge“ gilt nur, bis zwei Perioden eingetragen sind – danach rechnet die App mit deinem
        echten Durchschnitt. „Dauer der Periode“ bestimmt, wie viele Tage ab Beginn als Periode markiert werden.</p>
    </details>
    <details class="card nut-help mc-help"><summary>Die Phasen ausführlich</summary>
      <p><b>🩸 Periode (Tag 1 bis ${mcCal().period}):</b> Die Gebärmutterschleimhaut wird abgestoßen, die Hormone Östrogen und Progesteron
        sind niedrig. Viele fühlen sich an den ersten ein, zwei Tagen schlapper oder haben Krämpfe, danach kommt die Energie meist
        schnell zurück. Training ist in dieser Zeit grundsätzlich möglich – es gilt, was sich gut anfühlt.</p>
      <p><b>🌱 Follikelphase (nach der Periode bis kurz vor dem Eisprung, bei dir etwa Tag ${mcCal().period + 1}–${ovu - 2}):</b> Im
        Eierstock reift ein Eibläschen (Follikel) heran, das Östrogen steigt. Viele erleben das als die Zeit mit der meisten Energie,
        guter Stimmung und guter Erholung. Diese Phase ist von Frau zu Frau und von Monat zu Monat unterschiedlich lang.</p>
      <p><b>✨ Eisprung (etwa Tag ${ovu - 1}–${ovu + 1}):</b> Das Ei springt – meist rund 14 Tage <i>vor</i> der nächsten Periode, deshalb
        rechnet die App von der Zykluslänge aus rückwärts. Östrogen erreicht kurz davor seinen Höchstwert. Manche spüren um diese Tage
        ein leichtes Ziehen im Unterbauch.</p>
      <p><b>🌙 Lutealphase (nach dem Eisprung bis zur Periode, etwa Tag ${ovu + 2}–${len}):</b> Der Gelbkörper bildet Progesteron, die
        Körpertemperatur steigt leicht (etwa 0,3–0,5 °C) und der Grundumsatz ein wenig. Viele haben etwas mehr Hunger, Lust auf
        Süßes und in den letzten Tagen vor der Periode PMS-Beschwerden wie Spannungsgefühl, Gereiztheit oder Müdigkeit. Typisch ist
        außerdem, dass der Körper <b>Wasser einlagert</b> – oft 0,5 bis 2 kg, die sich nach Beginn der Periode wieder verabschieden.</p>
      <p>Alle Tage außer dem eingetragenen Periodenbeginn sind <b>Schätzungen</b>. Der echte Eisprung kann ein paar Tage früher oder
        später liegen, besonders bei unregelmäßigem Zyklus.</p>
    </details>
    <details class="card nut-help mc-help"><summary>Welchen Einfluss hat der Kalender auf die App?</summary>
      <p><b>💧 Körpergewicht – Tempo-Check und gemessener Bedarf:</b> Diese beiden Funktionen im Ernährungs-Reiter lesen aus deinem
        Gewichtsverlauf, ob dein Tagesziel passt. Die Wassereinlagerung vor der Periode sieht auf der Waage aber genauso aus wie
        zugenommenes Fett. Ohne Kalender würde die App dann denken, du nimmst zu langsam ab (oder zu schnell zu), und dir vorschlagen,
        weniger zu essen – und nach der Periode, wenn das Wasser weg ist, wieder mehr. Das Tagesziel würde jeden Monat hin und her springen.</p>
      <p>Deshalb lässt die App die Gewichtswerte an den <b>letzten 6 Tagen vor der Periode</b> und an den <b>ersten 2 Periodentagen</b>
        weg${w ? ` – in deinem aktuellen Zyklus also voraussichtlich vom <b>${d(w.from)} bis ${d(w.to)}</b> sowie am <b>${d(w.p1)} und
        ${d(w.p2)}</b>` : ''}. Kommt die Periode später als erwartet, zählen auch die Tage bis zu ihrem Beginn dazu. Du wiegst dich
        trotzdem ganz normal und trägst die Werte ein: Sie bleiben im Diagramm und in der Liste sichtbar und zählen auch für dein
        aktuelles Gewicht – nur die beiden Auswertungen überspringen sie. An diesen Tagen erklärt ein 💧-Hinweis auf der
        Zyklus-Karte, was los ist (nicht, wenn „Hinweise zur Ernährung“ ausgeschaltet sind – herausgerechnet wird trotzdem).</p>
      <p><b>Was sich nicht ändert:</b> Dein Tagesziel, die Makros und die Eiweiß-Empfehlung rechnet die App unabhängig vom Zyklus.
        Etwas mehr Hunger in der Lutealphase ist normal – über die Woche gesehen gleicht sich das meist aus. Das Ernährungstagebuch,
        das Abschließen der Tage und alle anderen Funktionen laufen ganz normal.</p>
      <p><b>🏋️ Training:</b> Im Moment ändert der Kalender am Training noch <b>nichts</b>. Geplant ist, dass sich das Training später an
        die Phasen anpasst – zum Beispiel, wann schwer trainiert wird und wann etwas leichter. Bis dahin gilt dein Plan wie gewohnt.</p>
      <p><b>Ausschalten:</b> Schaltest du den Kalender in den Optionen aus, rechnet die App wieder mit allen Gewichtswerten und die
        Zyklus-Karte verschwindet. Deine eingetragenen Perioden bleiben gespeichert – schaltest du ihn wieder ein, ist alles noch da.</p>
    </details>
    <details class="card nut-help mc-help"><summary>Gut zu wissen</summary>
      <p><b>Unregelmäßiger Zyklus:</b> Schwankt deine Zykluslänge stark, sind Vorhersage und Phasen ungenauer. Trag den Beginn trotzdem
        jedes Mal ein – die App rechnet immer vom zuletzt eingetragenen Tag aus, die Wassertage vor der Periode passen also spätestens
        im Nachhinein. Stark wechselnde oder sehr lange Zyklen sind ein Grund, das einmal ärztlich abklären zu lassen.</p>
      <p><b>Pille, Hormonspirale oder andere hormonelle Verhütung:</b> Dann gibt es keinen natürlichen Zyklus mit Eisprung – die Blutung
        in der Pillenpause ist eine Abbruchblutung. Du kannst ihren Beginn trotzdem eintragen; die Phasen sind dann aber nur eine grobe
        Orientierung, und Wassereinlagerungen sind oft schwächer. Wenn du gar keine Blutung hast, lässt du den Kalender am besten aus.</p>
      <p><b>Wechseljahre, Schwangerschaft, Stillzeit:</b> In den Wechseljahren wird der Zyklus oft unregelmäßig, in Schwangerschaft und
        Stillzeit gibt es keinen normalen Zyklus – dann ist der Kalender wenig hilfreich und kann ausgeschaltet bleiben.</p>
      <p><b>Keine Verhütung:</b> Der Kalender schätzt nur – zur Verhütung oder zur Planung einer Schwangerschaft ist er nicht geeignet.
        Dafür gibt es spezielle Apps und Methoden, bei denen z. B. die Temperatur gemessen wird.</p>
      <p><b>Datenschutz:</b> Deine Einträge bleiben nur auf diesem Gerät und sind in deiner Sicherung enthalten. Die App schickt sie
        nirgendwohin.</p>
    </details>`;
}

views.mcal = { title: 'Zykluskalender', tab: 'nutrition', back: 'nutrition', render: renderMcal };

function mcEnsure() {
  if (!data.mcal) data.mcal = { on: true, starts: [], len: 28, period: 5 };
  return data.mcal;
}

Object.assign(actions, {
  'mc-open': () => { mcMonth = null; go('mcal'); },
  'mc-onoff': el => {
    const c = mcEnsure();
    c.on = el.dataset.v === '1';
    saveData();
    if (c.on && !c.starts.length) { mcMonth = null; go('mcal'); toast('Trag den ersten Tag deiner letzten Periode ein'); }
    else render();
  },
  'mc-month': el => {
    const [y, m] = mcMonth.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.d), 1);
    mcMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    render();
  },
  'mc-day': el => {
    const d = el.dataset.d, c = mcEnsure();
    if (c.starts.includes(d)) {
      if (!confirm(`Periodenbeginn am ${fmtDate(d + 'T12:00:00')} entfernen?`)) return;
      c.starts = c.starts.filter(x => x !== d);
    } else {
      if (d > todayISO()) { toast('Nur heute oder vergangene Tage eintragen'); return; }
      // innerhalb einer schon eingetragenen Periode: kein neuer Beginn
      const near = c.starts.find(x => x < d && mcDiff(x, d) < Math.max(c.period, 10));
      if (!confirm(`Periode am ${fmtDate(d + 'T12:00:00')} begonnen?${near ? `\n\nAchtung: Am ${fmtDate(near + 'T12:00:00')} ist schon ein Beginn eingetragen.` : ''}`)) return;
      c.starts.push(d);
    }
    c.starts.sort();
    saveData();
    render();
  },
  'mc-today': () => {
    const c = mcEnsure(), d = todayISO();
    if (c.starts.includes(d)) { toast('Ist schon eingetragen'); return; }
    c.starts.push(d);
    c.starts.sort();
    saveData();
    toast('Periodenbeginn eingetragen 🩸');
    render();
  },
  'mc-del': el => {
    const c = mcEnsure();
    if (!confirm(`Periodenbeginn am ${fmtDate(el.dataset.d + 'T12:00:00')} löschen?`)) return;
    c.starts = c.starts.filter(x => x !== el.dataset.d);
    saveData();
    render();
  },
  'mc-set': el => {
    const c = mcEnsure(), k = el.dataset.k;
    const [lo, hi] = k === 'len' ? [21, 40] : [2, 10];
    c[k] = Math.max(lo, Math.min(hi, c[k] + Number(el.dataset.d)));
    saveData();
    render();
  },
});
