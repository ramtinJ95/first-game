import { sorted, strengthOf } from '../src/sim/ai/situation.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { POWERS, type PowerId } from '../src/sim/map.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { warSides } from '../src/sim/state/war.ts';
import { CITY_DEFENCES, RECOVERY_DAYS } from '../src/sim/systems/sieges.ts';

/**
 * The conquest and economy lines of `npm run sim:ai`: what one game did in each year.
 * `sim-ai.ts` calls the hooks from its own day loop, so this file adds lines without
 * changing the tables it already prints.
 */

type Capture = 'siege' | 'storm' | 'surrender';
type Fate = 'occupy' | 'sack' | 'enslave';

interface Year {
  independent: number;
  cities: Record<PowerId, number>;
  stores: Record<PowerId, { gold: number; food: number; manpower: number }>;
  captures: Record<Capture, number>;
  stormLosses: number[];
  fates: Record<Fate, number>;
  /** Cities one great power took from another. */
  powerTakes: number;
  /** Battles in which great powers fought each other on both sides. */
  powerBattles: number;
  /** Powers at war on some day of the year with a great power whose armies were stronger. */
  threatened: Set<PowerId>;
}

export interface ConquestLedger {
  years: Year[];
  /** The day each power lost its last city, if it did. */
  defeatedOn: Map<PowerId, number>;
  /** The year, as an index, in which each city last fell, so its fate counts in that year. */
  fellIn: Map<string, number>;
  minors: number;
  startCities: Record<PowerId, number>;
}

const isPower = (faction: string): faction is PowerId =>
  (POWERS as readonly string[]).includes(faction);

function powerRecord<V>(make: () => V): Record<PowerId, V> {
  return Object.fromEntries(POWERS.map((power) => [power, make()])) as Record<PowerId, V>;
}

function emptyYear(): Year {
  return {
    independent: 0,
    cities: powerRecord(() => 0),
    stores: powerRecord(() => ({ gold: 0, food: 0, manpower: 0 })),
    captures: { siege: 0, storm: 0, surrender: 0 },
    stormLosses: [],
    fates: { occupy: 0, sack: 0, enslave: 0 },
    powerTakes: 0,
    powerBattles: 0,
    threatened: new Set(),
  };
}

function citiesOf(state: GameState, faction: string): number {
  return Object.values(state.cities).filter((city) => city.owner === faction).length;
}

export function startLedger(state: GameState): ConquestLedger {
  return {
    years: [emptyYear()],
    defeatedOn: new Map(),
    fellIn: new Map(),
    minors: Object.values(state.cities).filter(
      (city) => state.factions[city.owner]?.kind === 'minor',
    ).length,
    startCities: Object.fromEntries(POWERS.map((p) => [p, citiesOf(state, p)])) as Record<
      PowerId,
      number
    >,
  };
}

function current(ledger: ConquestLedger): Year {
  return ledger.years.at(-1) as Year;
}

/** Records a fate order the rules accepted, in the year the city fell, in place of occupying it. */
export function fateChosen(ledger: ConquestLedger, order: Order) {
  if (order.kind !== 'sack' && order.kind !== 'enslave') return;
  const year = ledger.years[ledger.fellIn.get(order.city) ?? ledger.years.length - 1] as Year;
  year.fates[order.kind]++;
  year.fates.occupy--;
}

/**
 * Records the share of its men a storm cost. The storm's armies are known by id from the state before
 * the order, and an army the storm wiped out counts with no men left.
 */
export function stormLoss(
  ledger: ConquestLedger,
  before: GameState,
  after: GameState,
  order: Extract<Order, { kind: 'storm' }>,
) {
  const siege = Object.values(before.sieges).find((s) => s.city === order.city);
  if (!siege) return;
  const menIn = (state: GameState) =>
    siege.besiegers.reduce((sum, id) => {
      const army = state.armies[id];
      if (army?.owner !== order.faction) return sum;
      return sum + army.formations.reduce((s, f) => s + (state.formations[f]?.men ?? 0), 0);
    }, 0);
  const men = menIn(before);
  const city = after.cities[order.city];
  const taken = city && city.owner !== before.cities[order.city]?.owner;
  // The men left behind to hold a city the storm took are not lost.
  const leftBehind = taken ? city.garrison : 0;
  if (men > 0) current(ledger).stormLosses.push(1 - (menIn(after) + leftBehind) / men);
}

