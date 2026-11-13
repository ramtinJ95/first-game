import { C } from './human.ts';
import {
  add,
  arcPoints,
  capsule,
  circle,
  ellipse,
  polygon,
  polyline,
  smoothClosed,
  smoothOpen,
  type PaintOp,
  type Vec,
} from './paint.ts';

const OUTLINE = 2.4;
const THIN = 1.5;

/**
 * A transport ship in profile facing +x, its keel on the water line at y = 0. `t` from 0
 * to 1 sweeps the oars once; `sail` from 0 (furled) to 1 (full).
 */
export function shipArt(t: number, sail: number): PaintOp[] {
  const ops: PaintOp[] = [];
  const a = 2 * Math.PI * t;
  const deck = -22;
  const oarBank: Vec[] = [];
  for (let i = 0; i < 9; i++) oarBank.push({ x: -58 + i * 13, y: deck + 8 });
  const sweep = Math.sin(a);
  const dip = Math.cos(a);
  // Far oars first, behind the hull.
  for (const port of oarBank) {
    const blade = add(port, { x: -8 * sweep + 4, y: 26 + 4 * Math.max(0, dip) });
    ops.push({ d: capsule(port, blade, 1.1, 1), fill: C.woodShade, stroke: 1.1 });
  }
  const mastFoot = { x: 6, y: deck };
  const mastTop = { x: 6, y: deck - 112 };
  ops.push({ d: capsule(mastFoot, mastTop, 2.6, 2), fill: C.wood, stroke: THIN });
  const yardY = deck - 104 + (1 - sail) * 4;
  const span = 44 + sail * 14;
  ops.push({
    d: capsule({ x: 6 - span, y: yardY + 4 }, { x: 6 + span, y: yardY - 2 }, 1.6, 1.6),
    fill: C.wood,
    stroke: THIN,
  });
  ops.push({ d: polyline([mastTop, { x: 112, y: deck + 2 }]), stroke: 0.8 });
  ops.push({ d: polyline([mastTop, { x: -92, y: deck - 4 }]), stroke: 0.8 });
  if (sail > 0.1) {
    const belly = 10 * sail;
    const top = [
      { x: 6 - span + 2, y: yardY + 4 },
      { x: 6 + span - 2, y: yardY - 2 },
    ];
    const foot = deck - 104 + 80 * sail;
    const cloth = [
      top[0] as Vec,
      top[1] as Vec,
      { x: 6 + span - 6 + belly, y: (yardY + foot) / 2 },
      { x: 6 + span - 10, y: foot },
      { x: 6, y: foot + 4 },
      { x: 6 - span + 10, y: foot + 2 },
      { x: 6 - span + 4 + belly * 0.6, y: (yardY + foot) / 2 },
    ];
    ops.push({ d: smoothClosed(cloth), fill: C.linen, stroke: OUTLINE });
    for (const k of [-0.36, 0.08]) {
      const x0 = 6 + k * span * 2;
      const stripe = [
        { x: x0, y: yardY + 2 },
        { x: x0 + span * 0.34, y: yardY },
        { x: x0 + span * 0.34 + belly * 0.4, y: foot + 2 },
        { x: x0 + belly * 0.3, y: foot + 3 },
      ];
      ops.push({ d: polygon(stripe), fill: { faction: 'base' }, stroke: 1.2 });
    }
    ops.push({
      d: smoothClosed([
        cloth[0] as Vec,
        { x: 6 - span + 14, y: yardY + 6 },
        { x: 6 - span + 16 + belly, y: (yardY + foot) / 2 },
        cloth[5] as Vec,
        cloth[6] as Vec,
      ]),
      fill: C.linenShade,
    });
    for (let i = 1; i < 4; i++) {
      const x = 6 - span + (span * 2 * i) / 4;
      ops.push({
        d: smoothOpen([
          { x, y: yardY + 2 },
          { x: x + belly * 0.5, y: (yardY + foot) / 2 },
          { x: x - 1, y: foot + 2 },
        ]),
        stroke: 0.7,
        strokeColour: C.linenShade,
      });
    }
  } else {
    ops.push({
      d: capsule({ x: 6 - span, y: yardY + 7 }, { x: 6 + span, y: yardY + 1 }, 3.2, 3.2),
      fill: C.linen,
      stroke: THIN,
    });
  }

  const hull = [
    { x: -96, y: deck - 26 },
    { x: -90, y: deck - 8 },
    { x: -72, y: deck + 2 },
    { x: 60, y: deck + 2 },
    { x: 96, y: deck - 12 },
    { x: 104, y: deck - 16 },
    { x: 100, y: deck - 6 },
    { x: 84, y: 2 },
    { x: 40, y: 7 },
    { x: -40, y: 7 },
    { x: -80, y: 0 },
    { x: -98, y: deck - 14 },
  ];
  ops.push({ d: smoothClosed(hull), fill: C.wood, stroke: OUTLINE });
  ops.push({
    d: smoothClosed([
      { x: -80, y: 0 },
      { x: -40, y: 7 },
      { x: 40, y: 7 },
      { x: 84, y: 2 },
      { x: 70, y: -6 },
      { x: 0, y: -4 },
      { x: -70, y: -8 },
    ]),
    fill: C.woodShade,
  });
  ops.push({
    d: smoothOpen([
      { x: -86, y: deck - 2 },
      { x: 0, y: deck + 4 },
      { x: 92, y: deck - 8 },
    ]),
    stroke: 1.6,
    strokeColour: '#d9b98a',
  });
  for (const y of [-8, -14])
    ops.push({
      d: smoothOpen([
        { x: -84, y: y + 2 },
        { x: 0, y },
        { x: 86, y: y - 4 },
      ]),
      stroke: 0.9,
    });
  // A painted eye at the bow, a band of the owner's colour, and the stern post's curl.
  ops.push({
    d: smoothClosed([
      { x: -76, y: deck + 1 },
      { x: 70, y: deck + 1 },
      { x: 72, y: deck + 6 },
      { x: -76, y: deck + 6 },
    ]),
    fill: { faction: 'base' },
    stroke: 1.1,
  });
  ops.push({ d: ellipse({ x: 86, y: deck + 4 }, 4, 2.6, 0, 12), fill: C.linen, stroke: 1.1 });
  ops.push({ d: circle({ x: 87, y: deck + 4 }, 1.2), fill: C.dark });
  const curl = arcPoints({ x: -88, y: deck - 32 }, 8, 8, 0, Math.PI * 0.6, Math.PI * 2.1, 10);
  ops.push({ d: smoothOpen([{ x: -96, y: deck - 22 }, ...curl]), stroke: 4.6 });
  ops.push({
    d: smoothOpen([{ x: -96, y: deck - 22 }, ...curl]),
    stroke: 2.4,
    strokeColour: C.wood,
  });
  // The steering oar at the stern quarter.
  ops.push({
    d: capsule({ x: -78, y: deck - 8 }, { x: -96, y: 14 }, 1.8, 1.6),
    fill: C.wood,
    stroke: THIN,
  });
  ops.push({ d: ellipse({ x: -96, y: 12 }, 3, 7, 20, 12), fill: C.wood, stroke: THIN });
  // Near oars, over the hull.
  for (const port of oarBank) {
    const grip = add(port, { x: 8 * sweep - 3, y: -6 });
    const blade = add(port, { x: -10 * sweep + 6, y: 30 + 5 * Math.max(0, dip) });
    ops.push({ d: capsule(grip, blade, 1.4, 1.2), fill: C.wood, stroke: 1.2 });
    ops.push({ d: ellipse(blade, 1.8, 4.2, 10 - 20 * sweep, 10), fill: C.wood, stroke: 1 });
    ops.push({ d: circle(port, 1.6), fill: C.dark });
  }
  return ops;
}

