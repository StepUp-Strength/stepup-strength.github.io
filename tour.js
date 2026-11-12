/* StepUp Strength · © 2026 Alex Hundt · Alle Rechte vorbehalten – siehe LICENSE */
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
      text: 'Hier siehst du, in welcher Woche du gerade bist. Die App steigert Woche für Woche, danach kommt eine leichtere Deload-Woche zur Erholung. Eine Woche ist geschafft, sobald alle Tage trainiert sind – egal, wie lange du dafür brauchst. Tipp auf die Überschrift: Dann klappt die Karte mit Erklärung, offenen Tagen und „Zyklus anpassen“ auf.' },
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
      text: 'Unten wechselst du zwischen Training, Plan, Verlauf (mit Diagrammen, Statistik und Erfolgen), Ernährung und Optionen (z. B. Sicherung, Aussehen und Modus).' },
  ],
  training: [
    { id: 'tr-where', sel: '#tr-head .trh-where', title: 'Dein Fortschritt',
      text: 'Hier siehst du, bei welcher Übung du bist und wie viele Sätze schon erledigt sind. Antippen springt zur aktuellen Übung.' },
    { id: 'tr-timer', sel: '#tr-head .trh-time', title: 'Trainingszeit',
      text: 'Die Zeit läuft mit. Beim Speichern wird sie festgehalten – beim nächsten Mal siehst du sie am Trainingstag.' },
    { id: 'tr-menu', sel: '#tr-head .trh-menu-btn', title: 'Mehr',
      text: () => 'Hier änderst du die Reihenfolge der Übungen für heute, z. B. wenn ein Gerät besetzt ist. Außerdem findest du hier die Erklärung zum Eintragen'
        + (feat('tr-prefat') ? ', zur Vorermüdung' : '') + ' und wie lange das Training letztes Mal gedauert hat.' },
    { id: 'tr-prog', sel: '.prog-card', feat: 'tr-prog', title: 'Progression heute',
      text: 'Fühlst du dich heute nicht fit, kannst du die Steigerung nur für dieses Training ausschalten – dann gelten die Werte vom letzten Mal.' },
    { id: 'tr-info', sel: 'section.card h2 .info-dot|section.card .info-btn', title: 'Übung ansehen',
      text: 'Tipp auf den Namen mit dem „i“: Dann siehst du die Übung als Animation mit Anleitung.' },
    { id: 'tr-details', sel: 'section.card .det-btn', title: 'Details',
      text: () => {
        const a = [feat('tr-comment') ? 'Kommentar' : '', 'Ersetzen', feat('tr-max') ? 'Max. bei 10 Wdh.' : '',
          feat('tr-step') ? 'Steigerung' : '', feat('tr-variants') ? 'Ausführung' : ''].filter(Boolean);
        const list = a.length > 1 ? `${a.slice(0, -1).join(', ')} und ${a[a.length - 1]}` : a[0];
        return `Hier klappst du mehr zur Übung auf: ${list}. Die App merkt sich, ob du die Details lieber offen oder zu hast.`;
      } },
    { id: 'tr-tools', sel: 'section.card .ex-tools', title: 'Kommentar und Ersetzen',
      text: () => (feat('tr-comment') ? '„Kommentar“: eine Notiz zur Übung, z. B. die Sitzhöhe – sie erscheint beim nächsten Mal wieder. ' : '')
        + '„Ersetzen“: die Übung heute gegen eine ähnliche tauschen, z. B. wenn das Gerät besetzt ist. Der Plan bleibt, wie er ist.' },
    { id: 'tr-ss', sel: '.ss-wrap .ss-head', title: '🔗 Supersatz',
      text: 'Diese beiden Übungen machst du im Wechsel: Satz A, kurze Pause, Satz B, kurze Pause, dann wieder A. Der nächste Satz ist umrandet, der Pausen-Timer oben zeigt, was danach dran ist. Gerät besetzt? „Heute einzeln“ – dann gelten die normalen Pausen.' },
    { id: 'tr-pain', sel: 'section.card .pain-btn, section.card .pain-link', title: '🩹 Zwickt',
      text: 'Meldet sich bei einer Übung etwas, tipp hier und halte fest, wo und wie stark. Das landet in deinem Beschwerde-Tagebuch – so siehst du mit der Zeit, welche Übungen sich melden.' },
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
    { id: 'day-ss', sel: '.ss-auto-btn, .ss-wrap .ss-head, .ss-btn', title: '🔗 Supersätze',
      text: 'Zwei Übungen im Wechsel sparen Pausen: erlaubt sind Gegenspieler wie Brust und Rücken oder Muskelgruppen, die nichts miteinander zu tun haben, wie Bauch und Waden. „Supersätze vorschlagen“ koppelt passende Übungen auf einmal, „Lösen“ macht es rückgängig.' },
    { id: 'day-tech', sel: '.tech-row', title: '⚡ Intensitätstechnik',
      text: 'Reduktions- oder Myo-Satz für diese Übung – dauerhaft, mit Steigerung. Die App plant so etwas nie von selbst ein. „ⓘ“ erklärt, wann sich welche Technik lohnt.' },
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
    { id: 'hist-seg', sel: '.hist-seg', title: 'Dein Verlauf',
      text: 'Oben wechselst du zwischen Kalender, deinen Übungen (mit Diagramm), der Statistik und deinen Erfolgen – oder wischst seitlich.' },
    { id: 'hist-cal', sel: '.cal', title: 'Dein Kalender',
      text: 'Jeder Tag mit Training ist markiert. Tipp einen Tag an, um zu sehen, was du gemacht hast – mit den Pfeilen wechselst du den Monat.' },
    { id: 'hist-legend', sel: '.cal-legend', title: 'Die Farben',
      text: 'Sie zeigen, ob es ein normales Training, eine Deload-Woche oder Cardio war.' },
    { id: 'hist-day', sel: '.card.cal-day', title: 'Ausgewählter Tag',
      text: 'Hier stehen die Trainings dieses Tages. Antippen öffnet alle Sätze – dort kannst du auch nachträglich etwas korrigieren.' },
  ],
  // Verlauf → Übungen / Statistik / Erfolge (v203, früher eigener Reiter „Diagramme“)
  charts: [
    { id: 'ch-pick', sel: '[data-action="chart-pick"]', title: 'Übung wählen',
      text: 'Tipp eine Übung an: Oben siehst du im Diagramm, wie du über die Wochen stärker wirst, darunter alle bisherigen Sätze.' },
    { id: 'ch-stat', sel: '.stat-seg', title: 'Statistik',
      text: () => 'Hier wechselst du zwischen ' + [feat('chart-detail') ? 'der Tonnage (bewegtes Gesamtgewicht)' : '', feat('steps') ? 'deinen Schritten' : '',
        'deinem Cardio'].filter(Boolean).join(', ').replace(/, ([^,]*)$/, ' und $1') + '.' },
    { id: 'ch-awards', sel: '.award-cat, .award-card', title: 'Erfolge',
      text: 'Hier sammelst du Abzeichen für Meilensteine – z. B. für regelmäßiges Training und neue Bestleistungen.' },
  ],
  exercise: [
    { id: 'ch-area', sel: '#chart-area', title: 'Dein Verlauf',
      text: 'Jeder Punkt ist ein Training. Geht die Linie nach oben, wirst du stärker – kleine Dellen, z. B. in der Deload-Woche, sind normal.' },
    { id: 'ch-opts', sel: '.chart-opts', title: 'Feineinstellungen',
      text: 'Hier wählst du, welcher Wert gezeigt wird, und blendest Ausführungen oder Deload-Wochen ein und aus.' },
    { id: 'hist-ex', sel: '.ex-list-h', title: 'Alle Einträge',
      text: 'Darunter stehen alle bisherigen Sätze dieser Übung – neue Bestleistungen sind mit ★ PB markiert.' },
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
    { id: 'opt-secs', sel: '.opt-list', title: 'Alle Einstellungen',
      text: 'Darunter sind die Einstellungen nach Bereichen sortiert: Aussehen (auch die Textgröße), Training, Profil, deine Daten mit der Sicherung und Hilfe.' },
  ],
  // Unterseiten der Optionen (v207)
  opt: [
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
  complaints: [
    { id: 'compl-edit', sel: '.compl-card', title: 'Dein Beschwerde-Tagebuch',
      text: 'Tipp an, wo es zwickt – wenn du magst, mit Seite und Stärke von 0 bis 10. Ist etwas besser geworden, nimm es einfach wieder heraus. Ein Eintrag pro Tag genügt.' },
    { id: 'compl-rep', sel: '[data-action="compl-report"]', title: 'Bericht für deinen Termin',
      text: 'Fasst Verlauf, betroffene Übungen und Notizen zusammen – als Bild oder Text zum Zeigen in der Arztpraxis oder Physiotherapie.' },
    { id: 'compl-hist', sel: '.compl-area', title: 'Verlauf',
      text: 'Hier siehst du je Stelle, seit wann sie dich beschäftigt, wie sich die Stärke entwickelt und bei welchen Übungen es gezwickt hat. Die App bewertet nichts – sie hält nur fest.' },
  ],
  measures: [
    { id: 'meas-form', sel: '.meas-form', title: 'Körpermaße eintragen',
      text: 'Trag nur ein, was du messen möchtest – alle Felder sind freiwillig. Daneben steht jeweils dein letzter Wert.' },
    { id: 'meas-pick', sel: '.meas-pick', title: 'Verlauf je Maß',
      text: 'Wähle ein Maß, um zu sehen, wie es sich entwickelt – z. B. die Taille in einer Diät.' },
  ],
  share: [
    { id: 'share-img', sel: '.share-wrap', title: 'Dein Bild',
      text: 'Die App malt aus deinem Training ein Bild für Story oder Status – ohne Körpergewicht und Gesundheitsdaten.' },
    { id: 'share-send', sel: '[data-action="share-send"]', title: 'Teilen',
      text: 'Öffnet das Teilen-Menü deines Handys, z. B. für WhatsApp oder Instagram. Mit „Bild speichern“ landet es in deinen Fotos bzw. Downloads.' },
  ],
  // v212: bisher ohne Einführung
  cyclereview: [
    { id: 'rev-tiles', sel: '.review-tiles', title: 'Dein Zyklus in Zahlen',
      text: 'Hier siehst du auf einen Blick, was du in diesem Zyklus geschafft hast: Bestleistungen, wie viel stärker du im Schnitt geworden bist, wie viel Gewicht du bewegt hast und wie viele Sätze es waren.' },
    { id: 'rev-gains', sel: '.review-list', title: 'Deine größten Fortschritte',
      text: 'Die Übungen, bei denen du am meisten zugelegt hast. Frühere Rückblicke findest du jederzeit im Verlauf ganz unten unter „Zyklus-Rückblicke“.' },
  ],
  cardio: [
    { id: 'cardio-kind', sel: '.cardio-types', title: 'Aktivität wählen',
      text: 'Wähle, was du gemacht hast, und darunter, wie anstrengend es war. Aus Aktivität, Anstrengung, Dauer und deinem Körpergewicht schätzt die App die verbrauchten Kalorien.' },
    { id: 'cardio-own', sel: '[data-field="cardio-in"][data-k="kcal"]', title: 'Eigener Wert',
      text: 'Zeigt deine Uhr einen Kalorienwert an, kannst du ihn hier eintragen – er ersetzt dann die Schätzung der App. Uhren schätzen oft eher zu hoch.' },
  ],
  mcal: [
    { id: 'mc-grid', sel: '.mc-cal .mc-grid:not(.mc-wd)', title: 'Dein Kalender',
      text: 'Tipp den ersten Tag einer Periode an, um ihn einzutragen. Die übrigen Phasen und die nächste Periode („erwartet“) rechnet die App selbst aus. Nochmal tippen entfernt den Eintrag.' },
    { id: 'mc-today', sel: '[data-action="mc-today"]', title: 'Schnell eintragen',
      text: 'Hat deine Periode heute begonnen, genügt ein Tipp hier.' },
    { id: 'mc-help', sel: '.mc-help > summary', title: 'So funktioniert es',
      text: 'Hier steht ausführlich, wie der Kalender rechnet und was er in der App verändert – zum Beispiel, dass Tage mit Wassereinlagerung nicht in deinen Gewichtsverlauf eingehen.' },
  ],
  complreport: [
    { id: 'crep-weeks', sel: '.rep-weeks', title: 'Zeitraum',
      text: 'Wähle, wie viele Wochen der Bericht zeigen soll – für einen Termin reichen meist die letzten 4 bis 8 Wochen.' },
    { id: 'crep-send', sel: '[data-action="crep-send"]', title: 'Dein Bericht als Bild',
      text: 'Darüber siehst du deinen Bericht: Verlauf je Stelle, betroffene Übungen und deine Notizen auf einem Bild. Hier verschickst du es, z. B. per Messenger oder E-Mail an die Praxis – oder du zeigst es beim Termin einfach auf dem Handy.' },
    { id: 'crep-text', sel: '[data-action="crep-text"]', title: 'Als Text',
      text: 'Lieber als Text, zum Beispiel für eine E-Mail? Dann diesen Knopf nehmen.' },
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
    <p class="hint explain">Beim ersten Öffnen eines Fensters erklärt die App die wichtigsten Knöpfe. Nach einem Wechsel des Modus kommen
      die neuen Funktionen dazu.${tourState().off ? ' <b>Zurzeit ausgeschaltet.</b>' : ''}</p>
    <button class="btn" data-action="tour-reset">${tourState().off ? 'Einführungen wieder einschalten' : 'Alle Einführungen noch einmal zeigen'}</button></div>`;

Object.assign(actions, {
  'tour-reset': () => {
    data.tour = { seen: {}, off: false };
    if (typeof visitsReset === 'function') visitsReset();  // v209: Erklärtexte stehen danach auch wieder offen
    saveData(); render();
    toast('Die Einführungen erscheinen wieder beim Öffnen der Fenster');
  },
});
