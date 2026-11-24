import { parseArgs } from 'node:util';
import { BUILDINGS } from '../../src/sim/buildings/buildings.ts';
import type { CityId, FactionId } from '../../src/sim/ids.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { dailyBalances, limitsOf } from '../../src/sim/systems/economy.ts';
import { panelBuilds, playCautiousRome, rome, suggested } from '../cautious-rome.ts';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    json: { type: 'boolean', default: false },
    builder: { type: 'string', default: 'panel' },
    prices: { type: 'string', default: '11000,12000' },
  },
});

/** One year of a peaceful Rome that answers its warnings. */
interface Year {
  /** Days the gold stood at the treasury limit. */
  capDays: number;
  /** Gold the treasury limit took from Rome: income on days at the limit. */
  goldLost: number;
  /** Days on which none of Rome's cities had a building at work. */
  idleDays: number;
  /** Days on which no city had a building at work or one worth ordering, whatever the gold. */
  nothingDays: number;
  goldSpentOnBuildings: number;
  goldAtEnd: number;
  limitAtEnd: number;
  cities: number;
}

interface Game {
  seed: number;
  years: Year[];
  /** The last day each of Rome's starting cities started a building. */
  lastBuild: Record<string, number | null>;
  /** For each great power and price, the first day its gold reached the price, or null. */
  affords: Record<string, Record<string, number | null>>;
  /** Each great power's treasury limit at the end of each year. */
  limits: Record<string, number[]>;
}

const yearOf = (): Year => ({
  capDays: 0,
  goldLost: 0,
  idleDays: 0,
  nothingDays: 0,
  goldSpentOnBuildings: 0,
  goldAtEnd: 0,
  limitAtEnd: 0,
  cities: 0,
});
const prices = values.prices.split(',').map(Number);

function play(seed: number, years: number): Game {
  const game: Game = {
    seed,
    years: Array.from({ length: years }, yearOf),
    lastBuild: {},
    affords: {},
    limits: {},
  };
  let starting: CityId[] | undefined;
  playCautiousRome(
    seed,
    years,
    ({ before, after, accepted }) => {
      starting ??= Object.values(before.cities)
        .filter((c) => c.owner === rome)
        .map((c) => c.id);
      for (const id of starting) game.lastBuild[id] ??= null;
      const year = game.years[Math.floor(before.day / 365)];
      if (!year) return;
      const owned = Object.values(before.cities).filter((c) => c.owner === rome);
      const gold = before.factions[rome]?.stores.gold ?? 0;
      const limits = limitsOf(before);
      if (gold >= (limits.get(rome)?.gold ?? Infinity) - 1) {
        year.capDays += 1;
        year.goldLost += Math.max(0, dailyBalances(before).get(rome)?.gold ?? 0);
      }
      if (owned.every((c) => !c.construction)) {
        year.idleDays += 1;
        const record = before.factions[rome];
        const rich: GameState = record
          ? {
              ...before,
              factions: {
                ...before.factions,
                [rome]: { ...record, stores: { ...record.stores, gold: 1e9 } },
              },
            }
          : before;
        if (owned.every((c) => !suggested(rich, rich.cities[c.id], 1e9))) year.nothingDays += 1;
      }
      for (const order of accepted)
        if (order.kind === 'build') {
          year.goldSpentOnBuildings += BUILDINGS[order.building].gold;
          if (order.city in game.lastBuild) game.lastBuild[order.city] = before.day;
        }
      for (const faction of Object.values(before.factions)) {
        if (faction.kind !== 'greatPower') continue;
        const affords = (game.affords[faction.id] ??= {});
        for (const price of prices)
          if ((affords[price] ?? null) === null)
            affords[price] = faction.stores.gold >= price ? before.day : null;
      }
      if (after.day % 365 === 0)
        for (const [id, limit] of limitsOf(after))
          if (after.factions[id]?.kind === 'greatPower')
            (game.limits[id] ??= []).push(Math.round(limit.gold));
      year.goldAtEnd = after.factions[rome]?.stores.gold ?? 0;
      year.limitAtEnd = limitsOf(after).get(rome)?.gold ?? 0;
      year.cities = Object.values(after.cities).filter((c) => c.owner === rome).length;
    },
    {
      peaceful: true,
      answer: true,
      drops: ['recruit'],
      ...(values.builder === 'panel' ? { builds: panelBuilds } : {}),
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
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? NaN : (s[Math.floor((s.length - 1) / 2)] ?? NaN);
};
const whole = (n: number) => Math.round(n).toLocaleString('en-US');
const yearText = (day: number | null | undefined) =>
  day == null ? 'never' : `year ${Math.floor(day / 365) + 1}`;
console.log(
  `\n## A peaceful Rome that answers its warnings, raises men only to answer them, and builds ${values.builder === 'panel' ? 'as the panel suggests' : "by the AI's rule"}, seeds ${from} to ${from + games.length - 1}, means\n`,
);
console.log(
  '| year | days at the gold limit | gold the limit wasted | days with no building at work | of them, days with nothing worth ordering | gold spent on buildings | gold at year end / limit | cities |',
);
console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
for (let y = 0; y < Number(values.years); y++) {
  const of = (f: (year: Year) => number) =>
    mean(games.flatMap((g) => g.years.slice(y, y + 1).map(f)));
  console.log(
    `| ${y + 1} | ${of((r) => r.capDays).toFixed(1)} | ${whole(of((r) => r.goldLost))} | ${of((r) => r.idleDays).toFixed(0)} | ${of((r) => r.nothingDays).toFixed(0)} | ${whole(of((r) => r.goldSpentOnBuildings))} | ${whole(of((r) => r.goldAtEnd))} / ${whole(of((r) => r.limitAtEnd))} | ${of((r) => r.cities).toFixed(1)} |`,
  );
}
console.log("\n## The year each of Rome's starting cities started its last building\n");
const ids = [...new Set(games.flatMap((g) => Object.keys(g.lastBuild)))].sort();
console.log(`| city | ${games.map((g) => `seed ${g.seed}`).join(' | ')} |`);
console.log(`| --- | ${games.map(() => '---').join(' | ')} |`);
for (const id of ids)
  console.log(
    `| ${id} | ${games.map((g) => yearText(g.lastBuild[id]).replace('year ', '')).join(' | ')} |`,
  );
console.log(
  '\n## When each great power first holds the gold, and its treasury limit\n\nThe median over the seeds of the first year its gold reached each price, with the seeds on which it never did; and its treasury limit at the end of years 1, 3, 5 and 10.\n',
);
const powers = [...new Set(games.flatMap((g) => Object.keys(g.affords)))].sort();
console.log(
  `| power | ${prices.map((p) => `${whole(p)} gold`).join(' | ')} | limit, years 1 / 3 / 5 / 10 |`,
);
console.log(`| --- | ${prices.map(() => '---').join(' | ')} | --- |`);
for (const power of powers) {
  const cells = prices.map((price) => {
    const days = games.map((g) => g.affords[power]?.[price] ?? null);
    const reached = days.filter((d): d is number => d !== null);
    if (reached.length === 0) return 'never';
    return `year ${Math.floor(median(reached) / 365) + 1} (never on ${days.length - reached.length})`;
  });
  const limitAt = (y: number) =>
    whole(median(games.flatMap((g) => g.limits[power as FactionId]?.slice(y - 1, y) ?? [])));
  console.log(`| ${power} | ${cells.join(' | ')} | ${[1, 3, 5, 10].map(limitAt).join(' / ')} |`);
}
