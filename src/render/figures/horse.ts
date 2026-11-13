import { C } from './human.ts';
import {
  add,
  capsule,
  circle,
  lerpVec,
  polygon,
  polyline,
  reach,
  smoothClosed,
  smoothOpen,
  type PaintOp,
  type Vec,
} from './paint.ts';

/** A horse in profile facing +x, in the same units as a man: 100 is a man's height. */
export interface HorsePose {
  /** Nose up or down of the body, in degrees. */
  readonly pitch: number;
  /** Head and neck raised (negative) or stretched forward (positive), in degrees. */
  readonly neck: number;
  readonly tail: number;
  /** Upper leg angle and the bend below it, near and far, fore and hind. */
  readonly foreNear: readonly [number, number];
  readonly foreFar: readonly [number, number];
  readonly hindNear: readonly [number, number];
  readonly hindFar: readonly [number, number];
  readonly lift: number;
}

export type Coat = 'bay' | 'grey' | 'dun' | 'black';

const COATS: Record<Coat, { coat: string; shade: string; light: string; mane: string }> = {
  bay: { coat: '#9a5f36', shade: '#6d3f21', light: '#c4895a', mane: '#2e1d10' },
  grey: { coat: '#d8d2c2', shade: '#a59d8a', light: '#f4f0e4', mane: '#7d766a' },
  dun: { coat: '#c49a62', shade: '#93693c', light: '#e2c08c', mane: '#4a3220' },
  black: { coat: '#4c3a2c', shade: '#32251b', light: '#7a624c', mane: '#1e140c' },
};

export type Dress = 'saddleCloth' | 'barding' | 'none';

const OUTLINE = 2.4;

const FORE_TOP: Vec = { x: 22, y: -60 };
const HIND_TOP: Vec = { x: -25, y: -63 };
const FORE = [24, 24] as const;
const HIND = [26, 25] as const;
const PIVOT: Vec = { x: 0, y: -70 };

function rotate(p: Vec, degrees: number, about: Vec): Vec {
  const r = (degrees * Math.PI) / 180;
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return {
    x: about.x + dx * Math.cos(r) - dy * Math.sin(r),
    y: about.y + dx * Math.sin(r) + dy * Math.cos(r),
  };
}

interface Leg {
  top: Vec;
  joint: Vec;
  fetlock: Vec;
  hoof: Vec;
}

function horseLeg(
  top: Vec,
  [upper, bend]: readonly [number, number],
  lengths: readonly [number, number],
  fore: boolean,
): Leg {
  const joint = reach(top, upper, lengths[0]);
  const lowerAngle = fore ? upper - bend : upper + bend;
  const fetlock = reach(joint, lowerAngle, lengths[1]);
  const hoof = reach(fetlock, lowerAngle * 0.5 + 18, 5);
  return { top, joint, fetlock, hoof };
}

export interface HorseFrame {
  /** Where the rider sits, at the deepest point of the saddle. */
  readonly seat: Vec;
  readonly ops: PaintOp[];
}

/**
 * Paints the far legs and the body, then returns where the rider sits. The near legs
 * come after the body, so they cross in front of it.
 */
