import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { retreats, storms, type Context } from '../src/sim/ai/armies.ts';
import { decideAll } from '../src/sim/ai/decide.ts';
import { createRouter } from '../src/sim/ai/routes.ts';
import { byLand, enemiesOf, homeCapital, menUnderArms } from '../src/sim/ai/situation.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import type { City } from '../src/sim/state/city.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { CITY_DEFENCES, RECOVERY_DAYS } from '../src/sim/systems/sieges.ts';
import { tick } from '../src/sim/tick.ts';
import { distance } from '../src/sim/world/find-path.ts';
import { buildWorld } from '../src/sim/world/world.ts';

/**
 * The scripted Roman opening. On day 1 Rome declares war on the nearest independent city
 * its capital reaches by land and marches its starting army there. After that it gives
 * only the orders the faction AI would give that army in the siege: storm when the AI's
 * storm rule says so, and retreat from a battle it is losing. It recruits nothing and
 * occupies the city. Every other faction plays under the AI.
 */

const { values } = parseArgs({ options: { seeds: { type: 'string', default: '5' } } });
const SEEDS = Number(values.seeds);
const YEAR = 365;
const rome = 'rome' as FactionId;

const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);

function target(state: GameState): City {
  const capital = homeCapital(state, world, rome);
  if (!capital) throw new Error('rome has no capital');
  const [nearest] = Object.values(state.cities)
    .filter(
      (city) =>
        state.factions[city.owner]?.kind === 'minor' &&
        byLand(world, capital.position, city.position),
    )
    .sort(
      (a, b) => distance(capital.position, a.position) - distance(capital.position, b.position),
    );
  if (!nearest) throw new Error('rome reaches no minor city by land');
  return nearest;
}

function romanOrders(state: GameState): Order[] {
  const context: Context = {
    state,
    world,
    faction: rome,
    enemies: enemiesOf(state, rome),
    router: createRouter(state, world, rome),
  };
  return [...retreats(context), ...storms(context)];
}

const rows: string[][] = [];
for (let seed = 1; seed <= SEEDS; seed++) {
  let state = newGame(map, { seed, player: 'rome' });
  const city = target(state);
  const [army] = Object.values(state.armies).filter((a) => a.owner === rome);
  if (!army) throw new Error('rome has no starting army');
  const startMen = menUnderArms(state, rome);
  let orders: Order[] = [
    { kind: 'declareWar', faction: rome, against: city.owner },
    { kind: 'moveArmy', faction: rome, army: army.id, to: city.position },
  ];
  let fell: { day: number; how: string; men: number } | undefined;
  let sieged: number | undefined;
  let stormed = 0;
  for (let day = 1; day <= YEAR; day++) {
    const before = state;
    const all = [...orders, ...decideAll(state, world, [rome])];
    stormed += orders.filter((o) => o.kind === 'storm').length;
    state = tick(state, all, world).state;
    if (sieged === undefined && Object.values(state.sieges).some((s) => s.city === city.id)) {
      sieged = before.day;
    }
    const owner = state.cities[city.id]?.owner;
    if (!fell && owner !== city.owner) {
      const how =
        owner !== rome
          ? `to ${owner}`
          : orders.some((o) => o.kind === 'storm')
            ? 'storm'
            : (state.cities[city.id]?.walls ?? 0) >
                CITY_DEFENCES[city.rank].walls / RECOVERY_DAYS + 1e-9
              ? 'siege'
              : 'surrender';
      fell = { day: before.day, how, men: startMen - menUnderArms(state, rome) };
    }
    orders = state.factions[rome]?.defeatedOn === null ? romanOrders(state) : [];
  }
  const stores = state.factions[rome]?.stores ?? { gold: 0, food: 0, manpower: 0 };
  const cities = Object.values(state.cities).filter((c) => c.owner === rome).length;
  const whole = (n: number) => Math.round(n).toLocaleString('en-US');
  rows.push([
    String(seed),
    city.name,
    sieged === undefined ? 'never' : String(sieged),
    fell ? `${fell.day} by ${fell.how}` : 'held',
    String(stormed),
    fell ? `${whole(fell.men)} of ${whole(startMen)}` : '–',
    whole(menUnderArms(state, rome)),
    `${whole(stores.gold)} / ${whole(stores.food)} / ${whole(stores.manpower)}`,
    String(cities),
  ]);
}

const header = [
  'seed',
  'target',
  'siege from day',
  'fell on day',
  'storms ordered',
  'Roman men lost by the fall',
  'Roman men at day 365',
  'gold / food / manpower at day 365',
  'Roman cities',
];
console.log(`| ${header.join(' | ')} |`);
console.log(`| ${header.map(() => '---').join(' | ')} |`);
for (const row of rows) console.log(`| ${row.join(' | ')} |`);
