'use strict';

/* ---------- Übungsbibliothek: animierte Figuren ---------- */

// Körpermaße der Figur (SVG-Einheiten). shW/hipW: halbe Schulter-/Hüftbreite in der Vorderansicht.
const FIG = { torso: 42, neck: 13, ua: 25, fa: 23, th: 33, sn: 32, foot: 9, head: 8.5, shW: 11, hipW: 6 };
const FIG_DUR = 2.8;  // Sekunden pro Wiederholung
const FIG_GROUND = 148;

const figRad = a => a * Math.PI / 180;
const figVec = (a, len) => [Math.cos(figRad(a)) * len, Math.sin(figRad(a)) * len];
const figAdd = (p, v) => [p[0] + v[0], p[1] + v[1]];

// Pose -> Gelenkpunkte. Winkel in Grad, Blick nach rechts: 0 = nach vorn, 90 = nach unten, -90 = nach oben.
// torso: Hüfte->Schulter, ua/fa: Ober-/Unterarm, th/sn: Ober-/Unterschenkel, fo: Fuß; …2 = zweiter Arm/Bein.
// …l: Längenfaktor (Verkürzung, wenn ein Glied zum Betrachter zeigt). lift: Schultern höher (Schulterheben).
// root/at: dieser Gelenkpunkt liegt bei „at“ (z. B. Fuß am Boden, Hand an der Stange).
function figJoints(pose, front) {
  const q = { torso: -90, ua: 90, fa: 90, th: 90, sn: 90, ...pose };
  for (const k of ['ua', 'fa', 'th', 'sn']) {
    if (q[k + '2'] == null) q[k + '2'] = front ? 180 - q[k] : q[k];
    if (q[k + 'l2'] == null) q[k + 'l2'] = q[k + 'l'];
  }
  const j = { hip: [0, 0] };
  j.sh = figAdd(figVec(q.torso, FIG.torso * (q.tl || 1)), [0, -(q.lift || 0)]);  // tl: Rumpf verkürzt (vorgebeugt, von vorn)
  j.head = figAdd(j.sh, figVec(q.torso + (q.nk || 0), FIG.neck));
  const so = front ? FIG.shW : 0, ho = front ? FIG.hipW : 0;
  j.s1 = figAdd(j.sh, [-so, 0]); j.s2 = figAdd(j.sh, [so, 0]);
  j.h1 = [-ho, 0]; j.h2 = [ho, 0];
  j.el = figAdd(j.s1, figVec(q.ua, FIG.ua * (q.ual || 1)));
  j.ha = figAdd(j.el, figVec(q.fa, FIG.fa * (q.fal || 1)));
  j.el2 = figAdd(j.s2, figVec(q.ua2, FIG.ua * (q.ual2 || 1)));
  j.ha2 = figAdd(j.el2, figVec(q.fa2, FIG.fa * (q.fal2 || 1)));
  j.hm = [(j.ha[0] + j.ha2[0]) / 2, (j.ha[1] + j.ha2[1]) / 2];  // Mitte zwischen den Händen (z. B. Mitte der Stange)
  j.kn = figAdd(j.h1, figVec(q.th, FIG.th * (q.thl || 1)));
  j.ft = figAdd(j.kn, figVec(q.sn, FIG.sn * (q.snl || 1)));
  j.kn2 = figAdd(j.h2, figVec(q.th2, FIG.th * (q.thl2 || 1)));
  j.ft2 = figAdd(j.kn2, figVec(q.sn2, FIG.sn * (q.snl2 || 1)));
  const footLen = front ? FIG.foot * .6 : FIG.foot;
  j.toe = figAdd(j.ft, figVec(q.fo ?? (front ? 160 : q.sn - 90), footLen));
  j.toe2 = figAdd(j.ft2, figVec(q.fo2 ?? (front ? 20 : q.fo ?? q.sn2 - 90), footLen));
  const r = j[q.root || 'hip'], at = q.at || [100, 80];
  const dx = at[0] - r[0], dy = at[1] - r[1];
  for (const k in j) j[k] = [j[k][0] + dx, j[k][1] + dy];
  return j;
}

// Gerät, das sich mit einem Gelenk bewegt. type: plate (Hantelscheibe), db (Kurzhantel), kb (Kettlebell),
// bar (Griff/Stangenende), pad (Polster), cable (Seil vom festen Punkt „from“), line (Platte mit Winkel „ang“).
function figGear(g, J, cls) {
  const at = J[g.at] || J.ha, p = figAdd(at, g.off || [0, 0]);
  switch (g.type) {
    case 'plate': return [{ tag: 'circle', cls: 'fg-plate ' + cls, a: { cx: p[0], cy: p[1], r: g.r || 10 } }];
    case 'db': return [{ tag: 'circle', cls: 'fg-db ' + cls, a: { cx: p[0], cy: p[1], r: 5 } }];
    case 'kb': return [{ tag: 'circle', cls: 'fg-db ' + cls, a: { cx: p[0], cy: p[1] + 7, r: 6.5 } }];
    case 'pad': return [{ tag: 'circle', cls: 'fg-db ' + cls, a: { cx: p[0], cy: p[1], r: g.r || 4.5 } }];
    case 'line': {
      const v = figVec(g.ang || 0, (g.len || 24) / 2);
      return [{ tag: 'line', cls: 'fg-line ' + cls, a: { x1: p[0] - v[0], y1: p[1] - v[1], x2: p[0] + v[0], y2: p[1] + v[1] } }];
    }
    // Stange, die am Boden verankert ist (T-Bar, Landmine): durchgezogene Linie vom Ankerpunkt, Scheibe am Ende
    case 'pole': return [
      { tag: 'line', cls: 'fg-line ' + cls, a: { x1: g.from[0], y1: g.from[1], x2: p[0], y2: p[1] } },
      { tag: 'circle', cls: 'fg-plate ' + cls, a: { cx: p[0], cy: p[1], r: g.r || 7 } },
    ];
    // Griff zwischen zwei Gelenken (z. B. Latzugstange zwischen beiden Händen in der Vorderansicht)
    case 'span': {
      const q = J[g.to];
      return [{ tag: 'line', cls: 'fg-line ' + cls, a: { x1: at[0], y1: at[1], x2: q[0], y2: q[1] } }];
    }
    case 'cable': return [
      { tag: 'line', cls: 'fg-cable ' + cls, a: { x1: g.from[0], y1: g.from[1], x2: p[0], y2: p[1] } },
      { tag: 'circle', cls: 'fg-db ' + cls, a: { cx: p[0], cy: p[1], r: 3 } },
    ];
    default: return [{ tag: 'circle', cls: 'fg-db ' + cls, a: { cx: p[0], cy: p[1], r: g.r || 3.5 } }];
  }
}

// Figur als SVG. pat = Bewegungsmuster, gearType überschreibt den Gerätetyp des Musters.
// animate = false: nur die erste (bzw. pat.thumb) Pose – für die Vorschaubilder in der Liste.
function figSvg(pat, gearType, animate = true, label = '') {
  const front = !!pat.front;
  const poses = pat.poses.map(p => figJoints(p, front));
  const has = k => pat.poses.some(p => k.some(x => x in p));
  const farArm = front || has(['ua2', 'fa2']);
  const farLeg = front || has(['th2', 'sn2']);
  const els = [];  // { tag, cls, a: J => attrs }
  const seg = (a, b, cls) => els.push({ tag: 'line', cls, a: J => ({ x1: J[a][0], y1: J[a][1], x2: J[b][0], y2: J[b][1] }) });
  const gears = (pat.gear || []).map(g => {
    let type = g.fixed ? g.type : gearType || g.type;
    if (type === 'cable' && !g.from) type = 'bar';  // Seil nur, wo das Muster einen Zugpunkt hat
    return { ...g, type };
  });
  const cablesFirst = gears.filter(g => g.type === 'cable');
  const backCls = front ? 'fb' : 'fb far';

  // hinten: Seile, zweites Bein/Arm
  for (const g of cablesFirst) els.push({ gear: g, cls: '' });
  if (farLeg) { seg('h2', 'kn2', backCls + ' leg'); seg('kn2', 'ft2', backCls + ' leg'); if (!pat.noFeet) seg('ft2', 'toe2', backCls + ' foot'); }
  if (farArm) { seg('s2', 'el2', backCls + ' arm'); seg('el2', 'ha2', backCls + ' arm'); }
  for (const g of gears) if (g.type !== 'cable' && /2$/.test(g.at)) els.push({ gear: g, cls: front ? '' : 'far' });
  // Rumpf, Kopf, vorderes Bein und Arm
  seg('hip', 'sh', 'fb torso');
  if (front) { seg('s1', 's2', 'fb torso'); seg('h1', 'h2', 'fb torso'); }
  els.push({ tag: 'circle', cls: 'fh', a: J => ({ cx: J.head[0], cy: J.head[1], r: FIG.head }) });
  seg('h1', 'kn', 'fb leg'); seg('kn', 'ft', 'fb leg'); if (!pat.noFeet) seg('ft', 'toe', 'fb foot');
  for (const g of gears) if (g.type !== 'cable' && g.behind && !/2$/.test(g.at)) els.push({ gear: g, cls: '' });
  seg('s1', 'el', 'fb arm'); seg('el', 'ha', 'fb arm');
  for (const g of gears) if (g.type !== 'cable' && !g.behind && !/2$/.test(g.at)) els.push({ gear: g, cls: '' });

  // Werte je Pose -> statisch oder animiert
  const order = poses.length === 3 ? [0, 1, 2, 2, 1, 0] : [0, 1, 1, 0];
  const keyTimes = poses.length === 3 ? '0;.22;.44;.56;.78;1' : '0;.42;.58;1';
  const ease = '.45 0 .55 1', hold = '0 0 1 1';
  const splines = (poses.length === 3 ? [ease, ease, hold, ease, ease] : [ease, hold, ease]).join(';');
  const thumb = poses[pat.thumb || 0];
  const r1 = x => Math.round(x * 10) / 10;
  const out = [];
  // list = Attribute je Pose, still = Attribute des Standbilds
  const emit = (tag, cls, list, still) => {
    const base = animate ? list[0] : still;
    let attrs = '', anim = '';
    for (const k of Object.keys(base)) {
      attrs += ` ${k}="${r1(base[k])}"`;
      if (!animate) continue;
      const seq = order.map(i => r1(list[i][k]));
      if (new Set(seq).size > 1) {
        anim += `<animate attributeName="${k}" values="${seq.join(';')}" keyTimes="${keyTimes}" dur="${FIG_DUR}s" repeatCount="indefinite" calcMode="spline" keySplines="${splines}"/>`;
      }
    }
    out.push(`<${tag} class="${cls}"${attrs}>${anim}</${tag}>`);
  };
  for (const e of els) {
    if (e.gear) {
      const per = poses.map(J => figGear(e.gear, J, e.cls));
      const still = figGear(e.gear, thumb, e.cls);
      per[0].forEach((part, i) => emit(part.tag, part.cls, per.map(x => x[i].a), still[i].a));
    } else {
      emit(e.tag, e.cls, poses.map(J => e.a(J)), e.a(thumb));
    }
  }
  const props = (pat.props || []).map(p => {
    const [t, ...v] = p;
    if (t === 'r') return `<rect class="fp" x="${v[0]}" y="${v[1]}" width="${v[2]}" height="${v[3]}" rx="${v[4] ?? 2}"/>`;
    if (t === 'c') return `<circle class="fp-line" cx="${v[0]}" cy="${v[1]}" r="${v[2]}"/>`;
    return `<line class="fp-line" x1="${v[0]}" y1="${v[1]}" x2="${v[2]}" y2="${v[3]}" stroke-width="${v[4] || 4}"/>`;
  }).join('');
  const vb = pat.vb || [0, 0, 200, 160];
  const ground = pat.noGround ? '' : `<line class="fground" x1="${vb[0] + 8}" y1="${FIG_GROUND + 2}" x2="${vb[0] + vb[2] - 8}" y2="${FIG_GROUND + 2}"/>`;
  const body = props + out.join('');
  const g = pat.tilt ? `<g transform="rotate(${pat.tilt} ${pat.tiltAt ? pat.tiltAt.join(' ') : '100 100'})">${body}</g>` : body;
  return `<svg class="fig" viewBox="${vb.join(' ')}" role="img" aria-label="${label}">${ground}${g}</svg>`;
}

/* ---------- Bewegungsmuster ---------- */
// poses: 2 (Start/Ende) oder 3 (Start/Mitte/Ende) Posen; thumb: Pose fürs Vorschaubild.
// props: feste Teile (['r', x, y, b, h] Rechteck, ['l', x1, y1, x2, y2, Breite] Linie, ['c', x, y, r] Kreis).
// gear: Geräte an Gelenken (Typ wird je nach Übung ersetzt, außer fixed).
const BENCH = [['r', 52, 103, 90, 7], ['l', 62, 110, 62, 148, 4], ['l', 132, 110, 132, 148, 4]];
const LYING = { root: 'hip', at: [112, 97], torso: 180, th: 35, sn: 90 };   // auf der Bank liegend, Kopf links
const STAND = { root: 'ft', at: [96, 145], fo: 0, ua: 84, fa: 86 };           // stehend, Blick nach rechts
const FRONT = { root: 'ft', at: [94, 145] };                                   // stehend, von vorn
const SEAT = [['r', 64, 113, 42, 6], ['l', 86, 119, 86, 148, 4]];            // Sitz mit Fuß
const BACKREST = [['l', 70, 114, 62, 62, 6]];
const SEATED = { root: 'hip', at: [86, 111], torso: -92, th: 0, sn: 90, fo: 0 }; // sitzend
const TOPV = [0, -22, 200, 182];                                               // mehr Platz nach oben (Arme über Kopf)
const BAR = (y = 26) => [['l', 58, y, 142, y, 4], ['l', 62, y, 62, 182, 4], ['l', 138, y, 138, 182, 4]];
const both = (type, extra = {}) => [{ at: 'ha', type, ...extra }, { at: 'ha2', type, ...extra }];