export function horseFigure(
  pose: HorsePose,
  coatName: Coat,
  dress: Dress,
  armoured: boolean,
): HorseFrame {
  const coat = COATS[coatName];
  const body = (p: Vec) => rotate(p, -pose.pitch, PIVOT);
  const tops = { fore: body(FORE_TOP), hind: body(HIND_TOP) };
  const legs = {
    foreNear: horseLeg(tops.fore, pose.foreNear, FORE, true),
    foreFar: horseLeg(add(tops.fore, { x: -3, y: -1 }), pose.foreFar, FORE, true),
    hindNear: horseLeg(tops.hind, pose.hindNear, HIND, false),
    hindFar: horseLeg(add(tops.hind, { x: 3, y: -1 }), pose.hindFar, HIND, false),
  };
  const lowest = Math.max(
    ...Object.values(legs).map((leg) => Math.max(leg.hoof.y + 2, leg.fetlock.y + 3)),
  );
  const drop = { x: 0, y: -lowest - pose.lift };
  const at = (p: Vec) => add(p, drop);
  const ops: PaintOp[] = [];

  const paintLeg = (leg: Leg, near: boolean, fore: boolean) => {
    const fill = near ? coat.coat : coat.shade;
    const top = at(leg.top);
    const joint = at(leg.joint);
    const fetlock = at(leg.fetlock);
    const hoof = at(leg.hoof);
    ops.push({ d: capsule(top, joint, fore ? 6.5 : 8, 3.6), fill, stroke: OUTLINE });
    ops.push({ d: capsule(joint, fetlock, 3.3, 2.7), fill, stroke: OUTLINE });
    ops.push({ d: capsule(fetlock, hoof, 2.9, 2.6), fill, stroke: OUTLINE });
    const along = { x: hoof.x - fetlock.x, y: hoof.y - fetlock.y };
    const length = Math.hypot(along.x, along.y) || 1;
    const u = { x: along.x / length, y: along.y / length };
    const side = { x: -u.y, y: u.x };
    const toe = add(hoof, { x: u.x * 2.4 + side.x * -3.2, y: u.y * 2.4 + side.y * -3.2 });
    const heel = add(hoof, { x: u.x * 2.6 + side.x * 2.4, y: u.y * 2.6 + side.y * 2.4 });
    ops.push({
      d: polygon([
        add(hoof, { x: side.x * -3, y: side.y * -3 }),
        toe,
        heel,
        add(hoof, { x: side.x * 2.6, y: side.y * 2.6 }),
      ]),
      fill: C.dark,
      stroke: 1.4,
    });
    if (armoured && near)
      ops.push({
        d: polyline([lerpVec(top, joint, 0.3), lerpVec(top, joint, 0.85)]),
        stroke: 1,
        strokeColour: coat.light,
      });
  };

  paintLeg(legs.hindFar, false, false);
  paintLeg(legs.foreFar, false, true);

  const tailRoot = at(body({ x: -38, y: -84 }));
  const tailEnd = at(reach(body({ x: -38, y: -84 }), -18 - pose.tail, 32));
  const tailMid = at(reach(body({ x: -38, y: -84 }), -38 - pose.tail * 0.6, 16));
  ops.push({
    d: smoothClosed([
      tailRoot,
      add(tailMid, { x: -4, y: -2 }),
      add(tailEnd, { x: -3, y: 2 }),
      add(tailEnd, { x: 2, y: 3 }),
      add(tailMid, { x: 4, y: 2 }),
      add(tailRoot, { x: 4, y: 4 }),
    ]),
    fill: coat.mane,
    stroke: OUTLINE,
  });

  const barrel = [
    { x: 36, y: -74 },
    { x: 30, y: -60 },
    { x: 14, y: -55 },
    { x: -8, y: -55 },
    { x: -24, y: -58 },
    { x: -36, y: -66 },
    { x: -42, y: -77 },
    { x: -34, y: -88 },
    { x: -16, y: -85 },
    { x: 2, y: -84 },
    { x: 16, y: -89 },
    { x: 30, y: -86 },
  ].map((p) => at(body(p)));
  ops.push({ d: smoothClosed(barrel), fill: coat.coat, stroke: OUTLINE });
  const belly = [
    { x: 30, y: -61 },
    { x: 14, y: -56 },
    { x: -8, y: -56 },
    { x: -24, y: -59 },
    { x: -36, y: -67 },
    { x: -40, y: -74 },
    { x: -26, y: -66 },
    { x: -6, y: -62 },
    { x: 14, y: -63 },
  ].map((p) => at(body(p)));
  ops.push({ d: smoothClosed(belly), fill: coat.shade });
  ops.push({
    d: smoothOpen(
      [
        { x: -30, y: -86 },
        { x: -12, y: -83 },
        { x: 4, y: -82 },
      ].map((p) => at(body(p))),
    ),
    stroke: 1.6,
    strokeColour: coat.light,
  });
  ops.push({
    d: smoothOpen(
      [
        { x: -27, y: -78 },
        { x: -33, y: -70 },
        { x: -30, y: -62 },
      ].map((p) => at(body(p))),
    ),
    stroke: 1,
  });

  // The neck and the head turn about the base of the neck.
  const neckBase = body({ x: 24, y: -80 });
  const head = (p: Vec) => at(rotate(body(p), pose.neck, neckBase));
  const neck = [
    { x: 14, y: -88 },
    { x: 28, y: -100 },
    { x: 40, y: -112 },
    { x: 47, y: -110 },
    { x: 46, y: -98 },
    { x: 40, y: -84 },
    { x: 36, y: -72 },
  ].map(head);
  ops.push({ d: smoothClosed(neck), fill: coat.coat, stroke: OUTLINE });
  ops.push({
    d: smoothClosed(
      [
        { x: 46, y: -99 },
        { x: 40, y: -86 },
        { x: 36, y: -73 },
        { x: 32, y: -82 },
        { x: 38, y: -94 },
      ].map(head),
    ),
    fill: coat.shade,
  });
  const skull = [
    { x: 41, y: -113 },
    { x: 49, y: -112 },
    { x: 58, y: -102 },
    { x: 65, y: -92 },
    { x: 65, y: -87 },
    { x: 61, y: -85 },
    { x: 56, y: -87 },
    { x: 50, y: -94 },
    { x: 44, y: -99 },
  ];
  ops.push({ d: smoothClosed(skull.map(head)), fill: coat.coat, stroke: OUTLINE });
  ops.push({
    d: polygon(
      [
        { x: 42, y: -112 },
        { x: 43, y: -120 },
        { x: 47, y: -112 },
      ].map(head),
    ),
    fill: coat.coat,
    stroke: 1.6,
  });
  ops.push({ d: circle(head({ x: 51, y: -105 }), 1.3), fill: C.dark });
  ops.push({ d: circle(head({ x: 62, y: -89 }), 0.9), fill: C.dark });
  for (const [a, b] of [
    [
      { x: 18, y: -92 },
      { x: 12, y: -84 },
    ],
    [
      { x: 26, y: -100 },
      { x: 20, y: -91 },
    ],
    [
      { x: 34, y: -108 },
      { x: 28, y: -98 },
    ],
    [
      { x: 41, y: -114 },
      { x: 36, y: -106 },
    ],
  ] as const) {
    ops.push({ d: capsule(head(a), head(b), 2.6, 1.6), fill: coat.mane, stroke: 1.3 });
  }
  ops.push({
    d: polyline(
      [
        { x: 47, y: -108 },
        { x: 54, y: -93 },
        { x: 60, y: -88 },
      ].map(head),
    ),
    stroke: 1.2,
    strokeColour: C.leatherShade,
  });
  if (armoured) {
    ops.push({
      d: smoothClosed(
        [
          { x: 46, y: -112 },
          { x: 52, y: -110 },
          { x: 62, y: -96 },
          { x: 60, y: -92 },
          { x: 52, y: -100 },
        ].map(head),
      ),
      fill: C.bronze,
      stroke: 1.4,
    });
  }

  const seat = at(body({ x: -2, y: -86 }));
  if (dress === 'saddleCloth') {
    const cloth = [
      { x: 12, y: -88 },
      { x: -18, y: -86 },
      { x: -20, y: -68 },
      { x: -12, y: -64 },
      { x: 4, y: -64 },
      { x: 12, y: -70 },
    ].map((p) => at(body(p)));
    ops.push({ d: smoothClosed(cloth), fill: { faction: 'base' }, stroke: OUTLINE });
    ops.push({
      d: smoothOpen(
        [
          { x: -18, y: -70 },
          { x: -4, y: -66 },
          { x: 10, y: -72 },
        ].map((p) => at(body(p))),
      ),
      stroke: 1.6,
      strokeColour: C.bronzeLight,
    });
    ops.push({
      d: smoothClosed(
        [
          { x: -18, y: -86 },
          { x: -20, y: -68 },
          { x: -12, y: -64 },
          { x: -12, y: -84 },
        ].map((p) => at(body(p))),
      ),
      fill: { faction: 'shade' },
    });
  } else if (dress === 'barding') {
    const hem = [];
    for (let i = 0; i <= 8; i++) {
      const x = 32 - i * 8.6;
      hem.push({ x, y: -60 + (i % 2) * 3.2 });
    }
    const cloth = [
      { x: 30, y: -90 },
      { x: 10, y: -90 },
      { x: -18, y: -88 },
      { x: -38, y: -84 },
      ...hem.reverse(),
      { x: 36, y: -72 },
    ].map((p) => at(body(p)));
    ops.push({ d: smoothClosed(cloth), fill: { faction: 'base' }, stroke: OUTLINE });
    ops.push({
      d: smoothClosed(
        [
          { x: -38, y: -84 },
          { x: -40, y: -60 },
          { x: -20, y: -60 },
          { x: -24, y: -76 },
        ].map((p) => at(body(p))),
      ),
      fill: { faction: 'shade' },
    });
    ops.push({
      d: smoothOpen(
        [
          { x: 28, y: -66 },
          { x: 0, y: -66 },
          { x: -34, y: -66 },
        ].map((p) => at(body(p))),
      ),
      stroke: 1.8,
      strokeColour: C.bronzeLight,
    });
    ops.push({
      d: smoothOpen(
        [
          { x: 24, y: -86 },
          { x: 0, y: -85 },
          { x: -24, y: -84 },
        ].map((p) => at(body(p))),
      ),
      stroke: 1.2,
      strokeColour: '#ffffff',
    });
  }

  paintLeg(legs.hindNear, true, false);
  paintLeg(legs.foreNear, true, true);
  return { seat, ops };
}

