import type { Troop } from '../../sim/troops.ts';
import {
  HORSE_STAND,
  gallopPose,
  horseFigure,
  walkPose,
  type Coat,
  type Dress,
  type HorsePose,
} from './horse.ts';
import { chariotFigure } from './chariot.ts';
import { ELEPHANT_STAND, elephantFigure, elephantWalk, type ElephantPose } from './elephant.ts';
import { drawStandardPole, footFigure, type FootPose, type Kit } from './human.ts';
import { add, type PaintOp } from './paint.ts';

/** What a figure can do. A fall plays once and ends lying; the others loop. */
export const MOTIONS = {
  stand: { frames: 4, loop: true },
  march: { frames: 8, loop: true },
  fight: { frames: 8, loop: true },
  run: { frames: 6, loop: true },
  fall: { frames: 6, loop: false },
} as const;
export type Motion = keyof typeof MOTIONS;

export type FigureKind = Troop | 'general' | 'bearer' | 'refugee' | 'refugeeWoman';

type Action = 'thrust' | 'cut' | 'throw' | 'loose' | 'charge' | 'lead' | 'none';

/**
 * What a figure stands on or rides. The kind's own man is the rider, the fighting man
 * in an elephant's tower, or the archer in a chariot beside its driver.
 */
type Mount =
  | { readonly kind: 'foot' }
  | { readonly kind: 'horse'; readonly coat: Coat; readonly dress: Dress }
  | { readonly kind: 'elephant' }
  | { readonly kind: 'chariot'; readonly team: readonly [near: Coat, far: Coat] };

interface KindArt {
  readonly kit: Kit;
  readonly action: Action;
  readonly mount: Mount;
  /** The pose at ease, which the other motions start from. */
  readonly rest: Partial<FootPose>;
}

const FOOT: Mount = { kind: 'foot' };
const horse = (coat: Coat, dress: Dress): Mount => ({ kind: 'horse', coat, dress });

const REST: FootPose = {
  lean: 2,
  head: 0,
  hipNear: 5,
  kneeNear: 3,
  hipFar: -4,
  kneeFar: 5,
  shoulderNear: 24,
  elbowNear: 68,
  shoulderFar: 10,
  elbowFar: 40,
  grip: 172,
  lift: 0,
  draw: 1,
  flow: 0.15,
};

const SEATED = { hipNear: 52, kneeNear: 82, hipFar: 52, kneeFar: 82 } as const;

const kit = (k: Partial<Kit>): Kit => ({
  helmet: 'bare',
  body: 'tunic',
  shield: 'none',
  weapon: 'none',
  greaves: false,
  quiver: false,
  cloak: false,
  spares: false,
  armouredLimbs: false,
  ...k,
});

