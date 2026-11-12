import * as v from 'valibot';
import type { FactionId } from '../ids.ts';
import { DaySchema } from './day.ts';

/** The two factions a war key names, or nothing for a key that names no valid pair. */
export function warSides(key: string): [FactionId, FactionId] | undefined {
  let pair: unknown;
  try {
    pair = JSON.parse(key);
  } catch {
    return undefined;
  }
  if (!Array.isArray(pair) || pair.length !== 2) return undefined;
  const [a, b]: unknown[] = pair;
  if (typeof a !== 'string' || typeof b !== 'string' || !(a < b)) return undefined;
  return JSON.stringify([a, b]) === key ? [a as FactionId, b as FactionId] : undefined;
}

/**
 * Names the two factions of a war as a JSON pair in ascending order, so a pair has
 * one key whatever its ids hold, and a faction cannot be at war with itself.
 */
export const WarKeySchema = v.pipe(
  v.string(),
  v.check(
    (key) => warSides(key) !== undefined,
    'expected two different factions in ascending order',
  ),
  v.brand('WarKey'),
);
export type WarKey = v.InferOutput<typeof WarKeySchema>;

export const WarSchema = v.object({ since: DaySchema });
export type War = v.InferOutput<typeof WarSchema>;

/** The key of the war between two different factions, whichever order they come in. */
export function warKey(a: FactionId, b: FactionId): WarKey {
  return JSON.stringify(a < b ? [a, b] : [b, a]) as WarKey;
}