const FIG_PATTERNS = {
  // ----- Brust -----
  bench: {
    props: BENCH, gear: [{ at: 'ha', type: 'plate' }], thumb: 1,
    poses: [{ ...LYING, ua: 80, ual: .5, fa: -85 }, { ...LYING, ua: -85, fa: -88 }],
  },
  chestpress: {
    props: [...SEAT, ...BACKREST], gear: [{ at: 'ha', type: 'bar' }], thumb: 1,
    poses: [{ ...SEATED, torso: -100, ua: 165, fa: 0 }, { ...SEATED, torso: -100, ua: -5, fa: -5 }],
  },
  // Butterfly-Maschine von vorn: Oberarme seitlich, Unterarme senkrecht an den Polstern
  fly: {
    front: true, noFeet: true, props: [['r', 72, 24, 56, 72, 6], ['r', 66, 100, 68, 8], ['l', 100, 108, 100, 148, 4]],
    gear: [{ at: 'el', type: 'line', ang: 90, len: 20, off: [0, -11], fixed: true },
      { at: 'el2', type: 'line', ang: 90, len: 20, off: [0, -11], fixed: true }],
    poses: [
      { root: 'hip', at: [100, 100], th: 95, thl: .4, sn: 90, ua: 180, fa: -90 },
      { root: 'hip', at: [100, 100], th: 95, thl: .4, sn: 90, ua: 12, ual: .35, fa: -90 },
    ],
  },
  // Fliegende auf der Bank, von der Seite: fast gestreckte Arme von seitlich unten bis über die Brust
  flyLying: {
    props: BENCH, gear: [{ at: 'ha', type: 'db', from: [40, 146] }],
    poses: [{ ...LYING, ua: 95, ual: .8, fa: 100, fal: .8 }, { ...LYING, ua: -85, fa: -72 }],
  },
  // Kabelzug-Fliegende von vorn: von oben (crossover), auf Schulterhöhe (crossoverMid), von unten (crossoverLow)
  crossover: {
    front: true, gear: [{ at: 'ha', type: 'cable', from: [12, 6] }, { at: 'ha2', type: 'cable', from: [188, 6] }],
    poses: [
      { ...FRONT, ua: 205, fa: 215 },
      { ...FRONT, ua: 70, ual: .8, fa: 80, fal: .8 },
    ],
  },
  crossoverMid: {
    front: true, gear: [{ at: 'ha', type: 'cable', from: [12, 40] }, { at: 'ha2', type: 'cable', from: [188, 40] }],
    poses: [
      { ...FRONT, ua: 183, fa: 188 },
      { ...FRONT, ua: 20, ual: .45, fa: 60, fal: .6 },
    ],
  },
  crossoverLow: {
    front: true, gear: [{ at: 'ha', type: 'cable', from: [12, 146] }, { at: 'ha2', type: 'cable', from: [188, 146] }],
    poses: [
      { ...FRONT, ua: 150, fa: 140 },
      { ...FRONT, ua: -5, ual: .4, fa: -70, fal: .55 },
    ],
  },
  dips: {
    props: [['r', 86, 76, 30, 5], ['l', 101, 81, 101, 148, 4]], thumb: 1,
    poses: [
      { root: 'ha', at: [100, 78], ua: 95, fa: 90, torso: -78, th: 110, sn: 160 },
      { root: 'ha', at: [100, 78], ua: 145, fa: 40, torso: -62, th: 110, sn: 160 },
    ],
  },
  pushup: {
    thumb: 1,
    poses: [
      { root: 'ha', at: [62, 141], ua: 90, fa: 90, torso: 205.5, th: 25.5, sn: 25.5, fo: 110 },
      { root: 'ha', at: [62, 141], ua: -15, fa: 120, torso: 186.8, th: 6.8, sn: 6.8, fo: 100 },
    ],
  },
  pullover: {
    props: BENCH, gear: [{ at: 'ha', type: 'db' }],
    poses: [{ ...LYING, ua: 165, fa: 170 }, { ...LYING, ua: -80, fa: -82 }],
  },
  // ----- Rücken -----
  pullup: {
    vb: [0, 0, 200, 182], noGround: true, thumb: 1, props: BAR(30),
    poses: [
      { root: 'ha', at: [104, 30], ua: -78, fa: -86, th: 100, sn: 160 },
      { root: 'ha', at: [104, 30], ua: 100, fa: -75, th: 100, sn: 160 },
    ],
  },
  pulldown: {
    props: [...SEAT, ['r', 118, 98, 16, 7]], gear: [{ at: 'ha', type: 'cable', from: [98, 2] }], thumb: 1,
    poses: [
      { ...SEATED, at: [90, 111], torso: -100, th: 5, sn: 95, ua: -78, fa: -85 },
      { ...SEATED, at: [90, 111], torso: -100, th: 5, sn: 95, ua: 115, fa: -60 },
    ],
  },
  rowBent: {
    gear: [{ at: 'ha', type: 'plate' }], thumb: 1,
    poses: [
      { ...STAND, at: [92, 145], sn: 100, th: 60, torso: -20, ua: 90, fa: 90 },
      { ...STAND, at: [92, 145], sn: 100, th: 60, torso: -20, ua: 200, fa: 90 },
    ],
  },
  rowSeated: {
    props: [['r', 55, 114, 36, 6], ['l', 73, 120, 73, 148, 4], ['l', 143, 104, 143, 136, 5]],
    gear: [{ at: 'ha', type: 'cable', from: [190, 92] }], thumb: 1,
    poses: [
      { root: 'hip', at: [72, 112], th: 0, sn: 15, torso: -75, ua: 0, fa: 0 },
      { root: 'hip', at: [72, 112], th: 0, sn: 15, torso: -95, ua: 160, fa: 5 },
    ],
  },
  straightarm: {
    gear: [{ at: 'ha', type: 'cable', from: [188, 4] }], thumb: 1,
    poses: [
      { ...STAND, at: [90, 145], sn: 95, th: 80, torso: -70, ua: -40, fa: -40 },
      { ...STAND, at: [90, 145], sn: 95, th: 80, torso: -70, ua: 75, fa: 75 },
    ],
  },
  deadlift: {
    gear: [{ at: 'ha', type: 'plate', r: 12 }],
    poses: [{ ...STAND, sn: 100, th: 40, torso: -22, ua: 110, fa: 105 }, { ...STAND }],
  },
  rdl: {
    gear: [{ at: 'ha', type: 'plate' }], thumb: 1,
    poses: [{ ...STAND, sn: 95 }, { ...STAND, sn: 95, th: 70, torso: -15 }],
  },
  hyperext: {
    props: [['r', 96, 94, 20, 7], ['c', 158, 127, 5], ['l', 108, 101, 112, 148, 4], ['l', 152, 132, 152, 148, 4]],
    poses: [
      { root: 'hip', at: [100, 88], th: 40, sn: 40, torso: 140, ua: 320, fa: 140 },
      { root: 'hip', at: [100, 88], th: 40, sn: 40, torso: 220, ua: 40, fa: 220 },
    ],
  },
  shrug: {
    front: true, gear: [{ at: 'ha', type: 'db', from: [80, 146] }, { at: 'ha2', type: 'db', from: [120, 146] }], thumb: 1,
    poses: [{ ...FRONT, ua: 92 }, { ...FRONT, ua: 92, lift: 7 }],
  },
  facepull: {
    gear: [{ at: 'ha', type: 'cable', from: [192, 22] }], thumb: 1,
    poses: [{ ...STAND, at: [84, 145], ua: -12, fa: -12 }, { ...STAND, at: [84, 145], ua: 200, fa: -20 }],
  },
  revfly: {
    front: true, gear: [{ at: 'ha', type: 'db', from: [190, 50] }, { at: 'ha2', type: 'db', from: [10, 50] }], thumb: 1,
    poses: [
      { ...FRONT, ua: 70, ual: .6, fa: 80, fal: .6 },
      { ...FRONT, ua: 175, fa: 180 },
    ],
  },
  // ----- Schultern -----
  ohp: {
    vb: TOPV, gear: [{ at: 'ha', type: 'plate' }], thumb: 1,
    poses: [{ ...STAND, ua: 70, fa: -80 }, { ...STAND, ua: -85, fa: -88 }],
  },
  ohpSeated: {
    props: [...SEAT, ...BACKREST], gear: [{ at: 'ha', type: 'db' }], thumb: 1,
    poses: [{ ...SEATED, ua: 70, fa: -80 }, { ...SEATED, ua: -85, fa: -88 }],
  },
  lateral: {
    front: true, gear: [{ at: 'ha', type: 'db', from: [178, 146] }, { at: 'ha2', type: 'db', from: [22, 146] }], thumb: 1,
    poses: [{ ...FRONT, ua: 100, fa: 95 }, { ...FRONT, ua: 172, fa: 165 }],
  },
  // Einarmig am Kabel: eine Hand hält den Kabelturm, die andere zieht das Kabel von unten vor dem Körper seitlich hoch
  lateralOne: {
    front: true, props: [['l', 160, 18, 160, 148, 5]], gear: [{ at: 'ha', type: 'cable', from: [157, 140] }], thumb: 1,
    poses: [{ ...FRONT, ua: 100, fa: 95, ua2: 15, fa2: 5 }, { ...FRONT, ua: 172, fa: 165, ua2: 15, fa2: 5 }],
  },
  frontraise: {
    gear: [{ at: 'ha', type: 'db', from: [70, 146] }], thumb: 1,
    poses: [{ ...STAND, ua: 85, fa: 85 }, { ...STAND, ua: -5, fa: -5 }],
  },
  uprightrow: {
    gear: [{ at: 'ha', type: 'plate', r: 8, from: [100, 146] }], thumb: 1,
    poses: [{ ...STAND, ua: 85, fa: 88 }, { ...STAND, ua: 210, fa: 20 }],
  },
  // ----- Arme -----
  curl: {
    gear: [{ at: 'ha', type: 'db', from: [120, 146], r: 8 }], thumb: 1,
    poses: [{ ...STAND }, { ...STAND, ua: 85, fa: -70 }],
  },
  preacher: {
    props: [['r', 58, 113, 36, 6], ['l', 76, 119, 76, 148, 4], ['l', 96, 74, 118, 100, 7], ['l', 114, 102, 114, 148, 4]],
    gear: [{ at: 'ha', type: 'db', r: 8, from: [150, 146] }], thumb: 1,
    poses: [
      { ...SEATED, at: [78, 111], torso: -80, ua: 48, fa: 45 },
      { ...SEATED, at: [78, 111], torso: -80, ua: 48, fa: -65 },
    ],
  },
  wrist: {
    props: SEAT, gear: [{ at: 'ha', type: 'db' }],
    poses: [
      { ...SEATED, at: [78, 111], torso: -55, ua: 85, fa: 14 },
      { ...SEATED, at: [78, 111], torso: -55, ua: 85, fa: -14 },
    ],
  },
  pushdown: {
    gear: [{ at: 'ha', type: 'cable', from: [138, 2] }], thumb: 1,
    poses: [
      { ...STAND, at: [90, 145], torso: -82, ua: 98, fa: -55 },
      { ...STAND, at: [90, 145], torso: -82, ua: 98, fa: 85 },
    ],
  },
  ohext: {
    vb: TOPV, gear: [{ at: 'ha', type: 'db', from: [40, 148] }], thumb: 1,
    poses: [{ ...STAND, ua: -100, fa: 115 }, { ...STAND, ua: -100, fa: -92 }],
  },
  skull: {
    props: BENCH, gear: [{ at: 'ha', type: 'plate', r: 8, from: [12, 112] }],
    poses: [{ ...LYING, ua: -105, fa: 160 }, { ...LYING, ua: -105, fa: -88 }],
  },
  benchdip: {
    props: [['r', 28, 100, 52, 7], ['l', 34, 107, 34, 148, 4], ['l', 74, 107, 74, 148, 4]], thumb: 1,
    poses: [
      { root: 'ha', at: [72, 101], ua: 95, fa: 90, torso: -100, th: 35, sn: 50 },
      { root: 'ha', at: [72, 101], ua: 140, fa: 60, torso: -100, th: 35, sn: 45 },
    ],
  },
  kickback: {
    props: [['r', 132, 112, 40, 6], ['l', 152, 118, 152, 148, 4]], gear: [{ at: 'ha', type: 'db', from: [20, 140] }], thumb: 1,
    poses: [
      { ...STAND, at: [100, 145], sn: 100, th: 50, torso: -10, ua: 175, fa: 90, ua2: 60, fa2: 90 },
      { ...STAND, at: [100, 145], sn: 100, th: 50, torso: -10, ua: 175, fa: 178, ua2: 60, fa2: 90 },
    ],
  },
  // ----- Beine -----
  squat: {
    gear: [{ at: 'sh', type: 'plate', off: [-4, -3], r: 11, fixed: true }], thumb: 1,
    poses: [
      { ...STAND, at: [100, 145], ua: 150, fa: -30 },
      { ...STAND, at: [100, 145], sn: 115, th: 10, torso: -55, ua: 185, fa: 5 },
    ],
  },
  squatFront: {
    gear: [{ at: 'ha', type: 'plate' }], thumb: 1,
    poses: [
      { ...STAND, at: [100, 145], ua: 15, fa: 195 },
      { ...STAND, at: [100, 145], sn: 115, th: 10, torso: -65, ua: 40, fa: 220 },
    ],
  },
  legpress: {
    props: [['l', 80, 124, 36, 80, 6], ['r', 62, 120, 32, 6], ['l', 76, 126, 76, 148, 4], ['l', 96, 128, 168, 56, 3]],
    gear: [{ at: 'ft', type: 'line', ang: 45, len: 30, fixed: true }], thumb: 1,
    poses: [
      { root: 'hip', at: [74, 116], torso: 225, th: -95, sn: 10, fo: 225, ua: 60, fa: 20 },
      { root: 'hip', at: [74, 116], torso: 225, th: -40, sn: -42, fo: 225, ua: 60, fa: 20 },
    ],
  },
  legext: {
    props: [['r', 66, 108, 40, 6], ['l', 72, 110, 64, 64, 6], ['l', 86, 114, 86, 148, 4]],
    gear: [{ at: 'ft', type: 'pad', r: 5.5, fixed: true }], thumb: 1,
    poses: [
      { root: 'hip', at: [82, 106], torso: -95, th: 0, sn: 95, ua: 95, fa: 40 },
      { root: 'hip', at: [82, 106], torso: -95, th: 0, sn: 8, ua: 95, fa: 40 },
    ],
  },
  legcurlLying: {
    props: [['r', 40, 100, 100, 7], ['l', 50, 107, 50, 148, 4], ['l', 130, 107, 130, 148, 4]],
    gear: [{ at: 'ft', type: 'pad', r: 5.5, off: [0, -6], fixed: true }], thumb: 1,
    poses: [
      { root: 'hip', at: [102, 95], torso: 180, th: 0, sn: 0, ua: 160, fa: 170 },
      { root: 'hip', at: [102, 95], torso: 180, th: 0, sn: -105, ua: 160, fa: 170 },
    ],
  },
  legcurlSeated: {
    props: [['r', 66, 108, 40, 6], ['l', 72, 110, 64, 64, 6], ['l', 86, 114, 86, 148, 4]],
    gear: [{ at: 'ft', type: 'pad', r: 5.5, off: [0, 6], fixed: true }], thumb: 1,
    poses: [
      { root: 'hip', at: [82, 106], torso: -95, th: 0, sn: 15, ua: 95, fa: 40 },
      { root: 'hip', at: [82, 106], torso: -95, th: 0, sn: 115, ua: 95, fa: 40 },
    ],
  },
  lunge: {
    gear: both('db'), thumb: 1,
    poses: [
      { root: 'hip', at: [92, 86], th: 64, sn: 64, fo: 0, th2: 119, sn2: 119, fo2: 20, ua2: 90, fa2: 90 },
      { root: 'hip', at: [95, 110], th: 5, sn: 105, fo: 0, th2: 120, sn2: 173, fo2: 100, ua2: 90, fa2: 90 },
    ],
  },
  stepup: {
    vb: TOPV, props: [['r', 110, 116, 50, 32]], thumb: 1,
    poses: [
      { root: 'ft', at: [128, 114], fo: 0, sn: 100, th: 20, torso: -75, th2: 100, sn2: 100, fo2: 0 },
      { root: 'ft', at: [128, 114], fo: 0, th2: 95, sn2: 90, fo2: 0 },
    ],
  },
  hipthrust: {
    props: [['r', 28, 108, 44, 7], ['l', 34, 115, 34, 148, 4], ['l', 66, 115, 66, 148, 4]],
    gear: [{ at: 'hip', type: 'plate', off: [0, -9] }],
    poses: [
      { root: 'ft', at: [140, 145], fo: 0, sn: 80, th: -40, torso: 203, ua: 15, fa: -10 },
      { root: 'ft', at: [140, 145], fo: 0, sn: 90, th: 0, torso: 180, ua: 15, fa: -10 },
    ],
  },
  bridge: {
    gear: [{ at: 'hip', type: 'db', off: [0, -6], fixed: true }],
    poses: [
      { root: 'ft', at: [140, 145], fo: 0, sn: 80, th: -30, torso: 170, ua: 10, fa: 0 },
      { root: 'ft', at: [140, 145], fo: 0, sn: 80, th: 10, torso: 145, ua: 40, fa: 10 },
    ],
  },
  glutekick: {
    props: [['l', 160, 30, 160, 148, 4]], gear: [{ at: 'ft', type: 'cable', from: [188, 146], fixed: true }], thumb: 1,
    poses: [
      { root: 'hip', at: [96, 80], torso: -78, th: 95, sn: 95, th2: 92, sn2: 90, fo2: 0, ua: 20, fa: -10 },
      { root: 'hip', at: [96, 80], torso: -78, th: 140, sn: 150, th2: 92, sn2: 90, fo2: 0, ua: 20, fa: -10 },
    ],
  },
  abductor: {
    front: true, props: [['r', 74, 40, 52, 56, 6], ['r', 66, 96, 68, 8]], noFeet: true,
    gear: [{ at: 'kn', type: 'pad', off: [-6, 0], fixed: true }, { at: 'kn2', type: 'pad', off: [6, 0], fixed: true }], thumb: 1,
    poses: [
      { root: 'hip', at: [100, 96], th: 95, thl: .4, sn: 90, ua: 105, fa: 90 },
      { root: 'hip', at: [100, 96], th: 150, thl: .7, sn: 80, ua: 105, fa: 90 },
    ],
  },
  adductor: {
    front: true, props: [['r', 74, 40, 52, 56, 6], ['r', 66, 96, 68, 8]], noFeet: true,
    gear: [{ at: 'kn', type: 'pad', off: [6, 0], fixed: true }, { at: 'kn2', type: 'pad', off: [-6, 0], fixed: true }],
    poses: [
      { root: 'hip', at: [100, 96], th: 150, thl: .7, sn: 80, ua: 105, fa: 90 },
      { root: 'hip', at: [100, 96], th: 95, thl: .4, sn: 90, ua: 105, fa: 90 },
    ],
  },
  calf: {
    props: [['r', 92, 145, 26, 4]], thumb: 1,
    poses: [{ root: 'toe', at: [106, 141], fo: 0 }, { root: 'toe', at: [106, 141], fo: 38 }],
  },
  calfSeated: {
    props: [['r', 58, 113, 34, 6], ['l', 74, 119, 74, 148, 4]],
    gear: [{ at: 'kn', type: 'line', ang: 0, len: 22, off: [-4, -6], fixed: true }], thumb: 1,
    poses: [
      { root: 'toe', at: [124, 141], torso: -90, th: 0, sn: 90, fo: 0, ua: 75, fa: 10 },
      { root: 'toe', at: [124, 141], torso: -90, th: 0, sn: 90, fo: 38, ua: 75, fa: 10 },
    ],
  },
  sissy: {
    props: [['l', 150, 60, 150, 148, 4]], thumb: 1,
    poses: [{ ...STAND, ua: 0, fa: 0 }, { ...STAND, sn: 130, th: 60, torso: -120, fo: 30, ua: -10, fa: 0 }],
  },
  nordic: {
    props: [['r', 52, 141, 80, 5], ['r', 44, 128, 14, 8]], thumb: 1,
    poses: [
      { root: 'kn', at: [92, 140], sn: 180, fo: 90, th: 90, torso: -90, ua: 95, fa: 70 },
      { root: 'kn', at: [92, 140], sn: 180, fo: 90, th: 135, torso: -45, ua: 60, fa: 60 },
    ],
  },
  // ----- Bauch -----
  crunch: {
    thumb: 1,
    poses: [
      { root: 'hip', at: [104, 140], torso: 180, th: -50, sn: 60, ua: 0, fa: 180 },
      { root: 'hip', at: [104, 140], torso: 210, th: -50, sn: 60, ua: 30, fa: 210 },
    ],
  },
  situp: {
    thumb: 1,
    poses: [
      { root: 'hip', at: [104, 140], torso: 180, th: -50, sn: 60, ua: 0, fa: 180 },
      { root: 'hip', at: [104, 140], torso: 250, th: -50, sn: 60, ua: 70, fa: 250 },
    ],
  },
  cablecrunch: {
    gear: [{ at: 'ha', type: 'cable', from: [114, 2] }], thumb: 1,
    poses: [
      { root: 'kn', at: [100, 141], sn: 180, fo: 90, th: 90, torso: -80, ua: 70, fa: -90 },
      { root: 'kn', at: [100, 141], sn: 180, fo: 90, th: 90, torso: -10, ua: 140, fa: -20 },
    ],
  },
  hangraise: {
    vb: [0, 0, 200, 190], noGround: true, props: BAR(24), thumb: 1,
    poses: [
      { root: 'ha', at: [104, 24], ua: -78, fa: -86, th: 92, sn: 90 },
      { root: 'ha', at: [104, 24], ua: -78, fa: -86, th: -2, sn: -2 },
    ],
  },
  kneeraise: {
    vb: [0, 0, 200, 190], noGround: true, props: BAR(24), thumb: 1,
    poses: [
      { root: 'ha', at: [104, 24], ua: -78, fa: -86, th: 92, sn: 90 },
      { root: 'ha', at: [104, 24], ua: -78, fa: -86, th: -15, sn: 80 },
    ],
  },
  legraiseLying: {
    thumb: 1,
    poses: [
      { root: 'hip', at: [100, 140], torso: 180, th: -8, sn: -8, ua: 5, fa: 0 },
      { root: 'hip', at: [100, 140], torso: 180, th: -88, sn: -88, ua: 5, fa: 0 },
    ],
  },
  plank: {
    poses: [
      { root: 'el', at: [58, 140], ua: 90, fa: 180, torso: 194.8, th: 14.8, sn: 14.8, fo: 100 },
      { root: 'el', at: [58, 140], ua: 90, fa: 180, torso: 196.5, th: 13, sn: 16, fo: 100 },
    ],
  },
  sideplank: {
    poses: [
      { root: 'el', at: [58, 140], ua: 90, fa: 180, ua2: -90, fa2: -90, torso: 194.8, th: 14.8, sn: 14.8, fo: 100 },
      { root: 'el', at: [58, 140], ua: 90, fa: 180, ua2: -95, fa2: -95, torso: 197, th: 13, sn: 16, fo: 100 },
    ],
  },
  twist: {
    front: true, noFeet: true, gear: [{ at: 'ha', type: 'db' }],
    poses: [
      { root: 'hip', at: [100, 120], torso: -100, th: -80, thl: .5, sn: 95, ua: 120, ual: .8, fa: 170, fal: .8, ua2: 150, fa2: 175 },
      { root: 'hip', at: [100, 120], torso: -80, th: -80, thl: .5, sn: 95, ua: 30, fa: 10, ua2: 60, ual2: .8, fa2: 5, fal2: .8 },
    ],
  },
  abwheel: {
    gear: [{ at: 'ha', type: 'plate', r: 7, fixed: true }], thumb: 1,
    poses: [
      { root: 'kn', at: [150, 141], sn: 0, fo: 90, th: 90, torso: -135, ua: 95, fa: 95 },
      { root: 'kn', at: [150, 141], sn: 0, fo: 90, th: 30, torso: 190, ua: 172, fa: 172 },
    ],
  },
  woodchop: {
    front: true, gear: [{ at: 'ha', type: 'cable', from: [12, 6] }], thumb: 1,
    poses: [
      { ...FRONT, torso: -100, ua: 215, fa: 220, ua2: 230, fa2: 215 },
      { ...FRONT, torso: -80, ua: 55, fa: 45, ua2: 70, fa2: 55 },
    ],
  },
  // ----- Ganzkörper -----
  kbswing: {
    gear: [{ at: 'ha', type: 'kb', fixed: true }], thumb: 1,
    poses: [{ ...STAND, sn: 100, th: 60, torso: -30, ua: 110, fa: 115 }, { ...STAND, ua: -5, fa: -5 }],
  },
  burpee: {
    vb: TOPV, thumb: 1,
    poses: [
      { ...STAND, ua: -95, fa: -95 },
      { ...STAND, sn: 125, th: 10, torso: -40, ua: 100, fa: 95 },
      { root: 'ha', at: [108, 141], ua: 90, fa: 90, torso: -25, th: 155, sn: 155, fo: 90 },
    ],
  },
  clean: {
    gear: [{ at: 'ha', type: 'plate' }], thumb: 2,
    poses: [
      { ...STAND, sn: 105, th: 35, torso: -25, ua: 105, fa: 100 },
      { ...STAND },
      { ...STAND, ua: 15, fa: 195 },
    ],
  },
  snatch: {
    vb: TOPV, gear: [{ at: 'ha', type: 'plate' }], thumb: 2,
    poses: [
      { ...STAND, sn: 105, th: 35, torso: -25, ua: 105, fa: 100 },
      { ...STAND },
      { ...STAND, ua: -95, fa: -95 },
    ],
  },
  thruster: {
    vb: TOPV, gear: [{ at: 'ha', type: 'plate' }], thumb: 2,
    poses: [
      { ...STAND, at: [100, 145], sn: 115, th: 10, torso: -65, ua: 40, fa: 220 },
      { ...STAND, at: [100, 145], ua: 15, fa: 195 },
      { ...STAND, at: [100, 145], ua: -85, fa: -88 },
    ],
  },
  sled: {
    props: [['r', 165, 112, 28, 34, 3], ['l', 170, 112, 178, 74, 4]],
    poses: [
      { root: 'hip', at: [92, 88], torso: -25, ua: 10, fa: -10, th: 50, sn: 100, th2: 120, sn2: 130, fo2: 30 },
      { root: 'hip', at: [92, 88], torso: -25, ua: 10, fa: -10, th: 120, sn: 130, th2: 50, sn2: 100, fo: 30, fo2: 0 },
    ],
  },
  // ----- Gehen, Laufen, Ausdauer -----
  walk: {
    poses: [
      { root: 'hip', at: [96, 80], torso: -88, th: 68, sn: 98, th2: 112, sn2: 125, ua: 105, fa: 95, ua2: 75, fa2: 65 },
      { root: 'hip', at: [96, 80], torso: -88, th: 112, sn: 125, th2: 68, sn2: 98, ua: 75, fa: 65, ua2: 105, fa2: 95 },
    ],
  },
  farmer: {
    gear: both('db'),
    poses: [
      { root: 'hip', at: [96, 80], th: 78, sn: 95, th2: 102, sn2: 112, ua2: 90, fa2: 90 },
      { root: 'hip', at: [96, 80], th: 102, sn: 112, th2: 78, sn2: 95, ua2: 90, fa2: 90 },
    ],
  },
  run: {
    poses: [
      { root: 'hip', at: [96, 82], torso: -80, th: 50, sn: 115, th2: 120, sn2: 165, ua: 125, fa: 30, ua2: 60, fa2: -40 },
      { root: 'hip', at: [96, 82], torso: -80, th: 120, sn: 165, th2: 50, sn2: 115, ua: 60, fa: -40, ua2: 125, fa2: 30 },
    ],
  },
  bike: {
    props: [['c', 122, 128, 16], ['l', 86, 92, 104, 128, 4], ['l', 76, 90, 96, 90, 5], ['l', 152, 76, 140, 130, 4]],
    poses: [
      { root: 'hip', at: [88, 86], torso: -60, ua: 30, fa: 10, th: 20, sn: 100, th2: 55, sn2: 85 },
      { root: 'hip', at: [88, 86], torso: -60, ua: 30, fa: 10, th: 55, sn: 85, th2: 20, sn2: 100 },
    ],
  },
  rower: {
    props: [['l', 30, 142, 190, 142, 3], ['l', 152, 118, 158, 140, 5], ['c', 176, 124, 13]],
    gear: [{ at: 'ha', type: 'cable', from: [176, 124] }], thumb: 1,
    poses: [
      { root: 'ft', at: [150, 132], sn: 60, th: -60, torso: -60, ua: 70, fa: 70, fo: -60 },
      { root: 'ft', at: [150, 132], sn: 0, th: 0, torso: -105, ua: 150, fa: 0, fo: -80 },
    ],
  },
  jumprope: {
    poses: [
      { root: 'hip', at: [96, 80], th: 90, sn: 92, ua: 110, fa: 70 },
      { root: 'hip', at: [96, 70], th: 92, sn: 100, fo: 50, ua: 100, fa: 40 },
    ],
  },
};

