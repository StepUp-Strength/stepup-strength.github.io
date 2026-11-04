'use strict';

// Einführung („Spotlight“): Beim ersten Öffnen eines Fensters wird der Bildschirm abgedunkelt, ein Knopf bleibt hell
// und eine Sprechblase erklärt ihn. Jeder Schritt ist an die Funktion gekoppelt, die er erklärt (feat bzw. ob das
// Element zu sehen ist) – nach einem Moduswechsel erscheinen so nur die Schritte der neu sichtbaren Funktionen.
// Gesehen wird je Schritt gemerkt: data.tour = { seen: { id: 1 }, off }.
// Schritt: { id, sel (CSS, Alternativen mit „|“), title, text (Text oder Funktion), feat (optional) }

const TOURS = {
  start: [
    { id: 'start-day', sel: '.day-btn.next|.day-btn', title: 'Training starten',
      text: 'Tipp einen Trainingstag an, um loszulegen. „Als Nächstes“ zeigt, welcher Tag dran ist. Darunter stehen die Zahl der Übungen, die geschätzte Dauer und wann du den Tag zuletzt trainiert hast.' },
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
      text: 'Das Gewicht, mit dem du gerade so 10 saubere Wiederholungen schaffst. Daraus rechnet die App deine Gewichte. Unbekannt? Leer lassen – die App errechnet es aus deinem ersten Satz.' },
    { id: 'tr-step', sel: 'section.card [data-action="tr-step-open"]', feat: 'tr-step', title: 'Steigerung',
      text: 'Um so viel kg geht das Gewicht hoch, wenn die App mehr vorschlägt – z. B. 2,5 kg an der Langhantel oder 5 kg an manchen Maschinen.' },
    { id: 'tr-variant', sel: 'section.card [data-action="ex-variant-open"]', feat: 'tr-variants', title: 'Ausführung',
      text: 'Normal, mit Pause oder langsam. Sätze werden nur mit gleich ausgeführten Sätzen verglichen.' },
    { id: 'tr-sets', sel: 'section.card .setgrid', title: 'Deine Sätze',
      text: 'Die Vorschläge stehen schon drin. Weichst du davon ab, trag einfach ein, was du wirklich geschafft hast.' },
    { id: 'tr-feel', sel: 'section.card .feel-btn', title: 'Wie war der Satz?',
      text: 'Nach jedem Satz hier antippen, wie er sich angefühlt hat. Erst dann zählt er als erledigt – und die App passt die nächsten Sätze an.' },
    { id: 'tr-tank', sel: 'section.card .setgrid .tank', title: 'Tank',
      text: 'Wie viele Wiederholungen wären noch gegangen? Erst mit dieser Zahl zählt der Satz als erledigt – die App passt dann die folgenden Sätze an.' },
    { id: 'tr-setbtns', sel: 'section.card .set-btns', feat: 'tr-sets', title: 'Sätze',
      text: 'Hier fügst du einen Satz hinzu oder entfernst einen.' },
    { id: 'tr-add', sel: '[data-action="add-open"]', feat: 'tr-add', title: 'Übung hinzufügen',
      text: 'Eine zusätzliche Übung nur für heute – auf Wunsch auch dauerhaft im Plan.' },
    { id: 'tr-save', sel: '[data-action="tr-save"]', title: 'Speichern',
      text: 'Zum Schluss speichern. Die App merkt sich alles und berechnet daraus dein nächstes Training.' },
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
    const el = document.querySelector(s.trim());
    if (tourVisible(el)) return el;
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
