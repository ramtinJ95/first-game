import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../src/sim/ai/decide.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { parseMap, POWERS } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import type { PeaceTerms } from '../src/sim/state/peace.ts';
import { warSides } from '../src/sim/state/war.ts';
import { tick } from '../src/sim/tick.ts';
import { buildWorld } from '../src/sim/world/world.ts';

/**
 * Plays the new game with every faction under the AI and prints how wars end: how many
 * begin, how many end in peace and how many in a death, how long they run, how often a
 * pair goes back to war, what the peaces pay, and the days each great power spends at peace.
 */

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: '1' },
    seeds: { type: 'string', default: '20' },
    years: { type: 'string', default: '10' },
  },
});
const FROM = Number(values.from);
const SEEDS = Number(values.seeds);
const DAYS = Number(values.years) * 365;

const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);

type Ending = 'peace' | 'death' | 'running';
interface WarRun {
  key: string;
  greatPowers: boolean;
  from: number;
  to: number;
  ending: Ending;
  terms?: PeaceTerms['kind'] | 'cities';
}

interface Seed {
  wars: WarRun[];
  peaceDays: Record<string, number>;
  /** For each pair, the days from a peace to its next war. */
  gaps: number[];
}

function play(seed: number): Seed {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const isPower = (id: FactionId) => state.factions[id]?.kind === 'greatPower';
  const open = new Map<string, number>();
  const lastPeace = new Map<string, number>();
  const wars: WarRun[] = [];
  const gaps: number[] = [];
  const peaceDays: Record<string, number> = Object.fromEntries(POWERS.map((p) => [p, 0]));
  for (let day = 0; day < DAYS; day += 1) {
    const orders: Order[] = decideAll(state, world, []);
    const result = tick(state, orders, world);
    const peaces = new Map<string, PeaceTerms>();
    for (const event of result.events) {
      if (event.kind === 'peaceMade') {
        const [a, b] = event.between;
        peaces.set(JSON.stringify(a < b ? [a, b] : [b, a]), event.terms);
      }
    }
    for (const key of Object.keys(result.state.wars)) {
      if (open.has(key)) continue;
      open.set(key, result.state.day);
      const peace = lastPeace.get(key);
      if (peace !== undefined) gaps.push(result.state.day - peace);
    }
    for (const [key, from] of [...open]) {
      if (Object.hasOwn(result.state.wars, key)) continue;
      open.delete(key);
      const sides = warSides(key) ?? [];
      const terms = peaces.get(key);
      if (terms) lastPeace.set(key, result.state.day);
      wars.push({
        key,
        greatPowers: sides.every(isPower),
        from,
        to: result.state.day,
        ending: terms ? 'peace' : 'death',
        ...(terms && {
          terms: terms.kind === 'payment' && terms.cities.length > 0 ? 'cities' : terms.kind,
        }),
      });
    }
    state = result.state;
    for (const power of POWERS) {
      const id = power as FactionId;
      const fighting = Object.keys(state.wars).some((key) => warSides(key)?.includes(id));
      if (!fighting && state.factions[id]?.defeatedOn === null) {
        peaceDays[power] = (peaceDays[power] ?? 0) + 1;
      }
    }
  }
  for (const [key, from] of open) {
    const sides = warSides(key) ?? [];
    wars.push({ key, greatPowers: sides.every(isPower), from, to: state.day, ending: 'running' });
  }
  return { wars, peaceDays, gaps };
}

const median = (values: readonly number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.floor(sorted.length / 2)] as number);
};
const pad = (value: string | number, width: number) => String(value).padStart(width);

const seeds: Seed[] = [];
const started = performance.now();
for (let seed = FROM; seed < FROM + SEEDS; seed += 1) {
  const result = play(seed);
  seeds.push(result);
  const ended = result.wars.filter((war) => war.ending !== 'running');
  const peace = ended.filter((war) => war.ending === 'peace').length;
  console.log(
    `seed ${pad(seed, 2)}: ${pad(result.wars.length, 3)} wars, ${pad(peace, 3)} peace, ${pad(ended.length - peace, 3)} death, ${pad(result.wars.length - ended.length, 2)} running`,
  );
}

function summary(label: string, wars: readonly WarRun[]) {
  const ended = wars.filter((war) => war.ending !== 'running');
  const lengths = wars.map((war) => war.to - war.from);
  const peace = ended.filter((war) => war.ending === 'peace');
  const terms = (kind: WarRun['terms']) => peace.filter((war) => war.terms === kind).length;
  console.log(
    `| ${label} | ${wars.length} | ${peace.length} | ${ended.length - peace.length} | ${wars.length - ended.length} | ${median(lengths)} | ${Math.max(0, ...lengths)} | ${terms('asThingsStand')} / ${terms('payment')} / ${terms('cities')} |`,
  );
}

const all = seeds.flatMap((seed) => seed.wars);
console.log(
  `\nSeeds ${FROM} to ${FROM + SEEDS - 1}, ${DAYS / 365} years, every faction under the AI.\n`,
);
console.log(
  '| Wars | Begun | Ended in peace | Ended in a death | Still running | Median days | Longest days | Peace as things stand / gold / cities |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
summary('All', all);
summary(
  'Great power against great power',
  all.filter((war) => war.greatPowers),
);
summary(
  'With a minor',
  all.filter((war) => !war.greatPowers),
);

const fullLength = all.filter((war) => war.greatPowers && war.to - war.from >= DAYS - 30).length;
const gaps = seeds.flatMap((seed) => seed.gaps);
const perPair = new Map<string, number>();
for (const [index, seed] of seeds.entries()) {
  for (const war of seed.wars) {
    const pair = `${index} ${war.key}`;
    perPair.set(pair, (perPair.get(pair) ?? 0) + 1);
  }
}
console.log(`\nGreat-power pairs at war for all ${DAYS / 365} years: ${fullLength}`);
console.log(
  `Days from a peace to the same pair's next war: ${gaps.length} returns, shortest ${gaps.length ? Math.min(...gaps) : '-'}, median ${median(gaps)}`,
);
console.log(`Most wars between one pair in one seed: ${Math.max(0, ...perPair.values())}`);

console.log('\n| Power | Median days at peace | Fewest | Most |');
console.log('| --- | --- | --- | --- |');
for (const power of POWERS) {
  const days = seeds.map((seed) => seed.peaceDays[power] ?? 0);
  console.log(`| ${power} | ${median(days)} | ${Math.min(...days)} | ${Math.max(...days)} |`);
}
console.log(`\n${((performance.now() - started) / 1000).toFixed(0)} s`);
