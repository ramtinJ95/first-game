import { parseArgs } from 'node:util';
import type { FactionId } from '../../src/sim/ids.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import { ADVANCE_KINDS, type AdvanceKind } from '../../src/sim/advances/advances.ts';
import { studyRefusal } from '../../src/sim/advances/study.ts';
import { bestStudy, studyPayback } from '../../src/sim/ai/study.ts';
import { marked } from '../../src/ui/advances-text.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { dailyBalances, limitsOf, menOf } from '../../src/sim/systems/economy.ts';
import { panelBuilds, playCautiousRome, rome, suggested, world } from '../cautious-rome.ts';
import { buildingWorth } from '../../src/sim/ai/build.ts';
import { reserveOf } from '../../src/sim/ai/situation.ts';
import { BUILDINGS, type BuildingKind } from '../../src/sim/buildings/buildings.ts';
import { ADVANCES } from '../../src/sim/advances/advances.ts';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    players: { type: 'string', default: 'builder,stranger' },
  },
});

/**
 * Romes at peace: the AI plays Rome, its trade included, and it declares no war. `ruler`
 * does nothing about a warning (the slide's `ignoring`), and `answering` answers each
 * warning as it advises; both build and study by the AI's rules. `builder` answers, builds
 * as the panel suggests (`panelBuilds`, as `sim -- projects` plays it), and studies the
 * advance the panel suggests with the gold the day's buildings and the reserve for its men
 * leave, and nothing on a day the panel's line names a building that pays back sooner.
 * `stranger` answers, never builds, a player who has not found the buildings list and
 * passes over that line, and studies the soonest advance with all its gold. Every other power plays the AI.
 */
const PLAYERS = ['ruler', 'answering', 'builder', 'stranger'] as const;
/** The years at whose first day the run notes what the panel would build next. */
const SNAPSHOT_YEARS = [3, 7];
type Player = (typeof PLAYERS)[number];

interface Year {
  /** Days that end with Rome's gold at its limit. */
  atLimit: number;
  /** Gold a day's income would have added on a day at the limit, which the limit throws away. */
  lost: number;
  /** Rome's income less upkeep, summed over the days, trade at its expected rate. */
  net: number;
  /** The treasury at the end of the year less at its start. */
  rise: number;
  limit: number;
  /** Days with an advance at work, and days with none at work but one Rome could start. */
  studying: number;
  choosing: number;
  /** Advances Rome had studied by the end of the year. */
  studied: number;
  /** Days with nothing at work and nothing left Rome would study at any price it could pay. */
  done: number;
  /** Of those, days with an advance Rome could still start, though it would not pay back within the AI's years. */
  doneButOpen: number;
  /** Men under arms at the end of the year: Rome's, and the most any other great power fields. */
  men: number;
  rivalMen: number;
}

const emptyYear = (): Year => ({
  atLimit: 0,
  lost: 0,
  net: 0,
  rise: 0,
  limit: 0,
  studying: 0,
  choosing: 0,
  studied: 0,
  done: 0,
  doneButOpen: 0,
  men: 0,
  rivalMen: 0,
});

function count(years: Year[], before: GameState, after: GameState) {
  const year = years[Math.floor((before.day - 1) / 365)];
  if (!year) return;
  const gold = (s: GameState) => s.factions[rome]?.stores.gold ?? 0;
  const cap = limitsOf(before).get(rome as FactionId)?.gold ?? Infinity;
  const net = dailyBalances(before).get(rome as FactionId)?.gold ?? 0;
  year.net += net;
  year.rise += gold(after) - gold(before);
  year.limit = limitsOf(after).get(rome as FactionId)?.gold ?? 0;
  if (gold(after) >= cap - 1) {
    year.atLimit++;
    year.lost += Math.max(0, net - (gold(after) - gold(before)));
  }
  const realm = after.factions[rome];
  if (realm?.study) year.studying++;
  else if (realm && !bestStudy(withGold(after, 1e9), rome, Infinity)) {
    year.done++;
    if (ADVANCE_KINDS.some((kind) => !studyRefusal(after, rome, kind))) year.doneButOpen++;
  } else if (ADVANCE_KINDS.some((kind) => !studyRefusal(after, rome, kind))) year.choosing++;
  year.studied = realm?.advances.length ?? 0;
  const men = new Map<FactionId, number>();
  for (const army of Object.values(after.armies))
    men.set(army.owner, (men.get(army.owner) ?? 0) + menOf(after, army));
  year.men = men.get(rome as FactionId) ?? 0;
  year.rivalMen = Math.max(
    0,
    ...Object.values(after.factions)
      .filter((f) => f.kind === 'greatPower' && f.id !== rome)
      .map((f) => men.get(f.id) ?? 0),
  );
}

/** The state with Rome's treasury holding `gold`, to ask what Rome would buy with it. */
function withGold(state: GameState, gold: number): GameState {
  const realm = state.factions[rome];
  if (!realm) return state;
  return {
    ...state,
    factions: { ...state.factions, [rome]: { ...realm, stores: { ...realm.stores, gold } } },
  };
}

