import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../src/sim/ai/decide.ts';
import { createRouter } from '../src/sim/ai/routes.ts';
import {
  canFight,
  enemiesOf,
  enemyArmies,
  homeCapital,
  meanMorale,
  menUnderArms,
  sorted,
  strengthNear,
  strengthOf,
  targetsOf,
} from '../src/sim/ai/situation.ts';
import {
  ATTACK_ODDS,
  DEFENDER_KM,
  GARRISON_ODDS,
  MARCH_MORALE,
  RALLY_WAIT_DAYS,
} from '../src/sim/ai/thresholds.ts';
import { menOf, RALLY_DISTANCE } from '../src/sim/systems/economy.ts';
import { distance } from '../src/sim/world/find-path.ts';
import { recordEvents } from '../src/sim/events.ts';
import type { ArmyId, FactionId } from '../src/sim/ids.ts';
import { parseMap, POWERS, type PowerId } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { executeOrder, type Order } from '../src/sim/orders/orders.ts';
import { SYSTEMS } from '../src/sim/systems.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import {
  endYear,
  fateChosen,
  observeDay,
  printConquest,
  startLedger,
  stormLoss,
  type ConquestLedger,
} from './sim-ai-conquest.ts';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    years: { type: 'string', default: '5' },
  },
});
const SEEDS = Number(values.seeds);
const YEARS = Number(values.years);
const DAYS_PER_YEAR = 365;

const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const CITY_COUNT = map.provinces.length;

interface PowerTally {
  cities: number[];
  men: number;
  gold: number;
  food: number;
  manpower: number;
  wars: number;
  taken: number;
  lost: number;
  sieges: number;
  stormsWon: number;
  stormsLost: number;
  battlesWon: number;
  battlesLost: number;
  shortYears: number;
}

interface Game {
  final: GameState;
  powers: Map<PowerId, PowerTally>;
  orders: number;
  rejected: Map<string, number>;
  stalls: Map<string, number>;
  tickMs: number[];
  decideMs: number[];
  aliveAfterTwo: number;
  warsOnRome: number;
  longestPeace: number;
  battleDays: number[];
  /** For each army that lost a battle at least 30 days before the end, whether it was alive 30 days later. */
  beatenAlive: boolean[];
  /** For each beaten army, where it went (a city, the field, or nowhere) and whether it lived 30 days: alive, or how it was lost. */
  refugeFates: { went: string; fate: string }[];
  ledger: ConquestLedger;
}

function citiesOf(state: GameState, faction: string): number {
  return Object.values(state.cities).filter((city) => city.owner === faction).length;
}

