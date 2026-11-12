import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../src/sim/ai/decide.ts';
import { homeCapital, menUnderArms } from '../src/sim/ai/situation.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import { tick } from '../src/sim/tick.ts';
import { TROOPS, type Troop } from '../src/sim/troops.ts';
import { buildWorld } from '../src/sim/world/world.ts';

/**
 * Rome raises every troop it can afford at its capital and goes to no war, while every
 * other faction plays under the AI. It raises the troops in a fixed round, and on each
 * day the next troop waits it counts what it waits for: gold, manpower, or both.
 */

const { values } = parseArgs({
  options: { seeds: { type: 'string', default: '5' }, years: { type: 'string', default: '2' } },
});
const SEEDS = Number(values.seeds);
const DAYS = Number(values.years) * 365;
const rome = 'rome' as FactionId;
const ROUND: readonly Troop[] = [
  'spearmen',
  'archers',
  'swordsmen',
  'lightCavalry',
  'spearmen',
  'heavyCavalry',
  'skirmishers',
];

const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const whole = (n: number) => Math.round(n).toLocaleString('en-US');

const header = [
  'seed',
  'formations raised',
  'days waiting on gold',
  'on manpower',
  'on both',
  'days short of food',
  'men at the end',
  'gold / food / manpower at the end',
];
console.log(`Rome raises every troop it can afford for ${DAYS / 365} years.\n`);
console.log(`| ${header.join(' | ')} |`);
console.log(`| ${header.map(() => '---').join(' | ')} |`);
for (let seed = 1; seed <= SEEDS; seed++) {
  let state = newGame(map, { seed, player: 'rome' });
  const capital = homeCapital(state, world, rome);
  if (!capital) throw new Error('rome has no capital');
  let next = 0;
  const waits = { gold: 0, manpower: 0, both: 0 };
  let hungry = 0;
  for (let day = 1; day <= DAYS; day++) {
    const stores = state.factions[rome]?.stores ?? { gold: 0, food: 0, manpower: 0 };
    const troop = ROUND[next % ROUND.length] as Troop;
    const { gold, men } = TROOPS[troop].recruit;
    const orders: Order[] = [];
    const short = { gold: stores.gold < gold, manpower: stores.manpower < men };
    if (short.gold && short.manpower) waits.both++;
    else if (short.gold) waits.gold++;
    else if (short.manpower) waits.manpower++;
    else {
      orders.push({ kind: 'recruit', faction: rome, city: capital.id, troop });
      next++;
    }
    if (stores.food < 0) hungry++;
    state = tick(state, [...orders, ...decideAll(state, world, [rome])], world).state;
  }
  const stores = state.factions[rome]?.stores ?? { gold: 0, food: 0, manpower: 0 };
  console.log(
    `| ${[
      seed,
      next,
      waits.gold,
      waits.manpower,
      waits.both,
      hungry,
      whole(menUnderArms(state, rome)),
      `${whole(stores.gold)} / ${whole(stores.food)} / ${whole(stores.manpower)}`,
    ].join(' | ')} |`,
  );
}
