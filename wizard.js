'use strict';

/* ---------- Plan-Assistent: neuen Plan aus Trainingstagen, Schwerpunkten, Volumen und RIR erstellen ---------- */

// Ablauf (eine Entscheidung pro Bildschirm): level (Erfahrung) → sessions (Trainings pro Woche) → split (passende Vorlage oder eigene
// Aufteilung) → freq (Abwechslung oder Wiederholung, nur bei Vorlagen mit Paaren) → days (Trainingstage) → basics
// (Name, Zykluslänge) → start → prog (Progression) → prio → low → volume → rir → auto → (manual: Übungen je
// Muskelgruppe) → preview. Bei „Eigene Aufteilung“: sessions → split → days → freq → basics …
// Der fertige Plan kommt als zusätzlicher Plan in data.plans und wird aktiv.

const KIND_ORDER = { compound: 0, normal: 1, assist: 2 };
const KIND_SHORT = { compound: 'Grundübung', normal: 'normale Übung', assist: 'Assistenzübung' };
const PLAN_GROUPS = Object.keys(MUSCLES).filter(g => g !== 'ausdauer' && g !== 'ganzkoerper');
const MAX_FOCUS = 2;       // höchstens 2 Muskelgruppen priorisieren bzw. „low“
const FOCUS_SETS = 2;      // ± Sätze pro Woche

// Muskelgruppen für die Vorlagen
const G_UPPER = ['brust', 'lat', 'trapez', 'schulter_seite', 'schulter_hinten', 'bizeps', 'trizeps'];
const G_LOWER = ['quadrizeps', 'beinbeuger', 'waden', 'bauch', 'adduktoren', 'abduktoren'];
const G_FULL = ['brust', 'lat', 'schulter_seite', 'bizeps', 'trizeps', 'quadrizeps', 'beinbeuger', 'bauch'];
const G_PUSH = ['brust', 'schulter_vorne', 'schulter_seite', 'trizeps'];
const G_PULL = ['lat', 'trapez', 'schulter_hinten', 'bizeps'];
const G_FB_PUSH = ['brust', 'schulter_vorne', 'schulter_seite', 'trizeps', 'quadrizeps', 'waden'];
const G_FB_PULL = ['lat', 'trapez', 'schulter_hinten', 'bizeps', 'beinbeuger', 'bauch'];
const G_CHEST_BACK = ['brust', 'lat', 'trapez'];
const G_SHOULDER_ARMS = ['schulter_vorne', 'schulter_seite', 'schulter_hinten', 'bizeps', 'trizeps'];
// Torso/Limbs: Rumpf (Brust, Rücken, Schultern, Bauch) bzw. Gliedmaßen (Beine und Arme)
const G_TORSO = ['brust', 'lat', 'trapez', 'schulter_seite', 'schulter_hinten', 'bauch'];
const G_LIMBS = ['quadrizeps', 'beinbeuger', 'waden', 'adduktoren', 'abduktoren', 'bizeps', 'trizeps'];
const TL_NOTE = 'Torso = Brust, Rücken, Schultern, Bauch · Limbs = Beine und Arme';

// Feste Vorlagen: [Name, Intensität, Muskelgruppen] je Trainingstag. Angezeigt werden die mit passender Tageszahl.
// pairs: die zweite Hälfte der Tage wiederholt die erste als B- bzw. leichte Variante – dann kann man stattdessen
// nur die erste Hälfte nehmen und jeden Tag 2× pro Woche trainieren (gleich viele Trainings, weniger Tage).
// note: Hinweis unter der Vorlage, z. B. wenn eine Hälfte eines 2er-Splits öfter drankommt.
// 2er-Splits mit 3, 5 oder 6 Tagen: die beiden Hälften wechseln sich ab (A/C niedrige Wdh., B hohe Wdh.).
// Diskopumper: nur Oberkörper, Brust und Arme betont
const DISKO_WEEKLY = {
  brust: [12, 12, 14, 16], bizeps: [6, 8, 8, 10], trizeps: [6, 8, 8, 10], schulter_seite: [6, 8, 8, 10],
  lat: [10, 10, 12, 12], schulter_vorne: [4, 4, 6, 6], schulter_hinten: [4, 6, 6, 8], trapez: [4, 4, 6, 6], bauch: [4, 4, 6, 6],
};
const DISKO_DAYS = {
  2: [['Brust/Schultern/Trizeps', 'heavy', ['brust', 'schulter_vorne', 'schulter_seite', 'trizeps']],
    ['Rücken/Bizeps/Bauch', 'heavy', ['lat', 'trapez', 'schulter_hinten', 'bizeps', 'bauch']]],
  3: [['Brust/Trizeps', 'heavy', ['brust', 'schulter_vorne', 'trizeps']],
    ['Rücken/Bizeps', 'heavy', ['lat', 'trapez', 'schulter_hinten', 'bizeps']],
    ['Schultern/Arme/Bauch', 'heavy', ['schulter_seite', 'schulter_hinten', 'bizeps', 'trizeps', 'bauch']]],
  4: [['Brust', 'heavy', ['brust', 'schulter_vorne', 'bauch']], ['Rücken', 'heavy', ['lat', 'trapez', 'schulter_hinten']],
    ['Schultern', 'heavy', ['schulter_vorne', 'schulter_seite', 'schulter_hinten', 'bauch']], ['Arme', 'heavy', ['bizeps', 'trizeps', 'unterarme']]],
};
// Booty-Plan: Po und Beine betont, im Oberkörper Rücken und hintere Schulter
const BOOTY_WEEKLY = {
  gesaess: [10, 12, 14, 16], beinbeuger: [6, 8, 8, 10], quadrizeps: [6, 8, 8, 10], abduktoren: [4, 6, 6, 8], adduktoren: [2, 2, 4, 4],
  lat: [8, 8, 10, 10], schulter_hinten: [6, 6, 8, 8], schulter_seite: [4, 4, 6, 6], brust: [2, 2, 4, 4],
  bizeps: [2, 2, 4, 4], trizeps: [2, 2, 4, 4], bauch: [4, 4, 6, 6],
};
const G_BOOTY_UPPER = ['lat', 'schulter_hinten', 'schulter_seite', 'brust', 'bizeps', 'trizeps'];
const BOOTY_DAYS = {
  2: [['Po & Beine', 'heavy', ['gesaess', 'beinbeuger', 'quadrizeps', 'abduktoren', 'adduktoren']],
    ['Oberkörper & Po', 'heavy', ['gesaess', ...G_BOOTY_UPPER, 'bauch']]],
  3: [['Po & Beinbeuger', 'heavy', ['gesaess', 'beinbeuger', 'abduktoren', 'bauch']],
    ['Oberkörper (Rücken & hintere Schulter)', 'heavy', G_BOOTY_UPPER],
    ['Po & Beine', 'heavy', ['gesaess', 'quadrizeps', 'adduktoren', 'abduktoren']]],
  4: [['Po & Beinbeuger', 'heavy', ['gesaess', 'beinbeuger', 'abduktoren']],
    ['Oberkörper (Rücken & hintere Schulter)', 'heavy', G_BOOTY_UPPER],
    ['Po & Beine', 'heavy', ['gesaess', 'quadrizeps', 'adduktoren', 'bauch']],
    ['Po & Rücken', 'light', ['gesaess', 'abduktoren', 'lat', 'schulter_hinten']]],
};

const UL = n =>['A', 'A', 'B', 'B', 'C', 'C'].slice(0, n).map((v, i) =>
  [`${i % 2 ? 'Unterkörper' : 'Oberkörper'} ${v}`, v === 'B' ? 'light' : 'heavy', i % 2 ? G_LOWER : G_UPPER]);
const FBPP = n => ['A', 'A', 'B', 'B', 'C', 'C'].slice(0, n).map((v, i) =>
  [`Ganzkörper ${i % 2 ? 'Pull' : 'Push'} ${v}`, v === 'B' ? 'light' : 'heavy', i % 2 ? G_FB_PULL : G_FB_PUSH]);
const SPLITS = [
  // 1 Training pro Woche
  { id: 'fb1', tag: 'Ganzkörper', label: 'Ganzkörper', days: [['Ganzkörper', 'heavy', G_FULL]] },
  // 2
  { id: 'fb2', tag: 'Ganzkörper', label: 'Ganzkörper A/B', pairs: true, days: [['Ganzkörper A', 'heavy', G_FULL], ['Ganzkörper B', 'light', G_FULL]] },
  { id: 'fbpp', tag: '2er-Split', label: 'Ganzkörper Push/Pull', days: [['Ganzkörper Push', 'heavy', G_FB_PUSH], ['Ganzkörper Pull', 'heavy', G_FB_PULL]] },
  { id: 'ob2', tag: '2er-Split', label: 'Oberkörper/Beine', days: [['Oberkörper', 'heavy', G_UPPER], ['Beine', 'heavy', G_LOWER]] },
  // 3
  { id: 'fb3', tag: 'Ganzkörper', label: 'Ganzkörper A/B/C', days: [['Ganzkörper A', 'heavy', G_FULL], ['Ganzkörper B', 'light', G_FULL], ['Ganzkörper C', 'heavy', G_FULL]] },
  { id: 'fbpp3', tag: '2er-Split', label: 'Ganzkörper Push/Pull', note: 'Push 2×, Pull 1× pro Woche',
    days: [['Ganzkörper Push A', 'heavy', G_FB_PUSH], ['Ganzkörper Pull', 'heavy', G_FB_PULL], ['Ganzkörper Push B', 'light', G_FB_PUSH]] },
  { id: 'ul3', tag: '2er-Split', label: 'Ober-/Unterkörper', note: 'Oberkörper 2×, Unterkörper 1× pro Woche',
    days: [['Oberkörper A', 'heavy', G_UPPER], ['Unterkörper', 'heavy', G_LOWER], ['Oberkörper B', 'light', G_UPPER]] },
  { id: 'arnold', tag: '3er-Split', label: 'Arnold-Split', days: [['Brust/Rücken', 'heavy', G_CHEST_BACK], ['Schultern/Arme', 'heavy', G_SHOULDER_ARMS], ['Beine', 'heavy', G_LOWER]] },
  // 4
  { id: 'ul', tag: '2er-Split', label: 'Ober-/Unterkörper', pairs: true, days: [['Oberkörper – niedrige Wdh.', 'heavy', G_UPPER], ['Unterkörper – niedrige Wdh.', 'heavy', G_LOWER],
    ['Oberkörper – hohe Wdh.', 'light', G_UPPER], ['Unterkörper – hohe Wdh.', 'light', G_LOWER]] },
  { id: 'fbpp4', tag: '2er-Split', label: 'Ganzkörper Push/Pull', pairs: true, days: FBPP(4) },
  { id: 'tl', tag: '2er-Split', label: 'Torso/Limbs', note: TL_NOTE, pairs: true, days: [['Torso – niedrige Wdh.', 'heavy', G_TORSO], ['Limbs – niedrige Wdh.', 'heavy', G_LIMBS],
    ['Torso – hohe Wdh.', 'light', G_TORSO], ['Limbs – hohe Wdh.', 'light', G_LIMBS]] },
  { id: 'ppl4c', tag: '3er-Split', label: 'Push/Pull/Beine', note: 'Klassischer Push/Pull/Beine-Split plus Oberkörper-Tag – Push und Pull 2×, Beine 1× pro Woche',
    days: [['Push', 'heavy', G_PUSH], ['Pull', 'heavy', G_PULL], ['Beine', 'heavy', G_LOWER], ['Oberkörper', 'light', G_UPPER]] },
  // 5
  { id: 'pplul', tag: '3er + 2er-Split', label: 'Push/Pull/Beine + Ober-/Unterkörper', days: [['Push', 'heavy', G_PUSH], ['Pull', 'heavy', G_PULL], ['Beine', 'heavy', G_LOWER],
    ['Oberkörper', 'light', G_UPPER], ['Unterkörper', 'light', G_LOWER]] },
  { id: 'ppltl', tag: '3er + 2er-Split', label: 'Push/Pull/Beine + Torso/Limbs', note: TL_NOTE, days: [['Push', 'heavy', G_PUSH], ['Pull', 'heavy', G_PULL], ['Beine', 'heavy', G_LOWER],
    ['Torso', 'light', G_TORSO], ['Limbs', 'light', G_LIMBS]] },
  { id: 'ppl5', tag: '3er-Split', label: 'Push/Pull/Beine', note: 'Push und Pull 2×, Beine 1× pro Woche',
    days: [['Push A', 'heavy', G_PUSH], ['Pull A', 'heavy', G_PULL], ['Beine', 'heavy', G_LOWER], ['Push B', 'light', G_PUSH], ['Pull B', 'light', G_PULL]] },
  { id: 'ul5', tag: '2er-Split', label: 'Ober-/Unterkörper', note: 'Oberkörper 3×, Unterkörper 2× pro Woche', days: UL(5) },
  { id: 'fbpp5', tag: '2er-Split', label: 'Ganzkörper Push/Pull', note: 'Push 3×, Pull 2× pro Woche', days: FBPP(5) },
  // Im Wechsel (rotate = Trainings pro Woche, weniger Tage): die Tage laufen über die Wochen weiter, z. B. O·U·O | U·O·U
  { id: 'ulx3', tag: '2er-Split', label: 'Ober-/Unterkörper im Wechsel', rotate: 3,
    note: 'Ober- und Unterkörper wechseln sich ab: Woche 1 O · U · O, Woche 2 U · O · U …',
    days: [['Oberkörper', 'heavy', G_UPPER], ['Unterkörper', 'heavy', G_LOWER]] },
  { id: 'fbppx3', tag: '2er-Split', label: 'Ganzkörper Push/Pull im Wechsel', rotate: 3,
    note: 'Push und Pull wechseln sich ab: Woche 1 Push · Pull · Push, Woche 2 Pull · Push · Pull …',
    days: [['Ganzkörper Push', 'heavy', G_FB_PUSH], ['Ganzkörper Pull', 'heavy', G_FB_PULL]] },
  { id: 'pplx5', tag: '3er-Split', label: 'Push/Pull/Beine im Wechsel', rotate: 5,
    note: 'Push, Pull und Beine laufen der Reihe nach durch: Woche 1 Push · Pull · Beine · Push · Pull, Woche 2 Beine · Push · Pull · Beine · Push …',
    days: [['Push', 'heavy', G_PUSH], ['Pull', 'heavy', G_PULL], ['Beine', 'heavy', G_LOWER]] },
  // 6
  { id: 'ppl2', tag: '3er-Split', label: 'Push/Pull/Beine ×2', pairs: true, days: [['Push A', 'heavy', G_PUSH], ['Pull A', 'heavy', G_PULL], ['Beine A', 'heavy', G_LOWER],
    ['Push B', 'light', G_PUSH], ['Pull B', 'light', G_PULL], ['Beine B', 'light', G_LOWER]] },
  { id: 'arnold2', tag: '3er-Split', label: 'Arnold-Split ×2', pairs: true, days: [['Brust/Rücken A', 'heavy', G_CHEST_BACK], ['Schultern/Arme A', 'heavy', G_SHOULDER_ARMS], ['Beine A', 'heavy', G_LOWER],
    ['Brust/Rücken B', 'light', G_CHEST_BACK], ['Schultern/Arme B', 'light', G_SHOULDER_ARMS], ['Beine B', 'light', G_LOWER]] },
  { id: 'ul6', tag: '2er-Split', label: 'Ober-/Unterkörper ×3', days: UL(6) },
  { id: 'fbpp6', tag: '2er-Split', label: 'Ganzkörper Push/Pull ×3', days: FBPP(6) },
  // Klassiker mit eigenen Wochenzielen (weekly ersetzt WEEKLY_TARGET für diese Muskelgruppen)
  // prio: vorab gewählter Schwerpunkt (wird beim Kürzen auf 25 Sätze pro Training geschont, im Assistenten änderbar)
  ...[2, 3, 4].map(n => ({ id: 'disko' + n, tag: 'Klassiker', label: 'Diskopumper', weekly: DISKO_WEEKLY, days: DISKO_DAYS[n], prio: ['brust'],
    note: 'Nur Oberkörper – Schwerpunkt Brust, Arme und Schultern, keine Beine' })),
  ...[2, 3, 4].map(n => ({ id: 'booty' + n, tag: 'Klassiker', label: 'Booty-Plan', weekly: BOOTY_WEEKLY, days: BOOTY_DAYS[n], prio: ['gesaess'],
    note: 'Großer Fokus auf Po und Beine, im Oberkörper vor allem Rücken und hintere Schulter' })),
];

// Wochenziele (Sätze pro Woche: Intro, W2, W3, W4). Die Vorlagen teilen sie auf die Trainings der Woche auf.
const WEEKLY_TARGET = {
  brust: [10, 10, 12, 14], lat: [10, 10, 12, 12], trapez: [4, 4, 6, 6],
  schulter_vorne: [4, 4, 6, 6], schulter_seite: [4, 6, 6, 8], schulter_hinten: [4, 6, 6, 8],
  bizeps: [4, 6, 6, 8], trizeps: [4, 6, 6, 8], unterarme: [2, 2, 3, 3],
  quadrizeps: [10, 10, 12, 14], beinbeuger: [6, 8, 8, 10], gesaess: [4, 4, 6, 6],
  adduktoren: [2, 2, 4, 4], abduktoren: [2, 2, 4, 4], waden: [4, 4, 6, 6], bauch: [4, 4, 6, 6],
  ruecken_unten: [2, 2, 3, 3],
};
const SESSION_CAP = 25;  // höchstens so viele Sätze pro Training – in jeder Woche des Zyklus

// Volumen-Variante (direkt nach der Aufteilung gefragt): vol = Faktor auf die Sätze, rir = Verschiebung des Tank-Ziels
// (vom User festgelegt: mehr Volumen = Tank wie bisher, weniger Volumen = etwa 1 Wdh. weniger im Tank, nie unter 0)
const VOL_STYLES = {
  high: { vol: 1.2, rir: 0, label: 'Mehr Volumen, mehr im Tank' },
  mid: { vol: 1, rir: 0, label: 'Ausgewogen' },
  low: { vol: 0.8, rir: -1, label: 'Weniger Volumen, näher am Muskelversagen' },
};
const wizStyle = () => VOL_STYLES[wiz.style] || VOL_STYLES.mid;
// Obergrenze Sätze pro Training: bei „Mehr Volumen“ im selben Verhältnis höher (25 → 30), sonst würde sie das Mehr wieder kappen
const sessionCap = () => Math.round(SESSION_CAP * Math.max(1, wizStyle().vol));
// Tank-Ziel normaler Übungen (Intro…W4) für Erfahrung und Variante
const wizRirBase = style => RIR_PLAN[4].map(v => Math.max(0, v + wizLevel().rir + style.rir));