/** A ridge tent of linen seen from three quarters, a pennant of the owner's colour on its pole. */
export function tentArt(large: boolean): PaintOp[] {
  const k = large ? 1.45 : 1;
  const p = (x: number, y: number): Vec => ({ x: x * k, y: y * k });
  const ops: PaintOp[] = [];
  const front = [p(-34, 0), p(-14, -44), p(6, 0)];
  const side = [p(-14, -44), p(30, -38), p(46, 0), p(6, 0)];
  ops.push({ d: polygon(side), fill: C.linen, stroke: OUTLINE });
  ops.push({ d: polygon([p(-14, -44), p(30, -38), p(38, -18), p(-4, -22)]), fill: '#f6eedb' });
  ops.push({ d: polygon(front), fill: C.linenShade, stroke: OUTLINE });
  ops.push({ d: polygon([p(-14, -30), p(-20, 0), p(-8, 0)]), fill: C.dark, stroke: 1.2 });
  for (const x of [14, 24, 34])
    ops.push({ d: polyline([p(x - 8, -40), p(x + 4, 0)]), stroke: 0.9 });
  ops.push({ d: polyline([p(-34, 0), p(-46, 4)]), stroke: 1 });
  ops.push({ d: polyline([p(46, 0), p(58, 4)]), stroke: 1 });
  const pole = p(-14, -44);
  const top = add(pole, { x: 0, y: -16 * k });
  ops.push({ d: capsule(pole, top, 1.2, 1), fill: C.wood, stroke: 1.2 });
  ops.push({
    d: polygon([top, add(top, { x: 16 * k, y: 3 * k }), add(top, { x: 4 * k, y: 6 * k })]),
    fill: { faction: 'base' },
    stroke: 1.4,
  });
  if (large) {
    ops.push({
      d: polygon([p(-8, -36), p(24, -32), p(26, -26), p(-6, -30)]),
      fill: { faction: 'base' },
      stroke: 1,
    });
  }
  return ops;
}