/**
 * Records one day: the cities that changed owner and how, the battles that started, and
 * which powers were at war with a stronger power. `ownersAfterOrders` holds each city's
 * owner once the day's orders ran and before the systems, so a city taken then fell to
 * a storm.
 */
export function observeDay(
  ledger: ConquestLedger,
  before: GameState,
  ownersAfterOrders: ReadonlyMap<string, string>,
  after: GameState,
) {
  const year = current(ledger);
  for (const city of Object.values(after.cities)) {
    const was = before.cities[city.id]?.owner;
    if (was === undefined || was === city.owner) continue;
    const stormed = ownersAfterOrders.get(city.id) !== was;
    // A city that fell overnight has already rebuilt one day of walls, so walls of no
    // more than that were down when it fell.
    const breached = city.walls <= CITY_DEFENCES[city.rank].walls / RECOVERY_DAYS + 1e-9;
    const how: Capture = stormed ? 'storm' : breached ? 'surrender' : 'siege';
    year.captures[how]++;
    ledger.fellIn.set(city.id, ledger.years.length - 1);
    if (isPower(city.owner)) year.fates.occupy++;
    if (isPower(city.owner) && isPower(was)) year.powerTakes++;
  }
  for (const battle of Object.values(after.battles)) {
    if (before.battles[battle.id]) continue;
    const owners = (ids: readonly string[]) =>
      ids.map((id) => after.armies[id as keyof GameState['armies']]?.owner ?? '');
    if (owners(battle.attackers).some(isPower) && owners(battle.defenders).some(isPower)) {
      year.powerBattles++;
    }
  }
  const strength = new Map<string, number>();
  for (const army of sorted(after.armies)) {
    strength.set(army.owner, (strength.get(army.owner) ?? 0) + strengthOf(after, army));
  }
  for (const key of Object.keys(after.wars)) {
    const sides = warSides(key);
    if (!sides) continue;
    const [a, b] = sides;
    if (!isPower(a) || !isPower(b)) continue;
    const sa = strength.get(a) ?? 0;
    const sb = strength.get(b) ?? 0;
    if (sb > sa) year.threatened.add(a);
    if (sa > sb) year.threatened.add(b);
  }
  for (const power of POWERS) {
    const defeated = after.factions[power as string as FactionId]?.defeatedOn;
    if (defeated != null && !ledger.defeatedOn.has(power)) ledger.defeatedOn.set(power, defeated);
  }
}

