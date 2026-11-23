import { buildingWorth, paybackLimit } from '../sim/ai/build.ts';
import { buildRefusal } from '../sim/buildings/build.ts';
import { BUILDING_KINDS, BUILDINGS, type BuildingKind } from '../sim/buildings/buildings.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import type { Alert } from './alerts.ts';
import { whole } from './names.ts';

type State = DeepReadonly<GameState>;

/** The share of the treasury's limit at which the gold nears it. */
export const NEAR_LIMIT = 0.9;
/** The key the page keeps once the hint is told, so it is told once a game. */
export const BUILDING_HINT_KEY = 'buildingWorthGold';

/** The building that pays back soonest in a city of the player's that builds nothing, within the AI's years. */
export function worthBuilding(
  state: State,
): { city: DeepReadonly<City>; kind: BuildingKind; years: number } | undefined {
  let best: { city: DeepReadonly<City>; kind: BuildingKind; years: number } | undefined;
  const cities = Object.values(state.cities)
    .filter((city) => city.owner === state.player && !city.construction)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const city of cities) {
    for (const kind of BUILDING_KINDS) {
      if (buildRefusal(state, city, kind)) continue;
      const worth = buildingWorth(state, city, kind);
      if (worth <= 0) continue;
      const years = BUILDINGS[kind].gold / worth / 365;
      if (years <= paybackLimit(kind) && (!best || years < best.years))
        best = { city, kind, years };
    }
  }
  return best;
}

/**
 * Once a game, on the first day the player's gold nears its limit while one of the
 * player's cities builds nothing and could start a building that pays back within the
 * AI's years, a line naming the city, the building, and its payback. A click opens the
 * city. It does not stop the game. A player who saw nothing worth buying let the
 * treasury fill in the thirteenth play-through.
 */
export function buildingHintOfDay(before: State, after: State, told: ReadonlySet<string>): Alert[] {
  if (told.has(BUILDING_HINT_KEY)) return [];
  const gold = after.factions[after.player]?.stores.gold ?? 0;
  const limit = limitsOf(after).get(after.player)?.gold ?? Infinity;
  if (gold < NEAR_LIMIT * limit) return [];
  const found = worthBuilding(after);
  if (!found) return [];
  const { city, kind, years } = found;
  const { name, gold: price } = BUILDINGS[kind];
  return [
    {
      kind: 'buildingWorthGold',
      day: before.day,
      tone: 'neutral',
      text: `Your gold nears its limit and ${city.name} builds nothing: building ${name} there for ${whole(price)} gold would pay it back in ${years.toFixed(1)} years.`,
      focus: { at: city.position, select: { kind: 'province', province: city.province } },
    },
  ];
}
