import {
  add,
  arcPoints,
  capsule,
  circle,
  dir,
  ellipse,
  lerpVec,
  polygon,
  polyline,
  reach,
  scale,
  smoothClosed,
  smoothOpen,
  type PaintOp,
  type Vec,
} from './paint.ts';

/**
 * A figure on foot, in profile facing +x, in figure units: 100 is a man's height from
 * sole to crown. Angles are degrees from straight down, turning forward. The near side
 * is the figure's left, which faces the viewer and carries the shield or the bow.
 */
export interface FootPose {
  /** The torso's lean forward from upright. */
  readonly lean: number;
  readonly head: number;
  readonly hipNear: number;
  readonly kneeNear: number;
  readonly hipFar: number;
  readonly kneeFar: number;
  readonly shoulderNear: number;
  readonly elbowNear: number;
  readonly shoulderFar: number;
  readonly elbowFar: number;
  /** The angle of the weapon in the far hand. */
  readonly grip: number;
  /** Height of the soles above the ground, for a run's flight. */
  readonly lift: number;
  /** How far a bow is drawn, from 0 to 1, or whether a javelin is still in the hand. */
  readonly draw: number;
  /** How far the cloak streams back, from 0 to 1. */
  readonly flow: number;
}

export const C = {
  skin: '#d7a77c',
  skinShade: '#b07f58',
  linen: '#efe3c6',
  linenShade: '#cbb88f',
  bronze: '#c0913f',
  bronzeShade: '#8c6427',
  bronzeLight: '#ecd08a',
  iron: '#9a9b95',
  ironShade: '#686a66',
  ironLight: '#d5d6cf',
  leather: '#8b5a33',
  leatherShade: '#653e21',
  wood: '#a37a48',
  woodShade: '#755430',
  hair: '#4a3020',
  dark: '#2b1d10',
  wash: '#f3ead2',
  wicker: '#b8945a',
} as const;

const OUTLINE = 2.4;
const THIN = 1.5;

const THIGH = 24;
const SHIN = 23;
const UPPER_ARM = 16;
const FOREARM = 15;
const TORSO = 29;

export type Helmet = 'corinthian' | 'montefortino' | 'bare' | 'cap' | 'attic' | 'plumed';
export type Body = 'linothorax' | 'mail' | 'tunic' | 'tunicLong' | 'scale' | 'muscle';
export type Shield = 'aspis' | 'oval' | 'pelta' | 'round' | 'none';
export type Weapon =
  'spear' | 'sword' | 'javelin' | 'bow' | 'lance' | 'swordRaised' | 'standard' | 'none';

export interface Kit {
  readonly helmet: Helmet;
  readonly body: Body;
  readonly shield: Shield;
  readonly weapon: Weapon;
  readonly greaves: boolean;
  readonly quiver: boolean;
  readonly cloak: boolean;
  /** Spare javelins held behind the shield. */
  readonly spares: boolean;
}

export interface Skeleton {
  readonly hip: Vec;
  readonly up: Vec;
  readonly forward: Vec;
  readonly kneeNear: Vec;
  readonly ankleNear: Vec;
  readonly toeNear: Vec;
  readonly kneeFar: Vec;
  readonly ankleFar: Vec;
  readonly toeFar: Vec;
  readonly shoulder: Vec;
  readonly neck: Vec;
  readonly head: Vec;
  readonly elbowNear: Vec;
  readonly handNear: Vec;
  readonly elbowFar: Vec;
  readonly handFar: Vec;
}

function leg(hip: Vec, thigh: number, knee: number) {
  const k = reach(hip, thigh, THIGH);
  const shin = thigh - knee;
  const ankle = reach(k, shin, SHIN);
  const toe = reach(ankle, 90 + shin * 0.6, 8);
  return { knee: k, ankle, toe, shin };
}

/**
 * Joint positions for a pose. The hip height is found so that the lowest sole stands
 * on the ground, so a pose never floats or sinks unless it asks to lift.
 */
export function footSkeleton(pose: FootPose, seat?: Vec): Skeleton {
  const origin = { x: 0, y: 0 };
  const near = leg(origin, pose.hipNear, pose.kneeNear);
  const far = leg(origin, pose.hipFar, pose.kneeFar);
  const sole = Math.max(near.ankle.y + 3, near.toe.y + 1.2, far.ankle.y + 3, far.toe.y + 1.2);
  const hip = seat ?? { x: 0, y: -sole - pose.lift };
  const shift = (p: Vec) => add(p, hip);
  const up = dir(180 - pose.lean);
  const forward = { x: -up.y, y: up.x };
  const shoulder = add(hip, scale(up, TORSO - 3));
  const neck = add(hip, scale(up, TORSO));
  const head = reach(neck, 180 - pose.lean - pose.head, 9);
  const elbowNear = reach(shoulder, pose.shoulderNear, UPPER_ARM);
  const handNear = reach(elbowNear, pose.shoulderNear + pose.elbowNear, FOREARM);
  const elbowFar = reach(shoulder, pose.shoulderFar, UPPER_ARM);
  const handFar = reach(elbowFar, pose.shoulderFar + pose.elbowFar, FOREARM);
  return {
    hip,
    up,
    forward,
    kneeNear: shift(near.knee),
    ankleNear: shift(near.ankle),
    toeNear: shift(near.toe),
    kneeFar: shift(far.knee),
    ankleFar: shift(far.ankle),
    toeFar: shift(far.toe),
    shoulder,
    neck,
    head,
    elbowNear,
    handNear,
    elbowFar,
    handFar,
  };
}