/* ---------- Erklärungen je Bewegungsmuster ---------- */
// also: weitere beteiligte Muskeln, steps: Ausführung, tips: worauf achten
const FIG_TEXT = {
  bench: {
    also: 'Trizeps, vordere Schulter',
    steps: ['Auf die Bank legen, Füße fest am Boden, Schulterblätter zusammen und nach unten ziehen.',
      'Gewicht etwas weiter als schulterbreit greifen und über die Brust bringen.',
      'Kontrolliert zur unteren Brust senken, Ellbogen etwa 45–70° vom Körper.',
      'Kraftvoll nach oben drücken, ohne die Ellbogen hart durchzustrecken.'],
    tips: ['Gesäß bleibt auf der Bank.', 'Handgelenke gerade über den Ellbogen.', 'Schwere Sätze nur mit Sicherung oder Partner.'],
  },
  chestpress: {
    also: 'Trizeps, vordere Schulter',
    steps: ['Sitz so einstellen, dass die Griffe auf Brusthöhe sind.', 'Rücken an die Lehne, Schulterblätter zurück.',
      'Griffe nach vorn drücken, bis die Arme fast gestreckt sind.', 'Langsam zurückführen, bis eine leichte Dehnung in der Brust spürbar ist.'],
    tips: ['Schultern unten lassen, nicht hochziehen.', 'Ohne Schwung, gleichmäßiges Tempo.'],
  },
  fly: {
    also: 'vordere Schulter',
    steps: ['Sitz so einstellen, dass die Griffe bzw. Polster etwa auf Brusthöhe sind, Rücken an die Lehne.',
      'Arme in einem Bogen vor der Brust zusammenführen.', 'Langsam wieder öffnen, bis eine Dehnung in der Brust spürbar ist.'],
    tips: ['Nicht zu weit nach hinten öffnen – schont die Schultern.', 'Schultern unten lassen, Brust raus.'],
  },
  flyLying: {
    also: 'vordere Schulter',
    steps: ['Auf der Bank liegen, Gewichte mit leicht gebeugten Armen über der Brust.',
      'Arme in einem weiten Bogen seitlich absenken – der Ellbogenwinkel bleibt gleich.',
      'Wenn die Brust gedehnt ist, im gleichen Bogen wieder über der Brust zusammenführen.'],
    tips: ['Nur so tief, wie es für die Schultern angenehm ist (etwa Höhe der Bank).', 'Lieber leichter – die Hebel sind lang.'],
  },
  crossover: {
    also: 'vordere Schulter',
    steps: ['Zwischen zwei Kabelzügen stehen, Griffe fassen, einen kleinen Schritt nach vorn.',
      'Mit leicht gebeugten Armen in einem Bogen vor dem Körper zusammenführen.', 'Kurz halten, dann kontrolliert zurück.'],
    tips: ['Oberkörper ruhig und leicht nach vorn geneigt.', 'Zugrichtung bestimmt den Schwerpunkt: von oben = untere Brust, von unten = obere Brust.'],
  },
  crossoverMid: {
    also: 'vordere Schulter',
    steps: ['Zwischen zwei Kabelzügen stehen, Rollen etwa auf Schulterhöhe, Griffe fassen, einen kleinen Schritt nach vorn.',
      'Mit leicht gebeugten Armen in einem waagerechten Bogen vor der Brust zusammenführen.', 'Kurz halten, dann kontrolliert öffnen, bis die Brust gedehnt ist.'],
    tips: ['Ellbogenwinkel bleibt während der ganzen Bewegung gleich.', 'Schultern unten lassen, Brust raus.'],
  },
  crossoverLow: {
    also: 'vordere Schulter',
    steps: ['Rollen ganz unten einstellen, Griffe fassen und mittig zwischen die Kabelzüge stellen.',
      'Arme leicht gebeugt seitlich unten – in einem Bogen nach vorn oben führen.',
      'Die Hände treffen sich vor dem Körper etwa auf Schulter- bzw. Kinnhöhe, dann langsam zurück.'],
    tips: ['Betont die obere Brust.', 'Nicht ins Hohlkreuz gehen, Oberkörper aufrecht.'],
  },
  dips: {
    also: 'Trizeps, vordere Schulter',
    steps: ['Am Barren stützen, Arme gestreckt, Schultern nach unten.', 'Kontrolliert absenken, bis die Oberarme etwa waagerecht sind.',
      'Wieder hochdrücken.'],
    tips: ['Oberkörper nach vorn geneigt = mehr Brust, aufrecht = mehr Trizeps.', 'Bei Schulterbeschwerden nicht zu tief.',
      'Zu schwer? Mit Unterstützung (Maschine oder Band) üben.'],
  },
  pushup: {
    also: 'Trizeps, vordere Schulter, Bauch',
    steps: ['Hände etwas weiter als schulterbreit, Körper bildet eine gerade Linie.', 'Brust kontrolliert Richtung Boden senken.',
      'Wieder hochdrücken.'],
    tips: ['Bauch und Gesäß anspannen – kein Durchhängen.', 'Leichter: Hände erhöht (Bank) oder auf den Knien.'],
  },
  pullover: {
    also: 'Brust, Trizeps',
    steps: ['Auf der Bank liegen, Gewicht mit beiden Händen über der Brust.', 'Mit leicht gebeugten Armen in einem Bogen hinter den Kopf senken.',
      'Im gleichen Bogen zurück über die Brust.'],
    tips: ['Nur so weit, wie es für die Schultern angenehm ist.', 'Rippen unten halten, kein starkes Hohlkreuz.'],
  },
  pullup: {
    also: 'Bizeps, hintere Schulter',
    steps: ['Stange greifen und frei hängen.', 'Schulterblätter nach unten ziehen, dann hochziehen, bis das Kinn über der Stange ist.',
      'Kontrolliert ganz absenken.'],
    tips: ['Kein Schwung aus den Beinen.', 'Zu schwer? Assistierte Maschine oder Gummiband nutzen.'],
  },
  pulldown: {
    also: 'Bizeps, hintere Schulter',
    steps: ['Oberschenkel unter das Polster, Griff fassen.', 'Oberkörper leicht nach hinten neigen, Brust raus.',
      'Griff zur oberen Brust ziehen, Ellbogen nach unten.', 'Langsam nach oben führen, bis die Arme gestreckt sind.'],
    tips: ['Nicht hinter den Kopf ziehen.', 'Bewegung aus dem Rücken, nicht mit Schwung.'],
  },
  rowBent: {
    also: 'Bizeps, hintere Schulter, unterer Rücken',
    steps: ['Leicht in die Knie, Oberkörper mit geradem Rücken weit nach vorn neigen.', 'Das Gewicht hängt mit gestreckten Armen.',
      'Zum Bauch ziehen, Ellbogen nah am Körper nach hinten.', 'Kontrolliert absenken.'],
    tips: ['Rücken bleibt gerade – nicht rund machen.', 'Oberkörper nicht mit Schwung aufrichten.'],
  },
  rowSeated: {
    also: 'Bizeps, hintere Schulter',
    steps: ['Aufrecht sitzen, Füße abgestützt, Knie leicht gebeugt.', 'Griff zum Bauch ziehen, Schulterblätter zusammen.',
      'Kurz halten, dann kontrolliert nach vorn, bis die Arme gestreckt sind.'],
    tips: ['Oberkörper bleibt ruhig, nicht zurückwerfen.', 'Schultern unten lassen.'],
  },
  straightarm: {
    also: 'hintere Schulter, Trizeps',
    steps: ['Vor dem Kabelzug stehen, Oberkörper leicht nach vorn, Arme fast gestreckt.',
      'Griff in einem Bogen bis zu den Oberschenkeln ziehen.', 'Langsam zurück nach oben.'],
    tips: ['Ellbogen bleiben leicht gebeugt und fest.', 'Spannung im breiten Rückenmuskel spüren.'],
  },
  deadlift: {
    also: 'Gesäß, Beinbeuger, Oberschenkel, Trapez',
    steps: ['Füße hüftbreit, Stange über der Fußmitte, nah am Schienbein.', 'Mit geradem Rücken in die Knie, Stange greifen, Brust raus.',
      'Aus den Beinen hochdrücken und die Stange am Körper entlang bis zum aufrechten Stand führen.', 'Kontrolliert in umgekehrter Reihenfolge absenken.'],
    tips: ['Rücken niemals rund machen.', 'Stange bleibt immer nah am Körper.', 'Oben nicht nach hinten überstrecken.'],
  },
  rdl: {
    also: 'Gesäß, unterer Rücken',
    steps: ['Aufrecht stehen, Knie leicht gebeugt, Gewicht vor den Oberschenkeln.', 'Hüfte nach hinten schieben, Oberkörper mit geradem Rücken nach vorn neigen.',
      'Gewicht nah an den Beinen bis etwa unter die Knie senken, bis die Beinrückseite spürbar dehnt.', 'Hüfte nach vorn schieben und aufrichten.'],
    tips: ['Kniewinkel bleibt fast gleich.', 'Rücken gerade, Blick leicht nach vorn-unten.'],
  },
  hyperext: {
    also: 'Gesäß, Beinbeuger',
    steps: ['Polster knapp unter dem Hüftknochen, Füße fest eingehakt.', 'Oberkörper mit geradem Rücken nach unten senken.',
      'Hochkommen, bis der Körper eine gerade Linie bildet.'],
    tips: ['Oben nicht überstrecken.', 'Mit Gewicht: Scheibe vor der Brust halten.'],
  },
  shrug: {
    also: 'Unterarme (Griffkraft)',
    steps: ['Aufrecht stehen, Gewicht mit gestreckten Armen halten.', 'Schultern gerade nach oben Richtung Ohren ziehen.',
      'Kurz halten und langsam absenken.'],
    tips: ['Schultern nicht kreisen.', 'Arme bleiben gestreckt.'],
  },
  facepull: {
    also: 'Trapez, Rotatorenmanschette',
    steps: ['Seil am Kabelzug etwa auf Kopfhöhe, mit beiden Händen greifen.', 'Seil Richtung Gesicht ziehen, Ellbogen hoch und nach außen.',
      'Hände am Ende neben den Ohren, kurz halten, zurück.'],
    tips: ['Leichtes Gewicht, saubere Bewegung.', 'Gut für gesunde Schultern.'],
  },
  revfly: {
    also: 'Trapez, oberer Rücken',
    steps: ['Arme vor dem Körper, leicht gebeugt.', 'In einem Bogen seitlich nach hinten öffnen, bis etwa auf Schulterhöhe.',
      'Kontrolliert zurückführen.'],
    tips: ['Schultern nicht hochziehen.', 'Leichtes Gewicht genügt – kein Schwung.'],
  },
  ohp: {
    also: 'Trizeps, seitliche Schulter, oberer Rücken',
    steps: ['Gewicht auf Schulterhöhe, Ellbogen leicht vor dem Körper.', 'Gerade nach oben über den Kopf drücken.',
      'Kontrolliert zurück auf Schulterhöhe.'],
    tips: ['Bauch und Gesäß anspannen – kein Hohlkreuz.', 'Kopf beim Drücken kurz zurück, oben wieder unter das Gewicht.'],
  },
  ohpSeated: {
    also: 'Trizeps, seitliche Schulter',
    steps: ['Lehne fast senkrecht, Rücken anlehnen, Füße fest am Boden.', 'Gewicht auf Schulterhöhe.',
      'Nach oben drücken, bis die Arme fast gestreckt sind.', 'Kontrolliert zurück auf Schulterhöhe.'],
    tips: ['Rücken bleibt an der Lehne – kein Hohlkreuz.', 'Ellbogen unten leicht vor dem Körper.'],
  },
  lateral: {
    also: 'Trapez',
    steps: ['Aufrecht stehen, Gewichte seitlich am Körper, Arme leicht gebeugt.', 'Arme seitlich bis etwa Schulterhöhe heben.',
      'Langsam absenken.'],
    tips: ['Nicht höher als Schulterhöhe, Schultern unten lassen.', 'Kleine Gewichte, kein Schwung.'],
  },
  lateralOne: {
    also: 'Trapez',
    steps: ['Seitlich neben den Kabelzug stellen, Rolle ganz unten. Mit der Hand auf der Seite des Kabelzugs festhalten.',
      'Mit der anderen Hand den Griff fassen – das Kabel läuft vor dem Körper.',
      'Arm leicht gebeugt seitlich bis etwa Schulterhöhe heben, langsam absenken. Danach Seite wechseln.'],
    tips: ['Nicht höher als Schulterhöhe, Schultern unten lassen.', 'Oberkörper ruhig – nicht vom Kabelzug wegkippen.'],
  },
  frontraise: {
    also: 'Brust (oben)',
    steps: ['Gewicht vor den Oberschenkeln, Arme fast gestreckt.', 'Nach vorn bis etwa Schulterhöhe heben.', 'Langsam absenken.'],
    tips: ['Oberkörper bleibt ruhig.', 'Kein Schwung aus dem Rücken.'],
  },
  uprightrow: {
    also: 'Trapez, Bizeps',
    steps: ['Gewicht vor dem Körper, Griff etwa schulterbreit.', 'Am Körper entlang bis etwa Brusthöhe ziehen, Ellbogen führen nach oben-außen.',
      'Langsam absenken.'],
    tips: ['Nicht zu hoch ziehen – bei Schulterbeschwerden lieber Seitheben.', 'Etwas breiterer Griff schont die Schultern.'],
  },
  curl: {
    also: 'Unterarme',
    steps: ['Aufrecht stehen, Gewicht mit gestreckten Armen, Ellbogen am Körper.', 'Nur den Unterarm beugen und das Gewicht Richtung Schulter heben.',
      'Langsam absenken, bis die Arme fast gestreckt sind.'],
    tips: ['Ellbogen bleiben an der Seite.', 'Kein Schwung aus dem Rücken.'],
  },
  preacher: {
    also: 'Unterarme',
    steps: ['Oberarme auf das Polster legen (bzw. Ellbogen am Oberschenkel), Arme fast gestreckt.',
      'Unterarm beugen und das Gewicht hochführen.', 'Langsam absenken, unten nicht ganz durchstrecken.'],
    tips: ['Oberarme bleiben aufliegen.', 'Unten besonders langsam – dort ist die Belastung am größten.'],
  },
  wrist: {
    steps: ['Unterarme auf Oberschenkeln oder Bank, Handgelenk über der Kante.', 'Nur das Handgelenk beugen und strecken.'],
    tips: ['Leichtes Gewicht, viele Wiederholungen.', 'Unterarme bleiben liegen.'],
  },
  pushdown: {
    steps: ['Vor dem Kabelzug stehen, Oberarme am Körper.', 'Griff nach unten drücken, bis die Arme gestreckt sind.',
      'Langsam zurück, bis die Unterarme etwa waagerecht sind.'],
    tips: ['Nur die Unterarme bewegen sich.', 'Oberkörper leicht nach vorn, aber ruhig.'],
  },
  ohext: {
    steps: ['Gewicht mit beiden Händen über dem Kopf.', 'Unterarme hinter dem Kopf absenken, Oberarme bleiben oben.', 'Wieder nach oben strecken.'],
    tips: ['Ellbogen zeigen nach vorn-oben, nicht weit nach außen.', 'Bauch fest – kein Hohlkreuz.'],
  },
  skull: {
    steps: ['Auf der Bank liegen, Gewicht mit gestreckten Armen über der Brust.', 'Nur die Unterarme beugen und das Gewicht Richtung Stirn senken.',
      'Wieder strecken.'],
    tips: ['Oberarme bleiben fast senkrecht.', 'Langsam und kontrolliert – der Kopf ist nah!'],
  },
  benchdip: {
    also: 'Brust, vordere Schulter',
    steps: ['Hände hinter dem Körper auf der Bankkante, Beine vorn.', 'Durch Beugen der Arme den Körper absenken.', 'Wieder hochdrücken.'],
    tips: ['Rücken nah an der Bank.', 'Nicht zu tief – schont die Schultern.', 'Leichter mit gebeugten Beinen.'],
  },
  kickback: {
    steps: ['Oberkörper nach vorn geneigt (eine Hand abgestützt), Oberarm parallel zum Körper.',
      'Unterarm nach hinten strecken, bis der Arm gerade ist.', 'Langsam zurück.'],
    tips: ['Oberarm bleibt ruhig am Körper.', 'Leichtes Gewicht, oben kurz halten.'],
  },
  squat: {
    also: 'Gesäß, Adduktoren, unterer Rücken',
    steps: ['Gewicht auf dem oberen Rücken, Füße etwa schulterbreit, Zehen leicht nach außen.', 'Hüfte nach hinten-unten, Knie in Richtung Zehen.',
      'So tief, wie es sauber geht (Ziel: Oberschenkel mindestens waagerecht).', 'Aus den Fersen kraftvoll aufrichten.'],
    tips: ['Rücken gerade, Brust raus.', 'Knie nicht nach innen fallen lassen.', 'Fersen bleiben am Boden.'],
  },
  squatFront: {
    also: 'Gesäß, Bauch, oberer Rücken',
    steps: ['Gewicht vorn vor den Schultern bzw. vor der Brust.', 'Oberkörper aufrecht, in die Hocke gehen.',
      'So tief, wie es sauber geht.', 'Aus den Fersen aufrichten.'],
    tips: ['Ellbogen hoch, damit das Gewicht nicht nach vorn kippt.', 'Knie zeigen in Richtung Zehen.'],
  },
  legpress: {
    also: 'Gesäß, Beinbeuger',
    steps: ['Rücken und Gesäß fest am Polster, Füße schulterbreit auf der Platte.', 'Sicherung lösen, Platte langsam absenken, bis die Knie etwa 90° gebeugt sind.',
      'Platte wieder wegdrücken, Knie nicht ganz durchstrecken.'],
    tips: ['Gesäß hebt nicht ab.', 'Knie zeigen in Richtung Zehen.', 'Füße höher = mehr Gesäß, tiefer = mehr Oberschenkel.'],
  },
  legext: {
    steps: ['Lehne so einstellen, dass das Knie an der Drehachse liegt, Polster vorn am Sprunggelenk.', 'Beine strecken, bis sie gerade sind.',
      'Langsam absenken.'],
    tips: ['Oben kurz halten, ohne Schwung.', 'Bei Kniebeschwerden mit wenig Gewicht und kleinerem Bewegungsumfang.'],
  },
  legcurlLying: {
    also: 'Waden',
    steps: ['Auf dem Bauch liegen, Polster knapp über den Fersen, Knie knapp hinter der Polsterkante.',
      'Fersen Richtung Gesäß ziehen.', 'Langsam strecken.'],
    tips: ['Hüfte bleibt auf dem Polster.', 'Kein Schwung.'],
  },
  legcurlSeated: {
    also: 'Waden',
    steps: ['Knie an der Drehachse, Polster hinter den Fersen, Oberschenkel fixiert.', 'Fersen nach unten-hinten ziehen.', 'Langsam zurück.'],
    tips: ['Rücken an der Lehne.', 'Unten kurz halten.'],
  },
  lunge: {
    also: 'Gesäß, Beinbeuger',
    steps: ['Großer Schritt bzw. Schrittstellung, Oberkörper aufrecht.', 'Hinteres Knie Richtung Boden senken, vorderes Knie über dem Fuß.',
      'Über das vordere Bein hochdrücken.'],
    tips: ['Vorderes Knie nicht nach innen fallen lassen.', 'Für das Gleichgewicht ruhig irgendwo festhalten.'],
  },
  stepup: {
    also: 'Gesäß',
    steps: ['Einen Fuß ganz auf eine stabile Box oder Bank stellen.', 'Über dieses Bein hochdrücken, bis du oben stehst.', 'Kontrolliert wieder absteigen.'],
    tips: ['Nicht mit dem unteren Bein abstoßen.', 'Box etwa kniehoch.'],
  },
  hipthrust: {
    also: 'Beinbeuger',
    steps: ['Oberer Rücken an der Bank, Gewicht auf der Hüfte (Polster nutzen), Füße fest am Boden.',
      'Hüfte hochdrücken, bis Oberkörper und Oberschenkel eine Linie bilden.', 'Oben das Gesäß fest anspannen, langsam absenken.'],
    tips: ['Kinn leicht zur Brust – kein Hohlkreuz.', 'Oben stehen die Schienbeine etwa senkrecht.'],
  },
  bridge: {
    also: 'Beinbeuger',
    steps: ['Auf dem Rücken liegen, Knie gebeugt, Füße hüftbreit.', 'Hüfte hochdrücken, bis Oberkörper und Oberschenkel eine Linie bilden.',
      'Oben kurz halten, langsam ablegen.'],
    tips: ['Kraft aus dem Gesäß, nicht aus dem Rücken.', 'Schwerer: Gewicht auf die Hüfte oder einbeinig.'],
  },
  glutekick: {
    also: 'Beinbeuger',
    steps: ['Am Kabelzug (Manschette am Fuß) oder an der Maschine stehen, Oberkörper leicht nach vorn.',
      'Bein gestreckt nach hinten-oben führen.', 'Langsam zurück.'],
    tips: ['Kein Hohlkreuz – die Bewegung kommt aus der Hüfte.', 'Standbein leicht gebeugt.'],
  },
  abductor: {
    steps: ['In die Maschine setzen, Polster außen an den Knien.', 'Beine gegen den Widerstand nach außen drücken.', 'Langsam zurück.'],
    tips: ['Rücken an der Lehne, ruhig sitzen.', 'Außen kurz halten.'],
  },
  adductor: {
    steps: ['In die Maschine setzen, Polster innen an den Knien.', 'Beine gegen den Widerstand zusammendrücken.', 'Langsam wieder öffnen.'],
    tips: ['Nur so weit öffnen, wie es angenehm dehnt.', 'Ruhig sitzen, kein Schwung.'],
  },
  calf: {
    steps: ['Fußballen auf eine Kante bzw. Platte, Fersen frei.', 'Fersen so hoch wie möglich drücken.', 'Langsam tief absenken, bis die Wade dehnt.'],
    tips: ['Oben kurz halten, unten nicht federn.', 'Knie bleiben fast gestreckt.'],
  },
  calfSeated: {
    steps: ['Sitzen, Polster auf den Oberschenkeln knapp über den Knien, Fußballen auf der Kante.', 'Fersen so hoch wie möglich drücken.',
      'Langsam tief absenken.'],
    tips: ['Trainiert durch die gebeugten Knie vor allem den tieferen Wadenmuskel.', 'Ganzer Bewegungsumfang, langsam.'],
  },
  sissy: {
    steps: ['Festhalten, auf die Zehenballen gehen.', 'Knie nach vorn schieben und den Oberkörper gerade nach hinten lehnen.', 'Wieder aufrichten.'],
    tips: ['Nur bei beschwerdefreien Knien, langsam steigern.'],
  },
  nordic: {
    also: 'Gesäß, Waden',
    steps: ['Kniend, Fersen fest fixiert (Gerät oder Partner).', 'Körper gerade halten und langsam nach vorn sinken lassen.',
      'Mit den Händen abfangen und mit der Kraft der Beinrückseite wieder hochziehen.'],
    tips: ['Sehr anspruchsvoll – anfangs nur das langsame Absenken üben.'],
  },
  crunch: {
    steps: ['Auf dem Rücken liegen, Knie gebeugt, Hände an den Schläfen oder vor der Brust.', 'Oberkörper einrollen, Schulterblätter vom Boden lösen.',
      'Langsam ablegen.'],
    tips: ['Nicht am Kopf ziehen.', 'Bauch fest, kleine kontrollierte Bewegung.'],
  },
  situp: {
    also: 'Hüftbeuger',
    steps: ['Auf dem Rücken liegen, Knie gebeugt, Füße fixiert.', 'Oberkörper einrollen und ganz aufrichten.', 'Langsam Wirbel für Wirbel ablegen.'],
    tips: ['Nicht mit Schwung hochreißen.', 'Bei Rückenbeschwerden lieber Crunches.'],
  },
  cablecrunch: {
    steps: ['Vor dem Kabelzug knien, Seil neben dem Kopf halten.', 'Oberkörper einrollen, Ellbogen Richtung Knie.', 'Langsam aufrichten.'],
    tips: ['Hüfte bleibt ruhig – nur der Oberkörper rollt ein.', 'Nicht mit den Armen ziehen.'],
  },
  hangraise: {
    also: 'Hüftbeuger, Griffkraft',
    steps: ['An der Stange hängen.', 'Beine gestreckt nach vorn-oben heben, mindestens waagerecht.', 'Langsam senken, ohne zu schwingen.'],
    tips: ['Becken leicht einrollen.', 'Leichter: Knie anziehen statt gestreckter Beine.'],
  },
  kneeraise: {
    also: 'Hüftbeuger',
    steps: ['An der Stange hängen oder an der Dipstation stützen.', 'Knie zur Brust ziehen, Becken einrollen.', 'Langsam senken, ohne zu schwingen.'],
    tips: ['Ruhig bleiben, kein Schwung.'],
  },
  legraiseLying: {
    also: 'Hüftbeuger',
    steps: ['Auf dem Rücken liegen, Hände neben dem Körper.', 'Beine gestreckt bis fast senkrecht heben.', 'Langsam senken, ohne sie ganz abzulegen.'],
    tips: ['Unterer Rücken bleibt am Boden.', 'Leichter mit gebeugten Knien.'],
  },
  plank: {
    also: 'Schultern, Gesäß',
    steps: ['Unterarme unter den Schultern, Körper gerade auf den Zehenspitzen.', 'Bauch und Gesäß anspannen und halten.'],
    tips: ['Kein Durchhängen, Hüfte nicht zu hoch.', 'Bei „Wdh.“ die gehaltenen Sekunden eintragen.'],
  },
  sideplank: {
    also: 'seitliche Hüfte, Schulter',
    steps: ['Seitlich auf einen Unterarm stützen, Ellbogen unter der Schulter.', 'Hüfte anheben, bis der Körper eine gerade Linie bildet, und halten.',
      'Seite wechseln.'],
    tips: ['Hüfte nicht absinken lassen.', 'Bei „Wdh.“ die Sekunden je Seite eintragen.'],
  },
  twist: {
    steps: ['Sitzen, Oberkörper leicht zurückgelehnt, Füße am Boden oder angehoben.', 'Gewicht von einer Seite zur anderen führen, Oberkörper dreht mit.'],
    tips: ['Rücken gerade, langsam drehen.'],
  },
  abwheel: {
    also: 'Schultern, Rücken',
    steps: ['Kniend, Hände am Rad unter den Schultern.', 'Rad langsam nach vorn rollen, der Körper wird lang.', 'Mit Bauchspannung zurückrollen.'],
    tips: ['Nur so weit, wie der Rücken gerade bleibt.', 'Anfangs kleine Strecken.'],
  },
  woodchop: {
    also: 'Schultern, Hüfte',
    steps: ['Seitlich zum Kabelzug stehen, Griff mit beiden Händen.', 'Diagonal zur anderen Seite ziehen, der Oberkörper dreht mit.',
      'Kontrolliert zurück.'],
    tips: ['Arme fast gestreckt, die Drehung kommt aus dem Rumpf.', 'Beide Seiten trainieren.'],
  },
  kbswing: {
    also: 'Gesäß, Beinbeuger, Rücken, Schultern',
    steps: ['Kettlebell zwischen den Beinen nach hinten schwingen, Hüfte nach hinten.', 'Hüfte explosiv nach vorn strecken – die Kettlebell schwingt bis Brusthöhe.',
      'Zurückschwingen lassen und gleich wiederholen.'],
    tips: ['Kraft aus der Hüfte, nicht aus den Armen.', 'Rücken gerade.'],
  },
  burpee: {
    also: 'Ganzer Körper, Ausdauer',
    steps: ['In die Hocke, Hände auf den Boden.', 'Füße nach hinten in den Liegestütz springen.', 'Zurück in die Hocke und aufrichten, optional mit Strecksprung.'],
    tips: ['Leichter: Füße einzeln zurücksetzen statt springen.'],
  },
  clean: {
    also: 'Beine, Gesäß, Rücken, Trapez',
    steps: ['Startposition wie beim Kreuzheben.', 'Stange explosiv hochziehen, unter die Stange gehen und vorn auf den Schultern fangen.', 'Aufrichten.'],
    tips: ['Technisch anspruchsvoll – mit leichtem Gewicht oder unter Anleitung lernen.'],
  },
  snatch: {
    also: 'Beine, Gesäß, Rücken, Schultern',
    steps: ['Breiter Griff, Startposition wie beim Kreuzheben.', 'Stange in einer Bewegung explosiv über den Kopf bringen.', 'Mit gestreckten Armen über dem Kopf aufrichten.'],
    tips: ['Sehr technisch – nur mit leichtem Gewicht oder unter Anleitung.'],
  },
  thruster: {
    also: 'Schultern, Trizeps, Gesäß',
    steps: ['Stange vorn auf den Schultern, Frontkniebeuge.', 'Aus der Hocke kraftvoll aufrichten und den Schwung nutzen, um die Stange über den Kopf zu drücken.',
      'Stange zurück auf die Schultern und direkt in die nächste Kniebeuge.'],
    tips: ['Fließende Bewegung, Rücken gerade.'],
  },
  sled: {
    also: 'Gesäß, Waden, Ausdauer',
    steps: ['Hände an den Griffen, Körper schräg nach vorn.', 'Mit kräftigen, kurzen Schritten schieben.'],
    tips: ['Rücken gerade, Arme fest.'],
  },
  walk: {
    steps: ['Aufrecht mit gleichmäßigem Tempo gehen bzw. treten.', 'Arme schwingen locker mit.'],
    tips: ['Bei „Wdh.“ z. B. die Minuten eintragen.'],
  },
  farmer: {
    also: 'Trapez, Bauch, Beine',
    steps: ['Schwere Gewichte neben dem Körper halten.', 'Aufrecht mit kleinen, sicheren Schritten gehen.', 'Strecke oder Zeit festlegen.'],
    tips: ['Schultern nach hinten-unten, Bauch fest.'],
  },
  run: {
    steps: ['Locker laufen, gleichmäßig atmen.', 'Tempo so wählen, dass du dich noch unterhalten könntest (Grundlagenausdauer).'],
    tips: ['Bei „Wdh.“ z. B. die Minuten eintragen.'],
  },
  bike: {
    steps: ['Sattel so einstellen, dass das Knie unten fast gestreckt ist.', 'Gleichmäßig treten.'],
    tips: ['Bei „Wdh.“ z. B. die Minuten eintragen.'],
  },
  rower: {
    also: 'Rücken, Beine, Arme',
    steps: ['Erst die Beine strecken, dann den Oberkörper leicht zurück, zuletzt die Arme zum Bauch ziehen.', 'In umgekehrter Reihenfolge zurück.'],
    tips: ['Die meiste Kraft kommt aus den Beinen.', 'Rücken gerade.'],
  },
  jumprope: {
    steps: ['Kleine, lockere Sprünge auf den Fußballen.', 'Das Seil aus den Handgelenken drehen.'],
    tips: ['Bei „Wdh.“ z. B. die Minuten eintragen.'],
  },
};