/** A camp fire on its logs. `t` from 0 to 1 plays the flicker once. */
export function fireArt(t: number, size = 1): PaintOp[] {
  const ops: PaintOp[] = [];
  const a = 2 * Math.PI * t;
  const k = size;
  ops.push({ d: ellipse({ x: 0, y: 1 }, 20 * k, 5 * k, 0, 16), fill: '#6f5a3c', opacity: 0.5 });
  ops.push({
    d: capsule({ x: -16 * k, y: 2 * k }, { x: 12 * k, y: -3 * k }, 3 * k, 2.6 * k),
    fill: C.woodShade,
    stroke: 1.6,
  });
  ops.push({
    d: capsule({ x: 14 * k, y: 2 * k }, { x: -10 * k, y: -4 * k }, 3 * k, 2.6 * k),
    fill: C.wood,
    stroke: 1.6,
  });
  const tongue = (x: number, h: number, w: number, phase: number, fill: string) => {
    const sway = Math.sin(a + phase) * 4 * k;
    const tall = h * k * (0.82 + 0.18 * Math.sin(a * 2 + phase));
    ops.push({
      d: smoothClosed([
        { x: (x - w) * k, y: -2 * k },
        { x: (x - w * 0.6) * k + sway * 0.4, y: -tall * 0.5 },
        { x: x * k + sway, y: -tall },
        { x: (x + w * 0.6) * k + sway * 0.4, y: -tall * 0.45 },
        { x: (x + w) * k, y: -2 * k },
      ]),
      fill,
      stroke: fill === '#e0752b' ? 1.6 : undefined,
    });
  };
  tongue(-4, 30, 9, 0, '#e0752b');
  tongue(5, 24, 7, 2, '#e0752b');
  tongue(-2, 20, 6, 4, '#f2b33d');
  tongue(4, 14, 4, 1, '#f8e39a');
  return ops;
}

