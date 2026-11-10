/* StepUp Strength · © 2026 Alex Hundt · Alle Rechte vorbehalten – siehe LICENSE */
/* ---------- Zykluskalender (nur für Frauen, freiwillig) ----------
   data.mcal = { on, starts: ['JJJJ-MM-TT', …] (erster Tag der Periode), len: übliche Zykluslänge, period: Dauer der Periode }
   Eingetragen wird nur der Beginn der Periode – Zyklustag, Phasen und die nächste Periode rechnet die App aus.
   Genutzt für: Wassereinlagerungen vor/zu Beginn der Periode im Gewichtsverlauf und gemessenen Bedarf ausblenden (nutrition.js)
   und „Zyklus und Training“ (unten, v191). (Nicht verwechseln mit data.cycle = Trainingszyklus.) */

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
        ${water ? '<br>💧 In diesen Tagen lagert der Körper oft 0,5–2 kg Wasser ein. Die App lässt deine Gewichtswerte von heute beim Gewichtsverlauf und beim gemessenen Bedarf weg – das ist kein Fett.' : ''}</p>
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
        beim Gewichtsverlauf und beim gemessenen Bedarf weg, damit die Kalorien-Empfehlungen nicht danebenliegen. Auf Wunsch passt sie auch
        dein Training an die Tage an, an denen du dich schwächer fühlst. Alles bleibt nur auf diesem Gerät.</p>
      ${on ? `<button class="btn" data-action="mc-open">📅 Kalender öffnen</button>${mcTrainEntryHtml()}` : ''}
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
    ${mcLearnCard()}${mcTrainEntryHtml()}
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
      <p><b>💧 Körpergewicht – Gewichtsverlauf und gemessener Bedarf:</b> Diese beiden Funktionen im Ernährungs-Reiter lesen aus deinem
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
      <p><b>🏋️ Training:</b> Nur wenn du es unter „Zyklus und Training“ einstellst: An den Tagen, an denen du dich laut deiner Angabe
        schwächer fühlst, fragt die App vor dem Training kurz nach und macht die Vorgaben etwas leichter. Ein starrer Plan nach Phasen ist
        das nicht – die App richtet sich nach dir und lernt aus deinen Werten. Ohne Einstellung bleibt dein Training wie geplant.</p>
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

/* ---------- Zyklus und Training (v191, Regeln vom User 2026-11-09) ----------
   Kein starrer Phasenplan: Die Frau gibt einmal an, ob und wann sie sich im Training schwächer fühlt (Zeitfenster und Stufe),
   die App fragt an diesen Tagen vor dem Training nach und lernt aus den echten Leistungen.
   data.mcal.train = { asked, answer: 'yes'|'no'|'unknown', win: { pre, mens, ovu } (Stufe 0–3), hormonal, dismissed: { win: Anzahl } }
   Stufen (User): 1 = −1 Wdh., 2 = −2 Wdh., 3 = −2 Wdh. und 1 Satz weniger bei Übungen mit mind. 3 Sätzen.
   An diesen Tagen sinkt „Max. bei 10 Wdh.“ nicht, und das Training zählt für die Folgewoche wie ein normaler Tag (app.js).
   Lernen: Leistung = frisches Max aus dem besten Satz (Gewicht, Wdh., Tank) ÷ Max laut Plan; im Fenster gegen außerhalb,
   ab 2 Zyklen mit mind. 3 Trainings im Fenster → Vorschlag (nie automatisch). */
