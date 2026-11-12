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
  MARCH_MORALE,
  RALLY_WAIT_DAYS,
} from '../src/sim/ai/thresholds.ts';
import { RALLY_DISTANCE } from '../src/sim/systems/economy.ts';
import { distance } from '../src/sim/world/find-path.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { parseMap, POWERS, type PowerId } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { executeOrder, type Order } from '../src/sim/orders/orders.ts';
import { SYSTEMS } from '../src/sim/systems.ts';
import { buildWorld } from '../src/sim/world/world.ts';

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
    const retreated = new Set<string>();
    for (const order of today) {
      const refused = executeOrder(next, order, world);
      if (refused) {
        const cause = `${order.kind}: ${refused.reason.replace(/[\w-]*\d[\w.,-]*/g, '#')}`;
        rejected.set(cause, (rejected.get(cause) ?? 0) + 1);
        continue;
      }
      const t = tally(order.faction);
      if (order.kind === 'declareWar') {
        if (t) t.wars++;
        if (order.against === 'rome') warsOnRome++;
      } else if (order.kind === 'storm' && t) {
        if (next.cities[order.city]?.owner === order.faction) t.stormsWon++;
        else t.stormsLost++;
      } else if (order.kind === 'retreat') {
        retreated.add(order.army);
      }
    }
    for (const system of SYSTEMS) system(next, world);
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
    for (const battle of Object.values(state.battles)) {
      if (next.battles[battle.id]) continue;
      for (const side of [battle.attackers, battle.defenders]) {
        const won = side.some((id) => {
          const army = next.armies[id];
          return army && !retreated.has(id) && army.activity.kind !== 'marching';
        });
        const owners = new Set(side.flatMap((id) => state.armies[id]?.owner ?? []));
        for (const owner of owners) {
          const t = tally(owner);
          if (t && won) t.battlesWon++;
          else if (t) t.battlesLost++;
        }
      }
    }
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
  if (passive.length > 0) {
    console.log(
      `- Seeds where a power declares war on Rome: ${games.filter((g) => g.warsOnRome > 0).length}/${SEEDS}.`,
    );
  }
  return games;
}

const allAi = table('Every faction under the AI', []);
table('Rome gives no orders', ['rome' as FactionId]);
const again = play(1, []);
const same = JSON.stringify(again.final) === JSON.stringify(allAi[0]?.final);
console.log(`\nSeed 1 played twice ends in the same state: ${same ? 'yes' : 'no'}.`);