/** Every figure the map draws: its dress, its weapon, and what it does when it fights. */
export const KINDS: Readonly<Record<FigureKind, KindArt>> = {
  spearmen: {
    kit: kit({
      helmet: 'corinthian',
      body: 'linothorax',
      shield: 'aspis',
      weapon: 'spear',
      greaves: true,
    }),
    action: 'thrust',
    mount: FOOT,
    rest: { grip: 176, shoulderFar: 14, elbowFar: 36 },
  },
  swordsmen: {
    kit: kit({ helmet: 'montefortino', body: 'mail', shield: 'oval', weapon: 'sword' }),
    action: 'cut',
    mount: FOOT,
    rest: { grip: 140, shoulderFar: 8, elbowFar: 50 },
  },
  skirmishers: {
    kit: kit({ helmet: 'bare', body: 'tunic', shield: 'pelta', weapon: 'javelin', spares: true }),
    action: 'throw',
    mount: FOOT,
    rest: { grip: 160, shoulderFar: 18, elbowFar: 60 },
  },
  archers: {
    kit: kit({ helmet: 'cap', body: 'tunicLong', weapon: 'bow', quiver: true }),
    action: 'loose',
    mount: FOOT,
    rest: { shoulderNear: 18, elbowNear: 10, grip: 14, draw: 0 },
  },
  lightCavalry: {
    kit: kit({ helmet: 'bare', body: 'tunic', shield: 'round', weapon: 'javelin', cloak: true }),
    action: 'throw',
    mount: horse('dun', 'saddleCloth'),
    rest: { ...SEATED, grip: 150, shoulderFar: 30, elbowFar: 50, shoulderNear: 30, elbowNear: 60 },
  },
  heavyCavalry: {
    kit: kit({ helmet: 'attic', body: 'muscle', weapon: 'lance', cloak: true }),
    action: 'charge',
    mount: horse('bay', 'barding'),
    rest: { ...SEATED, grip: 168, shoulderFar: 20, elbowFar: 50, shoulderNear: 40, elbowNear: 50 },
  },
  legionaries: {
    kit: kit({
      helmet: 'montefortino',
      body: 'mail',
      shield: 'oval',
      weapon: 'sword',
      greaves: true,
      spares: true,
    }),
    action: 'cut',
    mount: FOOT,
    rest: { grip: 140, shoulderFar: 8, elbowFar: 50 },
  },
  triarii: {
    kit: kit({ helmet: 'plumed', body: 'mail', shield: 'oval', weapon: 'spear', greaves: true }),
    action: 'thrust',
    mount: FOOT,
    rest: { grip: 176, shoulderFar: 14, elbowFar: 36 },
  },
  phalangites: {
    kit: kit({
      helmet: 'attic',
      body: 'linothorax',
      shield: 'round',
      weapon: 'pike',
      greaves: true,
    }),
    action: 'thrust',
    mount: FOOT,
    rest: { grip: 178, shoulderFar: 14, elbowFar: 36 },
  },
  nileArchers: {
    kit: kit({ helmet: 'bare', body: 'tunic', weapon: 'bow', quiver: true }),
    action: 'loose',
    mount: FOOT,
    rest: { shoulderNear: 18, elbowNear: 10, grip: 14, draw: 0 },
  },
  numidianHorse: {
    kit: kit({ helmet: 'bare', body: 'tunic', shield: 'round', weapon: 'javelin', spares: true }),
    action: 'throw',
    mount: horse('black', 'none'),
    rest: { ...SEATED, grip: 150, shoulderFar: 30, elbowFar: 50, shoulderNear: 30, elbowNear: 60 },
  },
  horseArchers: {
    kit: kit({ helmet: 'cap', body: 'tunic', weapon: 'bow', quiver: true, cloak: true }),
    action: 'loose',
    mount: horse('dun', 'saddleCloth'),
    rest: { ...SEATED, shoulderNear: 30, elbowNear: 20, grip: 14, draw: 0 },
  },
  chariots: {
    kit: kit({ helmet: 'cap', body: 'scale', weapon: 'bow', quiver: true }),
    action: 'loose',
    mount: { kind: 'chariot', team: ['bay', 'dun'] },
    rest: { shoulderNear: 18, elbowNear: 10, grip: 14, draw: 0 },
  },
  companionCavalry: {
    kit: kit({ helmet: 'plumed', body: 'muscle', weapon: 'lance', cloak: true }),
    action: 'charge',
    mount: horse('grey', 'saddleCloth'),
    rest: { ...SEATED, grip: 168, shoulderFar: 20, elbowFar: 50, shoulderNear: 40, elbowNear: 50 },
  },
  cataphracts: {
    kit: kit({ helmet: 'mask', body: 'scale', weapon: 'lance', armouredLimbs: true }),
    action: 'charge',
    mount: horse('black', 'scale'),
    rest: { ...SEATED, grip: 168, shoulderFar: 20, elbowFar: 50, shoulderNear: 40, elbowNear: 50 },
  },
  warElephants: {
    kit: kit({ helmet: 'attic', body: 'linothorax', shield: 'round', weapon: 'lance' }),
    action: 'charge',
    mount: { kind: 'elephant' },
    rest: { grip: 118, shoulderFar: 40, elbowFar: 30, shoulderNear: 40, elbowNear: 50 },
  },
  general: {
    kit: kit({ helmet: 'plumed', body: 'muscle', weapon: 'swordRaised', cloak: true }),
    action: 'lead',
    mount: horse('grey', 'saddleCloth'),
    rest: { ...SEATED, grip: 130, shoulderFar: 40, elbowFar: 40, shoulderNear: 40, elbowNear: 50 },
  },
  bearer: {
    kit: kit({ helmet: 'attic', body: 'muscle', weapon: 'standard', cloak: true }),
    action: 'none',
    mount: FOOT,
    rest: { grip: 178, shoulderFar: 26, elbowFar: 70, shoulderNear: 14, elbowNear: 30 },
  },
  refugee: {
    kit: kit({ helmet: 'bare', body: 'tunicLong', weapon: 'none', cloak: true }),
    action: 'none',
    mount: FOOT,
    rest: { shoulderNear: 10, elbowNear: 50, shoulderFar: 12, elbowFar: 30, flow: 0 },
  },
  refugeeWoman: {
    kit: kit({ helmet: 'cap', body: 'tunicLong', weapon: 'none', cloak: true }),
    action: 'none',
    mount: FOOT,
    rest: { shoulderNear: 30, elbowNear: 80, shoulderFar: 20, elbowFar: 70, flow: 0 },
  },
};

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function blend(a: FootPose, b: Partial<FootPose>, t: number): FootPose {
  const out = { ...a } as Record<keyof FootPose, number>;
  for (const key of Object.keys(b) as (keyof FootPose)[])
    out[key] = lerp(a[key], b[key] ?? a[key], t);
  return out;
}

