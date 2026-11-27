import { C } from './human.ts';
import {
  add,
  capsule,
  circle,
  ellipse,
  lerpVec,
  polygon,
  polyline,
  reach,
  smoothClosed,
  smoothOpen,
  type PaintOp,
  type Vec,
} from './paint.ts';

/** An elephant in profile facing +x, in the units of a man: 100 is a man's height. */
export interface ElephantPose {
  /** Forehand up (negative) or down, in degrees, about the middle of the back. */
  readonly pitch: number;
  /** Head raised (negative) or lowered, in degrees, about the top of the neck. */
  readonly head: number;
  /** How far the trunk curls up and forward, from 0 hanging to 1 raised. */
  readonly trunk: number;
  /** How far the ears stand out from the head, from 0 to 1. */
  readonly ears: number;
  readonly tail: number;
  /** Upper leg angle and the bend below it, near and far, fore and hind. */
  readonly foreNear: readonly [number, number];
  readonly foreFar: readonly [number, number];
  readonly hindNear: readonly [number, number];
  readonly hindFar: readonly [number, number];
}

const HIDE = { hide: '#9d958a', shade: '#787064', light: '#c4bdb0', crease: '#5c554b' };
const IVORY = '#f1e6c8';
const OUTLINE = 2.6;

const FORE_TOP: Vec = { x: 26, y: -84 };
const HIND_TOP: Vec = { x: -34, y: -86 };
const FORE = [36, 33] as const;
const HIND = [38, 32] as const;
const PIVOT: Vec = { x: -6, y: -110 };
const NECK: Vec = { x: 44, y: -126 };

function rotate(p: Vec, degrees: number, about: Vec): Vec {
  const r = (degrees * Math.PI) / 180;
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return {
    x: about.x + dx * Math.cos(r) - dy * Math.sin(r),
    y: about.y + dx * Math.sin(r) + dy * Math.cos(r),
  };
}

function legOf(
  top: Vec,
  [upper, bend]: readonly [number, number],
  lengths: readonly [number, number],
  fore: boolean,
) {
  const knee = reach(top, upper, lengths[0]);
  const foot = reach(knee, fore ? upper - bend : upper + bend, lengths[1]);
  return { top, knee, foot };
}

export interface ElephantFrame {
  /** The far legs, the body, its cloth, and the back of the tower. */
  readonly below: PaintOp[];
  /** The tower's front wall, which hides the crew below the waist. */
  readonly wall: PaintOp[];
  /** The head, the ear, and the near legs, in front of the driver's legs. */
  readonly above: PaintOp[];
  /** Where the fighting man in the tower stands, at his hip. */
  readonly tower: Vec;
  /** Where the driver sits on the neck. */
  readonly neck: Vec;
}

/**
 * An elephant with a tower on its back. The crew is painted by the caller between the
 * layers it returns: the fighting man after `below`, the driver after `wall`.
 */