/** A point in the torso's own frame: `a` up along the spine, `b` forward. */
function torsoPoint(s: Skeleton, a: number, b: number): Vec {
  return add(s.hip, add(scale(s.up, a), scale(s.forward, b)));
}

function limb(ops: PaintOp[], a: Vec, b: Vec, ra: number, rb: number, fill: string) {
  ops.push({ d: capsule(a, b, ra, rb), fill, stroke: OUTLINE });
}

function foot(ops: PaintOp[], ankle: Vec, toe: Vec, fill: string) {
  const along = { x: toe.x - ankle.x, y: toe.y - ankle.y };
  const length = Math.hypot(along.x, along.y) || 1;
  const u = scale(along, 1 / length);
  const down = { x: -u.y, y: u.x };
  const heel = add(ankle, add(scale(u, -3), scale(down, 2.6)));
  const sole = add(toe, scale(down, 1.4));
  ops.push({
    d: polygon([
      add(ankle, scale(u, -2.6)),
      heel,
      sole,
      add(toe, scale(down, -1)),
      add(ankle, scale(down, -1.8)),
    ]),
    fill,
    stroke: OUTLINE,
  });
}

function drawLeg(ops: PaintOp[], s: Skeleton, side: 'near' | 'far', kit: Kit) {
  const near = side === 'near';
  const knee = near ? s.kneeNear : s.kneeFar;
  const ankle = near ? s.ankleNear : s.ankleFar;
  const toe = near ? s.toeNear : s.toeFar;
  const skin = near ? C.skin : C.skinShade;
  const hip = add(s.hip, scale(s.forward, near ? 1.5 : -1));
  foot(ops, ankle, toe, near ? C.leather : C.leatherShade);
  limb(ops, knee, ankle, 3.9, 2.7, skin);
  if (kit.greaves) {
    limb(
      ops,
      lerpVec(knee, ankle, 0.08),
      lerpVec(knee, ankle, 0.86),
      4.3,
      3.1,
      near ? C.bronze : C.bronzeShade,
    );
  }
  limb(ops, hip, knee, 5.4, 4, skin);
  if (kit.body === 'scale' || kit.body === 'tunicLong') {
    limb(ops, hip, lerpVec(hip, knee, 0.75), 5.6, 4.5, near ? C.linen : C.linenShade);
  }
}

function drawArm(
  ops: PaintOp[],
  s: Skeleton,
  side: 'near' | 'far',
  sleeve: string | { faction: 'base' },
) {
  const near = side === 'near';
  const elbow = near ? s.elbowNear : s.elbowFar;
  const hand = near ? s.handNear : s.handFar;
  const skin = near ? C.skin : C.skinShade;
  limb(ops, elbow, hand, 3.3, 2.6, skin);
  limb(ops, s.shoulder, elbow, 4.4, 3.4, skin);
  ops.push({
    d: capsule(s.shoulder, lerpVec(s.shoulder, elbow, 0.45), 5, 4.4),
    fill: sleeve,
    stroke: OUTLINE,
  });
  ops.push({ d: circle(hand, 2.9), fill: skin, stroke: THIN });
}

/** A shaft through the hand at `angle`, `ahead` units towards the point and `behind` back. */
function shaft(hand: Vec, angle: number, ahead: number, behind: number) {
  return { tip: reach(hand, angle, ahead), butt: reach(hand, angle, -behind), u: dir(angle) };
}

function blade(tip: Vec, u: Vec, length: number, width: number, fill: string): PaintOp {
  const side = { x: -u.y, y: u.x };
  const base = add(tip, scale(u, -length));
  const swell = add(tip, scale(u, -length * 0.42));
  return {
    d: polygon([
      tip,
      add(swell, scale(side, width)),
      add(base, scale(side, width * 0.35)),
      add(base, scale(side, -width * 0.35)),
      add(swell, scale(side, -width)),
    ]),
    fill,
    stroke: THIN,
  };
}