/* ---------- Übungen: [Bewegungsmuster, Besonderheit, Gerät (optional, sonst aus dem Namen)] ---------- */
const LIB_EX = {
  // Brust
  'Bankdrücken Flachbank (Langhantel)': ['bench', 'Der Klassiker für die ganze Brust.'],
  'Bankdrücken Flachbank (Kurzhantel)': ['bench', 'Mit Kurzhanteln: größerer Bewegungsumfang, jede Seite arbeitet für sich.'],
  'Bankdrücken Flachbank (Multipresse)': ['bench', 'In der Führung – sicher ohne Partner, die Bahn ist vorgegeben.'],
  'Bankdrücken Schrägbank (Langhantel)': ['bench', 'Bank auf etwa 30° – betont die obere Brust.'],
  'Bankdrücken Schrägbank (Kurzhantel)': ['bench', 'Bank auf etwa 30° – betont die obere Brust, mit großem Bewegungsumfang.'],
  'Bankdrücken Schrägbank (Multipresse)': ['bench', 'Bank auf etwa 30° in der Multipresse – obere Brust, sicher geführt.'],
  'Bankdrücken Schrägmaschine': ['chestpress', 'Drückt schräg nach oben – obere Brust, sicher geführt.'],
  'Bankdrücken Negativbank (Langhantel)': ['bench', 'Kopf tiefer als die Hüfte – betont die untere Brust.'],
  'Bankdrücken Negativbank (Kurzhantel)': ['bench', 'Kopf tiefer als die Hüfte – untere Brust, mit Kurzhanteln.'],
  'Bankdrücken enger Griff': ['bench', 'Hände etwa schulterbreit, Ellbogen nah am Körper – mehr Trizeps.'],
  'Bankdrücken Floor Press': ['bench', 'Auf dem Boden liegend: Die Ellbogen stoppen am Boden – schont die Schultern.'],
  'Brustpresse Maschine': ['chestpress', 'Geführt und sicher – gut zum Lernen und für schwere Sätze ohne Partner.'],
  'Brustpresse Maschine eng': ['chestpress', 'Enge Griffe – mehr innere Brust und Trizeps.'],
  'Brustpresse Maschine breit': ['chestpress', 'Breite Griffe – mehr Dehnung der Brust.'],
  'Brustpresse Maschine einarmig': ['chestpress', 'Einarmig – jede Seite einzeln, gut bei Ungleichgewichten.'],
  'Brustpresse Maschine Negativ': ['chestpress', 'Drückt schräg nach unten – betont die untere Brust.'],
  'Brustpresse Kabelzug stehend': ['crossover', 'Im Stand nach vorn drücken – Rumpf muss mitstabilisieren.'],
  'Butterfly Maschine': ['fly', 'Geführt – die Brust arbeitet ohne Trizeps.'],
  'Butterfly Kabelzug': ['crossoverMid','Zwischen zwei Kabelzügen auf Schulterhöhe – die Spannung bleibt über die ganze Bewegung gleich.'],
  'Fliegende Flachbank (Kurzhantel)': ['flyLying', 'Auf der Flachbank – ganze Brust.'],
  'Fliegende Schrägbank (Kurzhantel)': ['flyLying', 'Auf der Schrägbank (ca. 30°) – obere Brust.'],
  'Fliegende Negativbank (Kurzhantel)': ['flyLying', 'Auf der Negativbank – untere Brust.'],
  'Kabelzug Crossover': ['crossoverMid','Zug von Schulterhöhe – ganze Brust.'],
  'Kabelzug Crossover von oben': ['crossover', 'Zug von oben nach unten – betont die untere Brust.'],
  'Kabelzug Crossover von unten': ['crossoverLow','Zug von unten nach oben – betont die obere Brust.'],
  'Kabelzug Fliegende Schrägbank': ['flyLying', 'Auf der Schrägbank zwischen zwei Kabelzügen – obere Brust, gleichmäßige Spannung.'],
  'Dips (Brust)': ['dips', 'Oberkörper deutlich nach vorn neigen, Ellbogen etwas nach außen.'],
  'Dips assistiert (Maschine)': ['dips', 'Die Maschine nimmt einen Teil des Körpergewichts ab – mehr Gewicht = leichter.'],
  'Liegestütze': ['pushup', 'Klassische Ausführung ohne Geräte.'],
  'Liegestütze eng': ['pushup', 'Hände eng unter der Brust – mehr Trizeps.'],
  'Liegestütze erhöht': ['pushup', 'Hände auf Bank oder Kasten – leichter, gut zum Einsteigen.'],
  'Überzüge / Pullover (Kurzhantel)': ['pullover', 'Kurzhantel mit beiden Händen am Gewichtsteller fassen.'],

  // Rücken
  'Klimmzüge': ['pullup', 'Griff etwas weiter als schulterbreit.'],
  'Klimmzüge breit': ['pullup', 'Weiter Griff – betont den breiten Rückenmuskel.'],
  'Klimmzüge enger Griff': ['pullup', 'Enger Griff – mehr Bizeps und unterer Lat.'],
  'Klimmzüge Neutralgriff': ['pullup', 'Handflächen zeigen zueinander – oft schonend für die Schultern.'],
  'Klimmzüge Untergriff (Chin-ups)': ['pullup', 'Handflächen zeigen zu dir – mehr Bizeps.'],
  'Klimmzüge mit Zusatzgewicht': ['pullup', 'Gewicht am Gürtel – erst, wenn saubere Klimmzüge leicht fallen.'],
  'Klimmzüge assistiert (Maschine)': ['pullup', 'Die Maschine hilft mit – mehr Gewicht = leichter.'],
  'Latziehen breit': ['pulldown', 'Weiter Griff – betont die Breite des Rückens.'],
  'Latziehen eng (V-Griff)': ['pulldown', 'V-Griff, Handflächen zueinander – großer Bewegungsumfang.'],
  'Latziehen Untergriff': ['pulldown', 'Schulterbreiter Untergriff – mehr Bizeps.'],
  'Latziehen Neutralgriff': ['pulldown', 'Parallele Griffe – schulterschonend.'],
  'Latziehen einarmig': ['pulldown', 'Einarmig – jede Seite einzeln, mehr Dehnung.'],
  'Latziehen kniend (Kabelzug)': ['pulldown', 'Kniend vor dem Kabelzug – Rumpf stabilisiert mit.'],
  'Latziehen Maschine': ['pulldown', 'Geführte Bahn – gut zum Lernen.'],
  'Latziehen Maschine einarmig': ['pulldown', 'Geführt und einarmig – jede Seite einzeln.'],
  'Rudern Langhantel vorgebeugt': ['rowBent', 'Obergriff, Oberkörper etwa 45° oder tiefer.'],
  'Rudern Langhantel Untergriff': ['rowBent', 'Untergriff – mehr Bizeps und unterer Lat.'],
  'Rudern Langhantel Pendlay': ['rowBent', 'Oberkörper waagerecht, jede Wiederholung startet vom Boden.'],
  'Rudern Kurzhantel einarmig': ['rowBent', 'Eine Hand und ein Knie auf der Bank abstützen – schont den unteren Rücken.'],
  'Rudern Kurzhantel beidarmig vorgebeugt': ['rowBent', 'Beide Kurzhanteln gleichzeitig, Oberkörper vorgebeugt.'],
  'Rudern Kurzhantel brustgestützt (Schrägbank)': ['rowBent', 'Bauchlings auf der Schrägbank – der Rücken wird entlastet.'],
  'Rudern Seal Row (Bank)': ['rowBent', 'Bauchlings auf einer hohen Flachbank – kein Schwung möglich.'],
  'Rudern Kabelzug sitzend': ['rowSeated', 'Der Standard am Kabel.'],
  'Rudern Kabelzug eng (V-Griff)': ['rowSeated', 'V-Griff, zum Bauchnabel ziehen.'],
  'Rudern Kabelzug breit': ['rowSeated', 'Breiter Griff, Ellbogen höher – mehr oberer Rücken und Trapez.'],
  'Rudern Kabelzug Untergriff': ['rowSeated', 'Untergriff – mehr Bizeps und unterer Lat.'],
  'Rudern Kabelzug Seil': ['rowSeated', 'Seil – Hände am Ende auseinanderziehen.'],
  'Rudern Kabelzug einarmig': ['rowSeated', 'Einarmig – jede Seite einzeln.'],
  'Rudern Kabelzug stehend': ['rowSeated', 'Im Stand, leicht in die Knie – Rumpf stabilisiert mit.'],
  'Rudern Maschine': ['rowSeated', 'Geführt – Brust am Polster, Schulterblätter zusammen.'],
  'Rudern Maschine eng': ['rowSeated', 'Enge Griffe – zum Bauch ziehen.'],
  'Rudern Maschine breit': ['rowSeated', 'Breite Griffe, Ellbogen hoch – oberer Rücken und Trapez.'],
  'Rudern Maschine Neutralgriff': ['rowSeated', 'Parallele Griffe – schulterschonend.'],
  'Rudern Maschine Untergriff': ['rowSeated', 'Untergriff – mehr Bizeps.'],
  'Rudern Maschine brustgestützt': ['rowSeated', 'Brust am Polster – entlastet den unteren Rücken.'],
  'Rudern Maschine einarmig': ['rowSeated', 'Einarmig – jede Seite einzeln.'],
  'Low Row Maschine': ['rowSeated', 'Zug von unten nach hinten – betont den unteren Lat.'],
  'High Row Maschine': ['pulldown', 'Zug von oben-vorn nach unten-hinten – zwischen Latziehen und Rudern.'],
  'Rudern T-Bar': ['rowBent', 'Stange in einer Ecke bzw. Gerät, Griff am Ende – stabil und schwer belastbar.'],
  'Rudern T-Bar eng': ['rowBent', 'Enger Griff – zum Bauch ziehen.'],
  'Rudern T-Bar breit': ['rowBent', 'Breiter Griff – mehr oberer Rücken.'],
  'Rudern T-Bar brustgestützt': ['rowBent', 'Brust am Polster – entlastet den unteren Rücken.'],
  'Meadows Row': ['rowBent', 'Einarmig an der Stangenspitze, seitlich stehend – starke Dehnung.'],
  'Rudern Multipresse': ['rowBent', 'Vorgebeugt in der Multipresse – geführte Bahn.'],
  'Überzüge Kabelzug (Straight-Arm Pulldown)': ['straightarm', 'Isoliert den breiten Rückenmuskel ohne Bizeps.'],
  'Überzüge Maschine (Pullover)': ['pullover', 'Geführter Überzug – Lat ohne Bizeps.', 'bar'],
  'Kreuzheben': ['deadlift', 'Füße hüftbreit, Griff knapp außerhalb der Beine.'],
  'Kreuzheben Sumo': ['deadlift', 'Breiter Stand, Griff innerhalb der Beine – aufrechterer Oberkörper, mehr Beine.'],
  'Kreuzheben Trap Bar': ['deadlift', 'In der sechseckigen Stange stehen – rückenfreundlicher, gut zum Einsteigen.'],
  'Kreuzheben Defizit': ['deadlift', 'Auf einer kleinen Erhöhung stehen – längerer Weg, schwerer Start.'],
  'Rack Pulls': ['deadlift', 'Start aus Kniehöhe im Rack – nur der obere Teil, betont den Rücken.'],
  'Hyperextensions (Rückenstrecker)': ['hyperext', 'Ohne Gewicht, Arme vor der Brust verschränkt.'],
  'Hyperextensions mit Gewicht': ['hyperext', 'Scheibe oder Kurzhantel vor der Brust halten.'],
  'Reverse Hyperextensions': ['hyperext', 'Oberkörper liegt, die gestreckten Beine werden nach oben gehoben – betont das Gesäß.'],
  'Rückenstrecker Maschine': ['hyperext', 'Sitzend gegen das Polster nach hinten strecken – geführt.'],
  'Good Mornings': ['rdl', 'Stange auf dem oberen Rücken statt in den Händen – sonst wie rumänisches Kreuzheben.'],
  'Shrugs Langhantel': ['shrug', 'Stange vor den Oberschenkeln.'],
  'Shrugs Kurzhantel': ['shrug', 'Kurzhanteln seitlich – natürliche Bahn.'],
  'Shrugs Maschine': ['shrug', 'Geführt – gut für schwere Gewichte.'],
  'Shrugs Kabelzug': ['shrug', 'Am Kabel gleichmäßige Spannung.'],
  'Face Pulls': ['facepull', 'Seil am Kabelzug, auf Kopfhöhe eingestellt.'],

  // Schultern
  'Schulterdrücken Langhantel stehend (Military Press)': ['ohp', 'Im Stand – Bauch und Gesäß müssen mitarbeiten.'],
  'Schulterdrücken Langhantel sitzend': ['ohpSeated', 'Sitzend mit Lehne – mehr Stabilität.', 'plate'],
  'Schulterdrücken Kurzhantel sitzend': ['ohpSeated', 'Kurzhanteln – jede Seite für sich, natürlicher Bewegungsweg.'],
  'Schulterdrücken Kurzhantel stehend': ['ohp', 'Im Stand mit Kurzhanteln – Rumpf stabilisiert mit.', 'db'],
  'Schulterdrücken Maschine': ['ohpSeated', 'Geführt – gut zum Lernen und für schwere Sätze.', 'bar'],
  'Schulterdrücken Multipresse': ['ohpSeated', 'Sitzend in der Multipresse – geführte Bahn.', 'plate'],
  'Arnold Press': ['ohpSeated', 'Unten Handflächen zu dir, beim Drücken nach außen drehen.', 'db'],
  'Landmine Press': ['ohp', 'Stangenende schräg nach vorn-oben drücken – schulterschonend.'],
  'Seitheben Kurzhantel': ['lateral', 'Der Klassiker für breite Schultern.'],
  'Seitheben Kurzhantel sitzend': ['lateral', 'Sitzend – weniger Schwung möglich.'],
  'Seitheben liegend (Schrägbank)': ['lateral', 'Seitlich auf der Schrägbank liegend, ein Arm – Spannung schon ganz unten.'],
  'Seitheben Kabelzug': ['lateral', 'Kabel von unten auf der Gegenseite – gleichmäßige Spannung.'],
  'Seitheben Kabelzug einarmig': ['lateralOne', 'Einarmig seitlich neben dem Kabelzug – mit der freien Hand festhalten.'],
  'Seitheben Maschine': ['lateral', 'Geführt – Polster außen an den Oberarmen.'],
  'Y-Raises': ['lateral', 'Arme schräg nach vorn-oben in Y-Form heben, oft vorgebeugt oder auf der Schrägbank.'],
  'Frontheben Kurzhantel': ['frontraise', 'Abwechselnd oder beidarmig.'],
  'Frontheben Langhantel': ['frontraise', 'Beidarmig mit der Stange.'],
  'Frontheben Kabelzug': ['frontraise', 'Kabel von unten hinter dem Körper.'],
  'Frontheben Hantelscheibe': ['frontraise', 'Scheibe mit beiden Händen seitlich fassen.'],
  'Reverse Butterfly Maschine': ['revfly', 'Brust zum Polster, Griffe nach hinten öffnen.', 'bar'],
  'Reverse Butterfly Kabelzug': ['revfly', 'Kabel überkreuz greifen, nach außen ziehen.'],
  'Vorgebeugtes Seitheben (Kurzhantel)': ['revfly', 'Oberkörper weit vorgebeugt, Arme seitlich heben.'],
  'Reverse Flys Kabelzug': ['revfly', 'Am Kabel auf Schulterhöhe, Arme nach außen öffnen.'],
  'Aufrechtes Rudern Langhantel': ['uprightrow', 'Stange eng am Körper hochziehen.'],
  'Aufrechtes Rudern Kabelzug': ['uprightrow', 'Am Kabel von unten – gleichmäßige Spannung.'],

  // Bizeps & Unterarme
  'Bizepscurls Langhantel': ['curl', 'Schulterbreiter Untergriff.'],
  'Bizepscurls SZ-Stange': ['curl', 'Gewinkelte Stange – angenehmer für die Handgelenke.'],
  'Bizepscurls Kurzhantel': ['curl', 'Abwechselnd oder beidarmig, Handflächen oben nach außen drehen.'],
  'Bizepscurls Kurzhantel Schrägbank': ['curl', 'Auf der Schrägbank sitzend, Arme hängen nach hinten – starke Dehnung.'],
  'Bizepscurls Kabelzug': ['curl', 'Am Kabel von unten – gleichmäßige Spannung.'],
  'Bizepscurls Kabelzug einarmig': ['curl', 'Einarmig am Kabel.'],
  'Bizepscurls Kabelzug hinter dem Körper (Bayesian)': ['curl', 'Mit dem Rücken zum Kabelzug, Arm hinter dem Körper – starke Dehnung.'],
  'Bizepscurls Maschine': ['preacher', 'Geführt, Oberarme auf dem Polster.', 'bar'],
  'Drag Curls': ['curl', 'Stange am Körper nach oben „schleifen“, Ellbogen wandern nach hinten.', 'plate'],
  'Hammercurls Kurzhantel': ['curl', 'Handflächen zeigen zueinander – mehr Oberarmmuskel (Brachialis) und Unterarm.'],
  'Hammercurls Kabelzug (Seil)': ['curl', 'Seil mit neutralem Griff.'],
  'Hammercurls Scottbank': ['preacher', 'Neutraler Griff auf der Scottbank.', 'db'],
  'Konzentrationscurls': ['preacher', 'Sitzend, Ellbogen innen am Oberschenkel abgestützt.', 'db'],
  'Scottcurls SZ-Stange (Preacher Curls)': ['preacher', 'SZ-Stange auf der Scottbank.', 'plate'],
  'Scottcurls Kurzhantel': ['preacher', 'Einarmig oder beidarmig auf der Scottbank.'],
  'Scottcurls Kabelzug': ['preacher', 'Scottbank vor dem Kabelzug.', 'cable'],
  'Scottcurls Maschine': ['preacher', 'Geführte Scottbank.', 'bar'],
  'Spider Curls': ['preacher', 'Bauchlings auf der Schrägbank, Arme hängen senkrecht.', 'db'],
  'Reverse Curls': ['curl', 'Obergriff – trainiert vor allem Unterarme und Brachialis.', 'plate'],
  'Handgelenkcurls (Unterarme)': ['wrist', 'Handflächen oben – Beuger des Unterarms.'],
  'Reverse Handgelenkcurls (Unterarme)': ['wrist', 'Handflächen unten – Strecker des Unterarms.'],
  'Farmer\'s Walk': ['farmer', 'Trainiert Griffkraft, Rumpf und Haltung.'],

  // Trizeps
  'Trizepsdrücken Kabelzug (Stange)': ['pushdown', 'Gerade oder gewinkelte Stange, Obergriff.'],
  'Trizepsdrücken Kabelzug (Seil)': ['pushdown', 'Seil – unten die Hände auseinanderziehen.'],
  'Trizepsdrücken Kabelzug (V-Griff)': ['pushdown', 'V-Griff – angenehm für die Handgelenke.'],
  'Trizepsdrücken Kabelzug Untergriff': ['pushdown', 'Untergriff – etwas leichter, andere Betonung.'],
  'Trizepsdrücken Kabelzug einarmig': ['pushdown', 'Einarmig – jede Seite einzeln.'],
  'Trizepsdrücken über Kopf Kabelzug': ['ohext', 'Mit dem Rücken zum Kabelzug, Seil über dem Kopf – starke Dehnung.', 'cable'],
  'Trizepsdrücken über Kopf Kurzhantel': ['ohext', 'Eine Kurzhantel mit beiden Händen hinter dem Kopf.'],
  'Trizepsdrücken über Kopf Maschine': ['ohext', 'Geführt, Ellbogen auf dem Polster.', 'bar'],
  'Stirndrücken SZ-Stange (French Press)': ['skull', 'SZ-Stange zur Stirn bzw. knapp hinter den Kopf senken.'],
  'Stirndrücken Langhantel': ['skull', 'Gerade Stange – enger Obergriff.'],
  'Stirndrücken Kurzhantel': ['skull', 'Kurzhanteln, Handflächen zueinander.', 'db'],
  'Stirndrücken Kabelzug': ['skull', 'Auf der Bank vor dem Kabelzug liegend.', 'cable'],
  'Dips (Trizeps)': ['dips', 'Oberkörper aufrecht, Ellbogen nah am Körper.'],
  'Dips Maschine': ['dips', 'Sitzend geführt – Griffe nach unten drücken.'],
  'Bankdips': ['benchdip', 'Ohne Geräte – nur eine Bank oder ein stabiler Stuhl.'],
  'Trizeps-Kickbacks Kurzhantel': ['kickback', 'Oberarm bleibt fest am Körper.'],
  'Trizeps-Kickbacks Kabelzug': ['kickback', 'Am Kabel von unten – Spannung auch oben.', 'cable'],
  'Trizepsmaschine': ['pushdown', 'Geführt – Griffe nach unten bzw. vorn strecken.', 'bar'],

  // Beine
  'Kniebeugen (Langhantel)': ['squat', 'Die Königsübung für die Beine.'],
  'Kniebeugen Safety Bar': ['squat', 'Spezialstange mit Griffen vorn – schont Schultern und Ellbogen.'],
  'Kniebeugen Box': ['squat', 'Kurz auf eine Box setzen – kontrollierte, gleichbleibende Tiefe.'],
  'Kniebeugen Multipresse': ['squat', 'Geführt – Füße etwas weiter vorn stellen.'],
  'Frontkniebeugen': ['squatFront', 'Stange vorn auf den Schultern – aufrechter Oberkörper, mehr Oberschenkel.'],
  'Goblet Squats': ['squatFront', 'Kurzhantel oder Kettlebell vor der Brust – ideal zum Lernen der Kniebeuge.', 'db'],
  'Hackenschmidt-Kniebeugen (Hack Squat)': ['squat', 'In der Maschine, Rücken am Polster – geführt, viel Oberschenkel.'],
  'Hackenschmidt rückwärts (Reverse Hack)': ['squat', 'Brust zum Polster – mehr Gesäß.'],
  'Pendulum Squat': ['squat', 'Pendelnde Maschine – sehr kniegeführt, viel Oberschenkel.'],
  'Belt Squat': ['squat', 'Gewicht hängt am Gürtel – entlastet den Rücken.'],
  'Beinpresse': ['legpress', 'Füße schulterbreit in der Mitte der Platte.'],
  'Beinpresse 45°': ['legpress', 'Schlitten im 45°-Winkel – der Klassiker.'],
  'Beinpresse horizontal': ['legpress', 'Waagerecht sitzend – oft leichter einzustellen.'],
  'Beinpresse vertikal': ['legpress', 'Liegend, Platte über dem Körper – sehr großer Bewegungsumfang.'],
  'Beinpresse einbeinig': ['legpress', 'Ein Bein – jede Seite einzeln, mit wenig Gewicht beginnen.'],
  'Beinstrecker': ['legext', 'Isoliert den vorderen Oberschenkel.'],
  'Beinstrecker einbeinig': ['legext', 'Ein Bein – jede Seite einzeln.'],
  'Beinbeuger liegend': ['legcurlLying', 'Bauchlings – Hüfte bleibt auf dem Polster.'],
  'Beinbeuger sitzend': ['legcurlSeated', 'Sitzend – starke Dehnung der Beinrückseite.'],
  'Beinbeuger stehend einbeinig': ['legcurlLying', 'Im Stand an der Maschine, ein Bein beugt nach hinten.'],
  'Ausfallschritte Kurzhantel': ['lunge', 'Kurzhanteln seitlich in den Händen.'],
  'Ausfallschritte Langhantel': ['lunge', 'Stange auf dem oberen Rücken – auf Gleichgewicht achten.', 'plate'],
  'Ausfallschritte gehend': ['lunge', 'Abwechselnd vorwärts gehen.'],
  'Ausfallschritte rückwärts': ['lunge', 'Schritt nach hinten – kniefreundlicher.'],
  'Ausfallschritte Multipresse': ['lunge', 'In der Führung – mehr Gleichgewicht, Fokus auf das vordere Bein.', 'plate'],
  'Bulgarian Split Squats': ['lunge', 'Hinterer Fuß auf einer Bank – sehr effektiv für Oberschenkel und Gesäß.'],
  'Step-ups': ['stepup', 'Mit oder ohne Kurzhanteln.'],
  'Kreuzheben rumänisch (Langhantel)': ['rdl', 'Der Klassiker für die Beinrückseite.'],
  'Kreuzheben rumänisch (Kurzhantel)': ['rdl', 'Kurzhanteln vor den Oberschenkeln.', 'db'],
  'Kreuzheben gestreckte Beine': ['rdl', 'Knie fast gestreckt – noch mehr Dehnung der Beinrückseite.'],
  'Hip Thrust Langhantel': ['hipthrust', 'Stange mit Polster auf der Hüfte.'],
  'Hip Thrust Maschine': ['hipthrust', 'Geführt – leicht einzustellen.'],
  'Hip Thrust Multipresse': ['hipthrust', 'In der Multipresse – stabil.'],
  'Hip Thrust Kurzhantel': ['hipthrust', 'Kurzhantel auf der Hüfte – gut zum Einsteigen.'],
  'Glute Bridge': ['bridge', 'Auf dem Boden – Einstieg zum Hip Thrust.'],
  'Gesäß-Kickbacks Kabelzug': ['glutekick', 'Fußmanschette am unteren Kabelzug.'],
  'Gesäßmaschine (Glute Kickback)': ['glutekick', 'Geführt, Bein drückt gegen das Polster nach hinten.'],
  'Abduktoren Maschine': ['abductor', 'Trainiert die äußere Hüfte (seitliches Gesäß).'],
  'Abduktoren Kabelzug': ['abductor', 'Im Stand, Bein seitlich nach außen führen.'],
  'Adduktoren Maschine': ['adductor', 'Trainiert die Innenseite der Oberschenkel.'],
  'Adduktoren Kabelzug': ['adductor', 'Im Stand, Bein zur Mitte ziehen.'],
  'Wadenheben stehend': ['calf', 'An der Maschine oder auf einer Stufe.'],
  'Wadenheben sitzend': ['calfSeated', 'Gebeugte Knie – trainiert den tieferen Wadenmuskel.'],
  'Wadenheben einbeinig': ['calf', 'Ein Bein auf der Stufe, mit einer Hand festhalten.'],
  'Wadenheben an der Beinpresse': ['calf', 'Nur die Fußballen auf der Platte, Beine gestreckt – Platte mit den Zehen wegdrücken.'],
  'Wadenheben Hackenschmidt': ['calf', 'In der Hackenschmidt-Maschine, Fußballen auf der Kante.'],
  'Wadenheben Multipresse': ['calf', 'Stange auf dem Rücken, Fußballen auf einer Erhöhung.'],
  'Sissy Squats': ['sissy', 'Anspruchsvolle Übung für den vorderen Oberschenkel.'],
  'Nordic Curls': ['nordic', 'Sehr wirksam für die Beinrückseite – langsam steigern.'],

  // Bauch
  'Crunches': ['crunch', 'Der Klassiker – kleine, saubere Bewegung.'],
  'Crunches Kabelzug (kniend)': ['cablecrunch', 'Mit Gewicht – gut steigerbar.'],
  'Crunches Maschine': ['cablecrunch', 'Sitzend, geführt – Oberkörper gegen den Widerstand einrollen.'],
  'Crunches Schrägbank': ['crunch', 'Kopf tiefer als die Hüfte – schwerer.'],
  'Sit-ups': ['situp', 'Ganz aufrichten, Füße fixiert.'],
  'Sit-ups Schrägbank': ['situp', 'Auf der Schrägbank – schwerer, Füße eingehakt.'],
  'Beinheben hängend': ['hangraise', 'Anspruchsvoll – auch für die Griffkraft.'],
  'Beinheben liegend': ['legraiseLying', 'Auf dem Boden oder einer Bank.'],
  'Knieheben hängend': ['kneeraise', 'Leichtere Variante des Beinhebens.'],
  'Knieheben Dipstation': ['kneeraise', 'An der Dipstation gestützt – Rücken an der Lehne.'],
  'Plank (Unterarmstütz)': ['plank', 'Haltezeit statt Wiederholungen.'],
  'Seitstütz': ['sideplank', 'Trainiert die seitliche Bauchmuskulatur.'],
  'Russian Twists': ['twist', 'Mit oder ohne Gewicht.'],
  'Bauchroller (Ab Wheel)': ['abwheel', 'Sehr anspruchsvoll – auf den Knien beginnen.'],
  'Rotationsmaschine': ['woodchop', 'Sitzend geführt – Oberkörper gegen den Widerstand drehen.'],
  'Holzhacker Kabelzug': ['woodchop', 'Von oben nach unten oder umgekehrt diagonal ziehen.'],

  // Ganzkörper
  'Kettlebell Swings': ['kbswing', 'Explosive Hüftstreckung – Kraft und Ausdauer.'],
  'Burpees': ['burpee', 'Ganzkörper-Ausdauer ohne Geräte.'],
  'Umsetzen (Power Clean)': ['clean', 'Olympische Übung – Technik vor Gewicht.'],
  'Reißen (Snatch)': ['snatch', 'Olympische Übung – sehr technisch.'],
  'Thruster': ['thruster', 'Kniebeuge und Schulterdrücken in einer Bewegung.'],
  'Schlitten schieben': ['sled', 'Kraft und Ausdauer, schonend für die Gelenke.'],

  // Ausdauer
  'Laufband': ['run', 'Gehen oder Laufen – Steigung erhöht die Belastung.'],
  'Crosstrainer': ['walk', 'Gelenkschonend, Arme arbeiten mit.'],
  'Fahrrad-Ergometer': ['bike', 'Gelenkschonend, gut zum Aufwärmen.'],
  'Rudergerät': ['rower', 'Ganzkörper-Ausdauer.'],
  'Stepper': ['stepup', 'Treppensteigen auf der Stelle.'],
  'Seilspringen': ['jumprope', 'Koordination und Ausdauer.'],
};