/** Plays keyframes `[time, pose]` that loop over 0 to 1, eased between each pair. */
function keyframes(
  base: FootPose,
  keys: readonly (readonly [number, Partial<FootPose>])[],
  t: number,
  loop = true,
): FootPose {
  const full = keys.map(([at, pose]) => [at, { ...base, ...pose }] as const);
  const first = full[0];
  const last = full[full.length - 1];
  if (!first || !last) return base;
  const timeline = loop ? [...full, [first[0] + 1, first[1]] as const] : full;
  const at = loop ? ((((t - first[0]) % 1) + 1) % 1) + first[0] : Math.min(t, last[0]);
  for (let i = 0; i < timeline.length - 1; i++) {
    const [t0, p0] = timeline[i] as (typeof timeline)[number];
    const [t1, p1] = timeline[i + 1] as (typeof timeline)[number];
    if (at >= t0 && at <= t1) return blend(p0, p1, smooth((at - t0) / Math.max(1e-6, t1 - t0)));
  }
  return last[1];
}

/**
 * Legs that swing `stride` degrees either side of upright. A leg bends most halfway
 * through its swing forward and lands nearly straight, the knee never less than `least`.
 */
function walkLegs(
  t: number,
  stride: number,
  lift: number,
  least = 6,
  ahead = 0.15,
): Partial<FootPose> {
  const a = 2 * Math.PI * t;
  const bend = (phase: number) =>
    least + lift * Math.max(0, Math.sin(phase + Math.PI / 2 - 0.5)) ** 1.6;
  return {
    hipNear: stride * (Math.sin(a) + ahead),
    hipFar: stride * (-Math.sin(a) + ahead),
    kneeNear: bend(a),
    kneeFar: bend(a + Math.PI),
  };
}