// Erfahrungsstufe: empfohlene Trainingstage pro Woche, Startvolumen (Anteil der Wochenziele), Tank-Ziel
// (+ = weiter weg vom Muskelversagen) und – für Neulinge – nur einfache Aufteilungen
const LEVELS = {
  neuling: { label: 'Neuling', icon: '🌱', desc: 'Keine oder kaum Trainingserfahrung (unter 6 Monaten)',
    days: [2, 3], vol: 0.7, rir: 1, tags: ['Ganzkörper', '2er-Split', 'Klassiker'] },
  einsteiger: { label: 'Einsteiger', icon: '🌿', desc: '6–12 Monate Trainingserfahrung', days: [3, 4], vol: 0.9, rir: 0.5 },
  fortgeschritten: { label: 'Fortgeschritten', icon: '💪', desc: '1–5 Jahre Trainingserfahrung', days: [4, 5], vol: 1, rir: 0 },
  hase: { label: 'Alter Hase', icon: '🦉', desc: 'Mehr als 5 Jahre Trainingserfahrung', days: [4, 6], vol: 1, rir: -0.5 },
};
const wizLevel = () => LEVELS[wiz.level] || LEVELS.fortgeschritten;

// Standard-Auswahl je Muskelgruppe (komplexe Übungen zuerst)
const DEFAULT_PICKS = {
  brust: ['Bankdrücken Flachbank (Langhantel)', 'Bankdrücken Schrägmaschine', 'Butterfly Maschine', 'Bankdrücken Schrägbank (Kurzhantel)', 'Kabelzug Crossover'],
  lat: ['Rudern Langhantel vorgebeugt', 'Latziehen breit', 'Rudern Kabelzug eng (V-Griff)', 'Klimmzüge', 'Überzüge Kabelzug (Straight-Arm Pulldown)'],
  trapez: ['Rudern Maschine breit', 'Shrugs Kurzhantel'],
  schulter_vorne: ['Schulterdrücken Langhantel stehend (Military Press)', 'Schulterdrücken Maschine', 'Frontheben Kurzhantel'],
  schulter_seite: ['Seitheben Kabelzug', 'Seitheben Kurzhantel', 'Seitheben Maschine'],
  schulter_hinten: ['Reverse Butterfly Maschine', 'Face Pulls', 'Reverse Flys Kabelzug'],
  bizeps: ['Bizepscurls SZ-Stange', 'Hammercurls Kurzhantel', 'Bizepscurls Kabelzug'],
  trizeps: ['Trizepsdrücken Kabelzug (Seil)', 'Stirndrücken SZ-Stange (French Press)', 'Trizepsdrücken über Kopf Kabelzug'],
  unterarme: ['Handgelenkcurls (Unterarme)', 'Reverse Curls'],
  quadrizeps: ['Kniebeugen (Langhantel)', 'Beinpresse 45°', 'Beinstrecker', 'Hackenschmidt-Kniebeugen (Hack Squat)'],
  beinbeuger: ['Kreuzheben rumänisch (Langhantel)', 'Beinbeuger sitzend', 'Beinbeuger liegend'],
  gesaess: ['Hip Thrust Langhantel', 'Gesäßmaschine (Glute Kickback)'],
  adduktoren: ['Adduktoren Maschine'],
  abduktoren: ['Abduktoren Maschine'],
  waden: ['Wadenheben stehend', 'Wadenheben sitzend'],
  bauch: ['Crunches Kabelzug (kniend)', 'Beinheben hängend'],
  ruecken_unten: ['Hyperextensions (Rückenstrecker)', 'Rückenstrecker Maschine'],
};
// … bei „Nur Maschinentraining“ (Gruppen ohne Maschinen-Übung, z. B. Unterarme, nehmen die normale Auswahl)
const MACHINE_PICKS = {
  brust: ['Brustpresse Maschine', 'Bankdrücken Schrägmaschine', 'Butterfly Maschine', 'Kabelzug Crossover'],
  lat: ['Latziehen breit', 'Rudern Maschine', 'Rudern Kabelzug eng (V-Griff)', 'Überzüge Maschine (Pullover)'],
  trapez: ['Rudern Maschine breit', 'Shrugs Maschine'],
  schulter_vorne: ['Schulterdrücken Maschine', 'Schulterdrücken Multipresse', 'Frontheben Kabelzug'],
  schulter_seite: ['Seitheben Maschine', 'Seitheben Kabelzug'],
  schulter_hinten: ['Reverse Butterfly Maschine', 'Face Pulls', 'Reverse Flys Kabelzug'],
  bizeps: ['Bizepscurls Maschine', 'Bizepscurls Kabelzug', 'Scottcurls Maschine'],
  trizeps: ['Trizepsdrücken Kabelzug (Seil)', 'Trizepsmaschine', 'Trizepsdrücken über Kopf Kabelzug'],
  quadrizeps: ['Beinpresse 45°', 'Hackenschmidt-Kniebeugen (Hack Squat)', 'Beinstrecker', 'Kniebeugen Multipresse'],
  beinbeuger: ['Beinbeuger sitzend', 'Beinbeuger liegend'],
  gesaess: ['Hip Thrust Maschine', 'Gesäßmaschine (Glute Kickback)'],
  adduktoren: ['Adduktoren Maschine'],
  abduktoren: ['Abduktoren Maschine'],
  waden: ['Wadenheben sitzend', 'Wadenheben an der Beinpresse'],
  bauch: ['Crunches Maschine', 'Crunches Kabelzug (kniend)'],
  ruecken_unten: ['Rückenstrecker Maschine'],
};
// … zu Hause: in dieser Reihenfolge, soweit die Ausrüstung reicht (Gewichte vor Band vor Eigengewicht)
const HOME_PICKS = {
  brust: ['Bankdrücken Flachbank (Kurzhantel)', 'Floor Press Kurzhantel', 'Liegestütze', 'Fliegende Flachbank (Kurzhantel)',
    'Fliegende am Boden (Kurzhantel)', 'Brustpresse Band', 'Liegestütze auf Knien', 'Fliegende Band (Türanker)'],
  lat: ['Rudern Kurzhantel einarmig', 'Latziehen Band (Türanker)', 'Klimmzüge', 'Rudern Kettlebell einarmig', 'Rudern Band sitzend',
    'Rudern umgekehrt (Tisch oder Stange)', 'Klimmzüge mit Band (unterstützt)', 'Überzüge Band (Türanker)', 'Überzüge / Pullover (Kurzhantel)'],
  trapez: ['Shrugs Kurzhantel', 'Rudern Band breit'],
  schulter_vorne: ['Schulterdrücken Kurzhantel sitzend', 'Schulterdrücken Kettlebell', 'Schulterdrücken Band', 'Pike-Liegestütze', 'Arnold Press'],
  schulter_seite: ['Seitheben Kurzhantel', 'Seitheben Band', 'Seitheben Kurzhantel sitzend'],
  schulter_hinten: ['Vorgebeugtes Seitheben (Kurzhantel)', 'Face Pulls Band (Türanker)', 'Band Pull-Aparts', 'Y-T-W-Raises (Bauchlage)'],
  bizeps: ['Bizepscurls Kurzhantel', 'Hammercurls Kurzhantel', 'Bizepscurls Kettlebell', 'Bizepscurls Band', 'Klimmzüge Untergriff (Chin-ups)', 'Rudern umgekehrt Untergriff (Tisch oder Stange)'],
  trizeps: ['Trizepsdrücken über Kopf Kurzhantel', 'Trizepsdrücken Band (Türanker)', 'Trizepsdrücken über Kopf Band', 'Bankdips',
    'Stirndrücken Kurzhantel', 'Diamant-Liegestütze'],
  unterarme: ['Handgelenkcurls (Unterarme)', "Farmer's Walk"],
  quadrizeps: ['Goblet Squats', 'Bulgarian Split Squats', 'Ausfallschritte Kurzhantel', 'Kniebeugen Eigengewicht',
    'Bulgarian Split Squats ohne Gewicht', 'Ausfallschritte Eigengewicht', 'Einbeinige Kniebeugen zum Stuhl', 'Einbeinige Kniebeugen (Pistol Squats)'],
  beinbeuger: ['Kreuzheben rumänisch (Kurzhantel)', 'Kreuzheben rumänisch (Kettlebell)', 'Beincurls am Boden (Handtuch)',
    'Kreuzheben rumänisch einbeinig (Kurzhantel)', 'Beinbeuger Band (Bauchlage)', 'Nordic Hamstring Curls'],
  gesaess: ['Hip Thrust Kurzhantel', 'Hip Thrust am Sofa', 'Glute Bridge einbeinig', 'Kickbacks Band (Gesäß)', 'Glute Bridge'],
  abduktoren: ['Monster Walk (Band)', 'Clamshells', 'Seitliches Beinheben liegend'],
  adduktoren: ['Copenhagen Plank'],
  waden: ['Wadenheben einbeinig', 'Wadenheben an der Treppe'],
  bauch: ['Crunches', 'Dead Bug', 'Beinheben liegend', 'Plank (Unterarmstütz)'],
  ruecken_unten: ['Superman (Bauchlage)', 'Good Mornings Band'],
};
// Ausweich-Übung -> Vorbild: zu Hause nur gewählt, wenn das Vorbild mit der Ausrüstung nicht geht
const HOME_ALT = {
  'Floor Press Kurzhantel': 'Bankdrücken Flachbank (Kurzhantel)', 'Fliegende am Boden (Kurzhantel)': 'Fliegende Flachbank (Kurzhantel)',
  'Liegestütze auf Knien': 'Liegestütze', 'Klimmzüge mit Band (unterstützt)': 'Klimmzüge',
  'Rudern Kettlebell einarmig': 'Rudern Kurzhantel einarmig', 'Schulterdrücken Kettlebell': 'Schulterdrücken Kurzhantel sitzend',
  'Bizepscurls Kettlebell': 'Bizepscurls Kurzhantel', 'Kreuzheben rumänisch (Kettlebell)': 'Kreuzheben rumänisch (Kurzhantel)',
  'Bulgarian Split Squats ohne Gewicht': 'Bulgarian Split Squats', 'Ausfallschritte Eigengewicht': 'Ausfallschritte Kurzhantel',
  'Hip Thrust am Sofa': 'Hip Thrust Kurzhantel',
};
const wizMachines = () => !!wiz && wiz.equip === 'machine' && appMode() !== 'x';
const wizHome = () => !!wiz && wiz.equip === 'home';
// Nur Maschinen: Liste auf Maschinen-Übungen beschränken – gibt es für die Muskelgruppe keine, bleibt sie, wie sie ist.
// Zu Hause: nur Übungen, die mit der Ausrüstung gehen (gibt es keine, bleibt die Muskelgruppe ohne Übung)
function machineFilter(list, g) {
  if (wizHome()) return list.filter(n => homeOk(n, data.home));
  if (!wizMachines()) return list;
  const any = EXERCISE_LIST.some(([n, , gr]) => gr === g && isMachine(n));
  return any ? list.filter(isMachine) : list;
}
// Neulinge und Einsteiger: zu schwere Übungen wählt die App nicht automatisch (User-Regel 2026-11-06)
const BEGINNER_HARD = /^(dips \(|klimmzuge(?! mit band| assistiert)|beinheben hangend|knieheben hangend|nordic|einbeinige kniebeugen \(pistol|rudern langhantel|t-bar)/;
// Neulinge zu Hause: leichtere Liegestütze
const NEULING_HOME_HARD = /^liegestutze( eng| fusse|$)|^diamant/;
const defaultPicks = g => (wizHome() && HOME_PICKS[g]) || (wizMachines() && MACHINE_PICKS[g]) || DEFAULT_PICKS[g];

let wiz = null;  // Entwurf des Assistenten – erst „Plan speichern“ schreibt den Plan in data

const byKind = names => [...names].sort((a, b) => KIND_ORDER[kindOf({ name: a })] - KIND_ORDER[kindOf({ name: b })]);
const uniqueNames = names => names.filter((n, i) => names.findIndex(m => nameKey(m) === nameKey(n)) === i);

// Übungen dieser Muskelgruppe aus dem aktiven Plan
const existingFor = g => machineFilter(byKind(uniqueNames(data.days.flatMap(d => d.exercises)
  .filter(e => e.name.trim() && groupOf(e) === g).map(e => e.name.trim()))), g);

// Muskelgruppen, die an mindestens einem Tag trainiert werden (in fester Reihenfolge)
const wizGroups = () => PLAN_GROUPS.filter(g => wiz.days.some(d => d.groups.includes(g)));
// Teiler fürs Wochenvolumen: Trainingstage mit dieser Muskelgruppe × wiz.volDiv (= 2, wenn jeder Tag 2× pro Woche
// läuft und die Sätze pro Training dafür halbiert werden sollen)
const daysWith = g => wiz.days.filter(d => d.groups.includes(g)).length * wiz.volDiv;
// tatsächliche Trainings pro Woche mit dieser Muskelgruppe
const sessionsWith = g => wiz.days.filter(d => d.groups.includes(g)).length * wiz.perWeek;

// Schwerpunkt: +2 Sätze/Woche bei Priorität, −2 bei „low“
const focusAdj = g => wiz.prio.includes(g) ? FOCUS_SETS : wiz.low.includes(g) ? -FOCUS_SETS : 0;

// Weniger Volumen = weniger, dafür komplexere Übungen – aber mindestens so viele Übungen,
// dass keine mehr als MAX_SETS_PER_EX Sätze braucht (gemessen an der Woche mit den meisten Sätzen)
function exercisesNeeded(g) {
  const v = wiz.volume[g][0];
  const base = v <= 2 ? 1 : v <= 4 ? 2 : 3;
  return Math.max(base, Math.ceil(Math.max(...wiz.volume[g]) / MAX_SETS_PER_EX));
}

// Automatische Auswahl: je Übung eine Stufe – 1. Grundübung, 2. normale, 3. Assistenzübung.
// Pro Stufe zuerst eine Übung aus dem aktiven Plan, sonst ein Standard-Vorschlag; fehlt die Art ganz,
// wird mit der nächstbesten Übung aufgefüllt.
function autoPicks(g) {
  const n = exercisesNeeded(g);
  const tooHard = x => (needsCoach() && BEGINNER_HARD.test(norm(x))) || (wizHome() && wiz.level === 'neuling' && NEULING_HOME_HARD.test(norm(x)));
  const existing = existingFor(g).filter(x => !tooHard(x));
  // Standard-Vorschläge zuerst, danach alle übrigen Übungen der Muskelgruppe aus der Liste
  let pool = machineFilter(uniqueNames([...(g === 'brust' && wizHome() && wiz.level === 'neuling' ? ['Liegestütze erhöht'] : []), ...(defaultPicks(g) || []), ...byKind(EXERCISE_LIST.filter(([, , gr]) => gr === g).map(([name]) => name))]), g);
  // zu Hause: Ausweich-Übung nur, wenn ihr Vorbild nicht geht (z. B. Floor Press nur ohne Bank)
  pool = pool.filter(x => !tooHard(x));
  if (wizHome()) pool = pool.filter(x => !(HOME_ALT[x] && pool.includes(HOME_ALT[x])));
  const picks = [];
  const free = list => list.filter(x => !picks.some(p => nameKey(p) === nameKey(x)));
  const ofKind = (list, k) => free(list).find(x => kindOf({ name: x }) === k);
  // ab der 4. Übung abwechselnd normale und Assistenzübungen
  const slots = ['compound', 'normal', 'assist', 'normal', 'assist', 'normal', 'assist'];
  for (let i = 0; i < n; i++) {
    const k = slots[Math.min(i, slots.length - 1)];
    // zu Hause zählt die Reihenfolge in HOME_PICKS (sonst z. B. Dips für Brust und Trizeps am selben Tag)
    const pick = wizHome() ? free(existing)[0] || free(pool)[0]
      : ofKind(existing, k) || ofKind(pool, k) || free(existing)[0] || free(pool)[0];
    if (pick) picks.push(pick);
  }
  // Neulinge und Einsteiger: am Rückentag immer eine Latzug-Variante (lieber eine aus dem aktiven Plan). Fehlt sie,
  // ersetzt sie die einzige Übung bzw. die letzte normale (z. B. Klimmzüge) – sonst die letzte
  const LATZUG = /latziehen/i;
  if (g === 'lat' && needsCoach() && picks.length && !picks.some(p => LATZUG.test(p)) && (existing.concat(pool)).some(x => LATZUG.test(x))) {
    const lz = existing.find(x => LATZUG.test(x)) || pool.find(x => LATZUG.test(x));  // zu Hause nur mit Band + Türanker
    let i = picks.length - 1;
    if (picks.length > 1) {
      const ni = picks.map(p => kindOf({ name: p })).lastIndexOf('normal');
      if (ni >= 0) i = ni;
    }
    picks[i] = lz;
  }
  return byKind(picks);
}

const splitDays = id => SPLITS.find(s => s.id === id).days.map(([name, intensity, groups]) => ({ name, intensity, groups: [...groups] }));

// 2× pro Woche bei einer Vorlage mit Paaren: nur die erste Hälfte der Tage, ohne „A“ bzw. den Wdh.-Bereich im Namen
const halfDays = id => splitDays(id).slice(0, SPLITS.find(s => s.id === id).days.length / 2)
  .map(d => ({ ...d, name: d.name.replace(INT_NAME_RE, '').replace(/ A$/, '') }));

// Wiederholungsbereich im Tagesnamen (früher „schwer“/„leicht“, das klang nach mehr oder weniger Anstrengung)
const INT_NAME = { heavy: 'niedrige Wdh.', light: 'hohe Wdh.' };
const INT_NAME_RE = /\s*(–\s*(niedrige|hohe) Wdh\.|\b(schwer|leicht)\b)/i;
const INT_LABEL = { heavy: 'niedriger Wdh.-Bereich', light: 'hoher Wdh.-Bereich' };
const halfNames = id => halfDays(id).map(d => d.name);

// Muskelgruppen eines vorhandenen Trainingstags (neue Tage haben groups, ältere ggf. nur Übungen)
function groupsOfDay(d) {
  if (d.groups) return [...d.groups];
  if (d.type) return [...DAY_GROUPS[d.type.split('-')[0]]];
  return [...new Set(d.exercises.filter(e => e.name.trim()).map(groupOf))].filter(g => PLAN_GROUPS.includes(g));
}

// Alle Trainingstage zur Auswahl bei „Eigene Aufteilung“: eigene, aus den Plänen und aus den Vorlagen
function dayLibrary() {
  const list = [];
  const add = (name, intensity, groups, ownId) => {
    if (!groups.length || list.some(x => nameKey(x.name) === nameKey(name))) return;
    list.push({ name, intensity: intensity || 'heavy', groups, ownId });
  };
  for (const t of data.dayTemplates) add(t.name, t.intensity, [...t.groups], t.id);
  for (const p of data.plans) for (const d of p.days) add(d.name, dayIntensity(d), groupsOfDay(d), null);
  for (const s of SPLITS) for (const [name, int, groups] of s.days) add(name.replace(/ [ABC]$/, ''), int, [...groups], null);
  return list;
}

// Vorauswahl: erst die Art der Aufteilung, dann die passenden Vorlagen
const SPLIT_CATS = [
  { tag: 'Ganzkörper', icon: '🧍', desc: 'Jedes Training den ganzen Körper' },
  { tag: '2er-Split', icon: '✌️', desc: 'Zwei verschiedene Trainingstage im Wechsel' },
  { tag: '3er-Split', icon: '🔺', desc: 'Drei verschiedene Trainingstage im Wechsel' },
  { tag: '3er + 2er-Split', icon: '🔀', desc: 'Kombination für 5 Trainings pro Woche' },
  { tag: 'Klassiker', icon: '🏆', desc: 'Bekannte Pläne mit eigenem Schwerpunkt' },
  { tag: 'custom', icon: '🛠️', label: 'Eigene Aufteilung', desc: 'Trainingstage selbst zusammenstellen' },
];

function wizStart() {
  wiz = {
    step: 'equip',   // erste Frage: womit trainieren (User-Wunsch: vor „automatisch oder eigener Plan“)
    mode: null,      // 'app' = Plan mit Steigerung der App, 'own' = eigenen Plan übernehmen (ohne Progression)
    own: [],         // eigener Plan: [{ name, exercises: [{ name, sets, reps, kg }] }] (Werte als eingetippter Text)
    oi: 0,           // eigener Plan: gerade bearbeiteter Tag
    level: null,     // Erfahrungsstufe (LEVELS)
    equip: ['machine', 'home'].includes((activePlan() || {}).equip) ? activePlan().equip : 'free',  // 'machine' = nur Maschinen, 'home' = zu Hause
    sessions: null,  // gewünschte Trainings pro Woche (wählt die passenden Vorlagen aus)
    name: `Plan ${data.plans.length + 1}`,
    weeks: data.cycle.defWeeks,
    cat: null,     // gewählte Aufteilung (Kennzeichen) oder 'custom'
    split: null,   // gewählte Vorlage
    days: [],
    newDay: { name: '', intensity: 'heavy', groups: [] },
    deload: 'auto',                   // Deload automatisch nach den Trainingswochen oder 'self' = selbst bestimmen
    progression: { volume: true, load: true },  // Grundeinstellung des neuen Plans
    style: 'mid',                      // Volumen-Variante (VOL_STYLES): 'high' / 'mid' / 'low'
    perWeek: 1,                        // jeder Trainingstag 1× oder 2× pro Woche
    volDiv: 1,                         // Wochensätze auf so viele Durchgänge je Tag verteilen (siehe daysWith)
    weekWanted: {},                    // eingetippte Sätze pro Woche (Muskelgruppe -> [Intro…W4]), werden beim Speichern genau verteilt
    prio: [], low: [],
    volume: {}, volKey: {}, rir: {}, picks: {}, gi: 0,
    swaps: {}, swapOpen: null,         // Vorschau: an einzelnen Tagen ersetzte Übungen, offenes Ersetzen-Feld
  };
  go('wizard');
}

// Sätze pro Training aus den Wochenzielen (± Schwerpunkt): Wochenziel ÷ Trainings pro Woche mit dieser
// Muskelgruppe. Hätte ein Tag in der Intro-Woche mehr als SESSION_CAP Sätze, wird anteilig gekürzt.
function templateVolume(groups) {
  const vol = {};
  const share = wizLevel().vol * wizStyle().vol;  // Startvolumen je nach Erfahrung und Volumen-Variante
  const tpl = SPLITS.find(s => s.id === wiz.split);  // Klassiker bringen eigene Wochenziele mit
  for (const g of groups) {
    const freq = Math.max(1, daysWith(g));
    const adj = focusAdj(g);
    vol[g] = ((tpl && tpl.weekly && tpl.weekly[g]) || WEEKLY_TARGET[g] || [2, 2, 3, 3]).map(w => Math.max(1, Math.round(Math.max(1, w * share + adj) / freq)));
  }
  capSessions(vol);
  return vol;
}

// Muskelgruppen, die fast nur mit Assistenzübungen trainiert werden – sie werden zuerst gekürzt.
const ASSIST_GROUPS = ['schulter_seite', 'schulter_hinten', 'bizeps', 'trizeps', 'unterarme', 'trapez',
  'waden', 'bauch', 'adduktoren', 'abduktoren'];
const ASSIST_FLOOR = 0.5; // bis auf diesen Anteil werden Assistenzgruppen gekürzt, bevor andere nachziehen

// Kein Training über SESSION_CAP Sätze, in keiner Woche. Priorisierte Gruppen bleiben bis zuletzt verschont.
// 1. Anteilig, gemessen an der vollsten Woche (so bleibt der Anstieg über den Zyklus erhalten):
//    erst die Assistenzgruppen bis auf ASSIST_FLOOR, dann die übrigen Gruppen ebenfalls bis auf
//    ASSIST_FLOOR, reicht das nicht, beide gemeinsam weiter.
// 2. Rundungsreste: an noch zu vollen Tagen um je 1 Satz kürzen, in derselben Reihenfolge.
function capSessions(vol) {
  const orig = Object.fromEntries(Object.keys(vol).map(g => [g, vol[g].slice()]));
  const isAssist = g => ASSIST_GROUPS.includes(g);
  const factor = Object.fromEntries(Object.keys(vol).map(g => [g, 1]));
  for (const d of wiz.days) {
    const free = d.groups.filter(g => vol[g] && !wiz.prio.includes(g));
    for (let w = 0; w < 4; w++) {
      const sum = gs => gs.reduce((a, g) => a + (vol[g] ? vol[g][w] : 0), 0);
      let excess = sum(d.groups) - sessionCap();
      if (excess <= 0) continue;
      const A = sum(free.filter(isAssist)), N = sum(free.filter(g => !isAssist(g)));
      const cutA = Math.min(excess, A * (1 - ASSIST_FLOOR)); excess -= cutA;
      const cutN = Math.min(excess, N * (1 - ASSIST_FLOOR)); excess -= cutN;
      let fA = A ? 1 - cutA / A : 1, fN = N ? 1 - cutN / N : 1;
      const left = (A + N) * ASSIST_FLOOR;
      if (excess > 0 && left > 0) {
        const f = Math.max(0, 1 - excess / left);
        fA *= f; fN *= f;
      }
      free.forEach(g => { factor[g] = Math.min(factor[g], isAssist(g) ? fA : fN); });
    }
  }
  for (const g of Object.keys(vol)) {
    if (factor[g] < 1) vol[g] = vol[g].map(v => Math.max(1, Math.round(v * factor[g])));
  }
  for (let w = 3; w >= 0; w--) {
    // frühere Wochen nie mehr Sätze als die Woche danach (die Verteilung kann nur hinzufügen)
    if (w < 3) for (const g of Object.keys(vol)) vol[g][w] = Math.min(vol[g][w], vol[g][w + 1]);
    for (let guard = 0; guard < 500; guard++) {
      const over = wiz.days.find(d => d.groups.reduce((a, g) => a + (vol[g] ? vol[g][w] : 0), 0) > sessionCap());
      if (!over) break;
      const cands = over.groups.filter(g => vol[g] && vol[g][w] > 1);
      const free = cands.filter(g => !wiz.prio.includes(g));
      const floor = g => Math.max(1, Math.ceil(orig[g][w] * ASSIST_FLOOR));
      const pool = [
        free.filter(g => isAssist(g) && vol[g][w] > floor(g)),
        free.filter(g => !isAssist(g) && vol[g][w] > floor(g)),
        free, cands,
      ].find(p => p.length);
      if (!pool) break;
      const g = pool.reduce((a, b) => vol[b][w] > vol[a][w] ? b : a);
      vol[g][w]--;
    }
  }
}

// Volumen/RIR/Auswahl an die Muskelgruppen der Tage anpassen. Volumen wird neu berechnet, wenn eine
// Muskelgruppe neu ist oder sich ihre Trainingstage bzw. ihr Schwerpunkt geändert haben.
function syncGroups() {
  const groups = wizGroups();
  const tv = templateVolume(groups);
  for (const g of groups) {
    const key = `${daysWith(g)}|${focusAdj(g)}|${wiz.style}`;
    if (!wiz.volume[g] || wiz.volKey[g] !== key) {
      wiz.volume[g] = tv[g];
      wiz.volKey[g] = key;
      delete wiz.weekWanted[g];  // neu vorgeschlagen -> eingetippte Wochenzahlen gelten nicht mehr
    }
    // Tank-Ziel je nach Erfahrung: Neulinge weiter weg vom Muskelversagen, Alte Hasen näher dran
    if (!wiz.rir[g]) wiz.rir[g] = wizRirBase(wizStyle());
    if (!wiz.picks[g]) wiz.picks[g] = existingFor(g);
  }
  for (const g of Object.keys(wiz.volume)) {
    if (!groups.includes(g)) { delete wiz.volume[g]; delete wiz.volKey[g]; delete wiz.rir[g]; delete wiz.picks[g]; }
  }
}

// Trainingstage aus dem Entwurf: Übungen der Muskelgruppen des Tages, sortiert Grund → Normal → Assistenz
// wiz.swaps[Tag] = { ursprüngliche Übung (nameKey) -> Ersatz }: in der Vorschau nur an diesem Tag ausgetauscht
// Wdh.-Bereich im fertigen Plan (Frage am Ende, wiz.intMode): 'alt' = abwechselnd, 'heavy' (niedrige Wdh.) /
// 'light' (hohe Wdh.) = alle Tage gleich. Abwechselnd: Vorlagen mit beiden Bereichen behalten ihre Einteilung; sonst
// wechseln sich Tage mit gemeinsamen Muskelgruppen ab (niedrig, hoch, niedrig …).
function wizAltIntensities() {
  const tpl = wiz.cat !== 'custom' ? wiz.days.map(d => d.intensity) : null;
  if (tpl && tpl.includes('heavy') && tpl.includes('light')) return tpl;
  const res = [];
  wiz.days.forEach((d, i) => {
    let prev = -1;
    for (let j = i - 1; j >= 0 && prev < 0; j--) if (wiz.days[j].groups.some(g => d.groups.includes(g))) prev = j;
    res.push(prev >= 0 && res[prev] === 'heavy' ? 'light' : 'heavy');
  });
  return res;
}
// Abwechseln geht nur, wenn mindestens eine Muskelgruppe an mehreren Tagen dran ist
const wizAltPossible = () => { const a = wizAltIntensities(); return a.includes('heavy') && a.includes('light'); };
const wizIntMode = () => wiz.intMode && (wiz.intMode !== 'alt' || wizAltPossible()) ? wiz.intMode : wizAltPossible() ? 'alt' : 'heavy';
const wizDayIntensities = () => wizIntMode() === 'alt' ? wizAltIntensities() : wiz.days.map(() => wizIntMode());

// Tagesnamen passend dazu: Wdh.-Bereich im Namen anpassen bzw. anhängen; alle gleich -> weglassen, doppelte Namen A, B …
function wizDayNames() {
  const ints = wizDayIntensities();
  const same = wizIntMode() !== 'alt';
  const names = wiz.days.map((d, i) => {
    const n = d.name.trim() || 'Trainingstag';
    if (same) return n.replace(INT_NAME_RE, '').trim() || n;
    return INT_NAME_RE.test(n) ? n.replace(INT_NAME_RE, ` – ${INT_NAME[ints[i]]}`) : n;
  });
  if (!same) return names;
  const count = {}, seen = {};
  names.forEach(n => { count[nameKey(n)] = (count[nameKey(n)] || 0) + 1; });
  return names.map(n => {
    if (count[nameKey(n)] < 2) return n;
    seen[nameKey(n)] = (seen[nameKey(n)] || 0) + 1;
    return `${n} ${String.fromCharCode(64 + seen[nameKey(n)])}`;
  });
}

function buildPlanDays() {
  const ints = wizDayIntensities(), names = wizDayNames();
  return wiz.days.map((d, di) => {
    const list = [];
    const swaps = (wiz.swaps || {})[di] || {};
    for (const g of PLAN_GROUPS.filter(x => d.groups.includes(x))) {
      for (const pick of wiz.picks[g] || []) {
        const name = swaps[nameKey(pick)] || pick;
        const ng = groupOf({ name });  // Ersatz aus einer anderen Muskelgruppe zählt dort
        list.push([name, name !== pick && PLAN_GROUPS.includes(ng) ? ng : g]);
      }
    }
    // Limbs (Beine + Arme ohne Rumpf): erst alle Beinübungen, dann die Arme – sonst stünden Dips vor den Kniebeugen
    const limbs = !d.groups.some(g => G_TORSO.includes(g)) && d.groups.some(g => G_LOWER.includes(g));
    const armLast = g => limbs && ['bizeps', 'trizeps', 'unterarme'].includes(g) ? 10 : 0;
    list.sort((a, b) => armLast(a[1]) - armLast(b[1]) || KIND_ORDER[kindOf({ name: a[0] })] - KIND_ORDER[kindOf({ name: b[0] })]);
    return {
      id: uid(),
      name: names[di],
      intensity: ints[di],
      groups: [...d.groups],
      exercises: list.map(([name, g]) => withDefaults({ id: uid(), name, group: g, max10: knownMax10(name) })),
    };
  });
}

/* --- Darstellung --- */

const STEP_PILL = { mode: 0, level: 0, equip: 0, homeeq: 0, sessions: 0, cat: 0, split: 0, style: 0, freq: 0, days: 0, basics: 1, prio: 2, low: 2, auto: 2,
  volume: 3, rir: 4, manual: 5, preview: 5, intq: 6, deloadq: 6, progq: 6 };
const OWN_PILL = { mode: 0, sessions: 0, ownday: 1, ownname: 2 };

function wizSteps() {
  const own = wiz.mode === 'own';
  if (!own && !feat('wiz-name')) return '';  // Einfach: endet nach der Aufteilung, keine Schrittleiste
  const labels = own ? ['Tage', 'Übungen', 'Name'] : ['Tage', 'Name', 'Fokus', 'Volumen', 'RIR', 'Übungen', 'Ende'];
  const cur = (own ? OWN_PILL : STEP_PILL)[wiz.step];
  return `<div class="pills wiz-steps">${labels.map((l, i) => l === 'RIR' && !feat('wiz-rir') ? ''
    : `<span class="pill ${i === cur ? 'now' : i < cur ? 'past' : ''}">${l}</span>`).join('')}</div>`;
}

// Reihenfolge der Schritte bis zur Übungsauswahl (hängt von Aufteilung und Vorlage ab)
function wizFlow() {
  // „Womit trainierst du?“ kommt zuerst (alle Modi; „Nur Maschinen“ nur Einfach/Standard) – zu Hause danach die Ausrüstung
  const eq = wiz.equip === 'home' ? ['equip', 'homeeq'] : ['equip'];
  if (wiz.mode === 'own') return [...eq, 'mode', 'sessions', 'ownday', 'ownname'];
  const custom = wiz.cat === 'custom';
  const tpl = SPLITS.find(s => s.id === wiz.split);
  // Modi: Einfach endet nach der Aufteilung (die App stellt den Rest selbst zusammen, siehe wizQuick),
  // Standard ohne Volumen-Variante und RIR-Tabelle
  const steps = [...eq, 'mode', 'level', 'sessions', 'split'];
  if (feat('wiz-style')) steps.push('style');  // style: Volumen-Variante direkt nach der Aufteilung
  if (custom) steps.push('days', 'freq');
  else {
    if (tpl && tpl.pairs && feat('wiz-freq')) steps.push('freq');
    if (feat('wiz-days')) steps.push('days');
  }
  // Einstiegswoche wird erst beim ersten Training gefragt (plan.askEntry); nach dem Fokus kommt die Frage
  // „automatisch erstellen?“, danach Volumen und RIR (erst nur zum Ansehen, mit „Bearbeiten“); Deload und Steigerung
  // werden erst ganz am Ende gefragt (Schritte deloadq/progq nach der Vorschau)
  if (feat('wiz-name')) steps.push('basics');
  if (feat('wiz-focus')) steps.push('prio', 'low');
  if (feat('wiz-volume')) steps.push('auto', 'volume');
  if (feat('wiz-rir')) steps.push('rir');
  return steps;
}

// Vorlagen mit genau so vielen Trainings pro Woche (Neulinge: nur Ganzkörper und 2er-Split)
const splitsFor = n => SPLITS.filter(s => (s.rotate || s.days.length) === n && (!wizLevel().tags || wizLevel().tags.includes(s.tag)) && !classicHidden(s.id));
const wizPrev = () => { const f = wizFlow(); return f[f.indexOf(wiz.step) - 1] || 'cancel'; };
const wizNext = () => { const f = wizFlow(); return f[f.indexOf(wiz.step) + 1]; };

// Eine Entscheidung pro Bildschirm: Frage, kurze Erklärung, Inhalt, ggf. weiterer Inhalt unter der Karte, Zurück/Weiter
const wizCard = (icon, title, explain, body, next = true, after = '') => `<div class="card wiz-q">
    <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">${icon}</span><h2>${title}</h2></div>
    <p class="hint wiz-q-explain">${explain}</p>
    ${body}
  </div>${after}${navRow(wizPrev(), next ? wizNext() : null)}`;

const navRow = (back, next, nextLabel = 'Weiter') => `<div class="row">
  <button class="btn" data-action="${back === 'cancel' ? 'wiz-cancel' : 'wiz-step'}" data-to="${back}">${back === 'cancel' ? 'Abbrechen' : 'Zurück'}</button>
  ${next ? `<button class="btn primary" data-action="wiz-step" data-to="${next}">${nextLabel}</button>` : ''}</div>`;

const weekHead = () => '<tr><th></th><th>Intro</th><th>W2</th><th>W3</th><th>W4</th></tr>';

// Gewünschte Sätze pro Woche (eingetippt) bzw. sonst Sätze pro Training × Trainings
const wizWeekly = (g, w) => {
  const want = (wiz.weekWanted[g] || [])[w];
  return want != null ? want : Math.round(wiz.volume[g][w] * sessionsWith(g));
};

function wizWeekText(g) {
  const n = sessionsWith(g);
  const v = wiz.volume[g];
  let t = `${n % 1 ? 'Ø ' : ''}${fmtNum(round1(n))} Training${n === 1 ? '' : 's'} pro Woche · Deload ${fmtNum(Math.round(Math.ceil(v[3] / 2) * n))}`;
  const uneven = [0, 1, 2, 3].filter(w => wizWeekly(g, w) !== Math.round(v[w] * n));
  if (uneven.length) t += ' · nicht glatt teilbar: beim Speichern bekommen einzelne Tage 1 Satz mehr';
  return t;
}

const focusBadge = g => wiz.prio.includes(g) ? ' <small class="focus up">⭐ +2/Woche</small>'
  : wiz.low.includes(g) ? ' <small class="focus down">😌 −2/Woche</small>' : '';

function dayCard(d, di, removable) {
  return `<div class="card wiz-day">
    <div class="ex-head"><input class="inp" type="text" data-field="wiz-dayname" data-d="${di}" value="${esc(d.name)}">
      ${removable ? `<button class="icon-btn danger" data-action="wiz-day-del" data-d="${di}" aria-label="Tag entfernen">✕</button>` : ''}</div>
    <div class="group-chips">${PLAN_GROUPS.map(g =>
      `<button class="gchip ${d.groups.includes(g) ? 'on' : ''}" data-action="wiz-daygroup" data-d="${di}" data-g="${g}">${MUSCLES[g]}</button>`).join('')}</div>
  </div>`;
}

// Hinweis für Neulinge und Einsteiger: Übungen zeigen lassen, Figuren nur grobe Info
const coachNote = () => `<div class="coach-note"><span aria-hidden="true">🧑‍🏫</span><p><b>Wichtig:</b> Lass dir die Übungen am besten
  von einem Trainer im Studio, einem Coach oder einem erfahrenen Sportler zeigen. Die Darstellungen in der App dienen nur als
  grobe Info und haben keinen Anspruch auf Vollständigkeit.</p></div>`;
const needsCoach = () => wiz.level === 'neuling' || wiz.level === 'einsteiger';

// Schritt „Erfahrung“: bestimmt empfohlene Tage, Vorlagen, Startvolumen und Tank-Ziel
function renderWizLevel() {
  // Erfahrung je Modus: Einfach („ideal für Neulinge“) Neuling/Einsteiger, Standard ohne Neuling, Experte alle
  const allowed = { e: ['neuling', 'einsteiger'], s: ['einsteiger', 'fortgeschritten', 'hase'], x: ['fortgeschritten', 'hase'] }[appMode()];
  const opts = Object.entries(LEVELS).filter(([k]) => !allowed || allowed.includes(k)).map(([k, l]) => `<button class="split-opt cat ${wiz.level === k ? 'on' : ''}" data-action="wiz-level" data-k="${k}">
      <span class="cat-icon">${l.icon}</span><b>${l.label}</b><small>${l.desc}</small></button>`).join('');
  return `<div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🎓</span><h2>Wie viel Trainingserfahrung hast du?</h2></div>
      <p class="hint wiz-q-explain">Danach richtet die App deinen Plan aus: wie viele Trainingstage sie empfiehlt, mit wie vielen Sätzen
        du startest und ${feat('tr-rir-input') ? 'wie nah du ans Muskelversagen gehst' : 'wie anstrengend die Sätze werden'}. Ehrlich einschätzen lohnt sich – steigern kannst du jederzeit.</p>
      ${opts}
    </div>${navRow(wizPrev(), null)}`;
}

// Schritt „Geräte“ (Einfach und Standard): bei „Nur Maschinen“ wählt die App nur Maschinen, Kabelzug und Multipresse
function renderWizEquip() {
  const opt = (k, icon, title, text) => `<button class="split-opt cat ${wiz.equip === k ? 'on' : ''}" data-action="wiz-equip" data-k="${k}">
      <span class="cat-icon">${icon}</span><b>${title}</b><small>${text}</small></button>`;
  return `<div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🏋️</span><h2>Womit möchtest du trainieren?</h2></div>
      <p class="hint wiz-q-explain">Danach richtet die App die Übungsauswahl aus – beim automatisch erstellten Plan und bei den Vorschlägen zum Ersetzen. Einzelne Übungen kannst du später jederzeit tauschen.</p>
      ${opt('free', '🏋️', 'Freie Gewichte und Maschinen', 'Lang- und Kurzhanteln, Maschinen und Kabelzug – die App nimmt je Muskelgruppe die passendste Übung.')}
      ${appMode() !== 'x' ? opt('machine', '⚙️', 'Nur Maschinentraining', 'Nur Geräte mit geführter Bewegung, Kabelzüge und die Multipresse – keine Lang- und Kurzhanteln. Leichter zu lernen und gut für den Start.') : ''}
      ${opt('home', '🏠', 'Zu Hause', 'Mit dem, was du daheim hast – Kurzhanteln, Kettlebells, Widerstandsbänder, Klimmzugstange oder ganz ohne Geräte. Als Nächstes trägst du deine Ausrüstung ein.')}
    </div>${navRow(wizPrev(), null)}`;
}

/* --- Heim-Ausrüstung (Assistent und Plan-Reiter): data.home --- */
const DB_CHOICES = [1, 2, 2.5, 3, 4, 5, 6, 7, 7.5, 8, 9, 10, 11, 12, 12.5, 14, 15, 16, 17.5, 18, 20, 22, 22.5, 24, 25, 26, 27.5, 28, 30, 32, 32.5, 34, 35, 36, 40];
const KB_CHOICES = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32];
const homeData = () => {
  if (!data.home) data.home = { db: [], kb: [], bands: [], anchor: false, bar: false, bench: 0, dip: false };
  return data.home;
};
// Kurzfassung, z. B. „Kurzhanteln 2–20 kg (8 Gewichte) · Bänder leicht–stark mit Türanker · Klimmzugstange“
function homeSummary(h) {
  if (!h) return 'Noch nichts eingetragen – nur Übungen ohne Geräte.';
  const kg = l => l.length === 1 ? `${fmtNum(l[0])} kg` : `${fmtNum(l[0])}–${fmtNum(l[l.length - 1])} kg (${l.length} Gewichte)`;
  const srt = l => [...l].sort((a, b) => a - b);
  const parts = [];
  if ((h.db || []).length) parts.push(`Kurzhanteln ${kg(srt(h.db))}`);
  if ((h.kb || []).length) parts.push(`Kettlebells ${srt(h.kb).map(fmtNum).join(' / ')} kg`);
  if ((h.bands || []).length) {
    const b = srt(h.bands);
    parts.push(`Bänder ${b.length > 1 ? `${BAND_LEVELS[b[0]]}–${BAND_LEVELS[b[b.length - 1]]}` : BAND_LEVELS[b[0]]}${h.anchor ? ' mit Türanker' : ''}`);
  }
  if (h.bar) parts.push('Klimmzugstange');
  if (h.bench) parts.push(h.bench >= 2 ? 'Flach- und Schrägbank' : 'Flachbank');
  if (h.dip) parts.push('Dip-Barren');
  return parts.length ? parts.join(' · ') : 'Keine Geräte – nur Übungen mit dem eigenen Körpergewicht.';
}
const homeExCount = h => Object.keys(HOME_EX).filter(n => homeOk(n, h)).length;

// Auswahlfenster: genaue Gewichte antippen (eigene dazu), Bänder, Stange, Bank, Dip-Barren
function homeEqHtml() {
  const h = homeData();
  const chip = (on, act, attrs, label) => `<button class="vchip ${on ? 'on' : ''}" data-action="${act}" ${attrs}>${label}</button>`;
  const weights = (k, choices, title, hint) => {
    const own = (h[k] || []).filter(v => !choices.includes(v));
    return `<div class="heq-block"><p class="lbl">${title}</p><p class="hint">${hint}</p>
      <div class="heq-grid">${[...choices, ...own].sort((a, b) => a - b).map(v =>
        chip((h[k] || []).includes(v), 'heq-w', `data-k="${k}" data-v="${v}"`, `${fmtNum(v)}`)).join('')}</div>
      <div class="heq-add"><input class="inp kg" type="text" inputmode="decimal" autocomplete="off" data-field="heq-${k}" placeholder="kg">
        <button class="btn" data-action="heq-add" data-k="${k}">+ anderes Gewicht</button>
        ${(h[k] || []).length ? `<button class="btn" data-action="heq-clear" data-k="${k}">Keine</button>` : ''}</div></div>`;
  };
  const flag = (k, label) => chip(!!h[k], 'heq-flag', `data-k="${k}"`, label);
  return `${weights('db', DB_CHOICES, '🏋️ Kurzhanteln – welche Gewichte hast du?', 'Gewicht je Hantel in kg. Tipp alle an, die du einstellen bzw. greifen kannst – die App schlägt nur diese vor.')}
    ${weights('kb', KB_CHOICES, '🔔 Kettlebells', 'Tipp die Gewichte an, die du hast.')}
    <div class="heq-block"><p class="lbl">🎗️ Widerstandsbänder</p><p class="hint">Welche Stärken hast du? Statt kg trägst du im Training die Bandstufe ein.</p>
      <div class="variants">${[1, 2, 3, 4].map(b => chip((h.bands || []).includes(b), 'heq-band', `data-v="${b}"`, BAND_LEVELS[b])).join('')}</div>
      ${(h.bands || []).length ? `<div class="variants">${flag('anchor', '🚪 Türanker (Band an der Tür befestigen)')}</div>` : ''}</div>
    <div class="heq-block"><p class="lbl">🧰 Weitere Ausrüstung</p>
      <div class="variants">${flag('bar', 'Klimmzugstange')}${flag('dip', 'Dip-Barren')}</div>
      <p class="hint">Hantelbank:</p>
      <div class="variants">${['Keine', 'Flachbank', 'Flach- und Schrägbank'].map((l, i) => chip((h.bench || 0) === i, 'heq-bench', `data-v="${i}"`, l)).join('')}</div></div>
    <p class="hint heq-sum">Damit gehen <b>${homeExCount(h)}</b> Übungen aus der Bibliothek – Stuhl, Sofa, Tisch und Treppe sind immer dabei.</p>
    ${(miss => miss.length ? `<p class="hint heq-miss">⚠️ Mit dieser Ausrüstung gibt es keine Übung für: <b>${miss.map(g => MUSCLES[g]).join(', ')}</b>.${(h.bands || []).length ? '' : ' Schon ein Widerstandsband hilft.'}</p>` : '')(PLAN_GROUPS.filter(g => !homeAvail(g)))}`;
}
// Wie viele Übungen gehen für eine Muskelgruppe mit der Ausrüstung?
const homeAvail = g => EXERCISE_LIST.filter(([n, , gr]) => gr === g && homeOk(n, data.home)).length;
// Tage einer Vorlage, die mit dieser Ausrüstung nur sehr wenige Übungen hätten
const homeThinDays = tpl => tpl.days.filter(([, , groups]) => groups.reduce((a, g) => a + Math.min(homeAvail(g), ['brust', 'lat', 'quadrizeps'].includes(g) ? 3 : 2), 0) <= 3).map(d => d[0]);
// Plan-Reiter (Plan „Zu Hause“): Kurzfassung mit „Ändern“
const homeEqCard = () => `<div class="card per-week home-eq-card">
    <p class="per-week-title">🏠 Deine Ausrüstung</p><p class="hint">${esc(homeSummary(data.home))}</p>
    <button class="btn outline" data-action="heq-open">Ausrüstung ändern</button></div>`;
function renderHomeEq() {
  return `<div class="card wiz-q">${homeEqHtml()}</div>
    <p class="hint">Gilt sofort für deine Pläne „Zu Hause“: Die App schlägt nur noch Gewichte vor, die du hast. Die Übungen im Plan bleiben –
      tauschen kannst du sie im Trainingstag oder im Training über „⇄ Ersetzen“ (passende Übungen stehen dort vorn).</p>
    <button class="btn primary" data-action="heq-done">Fertig</button>`;
}
// Assistent: Schritt Ausrüstung
const renderWizHomeEq = () => `<div class="card wiz-q">
    <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🏠</span><h2>Was hast du zu Hause?</h2></div>
    <p class="hint wiz-q-explain">Die App wählt nur Übungen, die mit deiner Ausrüstung gehen, und schlägt nur Gewichte vor, die du wirklich hast.
      Ändern kannst du das später im Plan-Reiter.</p>
    ${homeEqHtml()}
  </div>${navRow(wizPrev(), wizNext())}`;

// Erster Schritt: Plan mit Steigerung der App oder eigenen Plan übernehmen
function renderWizMode() {
  const opt = (m, icon, title, text) => `<button class="split-opt cat ${wiz.mode === m ? 'on' : ''}" data-action="wiz-mode" data-m="${m}">
      <span class="cat-icon">${icon}</span><b>${title}</b><small>${text}</small></button>`;
  return `<div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🧭</span><h2>Wie möchtest du deinen Plan erstellen?</h2></div>
      <p class="hint wiz-q-explain">Die App kann einen Plan für dich zusammenstellen – oder du übernimmst einfach einen Plan, den du schon hast.</p>
      ${opt('app', '📈', 'Automatisch erstellter Plan', 'Die App erstellt mit deiner Hilfe automatisiert einen Plan, der auf dich abgestimmt ist – den du aber später immer weiter für dich komplett individualisieren kannst. Sie arbeitet nach dem Prinzip des Progressive Overload: Im Training schlägt sie dir passende Steigerungen vor, in Zyklen mit leichten Deload-Wochen.')}
      ${opt('import', '📄', 'Plan aus Excel / Google Sheets', 'Dein Plan steht schon in einer Tabelle, z. B. vom Trainer? Die App liest Tage, Übungen, Sätze, Wiederholungen und Gewichte ein – wahlweise mit oder ohne ihre Steigerung (Progressive Overload).')}
      ${opt('own', '✍️', 'Eigenen Plan übernehmen', 'Du hast schon einen Plan? Trag deine Tage und Übungen mit Sätzen × Wdh. ein. Die App macht keine Steigerungsvorschläge – im Training stehen immer deine Werte vom letzten Mal, steigern musst du selbst.')}
    </div>${overloadHtml()}${navRow(wizPrev(), null)}`;
}

// Eigener Plan: Übungen eines Tages mit Sätzen × Wdh. und optionalem Startgewicht
function renderWizOwnDay() {
  const d = wiz.own[wiz.oi];
  const num = (field, e, v, mode, ph = '') => `<input class="inp own-num" type="text" inputmode="${mode}" autocomplete="off"
    data-field="${field}" data-e="${e}" value="${esc(v)}" placeholder="${ph}">`;
  const rows = d.exercises.map((x, e) => `<div class="own-ex">
      <div class="ex-name-row">
        <input class="inp" type="text" data-field="own-name" data-e="${e}" autocomplete="off" autocorrect="off" spellcheck="false"
          value="${esc(x.name)}" placeholder="Übung eintippen, z. B. Bank…">${libInfoBtn(x.name)}
      </div>
      <div class="suggest" hidden></div>
      <div class="own-nums">
        <label>Sätze${num('own-sets', e, x.sets, 'numeric')}</label><span class="own-x">×</span>
        <label>Wdh.${num('own-reps', e, x.reps, 'numeric')}</label>
        <label>kg${num('own-kg', e, x.kg, 'decimal', '–')}</label>
        <button class="icon-btn danger" data-action="own-del-ex" data-e="${e}" aria-label="Übung entfernen">✕</button>
      </div>
    </div>`).join('');
  return `<div class="card wiz-q">
      <p class="sub">Trainingstag ${wiz.oi + 1} von ${wiz.own.length}</p>
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">📝</span><h2>Deine Übungen</h2></div>
      <p class="hint wiz-q-explain">Trag die Übungen so ein, wie du sie trainierst: Sätze × Wiederholungen und – wenn du magst – das Gewicht fürs erste Training.</p>
      <label class="lbl">Name des Trainingstags
        <input class="inp" type="text" data-field="own-dayname" value="${esc(d.name)}"></label>
      ${rows}
      <button class="btn outline" data-action="own-add-ex">+ Übung hinzufügen</button>
    </div>
    <div class="row"><button class="btn" data-action="own-prev">Zurück</button>
      <button class="btn primary" data-action="own-next">Weiter</button></div>`;
}

// Eigener Plan: Name und speichern
function renderWizOwnName() {
  const count = d => d.exercises.filter(e => e.name.trim()).length;
  const list = wiz.own.map(d => `<li><b>${esc(d.name || 'Trainingstag')}</b> · ${count(d)} Übung${count(d) === 1 ? '' : 'en'}</li>`).join('');
  return wizCard('✏️', 'Wie soll dein Plan heißen?',
    'Dein Plan läuft ohne Zyklen, ohne Deload-Woche und ohne Steigerungsvorschläge. Im Training stehen immer deine Werte vom letzten Mal – Gewicht und Wiederholungen änderst du selbst. Übungen, Sätze und Wdh. kannst du später jederzeit im Plan-Reiter anpassen.',
    `<label class="lbl">Name des Plans
        <input class="inp" type="text" data-field="wiz-name" value="${esc(wiz.name)}"></label>
      <ul class="own-sum">${list}</ul>
      <button class="btn primary" data-action="wiz-commit-own">Plan speichern</button>`, false);
}

// Schritt „Trainings pro Woche“: bestimmt, welche Vorlagen vorgeschlagen werden
function renderWizSessions() {
  if (wiz.mode === 'own') {
    return `<div class="card wiz-q">
        <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">📆</span><h2>Wie viele Trainingstage hat dein Plan?</h2></div>
        <p class="hint wiz-q-explain">Gemeint sind verschiedene Trainingstage – z. B. Push, Pull und Beine = 3.</p>
        <div class="sessions-grid">${[1, 2, 3, 4, 5, 6].map(n => `<button class="sessions-opt ${wiz.own.length === n ? 'on' : ''}"
          data-action="wiz-sessions" data-n="${n}"><b>${n}</b><small>${n === 1 ? 'Tag' : 'Tage'}</small></button>`).join('')}</div>
      </div>${navRow(wizPrev(), null)}`;
  }
  // Experte: keine Empfehlung – wer so lange trainiert, weiß selbst, wie oft es passt
  const [lo, hi] = appMode() === 'x' ? [0, -1] : wizLevel().days;
  return `<div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">📆</span><h2>Wie viele Tage pro Woche möchtest du trainieren?</h2></div>
      <p class="hint wiz-q-explain">Danach schlägt dir die App passende Pläne vor.${hi >= lo ? ` Als ${wizLevel().label} sind <b>${lo}–${hi} Trainings
        pro Woche</b> ideal (markiert).` : ''} Wähle lieber eine Zahl, die du auch auf Dauer schaffst.</p>
      <div class="sessions-grid">${[1, 2, 3, 4, 5, 6].map(n => `<button class="sessions-opt ${wiz.sessions === n ? 'on' : ''} ${n >= lo && n <= hi ? 'rec' : ''}"
        data-action="wiz-sessions" data-n="${n}"><b>${n}</b><small>${n === 1 ? 'Tag' : 'Tage'}</small>${n >= lo && n <= hi ? '<em>empfohlen</em>' : ''}</button>`).join('')}</div>
    </div>${needsCoach() ? coachNote() : ''}${navRow('level', null)}`;
}

// Wie oft kommen die großen Muskelgruppen pro Woche dran? Schnitt über Brust, Rücken, Schultern und Beine (nur die, die
// der Plan trainiert); Wechsel-Pläne: Tage × Trainings ÷ Tage. Abgerundet auf halbe: ab 2 optimal, 1,5 okay, darunter
// nicht so optimal (User-Vorgabe 2026-11-04: nur den Schnitt angeben, nicht je Muskelgruppe)
const MAIN_REGIONS = [['Brust', ['brust']], ['Rücken', ['lat']], ['Schultern', ['schulter_seite']], ['Beine', ['quadrizeps', 'beinbeuger']]];
function splitFreq(s) {
  const factor = s.rotate ? s.rotate / s.days.length : 1;
  const per = g => s.days.filter(d => d[2].includes(g)).length * factor;
  const vals = [];
  for (const [, gs] of MAIN_REGIONS) {
    const present = gs.filter(g => s.days.some(d => d[2].includes(g)));
    if (present.length) vals.push(present.reduce((a, g) => a + per(g), 0) / present.length);
  }
  const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  return Math.floor(avg * 2 + 1e-9) / 2;
}
const freqRank = f => f >= 2 ? 0 : f >= 1.5 ? 1 : 2;

// Schritt „Vorlage“: passende Vorlagen zur Zahl der Trainings, dazu „Eigene Aufteilung“
function renderWizSplit() {
  const n = wiz.sessions;
  // optimal (Ø mind. 2×) zuerst, dann okay (1,5×), dann der Rest
  const list = splitsFor(n).map((s, i) => [s, i]).sort((a, b) => freqRank(splitFreq(a[0])) - freqRank(splitFreq(b[0])) || a[1] - b[1]).map(x => x[0]);
  const freqLine = s => {
    const f = splitFreq(s), txt = `Ø ${fmtNum(f)}× pro Woche je Muskel`;
    return f >= 2 ? `<span class="freq-ok">✓ ${txt} – optimal</span>` : f >= 1.5 ? `<span class="freq-mid">${txt} – okay</span>`
      : `<span class="freq-bad">${txt} – nicht so optimal</span>`;
  };
  const catOf = s => SPLIT_CATS.find(c => c.tag === s.tag) || {};
  const simpleOnly = wizLevel().tags
    ? `<p class="hint">Für den Anfang schlägt die App nur Ganzkörper-Pläne, 2er-Splits und die Klassiker vor – damit lernst du die Übungen am schnellsten.${list.length ? '' : ` Für ${n} Trainings pro Woche gibt es dafür keine Vorlage – wähle eine andere Zahl oder stelle deine Tage selbst zusammen.`}</p>`
    : '';
  return wizCard('🗂️', `Pläne für ${n} Training${n === 1 ? '' : 's'} pro Woche`,
    `Jede Vorlage bringt fertige Trainingstage mit passenden Muskelgruppen mit – im Laufe des Assistenten kannst du alles anpassen. Oder du stellst deine Trainingstage selbst zusammen.
      <br><b>💡 Tipp:</b> Am meisten bringt es, jeden Muskel <b>mindestens 2× pro Woche</b> zu trainieren – im Schnitt 1,5× (z. B. Pläne „im Wechsel“) ist auch okay. Gerade wenn du nicht so oft ins Training
      gehen kannst, sind deshalb Pläne besser, bei denen jeder Muskel an mehreren Tagen dran ist (z. B. Ganzkörper oder Ober-/Unterkörper) –
      statt Pläne, bei denen jede Muskelgruppe nur einen eigenen Tag hat. Solche Vorlagen stehen oben.`,
    simpleOnly + list.map(s => `<button class="split-opt cat ${wiz.split === s.id ? 'on' : ''}" data-action="wiz-split" data-id="${s.id}">
      <span class="cat-icon">${catOf(s).icon || '📋'}</span><b>${s.label}</b>
      <small>${s.tag} · ${s.days.map(d => d[0]).join(' · ')}${s.note ? `<br>${s.note}` : ''}<br>${freqLine(s)}${(thin => thin.length
        ? `<br><span class="freq-bad">⚠️ Mit deiner Ausrüstung wäre ${thin.map(x => `„${x}“`).join(', ')} sehr kurz – besser Ganzkörper oder Ober-/Unterkörper</span>` : '')(wizHome() ? homeThinDays(s) : [])}</small>
    </button>`).join('') +
    (feat('wiz-custom') ? `<button class="split-opt cat" data-action="wiz-custom">
      <span class="cat-icon">🛠️</span><b>Eigene Aufteilung</b><small>Trainingstage selbst zusammenstellen</small></button>` : ''), false);
}

// Schritt „Variante“: mehr Volumen mit mehr im Tank, ausgewogen oder weniger Volumen näher am Muskelversagen
function renderWizStyle() {
  const tank = k => { const r = wizRirBase(VOL_STYLES[k]); return `${fmtNum(r[0])} → ${fmtNum(r[3])}`; };
  const opt = (k, title, body) => `<button class="split-opt freq-opt int-opt ${wiz.style === k ? 'on' : ''}" data-action="wiz-style" data-k="${k}">
      <b>${title}</b><small>${body}</small></button>`;
  return wizCard('🎚️', 'Mehr Volumen oder mehr Intensität?',
    `Muskeln wachsen über zwei Stellschrauben: das <b>Volumen</b> – wie viele Arbeitssätze eine Muskelgruppe pro Woche bekommt –
      und die <b>Intensität</b> – wie nah du in jedem Satz ans Muskelversagen gehst, also wie viele Wiederholungen noch „im Tank“
      bleiben (RIR). Beides lässt sich gegeneinander tauschen: Mehr Sätze mit etwas mehr Luft wirken ähnlich wie weniger Sätze,
      die dafür härter sind. Wähle, was besser zu deiner Zeit, deiner Erholung und deinem Gefühl im Training passt.`,
    opt('high', 'Mehr Volumen, mehr im Tank', `Jede Muskelgruppe bekommt <strong>20 % mehr Arbeitssätze</strong> als bei „Ausgewogen“.
        Die Wiederholungen im Tank bleiben wie bei „Ausgewogen“ (normale Übungen: ${tank('high')} von Intro bis Woche 4).
        Damit das Mehr nicht abgeschnitten wird, steigt die Obergrenze von 25 auf 30 Sätze pro Training.`) +
    opt('mid', 'Ausgewogen', `Sätze und Tank genau so, wie die App sie für deine Erfahrung berechnet (normale Übungen: Tank ${tank('mid')}) – der Mittelweg aus beiden Varianten.`) +
    opt('low', 'Weniger Volumen, näher am Muskelversagen', `Jede Muskelgruppe bekommt <strong>20 % weniger Arbeitssätze</strong> als bei „Ausgewogen“.
        Dafür bleibt in jedem Satz etwa <strong>1 Wdh. weniger im Tank</strong> (normale Übungen: ${tank('low')} von Intro bis Woche 4, nie unter 0).
        Die Obergrenze bleibt bei 25 Sätzen pro Training.`),
    true,
    `<p class="hint">Die genauen Sätze und Tank-Werte siehst du später in den Schritten „Volumen“ und „RIR“ und kannst sie dort noch
      selbst anpassen. Grundübungen behalten wie immer 1 Wdh. mehr im Tank, Assistenzübungen 1 weniger (nie unter 0).</p>`);
}

// Schritt „Häufigkeit“: jeden Tag 1× (mehr Abwechslung) oder halb so viele Tage je 2× (einfacher)
function renderWizFreq() {
  const custom = wiz.cat === 'custom';
  const opt = (n, title, text) => `<button class="split-opt freq-opt ${wiz.perWeek === n ? 'on' : ''}" data-action="wiz-freq" data-n="${n}">
      <b>${title}</b><small>${text}</small></button>`;
  if (custom) {
    const n = wiz.days.length;
    const fits = k => wiz.sessions === n * k ? ` – passt zu deinen ${wiz.sessions} Trainings pro Woche` : '';
    return wizCard('🔁', 'Wie oft pro Woche trainierst du jeden Tag?',
      `Du hast ${n} Trainingstag${n === 1 ? '' : 'e'} zusammengestellt${wiz.sessions ? ` und möchtest ${wiz.sessions}× pro Woche trainieren` : ''}. Die Sätze pro Woche bleiben gleich – bei 2× werden sie auf doppelt so viele Trainings verteilt.`,
      opt(1, `1× pro Woche – ${n} Training${n === 1 ? '' : 's'}`, `Jeder deiner Tage kommt einmal pro Woche dran${fits(1)}.`) +
      opt(2, `2× pro Woche – ${n * 2} Trainings`, `Jeder deiner Tage kommt zweimal pro Woche dran, die Tage wiederholen sich der Reihe nach${fits(2)}.`));
  }
  const tpl = SPLITS.find(s => s.id === wiz.split);
  const all = tpl.days.map(d => d[0]), half = halfNames(tpl.id);
  return wizCard('🔁', 'Abwechslung oder Wiederholung?',
    `Beide Varianten haben <b>${all.length} Trainings pro Woche</b> und dasselbe Wochenvolumen (gleich viele Sätze pro Muskelgruppe) – sie unterscheiden sich nur darin, wie viele <b>verschiedene</b> Trainingstage es gibt.`,
    opt(1, `Mehr Abwechslung – ${all.length} verschiedene Tage`,
      `${all.join(' · ')}<br>Jeder Tag kommt 1× pro Woche dran. <strong>Was ist an den Tagen gleich?</strong> Zusammengehörige Tage – z. B. ${esc(all[0])} und ${esc(all[half.length] || all[1])} –
        trainieren dieselben Muskelgruppen mit gleich vielen Sätzen – die App setzt anfangs auch dieselben Übungen ein.
        <strong>Was ist anders?</strong> Es sind zwei eigenständige Trainingstage:
        <ul class="int-list"><li><strong>andere Übungen möglich:</strong> Am zweiten Tag kannst du Übungen austauschen – z. B. am ersten Bankdrücken mit
          der Langhantel, am zweiten Schrägbankdrücken mit Kurzhanteln (in der Übungsvorschau mit „⇄ Ersetzen“ oder später im Plan)</li>
        <li><strong>Wiederholungsbereich:</strong> Am Ende kannst du festlegen, dass ein Tag im niedrigen Wdh.-Bereich (weniger Wdh., mehr
          Gewicht) und der andere im hohen Wdh.-Bereich trainiert wird (mehr Wdh., weniger Gewicht)</li>
        <li><strong>eigener Verlauf:</strong> Die App merkt sich für jeden Tag getrennt, was du geschafft hast, und steigert jeden Tag für sich</li></ul>`) +
    opt(2, `Unkompliziert – ${half.length} Tag${half.length === 1 ? '' : 'e'}, je 2× pro Woche`,
      `${half.join(' · ')}<br>Es gibt nur halb so viele Trainingstage, jeder kommt <strong>2× pro Woche</strong> dran – beide Male mit denselben
        Übungen, Sätzen und demselben Wiederholungsbereich. Du trainierst die Tage der Reihe nach durch und musst dir weniger merken.
        Beim 2. Mal in der Woche richtet sich die App nach deinem 1. Training dieser Woche. Einzelne Übungen kannst du trotzdem
        jederzeit austauschen und alles nach Belieben anpassen.`));
}

// Schritt „Trainingstage“: Vorlage prüfen bzw. eigene Tage zusammenstellen
function renderWizDays() {
  const custom = wiz.cat === 'custom';
  let body = '';
  if (custom) {
    const lib = dayLibrary();
    body += `<p class="lbl chips-title">Vorhandene Trainingstage</p>
      <div class="group-chips">${lib.map((t, i) =>
        `<button class="gchip" data-action="wiz-lib-add" data-i="${i}">+ ${esc(t.name)}</button>`).join('')}</div>`;
    const own = data.dayTemplates;
    if (own.length) {
      body += `<p class="lbl chips-title">Selbst erstellt</p><ul class="list reorder">${own.map(t => `<li class="bw-row">
        <span>${esc(t.name)} <small class="hint">· ${t.groups.map(g => MUSCLES[g]).join(', ')}</small></span>
        <button class="icon-btn danger" data-action="wiz-lib-del" data-id="${t.id}" aria-label="Löschen">✕</button></li>`).join('')}</ul>`;
    }
    const nd = wiz.newDay;
    body += `<div class="new-day"><p class="lbl chips-title">Neuen Trainingstag erstellen</p>
      <input class="inp" type="text" data-field="wiz-newday-name" placeholder="Name, z. B. Rücken/Bizeps" value="${esc(nd.name)}">
      <div class="group-chips">${PLAN_GROUPS.map(g =>
        `<button class="gchip ${nd.groups.includes(g) ? 'on' : ''}" data-action="wiz-newday-group" data-g="${g}">${MUSCLES[g]}</button>`).join('')}</div>
      <div class="row"><button class="btn primary" data-action="wiz-newday-save">Trainingstag speichern und hinzufügen</button></div>
      <p class="hint">Wird dauerhaft gespeichert und steht später wieder zur Auswahl.</p></div>`;
  }
  let days = `<h2 class="wiz-days-title">Trainingstage im neuen Plan (${wiz.days.length})</h2>`;
  if (!wiz.days.length) days += '<p class="hint">Noch keine Tage – oben einen vorhandenen Tag antippen oder einen neuen erstellen.</p>';
  wiz.days.forEach((d, di) => { days += dayCard(d, di, custom); });
  const freq = wiz.rotate ? ` Die Tage wechseln sich ab – ${wiz.rotate} Trainings pro Woche, jeder Tag im Schnitt ${fmtNum(round1(wiz.perWeek))}× pro Woche.`
    : wiz.perWeek > 1 ? ' Jeder Tag wird 2× pro Woche trainiert.' : '';
  return wizCard('📋', custom ? 'Deine Trainingstage' : 'Passen die Trainingstage?',
    (custom
      ? 'Tippe vorhandene Tage an oder erstelle neue. Für jeden Tag legst du fest, welche Muskelgruppen trainiert werden. In welchem Wiederholungsbereich die Tage trainiert werden, fragt die App am Ende, wenn dein Plan fertig ist.'
      : 'So sieht dein Plan aus. Du kannst Namen und Muskelgruppen jedes Tages ändern – oder einfach weiter. In welchem Wiederholungsbereich die Tage trainiert werden, fragt die App am Ende, wenn dein Plan fertig ist.') + freq,
    body, true, days);
}

// Schritt „Name“ (Zykluslänge und Deload kommen am Ende, siehe renderWizDeload)
function renderWizBasics() {
  return wizCard('✏️', 'Wie soll dein Plan heißen?',
    'Der Name hilft dir, deine Pläne später auseinanderzuhalten – du kannst ihn jederzeit ändern. Wie lang ein Zyklus ist und wie der Deload abläuft, legst du ganz am Ende fest, wenn dein Plan fertig ist.',
    `<label class="lbl">Name des Plans
        <input class="inp" type="text" data-field="wiz-name" value="${esc(wiz.name)}"></label>`);
}

// Am Ende (Plan ist fertig): niedrigen und hohen Wdh.-Bereich abwechseln oder alle Tage gleich?
function renderWizInt() {
  const mode = wizIntMode();
  const alt = wizAltPossible();
  const r = (int, kind) => repRanges(needsCoach())[int][kind].join('–');  // Neulinge/Einsteiger: höhere Bereiche
  const reps = int => `Grundübungen ${r(int, 'compound')}, normale Übungen ${r(int, 'normal')}, Assistenzübungen ${r(int, 'assist')} Wdh.`;
  const list = items => `<ul class="int-list">${items.map(x => `<li>${x}</li>`).join('')}</ul>`;
  const opt = (m, title, body, disabled = false) => `<button class="split-opt freq-opt int-opt ${mode === m ? 'on' : ''}" data-action="wiz-int" data-m="${m}" ${disabled ? 'disabled' : ''}>
      <b>${title}</b><small>${body}</small></button>`;
  const altDays = wizAltIntensities();
  const pattern = wiz.days.map((d, i) => `${esc(d.name.replace(INT_NAME_RE, '').trim() || 'Tag ' + (i + 1))}: <b>${INT_NAME[altDays[i]]}</b>`).join(' · ');
  return `<div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">⚖️</span><h2>Niedrige und hohe Wiederholungen abwechseln?</h2></div>
      <p class="hint wiz-q-explain">Dein Plan ist fertig – jetzt geht es darum, in welchem <b>Wiederholungsbereich</b> du trainierst.
        Im <b>niedrigen Wdh.-Bereich</b> nimmst du mehr Gewicht für weniger Wiederholungen (${reps('heavy')}), im <b>hohen
        Wdh.-Bereich</b> weniger Gewicht für mehr Wiederholungen (${reps('light')}). <b>Intensiv sind beide Tage:</b> Sätze und
        Wiederholungen im Tank sind in beiden Bereichen dieselben, du gehst also jedes Mal nah ans Muskelversagen. Die Belastung ist
        aber eine andere – mehr Gewicht und kürzere Sätze auf der einen Seite, mehr Brennen im Muskel und längere Sätze auf der
        anderen. Beides baut Muskeln auf.</p>
      ${opt('alt', `Abwechselnd niedrige und hohe Wdh.${alt ? ' (empfohlen)' : ''}`, alt
        ? `Muskelgruppen, die mehrmals pro Woche dran sind, trainierst du einmal im niedrigen und einmal im hohen Wdh.-Bereich.
          <span class="int-days">${pattern}</span>
          <b>Vorteile:</b>${list(['du trainierst beide Bereiche: mit mehr Gewicht für die Kraft und mit mehr Wiederholungen für die Ausdauer im Muskel',
            'ideal, wenn du gerne mit schweren Gewichten arbeitest, aber nicht bei jedem Training',
            'mehr Abwechslung – Gewichte und Wiederholungen wechseln von Tag zu Tag'])}
          <b>Nachteile:</b>${list(['du arbeitest pro Übung mit zwei verschiedenen Gewichten (die App rechnet sie dir aus)',
            'Tage mit hohen Wdh. fühlen sich anders an: mehr Brennen im Muskel, mehr Puste, Sätze dauern länger',
            'wirkt nur bei Muskelgruppen, die mindestens 2× pro Woche trainiert werden'])}`
        : 'Geht bei deinem Plan nicht: Jede Muskelgruppe ist nur an einem Tag pro Woche dran. Abwechseln lohnt sich erst, wenn eine Muskelgruppe mehrmals pro Woche trainiert wird.', !alt)}
      ${opt('heavy', 'Alle Tage niedrige Wdh.', `${reps('heavy')}
        <b>Vorteile:</b>${list(['größter Fokus auf Kraft – besonders bei den Grundübungen',
          'kürzere Sätze, weniger Brennen und Puste',
          'ein einziger Gewichtsbereich pro Übung – einfach zu merken'])}
        <b>Nachteile:</b>${list(['bei wenigen Wiederholungen mit viel Gewicht kommt es besonders auf saubere Technik an – für Neulinge und Wiedereinsteiger eher weniger geeignet',
          'weniger Abwechslung'])}`)}
      ${opt('light', 'Alle Tage hohe Wdh.', `${reps('light')}
        <b>Vorteile:</b>${list(['ideal, um die Technik zu lernen – gut für Neulinge und Wiedereinsteiger',
          'Muskelaufbau klappt genauso gut, solange du nah ans Muskelversagen gehst',
          'ein einziger Gewichtsbereich pro Übung – einfach zu merken'])}
        <b>Nachteile:</b>${list(['die Maximalkraft steigt langsamer',
          'Sätze dauern länger, mehr Brennen und Puste – das Training ist etwas zeitaufwendiger',
          'bei sehr vielen Wiederholungen ist schwerer einzuschätzen, wie viele noch im Tank sind'])}`)}
      <p class="hint">Lässt sich später für jeden Trainingstag einzeln im Plan-Reiter ändern (Wdh.-Bereich: Niedrig / Hoch).</p>
    </div>
    <div class="row"><button class="btn" data-action="wiz-step" data-to="preview">Zurück</button>
      <button class="btn primary" data-action="wiz-step" data-to="deloadq">Weiter</button></div>`;
}

// Am Ende (Plan ist fertig): Zykluslänge (Trainingswochen) und Deload automatisch oder selbst bestimmen
function renderWizDeload() {
  const opt = (m, title, text) => `<button class="split-opt freq-opt ${wiz.deload === m ? 'on' : ''}" data-action="wiz-deload" data-m="${m}">
      <b>${title}</b><small>${text}</small></button>`;
  return `<div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🔄</span><h2>Wie lang soll ein Zyklus sein?</h2></div>
      <p class="hint wiz-q-explain">Dein Training läuft in <b>Zyklen</b>. Ein Zyklus beginnt mit der <b>Intro-Woche</b>: Du steigst
        etwas leichter ein und findest deine Gewichte. In den folgenden <b>Aufbauwochen</b> wird es Woche für Woche etwas fordernder –
        mehr Sätze, weniger im Tank, mehr Gewicht oder Wiederholungen. Zum Schluss kommt die leichte <b>Deload-Woche</b> zum Erholen,
        danach startet der nächste Zyklus wieder mit der Intro-Woche – auf etwas höherem Niveau als zuvor.<br><br>
        Eine Woche ist dabei ein <b>Durchlauf</b>: geschafft, sobald jeder Trainingstag einmal dran war – egal, ob du dafür 6, 7 oder
        9 Tage brauchst.<br><br>
        <b>4–5 Trainingswochen + 1 Deload-Woche</b> sind der gängige Zyklus: lang genug, um sich spürbar zu steigern, und kurz genug,
        dass sich nicht zu viel Ermüdung ansammelt. Du kannst das jederzeit anpassen – auch später noch im Trainings-Reiter.</p>
      <div class="row cyc-adj-row wiz-weeks">
        <button class="icon-btn" data-action="wiz-weeks" data-n="${wiz.weeks - 1}" ${wiz.weeks <= 4 ? 'disabled' : ''} aria-label="Eine Woche kürzer">−</button>
        <span><b>${wiz.weeks} Trainingswochen</b> + Deload<small>${cycleLenInfo(wiz.weeks).tag}</small></span>
        <button class="icon-btn" data-action="wiz-weeks" data-n="${wiz.weeks + 1}" ${wiz.weeks >= CYCLE_MAX ? 'disabled' : ''} aria-label="Eine Woche länger">+</button>
      </div>
      <p class="hint">${cycleLenInfo(wiz.weeks).text}</p>
      <p class="hint"><b>Überblick:</b> 4–5 Wochen = gängig · 6–8 Wochen = länger, dafür kleinere Steigerung von Woche zu Woche ·
        9–${CYCLE_MAX} Wochen = sehr langer Zyklus. Mit − und + stellst du die Länge ein.</p>
    </div>
    <div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">😮‍💨</span><h2>Wie soll dein Deload ablaufen?</h2></div>
      <p class="hint wiz-q-explain"><b>Was ist ein Deload?</b> Eine bewusst leichte Trainingswoche: halb so viele Sätze, etwa 15 %
        weniger Gewicht oder weniger Wiederholungen und mindestens ${DELOAD_RIR} Wiederholungen im Tank. Über die Aufbauwochen sammelt sich Ermüdung an – in
        Muskeln, Sehnen, Gelenken und im Nervensystem. Im Deload baut sie sich ab, ohne dass du Muskeln oder Kraft verlierst.
        Danach bist du meist stärker als vorher, und der nächste Zyklus beginnt mit der Intro-Woche.</p>
      ${opt('auto', 'Automatisch (empfohlen)', `Nach deinen ${wiz.weeks} Trainingswochen folgt immer automatisch die Deload-Woche – du
        musst an nichts denken. Ideal für Neulinge und Einsteiger und für alle, die einen festen Rhythmus mögen.`)}
      ${opt('self', 'Selbst bestimmen', `Die ${wiz.weeks} Trainingswochen sind dann nur der Plan bis zur ersten möglichen Pause:
        Nach der letzten Aufbauwoche geht es Woche für Woche weiter („Verlängerung“): Sätze und
        Tank bleiben wie in der letzten Aufbauwoche, Gewicht und Wiederholungen steigen weiter. Den Deload legst du per Knopf auf
        dem Startbildschirm ein, sobald du ihn brauchst – z. B. wenn Gelenke zwicken, die Kraft stagniert, du schlecht schläfst
        oder die Motivation fehlt. Beim nächsten Zyklus fragt die App, ob die Verlängerung beim Vergleich berücksichtigt werden
        soll. Für Erfahrene, die ihren Körper gut einschätzen können.`)}
      <p class="hint">Beides lässt sich später im Plan-Reiter ändern.</p>
    </div>
    <div class="row"><button class="btn" data-action="wiz-step" data-to="intq">Zurück</button>
      <button class="btn primary" data-action="wiz-step" data-to="progq">Weiter</button></div>`;
}

// Ganz am Ende: Wie soll sich der Plan steigern?
function renderWizProg() {
  return `<div class="card wiz-q">
      <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">📈</span><h2>Wie soll sich dein Plan steigern?</h2></div>
      <p class="hint wiz-q-explain">Normalerweise bleibt <b>beides an</b> – so wird dein Training Woche für Woche ein bisschen
        fordernder, und genau das bringt Fortschritt. Dahinter steckt das Prinzip <b>Progressive Overload</b>: Dein Körper wird nur
        stärker, wenn er nach und nach etwas mehr leisten muss, als er gewohnt ist.</p>
      <div class="variants">${Object.keys(PROG_KEYS).map(k => progChip(k, wiz.progression[k], 'data-action="wiz-prog"')).join('')}</div>
      <div class="prog-explain">
        <p><b>Volumen:</b> Von Woche zu Woche kommen Sätze dazu – so wie du es vorhin in der Volumen-Tabelle gesehen hast
          (Intro → Woche ${wiz.weeks}). <b>Aus:</b> Die Sätze bleiben den ganzen Zyklus auf dem Stand der Intro-Woche. Sinnvoll,
          wenn du gerade wenig Zeit hast oder dich schlecht erholst.</p>
        <p><b>Gewicht & Wdh.:</b> Die App schlägt dir von Training zu Training etwas mehr Gewicht oder mehr Wiederholungen vor –
          passend zu deinem Ziel im Tank. <b>Aus:</b> Im Training stehen immer deine Werte vom letzten Mal; das Tank-Ziel läuft
          trotzdem weiter. Sinnvoll, wenn du z. B. erst die Technik lernen willst oder nach einer Verletzung vorsichtig bist.</p>
        <p>Lässt sich später jederzeit ändern – für den ganzen Zyklus, einzelne Wochen oder ein einzelnes Training.</p>
      </div>
    </div>${overloadHtml()}
    <div class="row"><button class="btn" data-action="wiz-step" data-to="deloadq">Zurück</button>
      <button class="btn primary" data-action="wiz-commit">Plan speichern</button></div>
    <p class="hint">Der Plan wird zusätzlich zu deinen bisherigen Plänen gespeichert und aktiv gesetzt.</p>`;
}

// Schwerpunkt-Fragen: wie die Beschwerde-Abfrage, höchstens 2 Muskelgruppen
function renderWizFocus(kind) {
  const prio = kind === 'prio';
  const sel = prio ? wiz.prio : wiz.low;
  const other = prio ? wiz.low : wiz.prio;
  return `<div class="card check">
    <div class="check-emoji" aria-hidden="true">${prio ? '⭐' : '😌'}</div>
    <h2 class="question">${prio ? 'Welche Muskelgruppen möchtest du priorisieren?' : 'Welche Muskelgruppen können gerade etwas low machen?'}</h2>
    <p class="hint">Höchstens ${MAX_FOCUS} auswählen · ${prio ? `+${FOCUS_SETS}` : `−${FOCUS_SETS}`} Sätze pro Woche${sel.length ? ` · gewählt: ${sel.length}` : ''}</p>
    <div class="area-grid">${wizGroups().map(g => `<button class="vchip ${sel.includes(g) ? 'on' : ''}"
      data-action="wiz-focus" data-kind="${kind}" data-g="${g}" ${other.includes(g) ? 'disabled' : ''}>${MUSCLES[g]}</button>`).join('')}</div>
    <div class="row">
      <button class="btn" data-action="wiz-focus-none" data-kind="${kind}" data-to="${prio ? 'low' : 'auto'}">Keine</button>
      <button class="btn primary" data-action="wiz-step" data-to="${prio ? 'low' : 'auto'}">Weiter</button>
    </div>
  </div>
  <div class="row"><button class="btn" data-action="wiz-step" data-to="${prio ? 'basics' : 'prio'}">Zurück</button></div>`;
}

function renderWizard() {
  if (!wiz) return '<p class="hint">Der Assistent wurde beendet.</p><button class="btn primary" data-action="wiz-start">Neu starten</button>';
  let h = wizSteps();
  const simple = { mode: renderWizMode, ownday: renderWizOwnDay, ownname: renderWizOwnName, level: renderWizLevel, equip: renderWizEquip, homeeq: renderWizHomeEq, sessions: renderWizSessions, split: renderWizSplit, style: renderWizStyle, freq: renderWizFreq, days: renderWizDays,
    basics: renderWizBasics, intq: renderWizInt, deloadq: renderWizDeload, progq: renderWizProg };
  if (simple[wiz.step]) return h + simple[wiz.step]();
  if (wiz.step === 'prio' || wiz.step === 'low') return h + renderWizFocus(wiz.step);
  const groups = wizGroups();

  // Volumen: erst nur ansehen (mit Erklärung), „Bearbeiten“ schaltet auf die Eingabetabelle um (wiz.volEdit)
  if (wiz.step === 'volume') {
    const next = feat('wiz-rir') ? '<button class="btn primary" data-action="wiz-step" data-to="rir">Weiter</button>'
      : '<button class="btn primary" data-action="wiz-after-rir">Weiter</button>';
    if (!wiz.volEdit) {
      h += `<div class="card wiz-q">
        <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">📊</span><h2>Dein Volumen</h2></div>
        <p class="hint wiz-q-explain">Volumen = wie viele <b>Arbeitssätze</b> (ohne Aufwärmen) jede Muskelgruppe bekommt.
          Die Tabelle zeigt die Sätze <b>pro Woche</b> für jede Woche des Zyklus – von der Intro-Woche bis Woche 4. Von Woche zu
          Woche kommen Sätze dazu, damit der Trainingsreiz wächst; in der Deload-Woche wird halbiert, damit du dich erholst.
          Darunter steht, auf wie viele Trainings pro Woche sich die Sätze verteilen. Die Werte hat die App aus deiner Erfahrung,
          deinen Trainingstagen und dem Fokus berechnet (⭐ Priorität = +2 Sätze pro Woche, 😌 Low = −2).
          Gewählte Variante: <b>${wizStyle().label}</b>${wiz.style === 'high' ? ' (+20 % Sätze)' : wiz.style === 'low' ? ' (−20 % Sätze)' : ''}.</p>
        <table class="rir vol view">${weekHead()}`;
      for (const g of groups) {
        h += `<tr class="vol-g"><td colspan="5"><b>${MUSCLES[g]}</b>${focusBadge(g)}</td></tr>
          <tr><td>pro Woche</td>${[0, 1, 2, 3].map(w => `<td>${wizWeekly(g, w)}</td>`).join('')}</tr>
          <tr class="vol-week"><td colspan="5">${wizWeekText(g)}</td></tr>`;
      }
      return h + `</table>
        ${feat('wiz-volume-edit') ? '<button class="btn outline" data-action="wiz-edit" data-k="volEdit">✏️ Volumen bearbeiten</button>' : ''}</div>
        <div class="row"><button class="btn" data-action="wiz-step" data-to="auto">Zurück</button>${next}</div>`;
    }
    const inp = (field, g, w, v, cls) =>
      `<td><input class="vol-inp ${cls}" type="text" inputmode="numeric" pattern="[0-9]*" data-field="${field}" data-g="${g}" data-w="${w}" value="${v}"></td>`;
    h += `<div class="card"><h2>Volumen bearbeiten</h2>
      <p class="hint">Am einfachsten die Sätze <b>pro Woche</b> eintragen – die App verteilt sie auf die Trainings. Oder direkt die Sätze <b>pro Training</b> ändern.</p>
      <table class="rir vol">${weekHead()}`;
    for (const g of groups) {
      h += `<tr class="vol-g"><td colspan="5"><b>${MUSCLES[g]}</b>${focusBadge(g)}</td></tr>
        <tr><td>pro Woche</td>${[0, 1, 2, 3].map(w => inp('wiz-volw', g, w, wizWeekly(g, w), 'week')).join('')}</tr>
        <tr class="vol-per"><td>pro Training</td>${wiz.volume[g].map((v, w) => inp('wiz-vol', g, w, v, 'per')).join('')}</tr>
        <tr class="vol-week"><td colspan="5"><span data-wizweek="${g}">${wizWeekText(g)}</span></td></tr>`;
    }
    return h + `</table><button class="btn outline" data-action="wiz-edit" data-k="volEdit">✔ Fertig bearbeitet</button></div>
      <div class="row"><button class="btn" data-action="wiz-step" data-to="auto">Zurück</button>${next}</div>`;
  }

  // RIR: erst nur ansehen (mit Erklärung), „Bearbeiten“ schaltet auf die Eingabetabelle um (wiz.rirEdit)
  if (wiz.step === 'rir') {
    const next = `<button class="btn primary" data-action="wiz-after-rir">Weiter</button>`;
    if (!wiz.rirEdit) {
      h += `<div class="card wiz-q">
        <div class="wiz-q-head"><span class="wiz-q-icon" aria-hidden="true">🔋</span><h2>Wiederholungen im Tank (RIR)</h2></div>
        <p class="hint wiz-q-explain"><b>RIR</b> („Reps in Reserve“) = wie viele Wiederholungen du am Ende eines Satzes
          <b>noch geschafft hättest</b>. 2 im Tank heißt: Du hörst 2 Wiederholungen vor dem Muskelversagen auf. Die Tabelle zeigt
          dein Ziel je Muskelgruppe und Woche: Von Woche zu Woche wird der Tank kleiner – du trainierst näher am Versagen, der Zyklus
          wird intensiver. Die Werte gelten für <b>normale</b> Übungen; bei Grundübungen (z. B. Kniebeugen, Bankdrücken) bleibt
          1 Wdh. mehr im Tank, bei Assistenzübungen (z. B. Curls, Seitheben) 1 weniger – nie unter 0. In der Deload-Woche
          immer mindestens ${DELOAD_RIR}. Gewählte Variante: <b>${wizStyle().label}</b>${wiz.style === 'low' ? ' (etwa 1 Wdh. weniger im Tank)' : ''}.</p>
        <table class="rir vol view">${weekHead()}`;
      for (const g of groups) h += `<tr><td>${MUSCLES[g]}</td>${wiz.rir[g].map(v => `<td>${fmtNum(v)}</td>`).join('')}</tr>`;
      return h + `</table>
        <button class="btn outline" data-action="wiz-edit" data-k="rirEdit">✏️ RIR bearbeiten</button></div>
        <div class="row"><button class="btn" data-action="wiz-step" data-to="volume">Zurück</button>${next}</div>`;
    }
    h += `<div class="card"><h2>RIR bearbeiten</h2>
      <p class="hint">Ziel im Tank je Muskelgruppe und Woche für <b>normale</b> Übungen. Grundübungen bekommen +1, Assistenzübungen −1 (nie unter 0). Deload immer mind. ${DELOAD_RIR}.</p>
      <table class="rir vol">${weekHead()}
      <tr class="all-row"><td><b>Alle</b></td>${[0, 1, 2, 3].map(w =>
        `<td><input class="vol-inp" type="text" inputmode="decimal" data-field="wiz-rir-all" data-w="${w}" placeholder="–"></td>`).join('')}</tr>`;
    for (const g of groups) {
      h += `<tr><td>${MUSCLES[g]}</td>` + wiz.rir[g].map((v, w) =>
        `<td><input class="vol-inp" type="text" inputmode="decimal" data-field="wiz-rir" data-g="${g}" data-w="${w}" value="${fmtNum(v)}"></td>`).join('') + '</tr>';
    }
    return h + `</table><p class="hint">„Alle“: eine Zahl eintragen setzt die ganze Spalte auf einmal.</p>
      <button class="btn outline" data-action="wiz-edit" data-k="rirEdit">✔ Fertig bearbeitet</button></div>
      <div class="row"><button class="btn" data-action="wiz-step" data-to="volume">Zurück</button>${next}</div>`;
  }

  // Direkt nach dem Fokus: Übungen automatisch wählen lassen? (Antwort gilt nach Volumen und RIR, siehe wiz-after-rir)
  if (wiz.step === 'auto') {
    return h + `<div class="card check">
      <div class="check-emoji" aria-hidden="true">🤖</div>
      <h2 class="question">Soll ein passender Plan automatisch erstellt werden?</h2>
      <div class="row">
        <button class="btn primary" data-action="wiz-auto" data-yes="1">Ja</button>
        <button class="btn primary" data-action="wiz-auto">Nein</button>
      </div>
      <p class="hint">Ja: Die App wählt die Übungen (bevorzugt aus deinem aktiven Plan, wenig Volumen = komplexe Übungen zuerst).
        Nein: Du wählst die Übungen pro Muskelgruppe selbst aus. Als Nächstes siehst du in beiden Fällen dein Volumen und
        deine RIR-Ziele.</p>
    </div>` + navRow('low', null);
  }

  if (wiz.step === 'manual') {
    const g = groups[wiz.gi];
    const picks = wiz.picks[g] || [];
    const sugg = machineFilter(defaultPicks(g) || EXERCISE_LIST.filter(([, , gr]) => gr === g).map(([n]) => n).slice(0, 5), g)
      .filter(n => !picks.some(p => nameKey(p) === nameKey(n)));
    const n = exercisesNeeded(g);
    return h + `<div class="card"><h2>${MUSCLES[g]}${focusBadge(g)}</h2>
      <p class="sub">Muskelgruppe ${wiz.gi + 1} von ${groups.length} · Sätze pro Training: ${wiz.volume[g].join(' · ')}<br>
        Trainiert an: ${wiz.days.filter(d => d.groups.includes(g)).map(d => esc(d.name)).join(', ')}<br>
        Empfehlung: ${n} Übung${n > 1 ? 'en' : ''}</p>
      <ul class="list reorder">${picks.map((p, i) => `<li class="bw-row"><span>${esc(p)} <small class="hint">· ${KIND_SHORT[kindOf({ name: p })]}</small></span>
        ${libInfoBtn(p)}
        <button class="icon-btn danger" data-action="wiz-unpick" data-i="${i}" aria-label="Entfernen">✕</button></li>`).join('') ||
        '<li class="hint">Noch keine Übung ausgewählt.</li>'}</ul>
      <input class="inp" type="text" data-field="wiz-add" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Übung eintippen …">
      <div class="suggest" hidden></div>
      <div class="row"><button class="btn" data-action="wiz-add-typed">Eingetippte Übung hinzufügen</button></div>
      ${sugg.length ? `<p class="lbl chips-title">Vorschläge</p><div class="variants">${sugg.map(s =>
        `<button class="vchip" data-action="wiz-chip" data-name="${esc(s)}">+ ${esc(s)}</button>`).join('')}</div>` : ''}
    </div>
    <div class="row"><button class="btn" data-action="wiz-gprev">${wiz.gi === 0 && wiz.fromPreview ? 'Zur Vorschau' : 'Zurück'}</button>
      <button class="btn primary" data-action="wiz-gnext">${wiz.gi < groups.length - 1 ? 'Nächste Muskelgruppe' : 'Zur Vorschau'}</button></div>
    ${wiz.fromPreview && wiz.gi > 0 && wiz.gi < groups.length - 1 ? '<button class="btn outline" data-action="wiz-topreview">✔ Fertig – zurück zur Vorschau</button>' : ''}`;
  }

  // Vorschau
  h += `<h2>Vorschau · ${esc(wiz.name)}</h2>`;
  if (wiz.prio.length || wiz.low.length) {
    h += `<p class="hint">${wiz.prio.length ? `⭐ Priorität: ${wiz.prio.map(g => MUSCLES[g]).join(', ')}` : ''}
      ${wiz.prio.length && wiz.low.length ? ' · ' : ''}${wiz.low.length ? `😌 Low: ${wiz.low.map(g => MUSCLES[g]).join(', ')}` : ''}</p>`;
  }
  for (const [di, day] of buildPlanDays().entries()) {
    const weeks = [1, 2, 3, 4].map(w => autoSetsForDay(day, w, false, wiz.volume));
    const dl = autoSetsForDay(day, 0, true, wiz.volume);
    const open = e => wiz.swapOpen && wiz.swapOpen.d === di && nameKey(wiz.swapOpen.n) === nameKey(e.name);
    h += `<div class="card"><h2>${esc(day.name)}</h2>
      <p class="hint">Sätze: Intro · W2 · W3 · W4 · Deload</p>
      <ul class="list reorder">${day.exercises.map(e => `<li class="wiz-ex"><div><b>${esc(e.name)}</b><br>
        <small class="hint">${MUSCLES[e.group]} · ${KIND_SHORT[kindOf(e)]} · Sätze ${weeks.map(m => m.get(e.id)).join(' · ')} · D ${dl.get(e.id)}</small></div>
        ${libInfoBtn(e.name)}
        <button class="icon-btn swap" data-action="wiz-swap-open" data-d="${di}" data-n="${esc(e.name)}" aria-label="${esc(e.name)} ersetzen">⇄<small>Ersetzen</small></button></li>
        ${open(e) ? `<li class="wiz-swap">${wizSwapPanel(e.name, day)}</li>` : ''}`).join('') ||
        '<li class="hint">Keine Übungen</li>'}</ul>
      <p class="hint">Summe pro Training: ${weeks.map(m => [...m.values()].reduce((a, b) => a + b, 0)).join(' · ')}</p>
    </div>`;
  }
  const empty = groups.filter(g => !(wiz.picks[g] || []).length);
  if (empty.length) h += `<p class="complaint-note">Ohne Übung: ${empty.map(g => MUSCLES[g]).join(', ')} – diese Sätze fallen weg.</p>`;
  // höchstens 3 Sätze pro Übung: zu wenige Übungen für das Volumen?
  const tight = groups.filter(g => (wiz.picks[g] || []).length && wiz.picks[g].length * MAX_SETS_PER_EX < Math.max(...wiz.volume[g]));
  if (tight.length) {
    h += `<p class="complaint-note">Zu wenige Übungen für höchstens ${MAX_SETS_PER_EX} Sätze pro Übung: ${tight.map(g =>
      `${MUSCLES[g]} (${Math.max(...wiz.volume[g])} Sätze → mind. ${Math.ceil(Math.max(...wiz.volume[g]) / MAX_SETS_PER_EX)} Übungen)`).join(', ')}. Überzählige Sätze fallen weg.</p>`;
  }
  return h + (needsCoach() ? coachNote() : '') + `<button class="btn outline" data-action="wiz-adjust">Übungen anpassen</button>
    <div class="row"><button class="btn" data-action="wiz-step" data-to="rir">Zurück</button>
    <button class="btn primary" data-action="wiz-step" data-to="intq">Weiter</button></div>
    <p class="hint">Zum Schluss noch drei kurze Fragen: Wiederholungsbereich, Deload und Steigerung.</p>`;
}

/* --- Aktionen & Felder --- */

function wizAddPick(name) {
  const g = wizGroups()[wiz.gi];
  name = String(name).trim();
  if (!name) return;
  const picks = wiz.picks[g] = wiz.picks[g] || [];
  if (!picks.some(p => nameKey(p) === nameKey(name))) picks.push(name);
  wiz.picks[g] = byKind(picks);
  render();
}

// Tag in den Entwurf übernehmen; gleicher Name schon da -> „B“, „C“ … anhängen
function wizAddDay(t) {
  let name = t.name;
  for (let i = 1; wiz.days.some(d => nameKey(d.name) === nameKey(name)); i++) name = `${t.name} ${String.fromCharCode(65 + i)}`;
  wiz.days.push({ name, intensity: t.intensity, groups: [...t.groups] });
}

// Vorlagen können vorgeben, wie oft jeder Tag pro Woche läuft (Sätze pro Training dann passend aufgeteilt)
// Neue Tage/Häufigkeit -> Volumen, RIR, Übungen und Schwerpunkte werden neu vorgeschlagen
const wizResetPlan = () => Object.assign(wiz, { volume: {}, volKey: {}, rir: {}, picks: {}, prio: [], low: [], weekWanted: {}, swaps: {} });

// Nach Aufteilung bzw. Vorlage zum nächsten Schritt (Häufigkeit nur bei Vorlagen mit Paaren)
function wizAfterSplit() {
  wiz.perWeek = wiz.volDiv = 1;
  wizResetPlan();
  const tpl = SPLITS.find(s => s.id === wiz.split);
  // Wechsel-Plan: jeder Tag im Schnitt rotate ÷ Tage pro Woche (z. B. 1,5×) – Sätze pro Training entsprechend aufgeteilt
  wiz.rotate = wiz.cat !== 'custom' && tpl && tpl.rotate ? tpl.rotate : null;
  if (wiz.rotate) wiz.perWeek = wiz.volDiv = wiz.rotate / tpl.days.length;
  if (tpl && tpl.prio) wiz.prio = [...tpl.prio];  // Klassiker: Schwerpunkt vorab gewählt
  const f = wizFlow();
  wiz.step = f[f.indexOf('split') + 1];
  if (!wiz.step) { wizQuick(); return; }  // Einfach-Modus
  go('wizard');
}

// Einfach-Modus: nach der Aufteilung stellt die App den Plan selbst fertig – ausgewogenes Volumen, bei Vorlagen mit
// Paaren die unkomplizierte Variante (halb so viele Tage, je 2× pro Woche), Übungen automatisch, alles andere Empfehlung
function wizQuick() {
  const tpl = SPLITS.find(s => s.id === wiz.split);
  wiz.style = 'mid';
  if (tpl && tpl.pairs && wiz.cat !== 'custom') {
    wiz.perWeek = wiz.volDiv = 2;
    wiz.days = halfDays(wiz.split);
    wizResetPlan();
    if (tpl.prio) wiz.prio = [...tpl.prio];  // Klassiker: Schwerpunkt bleibt
  }
  if (tpl) wiz.name = tpl.label;
  syncGroups();
  for (const g of wizGroups()) wiz.picks[g] = autoPicks(g);
  wiz.autoYes = true;
  actions['wiz-commit']();
}

// Vorschau: Übung an einem Tag ersetzen – Schnellauswahl verwandter Übungen (ein Tipp tauscht) oder suchen
function wizSwapPanel(name, day) {
  const quick = relatedExercises(name, 6, day.exercises.map(e => e.name));
  return `<div class="replace">
    <p class="lbl">„${esc(name)}“ ersetzen – nur an diesem Tag</p>
    ${quick.length ? `<p class="hint quick-title">Schnellauswahl – ähnliche Übungen:</p>
      <div class="quick-picks">${quick.map(q => `<button class="vchip" data-action="wiz-swap-pick" data-name="${esc(q)}">${esc(q)}</button>`).join('')}</div>
      <p class="hint quick-title">… oder selbst suchen:</p>` : ''}
    <input class="inp" type="text" data-field="wiz-swap-name" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Übung eintippen …">
    <div class="suggest" hidden></div>
    <div class="row">
      <button class="btn" data-action="wiz-swap-cancel">Abbrechen</button>
      <button class="btn primary" data-action="wiz-swap-ok">Ersetzen</button>
    </div>
  </div>`;
}

// Übung (wiz.swapOpen = { d: Tag, n: angezeigter Name }) an diesem Tag gegen name tauschen
function wizSwap(name) {
  const { d, n } = wiz.swapOpen;
  name = name.trim();
  if (!name) { alert('Bitte eine Übung eingeben oder antippen.'); return; }
  const day = buildPlanDays()[d];
  if (nameKey(name) !== nameKey(n) && day.exercises.some(e => nameKey(e.name) === nameKey(name))) {
    alert(`„${name}“ ist an diesem Tag schon dabei.`); return;
  }
  const map = (wiz.swaps[d] = wiz.swaps[d] || {});
  // schon einmal ersetzt? Dann gilt der Tausch für die ursprüngliche Übung
  const orig = Object.keys(map).find(k => nameKey(map[k]) === nameKey(n)) || nameKey(n);
  if (orig === nameKey(name)) delete map[orig]; else map[orig] = name;
  wiz.swapOpen = null;
  render();
  toast(`Ersetzt durch ${name}`);
}

// eigener Plan: leere Übungszeile (Standard 3 × 10)
const ownBlank = () => ({ name: '', sets: '3', reps: '10', kg: '' });

// eigener Plan: Übung aus den Vorschlägen gewählt (neu zeichnen, damit der i-Knopf erscheint)
function wizOwnPick(input, name) {
  wiz.own[wiz.oi].exercises[input.dataset.e].name = name;
  render();
}

// „Zurück“ oben (und die Zurück-Taste des Handys): einen Schritt zurück wie der Zurück-Knopf unten,
// erst bei der ersten Frage raus aus dem Assistenten
function wizBack() {
  if (!wiz || wiz.step === 'equip') return ['plan', {}];
  if (wiz.step === 'ownday' && wiz.oi > 0) {
    wiz.oi--;
  } else if (wiz.step === 'ownname') {
    wiz.step = 'ownday';
    wiz.oi = wiz.own.length - 1;
  } else if (wiz.step === 'manual') {
    if (wiz.gi > 0) wiz.gi--;
    else { wiz.step = wiz.fromPreview ? 'preview' : 'rir'; wiz.fromPreview = false; }
  } else if (wiz.step === 'preview') {
    wiz.step = 'rir';
  } else if (wiz.step === 'intq') {
    wiz.step = 'preview';
  } else if (wiz.step === 'deloadq') {
    wiz.step = 'intq';
  } else if (wiz.step === 'progq') {
    wiz.step = 'deloadq';
  } else {
    const to = wizPrev();
    if (to === 'cancel') return ['plan', {}];
    if (to === 'volume') syncGroups();
    wiz.step = to;
  }
  return ['wizard', {}];
}

views.wizard = { title: 'Neuer Plan', tab: 'plan', back: wizBack, render: renderWizard,
  cancel: () => wiz ? { ask: 'Plan-Erstellung abbrechen?\n\nDeine bisherigen Eingaben gehen verloren.', run: () => { wiz = null; go('plan'); } } : null };

Object.assign(actions, {
  'wiz-start': () => wizStart(),
  'wiz-cancel': () => actions.cancel(),
  // Vorschau: Übung an einem Tag ersetzen
  'wiz-swap-open': el => {
    const same = wiz.swapOpen && wiz.swapOpen.d === +el.dataset.d && wiz.swapOpen.n === el.dataset.n;
    wiz.swapOpen = same ? null : { d: +el.dataset.d, n: el.dataset.n };
    render();
    const panel = $view.querySelector('.wiz-swap');
    if (panel) panel.scrollIntoView({ block: 'nearest' });
  },
  'wiz-swap-cancel': () => { wiz.swapOpen = null; render(); },
  'wiz-swap-pick': el => wizSwap(el.dataset.name),
  'wiz-swap-ok': () => wizSwap($view.querySelector('[data-field="wiz-swap-name"]').value),
  'wiz-weeks': el => { wiz.weeks = Math.min(CYCLE_MAX, Math.max(4, Number(el.dataset.n))); render(); },
  'wiz-deload': el => { wiz.deload = el.dataset.m; render(); },
  'wiz-int': el => { wiz.intMode = el.dataset.m; render(); },
  // 1× / 2× pro Woche. Vorlage mit Paaren: 2× = nur die erste Hälfte der Tage (gleich viele Trainings).
  // Die Sätze pro Woche bleiben immer gleich (volDiv = perWeek).
  'wiz-freq': el => {
    const n = Number(el.dataset.n);
    if (n !== wiz.perWeek) {
      wiz.perWeek = wiz.volDiv = n;
      if (wiz.cat !== 'custom') wiz.days = n === 2 ? halfDays(wiz.split) : splitDays(wiz.split);
      wizResetPlan();
    }
    render();
  },
  'wiz-prog': el => { wiz.progression[el.dataset.key] = !wiz.progression[el.dataset.key]; render(); },
  // Aufteilung wählen (leer = zurück zur Vorauswahl); gibt es nur eine Vorlage, wird sie direkt gewählt
  // Erfahrung wählen: ändert Empfehlungen, Vorlagen, Volumen und Tank -> Plan wird neu vorgeschlagen
  'wiz-level': el => {
    if (wiz.level !== el.dataset.k) {
      wiz.level = el.dataset.k;
      wiz.sessions = null; wiz.cat = null; wiz.split = null; wiz.days = [];
      wizResetPlan();
    }
    const f = wizFlow();
    wiz.step = f[f.indexOf('level') + 1];
    go('wizard');
  },
  // Geräte: freie Gewichte + Maschinen oder nur Maschinen -> Übungen werden danach neu gewählt
  'wiz-equip': el => {
    if (wiz.equip !== el.dataset.k) { wiz.equip = el.dataset.k; wiz.picks = {}; wiz.swaps = {}; }
    if (wiz.equip === 'home') homeData();
    const f = wizFlow();
    wiz.step = f[f.indexOf('equip') + 1];
    go('wizard');
  },
  // Heim-Ausrüstung (Assistent und Plan-Reiter)
  'heq-w': el => {
    const h = homeData(), k = el.dataset.k, v = Number(el.dataset.v);
    h[k] = h[k].includes(v) ? h[k].filter(x => x !== v) : [...h[k], v].sort((a, b) => a - b);
    if (wiz) wiz.picks = {};
    saveData(); render();
  },
  'heq-add': el => {
    const h = homeData(), k = el.dataset.k;
    const inp = document.querySelector(`[data-field="heq-${k}"]`);
    const v = parseNum(inp && inp.value);
    if (v == null || v <= 0 || v > 100) { alert('Bitte ein Gewicht zwischen 0,5 und 100 kg eintragen.'); return; }
    const r = Math.round(v * 4) / 4;
    if (!h[k].includes(r)) h[k] = [...h[k], r].sort((a, b) => a - b);
    if (wiz) wiz.picks = {};
    saveData(); render();
  },
  'heq-clear': el => { homeData()[el.dataset.k] = []; if (wiz) wiz.picks = {}; saveData(); render(); },
  'heq-band': el => {
    const h = homeData(), v = Number(el.dataset.v);
    h.bands = h.bands.includes(v) ? h.bands.filter(x => x !== v) : [...h.bands, v].sort();
    if (wiz) wiz.picks = {};
    saveData(); render();
  },
  'heq-flag': el => { const h = homeData(); h[el.dataset.k] = !h[el.dataset.k]; if (wiz) wiz.picks = {}; saveData(); render(); },
  'heq-bench': el => { homeData().bench = Number(el.dataset.v); if (wiz) wiz.picks = {}; saveData(); render(); },
  'heq-open': () => go('homeeq'),
  'heq-done': () => go('plan'),
  // App-Plan oder eigenen Plan übernehmen
  'wiz-mode': el => {
    if (el.dataset.m === 'import') { actions['tp-open'](); return; }  // Tabelle übernehmen (trainplan.js)
    wiz.mode = el.dataset.m;
    wiz.step = wiz.mode === 'own' ? 'sessions' : 'level';
    go('wizard');
  },
  // Trainings pro Woche wählen -> passende Vorlagen (eigener Plan: so viele Tage zum Ausfüllen)
  'wiz-sessions': el => {
    if (wiz.mode === 'own') {
      const n = Number(el.dataset.n);
      while (wiz.own.length < n) wiz.own.push({ name: `Tag ${String.fromCharCode(65 + wiz.own.length)}`, exercises: [ownBlank()] });
      wiz.own.length = n;
      Object.assign(wiz, { oi: 0, step: 'ownday' });
      go('wizard');
      return;
    }
    wiz.sessions = Number(el.dataset.n);
    wiz.cat = null; wiz.split = null; wiz.days = [];
    wizResetPlan();
    wiz.step = 'split';
    go('wizard');
  },
  // Vorlage wählen: Tage neu setzen, Volumen/RIR/Übungen werden danach neu vorgeschlagen
  // Volumen-Variante: Volumen und Tank werden danach neu vorgeschlagen
  'wiz-style': el => {
    if (wiz.style !== el.dataset.k) { wiz.style = el.dataset.k; wiz.rir = {}; wiz.volKey = {}; }
    render();
  },
  'wiz-split': el => {
    wiz.split = el.dataset.id;
    wiz.cat = SPLITS.find(s => s.id === wiz.split).tag;
    wiz.days = splitDays(wiz.split);
    wizAfterSplit();
  },
  // Eigene Aufteilung: Trainingstage selbst zusammenstellen
  'wiz-custom': () => {
    wiz.cat = 'custom'; wiz.split = null; wiz.days = [];
    wizAfterSplit();
  },
  // eigener Plan: Übungen eines Tages
  'own-add-ex': () => {
    wiz.own[wiz.oi].exercises.push(ownBlank());
    render();
    const inputs = $view.querySelectorAll('[data-field="own-name"]');
    inputs[inputs.length - 1].focus();
  },
  'own-del-ex': el => { wiz.own[wiz.oi].exercises.splice(Number(el.dataset.e), 1); render(); },
  'own-prev': () => actions.back(),
  'own-next': () => {
    const d = wiz.own[wiz.oi];
    if (!d.exercises.some(e => e.name.trim())) { alert('Bitte mindestens eine Übung für diesen Tag eintragen.'); return; }
    if (wiz.oi < wiz.own.length - 1) wiz.oi++; else wiz.step = 'ownname';
    go('wizard');
  },
  // eigenen Plan speichern: Tage „Frei“ (Sätze × Wdh. pro Übung), ohne Progression, Zyklen und Deload
  'wiz-commit-own': () => {
    if (draft && !confirm(`Es läuft noch ein Training (${draft.dayName}). Trotzdem den neuen Plan aktiv setzen?`)) return;
    const int = (s, def, max) => Math.min(max, Math.max(1, Math.round(parseNum(s) || def)));
    const days = wiz.own.map(d => ({
      id: uid(),
      name: d.name.trim() || 'Trainingstag',
      intensity: '',
      exercises: d.exercises.filter(e => e.name.trim()).map(e => {
        const sets = int(e.sets, 3, 20);
        return withDefaults({ id: uid(), name: e.name.trim(), sets, setsEnd: sets, reps: int(e.reps, 10, 50), startWeight: parseNum(e.kg) });
      }),
    }));
    const plan = newPlan(wiz.name.trim() || 'Mein Plan', days);
    Object.assign(plan, { own: true, progression: { volume: false, load: false } });
    if (wizMachines()) plan.equip = 'machine';  // Ersetzen: passende Übungen zuerst
    if (wizHome()) plan.equip = 'home';
    data.plans.push(plan);
    data.activePlanId = plan.id;
    setRound(newCycleId(), 1, 1);
    saveData();
    wiz = null;
    toast(`„${plan.name}“ erstellt und aktiv ✔`);
    go('plan');
  },
  'wiz-lib-add': el => { wizAddDay(dayLibrary()[Number(el.dataset.i)]); render(); },
  'wiz-lib-del': el => {
    const t = data.dayTemplates.find(x => x.id === el.dataset.id);
    if (!confirm(`Eigenen Trainingstag „${t.name}“ dauerhaft löschen?`)) return;
    data.dayTemplates = data.dayTemplates.filter(x => x !== t);
    saveData(); render();
  },
  'wiz-newday-int': el => { wiz.newDay.intensity = el.dataset.k; render(); },
  'wiz-newday-group': el => {
    const nd = wiz.newDay, g = el.dataset.g;
    nd.groups = nd.groups.includes(g) ? nd.groups.filter(x => x !== g) : [...nd.groups, g];
    render();
  },
  // neuen Trainingstag dauerhaft speichern (data.dayTemplates) und gleich in den Entwurf übernehmen
  'wiz-newday-save': () => {
    const nd = wiz.newDay;
    if (!nd.name.trim()) { alert('Bitte einen Namen für den Trainingstag eingeben.'); return; }
    if (!nd.groups.length) { alert('Bitte mindestens eine Muskelgruppe auswählen.'); return; }
    const t = { id: uid(), name: nd.name.trim(), intensity: nd.intensity, groups: [...nd.groups] };
    data.dayTemplates.push(t);
    saveData();
    wizAddDay(t);
    wiz.newDay = { name: '', intensity: 'heavy', groups: [] };
    render();
    toast(`„${t.name}“ gespeichert und hinzugefügt`);
  },
  'wiz-day-del': el => { wiz.days.splice(Number(el.dataset.d), 1); render(); },
  'wiz-dayint': el => { wiz.days[el.dataset.d].intensity = el.dataset.k; render(); },
  'wiz-daygroup': el => {
    const d = wiz.days[el.dataset.d], g = el.dataset.g;
    d.groups = d.groups.includes(g) ? d.groups.filter(x => x !== g) : [...d.groups, g];
    render();
  },
  'wiz-focus': el => {
    const list = el.dataset.kind === 'prio' ? wiz.prio : wiz.low;
    const g = el.dataset.g;
    const i = list.indexOf(g);
    if (i >= 0) list.splice(i, 1);
    else if (list.length >= MAX_FOCUS) { toast(`Höchstens ${MAX_FOCUS} Muskelgruppen`); return; }
    else list.push(g);
    render();
  },
  'wiz-focus-none': el => {
    if (el.dataset.kind === 'prio') wiz.prio = []; else wiz.low = [];
    actions['wiz-step'](el);
  },
  'wiz-step': el => {
    const to = el.dataset.to;
    const leavingDays = wiz.step === 'days' && wizFlow().indexOf(to) > wizFlow().indexOf('days');
    if (leavingDays) {
      if (!wiz.days.length) { alert('Bitte mindestens einen Trainingstag hinzufügen.'); return; }
      if (!wizGroups().length) { alert('Bitte den Trainingstagen Muskelgruppen zuweisen.'); return; }
      // Schwerpunkte nur für Muskelgruppen, die noch im Plan sind
      wiz.prio = wiz.prio.filter(g => wizGroups().includes(g));
      wiz.low = wiz.low.filter(g => wizGroups().includes(g));
    }
    if (to === 'volume') syncGroups();
    wiz.volEdit = wiz.rirEdit = false;  // Volumen/RIR erst wieder nur zum Ansehen
    wiz.step = to;
    go('wizard');
  },
  // Antwort merken, dann erst Volumen und RIR zeigen (Übungen werden danach gewählt, siehe wiz-after-rir)
  'wiz-auto': el => {
    wiz.autoYes = !!el.dataset.yes;
    syncGroups();
    wiz.volEdit = wiz.rirEdit = false;
    wiz.step = 'volume';
    go('wizard');
  },
  // Volumen/RIR: zwischen Ansehen und Bearbeiten umschalten (data-k = volEdit | rirEdit)
  'wiz-edit': el => { wiz[el.dataset.k] = !wiz[el.dataset.k]; render(); },
  'wiz-after-rir': () => {
    wiz.fromPreview = false;
    wiz.volEdit = wiz.rirEdit = false;
    if (wiz.autoYes) {
      for (const g of wizGroups()) wiz.picks[g] = autoPicks(g);
      wiz.step = 'preview';
    } else {
      wiz.gi = 0;
      wiz.step = 'manual';
    }
    go('wizard');
  },
  // Übungen aus der Vorschau heraus anpassen: „Zurück“ bei der ersten Muskelgruppe führt wieder zur Vorschau
  'wiz-adjust': () => { wiz.gi = 0; wiz.step = 'manual'; wiz.fromPreview = true; go('wizard'); },
  'wiz-gprev': () => {
    if (wiz.gi > 0) wiz.gi--;
    else { wiz.step = wiz.fromPreview ? 'preview' : 'rir'; wiz.fromPreview = false; }
    go('wizard');
  },
  'wiz-gnext': () => {
    if (wiz.gi < wizGroups().length - 1) wiz.gi++;
    else { wiz.step = 'preview'; wiz.fromPreview = false; }
    go('wizard');
  },
  'wiz-topreview': () => { wiz.step = 'preview'; wiz.fromPreview = false; go('wizard'); },
  'wiz-unpick': el => { wiz.picks[wizGroups()[wiz.gi]].splice(Number(el.dataset.i), 1); render(); },
  'wiz-chip': el => wizAddPick(el.dataset.name),
  'wiz-add-typed': () => {
    const input = $view.querySelector('[data-field="wiz-add"]');
    if (!input.value.trim()) { alert('Bitte erst eine Übung eintippen.'); return; }
    wizAddPick(input.value);
  },
  'wiz-commit': () => {
    const days = buildPlanDays();
    if (!days.some(d => d.exercises.length)) { alert('Der Plan enthält noch keine Übungen.'); return; }
    if (draft && !confirm(`Es läuft noch ein Training (${draft.dayName}). Trotzdem den neuen Plan aktiv setzen?`)) return;
    const plan = newPlan(wiz.name.trim() || 'Neuer Plan', days);
    plan.volume = wiz.volume;
    plan.rirPlan = wiz.rir;
    plan.progression = { ...wiz.progression };
    plan.perWeek = wiz.rotate ? 1 : wiz.perWeek;
    if (wiz.rotate) plan.rotate = wiz.rotate;  // Wechsel-Plan (siehe dayTimes in app.js)
    if (wiz.level) plan.level = wiz.level;
    if (wizMachines()) plan.equip = 'machine';  // Ersetzen schlägt dann zuerst Maschinen vor
    if (wizHome()) plan.equip = 'home';          // nur vorhandene Gewichte, Ersetzen zuerst passende Heim-Übungen
    data.plans.push(plan);
    data.activePlanId = plan.id;
    // eingetippte Wochenzahlen jetzt mit den echten Tagen genau verteilen (ggf. 1 Satz mehr an einzelnen Tagen)
    for (const [g, list] of Object.entries(wiz.weekWanted)) {
      list.forEach((n, w) => { if (n != null && plan.volume[g]) setWeeklyVolume(g, w, n); });
    }
    data.cycle.defWeeks = wiz.weeks;
    data.cycle.adj = 0;
    data.cycle.buildWeeks = wiz.weeks;
    if (wiz.deload === 'self') plan.deload = 'self';
    // neuer Zyklus 1 – mit welcher Woche er beginnt, fragt die App beim ersten Training (siehe entryweek in app.js)
    setRound(newCycleId(), 1, 1);
    plan.askEntry = true;
    saveData();
    wiz = null;
    toast(`„${plan.name}“ erstellt und aktiv ✔`);
    go('plan');
  },
});

Object.assign(fields, {
  'wiz-name': el => { wiz.name = el.value; },
  'wiz-swap-name': el => showSuggestions(el),
  'wiz-dayname': el => { wiz.days[el.dataset.d].name = el.value; },
  // eigener Plan (Werte als Text, ausgewertet beim Speichern)
  'own-dayname': el => { wiz.own[wiz.oi].name = el.value; },
  'own-name': el => { wiz.own[wiz.oi].exercises[el.dataset.e].name = el.value; showSuggestions(el); },
  'own-sets': el => { wiz.own[wiz.oi].exercises[el.dataset.e].sets = el.value; },
  'own-reps': el => { wiz.own[wiz.oi].exercises[el.dataset.e].reps = el.value; },
  'own-kg': el => { wiz.own[wiz.oi].exercises[el.dataset.e].kg = el.value; },
  'wiz-newday-name': el => { wiz.newDay.name = el.value; },
  // Sätze pro Training (für alle Tage gleich) -> Wochenzahl anpassen
  'wiz-vol': el => {
    const n = parseInt(el.value, 10);
    if (!isFinite(n) || n < 0 || n > 30) return;
    const g = el.dataset.g, w = +el.dataset.w;
    wiz.volume[g][w] = n;
    if (wiz.weekWanted[g]) wiz.weekWanted[g][w] = null;
    const week = $view.querySelector(`[data-field="wiz-volw"][data-g="${g}"][data-w="${w}"]`);
    if (week) week.value = wizWeekly(g, w);
    const t = $view.querySelector(`[data-wizweek="${g}"]`);
    if (t) t.textContent = wizWeekText(g);
  },
  // Sätze pro Woche -> pro Training (abgerundet); der Rest wird beim Speichern auf einzelne Tage verteilt
  'wiz-volw': el => {
    const n = parseInt(el.value, 10);
    if (!isFinite(n) || n < 1 || n > 80) return;
    const g = el.dataset.g, w = +el.dataset.w;
    const sessions = Math.max(1, sessionsWith(g));
    wiz.volume[g][w] = Math.max(1, Math.floor(n / sessions));
    (wiz.weekWanted[g] || (wiz.weekWanted[g] = [null, null, null, null]))[w] = n;
    const per = $view.querySelector(`[data-field="wiz-vol"][data-g="${g}"][data-w="${w}"]`);
    if (per) per.value = wiz.volume[g][w];
    const t = $view.querySelector(`[data-wizweek="${g}"]`);
    if (t) t.textContent = wizWeekText(g);
  },
  'wiz-rir': el => {
    const n = parseNum(el.value);
    if (n == null || n < 0 || n > 6) return;
    wiz.rir[el.dataset.g][+el.dataset.w] = n;
  },
  // „Alle“: ganze Spalte auf einmal setzen
  'wiz-rir-all': el => {
    const n = parseNum(el.value);
    if (n == null || n < 0 || n > 6) return;
    const w = +el.dataset.w;
    for (const g of wizGroups()) {
      wiz.rir[g][w] = n;
      const inp = $view.querySelector(`[data-field="wiz-rir"][data-g="${g}"][data-w="${w}"]`);
      if (inp) inp.value = fmtNum(n);
    }
  },
  'wiz-add': el => {
    const g = wizGroups()[wiz.gi];
    // Übungen dieser Muskelgruppe zuerst vorschlagen
    const pool = [...EXERCISE_LIST.filter(([, , gr]) => gr === g).map(([n]) => n), ...ownExerciseNames(), ...EXERCISES];
    showSuggestions(el, uniqueNames(pool));
  },
});