/* ---------- Abwandlungen für einzelne Übungen ---------- */
// Damit Varianten derselben Bewegung unterschiedlich aussehen (Bankneigung, einarmig, Gerät, Ansicht …).
const RAIL = x => ['l', x, 6, x, 148, 2.5];  // Führungsschiene der Multipresse (hinter der Figur)
const INCLINE_BENCH = [['r', 96, 103, 36, 7], ['l', 100, 106, 56, 85, 7], ['l', 106, 110, 106, 148, 4],
  ['l', 126, 110, 126, 148, 4], ['l', 80, 96, 80, 148, 4]];
const DECLINE_BENCH = [['r', 96, 103, 36, 7], ['l', 100, 106, 58, 123, 7], ['l', 106, 110, 106, 148, 4],
  ['l', 128, 110, 128, 148, 4], ['l', 66, 125, 66, 148, 4]];
const INCLINE = { props: INCLINE_BENCH, pose: { torso: 206 }, each: [{}, { ua: -100, fa: -102 }] };
const DECLINE = { props: DECLINE_BENCH, pose: { torso: 158 }, each: [{}, { ua: -78, fa: -80 }] };
const FLY_INCLINE = { props: INCLINE_BENCH, pose: { torso: 206 }, each: [{ ua: 110, fa: 115 }, { ua: -100, fa: -88 }] };
const FLY_DECLINE = { props: DECLINE_BENCH, pose: { torso: 158 }, each: [{ ua: 80, fa: 85 }, { ua: -78, fa: -65 }] };
const withRail = (m, x) => ({ ...m, addProps: [...(m.addProps || []), RAIL(x)] });
// Ausfallschritte mit der Langhantel auf den Schultern
const BARBELL_LUNGE = {
  gear: [{ at: 'sh', type: 'plate', off: [-4, -3], r: 11, fixed: true }], pose: { ua: 150, fa: -30, ua2: 150, fa2: -30 },
};
// Crunches/Sit-ups auf der Negativbank: Kopf tiefer, Füße oben eingehakt
const DECLINE_SIT = {
  props: [['l', 36, 146, 172, 108, 7], ['c', 164, 118, 5]],
  pose: { root: 'hip', at: [104, 122], th: -15, sn: 20 },
};
// Hackenschmidt/Pendulum: an das schräge Rückenpolster gelehnt, Füße vorn auf der Plattform, Schulterpolster
const HACK = {
  props: [['l', 112, 147, 146, 134, 5]],
  gear: [{ at: 'sh', type: 'line', ang: -125, len: 40, off: [9, 21], fixed: true }, { at: 'sh', type: 'pad', off: [3, -5], r: 5, fixed: true }],
  poses: [
    { root: 'ft', at: [126, 140], fo: -20, torso: -125, th: 58, sn: 58, ua: 60, fa: -40 },
    { root: 'ft', at: [126, 140], fo: -20, torso: -125, th: -8, sn: 98, ua: 60, fa: -40 },
  ],
};