function footPose(art: KindArt, motion: Motion, t: number): FootPose {
  const rest = { ...REST, ...art.rest };
  const a = 2 * Math.PI * t;
  switch (motion) {
    case 'stand':
      return {
        ...rest,
        lean: rest.lean + 1.2 * Math.sin(a),
        head: 3 * Math.sin(a + 1),
        elbowFar: rest.elbowFar + 4 * Math.sin(a),
        flow: rest.flow + 0.05 * Math.sin(a),
      };
    case 'march':
      return {
        ...rest,
        ...walkLegs(t, 20, 42),
        lean: rest.lean + 4,
        elbowNear: rest.elbowNear + 3 * Math.sin(2 * a),
        shoulderFar: rest.shoulderFar + 5 * Math.sin(a),
        flow: 0.35,
      };
    case 'run':
      return {
        ...rest,
        ...walkLegs(t, 32, 85, 18, -0.25),
        lean: 20,
        head: -8,
        lift: 4 * Math.max(0, Math.sin(2 * a)),
        shoulderNear: 40 - 30 * Math.sin(a),
        elbowNear: 70,
        shoulderFar: 30 + 40 * Math.sin(a),
        elbowFar: 70,
        grip: art.kit.weapon === 'bow' ? rest.grip : 130,
        draw: art.kit.weapon === 'bow' ? 0 : rest.draw,
        flow: 0.9,
      };
    case 'fall': {
      const hit = {
        lean: -14,
        head: -14,
        shoulderNear: 60,
        elbowNear: 40,
        shoulderFar: 150,
        elbowFar: 20,
        kneeNear: 10,
        kneeFar: 14,
      };
      const buckle = {
        lean: 24,
        head: 10,
        hipNear: 50,
        kneeNear: 100,
        hipFar: 30,
        kneeFar: 90,
        shoulderNear: 50,
        elbowNear: 30,
        shoulderFar: 80,
        elbowFar: 20,
        grip: 110,
      };
      const down = {
        lean: 8,
        head: 0,
        hipNear: 10,
        kneeNear: 10,
        hipFar: 0,
        kneeFar: 20,
        shoulderNear: 150,
        elbowNear: 20,
        shoulderFar: 170,
        elbowFar: 10,
        grip: 10,
        draw: 0,
      };
      return keyframes(
        rest,
        [
          [0, {}],
          [0.2, hit],
          [0.55, buckle],
          [1, down],
        ],
        t,
        false,
      );
    }
    case 'fight':
      return fightPose(art.action, rest, t);
  }
}

const BRACED = { hipNear: 22, kneeNear: 14, hipFar: -20, kneeFar: 8 } as const;