function drawSpear(ops: PaintOp[], hand: Vec, angle: number, length: number, shaftFill: string) {
  const { tip, butt, u } = shaft(hand, angle, length * 0.62, length * 0.38);
  ops.push({ d: capsule(butt, tip, 1.5, 1.3), fill: shaftFill, stroke: THIN });
  ops.push(blade(tip, u, 12, 3.2, C.ironLight));
  ops.push({ d: capsule(butt, add(butt, scale(u, 5)), 1.8, 1.6), fill: C.bronze, stroke: THIN });
}

function drawJavelin(ops: PaintOp[], hand: Vec, angle: number) {
  const { tip, butt, u } = shaft(hand, angle, 44, 26);
  ops.push({ d: capsule(butt, tip, 1.2, 1), fill: C.wood, stroke: THIN });
  ops.push(blade(tip, u, 9, 2.2, C.ironLight));
  ops.push({
    d: polyline([add(hand, scale(u, -4)), add(hand, scale(u, 4))]),
    stroke: 2.6,
    strokeColour: C.leather,
  });
}

function drawSword(ops: PaintOp[], hand: Vec, angle: number, length = 34) {
  const u = dir(angle);
  const side = { x: -u.y, y: u.x };
  const guard = add(hand, scale(u, 3));
  const tip = add(guard, scale(u, length));
  ops.push({
    d: polygon([
      add(guard, scale(side, 2.4)),
      add(guard, scale(u, length * 0.7)),
      tip,
      add(add(guard, scale(u, length * 0.7)), scale(side, -0.4)),
      add(guard, scale(side, -2.4)),
    ]),
    fill: C.ironLight,
    stroke: THIN,
  });
  ops.push({
    d: polyline([add(guard, scale(u, 2)), add(guard, scale(u, length * 0.8))]),
    stroke: 0.8,
    strokeColour: C.ironShade,
  });
  ops.push({
    d: capsule(add(guard, scale(side, 4)), add(guard, scale(side, -4)), 1.3, 1.3),
    fill: C.bronze,
    stroke: THIN,
  });
  ops.push({ d: circle(add(hand, scale(u, -4)), 1.8), fill: C.bronze, stroke: THIN });
}

function drawBow(ops: PaintOp[], s: Skeleton, drawn: number, tilt: number) {
  const hand = s.handNear;
  const u = dir(180 - tilt);
  const forward = { x: u.y * -1, y: u.x };
  const top = add(hand, add(scale(u, 24), scale(forward, -4)));
  const bottom = add(hand, add(scale(u, -24), scale(forward, -4)));
  const bend = 6 + drawn * 5;
  const limbPoints = [
    top,
    add(add(hand, scale(u, 14)), scale(forward, bend * 0.55)),
    add(hand, scale(forward, 2.5)),
    add(add(hand, scale(u, -14)), scale(forward, bend * 0.55)),
    bottom,
  ];
  const nock =
    drawn > 0.05
      ? lerpVec(add(hand, scale(forward, -6)), s.handFar, drawn)
      : add(hand, scale(forward, -5));
  ops.push({ d: polyline([top, nock, bottom]), stroke: 0.9, strokeColour: C.linenShade });
  ops.push({ d: smoothOpen(limbPoints), stroke: 4.4, strokeColour: '#3b2816' });
  ops.push({ d: smoothOpen(limbPoints), stroke: 2.4, strokeColour: C.wood });
  if (drawn > 0.05) {
    const head = add(hand, scale(forward, 9));
    ops.push({ d: polyline([nock, head]), stroke: 1.1, strokeColour: C.dark });
    ops.push({
      d: polygon([
        head,
        add(head, add(scale(forward, -3), scale(u, 1.6))),
        add(head, add(scale(forward, -3), scale(u, -1.6))),
      ]),
      fill: C.iron,
      stroke: 0.8,
    });
  }
  ops.push({ d: circle(hand, 2.9), fill: C.skin, stroke: THIN });
}

function drawQuiver(ops: PaintOp[], s: Skeleton) {
  const top = torsoPoint(s, 30, -9);
  const bottom = torsoPoint(s, 6, -12);
  ops.push({ d: capsule(bottom, top, 3.6, 4.4), fill: C.leather, stroke: OUTLINE });
  for (const k of [-2, 0.5, 3]) {
    const from = add(top, scale(s.forward, k));
    const to = add(from, add(scale(s.up, 6), scale(s.forward, k * 0.5 - 1.5)));
    ops.push({ d: polyline([from, to]), stroke: 1.4, strokeColour: C.linen });
  }
  ops.push({
    d: polyline([torsoPoint(s, 24, -9), torsoPoint(s, 8, 5)]),
    stroke: 1.6,
    strokeColour: C.leatherShade,
  });
}