const MC_LEVELS = {
  0: { label: 'Fit wie immer', short: 'normal', reps: 0, sets: 0, text: 'Normale Vorgaben.' },
  1: { label: 'Etwas schwächer', short: 'etwas schwächer', reps: 1, sets: 0, text: '1 Wdh. weniger pro Satz.' },
  2: { label: 'Spürbar schwächer', short: 'spürbar schwächer', reps: 2, sets: 0, text: '2 Wdh. weniger pro Satz.' },
  3: { label: 'Stark eingeschränkt', short: 'stark eingeschränkt', reps: 2, sets: 1, text: '2 Wdh. weniger und bei Übungen mit 3 oder mehr Sätzen 1 Satz weniger.' },
};
const MC_WINDOWS = {
  pre: { label: 'Tage vor der Periode', icon: '🌙', text: 'die letzten 5 Tage vor der erwarteten Periode (oft PMS)' },
  mens: { label: 'Erste Periodentage', icon: '🩸', text: 'die ersten 2 Tage der Periode' },
  ovu: { label: 'Um den Eisprung', icon: '✨', text: 'der errechnete Eisprung und je 1 Tag davor und danach' },
};
const MC_LEARN_CYCLES = 2, MC_LEARN_MIN = 3;  // ab 2 Zyklen und 3 Trainings im Zeitfenster

const mcTrain = () => (data.mcal && data.mcal.train) || null;
const mcTrainEnsure = () => { const c = mcEnsure(); if (!c.train) c.train = { asked: false, answer: null, win: { pre: 0, mens: 0, ovu: 0 }, hormonal: false, dismissed: {} }; return c.train; };

// Zeitfenster eines Tages (nur im laufenden, eingetragenen Zyklus – keine Vorhersage)
function mcWindow(date = todayISO()) {
  if (!mcOn()) return null;
  const i = mcInfo(date);
  if (!i || i.pred) return null;
  const t = mcTrain();
  if (i.phase === 'mens' && i.day <= 2) return 'mens';
  if (i.day >= i.len - 4) return 'pre';  // auch überfällige Tage
  if (!(t && t.hormonal) && Math.abs(i.day - (i.len - 14)) <= 1) return 'ovu';
  return null;
}

// Vor dem Training fragen? Nur in einem Zeitfenster mit Stufe > 0 – oder wenn sie „weiß ich nicht“ angegeben hat
function mcCheckNeeded() {
  const t = mcTrain(), w = mcWindow();
  if (!w || !t || !t.asked) return null;
  return (t.win[w] || 0) > 0 || t.answer === 'unknown' ? w : null;
}

// Zeitfenster für dieses Training ohne Nachfrage (Stufe 0) – damit die App auch ohne Anpassung lernen kann
function mcAutoTag() {
  const w = mcWindow(), i = mcInfo();
  return w && i ? { win: w, lvl: 0, pen: 0, cut: 0, cs: i.start, day: i.day } : null;
}

// Frage vor dem Training (view mccheck)
function renderMcCheck({ id, win }) {
  const t = mcTrain(), lvl = t.win[win] || 0, i = mcInfo();
  const opt = l => `<button class="split-opt freq-opt ${l === lvl ? 'on' : ''}" data-action="mc-check" data-l="${l}">
      <b>${MC_LEVELS[l].label}${l === lvl && lvl ? ' (wie angegeben)' : ''}</b><small>${MC_LEVELS[l].text}</small></button>`;
  return `<div class="card wiz-q">
      <p class="sub">${esc(findDay(id).name)}</p>
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🌸</span><h2>Zyklustag ${i.day} · ${MC_WINDOWS[win].label}</h2></div>
      <p class="hint wiz-q-explain">${lvl ? `In diesen Tagen fühlst du dich laut deinen Angaben oft <b>${MC_LEVELS[lvl].short}</b>.`
        : 'Manche Frauen fühlen sich in diesen Tagen schwächer, andere merken nichts.'} Wie geht's dir heute? Die App passt die Vorgaben nur
        für dieses Training an – dein „Max“ und die Steigerung der nächsten Woche bleiben davon unberührt.</p>
      ${[0, 1, 2, 3].map(opt).join('')}
    </div>`;
}