function fightPose(action: Action, rest: FootPose, t: number): FootPose {
  switch (action) {
    case 'thrust':
      return keyframes(
        { ...rest, ...BRACED },
        [
          [
            0,
            { lean: 6, shoulderFar: 170, elbowFar: -70, grip: 98, shoulderNear: 50, elbowNear: 50 },
          ],
          [
            0.4,
            {
              lean: 2,
              shoulderFar: 190,
              elbowFar: -90,
              grip: 100,
              shoulderNear: 46,
              elbowNear: 54,
            },
          ],
          [
            0.55,
            { lean: 18, shoulderFar: 118, elbowFar: -8, grip: 96, shoulderNear: 58, elbowNear: 40 },
          ],
          [
            0.7,
            {
              lean: 16,
              shoulderFar: 124,
              elbowFar: -14,
              grip: 97,
              shoulderNear: 56,
              elbowNear: 42,
            },
          ],
        ],
        t,
      );
    case 'cut':
      return keyframes(
        { ...rest, ...BRACED },
        [
          [
            0,
            { lean: 4, shoulderFar: 60, elbowFar: 40, grip: 120, shoulderNear: 55, elbowNear: 55 },
          ],
          [
            0.35,
            {
              lean: -2,
              shoulderFar: 200,
              elbowFar: 20,
              grip: 230,
              shoulderNear: 50,
              elbowNear: 60,
            },
          ],
          [
            0.5,
            {
              lean: 16,
              shoulderFar: 110,
              elbowFar: -10,
              grip: 110,
              shoulderNear: 60,
              elbowNear: 50,
            },
          ],
          [
            0.62,
            { lean: 18, shoulderFar: 70, elbowFar: 10, grip: 80, shoulderNear: 60, elbowNear: 50 },
          ],
        ],
        t,
      );
    case 'throw':
      return keyframes(
        { ...rest, ...BRACED },
        [
          [
            0,
            {
              lean: 4,
              shoulderFar: 150,
              elbowFar: 30,
              grip: 100,
              draw: 1,
              shoulderNear: 70,
              elbowNear: 30,
            },
          ],
          [
            0.4,
            {
              lean: -8,
              shoulderFar: 235,
              elbowFar: -30,
              grip: 80,
              draw: 1,
              shoulderNear: 95,
              elbowNear: 0,
            },
          ],
          [
            0.52,
            {
              lean: 18,
              shoulderFar: 130,
              elbowFar: -10,
              grip: 85,
              draw: 1,
              shoulderNear: 40,
              elbowNear: 50,
            },
          ],
          [
            0.56,
            {
              lean: 20,
              shoulderFar: 110,
              elbowFar: 0,
              grip: 85,
              draw: 0,
              shoulderNear: 34,
              elbowNear: 56,
            },
          ],
          [
            0.84,
            {
              lean: 6,
              shoulderFar: 40,
              elbowFar: 40,
              grip: 100,
              draw: 0,
              shoulderNear: 50,
              elbowNear: 50,
            },
          ],
          [
            0.88,
            {
              lean: 6,
              shoulderFar: 60,
              elbowFar: 60,
              grip: 110,
              draw: 1,
              shoulderNear: 50,
              elbowNear: 50,
            },
          ],
        ],
        t,
      );
    case 'loose':
      return keyframes(
        { ...rest, hipNear: 18, kneeNear: 6, hipFar: -14, kneeFar: 6 },
        [
          [
            0,
            {
              lean: -2,
              shoulderNear: 100,
              elbowNear: 0,
              shoulderFar: 100,
              elbowFar: 0,
              draw: 0.05,
              grip: 24,
            },
          ],
          [
            0.22,
            {
              lean: -3,
              shoulderNear: 101,
              elbowNear: 0,
              shoulderFar: 160,
              elbowFar: -80,
              draw: 0.4,
              grip: 25,
            },
          ],
          [
            0.5,
            {
              lean: -6,
              head: -4,
              shoulderNear: 102,
              elbowNear: 0,
              shoulderFar: 248,
              elbowFar: -150,
              draw: 1,
              grip: 26,
            },
          ],
          [
            0.62,
            {
              lean: -6,
              head: -4,
              shoulderNear: 102,
              elbowNear: 0,
              shoulderFar: 252,
              elbowFar: -154,
              draw: 1,
              grip: 26,
            },
          ],
          [
            0.66,
            {
              lean: -3,
              shoulderNear: 104,
              elbowNear: 0,
              shoulderFar: 262,
              elbowFar: -110,
              draw: 0,
              grip: 24,
            },
          ],
          [
            0.85,
            {
              lean: -2,
              shoulderNear: 100,
              elbowNear: 0,
              shoulderFar: 200,
              elbowFar: -150,
              draw: 0,
              grip: 22,
            },
          ],
        ],
        t,
      );
    case 'charge':
      return {
        ...rest,
        lean: 14,
        shoulderFar: 40,
        elbowFar: 50 + 6 * Math.sin(2 * Math.PI * t),
        grip: 98,
        flow: 0.9,
      };
    case 'lead':
      return {
        ...rest,
        shoulderFar: 150 + 12 * Math.sin(2 * Math.PI * t),
        elbowFar: -10,
        grip: 150 + 20 * Math.sin(2 * Math.PI * t),
        flow: 0.6,
      };
    case 'none':
      return rest;
  }
}

function horsePose(motion: Motion, t: number): HorsePose {
  switch (motion) {
    case 'stand':
      return {
        ...HORSE_STAND,
        neck: HORSE_STAND.neck + 6 * Math.sin(2 * Math.PI * t),
        tail: 6 * Math.sin(2 * Math.PI * t + 1),
      };
    case 'march':
      return walkPose(t);
    case 'fight':
    case 'run':
      return gallopPose(t);
    case 'fall': {
      // The horse goes down on its knees, then lies with its legs folded under it.
      const k = smooth(t);
      const knees = smooth(Math.min(1, t * 1.6));
      return {
        ...HORSE_STAND,
        pitch: -6 * Math.sin(Math.PI * t),
        foreNear: [4 - 64 * knees, 2 + 150 * knees],
        foreFar: [-3 - 58 * knees, 2 + 140 * knees],
        hindNear: [-8 + 78 * k, 22 + 110 * k],
        hindFar: [-14 + 72 * k, 24 + 104 * k],
        neck: 46 * k,
        tail: -10 * k,
      };
    }
  }
}

