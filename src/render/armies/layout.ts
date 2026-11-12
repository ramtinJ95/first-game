import type { Troop } from '../../sim/troops.ts';
import { TROOPS } from '../../sim/troops.ts';
import type { Stance } from '../../sim/state/army.ts';
import { seeded } from './seed.ts';

/**
 * A place in a formation, in figure heights on the ground: `along` the way the army
 * faces, and `across` to its right. Slot 0 is the front rank's first file.
 */
export interface Place {
  readonly along: number;
  readonly across: number;
}

export interface Block {
  readonly places: readonly Place[];
  /** Files in the front rank: the figures that meet the enemy. */
  readonly files: number;
  readonly width: number;
  readonly depth: number;
}

export type Order = 'line' | 'column';

const SPACING: Record<
  'infantry' | 'missile' | 'cavalry',
  { file: number; rank: number; jitter: number }
> = {
  infantry: { file: 0.44, rank: 0.34, jitter: 0.03 },
  missile: { file: 0.55, rank: 0.46, jitter: 0.1 },
  cavalry: { file: 0.62, rank: 0.64, jitter: 0.05 },
};

/** How a stance opens or closes the files, and how far apart the two lines stand. */
export const STANCE_LOOK: Record<Stance, { spread: number; gap: number }> = {
  holdTheLine: { spread: 0.9, gap: 0.3 },
  allOutAssault: { spread: 1, gap: 0.08 },
  skirmishAndWithdraw: { spread: 1.45, gap: 0.9 },
};

/** Files in a block of each kind of troop. */
const FILES = { infantry: 4, missile: 3, cavalry: 3 } as const;

/**
 * The places of `count` figures of a troop in ranks, a few files deep and as many ranks
 * long as the men need. Figures are drawn in profile, so the files run up the screen
 * when the army faces left or right, and a block wider than it is deep would stack its
 * men into a tower. A column on the road closes its ranks. Each figure stands a seeded
 * step off its mark, so the ranks are never ruled lines.
 */
const made = new Map<string, Block>();

export function block(troop: Troop, count: number, order: Order, key: string, spread = 1): Block {
  const id = `${troop}|${count}|${order}|${key}|${spread}`;
  const found = made.get(id);
  if (found) return found;
  if (made.size > 20_000) made.clear();
  const result = makeBlock(troop, count, order, key, spread);
  made.set(id, result);
  return result;
}

function makeBlock(troop: Troop, count: number, order: Order, key: string, spread: number): Block {
  const category = TROOPS[troop].category;
  const spacing = SPACING[category];
  const files = Math.max(1, Math.min(count, FILES[category]));
  const file = spacing.file * spread;
  const rank = spacing.rank * (order === 'column' ? 0.85 : 1) * Math.sqrt(spread);
  const places: Place[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / files);
    const f = i % files;
    const inRank = Math.min(files, count - r * files);
    const offset = ((files - inRank) * file) / 2 + (r % 2 ? file * 0.25 : 0);
    const jitter = spacing.jitter * spread;
    places.push({
      along: -r * rank + (seeded(key, i * 2) - 0.5) * 2 * jitter,
      across:
        offset + f * file - ((files - 1) * file) / 2 + (seeded(key, i * 2 + 1) - 0.5) * 2 * jitter,
    });
  }
  const ranks = Math.ceil(count / files);
  return { places, files, width: (files - 1) * file + 0.3, depth: (ranks - 1) * rank + 0.3 };
}

export interface Placed {
  readonly troop: Troop;
  readonly block: Block;
  /** Where the block's front centre stands, in figure heights from the army's mark. */
  readonly at: Place;
}

const GAP = 0.3;
/** Between two lanes at rest, room for a man's height, since the files run up the screen. */
const LANE_GAP = 1.5;
/** Between two blocks of a battle line, for the same reason. */
const LINE_GAP = 1.2;

/**
 * An army drawn up for battle or standing at ease: the foot in the centre, the horse on
 * the wings, the archers and skirmishers in a second line behind the foot.
 */
/**
 * An army at rest: its formations in two lanes, one block behind another, behind the
 * standard and the general.
 */
export function parade(formations: readonly { troop: Troop; block: Block }[]): Placed[] {
  const lanes = [0, 0];
  const placed: Placed[] = [];
  const widest = Math.max(0, ...formations.map((f) => f.block.width));
  for (const [i, f] of formations.entries()) {
    const lane = formations.length === 1 ? -1 : i % 2;
    const across = lane < 0 ? 0 : (lane === 0 ? -1 : 1) * (widest / 2 + LANE_GAP / 2);
    const index = Math.max(0, lane);
    placed.push({ ...f, at: { along: -(lanes[index] ?? 0), across } });
    lanes[index] = (lanes[index] ?? 0) + f.block.depth + GAP;
  }
  return placed;
}

export function lineUp(formations: readonly { troop: Troop; block: Block }[]): Placed[] {
  const melee = formations.filter((f) => TROOPS[f.troop].category === 'infantry');
  const horse = formations.filter((f) => TROOPS[f.troop].category === 'cavalry');
  const missile = formations.filter((f) => TROOPS[f.troop].category === 'missile');
  const left = horse.filter((_, i) => i % 2 === 1);
  const right = horse.filter((_, i) => i % 2 === 0);
  const front = [...left, ...melee, ...right];
  const placed: Placed[] = [];
  const width = (row: readonly { block: Block }[], gap = GAP) =>
    row.reduce((sum, f) => sum + f.block.width, 0) + gap * Math.max(0, row.length - 1);
  let across = -width(front, LINE_GAP) / 2;
  for (const f of front) {
    placed.push({ ...f, at: { along: 0, across: across + f.block.width / 2 } });
    across += f.block.width + LINE_GAP;
  }
  const behind = Math.max(0, ...melee.map((f) => f.block.depth)) + 0.45;
  across = -width(missile) / 2;
  for (const f of missile) {
    placed.push({ ...f, at: { along: -behind, across: across + f.block.width / 2 } });
    across += f.block.width + GAP;
  }
  return placed;
}

/** An army on the road: each formation in column behind the one before it. */
export function column(
  formations: readonly { troop: Troop; block: Block }[],
  start: number,
): Placed[] {
  const placed: Placed[] = [];
  let along = -start;
  for (const f of formations) {
    placed.push({ ...f, at: { along, across: 0 } });
    along -= f.block.depth + GAP;
  }
  return placed;
}

/** How far a line reaches across, and its depth from the front, in figure heights. */
export function extent(placed: readonly Placed[]): { width: number; depth: number } {
  let left = 0;
  let right = 0;
  let depth = 0;
  for (const p of placed) {
    left = Math.min(left, p.at.across - p.block.width / 2);
    right = Math.max(right, p.at.across + p.block.width / 2);
    depth = Math.max(depth, -p.at.along + p.block.depth);
  }
  return { width: right - left, depth };
}