// Einstellung (view mctrain): Fragebogen + ausführliche Erklärung
function renderMcTrain() {
  const t = mcTrainEnsure();
  const ans = (k, label) => `<button class="${t.answer === k ? 'on' : ''}" data-action="mct-answer" data-k="${k}">${label}</button>`;
  const winRow = w => `<div class="mct-win"><p><b>${MC_WINDOWS[w].icon} ${MC_WINDOWS[w].label}</b><small class="hint"> – ${MC_WINDOWS[w].text}</small></p>
      <div class="seg mct-seg">${[0, 1, 2, 3].map(l => `<button class="${(t.win[w] || 0) === l ? 'on' : ''}" data-action="mct-level" data-w="${w}" data-l="${l}">${['keine', 'etwas', 'spürbar', 'stark'][l]}</button>`).join('')}</div></div>`;
  return `<div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🏋️</span><h2>Zyklus und Training</h2></div>
      <p class="hint wiz-q-explain">Freiwillig: Erzähl der App, ob dein Zyklus dein Training spürbar beeinflusst. Dann macht sie die Vorgaben an
        diesen Tagen etwas leichter – und lernt mit der Zeit aus deinen echten Werten, ob und wie stark du dort wirklich schwächer bist.</p>
      <p class="lbl">Gibt es Tage in deinem Zyklus, an denen du dich im Training deutlich schwächer fühlst?</p>
      <div class="seg three">${ans('yes', 'Ja')}${ans('no', 'Nein')}${ans('unknown', 'Weiß nicht')}</div>
      ${t.answer === 'yes' ? `<p class="lbl">Wann – und wie stark?</p>${['pre', 'mens', 'ovu'].filter(w => w !== 'ovu' || !t.hormonal).map(winRow).join('')}
        <p class="hint nut-small"><b>Etwas</b> = 1 Wdh. weniger pro Satz · <b>spürbar</b> = 2 Wdh. weniger · <b>stark</b> = 2 Wdh. weniger und
          bei Übungen mit 3 oder mehr Sätzen 1 Satz weniger.</p>` : ''}
      ${t.answer === 'unknown' ? '<p class="hint nut-small">Kein Problem: An den typischen Tagen fragt die App kurz vor dem Training, wie es dir geht. So findest du es zusammen mit der App heraus.</p>' : ''}
      ${t.answer === 'no' ? '<p class="hint nut-small">Dann bleibt dein Training wie geplant. Die App schaut trotzdem im Hintergrund auf deine Werte und sagt dir Bescheid, falls sich doch ein Muster zeigt.</p>' : ''}
      <p class="lbl">Nimmst du hormonelle Verhütung (Pille, Hormonspirale, Implantat …)?</p>
      <div class="seg two"><button class="${t.hormonal ? 'on' : ''}" data-action="mct-horm" data-v="1">Ja</button>
        <button class="${t.hormonal ? '' : 'on'}" data-action="mct-horm" data-v="0">Nein</button></div>
      ${t.hormonal ? '<p class="hint nut-small">Dann gibt es keinen natürlichen Eisprung – die App fragt nur nach den Tagen vor und zu Beginn der Blutung.</p>' : ''}
      <button class="btn primary" data-action="mct-save" ${t.answer ? '' : 'disabled'}>Speichern</button>
    </div>
    ${mcLearnCard(true)}
    ${mcTrainHelp()}`;
}