function play(seed: number, passive: readonly FactionId[]): Game {
  let state = newGame(map, { seed, player: 'rome' });
  const powers = new Map<PowerId, PowerTally>(
    POWERS.map((power) => [
      power,
      {
        cities: [citiesOf(state, power)],
        men: 0,
        gold: 0,
        food: 0,
        manpower: 0,
        wars: 0,
        taken: 0,
        lost: 0,
        sieges: 0,
        stormsWon: 0,
        stormsLost: 0,
        battlesWon: 0,
        battlesLost: 0,
        shortYears: 0,
      },
    ]),
  );
  const tally = (faction: string) => powers.get(faction as PowerId);
  const rejected = new Map<string, number>();
  const decideMs: number[] = [];
  let orders = 0;
  const stalls = new Map<string, number>();
  const tickMs: number[] = [];
  let aliveAfterTwo = 0;
  let warsOnRome = 0;
  const peace = new Map<PowerId, number>();
  let longestPeace = 0;
  const battleDays: number[] = [];
  const beatenAlive: boolean[] = [];
  const beaten = new Map<number, ArmyId[]>();
  const refugeFates: { went: string; fate: string }[] = [];
  const sheltered = new Map<number, { army: ArmyId; went: string }[]>();
  const lostTo = new Map<ArmyId, string>();
  const ledger = startLedger(state);

  for (let day = 1; day <= YEARS * DAYS_PER_YEAR; day++) {
    const started = performance.now();
    const today: Order[] = decideAll(state, world, passive);
    decideMs.push(performance.now() - started);
    orders += today.length;
    for (const power of POWERS) {
      if (passive.includes(power as string as FactionId)) continue;
      const cause = stallCause(state, today, power as string as FactionId);
      if (cause) stalls.set(cause, (stalls.get(cause) ?? 0) + 1);
    }

    // The tick's own steps, played here so that each storm is judged the moment it
    // resolves, before the sieges system can take the city anyway.
    const ticked = performance.now();
    const next = JSON.parse(JSON.stringify(state)) as GameState;
    let ownersAfterOrders = new Map<string, string>();
    const events = recordEvents(next, () => {
      for (const order of today) {
        const beforeStorm =
          order.kind === 'storm' ? (JSON.parse(JSON.stringify(next)) as GameState) : undefined;
        const refused = executeOrder(next, order, world);
        if (refused) {
          const cause = `${order.kind}: ${refused.reason.replace(/[\w-]*\d[\w.,-]*/g, '#')}`;
          rejected.set(cause, (rejected.get(cause) ?? 0) + 1);
          continue;
        }
        fateChosen(ledger, order);
        if (beforeStorm && order.kind === 'storm') stormLoss(ledger, beforeStorm, next, order);
        const t = tally(order.faction);
        if (order.kind === 'declareWar') {
          if (t) t.wars++;
          if (order.against === 'rome') warsOnRome++;
        } else if (order.kind === 'storm' && t) {
          if (next.cities[order.city]?.owner === order.faction) t.stormsWon++;
          else t.stormsLost++;
        }
      }
      ownersAfterOrders = new Map(
        Object.values(next.cities).map((city) => [city.id as string, city.owner as string]),
      );
      for (const system of SYSTEMS) system(next, world);
    });
    tickMs.push(performance.now() - ticked);
    for (const city of Object.values(next.cities)) {
      const before = state.cities[city.id]?.owner;
      if (before === city.owner) continue;
      const winner = tally(city.owner);
      const loser = before && tally(before);
      if (winner) winner.taken++;
      if (loser) loser.lost++;
    }
    for (const siege of Object.values(next.sieges)) {
      if (state.sieges[siege.id]) continue;
      const leader = siege.besiegers[0] && next.armies[siege.besiegers[0]];
      const t = leader && tally(leader.owner);
      if (t) t.sieges++;
    }
    const lostToday: ArmyId[] = [];
    for (const event of events) {
      if (event.kind === 'battleEnded') {
        battleDays.push(event.days);
        for (const side of ['attackers', 'defenders'] as const) {
          for (const owner of event[side].factions) {
            const t = tally(owner);
            if (t && event.winner === side) t.battlesWon++;
            else if (t) t.battlesLost++;
          }
        }
      } else if (event.kind === 'armyRetreated') {
        lostToday.push(event.army);
        const refuge = Object.values(next.cities).some(
          (city) =>
            city.owner === event.owner &&
            Math.hypot(city.position.x - event.to.x, city.position.y - event.to.y) < 1,
        );
        const went = `${event.ordered ? 'withdrew' : 'broke'} to ${refuge ? 'a city' : 'the field'}`;
        sheltered.set(day, [...(sheltered.get(day) ?? []), { army: event.army, went }]);
        lostTo.delete(event.army);
      } else if (
        event.kind === 'armyDestroyed' &&
        (event.cause === 'battle' || event.cause === 'surrender')
      ) {
        lostToday.push(event.army);
      }
    }
    for (const event of events) {
      if (event.kind !== 'armyDestroyed') continue;
      lostTo.set(event.army, event.cause);
      if (event.cause === 'battle' || event.cause === 'surrender') {
        const went = event.cause === 'battle' ? 'destroyed in the battle' : 'surrendered';
        sheltered.set(day, [...(sheltered.get(day) ?? []), { army: event.army, went }]);
      }
    }
    for (const { army, went } of sheltered.get(day - 30) ?? []) {
      const fate = Object.hasOwn(next.armies, army) ? 'alive' : (lostTo.get(army) ?? 'gone');
      refugeFates.push({ went, fate });
    }
    sheltered.delete(day - 30);
    if (lostToday.length > 0) beaten.set(day, lostToday);
    for (const id of beaten.get(day - 30) ?? []) beatenAlive.push(Object.hasOwn(next.armies, id));
    beaten.delete(day - 30);
    observeDay(ledger, state, ownersAfterOrders, next);
    state = next;
    for (const power of POWERS) {
      const faction = power as string as FactionId;
      const calm =
        !passive.includes(faction) &&
        state.factions[faction]?.defeatedOn === null &&
        enemiesOf(state, faction).size === 0;
      const days = calm ? (peace.get(power) ?? 0) + 1 : 0;
      peace.set(power, days);
      longestPeace = Math.max(longestPeace, days);
    }
    if (day % DAYS_PER_YEAR === 0) {
      endYear(ledger, state);
      for (const [power, t] of powers) {
        t.cities.push(citiesOf(state, power));
        const stores = state.factions[power as string as FactionId]?.stores;
        const alive = state.factions[power as string as FactionId]?.defeatedOn === null;
        if (alive && stores && (stores.gold < 0 || stores.food < 0)) t.shortYears++;
      }
      if (day === 2 * DAYS_PER_YEAR) {
        aliveAfterTwo = POWERS.filter(
          (p) => state.factions[p as string as FactionId]?.defeatedOn === null,
        ).length;
      }
    }
  }
  for (const [power, t] of powers) {
    const faction = power as string as FactionId;
    const stores = state.factions[faction]?.stores ?? { gold: 0, food: 0, manpower: 0 };
    t.men = menUnderArms(state, faction);
    t.gold = stores.gold;
    t.food = stores.food;
    t.manpower = stores.manpower;
  }
  if (YEARS < 2) aliveAfterTwo = Number.NaN;
  return {
    final: state,
    powers,
    orders,
    rejected,
    stalls,
    tickMs,
    decideMs,
    aliveAfterTwo,
    warsOnRome,
    longestPeace,
    battleDays,
    beatenAlive,
    refugeFates,
    ledger,
  };
}

