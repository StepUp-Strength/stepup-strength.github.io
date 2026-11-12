/* StepUp Strength · © 2026 Alex Hundt · Alle Rechte vorbehalten – siehe LICENSE */
'use strict';

/* ---------- Über die App: Gesundheitshinweis, Datenschutz, Impressum, Feedback (v188, 2026-11-09) ---------- */

// Angaben für Impressum, Datenschutz (Verantwortlicher) und Feedback. Leer = Abschnitt wird nicht gezeigt.
const LEGAL = {
  name: '',      // Vor- und Nachname
  street: '',    // Straße und Hausnummer (ladungsfähige Anschrift)
  city: '',      // PLZ und Ort
  email: '',     // Kontakt-E-Mail (auch für Feedback)
};
const LEGAL_STAND = 'November 2026';
const legalReady = () => !!(LEGAL.name && LEGAL.street && LEGAL.city && LEGAL.email);

// Gesundheitshinweis – auch in der Begrüßung (aufklappbar)
const HEALTH_POINTS = [
  'StepUp Strength ist eine Trainings- und Ernährungshilfe für <b>gesunde Erwachsene</b>. Sie ersetzt keine ärztliche Beratung, Diagnose oder Behandlung.',
  'Lass dich vorher <b>ärztlich durchchecken</b>, wenn du Vorerkrankungen hast (z. B. Herz, Kreislauf, Blutdruck, Diabetes, Gelenke oder Rücken), schwanger bist, regelmäßig Medikamente nimmst oder lange keinen Sport gemacht hast.',
  'Hör sofort auf bei <b>Schmerzen, Schwindel, Atemnot oder Druck in der Brust</b>.',
  'Gewichte und Wiederholungen sind <b>Vorschläge</b>, berechnet aus deinen Eingaben. Du entscheidest selbst, was du dir zutraust. Achte auf saubere Technik und sichere schwere Übungen ab.',
  'Die Ernährungswerte sind <b>Schätzungen</b>. Sie passen nicht bei Essstörungen, in Schwangerschaft und Stillzeit, für Kinder und Jugendliche oder bei Stoffwechselerkrankungen – dann bitte mit Ärztin, Arzt oder Ernährungsfachkraft absprechen.',
];
const healthListHtml = () => `<ul class="about-list">${HEALTH_POINTS.map(p => `<li>${p}</li>`).join('')}</ul>`;

function aboutDatenschutz() {
  const who = legalReady()
    ? `${esc(LEGAL.name)}, ${esc(LEGAL.street)}, ${esc(LEGAL.city)}, E-Mail: <a href="mailto:${esc(LEGAL.email)}">${esc(LEGAL.email)}</a>`
    : 'siehe Impressum';
  return `<div class="about-text">
    <p><b>Kurz gesagt:</b> Kein Konto, keine Werbung, kein Tracking, keine Cookies. Deine Trainings-, Körper- und Ernährungsdaten
      bleiben auf deinem Gerät – wir bekommen sie nicht zu sehen.</p>
    <h3>Verantwortlich</h3>
    <p>${who}</p>
    <h3>Deine Daten bleiben auf deinem Gerät</h3>
    <p>Alles, was du einträgst – Pläne, Trainings, Körpergewicht, Ernährung, Zykluskalender –, speichert die App nur im Speicher deines
      Browsers auf diesem Gerät. Es gibt keinen Server, an den diese Daten geschickt werden. Darunter sind auch Gesundheitsdaten;
      sie verlassen dein Gerät nur, wenn du selbst eine Sicherung exportierst und weitergibst.</p>
    <h3>Aufruf der App (Hosting)</h3>
    <p>Die App wird über <b>GitHub Pages</b> ausgeliefert (GitHub Inc., USA). Beim Laden verarbeitet GitHub technisch notwendige
      Angaben wie deine IP-Adresse, Zeitpunkt und Browser, um die Seite auszuliefern und vor Angriffen zu schützen. Dabei können Daten
      in die USA übertragen werden. Rechtsgrundlage ist unser berechtigtes Interesse an einer sicheren Bereitstellung
      (Art. 6 Abs. 1 lit. f DSGVO). Mehr dazu: <a href="https://docs.github.com/de/site-policy/privacy-policies/github-general-privacy-statement" target="_blank" rel="noopener">Datenschutzerklärung von GitHub</a>.</p>
    <h3>Lebensmittel suchen und Barcode scannen</h3>
    <p>Nur wenn du im Ernährungstagebuch online nach Produkten suchst oder einen Barcode scannst, fragt die App die freie Datenbank
      <b>Open Food Facts</b> (Open Food Facts, Frankreich) ab. Dabei werden der Barcode bzw. dein Suchbegriff und deine IP-Adresse übertragen –
      sonst nichts. Mehr dazu: <a href="https://world.openfoodfacts.org/privacy" target="_blank" rel="noopener">Datenschutz bei Open Food Facts</a>.
      Die Kamera nutzt die App nur zum Scannen; das Bild wird auf deinem Gerät ausgewertet und weder gespeichert noch übertragen.</p>
    <h3>Fortschrittsfotos und Technik-Videos</h3>
    <p>Fotos und Videos, die du in der App aufnimmst oder auswählst, speichert die App nur auf deinem Gerät. Sie werden nicht übertragen und
      sind nicht in der normalen Sicherung. Fotos kannst du als eigene Datei sichern, Fotos und Videos über das Teilen-Menü in deiner Galerie
      ablegen – wohin, bestimmst du. Die Kamera nutzt die App nur, wenn du selbst ein Foto oder Video aufnimmst.</p>
    <h3>Sicherungen</h3>
    <p>Eine Sicherung ist eine Datei, die du selbst speicherst oder teilst. Wohin sie geht, bestimmst du – wir haben keinen Zugriff darauf.
      Auf Wunsch verschlüsselt die App die Sicherung mit einem Passwort (Einstellung unter „Deine Daten“); das Passwort wird nirgends gespeichert.</p>
    <h3>Fehlerprotokoll</h3>
    <p>Tritt in der App ein Fehler auf, merkt sie sich die letzten Fehler auf deinem Gerät: Fehlertext, betroffene Ansicht, App-Version und
      Zeitpunkt – keine Trainings- oder Gesundheitsdaten. Das Protokoll verlässt dein Gerät nur, wenn du es unter „Optionen“ →
      „Fehlerprotokoll“ selbst teilst; dann kommen Gerätetyp und Browser dazu. Dort kannst du es auch jederzeit löschen.</p>
    <h3>Löschen</h3>
    <p>Unter „Optionen“ → „Alles zurücksetzen“ löschst du alle Daten der App. Auch das Löschen der Website-Daten im Browser oder das
      Entfernen der App vom Home-Bildschirm löscht sie.</p>
    <h3>Deine Rechte</h3>
    <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch
      sowie auf Beschwerde bei einer Datenschutz-Aufsichtsbehörde. Da wir selbst keine Daten von dir speichern, wende dich bei Fragen zu
      Hosting oder Lebensmittelsuche am besten direkt an GitHub bzw. Open Food Facts – oder schreib uns.</p>
    <p class="hint">Stand: ${LEGAL_STAND}</p>
  </div>`;
}