// Ausführliche Erklärung
function mcTrainHelp() {
  return `<details class="card nut-help mc-help" open><summary>So funktioniert „Zyklus und Training“</summary>
      <p><b>Warum kein fester Phasenplan?</b> Oft liest man, Frauen sollten in der ersten Zyklushälfte schwer und in der zweiten leicht
        trainieren. Die Forschung stützt das bisher kaum: Im Schnitt sind die Unterschiede zwischen den Phasen klein – und vor allem
        <b>von Frau zu Frau sehr verschieden</b>. Manche merken gar nichts, manche sind an zwei Tagen deutlich schwächer, bei manchen ist es
        jeden Monat anders. Ein starrer Plan würde viele Frauen unnötig bremsen. Deshalb richtet sich die App nach <b>dir</b>.</p>
      <p><b>1. Deine Angabe als Startpunkt.</b> Du sagst, in welchen Tagen du dich schwächer fühlst und wie stark. Die App kennt drei
        Zeitfenster: die <b>5 Tage vor der Periode</b> (hier haben viele PMS-Beschwerden), die <b>ersten 2 Periodentage</b> und die Tage
        <b>um den Eisprung</b>. Welche Tage das gerade sind, rechnet sie aus deinem Kalender aus.</p>
      <p><b>2. An diesen Tagen fragt sie kurz nach.</b> Vor dem Training kommt die Frage „Wie geht's dir heute?“ – vorausgewählt ist deine
        Angabe, du kannst aber jedes Mal anders antworten. Je nach Antwort werden die Vorgaben leichter:</p>
      <ul class="about-list"><li><b>Etwas schwächer:</b> 1 Wiederholung weniger pro Satz</li>
        <li><b>Spürbar schwächer:</b> 2 Wiederholungen weniger pro Satz</li>
        <li><b>Stark eingeschränkt:</b> 2 Wiederholungen weniger und bei Übungen mit 3 oder mehr Sätzen 1 Satz weniger – leichter, aber nicht
          so stark gekürzt, dass sich das Training nicht mehr lohnt</li></ul>
      <p>Wäre ein Satz dadurch zu kurz, nimmt die App stattdessen etwas weniger Gewicht.</p>
      <p><b>3. Ein schwacher Tag wirft dich nicht zurück.</b> An diesen Tagen kann dein „Max. bei 10 Wdh.“ steigen, aber nicht sinken. Und
        das Training zählt für die Vorgaben der nächsten Woche so, als wäre es ein normaler Tag gewesen – die Woche nach der Periode wird
        also nicht unnötig leicht.</p>
      <p><b>4. Die App lernt mit.</b> Sie vergleicht, was du in jedem Zeitfenster tatsächlich schaffst, mit deiner Leistung an den übrigen
        Tagen – unabhängig davon, wie leicht die Vorgabe war, denn sie rechnet mit Gewicht, Wiederholungen und dem, was noch im Tank war.
        Nach <b>${MC_LEARN_CYCLES} Zyklen</b> mit mindestens <b>${MC_LEARN_MIN} Trainings</b> in einem Zeitfenster sagt sie dir, was sie sieht,
        zum Beispiel: „In den Tagen vor deiner Periode schaffst du im Schnitt 5 % weniger.“ Passt das nicht zu deiner Einstellung, schlägt
        sie eine andere Stufe vor – geändert wird aber nur, wenn du zustimmst.</p>
      <p><b>Hormonelle Verhütung:</b> Mit Pille, Hormonspirale oder Implantat gibt es keinen natürlichen Eisprung; die Blutung in der Pause ist
        eine Abbruchblutung. Viele haben dann weniger Schwankungen – die Tage vor und zu Beginn der Blutung können trotzdem anstrengender sein,
        deshalb fragt die App nur nach diesen.</p>
      <p><b>Unregelmäßiger Zyklus:</b> Die Tage vor der Periode schätzt die App aus deiner Ø-Zykluslänge. Kommt die Periode später, gelten auch
        die überfälligen Tage als „vor der Periode“. Trag den Beginn jedes Mal ein, dann stimmt es im nächsten Zyklus wieder.</p>
      <p><b>Wichtig:</b> Starke Schmerzen, sehr starke Blutungen oder Beschwerden, die dich jeden Monat ausbremsen, sind nicht „normal“ –
        lass das ärztlich abklären. Und an Tagen, an denen gar nichts geht, ist eine Pause völlig in Ordnung.</p>
      <p><b>Datenschutz:</b> Alles bleibt nur auf deinem Gerät.</p>
    </details>`;
}

// Leistung eines Trainings: Ø über die Übungen von (frisches Max aus dem besten Satz) ÷ (Max laut Plan)
function mcSessionPerf(s) {
  const r = [];
  s.entries.forEach((e, ei) => {
    const m = e.target && e.target.max10;
    if (!(m > 0)) return;
    const fat = typeof sessionFat === 'function' ? sessionFat(s, ei) : 0;
    const v = e.sets.filter(x => x.weight > 0 && x.reps > 0 && !x.open && !x.variant)
      .map(x => x.weight / repFactor(x.reps + (x.rir != null ? x.rir : 0)) / (1 - fat));
    if (v.length) r.push(Math.max(...v) / m);
  });
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
}

