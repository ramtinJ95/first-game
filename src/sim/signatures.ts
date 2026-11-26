import type { FactionId, ProvinceId } from './ids.ts';
import type { PowerId } from './map.ts';

/**
 * Each great power's standing bonus, read by the rule it changes. A great power's faction
 * id is its power id, so a conqueror of its cities never gains it.
 *
 * - Rome's armies re-form in `reformDays` after a change of stance.
 * - Carthage's guards cost `guardShare` of the price.
 * - Macedon's new armies get a general of `generalSkill`.
 * - Egypt's cities in the `nile` provinces grow `nileFoodShare` of the food per person.
 * - Persia governs `adminCities` cities before each yields less, and past them its share
 *   falls more steeply, so from `evenCities` its cities yield no more than another power's.
 */
export const BONUSES = {
  rome: { reformDays: 2 },
  carthage: { guardShare: 0.75 },
  macedon: { generalSkill: 5 },
  egypt: {
    nileFoodShare: 1.2,
    nile: ['alexandria', 'memphis', 'pelusium', 'thebai', 'syene'] as readonly string[],
  },
  persia: { adminCities: 10, evenCities: 16 },
} as const satisfies Record<PowerId, object>;

/** The power's bonus when the faction is that power, otherwise undefined. */
export function bonusOf<P extends PowerId>(
  faction: FactionId | undefined,
  power: P,
): (typeof BONUSES)[P] | undefined {
  return (faction as string | undefined) === power ? BONUSES[power] : undefined;
}

/** Whether the province lies along the Nile, where Egypt grows more food. */
export function alongTheNile(province: ProvinceId): boolean {
  return BONUSES.egypt.nile.includes(province);
}
