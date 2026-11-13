import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { UNREST_DAYS } from '../src/sim/cities.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { parseMap, POWERS } from '../src/sim/map.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { newGame, STARTING_FORMATIONS } from '../src/sim/new-game.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { dailyBalances, menOf, UPKEEP_PER_MAN } from '../src/sim/systems/economy.ts';
import { tick } from '../src/sim/tick.ts';
import { TROOPS, type Troop } from '../src/sim/troops.ts';

const { values } = parseArgs({ options: { years: { type: 'string', default: '3' } } });
const YEARS = Number(values.years);
const SEED = 1;
const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);

const round = (n: number) => Math.round(n).toLocaleString('en-US');
const signed = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1);

function rows(state: GameState, label: string): string[][] {
  const balances = dailyBalances(state);
  return POWERS.map((power) => {
    const faction = power as FactionId;
    const stores = state.factions[faction]?.stores ?? { gold: 0, food: 0, manpower: 0 };
    const population = Object.values(state.cities)
      .filter((city) => city.owner === faction)
      .reduce((sum, city) => sum + city.population, 0);
    const men = Object.values(state.armies)
      .filter((army) => army.owner === faction)
      .reduce((sum, army) => sum + menOf(state, army), 0);
    const balance = balances.get(faction) ?? { gold: 0, food: 0, manpower: 0 };
    const spearmen = TROOPS.spearmen.recruit;
    const affordable = Math.min(stores.gold / spearmen.gold, stores.manpower / spearmen.men);
    return [
      label,
      power,
      round(population),
      round(stores.gold),
      round(stores.food),
      round(stores.manpower),
      round(men),
      signed(balance.gold),
      signed(balance.food),
      affordable.toFixed(1),
    ];
  });
}

function table(header: string[], body: string[][]): string {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i]?.length ?? 0)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(' | ')} |`;
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}

let state = newGame(map, { seed: SEED, player: 'rome' });
const body = rows(state, 'start');
for (let year = 1; year <= YEARS; year += 1) {
  for (let day = 0; day < 365; day += 1) state = tick(state, [], world).state;
  body.push(...rows(state, `year ${year}`));
}

console.log(
  table(
    [
      'when',
      'power',
      'population',
      'gold',
      'food',
      'manpower',
      'men',
      'gold/day',
      'food/day',
      'spearmen affordable',
    ],
    body,
  ),
);

const start = newGame(map, { seed: SEED, player: 'rome' });
const startBalances = dailyBalances(start);
const startingArmy = STARTING_FORMATIONS.reduce((sum, { men }) => sum + men, 0);
const armyUpkeep = startingArmy * UPKEEP_PER_MAN.gold;
console.log('');
for (const power of POWERS) {
  const net = startBalances.get(power as FactionId)?.gold ?? 0;
  console.log(
    `${power}: income keeps ${((net + armyUpkeep) / armyUpkeep).toFixed(2)} starting armies of ${startingArmy} men`,
  );
}
const minors = Object.values(start.factions).filter((f) => f.kind === 'minor');
const minorIncome = minors.map((f) => startBalances.get(f.id)?.gold ?? 0);
const perMinor = minorIncome.reduce((a, b) => a + b, 0) / minors.length;
console.log(
  `a minor state's income keeps ${Math.floor(perMinor / UPKEEP_PER_MAN.gold)} men (${minors.length} minors)`,
);
const days = (Object.keys(TROOPS) as Troop[]).map((t) => `${t} ${TROOPS[t].recruit.days}`);
console.log(`days to raise a formation: ${days.join(', ')}`);
console.log(`unrest lasts ${UNREST_DAYS} days`);