// Gelerntes je Zeitfenster: { n, cycles, deficit (Anteil), level (vorgeschlagene Stufe) } – nur Trainings seit dem 1. Periodeneintrag
function mcLearn() {
  if (!mcOn()) return {};
  const first = mcStarts()[0];
  if (!first) return {};
  const inW = {}, out = [];
  for (const s of data.sessions) {
    if (s.deload || !s.cycleStart || s.date.slice(0, 10) < first) continue;
    const p = mcSessionPerf(s);
    if (p == null) continue;
    const w = s.mc ? s.mc.win : null;
    if (w) (inW[w] = inW[w] || []).push({ p, cs: s.mc.cs });
    else out.push(p);
  }
  if (out.length < MC_LEARN_MIN) return {};
  const base = out.reduce((a, b) => a + b, 0) / out.length;
  const res = {};
  for (const [w, L] of Object.entries(inW)) {
    const cycles = new Set(L.map(x => x.cs)).size;
    const mean = L.reduce((a, x) => a + x.p, 0) / L.length;
    const deficit = 1 - mean / base;
    const level = deficit < 0.02 ? 0 : deficit < 0.05 ? 1 : deficit < 0.09 ? 2 : 3;
    res[w] = { n: L.length, cycles, deficit, level, ready: cycles >= MC_LEARN_CYCLES && L.length >= MC_LEARN_MIN };
  }
  return res;
}

// Vorschlag: gelernte Stufe weicht von der eingestellten ab (nicht erneut, solange nicht mind. 3 neue Trainings dazukamen)
function mcSuggestion() {
  const t = mcTrain();
  if (!t || !t.asked) return null;
  const L = mcLearn();
  for (const w of ['pre', 'mens', 'ovu']) {
    const x = L[w];
    if (!x || !x.ready || x.level === (t.win[w] || 0)) continue;
    if ((t.dismissed || {})[w] != null && x.n < t.dismissed[w] + MC_LEARN_MIN) continue;
    return { w, ...x, cur: t.win[w] || 0 };
  }
  return null;
}

// Karte „Was die App gelernt hat“ (Einstellung) bzw. Vorschlag (Startseite, Kalender)
function mcLearnCard(full = false) {
  const t = mcTrain();
  if (!mcOn() || !t || !t.asked) return '';
  const sg = mcSuggestion();
  const pct = d => `${fmtNum(Math.round(Math.abs(d) * 1000) / 10)} %`;
  const sugHtml = sg ? `<div class="card mc-card mct-sugg"><p><b>🌸 Dein Zyklus und dein Training</b></p>
      <p class="hint nut-small">${MC_WINDOWS[sg.w].icon} <b>${MC_WINDOWS[sg.w].label}:</b> In ${sg.n} Trainings aus ${sg.cycles} Zyklen hast du
        dort im Schnitt ${sg.deficit >= 0.02 ? `<b>${pct(sg.deficit)} weniger</b> geschafft als an anderen Tagen` : '<b>genauso viel</b> geschafft wie an anderen Tagen'}.
        ${sg.level > sg.cur ? `Sollen die Vorgaben dort <b>${MC_LEVELS[sg.level].short}</b> angepasst werden?`
          : sg.level === 0 ? 'Sollen die Vorgaben dort wieder <b>normal</b> sein?' : `Soll die Anpassung dort auf <b>${MC_LEVELS[sg.level].short}</b> sinken?`}
        (bisher: ${MC_LEVELS[sg.cur].short})</p>
      <div class="row"><button class="btn primary" data-action="mct-accept" data-w="${sg.w}" data-l="${sg.level}">Ja, anpassen</button>
        <button class="btn" data-action="mct-dismiss" data-w="${sg.w}" data-n="${sg.n}">So lassen</button></div></div>` : '';
  if (!full) return sugHtml;
  const L = mcLearn();
  const rows = ['pre', 'mens', 'ovu'].filter(w => L[w]).map(w => `<li><span>${MC_WINDOWS[w].icon} ${MC_WINDOWS[w].label}</span>
      <b>${L[w].deficit >= 0.005 ? '−' : L[w].deficit <= -0.005 ? '+' : '±'}${pct(L[w].deficit)}</b><small class="hint"> ${L[w].n} Trainings, ${L[w].cycles} Zyklus${L[w].cycles === 1 ? '' : 'e'}</small></li>`).join('');
  return sugHtml + `<div class="card"><h2>Was die App bisher gelernt hat</h2>${rows
    ? `<ul class="review-list">${rows}</ul><p class="hint nut-small">Leistung in diesem Zeitfenster im Vergleich zu deinen übrigen Trainings
        (aus Gewicht, Wdh. und Tank, unabhängig von der Vorgabe). Ein Vorschlag kommt ab ${MC_LEARN_CYCLES} Zyklen mit mindestens ${MC_LEARN_MIN} Trainings im Zeitfenster.</p>`
    : '<p class="hint nut-small">Noch keine Daten – sobald du an den Tagen trainierst, sammelt die App Werte.</p>'}</div>`;
}

