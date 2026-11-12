import type { DeepReadonly } from '../../sim/deep-readonly.ts';
import type { Formation } from '../../sim/state/formation.ts';
import { figuresFor } from './count.ts';
import { seeded } from './seed.ts';

/** How a formation's figures change over one day, from the day before to today. */
export interface FormationDay {
  /** Figures at the start of the day. */
  readonly before: number;
  /** Figures at its end. */
  readonly after: number;
  /** The slots whose figures fall, and when in the day, from 0 to 1. */
  readonly falls: readonly { readonly slot: number; readonly at: number }[];
  /**
   * Figures from the back that step into the place of one who fell, so the block that
   * ends the day is the block the next day begins with.
   */
  readonly steps: readonly { readonly from: number; readonly to: number; readonly at: number }[];
  /** When in the day the formation breaks and turns to run, if it breaks today. */
  readonly breaksAt: number | undefined;
  /** Broken all day, from the day before. */
  readonly broken: boolean;
}

/** Falls happen in the first part of the day, so each has time to end lying before the next day. */
const FALLS_BY = 0.6;
export const FALL_DAYS = 0.25;
/** Bodies fade over the last part of the day, since the next day no longer counts them. */
export const FADE_FROM = 0.86;
const STEP_DAYS = 0.25;

/**
 * Works out the falls and the rout of one formation from its record on two days. Its
 * slots run from the front rank back, so the falls land among the front `ranks` slots
 * still standing at the end of the day, and the figures at the back that the day no
 * longer counts step forward into those places. A formation missing today has lost
 * every man.
 */
export function formationDay(
  before: DeepReadonly<Formation> | undefined,
  after: DeepReadonly<Formation> | undefined,
  day: number,
  front: number,
): FormationDay {
  const id = (after ?? before)?.id ?? '';
  const start = figuresFor(before?.men ?? after?.men ?? 0);
  const end = figuresFor(after?.men ?? 0);
  const lost = Math.max(0, start - end);
  const key = `${id}:${day}`;
  const falls: { slot: number; at: number }[] = [];
  const steps: { from: number; to: number; at: number }[] = [];
  if (lost > 0 && lost <= end) {
    const pool = Array.from({ length: Math.min(end, Math.max(front, lost)) }, (_, i) => i);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(seeded(key, i) * (i + 1));
      [pool[i], pool[j]] = [pool[j] as number, pool[i] as number];
    }
    const chosen = pool.slice(0, lost).sort((a, b) => a - b);
    chosen.forEach((slot, i) => {
      const at = seeded(key, 100 + i) * FALLS_BY;
      falls.push({ slot, at });
      steps.push({ from: end + i, to: slot, at: Math.min(1 - STEP_DAYS, at + FALL_DAYS) });
    });
  } else if (lost > 0) {
    for (let slot = end; slot < start; slot++) {
      falls.push({ slot, at: seeded(key, 100 + slot) * FALLS_BY });
    }
  }
  const moraleBefore = before?.morale ?? after?.morale ?? 1;
  const moraleAfter = after?.morale ?? moraleBefore;
  const breaks = moraleBefore > 0 && moraleAfter === 0 && end > 0;
  return {
    before: start,
    after: end,
    falls,
    steps,
    breaksAt: breaks ? 0.2 + seeded(key, 999) * 0.5 : undefined,
    broken: moraleBefore === 0 && moraleAfter === 0,
  };
}

export { STEP_DAYS };