function drawCloak(ops: PaintOp[], s: Skeleton, flow: number, length = 34) {
  const back = scale(s.forward, -1);
  const shoulderBack = torsoPoint(s, 27, -6);
  const shoulderFront = torsoPoint(s, 28, 3);
  const sweep = 8 + flow * 22;
  const hemDrop = length - flow * 16;
  const hem = add(add(s.hip, scale(back, sweep)), scale(s.up, TORSO - hemDrop - 3));
  const mid = add(torsoPoint(s, 16, -8), scale(back, sweep * 0.6));
  const tail = add(hem, add(scale(back, 6 + flow * 6), scale(s.up, 5 + flow * 4)));
  const inner = add(torsoPoint(s, Math.max(2, TORSO - hemDrop + 3), -4), scale(back, sweep * 0.3));
  ops.push({
    d: smoothClosed([shoulderFront, shoulderBack, mid, tail, hem, inner]),
    fill: { faction: 'base' },
    stroke: OUTLINE,
  });
  ops.push({
    d: smoothClosed([shoulderBack, mid, tail, lerpVec(tail, hem, 0.5), lerpVec(mid, inner, 0.5)]),
    fill: { faction: 'shade' },
  });
  ops.push({
    d: smoothOpen([lerpVec(shoulderBack, mid, 0.3), lerpVec(mid, tail, 0.6)]),
    stroke: 1,
    strokeColour: '#3b2816',
  });
}

function drawTorso(ops: PaintOp[], s: Skeleton, kit: Kit) {
  const p = (a: number, b: number) => torsoPoint(s, a, b);
  const outline = [
    p(-1, -6.5),
    p(10, -7.6),
    p(21, -8.2),
    p(27, -6.4),
    p(30, -2.6),
    p(30, 2.6),
    p(26, 7.6),
    p(18, 8.2),
    p(9, 6.8),
    p(1, 6.3),
  ];
  const shadow = [
    p(-1, -6.5),
    p(10, -7.6),
    p(21, -8.2),
    p(27, -6.4),
    p(24, -3.2),
    p(12, -3.6),
    p(1, -2.8),
  ];
  const armour: Record<Body, { fill: string; shade: string } | undefined> = {
    linothorax: { fill: C.linen, shade: C.linenShade },
    mail: { fill: C.iron, shade: C.ironShade },
    tunic: undefined,
    tunicLong: undefined,
    scale: { fill: C.bronze, shade: C.bronzeShade },
    muscle: { fill: C.bronze, shade: C.bronzeShade },
  };
  const metal = armour[kit.body];
  const colouredTunic = kit.body === 'tunic' || kit.body === 'tunicLong';

  // The skirt of the tunic hangs from the waist over the thighs.
  const thighs = [lerpVec(s.hip, s.kneeNear, 0.62), lerpVec(s.hip, s.kneeFar, 0.62)];
  const front = thighs.reduce((a, b) =>
    a.x * s.forward.x + a.y * s.forward.y > b.x * s.forward.x + b.y * s.forward.y ? a : b,
  );
  const backThigh = thighs.reduce((a, b) =>
    a.x * s.forward.x + a.y * s.forward.y < b.x * s.forward.x + b.y * s.forward.y ? a : b,
  );
  const hemFront = add(front, scale(s.forward, 6.5));
  const hemBack = add(backThigh, scale(s.forward, -6.5));
  const long = kit.body === 'tunicLong' ? 1.35 : 1;
  const hemF = lerpVec(p(2, 6.6), hemFront, long);
  const hemB = lerpVec(p(2, -6.8), hemBack, long);
  const skirtFill = colouredTunic ? ({ faction: 'base' } as const) : C.linen;
  ops.push({
    d: smoothClosed([p(4, -7), p(4, 6.8), hemF, lerpVec(hemF, hemB, 0.5), hemB]),
    fill: skirtFill,
    stroke: OUTLINE,
  });
  if (colouredTunic) {
    ops.push({
      d: polygon([p(3, -6.8), hemB, lerpVec(hemB, hemF, 0.3), p(3, -2)]),
      fill: { faction: 'shade' },
    });
  }
  for (const t of [0.25, 0.5, 0.75]) {
    const top = lerpVec(p(3, -6), p(3, 6), t);
    ops.push({
      d: polyline([lerpVec(top, lerpVec(hemB, hemF, t), 0.45), lerpVec(hemB, hemF, t)]),
      stroke: 0.9,
    });
  }
  if (kit.body === 'linothorax') {
    for (let i = 0; i < 5; i++) {
      const t = (i + 0.5) / 5;
      const top = lerpVec(p(1, -7.2), p(1, 6.8), t);
      const bottom = add(top, scale(s.up, -8));
      ops.push({
        d: capsule(top, bottom, 1.9, 1.7),
        fill: i % 2 ? C.linen : C.linenShade,
        stroke: 1.2,
      });
    }
  }

  const body = metal ? metal.fill : { faction: 'base' as const };
  ops.push({ d: smoothClosed(outline), fill: body, stroke: OUTLINE });
  ops.push({ d: smoothClosed(shadow), fill: metal ? metal.shade : { faction: 'shade' } });
  if (kit.body === 'mail' || kit.body === 'scale') {
    for (let a = 4; a < 27; a += 4.2) {
      ops.push({
        d: polyline([p(a, -6.6), p(a + 0.6, 6.4)]),
        stroke: 0.8,
        strokeColour: kit.body === 'mail' ? C.ironShade : C.bronzeShade,
      });
    }
  }
  if (kit.body === 'muscle' || kit.body === 'linothorax') {
    ops.push({ d: smoothOpen([p(24, 7), p(18, 5.5), p(12, 6.8)]), stroke: 0.9 });
  }
  if (metal) {
    ops.push({
      d: smoothOpen([p(26, 6), p(20, 7.6), p(12, 6.6)]),
      stroke: 1.2,
      strokeColour: kit.body === 'mail' ? C.ironLight : C.bronzeLight,
    });
  }
  // A belt at the waist.
  ops.push({ d: capsule(p(4.5, -7.4), p(4.5, 7), 1.6, 1.6), fill: C.leather, stroke: 1.2 });
}