/** How far a fall has turned the whole figure towards the ground, in degrees. */
function fallTurn(motion: Motion, t: number, mounted: boolean): number {
  if (motion !== 'fall') return 0;
  return (
    -(mounted ? 0 : 84) *
    smooth(Math.min(1, Math.max(0, (t - (mounted ? 0.2 : 0.35)) / (mounted ? 0.8 : 0.65))))
  );
}

export interface PosedFigure {
  readonly ops: PaintOp[];
  /** Degrees to turn the whole picture about the feet, for a fall. */
  readonly turn: number;
}

/** The paint of one figure at time `t` of a motion, from 0 to 1. */
export function posedFigure(kind: FigureKind, motion: Motion, t: number): PosedFigure {
  const art = KINDS[kind];
  const man = footPose(art, motion, t);
  switch (art.mount.kind) {
    case 'foot':
      return { ops: footFigure(man, art.kit), turn: fallTurn(motion, t, false) };
    case 'horse': {
      const { coat, dress } = art.mount;
      const horse = horseFigure(horsePose(motion, t), coat, dress);
      const ops = [
        ...horse.ops,
        ...footFigure(seatedPose(man, motion, t), art.kit, {
          x: horse.seat.x,
          y: horse.seat.y + 3,
        }),
      ];
      return { ops, turn: fallTurn(motion, t, true) };
    }
    case 'elephant':
      return { ops: elephantOps(art, man, motion, t), turn: 0 };
    case 'chariot':
      return { ops: chariotOps(art.mount.team, art.kit, man, motion, t), turn: 0 };
  }
}

/** A rider's pose in the saddle: he leans into a charge and slumps over as his mount goes down. */
function seatedPose(rider: FootPose, motion: Motion, t: number): FootPose {
  const fallen = motion === 'fall' ? smooth(t) : 0;
  return {
    ...rider,
    ...SEATED,
    lean:
      (motion === 'fight' || motion === 'run' ? rider.lean + 8 : rider.lean) * (1 - fallen) +
      62 * fallen,
    head: rider.head * (1 - fallen) + 30 * fallen,
    shoulderNear: rider.shoulderNear * (1 - fallen) + 20 * fallen,
    shoulderFar: rider.shoulderFar * (1 - fallen) + 10 * fallen,
    grip: motion === 'fall' ? 168 - 70 * fallen : rider.grip,
    lift: 0,
  };
}

function elephantPose(motion: Motion, t: number): ElephantPose {
  const a = 2 * Math.PI * t;
  switch (motion) {
    case 'stand':
      return {
        ...ELEPHANT_STAND,
        head: 2 * Math.sin(a),
        trunk: 0.06 + 0.08 * Math.sin(a + 1),
        ears: 0.2 + 0.25 * Math.max(0, Math.sin(2 * a)),
        tail: 10 * Math.sin(a + 2),
      };
    case 'march':
      return elephantWalk(t);
    case 'run':
      return elephantWalk(t, 1.5, 1);
    case 'fight': {
      // It rears on its hind legs, trunk up, and stamps down on whatever stands before it.
      const up = Math.max(0, Math.sin(a)) ** 1.4;
      return {
        ...ELEPHANT_STAND,
        pitch: -12 * up,
        head: -14 * up + 4 * (1 - up),
        trunk: 0.15 + 0.8 * up,
        ears: 0.6 + 0.4 * up,
        tail: 20 + 10 * Math.sin(a),
        foreNear: [10 + 34 * up, 4 + 70 * up],
        foreFar: [4 + 26 * up, 4 + 60 * up],
        hindNear: [-4 + 14 * up, 6 + 4 * up],
        hindFar: [2 + 12 * up, 6 + 4 * up],
      };
    }
    case 'fall': {
      // It sinks on its knees and rolls forward onto its chest.
      const knees = smooth(Math.min(1, t * 1.5));
      const k = smooth(t);
      return {
        ...ELEPHANT_STAND,
        pitch: 8 * k,
        head: 2 * k,
        trunk: 0.05 + 0.35 * k,
        ears: 0.1,
        tail: -10 * k,
        foreNear: [4 - 70 * knees, 2 + 150 * knees],
        foreFar: [-2 - 64 * knees, 2 + 140 * knees],
        hindNear: [-4 + 76 * k, 6 + 120 * k],
        hindFar: [2 + 70 * k, 6 + 114 * k],
      };
    }
  }
}