/** Closes the year with the state at its end and opens the next. */
export function endYear(ledger: ConquestLedger, state: GameState) {
  const year = current(ledger);
  year.independent = Object.values(state.cities).filter(
    (city) => state.factions[city.owner]?.kind === 'minor',
  ).length;
  for (const power of POWERS) {
    year.cities[power] = citiesOf(state, power);
    const stores = state.factions[power as string as FactionId]?.stores;
    if (stores) year.stores[power] = { ...stores };
  }
  ledger.years.push(emptyYear());
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

const fmt = (n: number, digits = 0) =>
  Number.isNaN(n)
    ? '–'
    : n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (n: number) => (Number.isNaN(n) ? '–' : `${fmt(100 * n)}%`);
const mark = (met: boolean) => (met ? 'met' : 'NOT met');

/** Prints the conquest section for one table of games. */
export function printConquest(ledgers: readonly ConquestLedger[], passive: readonly string[]) {
  const seeds = ledgers.length;
  const yearCount = Math.min(...ledgers.map((l) => l.years.length - 1));
  const minors = ledgers[0]?.minors ?? 0;
  console.log('\n### Conquest and economy by year\n');
  console.log(
    `Medians over the ${seeds} seeds, taken at the end of each year. Stores are each power's, read in the order ${POWERS.join(', ')}. Captures, fates, and storm losses add up the year's events over all seeds.\n`,
  );
  const header = [
    'year',
    `independent of ${minors}`,
    'cities per power',
    'gold',
    'food',
    'manpower',
    'captures siege/storm/surrender',
    'storm loss, median (n)',
    'fates occupy/sack/enslave',
    'power takes power',
    'power battles',
  ];
  console.log(`| ${header.join(' | ')} |`);
  console.log(`| ${header.map(() => '---').join(' | ')} |`);
  for (let y = 0; y < yearCount; y++) {
    const years = ledgers.map((l) => l.years[y] as Year);
    const per = (pick: (year: Year, power: PowerId) => number) =>
      POWERS.map((power) => fmt(median(years.map((year) => pick(year, power))))).join(' / ');
    const sum = (pick: (year: Year) => number) => years.reduce((s, year) => s + pick(year), 0);
    const captures = sum((t) => t.captures.siege + t.captures.storm + t.captures.surrender);
    const share = (kind: Capture) => pct(sum((t) => t.captures[kind]) / captures);
    const losses = years.flatMap((t) => t.stormLosses);
    console.log(
      `| ${[
        y + 1,
        fmt(median(years.map((t) => t.independent))),
        per((t, p) => t.cities[p]),
        per((t, p) => t.stores[p].gold),
        per((t, p) => t.stores[p].food),
        per((t, p) => t.stores[p].manpower),
        `${share('siege')} / ${share('storm')} / ${share('surrender')} of ${fmt(captures)}`,
        `${pct(median(losses))} (${losses.length})`,
        `${sum((t) => t.fates.occupy)} / ${sum((t) => t.fates.sack)} / ${sum((t) => t.fates.enslave)}`,
        fmt(sum((t) => t.powerTakes)),
        fmt(sum((t) => t.powerBattles)),
      ].join(' | ')} |`,
    );
  }

  const independentAt = (year: number) =>
    ledgers.map((l) => l.years[year - 1]?.independent ?? Number.NaN);
  const half = independentAt(2);
  const fifth = independentAt(5);
  let stalled = 0;
  let unthreatened = 0;
  const stalls = new Map<string, number>();
  for (const ledger of ledgers) {
    for (let y = 0; y < yearCount; y++) {
      const year = ledger.years[y] as Year;
      for (const power of POWERS) {
        const start =
          y === 0 ? ledger.startCities[power] : (ledger.years[y - 1] as Year).cities[power];
        const defeated = ledger.defeatedOn.get(power);
        if (defeated !== undefined && defeated <= y * 365) continue;
        if (year.threatened.has(power) || passive.includes(power)) continue;
        unthreatened++;
        if (year.cities[power] <= start) {
          stalled++;
          const key = `${power} in year ${y + 1}`;
          stalls.set(key, (stalls.get(key) ?? 0) + 1);
        }
      }
    }
  }
  const fighting = [];
  for (let y = 2; y <= yearCount; y++) {
    const n = ledgers.filter((l) => {
      const year = l.years[y - 1] as Year;
      return year.powerTakes + year.powerBattles > 0;
    }).length;
    fighting.push(`year ${y} ${n}/${seeds}`);
  }
  const fightingEvery = ledgers.filter((l) => {
    for (let y = 2; y <= yearCount; y++) {
      const year = l.years[y - 1] as Year;
      if (year.powerTakes + year.powerBattles === 0) return false;
    }
    return true;
  }).length;
  const earlyLoss = ledgers.filter((l) =>
    [...l.defeatedOn.values()].some((day) => day <= 2 * 365),
  ).length;

  console.log('\nTargets over the seeds:\n');
  if (yearCount >= 2) {
    console.log(
      `- Half the ${minors} minor cities independent at the end of year 2: median ${fmt(median(half))}, lowest ${fmt(Math.min(...half))}, seeds at or above ${minors / 2}: ${half.filter((n) => n >= minors / 2).length}/${seeds}. ${mark(median(half) >= minors / 2)}.`,
    );
  }
  if (yearCount >= 5) {
    console.log(
      `- A fifth independent at the end of year 5: median ${fmt(median(fifth))}, lowest ${fmt(Math.min(...fifth))}, seeds at or above ${minors / 5}: ${fifth.filter((n) => n >= minors / 5).length}/${seeds}. ${mark(median(fifth) >= minors / 5)}.`,
    );
  }
  console.log(
    `- A power the AI runs that is never at war that year with a stronger power grows that year: ${unthreatened - stalled} of ${unthreatened} such power-years grew, ${stalled} did not. ${mark(stalled <= unthreatened * 0.1)} (met at 90% or more).${
      stalls.size > 0
        ? ` Those that did not: ${[...stalls]
            .sort((a, b) => b[1] - a[1])
            .map(([key, n]) => `${key} ${n}`)
            .join(', ')}.`
        : ''
    }`,
  );
  console.log(
    `- Powers take cities from each other or fight each other, in seeds: ${fighting.join(', ')}; in every year from year 2: ${fightingEvery}/${seeds}. ${mark(fightingEvery >= seeds * 0.9)} (met at 90% or more of seeds).`,
  );
  console.log(
    `- Seeds where a power is wiped out before year 3: ${earlyLoss}/${seeds}. ${mark(earlyLoss <= 2)}.`,
  );
}
