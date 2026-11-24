import { buildRefusal } from '../buildings/build.ts';
import {
  BUILDING_KINDS,
  BUILDINGS,
  FIRST_LEVELS,
  type BuildingKind,
} from '../buildings/buildings.ts';
import type { CityId, FactionId } from '../ids.ts';
import type { World } from '../world/world.ts';
import { buildingWorth, paybackLimit } from './build.ts';
import {
  balanceOf,
  enemiesOf,
  menInTraining,
  menUnderArms,
  reserveOf,
  sorted,
  type CityView,
  type State,
} from './situation.ts';
import { NOTICE_SHARE } from './thresholds.ts';
import { limitsOf } from '../systems/economy.ts';

/** A power saves only while its men under arms and in training are at least this share of the men its people can field. */
export const SAVE_MEN_SHARE = 0.5;
import { warReadiness } from './war.ts';

/** The building a power saves for: the city, the building, and the gold it keeps aside. */
export interface Saving {
  readonly city: CityId;
  readonly building: BuildingKind;
  readonly gold: number;
}

const savings = new WeakMap<State, Map<FactionId, Saving | undefined>>();

/**
 * The building a great power saves for today, or undefined. It saves while it is at war
 * with no great power and no great power stands on notice against it (at NOTICE_SHARE of
 * the strength it needs to declare war on it), and while its building rule could order a
 * building: its gold and food balances not falling, its food above its reserve. It saves for the building its building
 * rule would order if the gold were there: of those its cities could start but for the
 * gold, a first level before a second level or a great work, then the one that pays back
 * soonest within its years (`paybackLimit`), ties to the lower city id and the table's
 * order. The saving ends the day a war with a great power or a notice comes, as the
 * day's facts no longer hold. Its recruits, its other buildings, and its trade then leave
 * that price untouched above their reserve, until it orders the building.
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

/**
 * Has the faction save for nothing on this state, so a measuring script can play the rule
 * for every other power and compare. Only that state's own decisions see it.
 */
export function forgoSaving(state: State, faction: FactionId): void {
  let byFaction = savings.get(state);
  if (!byFaction) {
    byFaction = new Map();
    savings.set(state, byFaction);
  }
  byFaction.set(faction, undefined);
}

function findSaving(state: State, world: World, faction: FactionId): Saving | undefined {
  const record = state.factions[faction];
  if (record?.kind !== 'greatPower' || record.defeatedOn !== null) return undefined;
  for (const enemy of enemiesOf(state, faction))
    if (state.factions[enemy]?.kind === 'greatPower') return undefined;
  const balance = balanceOf(state, faction);
  if (!balance || balance.gold < 0 || balance.food < 0) return undefined;
  const men = menUnderArms(state, faction) + menInTraining(state, faction);
  const field = men + Math.max(0, limitsOf(state).get(faction)?.manpower ?? 0);
  if (men < SAVE_MEN_SHARE * field) return undefined;
  if (record.stores.food < reserveOf(state, faction, 'food')) return undefined;
  const rich = withGold(state, faction);
  let best: { city: CityView; building: BuildingKind; payback: number; first: boolean } | undefined;
  for (const city of sorted(rich.cities)) {
    if (city.owner !== faction) continue;
    for (const building of BUILDING_KINDS) {
      if (buildRefusal(rich, city, building)) continue;
      const worth = buildingWorth(rich, city, building);
      if (worth <= 0) continue;
      const payback = BUILDINGS[building].gold / worth / 365;
      if (payback > paybackLimit(building)) continue;
      const first = (FIRST_LEVELS as readonly BuildingKind[]).includes(building);
      if (!best || (first && !best.first) || (first === best.first && payback < best.payback))
        best = { city, building, payback, first };
    }
  }
  if (!best) return undefined;
  const onNotice = sorted(state.factions).some(
    (other) =>
      other.id !== faction &&
      other.kind === 'greatPower' &&
      other.defeatedOn === null &&
      (warReadiness(state, world, other.id, faction)?.readiness ?? 0) >= NOTICE_SHARE,
  );
  if (onNotice) return undefined;
  return { city: best.city.id, building: best.building, gold: BUILDINGS[best.building].gold };
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