const LIB_MOD = {
  // ----- Brust -----
  'Bankdrücken Flachbank (Multipresse)': withRail({}, 74),
  'Bankdrücken Schrägbank (Langhantel)': INCLINE,
  'Bankdrücken Schrägbank (Multipresse)': withRail(INCLINE, 62),
  'Bankdrücken Negativbank (Langhantel)': DECLINE,
  'Bankdrücken Schrägbank (Kurzhantel)': INCLINE,
  'Bankdrücken Negativbank (Kurzhantel)': DECLINE,
  'Fliegende Schrägbank (Kurzhantel)': FLY_INCLINE,
  'Fliegende Negativbank (Kurzhantel)': FLY_DECLINE,
  'Bankdrücken enger Griff': { each: [{ ua: 55, ual: .65, fa: -82 }, {}] },
  'Bankdrücken Floor Press': {
    props: [], poses: [
      { root: 'hip', at: [112, 140], torso: 180, th: -55, sn: 62, ua: 90, ual: .15, fa: -86 },
      { root: 'hip', at: [112, 140], torso: 180, th: -55, sn: 62, ua: -85, fa: -88 },
    ],
  },
  // ----- Rücken: Rudern -----
  'Rudern Langhantel Pendlay': { pose: { torso: -2, th: 48 }, each: [{ ua: 92, fa: 92 }, { ua: 205, fa: 92 }] },
  'Rudern Langhantel Untergriff': { pose: { torso: -34, th: 66 }, each: [{}, { ua: 195, fa: 85 }] },
  'Rudern T-Bar': { gear: [{ at: 'ha', type: 'pole', from: [14, 146], r: 9, fixed: true }] },
  'Rudern T-Bar eng': { gear: [{ at: 'ha', type: 'pole', from: [14, 146], r: 9, fixed: true }] },
  'Rudern T-Bar breit': { gear: [{ at: 'ha', type: 'pole', from: [14, 146], r: 9, fixed: true }] },
  'Rudern T-Bar brustgestützt': {
    props: [['l', 84, 83, 108, 63, 8], ['l', 92, 80, 92, 148, 4]],
    gear: [{ at: 'ha', type: 'pole', from: [186, 146], r: 9, fixed: true }],
    pose: { at: [84, 145], torso: -40, th: 72, sn: 92 }, each: [{ ua: 88, fa: 88 }, { ua: 205, fa: 88 }],
  },
  'Meadows Row': {
    gear: [{ at: 'ha', type: 'pole', from: [190, 146], r: 9, fixed: true }],
    pose: { torso: -12, th: 55, ua2: 70, fa2: 45 }, each: [{ ua: 95, fa: 95 }, { ua: 205, fa: 95 }],
  },
  'Rudern Multipresse': { addProps: [RAIL(118)] },
  'Rudern Kurzhantel einarmig': {
    props: [['r', 122, 100, 60, 7], ['l', 130, 107, 130, 148, 4], ['l', 174, 107, 174, 148, 4]],
    pose: { at: [84, 145], torso: -6, th: 62, sn: 98, ua2: 80, fa2: 88 }, each: [{ ua: 90, fa: 90 }, { ua: 205, fa: 90 }],
  },
  'Rudern Kurzhantel brustgestützt (Schrägbank)': {
    props: [['l', 86, 112, 136, 80, 8], ['l', 104, 104, 104, 148, 4], ['r', 80, 112, 24, 6]],
    poses: [
      { root: 'hip', at: [92, 104], torso: -36, th: 125, sn: 95, fo: 0, ua: 90, fa: 90 },
      { root: 'hip', at: [92, 104], torso: -36, th: 125, sn: 95, fo: 0, ua: 205, fa: 88 },
    ],
  },
  'Rudern Maschine brustgestützt': { addProps: [['l', 104, 56, 108, 92, 7]], pose: { torso: -88 } },
  'Rudern Maschine einarmig': { pose: { ua2: 75, fa2: -5 } },
  'Rudern Kabelzug einarmig': { pose: { ua2: 75, fa2: -5 } },
  'Low Row Maschine': { each: [{ torso: -60, ua: 25, fa: 25 }, { torso: -98, ua: 165, fa: 10 }] },
  'Bankdrücken Schrägmaschine': { pose: { torso: -112 }, each: [{ ua: 160, fa: -35 }, { ua: -42, fa: -42 }] },
  'Brustpresse Maschine Negativ': { each: [{ ua: 165, fa: 22 }, { ua: 25, fa: 25 }] },
  'Brustpresse Maschine einarmig': { pose: { ua2: 78, fa2: 8 } },
  'Brustpresse Kabelzug stehend': {
    pattern: 'chestpress', set: { front: false }, props: [['l', 6, 30, 6, 148, 4]], gear: [{ at: 'ha', type: 'cable', from: [8, 52] }],
    poses: [
      { ...STAND, at: [104, 145], sn: 96, th: 84, torso: -88, ua: 165, fa: -5 },
      { ...STAND, at: [104, 145], sn: 96, th: 84, torso: -84, ua: -2, fa: -2 },
    ],
  },
  'Kabelzug Crossover': { each: [{}, { ua: 38, ual: .5, fa: 75, fal: .7 }] },
  'Dips (Brust)': { each: [{ torso: -68 }, { torso: -52 }] },
  'Dips (Trizeps)': { pose: { torso: -86 } },
  'Dips assistiert (Maschine)': {
    addProps: [['l', 132, 30, 132, 148, 4]], gear: [{ at: 'kn', type: 'pad', r: 6, off: [0, 6], fixed: true }],
    pose: { th: 100, sn: 175 },
  },
  'Dips Maschine': {
    props: [...SEAT, ...BACKREST], gear: [{ at: 'ha', type: 'bar', fixed: true }],
    poses: [{ ...SEATED, ua: 118, fa: 55 }, { ...SEATED, ua: 96, fa: 94 }],
  },
  'Liegestütze erhöht': {
    props: [['r', 40, 117, 34, 31, 3]],
    poses: [
      { root: 'ha', at: [58, 117], ua: 90, fa: 90, torso: 197, th: 17, sn: 17, fo: 110 },
      { root: 'ha', at: [58, 117], ua: -15, fa: 120, torso: 184, th: 4, sn: 4, fo: 100 },
    ],
  },
  'Liegestütze eng': { each: [{}, { ua: 5, fa: 118 }] },
  // ----- Arme: Trizeps -----
  'Trizepsdrücken Kabelzug einarmig': { pose: { ua2: 92, fa2: 92 } },
  // ----- Arme: Bizeps -----
  'Drag Curls': { each: [{}, { ua: 128, fa: -62 }] },
  'Bizepscurls Kabelzug einarmig': { pose: { ua2: 88, fa2: 88 } },
  'Bizepscurls Kabelzug hinter dem Körper (Bayesian)': {
    props: [['l', 8, 30, 8, 148, 4]], gear: [{ at: 'ha', type: 'cable', from: [10, 132] }],
    each: [{ ua: 118, fa: 118 }, { ua: 118, fa: -40 }],
  },
  'Bizepscurls Kurzhantel Schrägbank': {
    props: [['r', 64, 113, 42, 6], ['l', 86, 119, 86, 148, 4], ['l', 68, 114, 44, 66, 6]],
    poses: [{ ...SEATED, torso: -118, ua: 100, fa: 100 }, { ...SEATED, torso: -118, ua: 100, fa: -40 }],
  },
  'Konzentrationscurls': {
    props: SEAT,
    poses: [{ ...SEATED, at: [78, 111], torso: -52, ua: 86, fa: 88 }, { ...SEATED, at: [78, 111], torso: -52, ua: 86, fa: -62 }],
  },
  'Spider Curls': {
    props: [['l', 82, 118, 128, 84, 8], ['l', 104, 104, 104, 148, 4]],
    poses: [
      { root: 'hip', at: [88, 110], torso: -38, th: 122, sn: 95, fo: 0, ua: 90, fa: 90 },
      { root: 'hip', at: [88, 110], torso: -38, th: 122, sn: 95, fo: 0, ua: 90, fa: -38 },
    ],
  },
  // ----- Schultern -----
  'Landmine Press': { gear: [{ at: 'ha', type: 'pole', from: [12, 146], r: 7, fixed: true }], each: [{}, { ua: -48, fa: -48 }] },
  'Schulterdrücken Multipresse': { addProps: [RAIL(90)] },
  'Arnold Press': {
    poses: [{ ...SEATED, ua: 22, fa: -88 }, { ...SEATED, ua: 76, fa: -82 }, { ...SEATED, ua: -85, fa: -88 }],
  },
  'Seitheben Kurzhantel sitzend': {
    set: { noFeet: true }, props: [['r', 66, 100, 68, 8], ['l', 100, 108, 100, 148, 4]],
    pose: { root: 'hip', at: [100, 100], th: 95, thl: .4, sn: 90 },
  },
  'Y-Raises': { each: [{}, { ua: -128, fa: -128 }] },
  'Frontheben Hantelscheibe': { gear: [{ at: 'ha', type: 'plate', r: 13, fixed: true }], each: [{}, { ua: -22, fa: -22 }] },
  // ----- Beine: Einbeinig, Ausfallschritte, Waden -----
  'Beinstrecker einbeinig': { pose: { th2: 0, sn2: 95 } },
  'Beinbeuger stehend einbeinig': {
    props: [['r', 118, 62, 8, 46, 3], ['l', 122, 108, 122, 148, 4]],
    gear: [{ at: 'ft', type: 'pad', r: 5.5, off: [4, 0], fixed: true }],
    poses: [
      { root: 'ft2', at: [98, 145], torso: -80, th: 95, sn: 95, th2: 90, sn2: 90, fo2: 0, ua: 30, fa: -20 },
      { root: 'ft2', at: [98, 145], torso: -80, th: 100, sn: 205, th2: 90, sn2: 90, fo2: 0, ua: 30, fa: -20 },
    ],
  },
  'Bulgarian Split Squats': {
    props: [['r', 56, 113, 44, 7], ['l', 62, 120, 62, 148, 4], ['l', 94, 120, 94, 148, 4]],
    poses: [
      { root: 'ft', at: [128, 145], fo: 0, sn: 95, th: 85, th2: 120, sn2: 175, fo2: 170, ua: 90, fa: 90, ua2: 90, fa2: 90 },
      { root: 'ft', at: [128, 145], fo: 0, sn: 100, th: 15, th2: 110, sn2: 246, fo2: 200, torso: -80, ua: 90, fa: 90, ua2: 90, fa2: 90 },
    ],
  },
  'Ausfallschritte rückwärts': {
    poses: [
      { root: 'hip', at: [95, 80], th: 90, sn: 90, fo: 0, th2: 92, sn2: 90, fo2: 0, ua2: 90, fa2: 90 },
      { root: 'hip', at: [95, 110], th: 5, sn: 105, fo: 0, th2: 120, sn2: 173, fo2: 100, ua2: 90, fa2: 90 },
    ],
  },
  'Ausfallschritte Langhantel': BARBELL_LUNGE,
  'Ausfallschritte Multipresse': withRail(BARBELL_LUNGE, 94),
  'Stepper': {
    set: { vb: [0, 0, 200, 160] },
    props: [['l', 66, 146, 136, 146, 6], ['l', 136, 56, 136, 146, 4], ['l', 112, 58, 140, 58, 4]],
    poses: [
      { root: 'hip', at: [98, 82], torso: -86, th: 72, sn: 110, fo: 0, th2: 100, sn2: 84, fo2: 0, ua: 40, fa: -5 },
      { root: 'hip', at: [98, 82], torso: -86, th: 100, sn: 84, fo: 0, th2: 72, sn2: 110, fo2: 0, ua: 40, fa: -5 },
    ],
  },
  'Wadenheben einbeinig': { pose: { th2: 95, sn2: 150, fo2: 60 } },
  'Wadenheben Hackenschmidt': { gear: [{ at: 'sh', type: 'pad', off: [2, -5], r: 5, fixed: true }], pose: { ua: 60, fa: -50 } },
  'Wadenheben an der Beinpresse': {
    pattern: 'legpress', gear: [{ at: 'toe', type: 'line', ang: 45, len: 30, fixed: true }],
    poses: [
      { root: 'hip', at: [74, 116], torso: 225, th: -40, sn: -42, fo: 212, ua: 60, fa: 20 },
      { root: 'hip', at: [74, 116], torso: 225, th: -40, sn: -42, fo: 250, ua: 60, fa: 20 },
    ],
  },
  'Hip Thrust Multipresse': { addProps: [RAIL(96)] },
  // ----- Rücken unten -----
  'Hyperextensions mit Gewicht': { gear: [{ at: 'sh', type: 'plate', r: 7, off: [0, 3], fixed: true }] },
  'Reverse Hyperextensions': {
    props: [['r', 64, 88, 62, 7], ['l', 96, 95, 96, 148, 4]],
    poses: [
      { root: 'hip', at: [74, 85], torso: 0, th: 95, sn: 95, ua: 90, fa: 90 },
      { root: 'hip', at: [74, 85], torso: 0, th: 176, sn: 178, ua: 90, fa: 90 },
    ],
  },
  'Good Mornings': {
    gear: [{ at: 'sh', type: 'plate', off: [-4, -3], r: 11, fixed: true }], pose: { ua: 150, fa: -30 },
  },
  'Kreuzheben gestreckte Beine': { each: [{}, { th: 88, sn: 90, torso: 0 }] },
  // ----- Bauch -----
  'Crunches Schrägbank': { ...DECLINE_SIT, each: [{ torso: 162, ua: -18, fa: 162 }, { torso: 196, ua: 12, fa: 192 }] },
  'Sit-ups Schrägbank': { ...DECLINE_SIT, each: [{ torso: 162, ua: -18, fa: 162 }, { torso: 248, ua: 52, fa: 232 }] },
  'Knieheben Dipstation': {
    set: { noGround: false, vb: [0, 0, 200, 160] },
    props: [['l', 90, 36, 90, 118, 6], ['r', 90, 62, 42, 6]],
    poses: [
      { root: 'el', at: [100, 60], torso: -90, ua: 90, fa: 0, th: 92, sn: 90 },
      { root: 'el', at: [100, 60], torso: -90, ua: 90, fa: 0, th: -15, sn: 80 },
    ],
  },
  // ----- Rücken: Klimmzüge und Latziehen (breit/eng von vorn) -----
  'Klimmzüge breit': {
    set: { front: true }, poses: [
      { root: 'ha', at: [62, 30], ua: -121, fa: -121, th: 92, sn: 95 },
      { root: 'ha', at: [62, 30], ua: 165, fa: -72, th: 92, sn: 95 },
    ],
  },
  'Klimmzüge enger Griff': {
    set: { front: true }, poses: [
      { root: 'ha', at: [88, 30], ua: -97, fa: -97, th: 92, sn: 95 },
      { root: 'ha', at: [88, 30], ua: 118, fa: -82, th: 92, sn: 95 },
    ],
  },
  'Klimmzüge Untergriff (Chin-ups)': { each: [{}, { ua: 75, fa: -95 }] },
  'Klimmzüge mit Zusatzgewicht': { gear: [{ at: 'hip', type: 'plate', off: [0, 15], r: 8, fixed: true }] },
  'Latziehen breit': {
    set: { front: true, noFeet: true },
    props: [['r', 66, 102, 68, 8], ['l', 100, 110, 100, 148, 4]],
    gear: [{ at: 'hm', type: 'cable', from: [100, 0], fixed: true }, { at: 'ha', type: 'span', to: 'ha2', fixed: true }],
    poses: [
      { root: 'hip', at: [100, 100], th: 95, thl: .4, sn: 90, ua: -121, fa: -121 },
      { root: 'hip', at: [100, 100], th: 95, thl: .4, sn: 90, ua: 165, fa: -72 },
    ],
  },
  'Latziehen eng (V-Griff)': { pose: { torso: -110 }, each: [{}, { ua: 100, fa: -50 }] },
  'Latziehen Untergriff': { each: [{}, { ua: 80, fa: -82 }] },
  'Latziehen einarmig': { pose: { ua2: 75, fa2: -5 } },
  'Latziehen Maschine einarmig': { pose: { ua2: 75, fa2: -5 } },
  'High Row Maschine': { pose: { torso: -95 }, each: [{ ua: -38, fa: -38 }, { ua: 140, fa: -30 }] },
  // ----- Beine: Kniebeugen-Varianten, Beinpresse, Kreuzheben -----
  'Kniebeugen Box': { addProps: [['r', 56, 114, 30, 34, 3]] },
  'Hackenschmidt-Kniebeugen (Hack Squat)': HACK,
  'Pendulum Squat': HACK,
  'Hackenschmidt rückwärts (Reverse Hack)': {
    gear: [{ at: 'sh', type: 'pad', off: [5, -5], r: 5, fixed: true }],
    each: [{ torso: -72, ua: 20, fa: -30 }, { torso: -46, ua: 40, fa: -10 }],
  },
  'Belt Squat': {
    props: [['r', 72, 140, 56, 8]], gear: [{ at: 'hip', type: 'plate', off: [0, 18], r: 9, fixed: true }],
    each: [{ at: [100, 140], torso: -84, ua: 40, fa: 5 }, { at: [100, 140], torso: -74, ua: 30, fa: -5 }],
  },
  'Kniebeugen Multipresse': { addProps: [RAIL(92)] },
  'Kniebeugen Safety Bar': { pose: { ua: 35, fa: -45 } },
  'Beinpresse horizontal': {
    props: [['r', 50, 112, 34, 6], ['l', 56, 114, 44, 68, 6], ['l', 66, 118, 66, 148, 4], ['l', 90, 132, 180, 132, 3]],
    gear: [{ at: 'ft', type: 'line', ang: 90, len: 30, fixed: true }],
    poses: [
      { root: 'hip', at: [68, 110], torso: -108, th: -28, sn: 62, fo: 90, ua: 70, fa: 15 },
      { root: 'hip', at: [68, 110], torso: -108, th: 4, sn: 6, fo: 90, ua: 70, fa: 15 },
    ],
  },
  'Beinpresse vertikal': {
    vb: [0, -10, 200, 170],
    props: [['r', 40, 130, 76, 7], ['l', 60, 137, 60, 148, 4], ['l', 100, 137, 100, 148, 4]],
    gear: [{ at: 'ft', type: 'line', ang: 0, len: 30, fixed: true }],
    poses: [
      { root: 'hip', at: [108, 126], torso: 180, th: -128, sn: -40, fo: 0, ua: 150, fa: 170 },
      { root: 'hip', at: [108, 126], torso: 180, th: -92, sn: -90, fo: 0, ua: 150, fa: 170 },
    ],
  },
  'Beinpresse einbeinig': { pose: { th2: -95, sn2: 10 } },
  'Kreuzheben Sumo': {
    set: { front: true },
    gear: [{ at: 'ha', type: 'span', to: 'ha2', fixed: true }, { at: 'ha', type: 'plate', off: [-9, 0], r: 11, fixed: true },
      { at: 'ha2', type: 'plate', off: [9, 0], r: 11, fixed: true }],
    poses: [
      { root: 'ft', at: [64, 145], th: 150, sn: 98, tl: .5, ua: 96, fa: 92 },
      { root: 'ft', at: [64, 145], th: 112, sn: 100, ua: 94, fa: 90 },
    ],
  },
  'Kreuzheben Defizit': { addProps: [['r', 76, 140, 48, 8]], pose: { at: [96, 140] }, each: [{ th: 30, sn: 104, torso: -16 }, {}] },
  'Rack Pulls': {
    addProps: [['l', 140, 50, 140, 148, 4], ['l', 112, 104, 146, 104, 4]],
    each: [{ sn: 96, th: 72, torso: -48, ua: 100, fa: 100 }, {}],
  },
  'Rudern Kabelzug stehend': {
    props: [['l', 194, 30, 194, 148, 4]], gear: [{ at: 'ha', type: 'cable', from: [192, 70] }],
    poses: [
      { ...STAND, at: [84, 145], sn: 96, th: 84, torso: -84, ua: -2, fa: -2 },
      { ...STAND, at: [84, 145], sn: 96, th: 84, torso: -92, ua: 165, fa: 2 },
    ],
  },
};