/** A horse in the walk, one of the four legs moving at a time, `t` from 0 to 1. */
export function walkPose(t: number): HorsePose {
  const swing = (phase: number) => Math.sin(2 * Math.PI * (t + phase));
  const lifted = (phase: number) => Math.max(0, Math.cos(2 * Math.PI * (t + phase)));
  const fore = (phase: number): [number, number] => [
    6 + 16 * swing(phase),
    4 + 48 * lifted(phase) ** 2,
  ];
  const hind = (phase: number): [number, number] => [
    -10 + 16 * swing(phase),
    22 + 34 * lifted(phase) ** 2,
  ];
  return {
    pitch: 0.8 * Math.sin(4 * Math.PI * t),
    neck: 3 * Math.sin(4 * Math.PI * t + 1),
    tail: 4 * Math.sin(2 * Math.PI * t),
    hindFar: hind(0),
    foreFar: fore(0.25),
    hindNear: hind(0.5),
    foreNear: fore(0.75),
    lift: 0,
  };
}

/** A horse in the gallop, `t` from 0 to 1: reach, land on the fore, gather, push. */
export function gallopPose(t: number): HorsePose {
  const a = 2 * Math.PI * t;
  const fore = (lag: number): [number, number] => {
    const s = Math.sin(a - lag);
    return [10 + 38 * s, 10 + 62 * Math.max(0, -Math.cos(a - lag)) ** 1.3];
  };
  const hind = (lag: number): [number, number] => {
    const s = Math.sin(a - lag);
    return [-12 - 34 * s, 22 + 40 * Math.max(0, Math.cos(a - lag)) ** 1.3];
  };
  return {
    pitch: 5 * Math.sin(a + 0.6),
    neck: 10 * Math.sin(a + 2) + 14,
    tail: 22 + 8 * Math.sin(a),
    foreNear: fore(0),
    foreFar: fore(0.5),
    hindNear: hind(2.6),
    hindFar: hind(3.1),
    lift: Math.max(0, 5 * Math.sin(a + 0.4)),
  };
}

export const HORSE_STAND: HorsePose = {
  pitch: 0,
  neck: -4,
  tail: 0,
  foreNear: [4, 2],
  foreFar: [-3, 2],
  hindNear: [-8, 22],
  hindFar: [-14, 24],
  lift: 0,
};
