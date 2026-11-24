import { buildRefusal } from '../buildings/build.ts';
import {
  BUILDINGS,
  FIRST_LEVELS,
  GREAT_WORKS,
  hasBuilt,
  type GreatWork,
} from '../buildings/buildings.ts';
import type { CityId, FactionId } from '../ids.ts';
import type { World } from '../world/world.ts';
import { BUILD_PAYBACK_YEARS, buildingWorth, PROJECT_PAYBACK_YEARS } from './build.ts';
import { enemiesOf, sorted, type CityView, type State } from './situation.ts';
import { NOTICE_SHARE } from './thresholds.ts';
import { warReadiness } from './war.ts';

/** The great work a power saves for: the city, the work, and the gold it keeps aside. */
export interface Saving {
  readonly city: CityId;
  readonly work: GreatWork;
  readonly gold: number;
}

const savings = new WeakMap<State, Map<FactionId, Saving | undefined>>();

/**
 * The great work a great power saves for today, or undefined. It saves while it is at
 * peace, no great power stands on notice against it (at NOTICE_SHARE of the strength it
 * needs to declare war on it), it has no first level left that pays back within
 * BUILD_PAYBACK_YEARS, and one of its cities could start a great work, but for the gold,
 * that pays back within PROJECT_PAYBACK_YEARS: the soonest, ties to the lower city id. The
 * saving ends the day a war or a notice comes, as the day's facts no longer hold. Its
 * recruits, its other buildings, and its trade then leave the work's price untouched
 * above their reserve, until it orders the work.
 */
export function savingFor(state: State, world: World, faction: FactionId): Saving | undefined {
  let byFaction = savings.get(state);
  if (!byFaction) {
    byFaction = new Map();
    savings.set(state, byFaction);
  }
  if (byFaction.has(faction)) return byFaction.get(faction);
  const saving = findSaving(state, world, faction);
  byFaction.set(faction, saving);
  return saving;
}

function findSaving(state: State, world: World, faction: FactionId): Saving | undefined {
  const record = state.factions[faction];
  if (record?.kind !== 'greatPower' || record.defeatedOn !== null) return undefined;
  if (enemiesOf(state, faction).size > 0) return undefined;
  const rich = withGold(state, faction);
  const own = sorted(rich.cities).filter((city) => city.owner === faction);
  let best: { city: CityView; work: GreatWork; payback: number } | undefined;
  for (const city of own) {
    for (const work of GREAT_WORKS) {
      if (buildRefusal(rich, city, work)) continue;
      const payback = paybackYears(rich, city, work);
      if (payback <= PROJECT_PAYBACK_YEARS && (!best || payback < best.payback))
        best = { city, work, payback };
    }
  }
  if (!best) return undefined;
  const firstLeft = own.some((city) =>
    FIRST_LEVELS.some(
      (kind) =>
        !hasBuilt(city, kind) &&
        city.construction?.building !== kind &&
        city.population >= BUILDINGS[kind].needs.people &&
        paybackYears(rich, city, kind) <= BUILD_PAYBACK_YEARS,
    ),
  );
  if (firstLeft) return undefined;
  const onNotice = sorted(state.factions).some(
    (other) =>
      other.id !== faction &&
      other.kind === 'greatPower' &&
      other.defeatedOn === null &&
      (warReadiness(state, world, other.id, faction)?.readiness ?? 0) >= NOTICE_SHARE,
  );
  if (onNotice) return undefined;
  return { city: best.city.id, work: best.work, gold: BUILDINGS[best.work].gold };
}

function paybackYears(state: State, city: CityView, kind: keyof typeof BUILDINGS): number {
  const worth = buildingWorth(state, city, kind);
  return worth > 0 ? BUILDINGS[kind].gold / worth / 365 : Infinity;
}

/** The state with the faction's gold beyond any price, to ask what it could start but for the gold. */
function withGold(state: State, faction: FactionId): State {
  const record = state.factions[faction];
  if (!record) return state;
  return {
    ...state,
    factions: {
      ...state.factions,
      [faction]: { ...record, stores: { ...record.stores, gold: Number.MAX_SAFE_INTEGER } },
    },
  };
}