function drawHead(ops: PaintOp[], s: Skeleton, kit: Kit) {
  const h = s.head;
  const tilt = Math.atan2(s.head.y - s.neck.y, s.head.x - s.neck.x) + Math.PI / 2;
  const rot = (x: number, y: number): Vec => ({
    x: h.x + x * Math.cos(tilt) - y * Math.sin(tilt),
    y: h.y + x * Math.sin(tilt) + y * Math.cos(tilt),
  });
  ops.push({
    d: capsule(s.neck, lerpVec(s.neck, h, 0.6), 3.4, 3.4),
    fill: C.skin,
    stroke: OUTLINE,
  });
  // A face in profile: brow, nose, lips, chin, then back round the skull.
  const face = [
    rot(-6.4, -4),
    rot(-2, -7.6),
    rot(3.4, -6.8),
    rot(6.4, -3.4),
    rot(7.4, -1),
    rot(9, 1.4),
    rot(7, 2.2),
    rot(7.2, 3.6),
    rot(6.4, 4.6),
    rot(5.4, 7),
    rot(1.6, 7.6),
    rot(-1.5, 6.4),
    rot(-5.6, 3.4),
    rot(-7.2, -0.6),
  ];
  ops.push({ d: smoothClosed(face), fill: C.skin, stroke: OUTLINE });
  ops.push({ d: circle(rot(3.8, -1.5), 0.9), fill: C.dark });

  const crestBase = (sweep: number, height: number, fill: 'base' | 'shade' = 'base') => {
    const points = [
      rot(4.5, -9.5),
      rot(2, -9.5 - height * 0.8),
      rot(-4, -9.5 - height),
      rot(-10, -8 - height * 0.6),
      rot(-12.5 - sweep, -2 + sweep * 0.4),
      rot(-9, -4),
      rot(-4, -10),
      rot(2, -10.5),
    ];
    ops.push({ d: smoothClosed(points), fill: { faction: fill }, stroke: OUTLINE });
    ops.push({
      d: smoothOpen([rot(1, -11), rot(-4, -8.5 - height * 0.75), rot(-9, -6 - height * 0.45)]),
      stroke: 0.8,
    });
    ops.push({
      d: smoothOpen([rot(2.5, -9.6 - height * 0.6), rot(-4, -10 - height * 0.85)]),
      stroke: 1.1,
      strokeColour: '#ffffff',
    });
  };

  switch (kit.helmet) {
    case 'corinthian': {
      const shell = [
        rot(-8, 4.5),
        rot(-8.8, -2),
        rot(-6, -8),
        rot(0, -10.6),
        rot(5.5, -8.6),
        rot(8, -4),
        rot(8.2, -1.6),
        rot(9.6, 0.4),
        rot(8.8, 3.4),
        rot(7, 6.8),
        rot(3.6, 8.4),
        rot(3.4, 4.2),
        rot(5.2, 1.2),
        rot(1, 1.2),
        rot(-2.6, 6),
      ];
      ops.push({ d: smoothClosed(shell), fill: C.bronze, stroke: OUTLINE });
      ops.push({
        d: smoothClosed([rot(-8, 4.5), rot(-8.8, -2), rot(-6, -8), rot(-3, -5), rot(-4, 2)]),
        fill: C.bronzeShade,
      });
      ops.push({
        d: polyline([rot(1.4, -1.8), rot(7.6, -2.4)]),
        stroke: 1.8,
        strokeColour: C.dark,
      });
      ops.push({
        d: smoothOpen([rot(-4, -8.6), rot(2, -9.4), rot(6, -6.6)]),
        stroke: 1.2,
        strokeColour: C.bronzeLight,
      });
      crestBase(4, 9);
      break;
    }
    case 'attic':
    case 'plumed': {
      const shell = [
        rot(-8, 2),
        rot(-8.4, -3),
        rot(-5.5, -8.4),
        rot(0.5, -10.2),
        rot(6, -8),
        rot(8, -4.4),
        rot(9.4, -3.6),
        rot(5.2, -2.6),
        rot(4.6, 1.6),
        rot(2.4, 5.6),
        rot(0.6, 1.6),
        rot(-4, 4.2),
      ];
      ops.push({ d: smoothClosed(shell), fill: C.bronze, stroke: OUTLINE });
      ops.push({
        d: smoothClosed([
          rot(-8, 2),
          rot(-8.4, -3),
          rot(-5.5, -8.4),
          rot(-2.5, -6),
          rot(-3.4, 1.6),
        ]),
        fill: C.bronzeShade,
      });
      ops.push({
        d: smoothOpen([rot(-3.6, -8.8), rot(2, -9.4), rot(6, -6.4)]),
        stroke: 1.2,
        strokeColour: C.bronzeLight,
      });
      crestBase(kit.helmet === 'plumed' ? 8 : 3, kit.helmet === 'plumed' ? 15 : 8);
      if (kit.helmet === 'plumed') {
        ops.push({
          d: smoothClosed([rot(-1, -10), rot(-2, -22), rot(1, -30), rot(3, -22), rot(1.5, -11)]),
          fill: { faction: 'light' },
          stroke: THIN,
        });
      }
      break;
    }
    case 'montefortino': {
      const shell = [
        rot(-7.6, 1.6),
        rot(-8.2, -3),
        rot(-5.4, -8.6),
        rot(0, -10.4),
        rot(5.6, -8.4),
        rot(7.8, -3.6),
        rot(5.6, -3),
        rot(-6.6, -1.4),
      ];
      ops.push({ d: smoothClosed(shell), fill: C.bronze, stroke: OUTLINE });
      ops.push({
        d: smoothClosed([
          rot(-7.6, 1.6),
          rot(-8.2, -3),
          rot(-5.4, -8.6),
          rot(-2, -6),
          rot(-3.4, -1.2),
        ]),
        fill: C.bronzeShade,
      });
      ops.push({
        d: polygon([rot(-1.4, -2), rot(3.6, -2.6), rot(3.8, 3.8), rot(1, 6.6), rot(-1.6, 3)]),
        fill: C.bronze,
        stroke: THIN,
      });
      ops.push({
        d: smoothOpen([rot(-7.8, -1.2), rot(0, -2.4), rot(7.4, -3.6)]),
        stroke: 1.8,
        strokeColour: C.bronzeShade,
      });
      ops.push({ d: capsule(rot(0, -10), rot(0, -13), 1.8, 1.2), fill: C.bronze, stroke: THIN });
      for (const [x, lean] of [
        [-2.4, -5],
        [0, 0],
        [2.4, 5],
      ] as const) {
        ops.push({
          d: smoothClosed([
            rot(x - 1.4, -12),
            rot(x + lean - 1.6, -21),
            rot(x + lean, -25),
            rot(x + lean + 1.6, -21),
            rot(x + 1.4, -12),
          ]),
          fill: { faction: x === 0 ? 'base' : 'shade' },
          stroke: THIN,
        });
      }
      break;
    }
    case 'bare': {
      ops.push({
        d: smoothClosed([
          rot(-7.4, 2),
          rot(-8, -4),
          rot(-4.6, -8.6),
          rot(1.4, -9.2),
          rot(5, -7),
          rot(3.2, -5.6),
          rot(-1.6, -5.2),
          rot(-3.4, -1.6),
          rot(-5.2, 3.6),
        ]),
        fill: C.hair,
        stroke: OUTLINE,
      });
      ops.push({
        d: smoothOpen([rot(-7.8, -2.6), rot(-1, -6.4), rot(5.6, -6.2)]),
        stroke: 2.8,
        strokeColour: '#3b2816',
      });
      ops.push({
        d: smoothOpen([rot(-7.8, -2.6), rot(-1, -6.4), rot(5.6, -6.2)]),
        stroke: 1.6,
        strokeColour: C.linen,
      });
      ops.push({
        d: smoothClosed([rot(-7.2, -3.6), rot(-12, -1), rot(-12.4, 2.6), rot(-8.6, -0.4)]),
        fill: { faction: 'base' },
        stroke: THIN,
      });
      break;
    }
    case 'cap': {
      const cap = [
        rot(-7.8, 2.6),
        rot(-8.6, -3),
        rot(-6, -9),
        rot(0, -12),
        rot(6, -12.6),
        rot(9.6, -10.6),
        rot(8.6, -8.4),
        rot(5.4, -8.4),
        rot(6.8, -5.2),
        rot(5.8, -3.8),
        rot(-4, -3.6),
        rot(-4.4, 1.6),
        rot(-3.6, 6.4),
        rot(-6.6, 6.8),
      ];
      ops.push({ d: smoothClosed(cap), fill: { faction: 'base' }, stroke: OUTLINE });
      ops.push({
        d: smoothClosed([
          rot(-7.8, 2.6),
          rot(-8.6, -3),
          rot(-6, -9),
          rot(-3, -6),
          rot(-4.4, 1.6),
          rot(-3.6, 6.4),
          rot(-6.6, 6.8),
        ]),
        fill: { faction: 'shade' },
      });
      ops.push({
        d: smoothOpen([rot(-2, -10.6), rot(4, -11.6), rot(8, -10.4)]),
        stroke: 1.1,
        strokeColour: '#ffffff',
      });
      break;
    }
  }
}

