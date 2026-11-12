import * as v from 'valibot';

/** The 32-bit state of a mulberry32 generator. */
export const RngStateSchema = v.pipe(
  v.number(),
  v.integer(),
  v.minValue(0),
  v.maxValue(0xffffffff),
);
export type RngState = v.InferOutput<typeof RngStateSchema>;

export function seedRng(seed: number): RngState {
  return seed >>> 0;
}

/** Draws a number in [0, 1) and advances the generator held in the state. */
export function nextRandom(state: { rng: RngState }): number {
  const next = (state.rng + 0x6d2b79f5) >>> 0;
  state.rng = next;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
}

/** Draws an integer in [min, max). */
export function nextInt(state: { rng: RngState }, min: number, max: number): number {
  return min + Math.floor(nextRandom(state) * (max - min));
}