/** A soft puff of smoke or dust: overlapping rounds, lighter towards the top. */
export function puffArt(colour: string, light: string): PaintOp[] {
  return [
    { d: circle({ x: -8, y: 4 }, 14), fill: colour, opacity: 0.55 },
    { d: circle({ x: 9, y: 2 }, 13), fill: colour, opacity: 0.55 },
    { d: circle({ x: 0, y: -6 }, 15), fill: light, opacity: 0.6 },
    { d: circle({ x: -4, y: -10 }, 8), fill: '#ffffff', opacity: 0.25 },
  ];
}

/** An arrow in flight, pointing +x. */
export function arrowArt(): PaintOp[] {
  return [
    {
      d: polyline([
        { x: -22, y: 0 },
        { x: 14, y: 0 },
      ]),
      stroke: 1.8,
    },
    {
      d: polygon([
        { x: 21, y: 0 },
        { x: 13, y: -3 },
        { x: 13, y: 3 },
      ]),
      fill: C.iron,
      stroke: 1,
    },
    {
      d: polygon([
        { x: -22, y: 0 },
        { x: -14, y: -4 },
        { x: -12, y: 0 },
      ]),
      fill: C.linen,
      stroke: 0.9,
    },
    {
      d: polygon([
        { x: -22, y: 0 },
        { x: -14, y: 4 },
        { x: -12, y: 0 },
      ]),
      fill: C.linenShade,
      stroke: 0.9,
    },
  ];
}

/** A javelin in flight, pointing +x. */
export function javelinArt(): PaintOp[] {
  return [
    { d: capsule({ x: -40, y: 0 }, { x: 26, y: 0 }, 1.4, 1.2), fill: C.wood, stroke: 1.3 },
    {
      d: polygon([
        { x: 38, y: 0 },
        { x: 26, y: -3 },
        { x: 24, y: 0 },
        { x: 26, y: 3 },
      ]),
      fill: C.ironLight,
      stroke: 1,
    },
  ];
}

/** A scaling ladder, leaning right: its foot at the origin and its top `length` up the wall. */
export function ladderArt(length = 70): PaintOp[] {
  const lean = 0.28;
  const top = { x: length * lean, y: -length };
  const ops: PaintOp[] = [];
  for (const dx of [-5, 5]) {
    ops.push({
      d: capsule({ x: dx, y: 0 }, add(top, { x: dx, y: 0 }), 1.6, 1.4),
      fill: C.wood,
      stroke: 1.4,
    });
  }
  for (let i = 1; i < 9; i++) {
    const t = i / 9;
    const at = { x: top.x * t, y: top.y * t };
    ops.push({
      d: polyline([add(at, { x: -5, y: 0 }), add(at, { x: 5, y: 0 })]),
      stroke: 1.8,
      strokeColour: C.woodShade,
    });
  }
  return ops;
}

/** Three sharpened stakes of a siege line, with the bank of earth thrown up behind them. */
export function stakesArt(): PaintOp[] {
  const ops: PaintOp[] = [
    {
      d: smoothClosed([
        { x: -22, y: 2 },
        { x: -12, y: -6 },
        { x: 12, y: -7 },
        { x: 22, y: 2 },
      ]),
      fill: '#b79c70',
      stroke: 1.6,
    },
  ];
  for (const [x, lean] of [
    [-12, -8],
    [0, 4],
    [12, -4],
  ] as const) {
    const top = { x: x + lean * 0.5, y: -26 };
    ops.push({
      d: polygon([
        { x: x - 2.6, y: -2 },
        { x: x + 2.6, y: -2 },
        add(top, { x: 1.4, y: 2 }),
        top,
        add(top, { x: -1.6, y: 2.4 }),
      ]),
      fill: C.wood,
      stroke: 1.4,
    });
  }
  return ops;
}

