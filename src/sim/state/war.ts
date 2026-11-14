import * as v from 'valibot';
import { CityIdSchema, FactionIdSchema, type FactionId } from '../ids.ts';
import { DaySchema, type Day } from './day.ts';
import { PeaceOfferSchema } from './peace.ts';

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

/** What one side of a war has done to the other in it. */
export const WarSideSchema = v.object({
  /** The other side's cities this side has taken in the war and still holds, in the order taken. */
  taken: v.array(CityIdSchema),
  /** The men this side has lost in battles against the other. */
  lost: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** This side's latest offer, retained after a refusal or expiry, within this war only. */
  lastOffer: v.nullable(PeaceOfferSchema),
});
export type WarSide = v.InferOutput<typeof WarSideSchema>;

/** What a war remembers: when it began, who declared it, and what each side has taken and lost. */
export const WarSchema = v.object({
  since: DaySchema,
  declaredBy: FactionIdSchema,
  /** Keyed by the two factions of the war's key, and by no other. */
  sides: v.record(FactionIdSchema, WarSideSchema),
  /** The day either side last offered peace, or null, so an AI offers again only after a pause. */
  offeredOn: v.nullable(DaySchema),
});
export type War = v.InferOutput<typeof WarSchema>;

/** A war that the first faction declares on the second on the day. */
export function newWar(by: FactionId, against: FactionId, since: Day): War {
  return {
    since,
    declaredBy: by,
    sides: {
      [by]: { taken: [], lost: 0, lastOffer: null },
      [against]: { taken: [], lost: 0, lastOffer: null },
    },
    offeredOn: null,
  };
}

/** The key of the war between two different factions, whichever order they come in. */
export function warKey(a: FactionId, b: FactionId): WarKey {
  return JSON.stringify(a < b ? [a, b] : [b, a]) as WarKey;
}