export function elephantFigure(pose: ElephantPose): ElephantFrame {
  const body = (p: Vec) => rotate(p, -pose.pitch, PIVOT);
  const legs = {
    foreNear: legOf(body(FORE_TOP), pose.foreNear, FORE, true),
    foreFar: legOf(body(add(FORE_TOP, { x: -4, y: -2 })), pose.foreFar, FORE, true),
    hindNear: legOf(body(HIND_TOP), pose.hindNear, HIND, false),
    hindFar: legOf(body(add(HIND_TOP, { x: 4, y: -2 })), pose.hindFar, HIND, false),
  };
  const lowest = Math.max(
    ...Object.values(legs).map((leg) => Math.max(leg.foot.y + 9.5, leg.knee.y + 12.5)),
  );
  const at = (p: Vec) => add(p, { x: 0, y: -lowest });
  const on = (p: Vec) => at(body(p));
  const below: PaintOp[] = [];
  const wall: PaintOp[] = [];
  const above: PaintOp[] = [];

  const paintLeg = (
    ops: PaintOp[],
    leg: ReturnType<typeof legOf>,
    near: boolean,
    fore: boolean,
  ) => {
    const fill = near ? HIDE.hide : HIDE.shade;
    const top = at(leg.top);
    const knee = at(leg.knee);
    const foot = at(leg.foot);
    ops.push({ d: capsule(top, knee, fore ? 13 : 14, 10.5), fill, stroke: OUTLINE });
    ops.push({ d: capsule(knee, foot, 10.5, 9.5), fill, stroke: OUTLINE });
    const pad = add(foot, { x: 0, y: 3.5 });
    ops.push({ d: ellipse(pad, 10.5, 4.2, 0, 18), fill, stroke: OUTLINE });
    for (const dx of [-5, 0, 5]) {
      ops.push({ d: ellipse(add(pad, { x: dx + 2, y: 1 }), 2, 1.6, 0, 8), fill: IVORY, stroke: 1 });
    }
    ops.push({
      d: smoothOpen([
        add(knee, { x: -6, y: 1 }),
        add(knee, { x: 0, y: 3 }),
        add(knee, { x: 6, y: 1 }),
      ]),
      stroke: 1,
      strokeColour: HIDE.crease,
    });
  };

  paintLeg(below, legs.hindFar, false, false);
  paintLeg(below, legs.foreFar, false, true);

  const tailRoot = on({ x: -58, y: -116 });
  const tailEnd = reach(tailRoot, -6 - pose.tail, 34);
  below.push({ d: capsule(tailRoot, tailEnd, 2.6, 1.6), fill: HIDE.shade, stroke: 1.8 });
  below.push({
    d: smoothClosed([
      tailEnd,
      add(tailEnd, { x: -3, y: 2 }),
      add(tailEnd, { x: -1, y: 8 }),
      add(tailEnd, { x: 2, y: 3 }),
    ]),
    fill: C.dark,
    stroke: 1.2,
  });

  const barrel = [
    { x: 48, y: -112 },
    { x: 42, y: -86 },
    { x: 24, y: -74 },
    { x: -6, y: -70 },
    { x: -34, y: -74 },
    { x: -52, y: -88 },
    { x: -60, y: -110 },
    { x: -52, y: -130 },
    { x: -28, y: -140 },
    { x: 0, y: -142 },
    { x: 24, y: -146 },
    { x: 42, y: -138 },
  ].map(on);
  below.push({ d: smoothClosed(barrel), fill: HIDE.hide, stroke: OUTLINE });
  below.push({
    d: smoothClosed(
      [
        { x: 40, y: -88 },
        { x: 24, y: -75 },
        { x: -6, y: -71 },
        { x: -34, y: -75 },
        { x: -52, y: -89 },
        { x: -40, y: -84 },
        { x: -6, y: -80 },
        { x: 24, y: -84 },
      ].map(on),
    ),
    fill: HIDE.shade,
  });
  for (const [a, b, c] of [
    [
      { x: -50, y: -100 },
      { x: -44, y: -90 },
      { x: -40, y: -80 },
    ],
    [
      { x: 34, y: -100 },
      { x: 36, y: -90 },
      { x: 32, y: -80 },
    ],
  ] as const) {
    below.push({ d: smoothOpen([on(a), on(b), on(c)]), stroke: 1.2, strokeColour: HIDE.crease });
  }

  const cloth = [
    { x: 30, y: -146 },
    { x: 34, y: -116 },
    { x: 26, y: -102 },
    { x: 2, y: -100 },
    { x: -24, y: -101 },
    { x: -44, y: -106 },
    { x: -46, y: -134 },
    { x: -26, y: -142 },
    { x: 0, y: -144 },
  ].map(on);
  below.push({ d: smoothClosed(cloth), fill: { faction: 'base' }, stroke: OUTLINE });
  below.push({
    d: smoothClosed(
      [
        { x: -46, y: -134 },
        { x: -44, y: -106 },
        { x: -24, y: -101 },
        { x: -30, y: -128 },
      ].map(on),
    ),
    fill: { faction: 'shade' },
  });
  below.push({
    d: smoothOpen(
      [
        { x: 32, y: -110 },
        { x: 4, y: -104 },
        { x: -42, y: -110 },
      ].map(on),
    ),
    stroke: 2,
    strokeColour: C.bronzeLight,
  });
  const fringe: Vec[] = [];
  for (let i = 0; i <= 10; i++) {
    const p = lerpVec({ x: 28, y: -102 }, { x: -44, y: -106 }, i / 10);
    fringe.push(on(p), on(add(p, { x: -3.6, y: 5 })));
  }
  below.push({ d: polyline(fringe), stroke: 1.2, strokeColour: C.dark });

  const corner = (x: number, y: number) => on({ x, y });
  const floor = -144;
  const top = -170;
  below.push({
    d: polygon([corner(-32, floor), corner(-28, top - 2), corner(20, top - 2), corner(22, floor)]),
    fill: C.woodShade,
    stroke: OUTLINE,
  });
  const tower = on({ x: -6, y: -148 });
  wall.push({
    d: polygon([
      corner(-34, floor + 2),
      corner(-34, top),
      corner(-26, top),
      corner(-26, top - 6),
      corner(-18, top - 6),
      corner(-18, top),
      corner(10, top),
      corner(10, top - 6),
      corner(18, top - 6),
      corner(18, top),
      corner(24, top),
      corner(24, floor + 2),
    ]),
    fill: C.wood,
    stroke: OUTLINE,
  });
  for (const y of [top + 8, floor - 6]) {
    wall.push({
      d: polyline([corner(-34, y), corner(24, y)]),
      stroke: 1,
      strokeColour: C.woodShade,
    });
  }
  for (const x of [-20, 6]) {
    const c = corner(x, (top + floor) / 2 + 1);
    wall.push({ d: ellipse(c, 8, 9, 0, 18), fill: { faction: 'base' }, stroke: OUTLINE });
    wall.push({ d: ellipse(add(c, { x: -1.5, y: 1 }), 4.6, 6, 0, 12), fill: { faction: 'shade' } });
    wall.push({ d: circle(c, 2.2), fill: C.bronze, stroke: 1.2 });
  }

  const head = (p: Vec) => at(rotate(body(p), pose.head, body(NECK)));
  const neck = on({ x: 36, y: -142 });

  const skull = [
    { x: 34, y: -144 },
    { x: 50, y: -152 },
    { x: 66, y: -146 },
    { x: 76, y: -128 },
    { x: 78, y: -110 },
    { x: 70, y: -98 },
    { x: 56, y: -96 },
    { x: 44, y: -104 },
    { x: 38, y: -118 },
  ].map(head);
  const trunkRoot = { x: 72, y: -104 };
  const spine: Vec[] = [head(trunkRoot)];
  const start = 12 + 110 * pose.trunk;
  const curl = 5 + 26 * pose.trunk;
  const turn = pose.head;
  for (let i = 0; i < 6; i++) {
    const last = spine[spine.length - 1] as Vec;
    spine.push(reach(last, start + i * curl - turn, 12 - i * 0.8));
  }
  const left: Vec[] = [];
  const right: Vec[] = [];
  spine.forEach((p, i) => {
    const next = spine[Math.min(i + 1, spine.length - 1)] as Vec;
    const prev = spine[Math.max(i - 1, 0)] as Vec;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const length = Math.hypot(dx, dy) || 1;
    const r = 8 - i * 0.9;
    left.push(add(p, { x: (-dy / length) * r, y: (dx / length) * r }));
    right.push(add(p, { x: (dy / length) * r, y: (-dx / length) * r }));
  });
  const tip = spine[spine.length - 1] as Vec;

  const tusk = (near: boolean) => {
    const root = head({ x: near ? 66 : 62, y: -102 });
    const u = reach(root, 70 + 30 * pose.trunk * 0.3 - turn, 14);
    const point = reach(u, 120 - turn, 12);
    return {
      d: smoothClosed([
        add(root, { x: 0, y: -3 }),
        u,
        point,
        add(u, { x: -1, y: 4 }),
        add(root, { x: -1, y: 3 }),
      ]),
      fill: near ? IVORY : C.linenShade,
      stroke: 1.6,
    };
  };

  above.push(tusk(false));
  above.push({ d: smoothClosed([...left, ...right.reverse()]), fill: HIDE.hide, stroke: OUTLINE });
  for (let i = 1; i < spine.length - 1; i++) {
    const p = spine[i] as Vec;
    const q = left[i] as Vec;
    above.push({
      d: polyline([lerpVec(p, q, 0.2), lerpVec(p, q, 0.85)]),
      stroke: 0.9,
      strokeColour: HIDE.crease,
    });
  }
  above.push({ d: circle(tip, 2.2), fill: HIDE.shade, stroke: 1.2 });
  above.push({ d: smoothClosed(skull), fill: HIDE.hide, stroke: OUTLINE });
  above.push({
    d: smoothClosed(
      [
        { x: 46, y: -150 },
        { x: 62, y: -150 },
        { x: 70, y: -138 },
        { x: 60, y: -138 },
      ].map(head),
    ),
    fill: C.bronze,
    stroke: 1.4,
  });
  above.push({ d: circle(head({ x: 64, y: -126 }), 1.8), fill: C.dark });
  above.push({
    d: smoothOpen([head({ x: 58, y: -130 }), head({ x: 64, y: -132 }), head({ x: 70, y: -128 })]),
    stroke: 1,
    strokeColour: HIDE.crease,
  });
  above.push(tusk(true));

  const earRoot = head({ x: 46, y: -136 });
  const spread = -28 * pose.ears;
  const ear = [
    { x: 46, y: -140 },
    { x: 36, y: -146 },
    { x: 22, y: -138 },
    { x: 18, y: -118 },
    { x: 24, y: -102 },
    { x: 36, y: -96 },
    { x: 46, y: -106 },
  ].map((p) => rotate(head(p), spread, earRoot));
  above.push({ d: smoothClosed(ear), fill: HIDE.shade, stroke: OUTLINE });
  above.push({
    d: smoothOpen(
      [
        { x: 40, y: -138 },
        { x: 28, y: -128 },
        { x: 28, y: -110 },
      ].map((p) => rotate(head(p), spread, earRoot)),
    ),
    stroke: 1,
    strokeColour: HIDE.crease,
  });
  above.push({
    d: smoothOpen(
      [
        { x: 44, y: -142 },
        { x: 32, y: -144 },
        { x: 22, y: -136 },
      ].map((p) => rotate(head(p), spread, earRoot)),
    ),
    stroke: 1.4,
    strokeColour: HIDE.light,
  });

  paintLeg(above, legs.hindNear, true, false);
  paintLeg(above, legs.foreNear, true, true);
  return { below, wall, above, tower, neck };
}