/** An ox cart with a load of bundles and jars, facing +x. `t` turns the wheel and walks the ox. */
export function cartArt(t: number): PaintOp[] {
  const ops: PaintOp[] = [];
  const a = 2 * Math.PI * t;
  const leg = (x: number, phase: number, far: boolean) => {
    const swing = 14 * Math.sin(a + phase);
    const hip = { x, y: -40 };
    const knee = add(hip, { x: Math.sin((swing * Math.PI) / 180) * 18, y: 18 });
    const foot = add(knee, {
      x: Math.sin(((swing - 6 * Math.max(0, Math.cos(a + phase))) * Math.PI) / 180) * 18,
      y: 20,
    });
    ops.push({ d: capsule(hip, knee, 5, 3.4), fill: far ? '#8a6a48' : '#a88660', stroke: OUTLINE });
    ops.push({
      d: capsule(knee, foot, 3.2, 2.8),
      fill: far ? '#8a6a48' : '#a88660',
      stroke: OUTLINE,
    });
  };
  // The ox.
  leg(60, 0, true);
  leg(26, Math.PI, true);
  ops.push({
    d: smoothClosed([
      { x: 18, y: -46 },
      { x: 22, y: -64 },
      { x: 50, y: -68 },
      { x: 70, y: -62 },
      { x: 74, y: -44 },
      { x: 64, y: -34 },
      { x: 24, y: -34 },
    ]),
    fill: '#b18f68',
    stroke: OUTLINE,
  });
  ops.push({
    d: smoothClosed([
      { x: 24, y: -36 },
      { x: 64, y: -36 },
      { x: 70, y: -44 },
      { x: 46, y: -42 },
      { x: 22, y: -44 },
    ]),
    fill: '#8a6a48',
  });
  ops.push({
    d: smoothClosed([
      { x: 70, y: -62 },
      { x: 84, y: -62 },
      { x: 92, y: -48 },
      { x: 88, y: -42 },
      { x: 80, y: -46 },
      { x: 70, y: -50 },
    ]),
    fill: '#b18f68',
    stroke: OUTLINE,
  });
  ops.push({
    d: smoothOpen([
      { x: 76, y: -62 },
      { x: 72, y: -72 },
      { x: 80, y: -76 },
    ]),
    stroke: 2.6,
    strokeColour: C.linen,
  });
  ops.push({ d: circle({ x: 82, y: -56 }, 1.2), fill: C.dark });
  ops.push({ d: capsule({ x: 66, y: -70 }, { x: 74, y: -66 }, 2, 2), fill: C.wood, stroke: 1.4 });
  leg(64, Math.PI, false);
  leg(30, 0, false);
  // The pole to the yoke, the cart, its load, and the wheel.
  ops.push({
    d: polyline([
      { x: -4, y: -30 },
      { x: 70, y: -66 },
    ]),
    stroke: 2.4,
    strokeColour: C.woodShade,
  });
  ops.push({
    d: polygon([
      { x: -52, y: -40 },
      { x: 0, y: -40 },
      { x: 2, y: -30 },
      { x: -50, y: -30 },
    ]),
    fill: C.wood,
    stroke: OUTLINE,
  });
  ops.push({
    d: smoothClosed([
      { x: -48, y: -40 },
      { x: -44, y: -58 },
      { x: -30, y: -62 },
      { x: -20, y: -54 },
      { x: -24, y: -40 },
    ]),
    fill: { faction: 'base' },
    stroke: OUTLINE,
  });
  ops.push({
    d: smoothClosed([
      { x: -26, y: -40 },
      { x: -22, y: -56 },
      { x: -12, y: -60 },
      { x: -4, y: -52 },
      { x: -6, y: -40 },
    ]),
    fill: C.linen,
    stroke: OUTLINE,
  });
  ops.push({
    d: smoothClosed([
      { x: -16, y: -58 },
      { x: -12, y: -72 },
      { x: -6, y: -72 },
      { x: -2, y: -60 },
    ]),
    fill: '#c0703e',
    stroke: 1.6,
  });
  const hub = { x: -26, y: -16 };
  ops.push({ d: circle(hub, 16), fill: C.woodShade, stroke: OUTLINE });
  ops.push({ d: circle(hub, 12), fill: '#d8c8a2', stroke: 1.2 });
  for (let i = 0; i < 4; i++) {
    const r = a / 2 + (i * Math.PI) / 4;
    ops.push({
      d: polyline([
        add(hub, { x: Math.cos(r) * 12, y: Math.sin(r) * 12 }),
        add(hub, { x: -Math.cos(r) * 12, y: -Math.sin(r) * 12 }),
      ]),
      stroke: 2.2,
      strokeColour: C.wood,
    });
  }
  ops.push({ d: circle(hub, 3.4), fill: C.wood, stroke: 1.2 });
  return ops;
}

