'use strict';

// Einführung („Spotlight“): Beim ersten Öffnen eines Fensters wird der Bildschirm abgedunkelt, ein Knopf bleibt hell
// und eine Sprechblase erklärt ihn. Jeder Schritt ist an die Funktion gekoppelt, die er erklärt (feat bzw. ob das
// Element zu sehen ist) – nach einem Moduswechsel erscheinen so nur die Schritte der neu sichtbaren Funktionen.
// Gesehen wird je Schritt gemerkt: data.tour = { seen: { id: 1 }, off }.
// Schritt: { id, sel (CSS, Alternativen mit „|“), title, text (Text oder Funktion), feat (optional) }

const TOURS = {
  start: [
    { id: 'start-day', sel: '.day-btn.next|.day-btn', title: 'Training starten',
      text: 'Tipp einen Trainingstag an, um loszulegen. „Steht als Nächstes an“ zeigt, welcher Tag dran ist. Darunter stehen die Zahl der Übungen, die geschätzte Dauer und wann du den Tag zuletzt trainiert hast.' },
    { id: 'start-cycle', sel: '.card.cycle h2', title: 'Dein Zyklus',
      text: 'Hier siehst du, in welcher Woche du gerade bist. Die App steigert Woche für Woche, danach kommt eine leichtere Deload-Woche zur Erholung. Eine Woche ist geschafft, sobald alle Tage trainiert sind – egal, wie lange du dafür brauchst.' },
    { id: 'start-week', sel: '.card.cycle .pills', feat: 'week-view', title: 'Wochen ansehen',
      text: 'Tipp eine Woche an, um ihre Trainings zu sehen und zu bearbeiten.' },
    { id: 'start-cycadj', sel: '.cyc-adjust-btn', feat: 'cycle-adjust', title: 'Zyklus anpassen',
      text: 'Hier kannst du in eine andere Woche wechseln, den Zyklus verlängern oder verkürzen oder ihn beenden.' },
    { id: 'start-time', sel: '.time-btn', title: 'Wenig Zeit?',
      text: 'Gib ein, wie viele Minuten du hast – die App kürzt das Training und behält dabei möglichst jede Muskelgruppe und die Grundübungen.' },
    { id: 'start-skip', sel: '.skip-btn', title: 'Tage auslassen',
      text: 'Ungeplante Pause? Hier lässt du Tage dieser Woche aus und machst mit einem anderen Tag weiter.' },
    { id: 'start-cardio', sel: '.cardio-btn', title: 'Cardio',
      text: 'Hier trägst du Ausdauertraining ein, z. B. Laufen, Radfahren oder Crosstrainer – mit Dauer, Strecke und Kalorien.' },
    { id: 'start-tabs', sel: '#tabs', title: 'Die Bereiche der App',
      text: 'Unten wechselst du zwischen Training, Plan, Verlauf, Diagrammen, Ernährung und Optionen (z. B. Sicherung, Aussehen und Modus).' },
  ],
  training: [
    { id: 'tr-timer', sel: '.timer-bar', title: 'Trainingszeit',
      text: 'Die Zeit läuft mit. Beim Speichern wird sie festgehalten – beim nächsten Mal siehst du sie am Trainingstag.' },
    { id: 'tr-prog', sel: '.prog-card', feat: 'tr-prog', title: 'Progression heute',
      text: 'Fühlst du dich heute nicht fit, kannst du die Steigerung nur für dieses Training ausschalten – dann gelten die Werte vom letzten Mal.' },
    { id: 'tr-reorder', sel: '[data-action="reorder-toggle"]', title: 'Reihenfolge ändern',
      text: 'Ist ein Gerät besetzt? Hier änderst du die Reihenfolge der Übungen für heute.' },
    { id: 'tr-info', sel: 'section.card h2 .info-dot|section.card .info-btn', title: 'Übung ansehen',
      text: 'Tipp auf den Namen mit dem „i“: Dann siehst du die Übung als Animation mit Anleitung.' },
    { id: 'tr-tools', sel: 'section.card .ex-tools', title: 'Kommentar und Ersetzen',
      text: () => (feat('tr-comment') ? '„Kommentar“: eine Notiz zur Übung, z. B. die Sitzhöhe – sie erscheint beim nächsten Mal wieder. ' : '')
        + '„Ersetzen“: die Übung heute gegen eine ähnliche tauschen, z. B. wenn das Gerät besetzt ist. Der Plan bleibt, wie er ist.' },
    { id: 'tr-warm', sel: 'section.card .warmup', title: 'Aufwärmen',
      text: 'Vor der ersten schweren Übung schlägt die App Aufwärmsätze vor. Antippen klappt sie auf – sie zählen nicht als Arbeitssätze.' },
    { id: 'tr-target', sel: 'section.card .target', title: 'Ziel für heute',
      text: () => feat('tr-tank-target')
        ? 'Sätze × Wiederholungen und der Tank: So viele Wiederholungen sollten am Ende eines Satzes noch gehen.'
        : 'Sätze × Wiederholungen und wie anstrengend die Sätze sein sollen.' },
    { id: 'tr-max', sel: 'section.card .max-mini', feat: 'tr-max', title: 'Max. kg bei 10 Wdh.',
      text: 'Das Gewicht, mit dem du frisch gerade so 10 saubere Wiederholungen schaffst – also als erste Übung für diesen Muskel. Steht die Übung weiter hinten, zieht die App die Vorermüdung selbst ab. Unbekannt? Leer lassen – die App errechnet es aus deinem ersten Satz.' },
    { id: 'tr-step', sel: 'section.card [data-action="tr-step-open"]', feat: 'tr-step', title: 'Steigerung',
      text: 'Um so viel kg geht das Gewicht hoch, wenn die App mehr vorschlägt – z. B. 2,5 kg an der Langhantel oder 5 kg an manchen Maschinen.' },
    { id: 'tr-variant', sel: 'section.card [data-action="ex-variant-open"]', feat: 'tr-variants', title: 'Ausführung',
      text: 'Normal, mit Pause oder langsam. Sätze werden nur mit gleich ausgeführten Sätzen verglichen.' },
    { id: 'tr-kg', sel: 'section.card [data-field="tr-weight"]|section.card .bw-cell', title: 'Gewicht',
      text: () => document.querySelector('section.card [data-field="tr-weight"]')
        ? 'Hier trägst du ein, wie viel Gewicht du verwendet hast. Der Vorschlag der App steht schon drin – nimmst du ein anderes Gewicht, überschreib ihn einfach.'
        : 'Bei dieser Übung trainierst du mit deinem Körpergewicht (bzw. mit Band) – hier musst du kein Gewicht eintragen.' },
    { id: 'tr-reps', sel: 'section.card [data-field="tr-reps"]', title: 'Wiederholungen',
      text: 'Hier trägst du ein, wie viele Wiederholungen du geschafft hast. Auch hier steht der Vorschlag schon drin – hast du mehr oder weniger geschafft, trag die echte Zahl ein.' },
    { id: 'tr-feel', sel: 'section.card .feel-btn', title: 'Wie schwer war der Satz?',
      text: 'Hier tippst du nach jedem Satz an, wie schwer er sich angefühlt hat: 😊 locker, 💪 gut, 😤 hart oder 🔥 ging nichts mehr. Erst dann zählt der Satz als erledigt. Wichtig: Daraus berechnet die App die nächsten Sätze und die Vorgaben fürs nächste Training – gib es deshalb ehrlich an.' },
    { id: 'tr-tank', sel: 'section.card .setgrid .tank', title: 'Wdh. im Tank',
      text: 'Hier trägst du ein, wie viele Wiederholungen noch im Tank waren – also wie viele du noch geschafft hättest, bevor nichts mehr ging (0 = gar keine mehr). Erst mit dieser Zahl zählt der Satz als erledigt. Wichtig: Daraus berechnet die App die folgenden Sätze und die Vorgaben fürs nächste Training – lieber ehrlich schätzen, als einfach das Ziel einzutragen.' },
    { id: 'tr-setbtns', sel: 'section.card .set-btns', feat: 'tr-sets', title: 'Sätze',
      text: 'Hier fügst du einen Satz hinzu oder entfernst einen.' },
    { id: 'tr-add', sel: '[data-action="add-open"]', feat: 'tr-add', title: 'Übung hinzufügen',
      text: 'Eine zusätzliche Übung nur für heute – auf Wunsch auch dauerhaft im Plan.' },
    { id: 'tr-save', sel: '[data-action="tr-save"]', title: 'Speichern',
      text: 'Zum Schluss speichern. Die App merkt sich alles und berechnet daraus dein nächstes Training.' },
  ],
  plan: [
    { id: 'plan-list', sel: '.plan-row.active', title: 'Dein Plan',
      text: () => 'Hier steht dein aktiver Plan mit der geschätzten Dauer pro Training. Mit ✎ benennst du ihn um.'
        + (feat('plans-multi') ? ' Hast du mehrere Pläne, aktivierst du einen anderen durch Antippen.' : '') },
    { id: 'plan-new', sel: '[data-action="wiz-start"]', title: 'Neuen Plan erstellen',
      text: 'Der Assistent stellt dir Schritt für Schritt einen neuen Plan zusammen – automatisch passend zu dir oder aus deinem eigenen Plan.' },
    { id: 'plan-import', sel: '.tp-open-btn', title: 'Plan aus einer Tabelle',
      text: 'Hast du deinen Plan in Excel oder Google Sheets? Hier übernimmst du ihn – mit oder ohne Steigerung der App.' },
    { id: 'plan-end', sel: '[data-action="plan-end"]', title: 'Plan beenden',
      text: 'Beendet den aktiven Plan. Deine Trainings, Bestleistungen und Erfolge bleiben erhalten.' },
    { id: 'plan-lib', sel: '.lib-open-btn', title: 'Übungsbibliothek',
      text: 'Alle Übungen mit Animation, Kurzanleitung und ausführlicher Anleitung – auch zum Nachschlagen vor dem Training.' },
    { id: 'plan-day', sel: '.day-btn', title: 'Trainingstage',
      text: 'Tipp einen Tag an, um seine Übungen zu sehen und zu ändern – z. B. eine Übung dauerhaft ersetzen.' },
    { id: 'plan-addday', sel: '[data-action="add-day"]', title: 'Trainingstag hinzufügen',
      text: 'Fügt deinem Plan einen weiteren Trainingstag hinzu.' },
    { id: 'plan-home', sel: '.home-eq-card', title: 'Deine Ausrüstung',
      text: 'Was du zu Hause hast. Neue Hanteln oder Bänder trägst du hier ein – die App schlägt dann nur Gewichte vor, die du wirklich hast.' },
    { id: 'plan-deload', sel: '[data-action="plan-deload"]', title: 'Deload',
      text: 'Lege fest, ob die leichte Deload-Woche automatisch nach den Aufbauwochen kommt oder ob du sie selbst einlegst, wenn du sie brauchst.' },
  ],
  day: [
    { id: 'day-type', sel: '.daytype', title: 'Wiederholungsbereich',
      text: 'Niedrig = mehr Gewicht und weniger Wiederholungen, hoch = weniger Gewicht und mehr Wiederholungen. Sätze und Wiederholungen rechnet die App danach aus.' },
    { id: 'day-info', sel: '.auto-info', title: 'Automatisch berechnet',
      text: 'Hier siehst du je Übung den Wiederholungsbereich – die Sätze leitet die App aus deinem Wochenvolumen ab und steigert sie im Zyklus.' },
    { id: 'day-lib', sel: '.card .info-btn', title: 'Übung ansehen',
      text: 'Das „i“ zeigt dir die Übung mit Animation und Anleitung.' },
    { id: 'day-swap', sel: '[data-action="plan-swap-open"]', title: 'Übung ersetzen',
      text: 'Tauscht die Übung dauerhaft im Plan gegen eine andere – ihr Platz und ihre Sätze bleiben gleich.' },
    { id: 'day-order', sel: '[data-action="day-reorder"]', title: 'Reihenfolge',
      text: 'Hier änderst du die Reihenfolge der Übungen an diesem Tag – sie bleibt im Plan, bis du sie wieder änderst.' },
    { id: 'day-step', sel: '[data-action="set-step"]', title: 'Steigerung',
      text: 'Um so viel kg geht das Gewicht dieser Übung hoch, wenn die App mehr vorschlägt – passend zu deinen Scheiben bzw. der Maschine.' },
    { id: 'day-add', sel: '[data-action="add-ex"]', title: 'Übung hinzufügen',
      text: 'Fügt diesem Trainingstag eine weitere Übung hinzu.' },
    { id: 'day-del', sel: '[data-action="del-day"]', title: 'Tag löschen',
      text: 'Entfernt diesen Trainingstag aus dem Plan. Deine bisherigen Trainings bleiben im Verlauf.' },
  ],
  history: [
    { id: 'hist-cal', sel: '.cal', title: 'Dein Kalender',
      text: 'Jeder Tag mit Training ist markiert. Tipp einen Tag an, um zu sehen, was du gemacht hast – mit den Pfeilen wechselst du den Monat.' },
    { id: 'hist-legend', sel: '.cal-legend', title: 'Die Farben',
      text: 'Sie zeigen, ob es ein normales Training, eine Deload-Woche oder Cardio war.' },
    { id: 'hist-day', sel: '.card.cal-day', title: 'Ausgewählter Tag',
      text: 'Hier stehen die Trainings dieses Tages. Antippen öffnet alle Sätze – dort kannst du auch nachträglich etwas korrigieren.' },
    { id: 'hist-ex', sel: '[data-action="open-exercise"]', title: 'Übungen',
      text: 'Für jede Übung siehst du alle bisherigen Sätze – neue Bestleistungen sind mit ★ PB markiert.' },
  ],
  charts: [
    { id: 'ch-tabs', sel: '.seg.grid.two', title: 'Was möchtest du sehen?',
      text: () => 'Die Entwicklung deiner Übungen, dein Cardio und deine Erfolge'
        + (feat('chart-detail') ? ', die Tonnage (bewegtes Gesamtgewicht)' : '') + (feat('steps') ? ' und deine Schritte' : '') + '.' },
    { id: 'ch-pick', sel: '[data-action="chart-pick"]', title: 'Übung wählen',
      text: 'Wähle eine Übung – das Diagramm zeigt dann, wie du über die Wochen stärker wirst.' },
    { id: 'ch-area', sel: '#chart-area', title: 'Dein Verlauf',
      text: 'Jeder Punkt ist ein Training. Geht die Linie nach oben, wirst du stärker – kleine Dellen, z. B. in der Deload-Woche, sind normal.' },
    { id: 'ch-opts', sel: '.chart-opts', title: 'Feineinstellungen',
      text: 'Hier wählst du, welcher Wert gezeigt wird, und blendest Ausführungen oder Deload-Wochen ein und aus.' },
    { id: 'ch-awards', sel: '[data-action="chart-mode"][data-mode="awards"]', title: 'Erfolge',
      text: 'Hier sammelst du Abzeichen für Meilensteine – z. B. für regelmäßiges Training und neue Bestleistungen.' },
  ],
  nutrition: [
    { id: 'nut-basics', sel: '.nut-basics > summary', title: 'Grundlagen',
      text: 'Die wichtigsten Regeln für gute, ausgewogene Ernährung – antippen klappt sie auf und zu.' },
    { id: 'nut-setup', sel: '[data-action="nut-setup"]', title: 'Ernährung einrichten',
      text: 'Wähle deine Phase – Aufbau, Recomp, Diät oder Minicut. Die App schätzt dann deinen Bedarf und dein Tagesziel.' },
    { id: 'nut-phase', sel: '.nut-phase-head', title: 'Deine Phase',
      text: 'Welche Phase du gerade machst, seit wann und in welchem Tempo.' },
    { id: 'nut-target', sel: '.card.nut-target', title: 'Dein Tagesziel',
      text: 'So viele Kalorien – und so viel Eiweiß, Fett und Kohlenhydrate – passen pro Tag zu deinem Ziel.' },
    { id: 'nut-kcal', sel: '.nut-kcal-btn', title: 'Selbst festlegen',
      text: 'Möchtest du eine andere Kalorienzahl? Hier legst du sie selbst fest – die Makros rechnen sich passend dazu.' },
    { id: 'nut-intake', sel: '.card.nut-intake', title: 'Heute gegessen',
      text: 'Hier vergleichst du, was du heute gegessen hast, mit deinem Ziel.' },
    { id: 'nut-food', sel: '[data-action="food-open"]', title: 'Ernährungstagebuch',
      text: 'Trag ein, was du isst – mit Suche, Barcode-Scanner und gespeicherten Mahlzeiten.' },
    { id: 'nut-health', sel: '[data-action="health-paste"]', title: 'Aus Health',
      text: 'Holt Kalorien, Makros, Gewicht und Schritte aus Apple Health – über einen Kurzbefehl, die Anleitung steht dabei.' },
    { id: 'nut-history', sel: '.card.nut-history', title: 'Die letzten Tage',
      text: 'Wie gut du dein Ziel an den letzten Tagen getroffen hast.' },
    { id: 'nut-check', sel: '.card.nut-check', title: 'Kalorienvorschläge',
      text: 'Läuft dein Gewicht anders als geplant, schlägt dir die App hier eine Anpassung der Kalorien vor und sagt kurz, warum.' },
    { id: 'nut-goal', sel: '.card.nut-goal', title: 'Zielgewicht',
      text: 'Dein Ziel und wie weit du schon gekommen bist.' },
    { id: 'nut-train', sel: '.card.nut-train', title: 'Training anpassen',
      text: 'In der Diät kann die App das Training etwas leichter planen, damit du trotzdem gut regenerierst.' },
    { id: 'nut-edit', sel: '.nut-actions', title: 'Angaben und Phase',
      text: 'Hier änderst du deine Angaben (z. B. Aktivität oder Tempo) oder wechselst in eine andere Phase.' },
    { id: 'nut-bw', sel: '#chart-area', title: 'Körpergewicht',
      text: 'Trag dein Gewicht regelmäßig ein, am besten morgens. Die Linie zeigt den Trend – Schwankungen von Tag zu Tag sind normal (Wasser, Essen).' },
  ],
  food: [
    { id: 'food-date', sel: '.food-date', title: 'Tag wählen',
      text: 'Mit den Pfeilen wechselst du den Tag – so kannst du auch etwas nachtragen.' },
    { id: 'food-sum', sel: '.card.nut-intake', title: 'Tagessumme',
      text: 'Was du an diesem Tag schon gegessen hast – im Vergleich zu deinem Ziel.' },
    { id: 'food-meal', sel: '.card.food-meal', title: 'Mahlzeiten',
      text: 'Frühstück, Mittag, Abend und Snacks. Tipp einen Eintrag an, um die Menge zu ändern oder ihn zu löschen.' },
    { id: 'food-add', sel: '[data-action="food-add"]', title: 'Hinzufügen',
      text: 'Lebensmittel suchen, mit der Kamera den Barcode scannen oder eine gespeicherte Mahlzeit wählen.' },
    { id: 'food-save', sel: '[data-action="food-meal-save"]', title: 'Mahlzeit merken',
      text: 'Isst du etwas öfter? Mit 💾 speicherst du die ganze Mahlzeit – beim nächsten Mal reicht ein Tipp.' },
    { id: 'food-close', sel: '[data-action="food-close-ask"]|[data-action="food-close"]', title: 'Tag abschließen',
      text: 'Am Abend den Tag abschließen. Fehlt noch etwas, kann die App den Rest mit deinem Tagesziel auffüllen – so bleibt die Rechnung genau.' },
  ],
  data: [
    { id: 'opt-mode', sel: '.mode-card', title: 'Modus',
      text: 'Einfach, Standard oder Experte bestimmt, wie viele Einstellungen und Erklärungen du siehst. Deine Daten bleiben beim Wechsel erhalten – neue Funktionen stellt dir die App dann kurz vor.' },
    { id: 'opt-tour', sel: '[data-action="tour-reset"]', title: 'Einführungen',
      text: 'Hier lässt du dir alle Einführungen noch einmal zeigen.' },
    { id: 'opt-look', sel: '.color-grid', title: 'Aussehen',
      text: 'Farbwelt und Hell/Dunkel nach deinem Geschmack.' },
    { id: 'tr-swipe', sel: '.tr-viewmode', title: 'Untereinander oder wischen',
      text: 'So siehst du die Übungen im Training: alle untereinander zum Scrollen – oder eine Übung pro Bildschirm, dann wischst du nach links zur nächsten Übung und nach rechts zur vorigen. Probier aus, was dir lieber ist.' },
    { id: 'opt-export', sel: '[data-action="export"]', title: 'Sicherung',
      text: 'Deine Daten liegen nur auf diesem Handy. Sichere sie regelmäßig – die Datei kannst du z. B. in iCloud, Google Drive oder per Mail ablegen.' },
    { id: 'opt-import', sel: '[data-action="import"]', title: 'Sicherung laden',
      text: 'Lädt eine gesicherte Datei wieder – z. B. auf einem neuen Handy.' },
  ],
  library: [
    { id: 'lib-search', sel: '.lib-search', title: 'Suchen',
      text: 'Tipp einen Teil des Namens ein, z. B. „Rudern“ oder „Band“.' },
    { id: 'lib-groups', sel: '#lib-groups .lib-group', title: 'Nach Muskelgruppe',
      text: 'Oder öffne eine Muskelgruppe und tipp eine Übung an – du siehst sie als Animation mit Anleitung.' },
    { id: 'lib-add', sel: '.lib-add-btn', title: 'Eigene Übung',
      text: 'Fehlt eine Übung? Leg sie selbst an – mit Muskelgruppe und einer ähnlichen Übung für die Figur.' },
  ],
  libex: [
    { id: 'libex-fig', sel: '.lib-fig', title: 'Animation',
      text: 'Die Figur zeigt den Bewegungsablauf. Darunter stehen die Ausführung in Kurzform und worauf du achten solltest.' },
    { id: 'libex-more', sel: '.lib-guide > summary', title: 'Ausführlicher',
      text: 'Hier klappt die ausführliche Anleitung auf: Einstellen, Ausführung, Atmung, häufige Fehler und Sicherheit.' },
  ],
  session: [
    { id: 'ses-stats', sel: '.stats', title: 'Überblick',
      text: 'Dauer, Sätze und weitere Zahlen dieses Trainings.' },
    { id: 'ses-sets', sel: '.list .sets', title: 'Deine Sätze',
      text: 'Alle Sätze dieses Trainings – ★ PB markiert neue persönliche Bestleistungen.' },
    { id: 'ses-edit', sel: '[data-action="se-edit"]', title: 'Bearbeiten',
      text: 'Vertippt? Hier korrigierst du das Training nachträglich.' },
  ],
  week: [
    { id: 'week-nav', sel: '[data-action="week-shift"]', title: 'Wochen wechseln',
      text: 'Mit den Pfeilen blätterst du zwischen den Wochen deines Zyklus.' },
    { id: 'week-sess', sel: '[data-action="open-session"]', title: 'Trainings der Woche',
      text: 'Tipp ein Training an, um alle Sätze zu sehen oder es zu bearbeiten.' },
  ],
};