export const ELEPHANT_STAND: ElephantPose = {
  pitch: 0,
  head: 0,
  trunk: 0,
  ears: 0.15,
  tail: 0,
  foreNear: [4, 2],
  foreFar: [-2, 2],
  hindNear: [-4, 6],
  hindFar: [2, 6],
};

/**
 * An elephant's walk, `t` from 0 to 1: each foot in turn, the hind leading the fore on
 * its side. `reach` and `pace` grow it into the shuffling run of a frightened beast.
 */
export function elephantWalk(t: number, reach = 1, pace = 0): ElephantPose {
  const swing = (phase: number) => Math.sin(2 * Math.PI * (t + phase));
  const lifted = (phase: number) => Math.max(0, Math.cos(2 * Math.PI * (t + phase)));
  const fore = (phase: number): [number, number] => [
    4 + 13 * reach * swing(phase),
    2 + 34 * reach * lifted(phase) ** 2,
  ];
  const hind = (phase: number): [number, number] => [
    -4 + 12 * reach * swing(phase),
    6 + 30 * reach * lifted(phase) ** 2,
  ];
  return {
    pitch: 1.2 * Math.sin(4 * Math.PI * t) - 2 * pace,
    head: 3 * Math.sin(4 * Math.PI * t + 1) - 6 * pace,
    trunk: 0.08 + 0.06 * Math.sin(2 * Math.PI * t) + 0.5 * pace,
    ears: 0.2 + 0.1 * Math.sin(4 * Math.PI * t) + 0.7 * pace,
    tail: 8 * Math.sin(2 * Math.PI * t) + 14 * pace,
    hindFar: hind(0),
    foreFar: fore(0.25),
    hindNear: hind(0.5),
    foreNear: fore(0.75),
  };
}