/* ---------- Nachschlagen ---------- */
// Eintrag: [Muster, Hinweis, Gerät, Abwandlung]. Abwandlung (LIB_MOD) passt das Muster an die Übung an.
const LIB_INDEX = new Map(Object.entries(LIB_EX).map(([name, [pattern, note, gear, mod]]) =>
  [name.trim().toLowerCase(), { name, pattern, note: note || '', gear: gear || null, mod: mod || LIB_MOD[name] || null }]));

// Muster einer Übung mit ihrer Abwandlung: poses ersetzt die Posen, pose wird in jede Pose übernommen,
// each[i] nur in Pose i; props ersetzt, addProps ergänzt die festen Teile; gear ersetzt die Geräte;
// set überschreibt weitere Angaben des Musters (z. B. front, vb, thumb); pattern nimmt ein anderes Grundmuster.
function libPattern(e) {
  const m = e.mod, base = FIG_PATTERNS[(m && m.pattern) || e.pattern];
  if (!base || !m) return base;
  const poses = (m.poses || base.poses).map((p, i) => ({ ...p, ...(m.pose || {}), ...((m.each || [])[i] || {}) }));
  return {
    ...base, ...(m.set || {}), poses, gear: m.gear || base.gear,
    props: m.props ? m.props : [...(base.props || []), ...(m.addProps || [])],
  };
}

