import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { threatNewsOfDay } from '../../src/app/threat-news.ts';
import { createRouter } from '../../src/sim/ai/routes.ts';
import { enemiesOf, sorted, strengthNear, strengthOf } from '../../src/sim/ai/situation.ts';
import { WAR_FRONT_KM, WAR_REACH_KM } from '../../src/sim/ai/thresholds.ts';
import { GUARD_GOLD, guardMen, weighedGarrison } from '../../src/sim/guards.ts';
import { whole } from '../../src/app/names.ts';
import type { FactionId } from '../../src/sim/ids.ts';
import { truceBetween } from '../../src/sim/peace/truce.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { limitsOf } from '../../src/sim/systems/economy.ts';
import { areAtWar } from '../../src/sim/wars.ts';
import { distance } from '../../src/sim/world/find-path.ts';
import { type GuardPlay, playCautiousRome, rome, warnedPowers, world } from '../cautious-rome.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    peaceful: { type: 'boolean', default: false },
    guards: { type: 'string', default: 'never' },
    json: { type: 'boolean', default: false },
    summarize: { type: 'boolean', default: false },
  },
});
const PLAYS: readonly GuardPlay[] = ['never', 'monthly', 'every', 'warned', 'war'];
const guards = PLAYS.find((p) => p === values.guards);
if (!guards) throw new Error(`--guards takes one of ${PLAYS.join(', ')}`);
const SPENDING = new Set([
  'openTrade',
  'acceptTrade',
  'improveTrade',
  'build',
  'recruit',
  'hireGuards',
]);

/** One month of a great power at peace with every other and with Rome in reach. */
interface Weighing {
  cities: number;
  /** Its whole strength over Rome's armies within WAR_FRONT_KM of Rome's nearest city plus that city's garrison. */
  odds: number;
  /** The share of its own treasury that is full. */
  full: number;
  romeFull: number;
}

interface Row {
  seed: number;
  wars: { day: number; by: string; warnedDaysBefore: number | null; warnedThisPeace: boolean }[];
  warnings: number;
  /** Warnings by power. */
  warnedBy: Record<string, number>;
  /** Warnings before Year 4, day 180, the day the seventh play-through counted to. */
  warningsByY4d180: number;
  fellOn: number | null;
  citiesLost: number;
  citiesAtEnd: number;
  menAtEnd: number;
  goldAtEnd: number;
  capDays: number;
  guardsAtEnd: number;
  bands: number;
  longestQuiet: number;
  quietFrom: number;
  weighings: Weighing[];
}

const yearDay = (day: number) => `Y${Math.floor(day / 365) + 1} d${(day % 365) + 1}`;
const median = (all: readonly number[]) => {
  const sorted = [...all].sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor(sorted.length / 2)] ?? 0) : 0;
};

function menOf(state: GameState, faction: FactionId): number {
  let men = 0;
  for (const army of Object.values(state.armies))
    if (army.owner === faction)
      for (const id of army.formations) men += state.formations[id]?.men ?? 0;
  return men;
}

/**
 * How a great power at peace with every great power and in reach of Rome weighs it, by
 * the parts of `warDeclaration` that do not depend on its other wars: its whole strength
 * over Rome's armies near Rome's nearest city in reach plus that city's garrison.
 */
function weighing(state: GameState, power: FactionId): Weighing | undefined {
  if (areAtWar(state, power, rome) || truceBetween(state, power, rome)) return undefined;
  if ([...enemiesOf(state, power)].some((e) => state.factions[e]?.kind === 'greatPower'))
    return undefined;
  const ours = Object.values(state.cities).filter((c) => c.owner === power);
  const router = createRouter(state, world, power);
  const front = Object.values(state.cities)
    .filter((c) => c.owner === rome)
    .flatMap((theirs) =>
      ours.map((mine) => ({ theirs, mine, km: distance(mine.position, theirs.position) })),
    )
    .filter((p) => p.km <= WAR_REACH_KM)
    .sort((a, b) => a.km - b.km)
    .find((p) => router.reaches(p.mine.position, p.theirs));
  if (!front) return undefined;
  let own = 0;
  for (const army of sorted(state.armies)) if (army.owner === power) own += strengthOf(state, army);
  const romans = sorted(state.armies).filter((a) => a.owner === rome);
  const theirs =
    strengthNear(state, romans, front.theirs.position, WAR_FRONT_KM) +
    weighedGarrison(front.theirs, state.day);
  const limits = limitsOf(state);
  const full = (faction: FactionId) =>
    (state.factions[faction]?.stores.gold ?? 0) / Math.max(1, limits.get(faction)?.gold ?? 0);
  return {
    cities: ours.length,
    odds: own / Math.max(1, theirs),
    full: full(power),
    romeFull: full(rome),
  };
}