function drawShield(ops: PaintOp[], s: Skeleton, shield: Shield) {
  const along = { x: s.handNear.x - s.elbowNear.x, y: s.handNear.y - s.elbowNear.y };
  const centre = lerpVec(s.elbowNear, s.handNear, 0.45);
  const turn = (Math.atan2(along.y, along.x) * 180) / Math.PI;
  switch (shield) {
    case 'aspis': {
      const c = add(centre, scale(s.forward, 3));
      ops.push({ d: ellipse(c, 17.5, 21.5, 0, 32), fill: C.bronze, stroke: OUTLINE });
      ops.push({ d: ellipse(c, 14.4, 18.2, 0, 32), fill: { faction: 'base' }, stroke: 1.2 });
      ops.push({
        d: polygon(
          arcPoints(c, 14.4, 18.2, 0, Math.PI * 0.62, Math.PI * 1.42, 14).concat(
            arcPoints(c, 9, 13, 0, Math.PI * 1.32, Math.PI * 0.7, 10),
          ),
        ),
        fill: { faction: 'shade' },
      });
      ops.push({
        d: smoothOpen(arcPoints(c, 11.5, 15, 0, -Math.PI * 0.45, Math.PI * 0.1, 8)),
        stroke: 1.6,
        strokeColour: '#ffffff',
      });
      ops.push({
        d: smoothOpen(arcPoints(c, 16, 20, 0, -Math.PI * 0.55, -Math.PI * 0.05, 8)),
        stroke: 1.2,
        strokeColour: C.bronzeLight,
      });
      ops.push({ d: ellipse(c, 6, 7.4, 0, 18), stroke: 1.1 });
      break;
    }
    case 'oval': {
      const c = add(centre, scale(s.forward, 2.5));
      ops.push({
        d: ellipse(c, 11.5, 23, turn * 0.08, 32),
        fill: { faction: 'base' },
        stroke: OUTLINE,
      });
      ops.push({
        d: polygon(
          arcPoints(c, 11.5, 23, turn * 0.08, Math.PI * 0.55, Math.PI * 1.45, 14).concat(
            arcPoints(c, 6, 20, turn * 0.08, Math.PI * 1.4, Math.PI * 0.6, 10),
          ),
        ),
        fill: { faction: 'shade' },
      });
      ops.push({
        d: polyline([add(c, { x: 0, y: -21 }), add(c, { x: 0, y: 21 })]),
        stroke: 2.6,
        strokeColour: C.woodShade,
      });
      ops.push({ d: ellipse(c, 4.2, 5.6, 0, 16), fill: C.iron, stroke: THIN });
      ops.push({
        d: smoothOpen(arcPoints(c, 8.6, 20, turn * 0.08, -Math.PI * 0.42, Math.PI * 0.05, 8)),
        stroke: 1.4,
        strokeColour: '#ffffff',
      });
      break;
    }
    case 'pelta': {
      // A crescent: the round of the shield below, its two horns up, the mouth between.
      const c = add(centre, scale(s.forward, 2));
      const outer = arcPoints(c, 11, 12, 0, -0.35, Math.PI + 0.35, 16);
      const mouth = arcPoints(add(c, { x: 0, y: -7 }), 7.5, 5, 0, Math.PI - 0.2, 0.2, 8);
      ops.push({ d: polygon([...outer, ...mouth]), fill: { faction: 'base' }, stroke: OUTLINE });
      ops.push({
        d: polygon([
          ...arcPoints(c, 11, 12, 0, Math.PI * 0.55, Math.PI + 0.35, 8),
          ...arcPoints(c, 6, 8, 0, Math.PI + 0.2, Math.PI * 0.6, 6),
        ]),
        fill: { faction: 'shade' },
      });
      ops.push({
        d: smoothOpen(arcPoints(c, 8.6, 9.4, 0, Math.PI * 0.35, Math.PI * 0.9, 6)),
        stroke: 1.4,
        strokeColour: C.wicker,
      });
      ops.push({
        d: smoothOpen(arcPoints(c, 8, 9, 0, 0, Math.PI * 0.32, 6)),
        stroke: 1.3,
        strokeColour: '#ffffff',
      });
      break;
    }
    case 'round': {
      const c = add(centre, scale(s.forward, 2));
      ops.push({ d: ellipse(c, 10, 11.5, 0, 24), fill: { faction: 'base' }, stroke: OUTLINE });
      ops.push({
        d: polygon(
          arcPoints(c, 10, 11.5, 0, Math.PI * 0.6, Math.PI * 1.4, 10).concat(
            arcPoints(c, 5, 8.6, 0, Math.PI * 1.35, Math.PI * 0.65, 8),
          ),
        ),
        fill: { faction: 'shade' },
      });
      ops.push({ d: ellipse(c, 3, 3.4, 0, 12), fill: C.bronze, stroke: THIN });
      break;
    }
    case 'none':
      break;
  }
}