/**
 * The panel's suggestion, on a day nothing is studied, with `gold` to spend. A player who
 * heeds the panel's line studies nothing while a city could start a building that pays back
 * sooner (`marked`).
 */
function asThePanelSuggests(state: GameState, gold: number, heedsLine: boolean): Order[] {
  const realm = state.factions[rome];
  if (!realm || realm.study) return [];
  if (heedsLine && marked(state, world, rome).building) return [];
  const best = bestStudy(state, rome, gold);
  return best ? [{ kind: 'study', faction: rome, advance: best.advance }] : [];
}

/** Rome's orders for the player: the AI's, without its own building and study, then the panel's. */
function playerOrders(player: Player, orders: Order[], state: GameState): Order[] {
  if (player === 'ruler' || player === 'answering') return orders;
  const kept = orders.filter((o) => o.faction !== rome || o.kind !== 'study');
  const gold = state.factions[rome]?.stores.gold ?? 0;
  if (player === 'stranger') return [...kept, ...asThePanelSuggests(state, gold, false)];
  const building = kept.reduce(
    (sum, o) => sum + (o.faction === rome && o.kind === 'build' ? BUILDINGS[o.building].gold : 0),
    0,
  );
  return [
    ...kept,
    ...asThePanelSuggests(state, gold - building - reserveOf(state, rome, 'gold'), true),
  ];
}

/** Rome on the first day of a year: its net gold a day, and the building the panel would start next. */
interface Snapshot {
  net: number;
  gold: number;
  /** Rome's cities with a building at work. */
  busy: number;
  /** Each advance's payback in years for Rome, and for the great power with the most cities. */
  paybacks: Partial<Record<AdvanceKind, number>>;
  largest: Partial<Record<AdvanceKind, number>>;
  building?: { kind: BuildingKind; price: number; worth: number };
}

function snapshot(state: GameState): Snapshot {
  const net = dailyBalances(state).get(rome as FactionId)?.gold ?? 0;
  let building: Snapshot['building'];
  let busy = 0;
  for (const city of Object.values(state.cities)) {
    if (city.owner !== rome) continue;
    const work = city.construction;
    if (work) busy++;
    // A city at work is weighed as it will stand once its work is done.
    const done = work
      ? { ...city, construction: null, buildings: [...city.buildings, work.building] }
      : city;
    const realm = state.factions[rome];
    if (!realm) continue;
    // Weighed with gold enough, so the price alone never refuses it.
    const after = {
      ...state,
      cities: { ...state.cities, [city.id]: done },
      factions: { ...state.factions, [rome]: { ...realm, stores: { ...realm.stores, gold: 1e9 } } },
    };
    const best = suggested(after, done, Infinity);
    if (!best) continue;
    const price = BUILDINGS[best.kind].gold;
    const worth = buildingWorth(after, done, best.kind);
    if (!building || price / worth < building.price / building.worth)
      building = { kind: best.kind, price, worth };
  }
  const paybacksOf = (faction: FactionId) =>
    Object.fromEntries(
      ADVANCE_KINDS.flatMap((kind) => {
        const years = studyPayback(state, faction, kind);
        return years === undefined ? [] : [[kind, years]];
      }),
    );
  const counts = new Map<FactionId, number>();
  for (const city of Object.values(state.cities))
    if (state.factions[city.owner]?.kind === 'greatPower')
      counts.set(city.owner, (counts.get(city.owner) ?? 0) + 1);
  const [largest] = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  return {
    net,
    gold: state.factions[rome]?.stores.gold ?? 0,
    busy,
    paybacks: paybacksOf(rome as FactionId),
    largest: largest ? paybacksOf(largest[0]) : {},
    ...(building ? { building } : {}),
  };
}

function play(player: Player, seed: number, years: number) {
  const counted = Array.from({ length: years }, emptyYear);
  const snapshots = new Map<number, Snapshot>();
  playCautiousRome(
    seed,
    years,
    ({ before, after }) => {
      count(counted, before, after);
      for (const year of SNAPSHOT_YEARS)
        if (after.day === (year - 1) * 365 + 1) snapshots.set(year, snapshot(after));
    },
    {
      peaceful: true,
      answer: player !== 'ruler',
      ...(player === 'builder' ? { builds: panelBuilds } : {}),
      ...(player === 'stranger' ? { drops: ['build'] as const } : {}),
      orders: (orders, state) => playerOrders(player, orders, state),
    },
  );
  return { years: counted, snapshots };
}

const median = (all: readonly number[]) => {
  const sorted = [...all].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};
const whole = (n: number) => Math.round(n).toLocaleString('en-GB');

