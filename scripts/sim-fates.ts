import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { BUILDING_KINDS, type BuildingKind } from '../src/sim/buildings/buildings.ts';
import { changeCityOwner } from '../src/sim/cities.ts';
import type { CityId, FactionId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import { executeOrder } from '../src/sim/orders/orders.ts';
import type { Day } from '../src/sim/state/day.ts';
import type { Stores } from '../src/sim/state/faction.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { dailyBalances } from '../src/sim/systems/economy.ts';
import { tick } from '../src/sim/tick.ts';
import { buildWorld } from '../src/sim/world/world.ts';

/**
 * What a fallen city is worth to Rome under each fate. Rome takes Salona on day 1, at a
 * given size, and no faction gives orders. Each fate is played for five years, and once
 * more with the city lost to Macedon on day 90. A fate's worth is what Rome
 * earns, its daily balance summed plus what the fate gives at once, less what Rome earns
 * in the same game without the city. Stores are not read, because their limits clip them.
 * With `--buildings forum,temple`, Salona stands with those buildings when it falls.
 */

const { values } = parseArgs({ options: { buildings: { type: 'string', default: '' } } });
const BUILT = (values.buildings ? values.buildings.split(',') : []).map((kind) => {
  if (!(BUILDING_KINDS as readonly string[]).includes(kind)) throw new Error(`no building ${kind}`);
  return kind as BuildingKind;
});

const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const CITY = 'salona' as CityId;
const YEAR = 365;
const MARKS = [1, 2, 5].map((years) => years * YEAR);
const LOST_ON = 90;
const SIZES = [
  { name: 'small', population: 8_000 },
  { name: 'middle', population: 15_000 },
  { name: 'large', population: 30_000 },
] as const;
type Fate = 'occupy' | 'sack' | 'enslave';
const FATES: readonly Fate[] = ['occupy', 'sack', 'enslave'];

const ZERO: Stores = { gold: 0, food: 0, manpower: 0 };
const add = (a: Stores, b: Stores): Stores => ({
  gold: a.gold + b.gold,
  food: a.food + b.food,
  manpower: a.manpower + b.manpower,
});
const less = (a: Stores, b: Stores): Stores => ({
  gold: a.gold - b.gold,
  food: a.food - b.food,
  manpower: a.manpower - b.manpower,
});

/** Rome's earnings at each mark: its daily balance summed, plus what `start` gave at once. */
function earnings(population: number, start: (state: GameState) => void, lostOn?: number) {
  let state = newGame(map, { seed: 1, player: 'rome' });
  const city = state.cities[CITY];
  if (!city) throw new Error(`the map has no ${CITY}`);
  city.population = population;
  city.buildings = [...BUILT];
  start(state);
  let total: Stores = { ...ZERO };
  const marks: Stores[] = [];
  const daily: number[] = [];
  for (let day = 1; day <= 5 * YEAR; day++) {
    if (day === lostOn && state.cities[CITY]?.owner === rome) {
      changeCityOwner(state, CITY, 'macedon' as FactionId);
    }
    total = add(total, dailyBalances(state).get(rome) ?? ZERO);
    state = tick(state, [], world).state;
    daily.push(total.gold);
    if (MARKS.includes(day)) marks.push(total);
  }
  return Object.assign(marks, { daily });
}

function taken(fate: Fate) {
  return (state: GameState) => {
    changeCityOwner(state, CITY, rome);
    const city = state.cities[CITY];
    if (!city) return;
    city.fellOn = state.day as Day;
    const army = Object.values(state.armies).find((a) => a.owner === rome);
    if (army) army.activity = { kind: 'idle', position: { ...city.position } };
    const stores = state.factions[rome]?.stores;
    if (!stores || fate === 'occupy') return;
    const before = { ...stores };
    const refused = executeOrder(state, { kind: fate, faction: rome, city: CITY }, world);
    if (refused) throw new Error(refused.reason);
    lumps.set(fate, less(state.factions[rome]?.stores ?? before, before));
  };
}
const lumps = new Map<Fate, Stores>();

const whole = (n: number) => Math.round(n).toLocaleString('en-US');
const cell = (s: Stores) => `${whole(s.gold)} / ${whole(s.food)} / ${whole(s.manpower)}`;

console.log(
  `What Salona adds to Rome under each fate, gold / food / manpower, against a game in which Rome never took it. The city is taken on day 1${BUILT.length > 0 ? `, standing with ${BUILT.join(', ')}` : ''}, and "lost on day ${LOST_ON}" gives it to Macedon then.\n`,
);
console.log(
  '| size | fate | after 1 year | after 2 years | after 5 years | lost on day 90, after 5 years | out-earns sack in gold from day |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (const size of SIZES) {
  const none = earnings(size.population, () => undefined);
  lumps.delete('sack');
  const sacked = earnings(size.population, taken('sack'));
  const sackLump = lumps.get('sack')?.gold ?? 0;
  for (const fate of FATES) {
    lumps.delete(fate);
    const held = earnings(size.population, taken(fate));
    const lump = lumps.get(fate) ?? ZERO;
    const lost = earnings(size.population, taken(fate), LOST_ON);
    const worth = (marks: Stores[], at: number) =>
      add(less(marks[at] ?? ZERO, none[at] ?? ZERO), lump);
    const passes =
      fate === 'sack'
        ? ''
        : held.daily.findIndex(
            (gold, day) => gold + lump.gold >= (sacked.daily[day] ?? 0) + sackLump,
          ) + 1 || 'never';
    console.log(
      `| ${size.name} (${whole(size.population)}) | ${fate} | ${cell(worth(held, 0))} | ${cell(worth(held, 1))} | ${cell(worth(held, 2))} | ${cell(worth(lost, 2))} | ${passes} |`,
    );
  }
}