const MAHOUT = kit({ helmet: 'bare', body: 'tunic' });

function elephantOps(art: KindArt, man: FootPose, motion: Motion, t: number): PaintOp[] {
  const frame = elephantFigure(elephantPose(motion, t));
  const fallen = motion === 'fall' ? smooth(t) : 0;
  const a = 2 * Math.PI * t;
  const fighting = motion === 'fight' ? Math.max(0, Math.sin(a)) : 0;
  const driver: FootPose = {
    ...REST,
    ...SEATED,
    lean: 10 + 20 * fighting + 50 * fallen,
    head: 30 * fallen,
    shoulderNear: 60,
    elbowNear: 30,
    shoulderFar: 70 + 80 * fighting,
    elbowFar: 20,
    flow: 0,
  };
  const rest = { ...REST, ...art.rest };
  const tower: FootPose =
    motion === 'fight'
      ? man
      : motion === 'run'
        ? { ...rest, lean: -4, head: -16, shoulderFar: rest.shoulderFar + 8 * Math.sin(a) }
        : motion === 'fall'
          ? { ...rest, lean: 50 * fallen, head: 20 * fallen, grip: 118 - 40 * fallen }
          : man;
  return [
    ...frame.below,
    ...footFigure(tower, art.kit, add(frame.tower, { x: 0, y: 18 * fallen }), 'none'),
    ...frame.wall,
    ...footFigure(driver, MAHOUT, add(frame.neck, { x: 0, y: 2 })),
    ...frame.above,
  ];
}

const DRIVER = kit({ helmet: 'bare', body: 'tunic' });

function chariotOps(
  team: readonly [Coat, Coat],
  archerKit: Kit,
  archer: FootPose,
  motion: Motion,
  t: number,
): PaintOp[] {
  const fallen = motion === 'fall' ? smooth(t) : 0;
  const speed = motion === 'march' ? 1 : motion === 'stand' ? 0 : 2;
  const gait = horsePose(motion, t);
  const offset = horsePose(motion, (t + 0.08) % 1);
  const driver: FootPose = {
    ...REST,
    lean: (motion === 'march' || motion === 'stand' ? 8 : 18) * (1 - fallen) + 40 * fallen,
    shoulderNear: 64,
    elbowNear: 16,
    shoulderFar: 58,
    elbowFar: 22,
    flow: 0,
  };
  return chariotFigure({
    team,
    horses: [gait, motion === 'fall' ? gait : offset],
    archer: { pose: { ...archer, lift: 0 }, kit: archerKit },
    driver: { pose: driver, kit: DRIVER },
    wheel: speed * 60 * t,
    sink: 30 * fallen,
  });
}

/** The army's standard on its own, its cloth stirring with `t`. */
export function standardArt(t: number): PaintOp[] {
  const ops: PaintOp[] = [];
  drawStandardPole(ops, { x: 0, y: -18 }, 180, t);
  return ops;
}

/** What a figure sends at the enemy in battle, if anything: arrows from a bow, javelins thrown. */
export function missileOf(kind: FigureKind): 'arrow' | 'javelin' | undefined {
  const { action } = KINDS[kind];
  return action === 'loose' ? 'arrow' : action === 'throw' ? 'javelin' : undefined;
}

export const MOUNTED: ReadonlySet<FigureKind> = new Set(
  (Object.keys(KINDS) as FigureKind[]).filter((kind) => KINDS[kind].mount.kind !== 'foot'),
);

/** How far a standing figure reaches to either side of its feet and above them, in men's heights. */
const REACH: Readonly<Record<Mount['kind'], { readonly half: number; readonly top: number }>> = {
  foot: { half: 0.2, top: 0.95 },
  horse: { half: 0.5, top: 1.35 },
  chariot: { half: 0.75, top: 1.3 },
  elephant: { half: 0.65, top: 1.95 },
};

export const reachOf = (kind: FigureKind) => REACH[KINDS[kind].mount.kind];
