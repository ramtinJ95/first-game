import { horseFigure, type Coat, type HorsePose } from './horse.ts';
import { C, footFigure, footSkeleton, type FootPose, type Kit } from './human.ts';
import {
  add,
  circle,
  ellipse,
  polygon,
  polyline,
  reach,
  smoothClosed,
  smoothOpen,
  type PaintOp,
  type Vec,
} from './paint.ts';

export interface Crewman {
  readonly pose: FootPose;
  readonly kit: Kit;
}

export interface ChariotPose {
  readonly team: readonly [near: Coat, far: Coat];
  readonly horses: readonly [near: HorsePose, far: HorsePose];
  readonly archer: Crewman;
  readonly driver: Crewman;
  /** How far the wheel has turned, in degrees. */
  readonly wheel: number;
  /** How far the crew has sunk into the car, in figure units. */
  readonly sink: number;
}

const FLOOR = -28;
const HUB: Vec = { x: -58, y: -23.5 };
const RIM = 22;
const NEAR_HORSE: Vec = { x: 36, y: 0 };
const FAR_HORSE: Vec = { x: 43, y: -5 };

/** A man standing in the car at `x`, his soles on its floor. */
function standing(crewman: Crewman, x: number, sink: number) {
  const hip = footSkeleton(crewman.pose).hip;
  return { x, y: FLOOR + hip.y + sink };
}

function wheelOps(hub: Vec, turned: number, far: boolean): PaintOp[] {
  const ops: PaintOp[] = [];
  const wood = far ? C.woodShade : C.wood;
  ops.push({ d: ellipse(hub, RIM, RIM, 0, 32), fill: C.leatherShade, stroke: 2.4 });
  ops.push({
    d: ellipse(hub, RIM - 3.6, RIM - 3.6, 0, 32),
    fill: far ? C.dark : C.wash,
    stroke: 1.4,
  });
  if (far) return ops;
  for (let i = 0; i < 6; i++) {
    const out = reach(hub, turned + i * 60, RIM - 3);
    ops.push({ d: polyline([hub, out]), stroke: 3.4, strokeColour: C.dark });
    ops.push({ d: polyline([hub, out]), stroke: 1.8, strokeColour: wood });
  }
  ops.push({ d: circle(hub, 4.4), fill: C.bronze, stroke: 1.6 });
  return ops;
}

/**
 * A two-horse chariot facing +x: the far horse, the pole, the near horse, then the car
 * with its driver and archer behind the siding and the near wheel over it.
 */
export function chariotFigure(pose: ChariotPose): PaintOp[] {
  const ops: PaintOp[] = [];
  const [nearCoat, farCoat] = pose.team;
  const far = horseFigure(pose.horses[1], farCoat, 'saddleCloth', FAR_HORSE);
  const near = horseFigure(pose.horses[0], nearCoat, 'saddleCloth', NEAR_HORSE);
  ops.push(...far.ops);
  const yoke = add(near.seat, { x: 22, y: -2 });
  ops.push({
    d: smoothOpen([{ x: -38, y: FLOOR - 2 }, { x: 4, y: -40 }, yoke]),
    stroke: 4.6,
    strokeColour: C.dark,
  });
  ops.push({
    d: smoothOpen([{ x: -38, y: FLOOR - 2 }, { x: 4, y: -40 }, yoke]),
    stroke: 2.6,
    strokeColour: C.wood,
  });
  ops.push(...near.ops);
  ops.push({ d: circle(yoke, 3), fill: C.bronze, stroke: 1.4 });

  ops.push(...wheelOps(add(HUB, { x: 7, y: -4 }), pose.wheel, true));
  const back = [
    { x: -38, y: FLOOR },
    { x: -38, y: -56 },
    { x: -74, y: -58 },
    { x: -78, y: FLOOR },
  ];
  ops.push({ d: polygon(back), fill: C.leatherShade, stroke: 2.4 });

  const driverAt = standing(pose.driver, -48, pose.sink - 3);
  const archerAt = standing(pose.archer, -64, pose.sink);
  ops.push(...footFigure(pose.driver.pose, pose.driver.kit, driverAt));
  ops.push(...footFigure(pose.archer.pose, pose.archer.kit, archerAt));
  const hands = footSkeleton(pose.driver.pose, driverAt);

  const siding = [
    { x: -36, y: FLOOR },
    { x: -34, y: -46 },
    { x: -40, y: -64 },
    { x: -56, y: -62 },
    { x: -74, y: -58 },
    { x: -80, y: -50 },
    { x: -78, y: FLOOR },
  ];
  ops.push({ d: smoothClosed(siding), fill: { faction: 'base' }, stroke: 2.4 });
  ops.push({
    d: smoothClosed([
      { x: -78, y: FLOOR },
      { x: -80, y: -50 },
      { x: -70, y: -46 },
      { x: -66, y: FLOOR + 2 },
    ]),
    fill: { faction: 'shade' },
  });
  ops.push({
    d: smoothOpen([
      { x: -78, y: -54 },
      { x: -56, y: -59 },
      { x: -40, y: -61 },
      { x: -35, y: -46 },
    ]),
    stroke: 2,
    strokeColour: C.bronzeLight,
  });
  ops.push({
    d: polyline([
      { x: -78, y: FLOOR - 1 },
      { x: -36, y: FLOOR - 1 },
    ]),
    stroke: 2.6,
    strokeColour: C.dark,
  });
  ops.push(...wheelOps(HUB, pose.wheel, false));

  for (const [hand, mouth] of [
    [hands.handNear, near.mouth],
    [hands.handFar, far.mouth],
  ] as const) {
    ops.push({
      d: smoothOpen([hand, add(hand, { x: (mouth.x - hand.x) * 0.5, y: 8 }), mouth]),
      stroke: 1,
      strokeColour: C.leatherShade,
    });
  }
  return ops;
}