function play(seed: number, years: number): Row {
  const row: Row = {
    seed,
    wars: [],
    warnings: 0,
    warnedBy: {},
    warningsByY4d180: 0,
    fellOn: null,
    citiesLost: 0,
    citiesAtEnd: 0,
    menAtEnd: 0,
    goldAtEnd: 0,
    capDays: 0,
    guardsAtEnd: 0,
    bands: 0,
    longestQuiet: 0,
    quietFrom: 0,
    weighings: [],
  };
  let lastDecision = 0;
  const told = new Set<string>();
  const warnedOn = new Map<string, number>();
  const warnedThisPeace = new Set<string>();
  const quiet = (day: number) => {
    if (day - lastDecision > row.longestQuiet) {
      row.longestQuiet = day - lastDecision;
      row.quietFrom = lastDecision;
    }
  };
  const end = playCautiousRome(
    seed,
    years,
    ({ before, after, events, accepted }) => {
      const day = before.day;
      for (const alert of threatNewsOfDay(before, after, world, told)) {
        row.warnings++;
        if (day < 3 * 365 + 180) row.warningsByY4d180++;
        for (const name of warnedPowers(alert.text)) {
          row.warnedBy[name] = (row.warnedBy[name] ?? 0) + 1;
          warnedOn.set(name, day);
          warnedThisPeace.add(name);
        }
      }
      for (const event of events) {
        if (event.kind !== 'warDeclared' || event.against !== rome) continue;
        if (after.factions[event.by]?.kind !== 'greatPower') continue;
        const name = after.factions[event.by]?.name ?? '';
        const warned = warnedOn.get(name);
        row.wars.push({
          day,
          by: event.by,
          warnedDaysBefore: warned === undefined ? null : day - warned,
          warnedThisPeace: warnedThisPeace.has(name),
        });
      }
      for (const power of Object.values(after.factions))
        if (areAtWar(after, power.id, rome) || truceBetween(after, power.id, rome))
          warnedThisPeace.delete(power.name);
      for (const city of Object.values(before.cities))
        if (city.owner === rome && after.cities[city.id]?.owner !== rome) row.citiesLost++;
      const gold = after.factions[rome]?.stores.gold ?? 0;
      if (gold >= (limitsOf(after).get(rome)?.gold ?? Infinity) - 1) row.capDays++;
      row.bands += accepted.filter((o) => o.kind === 'hireGuards').length;
      if (accepted.some((o) => SPENDING.has(o.kind))) {
        quiet(day);
        lastDecision = day;
      }
      if (day % 30 === 0)
        for (const power of sorted(after.factions)) {
          if (power.kind !== 'greatPower' || power.id === rome || power.defeatedOn !== null)
            continue;
          const weighed = weighing(after, power.id);
          if (weighed) row.weighings.push(weighed);
        }
    },
    { peaceful: values.peaceful, guards },
  );
  quiet(end.day);
  row.fellOn = end.factions[rome]?.defeatedOn ?? null;
  row.citiesAtEnd = Object.values(end.cities).filter((c) => c.owner === rome).length;
  row.menAtEnd = menOf(end, rome);
  row.goldAtEnd = Math.round(end.factions[rome]?.stores.gold ?? 0);
  row.guardsAtEnd = Object.values(end.cities)
    .filter((c) => c.owner === rome)
    .reduce((sum, c) => sum + guardMen(c), 0);
  return row;
}

