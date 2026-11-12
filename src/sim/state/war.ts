import * as v from 'valibot';
import type { FactionId } from '../ids.ts';
import { DaySchema } from './day.ts';

const SEPARATOR = '|';

/** The two factions a war key names, or nothing for a key that names no valid pair. */
export function warSides(key: string): [FactionId, FactionId] | undefined {
  const parts = key.split(SEPARATOR);
  if (parts.length !== 2) return undefined;
  const [a, b] = parts as [FactionId, FactionId];
  return a !== '' && a < b ? [a, b] : undefined;
}

/**
 * Names the two factions of a war in ascending order, so a pair has one key and a
 * faction cannot be at war with itself.
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
  return (a < b ? `${a}${SEPARATOR}${b}` : `${b}${SEPARATOR}${a}`) as WarKey;
}