function aboutImpressum() {
  if (!legalReady()) return '';
  return `<details class="card about-sec"><summary><b>Impressum</b></summary><div class="about-text">
    <p>Angaben gemäß § 5 DDG</p>
    <p>${esc(LEGAL.name)}<br>${esc(LEGAL.street)}<br>${esc(LEGAL.city)}</p>
    <p>E-Mail: <a href="mailto:${esc(LEGAL.email)}">${esc(LEGAL.email)}</a></p>
    <p>Verantwortlich für den Inhalt: ${esc(LEGAL.name)}, Anschrift wie oben.</p>
  </div></details>`;
}

// Feedback per E-Mail: Betreff und kurze technische Angaben vorausgefüllt (keine Trainingsdaten) – erst beim Antippen gebaut,
// damit die App-Version (asynchron aus dem Offline-Speicher) schon da ist
function aboutFeedback() {
  if (!LEGAL.email) return '';
  return `<div class="card"><h2>💬 Feedback</h2>
    <p class="hint">Etwas unklar, ein Fehler oder eine Idee? Schreib uns – jede Rückmeldung hilft, die App besser zu machen.</p>
    <button class="btn primary" data-action="about-feedback">Feedback schreiben</button></div>`;
}

function renderAbout() {
  return `<div class="card about-head"><h2>StepUp Strength</h2>
      <p class="hint">Deine App fürs Krafttraining: Sie schlägt dir für jeden Satz Gewicht und Wiederholungen vor, lernt aus jedem Training
        und plant Zyklen mit Erholungswochen. Ohne Konto, ohne Werbung – deine Daten bleiben auf deinem Gerät.</p>
      <p class="hint app-version" id="app-version"></p></div>
    ${aboutFeedback()}
    <details class="card about-sec" open><summary><b>⚕️ Gesundheitshinweis</b></summary>${healthListHtml()}</details>
    <details class="card about-sec"><summary><b>🔒 Datenschutz</b></summary>${aboutDatenschutz()}</details>
    ${aboutImpressum()}
    <details class="card about-sec"><summary><b>© Rechte & Quellen</b></summary>${aboutRights()}</details>
    <p class="hint about-copy">© 2026 Alex Hundt · Alle Rechte vorbehalten</p>`;
}

// Urheberrecht (siehe LICENSE im Repository) und Pflichtangaben der fremden Bestandteile
function aboutRights() {
  return `<div class="about-text">
    <p>StepUp Strength – Programm, Trainingslogik, Texte, Übungsbeschreibungen und Grafiken – ist urheberrechtlich geschützt.
      © 2026 Alex Hundt, alle Rechte vorbehalten. Du darfst die App für dein eigenes Training nutzen. Kopieren, Verändern,
      Weitergeben oder Veröffentlichen, auch in Teilen, ist ohne schriftliche Zustimmung nicht erlaubt.</p>
    <h3>Verwendete Daten und Software</h3>
    <p><b>Bundeslebensmittelschlüssel (BLS) 4.0</b> – Durchschnittswerte für Lebensmittel, © Max Rubner-Institut.</p>
    <p><b>Open Food Facts</b> – Produktdaten beim Barcode-Scan und bei der Produktsuche, unter der
      <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">Open Database License (ODbL)</a>,
      <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">openfoodfacts.org</a>.</p>
    <p><b>ZXing</b> (@zxing/library) – Barcode-Erkennung, unter der
      <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache License 2.0</a>.</p>
  </div>`;
}

views.about = { title: 'Über die App', tab: 'data', back: () => ['opt', { sec: 'info' }], render: renderAbout, after: () => showAppVersion() };

Object.assign(actions, {
  'about': () => go('about'),
  'about-feedback': () => {
    const v = document.getElementById('app-version');
    const body = `

---
${v && v.textContent ? v.textContent : 'App-Version ?'} · Modus: ${APP_MODES[appMode()].label}
Gerät: ${navigator.userAgent}`;
    location.href = `mailto:${LEGAL.email}?subject=${encodeURIComponent('Feedback zu StepUp Strength')}&body=${encodeURIComponent(body)}`;
  },
});
