import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../../src/sim/ai/decide.ts';
import { trainingDaysAt } from '../../src/sim/buildings/buildings.ts';
import type { CityId, FactionId } from '../../src/sim/ids.ts';
import { parseMap } from '../../src/sim/map.ts';
import { newGame } from '../../src/sim/new-game.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { dailyBalances } from '../../src/sim/systems/economy.ts';
import { tick } from '../../src/sim/tick.ts';
import { TROOPS } from '../../src/sim/troops.ts';
import { buildWorld } from '../../src/sim/world/world.ts';
import { recruitForecast } from '../../src/ui/recruit-forecast.ts';

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: '1' },
    seeds: { type: 'string', default: '20' },
    years: { type: 'string', default: '3' },
    log: { type: 'boolean', default: false },
    'raise-anyway': { type: 'boolean', default: false },
  },
});
const first = Number(values.from);
const last = first + Number(values.seeds) - 1;
const years = Number(values.years);
const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const roma = 'roma' as CityId;
const EVERY = 45;

console.log(
  `The tester's careful Rome, ${years} years, seeds ${first} to ${last}: no trade and no orders but this one. Every ${EVERY} days, when gold is at least 3,400, manpower at least 1,000 and gold income at least +8 a day, Rome raises Spearmen at Roma, and ${values['raise-anyway'] ? 'raises anyway at a warning' : 'cancels at any warning'}.\n`,
);
console.log(
  '| seed | regiments raised | warnings | first warning: day, stores last, holds from | last warning: day, stores last, holds from | Year 1, day 331: stores last, holds from | men under arms at the end | men lost to hunger |',
);
console.log('| ---: | ---: | ---: | --- | --- | --- | ---: | ---: |');
for (let seed = first; seed <= last; seed++) {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  let raised = 0;
  const warnings: { day: number; short: number; holds: string }[] = [];
  let hunger = 0;
  let day331 = '-';
  for (let day = 0; day < years * 365; day++) {
    const orders: Order[] = decideAll(state, world);
    if (state.day === 331) {
      const f = recruitForecast(state, [], world, 'spearmen', days(state));
      day331 = f.warning
        ? `${(f.short.food ?? f.short.gold ?? 1) - 1}, ${f.holdsAfter === undefined ? 'never' : `day ${331 + f.holdsAfter}`}`
        : 'no warning';
    }
    if (day % EVERY === 0) {
      const attempt = carefulRaise(state);
      if (attempt === 'warned') {
        const f = recruitForecast(state, [], world, 'spearmen', days(state));
        warnings.push({
          day: state.day,
          short: (f.short.food ?? f.short.gold ?? 1) - 1,
          holds: f.holdsAfter === undefined ? 'never' : `day ${state.day + f.holdsAfter}`,
        });
        if (values['raise-anyway']) {
          orders.push({ kind: 'recruit', faction: rome, city: roma, troop: 'spearmen' });
          raised++;
        }
        if (values.log) log(state, f);
      } else if (attempt) {
        orders.push(attempt);
        if (values.log) console.error(`raise ${state.day}`);
        raised++;
      }
    }
    const { state: next, events } = tick(state, orders, world);
    for (const e of events)
      if (
        e.kind === 'armyDeserted' &&
        e.owner === rome &&
        (next.factions[rome]?.stores.food ?? 0) < 0
      )
        hunger += e.men;
    state = next;
    if (state.factions[rome]?.defeatedOn !== null) break;
  }
  const men = Object.values(state.armies)
    .filter((a) => a.owner === rome)
    .reduce(
      (sum, a) => sum + a.formations.reduce((m, id) => m + (state.formations[id]?.men ?? 0), 0),
      0,
    );
  const [w0] = warnings;
  const wn = warnings.at(-1);
  console.log(
    `| ${seed} | ${raised} | ${warnings.length} | ${w0 ? `${w0.day}, ${w0.short}, ${w0.holds}` : '-'} | ${wn ? `${wn.day}, ${wn.short}, ${wn.holds}` : '-'} | ${day331} | ${men} | ${hunger} |`,
  );
}

function days(state: GameState): number {
  const city = state.cities[roma];
  return city ? trainingDaysAt(city, 'spearmen') : TROOPS.spearmen.recruit.days;
}

/** The tester's rule: raise only with the means and a gold income of +8 a day, and cancel at a warning. */
function carefulRaise(state: GameState): Order | 'warned' | undefined {
  const stores = state.factions[rome]?.stores;
  const city = state.cities[roma];
  const gold = dailyBalances(state).get(rome)?.gold ?? 0;
  if (!stores || !city || city.owner !== rome) return undefined;
  if (stores.gold < 3400 || stores.manpower < 1000 || gold < 8) return undefined;
  const forecast = recruitForecast(state, [], world, 'spearmen', days(state));
  if (forecast.warning) return 'warned';
  return { kind: 'recruit', faction: rome, city: roma, troop: 'spearmen' };
}

function log(state: GameState, f: ReturnType<typeof recruitForecast>) {
  const b = dailyBalances(state).get(rome);
  const s = state.factions[rome]?.stores;
  const people = Object.values(state.cities)
    .filter((c) => c.owner === rome)
    .reduce((sum, c) => sum + c.population, 0);
  console.error(
    JSON.stringify({
      day: state.day,
      food: Math.round(s?.food ?? 0),
      balanceFood: b?.food.toFixed(2),
      after: f.after.food.toFixed(2),
      short: f.short,
      lasts: f.lasts,
      holdsAfter: f.holdsAfter,
      people: Math.round(people),
      cities: Object.values(state.cities).filter((c) => c.owner === rome).length,
    }),
  );
}
