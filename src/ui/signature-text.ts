import { whole } from '../app/names.ts';
import { BUILDINGS, SIGNATURE_BUILDINGS } from '../sim/buildings/buildings.ts';
import type { FactionId } from '../sim/ids.ts';
import { POWERS, type PowerId } from '../sim/map.ts';
import { STARTING_GENERAL_SKILL, startingSkillOf } from '../sim/new-game.ts';
import { BONUSES } from '../sim/signatures.ts';
import { ADMIN_CITIES, adminCitiesOf } from '../sim/systems/economy.ts';
import { GUARD_GOLD, guardGoldOf } from '../sim/guards.ts';
import { REFORM_DAYS, reformDaysOf } from '../sim/systems/battles.ts';

const as = (power: PowerId) => power as string as FactionId;

const BONUS_TEXT: Readonly<Record<PowerId, string>> = {
  rome: `Armies re-form in ${reformDaysOf(as('rome'))} days after a change of stance, not ${REFORM_DAYS}.`,
  carthage: `Guards cost ${whole(guardGoldOf(as('carthage')))} gold a band, not ${whole(GUARD_GOLD)}.`,
  macedon: `Every new army's general has skill ${startingSkillOf(as('macedon'))}, not ${STARTING_GENERAL_SKILL}.`,
  egypt: `Cities along the Nile grow ${Math.round((BONUSES.egypt.nileFoodShare - 1) * 100)}% more food.`,
  persia: `Satrapies: the cost of governing starts past ${adminCitiesOf(as('persia'))} cities, not ${ADMIN_CITIES}, and rises faster, to match any realm's at ${BONUSES.persia.evenCities}.`,
};

const BUILDING_TEXT: Readonly<Record<PowerId, string>> = {
  rome: `cities taken within ${BUILDINGS.colonia.reachKm} km start half the unrest, and its recruits train sooner`,
  carthage: `ships gather on a shore within ${BUILDINGS.cothon.reachKm} km in half the days, and convoys there sail half again as fast`,
  macedon: 'cavalry trains in half the days',
  egypt: `${BUILDINGS.greatGranary.storeDays} more days of the city's food in store, a quarter more harvest, and grain sold for more gold`,
  persia: 'armies march a quarter faster in its province',
};

/** The power's standing bonus in one line, as the start screen and the Overview say it. */
export function bonusText(faction: string): string | undefined {
  return (POWERS as readonly string[]).includes(faction)
    ? BONUS_TEXT[faction as PowerId]
    : undefined;
}

/** The power's own building and what it does, in one line. */
export function ownBuildingText(power: PowerId): string {
  return `${BUILDINGS[SIGNATURE_BUILDINGS[power]].name}: ${BUILDING_TEXT[power]}.`;
}