const players = values.players.split(',') as Player[];
const first = Number(values.from);
const seeds = Number(values.seeds);
const years = Number(values.years);
console.log(
  `Rome at peace, seeds ${first} to ${first + seeds - 1}, medians over seeds. "Spare" is the gold the limit threw away plus the rise in the treasury: what Rome could have spent that year without giving up anything it did. "Lost" is estimated as the day's balance, trade at its expected rate, less what the treasury gained on a day that ends at the limit.`,
);
for (const player of players) {
  if (!PLAYERS.includes(player)) throw new Error(`--players takes ${PLAYERS.join(', ')}`);
  const played = Array.from({ length: seeds }, (_, i) => play(player, first + i, years));
  const games = played.map((p) => p.years);
  console.log(`\n### ${player}\n`);
  console.log(
    '| year | days at the limit | gold lost to the limit | treasury rise | spare | net income | limit | days studying | days with one to choose | advances studied | days with nothing left worth study | men | largest rival’s men |',
  );
  console.log(
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  let spareSum = 0;
  let atLimitSum = 0;
  for (let y = 0; y < years; y++) {
    const of = (f: (r: Year) => number) => median(games.map((g) => f(g[y] ?? emptyYear())));
    const spare = of((r) => r.lost + r.rise);
    spareSum += spare;
    atLimitSum += of((r) => r.atLimit);
    console.log(
      `| ${y + 1} | ${of((r) => r.atLimit)} | ${whole(of((r) => r.lost))} | ${whole(of((r) => r.rise))} | ${whole(spare)} | ${whole(of((r) => r.net))} | ${whole(of((r) => r.limit))} | ${of((r) => r.studying)} | ${of((r) => r.choosing)} | ${of((r) => r.studied)} | ${of((r) => r.done)} | ${whole(of((r) => r.men))} | ${whole(of((r) => r.rivalMen))} |`,
    );
  }
  const busyYears = games.map(
    (g) => g.slice(1).filter((r) => r.studying > 0 || r.choosing > 0).length,
  );
  const doneFrom = games.map((g) => {
    const first = g.findIndex((r) => r.done > 0);
    return first < 0 ? Infinity : first + 1;
  });
  const finished = doneFrom.filter(Number.isFinite);
  const openYears = games.map(
    (g) => g.slice(1).filter((r) => r.studying > 0 || r.choosing > 0 || r.doneButOpen > 0).length,
  );
  console.log(
    `\nSeeds with an advance at work or any advance Rome could start, worth it or not, in every year from 2: ${openYears.filter((n) => n === years - 1).length} of ${seeds}.`,
  );
  console.log(
    `\nYear Rome first has nothing left it would study: ${finished.length} of ${seeds} seeds, median Year ${finished.length ? median(finished) : '-'}, earliest Year ${finished.length ? Math.min(...finished) : '-'}.`,
  );
  console.log(
    `\nSummary: | ${player} | days at the limit, years 1–${years}, sum of yearly medians ${atLimitSum} | spare gold ${whole(spareSum)} | seeds with an advance at work or one worth studying in every year from 2: ${busyYears.filter((n) => n === years - 1).length} of ${seeds} |`,
  );
  for (const year of SNAPSHOT_YEARS) {
    const shots = played.flatMap((p) => p.snapshots.get(year) ?? []);
    const net = median(shots.map((s) => s.net));
    const withBuilding = shots.flatMap((s) => (s.building ? [s.building] : []));
    const price = median(withBuilding.map((b) => b.price));
    const worth = median(withBuilding.map((b) => b.worth));
    const kinds = [...new Set(withBuilding.map((b) => BUILDINGS[b.kind].name))].join(', ');
    console.log(
      `\nYear ${year}, day 1 (${shots.length} seeds alive): net gold ${net.toFixed(1)} a day, treasury ${whole(median(shots.map((s) => s.gold)))}, cities with a building at work ${median(shots.map((s) => s.busy))}. The panel's next building, once each city's work is done, pays back soonest in ${withBuilding.length} seeds: median price ${whole(price)}, worth ${worth.toFixed(1)} gold a day (${kinds}). An advance's price puts it off by price / net days and forgoes its worth for them:`,
    );
    console.log(
      ADVANCE_KINDS.map((kind) => {
        const days = ADVANCES[kind].gold / Math.max(net, 1);
        return `${ADVANCES[kind].name} ${whole(ADVANCES[kind].gold)}: ${Math.round(days)} days, ${whole(days * worth)} gold`;
      }).join('; ') + '.',
    );
    const payback = (
      pick: (s: Snapshot) => Partial<Record<AdvanceKind, number>>,
      kind: AdvanceKind,
    ) => {
      const years = shots.map((s) => pick(s)[kind] ?? Infinity);
      const paying = years.filter(Number.isFinite).length;
      const mid = median(years);
      return `${Number.isFinite(mid) ? mid.toFixed(1) : 'never'} (pays in ${paying} of ${shots.length})`;
    };
    console.log(
      `Payback in years, median over seeds, for Rome and for the great power with the most cities: ${ADVANCE_KINDS.map((kind) => `${ADVANCES[kind].name} ${payback((s) => s.paybacks, kind)} / ${payback((s) => s.largest, kind)}`).join('; ')}.`,
    );
  }
}