export const SHIP_FRAMES = 8;
export const FIRE_FRAMES = 6;
export const CART_FRAMES = 8;
export const STANDARD_FRAMES = 6;

/** Flames leaping from a burning roof, with no logs under them. `t` from 0 to 1 plays the flicker once. */
export function flamesArt(t: number): PaintOp[] {
  const ops: PaintOp[] = [];
  const a = 2 * Math.PI * t;
  const tongue = (
    x: number,
    h: number,
    w: number,
    phase: number,
    fill: string,
    stroke?: number,
  ) => {
    const sway = Math.sin(a + phase) * 5;
    const tall = h * (0.8 + 0.2 * Math.sin(a * 2 + phase));
    ops.push({
      d: smoothClosed([
        { x: x - w, y: 0 },
        { x: x - w * 0.7 + sway * 0.3, y: -tall * 0.45 },
        { x: x - w * 0.15 + sway * 0.8, y: -tall * 0.8 },
        { x: x + sway, y: -tall },
        { x: x + w * 0.45 + sway * 0.5, y: -tall * 0.5 },
        { x: x + w, y: 0 },
      ]),
      fill,
      ...(stroke ? { stroke } : {}),
    });
  };
  tongue(-10, 34, 9, 0, '#c8541f', 1.6);
  tongue(8, 44, 11, 2.1, '#d9652a', 1.6);
  tongue(22, 28, 8, 4.2, '#c8541f', 1.6);
  tongue(-8, 24, 6, 1, '#f0a838');
  tongue(9, 32, 7, 3, '#f0a838');
  tongue(21, 18, 5, 5, '#f0a838');
  tongue(8, 18, 4, 0.5, '#fbe7a4');
  for (let i = 0; i < 5; i++) {
    const rise = (t + i / 5) % 1;
    ops.push({
      d: circle({ x: -12 + i * 8 + Math.sin(a + i) * 4, y: -40 - rise * 30 }, 1.4),
      fill: '#f6c35a',
      opacity: 1 - rise,
    });
  }
  return ops;
}

/** Spears stacked in a tripod with two shields of the owner's colour leant against them. */
export function armsArt(): PaintOp[] {
  const ops: PaintOp[] = [];
  const top = { x: 0, y: -46 };
  for (const [x, lean] of [
    [-14, -1],
    [12, 1],
    [-2, 0],
  ] as const) {
    ops.push({
      d: capsule({ x, y: 0 }, { x: top.x + lean * 3, y: top.y - 8 }, 1.3, 1.1),
      fill: C.wood,
      stroke: 1.2,
    });
    ops.push({
      d: polygon([
        { x: top.x + lean * 3, y: top.y - 18 },
        { x: top.x + lean * 3 - 2.4, y: top.y - 8 },
        { x: top.x + lean * 3 + 2.4, y: top.y - 8 },
      ]),
      fill: C.ironLight,
      stroke: 1,
    });
  }
  for (const x of [-9, 8]) {
    ops.push({
      d: ellipse({ x, y: -11 }, 8.5, 11, x < 0 ? -12 : 12, 20),
      fill: C.bronze,
      stroke: 1.8,
    });
    ops.push({
      d: ellipse({ x, y: -11 }, 6.4, 8.6, x < 0 ? -12 : 12, 20),
      fill: { faction: 'base' },
      stroke: 1,
    });
    ops.push({
      d: ellipse({ x: x + 1.5, y: -9 }, 3.2, 5, x < 0 ? -12 : 12, 12),
      fill: { faction: 'shade' },
    });
  }
  return ops;
}
