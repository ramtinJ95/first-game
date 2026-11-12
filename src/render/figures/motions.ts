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
import { drawStandardPole, footFigure, type FootPose, type Kit } from './human.ts';
import type { PaintOp } from './paint.ts';

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

interface KindArt {
  readonly kit: Kit;
  readonly action: Action;
  readonly horse?: { readonly coat: Coat; readonly dress: Dress; readonly armoured: boolean };
  /** The pose at ease, which the other motions start from. */
  readonly rest: Partial<FootPose>;
}

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
    rest: { grip: 176, shoulderFar: 14, elbowFar: 36 },
  },
  swordsmen: {
    kit: kit({ helmet: 'montefortino', body: 'mail', shield: 'oval', weapon: 'sword' }),
    action: 'cut',
    rest: { grip: 140, shoulderFar: 8, elbowFar: 50 },
  },
  skirmishers: {
    kit: kit({ helmet: 'bare', body: 'tunic', shield: 'pelta', weapon: 'javelin', spares: true }),
    action: 'throw',
    rest: { grip: 160, shoulderFar: 18, elbowFar: 60 },
  },
  archers: {
    kit: kit({ helmet: 'cap', body: 'tunicLong', weapon: 'bow', quiver: true }),
    action: 'loose',
    rest: { shoulderNear: 18, elbowNear: 10, grip: 14, draw: 0 },
  },
  lightCavalry: {
    kit: kit({ helmet: 'bare', body: 'tunic', shield: 'round', weapon: 'javelin', cloak: true }),
    action: 'throw',
    horse: { coat: 'dun', dress: 'saddleCloth', armoured: false },
    rest: { ...SEATED, grip: 150, shoulderFar: 30, elbowFar: 50, shoulderNear: 30, elbowNear: 60 },
  },
  heavyCavalry: {
    kit: kit({ helmet: 'attic', body: 'muscle', weapon: 'lance', cloak: true }),
    action: 'charge',
    horse: { coat: 'bay', dress: 'barding', armoured: true },
    rest: { ...SEATED, grip: 168, shoulderFar: 20, elbowFar: 50, shoulderNear: 40, elbowNear: 50 },
  },
  general: {
    kit: kit({ helmet: 'plumed', body: 'muscle', weapon: 'swordRaised', cloak: true }),
    action: 'lead',
    horse: { coat: 'grey', dress: 'saddleCloth', armoured: false },
    rest: { ...SEATED, grip: 130, shoulderFar: 40, elbowFar: 40, shoulderNear: 40, elbowNear: 50 },
  },
  bearer: {
    kit: kit({ helmet: 'attic', body: 'muscle', weapon: 'standard', cloak: true }),
    action: 'none',
    rest: { grip: 178, shoulderFar: 26, elbowFar: 70, shoulderNear: 14, elbowNear: 30 },
  },
  refugee: {
    kit: kit({ helmet: 'bare', body: 'tunicLong', weapon: 'none', cloak: true }),
    action: 'none',
    rest: { shoulderNear: 10, elbowNear: 50, shoulderFar: 12, elbowFar: 30, flow: 0 },
  },
  refugeeWoman: {
    kit: kit({ helmet: 'cap', body: 'tunicLong', weapon: 'none', cloak: true }),
    action: 'none',
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
  const rider = footPose(art, motion, t);
  if (!art.horse) return { ops: footFigure(rider, art.kit), turn: fallTurn(motion, t, false) };
  const { coat, dress, armoured } = art.horse;
  const horse = horseFigure(horsePose(motion, t), coat, dress, armoured);
  const fallen = motion === 'fall' ? smooth(t) : 0;
  const seated = {
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
  const ops = [
    ...horse.ops,
    ...footFigure(seated, art.kit, { x: horse.seat.x, y: horse.seat.y + 3 }),
  ];
  return { ops, turn: fallTurn(motion, t, true) };
}

/** The army's standard on its own, its cloth stirring with `t`. */
export function standardArt(t: number): PaintOp[] {
  const ops: PaintOp[] = [];
  drawStandardPole(ops, { x: 0, y: -18 }, 180, t);
  return ops;
}

export const MOUNTED: ReadonlySet<FigureKind> = new Set(
  (Object.keys(KINDS) as FigureKind[]).filter((kind) => KINDS[kind].horse),
);