/**
 * A stall is a day on which a great power the AI runs has an idle army that can fight,
 * is at war with a faction holding a city that army can reach, and gives no order. Each
 * is put down to the first cause that holds for one of its idle armies, or to "other".
 */
function stallCause(
  state: GameState,
  orders: readonly Order[],
  faction: FactionId,
): string | undefined {
  if (state.factions[faction]?.defeatedOn !== null) return undefined;
  if (orders.some((order) => order.faction === faction)) return undefined;
  const enemies = enemiesOf(state, faction);
  if (enemies.size === 0) return undefined;
  const router = createRouter(state, world, faction);
  const enemyCities = sorted(state.cities).filter((city) => enemies.has(city.owner));
  const takeable = new Set(targetsOf(state, faction, enemies).map((city) => city.id));
  const hostile = enemyArmies(state, faction, enemies);
  const causes: string[] = [];
  const capital = homeCapital(state, world, faction);
  for (const army of sorted(state.armies)) {
    if (army.owner !== faction || army.activity.kind !== 'idle' || !canFight(state, army)) continue;
    const at = army.activity.position;
    const open = enemyCities.filter((city) => router.reaches(at, city));
    if (open.length === 0) continue;
    if (!open.some((city) => takeable.has(city.id))) {
      causes.push("every enemy city it reaches is besieged under another power's lead");
    } else if (meanMorale(state, army) < MARCH_MORALE) {
      causes.push('resting, morale below MARCH_MORALE');
    } else if (
      Object.values(state.cities).some(
        (city) =>
          city.owner === faction &&
          distance(city.position, at) <= RALLY_DISTANCE &&
          city.recruits.some((r) => r.readyOn - state.day <= RALLY_WAIT_DAYS),
      )
    ) {
      causes.push('waiting for recruits that muster within RALLY_WAIT_DAYS');
    } else if (
      open.every(
        (city) => !takeable.has(city.id) || menOf(state, army) < GARRISON_ODDS * city.garrison,
      )
    ) {
      causes.push('too few men alone to blockade the garrison of every city it reaches, gathering');
    } else if (
      open.every(
        (city) =>
          !takeable.has(city.id) ||
          strengthOf(state, army) <
            ATTACK_ODDS * strengthNear(state, hostile, city.position, DEFENDER_KM),
      )
    ) {
      causes.push('too weak alone for the defenders of every city it reaches, gathering');
    } else if (capital && distance(capital.position, at) <= RALLY_DISTANCE) {
      causes.push('guarding the capital, the weakest army there');
    } else {
      causes.push('other');
    }
  }
  if (causes.length === 0) return undefined;
  return causes.includes('other') ? 'other' : causes[0];
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

const fmt = (n: number, digits = 0) =>
  n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function table(title: string, passive: readonly FactionId[]) {
  const games: Game[] = [];
  for (let seed = 1; seed <= SEEDS; seed++) games.push(play(seed, passive));

  console.log(`\n## ${title}\n`);
  console.log(
    `${SEEDS} seeds, ${YEARS} years. Means over the seeds. Cities: start, then after each year. Storms and battles are won/lost.\n`,
  );
  const header = [
    'power',
    'cities',
    'men',
    'gold',
    'food',
    'manpower',
    'wars',
    'taken',
    'lost',
    'sieges',
    'storms',
    'battles',
  ];
  console.log(`| ${header.join(' | ')} |`);
  console.log(`| ${header.map(() => '---').join(' | ')} |`);
  for (const power of POWERS) {
    const all = games.map((g) => g.powers.get(power) as PowerTally);
    const avg = (pick: (t: PowerTally) => number, digits = 0) => fmt(mean(all.map(pick)), digits);
    const cities = all[0]?.cities.map((_, year) => avg((t) => t.cities[year] ?? 0, 1)).join(' → ');
    console.log(
      `| ${[
        power + (passive.includes(power as string as FactionId) ? ' (passive)' : ''),
        cities,
        avg((t) => t.men),
        avg((t) => t.gold),
        avg((t) => t.food),
        avg((t) => t.manpower),
        avg((t) => t.wars, 1),
        avg((t) => t.taken, 1),
        avg((t) => t.lost, 1),
        avg((t) => t.sieges, 1),
        `${avg((t) => t.stormsWon, 1)}/${avg((t) => t.stormsLost, 1)}`,
        `${avg((t) => t.battlesWon, 1)}/${avg((t) => t.battlesLost, 1)}`,
      ].join(' | ')} |`,
    );
  }

  const orders = games.reduce((sum, g) => sum + g.orders, 0);
  const causes = new Map<string, number>();
  for (const g of games)
    for (const [cause, n] of g.rejected) causes.set(cause, (causes.get(cause) ?? 0) + n);
  const refused = [...causes.values()].reduce((a, b) => a + b, 0);
  const grew = games.filter(
    (g) =>
      POWERS.filter(
        (p) => (g.powers.get(p)?.cities.at(-1) ?? 0) > (g.powers.get(p)?.cities[0] ?? 0),
      ).length >= 3,
  ).length;
  const dominant = games.filter((g) =>
    POWERS.some((p) => (g.powers.get(p)?.cities.at(-1) ?? 0) > CITY_COUNT / 2),
  ).length;
  const alive = games.filter((g) => g.aliveAfterTwo >= 4).length;
  const short = games.filter((g) =>
    POWERS.some((p) => (g.powers.get(p)?.shortYears ?? 0) > 0),
  ).length;
  const times = games.flatMap((g) => g.decideMs).sort((a, b) => a - b);

  console.log('');
  console.log(
    `- Orders given: ${fmt(orders)}. Rejected: ${fmt(refused)} (${fmt((100 * refused) / Math.max(1, orders), 2)}%).`,
  );
  for (const [cause, n] of [...causes].sort((a, b) => b[1] - a[1]))
    console.log(`  - ${n} × ${cause}`);
  const stalls = new Map<string, number>();
  for (const g of games) {
    for (const [cause, n] of g.stalls) stalls.set(cause, (stalls.get(cause) ?? 0) + n);
  }
  const stallDays = [...stalls.values()].reduce((a, b) => a + b, 0);
  console.log(
    `- Stall days, on which a power with an idle army and a reachable enemy city gave no order: ${fmt(stallDays)} of ${fmt(SEEDS * YEARS * DAYS_PER_YEAR * (POWERS.length - passive.length))} power-days of the powers the AI runs.`,
  );
  for (const [cause, n] of [...stalls].sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${n} × ${cause}`);
  }
  const ticks = games.flatMap((g) => g.tickMs);
  console.log(
    `- Decisions per day, all factions: mean ${fmt(mean(times), 2)} ms, p99 ${fmt(times[Math.floor(times.length * 0.99)] ?? 0, 2)} ms, max ${fmt(times.at(-1) ?? 0, 2)} ms. One tick: mean ${fmt(mean(ticks), 2)} ms.`,
  );
  console.log(
    `- Seeds where at least three powers hold more cities than at the start: ${grew}/${SEEDS}.`,
  );
  console.log(
    `- Seeds where a power holds more than half the ${CITY_COUNT} cities: ${dominant}/${SEEDS}.`,
  );
  console.log(`- Seeds with at least four great powers alive after two years: ${alive}/${SEEDS}.`);
  const peaces = games.map((g) => g.longestPeace);
  console.log(
    `- Longest stretch a great power the AI runs stayed at peace with everyone: mean over seeds ${fmt(mean(peaces))} days, longest ${fmt(Math.max(...peaces))} days.`,
  );
  console.log(
    `- Seeds where a great power ends a year with gold or food below zero: ${short}/${SEEDS}.`,
  );
  const lengths = games.flatMap((g) => g.battleDays).sort((a, b) => a - b);
  const at = (q: number) =>
    lengths[Math.min(lengths.length - 1, Math.floor(q * lengths.length))] ?? 0;
  console.log(
    `- Battles: ${fmt(lengths.length)}. Days fought: 10th percentile ${at(0.1)}, median ${at(0.5)}, 90th percentile ${at(0.9)}. Over in one day: ${fmt((100 * lengths.filter((d) => d === 1).length) / Math.max(1, lengths.length), 1)}%.`,
  );
  const beaten = games.flatMap((g) => g.beatenAlive);
  console.log(
    `- Armies that lost a battle and were still alive 30 days later: ${fmt(beaten.filter(Boolean).length)} of ${fmt(beaten.length)} (${fmt((100 * beaten.filter(Boolean).length) / Math.max(1, beaten.length), 1)}%).`,
  );
  const fates = games.flatMap((g) => g.refugeFates);
  console.log(
    '- Beaten armies by where they went, alive 30 days later, and how the rest were lost:',
  );
  for (const went of [...new Set(fates.map((f) => f.went))].sort()) {
    const of = fates.filter((f) => f.went === went);
    const living = of.filter((f) => f.fate === 'alive').length;
    const losses = new Map<string, number>();
    for (const { fate } of of) if (fate !== 'alive') losses.set(fate, (losses.get(fate) ?? 0) + 1);
    console.log(
      `  - ${went}: ${fmt(living)} of ${fmt(of.length)} alive (${fmt((100 * living) / Math.max(1, of.length), 1)}%). Lost: ${[...losses].map(([cause, n]) => `${n} × ${cause}`).join(', ') || 'none'}.`,
    );
  }
  if (passive.length > 0) {
    console.log(
      `- Seeds where a power declares war on Rome: ${games.filter((g) => g.warsOnRome > 0).length}/${SEEDS}.`,
    );
  }
  printConquest(
    games.map((g) => g.ledger),
    passive,
  );
  return games;
}

const allAi = table('Every faction under the AI', []);
table('Rome gives no orders', ['rome' as FactionId]);
const again = play(1, []);
const same = JSON.stringify(again.final) === JSON.stringify(allAi[0]?.final);
console.log(`\nSeed 1 played twice ends in the same state: ${same ? 'yes' : 'no'}.`);