function drawWeapon(ops: PaintOp[], s: Skeleton, pose: FootPose, weapon: Weapon) {
  switch (weapon) {
    case 'spear':
      drawSpear(ops, s.handFar, pose.grip, 150, C.wood);
      break;
    case 'lance':
      drawSpear(ops, s.handFar, pose.grip, 128, C.wood);
      break;
    case 'javelin':
      if (pose.draw > 0.5) drawJavelin(ops, s.handFar, pose.grip);
      break;
    case 'sword':
    case 'swordRaised':
      drawSword(ops, s.handFar, pose.grip);
      break;
    case 'standard':
      drawStandardPole(ops, s.handFar, pose.grip);
      break;
    case 'bow':
    case 'none':
      break;
  }
}

/** The army's standard: a tall pole with a crossbar, a coloured cloth, and a wreath. */
export function drawStandardPole(ops: PaintOp[], hand: Vec, angle: number, wave = 0) {
  const { tip, butt, u } = shaft(hand, angle, 70, 18);
  const side = { x: -u.y, y: u.x };
  ops.push({ d: capsule(butt, tip, 1.6, 1.4), fill: C.wood, stroke: THIN });
  const bar = add(tip, scale(u, -8));
  const clothTop = add(bar, scale(side, -1));
  const w = 20;
  const h = 18;
  const sway = Math.sin(wave * Math.PI * 2) * 2.5;
  const cloth = [
    clothTop,
    add(clothTop, scale(side, -w)),
    add(add(clothTop, scale(side, -w + sway)), scale(u, -h * 0.55)),
    add(add(clothTop, scale(side, -w * 0.82 + sway)), scale(u, -h)),
    add(add(clothTop, scale(side, -w * 0.5 + sway * 0.6)), scale(u, -h * 0.82)),
    add(add(clothTop, scale(side, -w * 0.18 + sway * 0.3)), scale(u, -h)),
    add(clothTop, scale(u, -h * 0.55)),
  ];
  ops.push({
    d: capsule(add(bar, scale(side, 1.5)), add(bar, scale(side, -w - 1.5)), 1.2, 1.2),
    fill: C.wood,
    stroke: THIN,
  });
  ops.push({ d: polygon(cloth), fill: { faction: 'base' }, stroke: OUTLINE });
  ops.push({
    d: polygon([
      cloth[0] as Vec,
      cloth[1] as Vec,
      add(cloth[1] as Vec, scale(u, -4)),
      add(cloth[0] as Vec, scale(u, -4)),
    ]),
    fill: { faction: 'shade' },
  });
  ops.push({
    d: ellipse(add(add(clothTop, scale(side, -w / 2)), scale(u, -h * 0.5)), 4, 4, 0, 14),
    stroke: 1.2,
    strokeColour: C.bronzeLight,
  });
  ops.push({ d: ellipse(add(tip, scale(u, 3)), 3.4, 3.4, 0, 14), fill: C.bronze, stroke: THIN });
}

/** The figure on foot, from the back of the picture to the front. */
export function footFigure(pose: FootPose, kit: Kit, seat?: Vec): PaintOp[] {
  const s = footSkeleton(pose, seat);
  const ops: PaintOp[] = [];
  const sleeve = { faction: 'base' } as const;
  if (kit.cloak) drawCloak(ops, s, pose.flow, seat ? 26 : 34);
  if (kit.quiver) drawQuiver(ops, s);
  if (!seat) drawLeg(ops, s, 'far', kit);
  drawWeapon(ops, s, pose, kit.weapon);
  drawArm(ops, s, 'far', sleeve);
  drawLeg(ops, s, 'near', kit);
  drawTorso(ops, s, kit);
  drawHead(ops, s, kit);
  if (kit.spares) {
    for (const k of [-6, 0]) drawJavelin(ops, add(s.handNear, { x: k * 0.3, y: 0 }), 170 - k);
  }
  drawArm(ops, s, 'near', sleeve);
  if (kit.weapon === 'bow') drawBow(ops, s, pose.draw, pose.grip);
  drawShield(ops, s, kit.shield);
  return ops;
}