function print(rows: readonly Row[]) {
  console.log(
    '| seed | wars on Rome by a great power | first | by | warned days before | in years 1–3 | in years 6–10 | Rome lost cities | Rome at end | men | gold | days gold at limit | longest without a decision |',
  );
  console.log(
    '| ---: | ---: | --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |',
  );
  for (const r of rows) {
    const war = r.wars[0];
    console.log(
      `| ${r.seed} | ${r.wars.length} | ${war ? yearDay(war.day) : '-'} | ${war?.by ?? '-'} | ${war?.warnedDaysBefore ?? '-'} | ${r.wars.filter((w) => w.day < 3 * 365).length} | ${r.wars.filter((w) => w.day >= 5 * 365).length} | ${r.citiesLost} | ${r.fellOn !== null ? `fell ${yearDay(r.fellOn)}` : `${r.citiesAtEnd} cities`} | ${r.menAtEnd} | ${r.goldAtEnd} | ${r.capDays} | ${r.longestQuiet} from ${yearDay(r.quietFrom)} |`,
    );
  }
  const count = (test: (r: Row) => boolean) => rows.filter(test).length;
  const firsts = rows.flatMap((r) => (r.wars[0] ? [r.wars[0]] : []));
  console.log(
    `\n${count((r) => r.wars.length > 0)} of ${rows.length} seeds see a great power declare war on Rome: ${count((r) => r.wars.some((w) => w.day < 3 * 365))} in years 1–3, ${count((r) => r.wars.some((w) => w.day >= 5 * 365))} in years 6–10. Rome falls in ${count((r) => r.fellOn !== null)} and ends on one or two cities in ${count((r) => r.fellOn === null && r.citiesAtEnd <= 2)}. Rome lost ${rows.reduce((sum, r) => sum + r.citiesLost, 0)} cities in all.`,
  );
  console.log(
    `First wars warned of beforehand: ${firsts.filter((w) => w.warnedDaysBefore !== null).length} of ${firsts.length}, median ${median(firsts.flatMap((w) => (w.warnedDaysBefore === null ? [] : [w.warnedDaysBefore])))} days before. Warnings in all: ${rows.reduce((sum, r) => sum + r.warnings, 0)}.`,
  );
  const wars = rows.flatMap((r) => r.wars);
  const perPower = rows.flatMap((r) => Object.values(r.warnedBy));
  const counts = new Map<number, number>();
  for (const n of perPower) counts.set(n, (counts.get(n) ?? 0) + 1);
  console.log(
    `Declarations on Rome by a great power with a warning from that power since the last war or truce with it: ${wars.filter((w) => w.warnedThisPeace).length} of ${wars.length}. Warnings per power that warned in a game: median ${median(perPower)}, most ${Math.max(0, ...perPower)}; games of a power by its warnings: ${[
      ...counts,
    ]
      .sort((a, b) => a[0] - b[0])
      .map(([n, games]) => `${n}×${games}`)
      .join(
        ', ',
      )}. Warnings before Year 4, day 180: median ${median(rows.map((r) => r.warningsByY4d180))} a game, most ${Math.max(0, ...rows.map((r) => r.warningsByY4d180))}.`,
  );
  console.log(
    `Longest stretch without a decision: median ${median(rows.map((r) => r.longestQuiet))}, most ${Math.max(0, ...rows.map((r) => r.longestQuiet))} days. Days gold at its limit: median ${median(rows.map((r) => r.capDays))}, most ${Math.max(0, ...rows.map((r) => r.capDays))}. Guards held at the end: median ${median(rows.map((r) => r.guardsAtEnd ?? 0))}, most ${Math.max(0, ...rows.map((r) => r.guardsAtEnd ?? 0))}.`,
  );
  const firstDays = rows.map((r) => r.wars[0]?.day ?? Infinity);
  const firstMedian = median(firstDays);
  const sum = (of: (r: Row) => number) => rows.reduce((total, r) => total + of(r), 0);
  console.log(
    `\nSummary: | ${guards} | ${count((r) => r.wars.length > 0)} of ${rows.length} | ${Number.isFinite(firstMedian) ? `Y${(firstMedian / 365 + 1).toFixed(1)}` : 'none by Y10'} | ${count((r) => r.wars.some((w) => w.day < 3 * 365))} | ${count((r) => r.fellOn !== null)} fall, ${count((r) => r.fellOn === null && r.citiesAtEnd <= 2)} on 1–2 cities, ${sum((r) => r.citiesLost)} lost | ${median(rows.map((r) => r.citiesAtEnd))} | ${sum((r) => r.bands)} (median ${median(rows.map((r) => r.bands))}) | ${whole(sum((r) => r.bands) * GUARD_GOLD)} (median ${whole(median(rows.map((r) => r.bands)) * GUARD_GOLD)}) | ${median(rows.map((r) => r.capDays))} / ${Math.max(0, ...rows.map((r) => r.capDays))} |`,
  );
  const weighings = rows.flatMap((r) => r.weighings);
  console.log(
    "\nMonths a great power at peace with every other had Rome in reach, by its cities: its whole strength over Rome's armies near Rome's nearest city plus that city's garrison with the guards great powers still count, and the share of each treasury that is full.\n",
  );
  console.log(
    "| cities | months | odds, median | odds, 9 in 10 below | its treasury full | Rome's treasury full |",
  );
  console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const [low, high] of [
    [4, 8],
    [9, 12],
    [13, 16],
    [17, 99],
  ] as const) {
    const months = weighings.filter((w) => w.cities >= low && w.cities <= high);
    const odds = months.map((w) => w.odds).sort((a, b) => a - b);
    console.log(
      `| ${high === 99 ? `${low}+` : `${low}–${high}`} | ${months.length} | ${median(odds).toFixed(2)} | ${(odds[Math.floor(odds.length * 0.9)] ?? 0).toFixed(2)} | ${median(months.map((w) => w.full)).toFixed(2)} | ${median(months.map((w) => w.romeFull)).toFixed(2)} |`,
    );
  }
}

if (values.summarize) {
  print(
    positionals
      .flatMap((file) => readFileSync(file, 'utf8').trim().split('\n'))
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Row)
      .sort((a, b) => a.seed - b.seed),
  );
} else {
  const first = Number(values.from);
  const years = Number(values.years);
  console.log(
    `Cautious Rome of trade-judge --heed --improve${values.peaceful ? ', declaring no war' : ''}${guards === 'never' ? '' : `, hiring guards (${guards})`}, seeds ${first} to ${first + Number(values.seeds) - 1}, ${years} years.\n`,
  );
  const rows: Row[] = [];
  for (let seed = first; seed < first + Number(values.seeds); seed++) {
    const row = play(seed, years);
    rows.push(row);
    if (values.json) console.log(JSON.stringify(row));
  }
  if (!values.json) print(rows);
}
