import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId } from '../sim/ids.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { menOf } from '../sim/systems/economy.ts';
import { BLOCKADE_ODDS, WALL_WEAR_PER_THOUSAND_MEN } from '../sim/systems/sieges.ts';

/** A week's notice, before bare walls can surrender on any day. */
export const CITY_NOTICE_DAYS = 7;

export function cityDanger(game: DeepReadonly<GameState>, id: CityId): string | undefined {
  const city = game.cities[id];
  const siege = Object.values(game.sieges).find((s) => s.city === id);
  if (!city || !siege || city.owner !== game.player) return undefined;
  const men = siege.besiegers.reduce((sum, id) => {
    const army = game.armies[id];
    return sum + (army ? menOf(game, army) : 0);
  }, 0);
  if (men < BLOCKADE_ODDS * city.garrison) return undefined;
  if (city.foodDays <= CITY_NOTICE_DAYS) return `${Math.floor(city.foodDays)} days of food remain`;
  const wear = (men / 1000) * WALL_WEAR_PER_THOUSAND_MEN;
  if (wear > 0 && city.walls <= wear * CITY_NOTICE_DAYS) {
    return city.walls <= 0
      ? 'the walls are down; the garrison can surrender any day'
      : `the walls may collapse within ${Math.ceil(city.walls / wear)} days at this strength`;
  }
  return undefined;
}