let tour = null;  // laufende Einführung: { view, steps, i }

const tourState = () => {
  if (!data.tour) data.tour = { seen: {}, off: false };
  return data.tour;
};
const tourVisible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
function tourFind(step) {
  for (const s of step.sel.split('|')) {
    const el = [...document.querySelectorAll(s.trim())].find(tourVisible);
    if (el) return el;
  }
  return null;
}

// Nach jedem Zeichnen (render): noch nicht gesehene Schritte dieses Fensters zeigen
function tourCheck() {
  if (tour) { if (tour.view !== current.view) tourClose(); else setTimeout(tourShow, 50); return; }
  const st = tourState();
  if (st.off || document.querySelector('.welcome')) return;
  const list = TOURS[current.view];
  if (!list) return;
  const steps = list.filter(s => !st.seen[s.id] && (!s.feat || feat(s.feat)) && tourFind(s));
  if (!steps.length) return;
  tour = { view: current.view, steps, i: 0 };
  setTimeout(tourShow, 300);  // erst fertig zeichnen lassen
}

function tourMark(step) { tourState().seen[step.id] = 1; saveData(); }

function tourClose() {
  const o = document.getElementById('tour');
  if (o) o.remove();
  document.body.classList.remove('touring');
  tour = null;
}

function tourShow() {
  if (!tour) return;
  if (tour.view !== current.view || document.querySelector('.welcome')) { tourClose(); return; }
  let step = tour.steps[tour.i], el = tourFind(step);
  while (!el && tour.i < tour.steps.length - 1) { tourMark(step); tour.i++; step = tour.steps[tour.i]; el = tourFind(step); }
  if (!el) { tourMark(step); tourClose(); return; }
  let o = document.getElementById('tour');
  if (!o) {
    o = document.createElement('div');
    o.id = 'tour';
    o.innerHTML = '<div class="tour-hole"></div><div class="tour-bubble" role="dialog" aria-modal="true"></div>';
    o.addEventListener('click', tourClick);
    document.body.appendChild(o);
    document.body.classList.add('touring');
  }
  if (!el.closest('#tabs')) el.scrollIntoView({ block: 'center' });
  const n = tour.steps.length, text = typeof step.text === 'function' ? step.text() : step.text;
  o.querySelector('.tour-bubble').innerHTML = `<p class="tour-count">${n > 1 ? `${tour.i + 1} von ${n}` : 'Kurz erklärt'}</p>
    <h3>${step.title}</h3><p>${text}</p>
    <div class="tour-btns">${tour.i < n - 1 ? '<button class="tour-skip" data-tour="skip">Überspringen</button>' : '<span></span>'}
      <button class="btn primary" data-tour="next">${tour.i < n - 1 ? 'Weiter' : 'Verstanden'}</button></div>
    ${tour.i === 0 ? '<button class="tour-off" data-tour="off">Keine Einführungen mehr zeigen</button>' : ''}`;
  tour.el = el;
  tourPlace(el);
  requestAnimationFrame(() => tourPlace(el));  // nach dem Scrollen noch einmal genau ausrichten
}

