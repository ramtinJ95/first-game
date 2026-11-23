import { expect, test } from 'vitest';
import { changeCityOwner } from '../cities.ts';
import { fixtureWorld } from '../fixture.ts';
import type { CityId, FactionId } from '../ids.ts';
import { newGame } from '../new-game.ts';
import type { Order } from '../orders/orders.ts';
import type { GameState } from '../state/game-state.ts';
import { tradeForecast, tradeProblem, type TradeMode } from '../trade/routes.ts';
import { bestTrade } from './trade.ts';

const world = fixtureWorld();
const faction = 'rome' as FactionId;

/** Exhaustive quoted offers, without the AI's cost or return upper-bound pruning. */
function quotedBest(state: GameState, reserve: number): Order | undefined {
  const cities = Object.values(state.cities).sort((a, b) => a.id.localeCompare(b.id));
  let best: { order: Order; worth: number; income: number } | undefined;
  for (const from of cities) {
    if (from.owner !== faction) continue;
    for (const to of cities) {
      for (const mode of ['land', 'sea'] as TradeMode[]) {
        if (tradeProblem(state, world, faction, from.id, to.id, mode)) continue;
        const quote = tradeForecast(state, world, from, to, mode);
        if (!quote) throw new Error('valid offer has no forecast');
        if ((state.factions[faction]?.stores.gold ?? 0) - quote.cost < reserve) continue;
        const income = quote.fromDaily + (to.owner === faction ? quote.toDaily : 0);
        const worth = Math.round((income / quote.cost) * 1000000) / 1000000;
        if (!best || worth > best.worth || (worth === best.worth && income > best.income))
          best = {
            order: { kind: 'openTrade', faction, from: from.id, to: to.id, mode },
            worth,
            income,
          };
      }
    }
  }
  return best?.order;
}

const cases = [1, 2, 3].flatMap((seed) =>
  [4, 12].flatMap((held) =>
    [851, 1702, 3404, 10000].flatMap((budget) =>
      [0, 1500].flatMap((reserve) =>
        [undefined, 'capua'].map((quarter) => ({ seed, held, budget, reserve, quarter })),
      ),
    ),
  ),
);

test.each(cases)(
  "best offer equals exhaustive quotes: seed $seed, $held cities, $budget budget, $reserve reserve, Merchants' quarter at $quarter",
  ({ seed, held, budget, reserve, quarter }) => {
    const state = newGame(world.map, { seed, player: 'rome' });
    for (const city of Object.values(state.cities)) {
      if (Object.values(state.cities).filter((c) => c.owner === faction).length >= held) break;
      if (city.owner !== faction) changeCityOwner(state, city.id, faction);
    }
    if (quarter) state.cities[quarter as CityId]?.buildings.push('merchantsQuarter');
    const payer = state.factions[faction];
    if (!payer) throw new Error('missing payer');
    payer.stores.gold = budget + reserve;
    const before = JSON.stringify(state);
    expect(bestTrade(state, world, faction, reserve)).toEqual(quotedBest(state, reserve));
    expect(JSON.stringify(state)).toBe(before);
  },
);
