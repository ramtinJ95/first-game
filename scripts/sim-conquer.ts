import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll, decideOrders } from '../src/sim/ai/decide.ts';
import { byLand, enemiesOf, homeCapital, menUnderArms } from '../src/sim/ai/situation.ts';
import { FATE_DAYS } from '../src/sim/cities.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { SIEGE_DISTANCE } from '../src/sim/systems/sieges.ts';
import { tick } from '../src/sim/tick.ts';
import { TROOPS, type Troop } from '../src/sim/troops.ts';
import { distance } from '../src/sim/world/find-path.ts';
import { buildWorld } from '../src/sim/world/world.ts';

/**
 * A Rome that conquers by a plain rule, against every other faction under the AI. Each
 * day it is at war with no minor, it declares war on the nearest minor city its capital
 * reaches by land. Otherwise it gives the orders the faction AI gives it, except for the
 * fates: always occupy, always sack, or the AI's own mix, which sacks while gold is below
 * its reserve. Two more lines raise every formation they can afford at the capital, in a
 * round of troops, in place of the AI's budget, as a player who wants the largest army
 * does. A Rome that gives no orders is the realm that takes no city.
 */

const { values } = parseArgs({
  options: { seeds: { type: 'string', default: '20' }, years: { type: 'string', default: '3' } },
});
const SEEDS = Number(values.seeds);
const YEARS = Number(values.years);
const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
type Line =
  | 'gives no orders'
  | 'conquers, occupies'
  | 'conquers, sacks'
  | 'conquers, AI mix'
  | 'conquers, raises all it can, occupies'
  | 'conquers, raises all it can, sacks';
const LINES: readonly Line[] = [
  'gives no orders',
  'conquers, occupies',
  'conquers, sacks',
  'conquers, AI mix',
  'conquers, raises all it can, occupies',
  'conquers, raises all it can, sacks',
];
const ROUND: readonly Troop[] = ['spearmen', 'archers', 'swordsmen', 'lightCavalry'];

function romanOrders(state: GameState, line: Line): Order[] {
  if (line === 'gives no orders') return [];
  const orders = decideOrders(state, world, rome).filter(
    (order) => line === 'conquers, AI mix' || (order.kind !== 'sack' && order.kind !== 'enslave'),
  );
  if (line === 'conquers, sacks') {
    for (const city of Object.values(state.cities)) {
      if (city.owner !== rome || city.fellOn === null || state.day - city.fellOn > FATE_DAYS)
        continue;
      const present = Object.values(state.armies).some(
        (army) =>
          army.owner === rome &&
          army.activity.kind !== 'embarked' &&
          distance(army.activity.position, city.position) <= SIEGE_DISTANCE,
      );
      if (present) orders.push({ kind: 'sack', faction: rome, city: city.id });
    }
  }
  const enemies = enemiesOf(state, rome);
  const atWarWithMinor = [...enemies].some((id) => state.factions[id]?.kind === 'minor');
  const capital = homeCapital(state, world, rome);
  if (!atWarWithMinor && capital && !orders.some((order) => order.kind === 'declareWar')) {
    const [nearest] = Object.values(state.cities)
      .filter(
        (city) =>
          state.factions[city.owner]?.kind === 'minor' &&
          byLand(world, capital.position, city.position),
      )
      .sort(
        (a, b) => distance(capital.position, a.position) - distance(capital.position, b.position),
      );
    if (nearest) orders.push({ kind: 'declareWar', faction: rome, against: nearest.owner });
  }
  return orders;
}

interface YearEnd {
  alive: boolean;
  cities: number;
  gold: number;
  food: number;
  manpower: number;
  men: number;
  armies: number;
  shortDays: number;
}

function play(seed: number, line: Line): YearEnd[] {
  let state = newGame(map, { seed, player: 'rome' });
  const ends: YearEnd[] = [];
  let shortDays = 0;
  for (let day = 1; day <= YEARS * 365; day++) {
    const alive = state.factions[rome]?.defeatedOn === null;
    const orders = [...(alive ? romanOrders(state, line) : []), ...decideAll(state, world, [rome])];
    state = tick(state, orders, world).state;
    const stores = state.factions[rome]?.stores;
    if (stores && (stores.food < 0 || stores.gold < 0)) shortDays++;
    if (day % 365 === 0) {
      const own = Object.values(state.armies).filter((army) => army.owner === rome);
      ends.push({
        alive: state.factions[rome]?.defeatedOn === null,
        cities: Object.values(state.cities).filter((city) => city.owner === rome).length,
        gold: stores?.gold ?? 0,
        food: stores?.food ?? 0,
        manpower: stores?.manpower ?? 0,
        men: menUnderArms(state, rome),
        armies: own.length,
        shortDays,
      });
    }
  }
  return ends;
}

const median = (xs: number[]) =>
  [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)] ?? 0;
const whole = (n: number) => Math.round(n).toLocaleString('en-US');

console.log(
  `Rome against every other faction under the AI, seeds 1 to ${SEEDS}. Medians over the seeds at each year's end; "alive" counts seeds, "most cities" is the largest over the seeds, and "short" is days with gold or food below zero so far.\n`,
);
console.log(
  '| Rome | year | alive | cities, median | most cities | men under arms | men per army | gold / food / manpower | days short |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const line of LINES) {
  const games = Array.from({ length: SEEDS }, (_, i) => play(i + 1, line));
  for (let year = 0; year < YEARS; year++) {
    const ends = games.map((g) => g[year] as YearEnd);
    const living = ends.filter((e) => e.alive);
    const pick = (f: (e: YearEnd) => number) => whole(median(living.map(f)));
    console.log(
      `| ${line} | ${year + 1} | ${living.length}/${SEEDS} | ${pick((e) => e.cities)} | ${Math.max(...ends.map((e) => e.cities))} | ${pick((e) => e.men)} | ${pick((e) => (e.armies > 0 ? e.men / e.armies : 0))} | ${pick((e) => e.gold)} / ${pick((e) => e.food)} / ${pick((e) => e.manpower)} | ${pick((e) => e.shortDays)} |`,
    );
  }
}