// Loch über dem Ziel, Sprechblase darunter bzw. darüber (je nachdem, wo mehr Platz ist)
function tourPlace(el) {
  const o = document.getElementById('tour');
  if (!o || !el) return;
  const r = el.getBoundingClientRect(), pad = 6, vh = window.innerHeight, vw = window.innerWidth;
  const top = Math.max(4, r.top - pad), bottom = Math.min(vh - 4, r.bottom + pad);
  const hole = o.querySelector('.tour-hole');
  Object.assign(hole.style, { left: `${Math.max(4, r.left - pad)}px`, top: `${top}px`,
    width: `${Math.min(vw - 8, r.width + pad * 2)}px`, height: `${Math.max(0, bottom - top)}px` });
  const b = o.querySelector('.tour-bubble');
  const w = Math.min(380, vw - 32);
  b.style.width = `${w}px`;
  b.style.left = `${Math.min(vw - w - 16, Math.max(16, r.left + r.width / 2 - w / 2))}px`;
  const bh = b.offsetHeight;
  let y, side;
  if (vh - bottom >= bh + 20) { y = bottom + 12; side = 'below'; }
  else if (top >= bh + 20) { y = top - bh - 12; side = 'above'; }
  else { y = Math.max(16, vh - bh - 16); side = 'over'; }
  b.style.top = `${y}px`;
  b.dataset.side = side;
}
window.addEventListener('resize', () => { if (tour && tour.el) tourPlace(tour.el); });

