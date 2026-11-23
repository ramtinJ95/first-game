import { parseArgs } from 'node:util';
import { buildingWorth } from '../../src/sim/ai/build.ts';
import { reserveOf, sorted } from '../../src/sim/ai/situation.ts';
import { buildRefusal } from '../../src/sim/buildings/build.ts';
import { BUILDING_KINDS, BUILDINGS, type BuildingKind } from '../../src/sim/buildings/buildings.ts';
import type { CityId } from '../../src/sim/ids.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { dailyBalances, limitsOf } from '../../src/sim/systems/economy.ts';
import { playCautiousRome, rome } from '../cautious-rome.ts';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    json: { type: 'boolean', default: false },
    builder: { type: 'string', default: 'panel' },
    recruits: { type: 'string', default: 'answer' },
    'no-answer': { type: 'boolean', default: false },
  },
});

/** A building the panel's player would still buy: one that repays its gold within this many years. */
const PANEL_PAYBACK_YEARS = 10;

/**
 * The player who builds as the panel suggests: in each of Rome's cities with nothing at
 * work, the building that repays soonest by the panel's payback, while the gold after it
 * stays above the AI's reserve for Rome's men.
 */
function panelBuilds(state: GameState): Order[] {
  let gold = (state.factions[rome]?.stores.gold ?? 0) - reserveOf(state, rome, 'gold');
  const orders: Order[] = [];
  for (const city of sorted(state.cities)) {
    if (city.owner !== rome || city.construction) continue;
    let best: { kind: BuildingKind; payback: number } | undefined;
    for (const kind of BUILDING_KINDS) {
      if (BUILDINGS[kind].gold > gold || buildRefusal(state, city, kind)) continue;
      const worth = buildingWorth(state, city, kind);
      const payback = worth > 0 ? BUILDINGS[kind].gold / worth / 365 : Infinity;
      if (payback <= PANEL_PAYBACK_YEARS && (!best || payback < best.payback))
        best = { kind, payback };
    }
    if (!best) continue;
    gold -= BUILDINGS[best.kind].gold;
    orders.push({ kind: 'build', faction: rome, city: city.id, building: best.kind });
  }
  return orders;
}

/** One year of a peaceful Rome that answers its warnings and builds by the AI's rule. */
interface Year {
  /** Days the gold stood at the treasury limit. */
  capDays: number;
  /** Days on which none of Rome's cities had a building at work. */
  idleDays: number;
  /** Gold the treasury limit took from Rome: income on days at the limit. */
  goldLost: number;
  goldSpentOnBuildings: number;
  goldAtEnd: number;
  limitAtEnd: number;
  cities: number;
}

interface Game {
  seed: number;
  years: Year[];
  /** The day each of Rome's starting cities stood with all five buildings, or null. */
  allFive: Record<string, number | null>;
  /** The last day each of Rome's starting cities started a building: after it, nothing it held was worth ordering. */
  lastBuild: Record<string, number | null>;
}

const yearOf = (): Year => ({
  capDays: 0,
  idleDays: 0,
  goldLost: 0,
  goldSpentOnBuildings: 0,
  goldAtEnd: 0,
  limitAtEnd: 0,
  cities: 0,
});

function play(seed: number, years: number): Game {
  const game: Game = {
    seed,
    years: Array.from({ length: years }, yearOf),
    allFive: {},
    lastBuild: {},
  };
  let starting: CityId[] | undefined;
  playCautiousRome(
    seed,
    years,
    ({ before, after, accepted }) => {
      starting ??= Object.values(before.cities)
        .filter((c) => c.owner === rome)
        .map((c) => c.id);
      for (const id of starting) {
        game.allFive[id] ??= null;
        game.lastBuild[id] ??= null;
      }
      const year = game.years[Math.floor(before.day / 365)];
      if (!year) return;
      const owned = (s: GameState) => Object.values(s.cities).filter((c) => c.owner === rome);
      const gold = before.factions[rome]?.stores.gold ?? 0;
      const limit = limitsOf(before).get(rome)?.gold ?? Infinity;
      if (gold >= limit - 1) {
        year.capDays += 1;
        year.goldLost += Math.max(0, dailyBalances(before).get(rome)?.gold ?? 0);
      }
      if (owned(before).every((c) => !c.construction)) year.idleDays += 1;
      for (const order of accepted)
        if (order.kind === 'build') {
          year.goldSpentOnBuildings += BUILDINGS[order.building].gold;
          if (order.city in game.lastBuild) game.lastBuild[order.city] = before.day;
        }
      for (const city of owned(after))
        if (
          game.allFive[city.id] === null &&
          BUILDING_KINDS.every((kind) => city.buildings.includes(kind))
        )
          game.allFive[city.id] = after.day;
      year.goldAtEnd = after.factions[rome]?.stores.gold ?? 0;
      year.limitAtEnd = limitsOf(after).get(rome)?.gold ?? 0;
      year.cities = owned(after).length;
    },
    {
      peaceful: true,
      answer: !values['no-answer'],
      ...(values.builder === 'panel' ? { builds: panelBuilds } : {}),
      ...(values.recruits === 'answer' ? { drops: ['recruit'] as const } : {}),
    },
  );
  return game;
}

const from = Number(values.from);
const games: Game[] = [];
for (let seed = from; seed < from + Number(values.seeds); seed++) {
  const game = play(seed, Number(values.years));
  games.push(game);
  if (values.json) console.log(JSON.stringify(game));
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const whole = (n: number) => Math.round(n).toLocaleString('en-US');
console.log(
  `\n## A peaceful Rome that ${values['no-answer'] ? 'ignores' : 'answers'} its warnings and builds ${values.builder === 'panel' ? 'as the panel suggests' : "by the AI's rule"}, seeds ${from} to ${from + games.length - 1}, means\n`,
);
console.log(
  '| year | days at the gold limit | gold the limit wasted | days with no building at work | gold spent on buildings | gold at year end / limit | cities |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- |');
for (let y = 0; y < Number(values.years); y++) {
  const of = (f: (year: Year) => number) =>
    mean(games.flatMap((g) => g.years.slice(y, y + 1).map(f)));
  console.log(
    `| ${y + 1} | ${of((r) => r.capDays).toFixed(0)} | ${whole(of((r) => r.goldLost))} | ${of((r) => r.idleDays).toFixed(0)} | ${whole(of((r) => r.goldSpentOnBuildings))} | ${whole(of((r) => r.goldAtEnd))} / ${whole(of((r) => r.limitAtEnd))} | ${of((r) => r.cities).toFixed(1)} |`,
  );
}
console.log("\n## The year each of Rome's starting cities stood with all five buildings\n");
const years = (day: number | null | undefined) =>
  day == null ? 'never' : `${(day / 365 + 1).toFixed(1)}`;
const ids = [...new Set(games.flatMap((g) => Object.keys(g.allFive)))].sort();
console.log(`| city | ${games.map((g) => `seed ${g.seed}`).join(' | ')} |`);
console.log(`| --- | ${games.map(() => '---').join(' | ')} |`);
for (const id of ids)
  console.log(`| ${id} | ${games.map((g) => years(g.allFive[id])).join(' | ')} |`);
console.log("\n## The year each of Rome's starting cities started its last building\n");
console.log(`| city | ${games.map((g) => `seed ${g.seed}`).join(' | ')} |`);
console.log(`| --- | ${games.map(() => '---').join(' | ')} |`);
for (const id of ids)
  console.log(`| ${id} | ${games.map((g) => years(g.lastBuild[id])).join(' | ')} |`);