// Kurzer Hinweis im Kalender / in den Optionen
function mcTrainEntryHtml() {
  if (!mcOn()) return '';
  const t = mcTrain();
  const sum = !t || !t.asked ? 'Noch nicht eingestellt – erzähl der App, ob dein Zyklus dein Training beeinflusst.'
    : t.answer === 'no' ? 'Keine Anpassung – die App schaut im Hintergrund auf deine Werte.'
    : t.answer === 'unknown' ? 'Die App fragt an den typischen Tagen nach, wie es dir geht.'
    : ['pre', 'mens', 'ovu'].filter(w => t.win[w]).map(w => `${MC_WINDOWS[w].label}: ${MC_LEVELS[t.win[w]].short}`).join(' · ') || 'Keine Anpassung eingestellt.';
  return `<button class="btn nav" data-action="mct-open">🏋️ Zyklus und Training<small>${sum}</small></button>`;
}

views.mccheck = { title: 'Vor dem Training', tab: 'start', render: p => renderMcCheck(p), cancel: () => CANCEL_START };
views.mctrain = { title: 'Zyklus und Training', tab: 'nutrition', back: 'mcal', render: renderMcTrain };

Object.assign(actions, {
  'mct-open': () => go('mctrain'),
  'mct-answer': el => { const t = mcTrainEnsure(); t.answer = el.dataset.k; if (t.answer !== 'yes') t.win = { pre: 0, mens: 0, ovu: 0 }; render(); },
  'mct-level': el => { const t = mcTrainEnsure(); t.win[el.dataset.w] = Number(el.dataset.l); render(); },
  'mct-horm': el => { const t = mcTrainEnsure(); t.hormonal = el.dataset.v === '1'; if (t.hormonal) t.win.ovu = 0; render(); },
  'mct-save': () => { const t = mcTrainEnsure(); t.asked = true; saveData(); toast('Gespeichert ✔'); go('mcal'); },
  'mct-accept': el => { const t = mcTrainEnsure(); t.win[el.dataset.w] = Number(el.dataset.l); if (t.answer !== 'yes' && Number(el.dataset.l) > 0) t.answer = 'yes'; delete t.dismissed[el.dataset.w]; saveData(); toast('Angepasst ✔'); render(); },
  'mct-dismiss': el => { const t = mcTrainEnsure(); t.dismissed[el.dataset.w] = Number(el.dataset.n); saveData(); render(); },
  'mc-check': el => {
    const { id, readiness, win } = current.params;
    const lvl = Number(el.dataset.l), i = mcInfo();
    startDay(id, { ...readiness, mc: { win, lvl, pen: MC_LEVELS[lvl].reps, cut: MC_LEVELS[lvl].sets, cs: i ? i.start : null, day: i ? i.day : null } });
  },
});