function tourClick(e) {
  const btn = e.target.closest('[data-tour]');
  e.stopPropagation();
  if (!btn || !tour) return;
  const what = btn.dataset.tour;
  if (what === 'next') {
    tourMark(tour.steps[tour.i]);
    if (tour.i < tour.steps.length - 1) { tour.i++; tourShow(); } else tourClose();
  } else if (what === 'skip') {
    tour.steps.forEach(s => { tourState().seen[s.id] = 1; });
    saveData(); tourClose();
  } else if (what === 'off') {
    tourState().off = true;
    saveData(); tourClose();
    toast('Einführungen aus – in den Optionen wieder einschaltbar');
  }
}

// Optionen: Einführungen wieder zeigen
const tourCard = () => `<div class="card"><h2>💡 Einführungen</h2>
    <p class="hint">Beim ersten Öffnen eines Fensters erklärt die App die wichtigsten Knöpfe. Nach einem Wechsel des Modus kommen
      die neuen Funktionen dazu.${tourState().off ? ' <b>Zurzeit ausgeschaltet.</b>' : ''}</p>
    <button class="btn" data-action="tour-reset">${tourState().off ? 'Einführungen wieder einschalten' : 'Alle Einführungen noch einmal zeigen'}</button></div>`;

Object.assign(actions, {
  'tour-reset': () => {
    data.tour = { seen: {}, off: false };
    saveData(); render();
    toast('Die Einführungen erscheinen wieder beim Öffnen der Fenster');
  },
});