const libEntry = name => LIB_INDEX.get(String(name).trim().toLowerCase()) || null;

// Gerät aus dem Namen ableiten (für die Figur)
function libGear(name) {
  const n = String(name).toLowerCase();
  if (/kettlebell/.test(n)) return 'kb';
  if (/kurzhantel|goblet|farmer/.test(n)) return 'db';
  if (/kabel|seil|crossover|face pull/.test(n)) return 'cable';
  if (/langhantel|sz-stange|multipresse|safety bar|t-bar|trap bar|landmine|meadows|hantelscheibe|military|pendlay/.test(n)) return 'plate';
  if (/maschine/.test(n)) return 'bar';
  return null;
}

// Kleiner runder i-Knopf, der die Erklärung öffnet (leer, wenn es keine gibt)
const libInfoBtn = name => libEntry(name)
  ? `<button class="info-btn" data-action="lib-open" data-name="${esc(name)}" aria-label="Ausführung ansehen">i</button>` : '';

// Animierte (bzw. stehende) Figur zu einer Übung; leer, wenn die Übung nicht in der Bibliothek steht
function libFigure(name, animate = true) {
  const e = libEntry(name);
  if (!e) return '';
  const reduce = animate && window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return figSvg(libPattern(e), e.gear || libGear(e.name), animate && !reduce, e.name);
}
