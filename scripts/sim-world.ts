import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { decideAll } from '../src/sim/ai/decide.ts';
import { createRouter } from '../src/sim/ai/routes.ts';
import { canFight, enemiesOf, sorted } from '../src/sim/ai/situation.ts';
import { GARRISON_ODDS } from '../src/sim/ai/thresholds.ts';
import type { CityId, FactionId } from '../src/sim/ids.ts';
import { parseMap, POWERS, type PowerId } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { SYSTEMS, type System } from '../src/sim/systems.ts';
import { sieges } from '../src/sim/systems/sieges.ts';
import { tick } from '../src/sim/tick.ts';
import { areAtWar } from '../src/sim/wars.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { createStandoffCounter, standoffLines, type Standoffs } from './standoffs.ts';

/**
 * Plays the new game with every faction under the AI for many years and prints what
 * decides whether the world stays open: who leads at the end, who is alive, how often
 * the AI starts the same siege again or loses an army to sallies, how long a power at
 * war sits still, and the first city each power takes on the first five seeds.
 */

const { values } = parseArgs({
  options: {
    from: { type: 'string', default: '1' },
    seeds: { type: 'string', default: '20' },
    years: { type: 'string', default: '10' },
    conquests: { type: 'string', default: '5' },
  },
});
const FROM = Number(values.from);
const SEEDS = Number(values.seeds);
const YEARS = Number(values.years);
const CONQUEST_SEEDS = Number(values.conquests);
const YEAR = 365;
/** A siege begun again within this many days of the same power's last siege of the city ended. */
const RESTART_DAYS = 30;
/** A battle this close to a city, in km, counts as a battle for it. */
const BATTLE_KM = 40;

const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const CITY_COUNT = map.provinces.length;

interface Conquest {
  city: string;
  battle?: { day: number; days: number; lost: [number, number] };
  siegeOn?: number;
  fellOn: number;
}

interface Seed {
  seed: number;
  cities: Record<PowerId, number>;
  alive: number;
  sieges: number;
  restarts: number;
  repeatedMarches: number;
  sallyArmies: number;
  sallyMen: number;
  /** For each army in each battle, how many times it changed its stance in that battle. */
  stanceChanges: number[];
  /** For each war a great power declared, the days until it first fought, besieged, or marched on the enemy, or undefined if it never did within a year. */
  firstActs: (number | undefined)[];
  /** Attacks a great power lost to the same enemy within 50 km and 90 days of an attack it lost before. */
  lostAgain: number;
  /** Wars declared less than a year before the end that had seen no act yet. */
  pendingActs: number;
  quiet: { power: PowerId; days: number; from: number };
  /** The same, counting only days on which its idle armies together could take an enemy city they have a route to. */
  quietStrong: { power: PowerId; days: number; from: number };
  conquests: Partial<Record<PowerId, Conquest>>;
  standoffs: Standoffs;
}

function play(seed: number): Seed {
  let state: GameState = newGame(map, { seed, player: 'rome' });
  const siegeEnded = new Map<string, number>();
  const ownerChanged = new Map<CityId, number>();
  const lastMarch = new Map<string, number>();
  const battles: {
    day: number;
    days: number;
    at: { x: number; y: number };
    sides: [FactionId[], FactionId[]];
    lost: [number, number];
  }[] = [];
  const firstSiege = new Map<string, number>();
  const conquests: Partial<Record<PowerId, Conquest>> = {};
  const quietRun = new Map<PowerId, { days: number; from: number }>();
  let quiet: Seed['quiet'] = { power: 'rome', days: 0, from: 0 };
  const strongRun = new Map<PowerId, { days: number; from: number }>();
  let quietStrong: Seed['quiet'] = { power: 'rome', days: 0, from: 0 };
  let sieges = 0;
  let restarts = 0;
  let repeatedMarches = 0;
  let sallyArmies = 0;
  const sallies = { men: 0 };
  const losses = new Map<string, { day: number; at: { x: number; y: number } }[]>();
  let lostAgain = 0;
  const declared: { by: FactionId; against: FactionId; on: number }[] = [];
  const firstActs: (number | undefined)[] = [];
  const stanceChanges = new Map<string, number>();
  const standoffs = createStandoffCounter(world);

  for (let day = 1; day <= YEARS * YEAR; day++) {
    const orders: Order[] = decideAll(state, world, []);
    for (const army of Object.values(state.armies)) {
      if (army.activity.kind !== 'inBattle') continue;
      const key = `${army.activity.battle}|${army.id}`;
      stanceChanges.set(key, stanceChanges.get(key) ?? 0);
    }
    for (const order of orders) {
      const army = order.kind === 'setStance' ? state.armies[order.army] : undefined;
      if (
        order.kind === 'setStance' &&
        army?.activity.kind === 'inBattle' &&
        army.stance !== order.stance
      ) {
        const key = `${army.activity.battle}|${army.id}`;
        stanceChanges.set(key, (stanceChanges.get(key) ?? 0) + 1);
      }
      if (order.kind !== 'moveArmy') continue;
      const key = `${order.army}@${order.to.x},${order.to.y}`;
      const last = lastMarch.get(key);
      if (last !== undefined && day - last <= RESTART_DAYS) repeatedMarches++;
      lastMarch.set(key, day);
    }
    const before = state;
    const { state: next, events } = tick(state, orders, world, systemsCounting(sallies));

    for (const event of events) {
      if (event.kind === 'warDeclared' && state.factions[event.by]?.kind === 'greatPower') {
        declared.push({ by: event.by, against: event.against, on: day });
      }
    }
    for (const war of [...declared]) {
      const enemyCity = (point: { x: number; y: number }) =>
        Object.values(next.cities).some(
          (city) =>
            city.owner === war.against &&
            Math.hypot(city.position.x - point.x, city.position.y - point.y) <= 10,
        );
      const fought = events.some(
        (event) =>
          event.kind === 'battleBegan' &&
          ((event.attackers.includes(war.by) && event.defenders.includes(war.against)) ||
            (event.defenders.includes(war.by) && event.attackers.includes(war.against))),
      );
      const besieged = Object.values(next.sieges).some(
        (siege) =>
          next.cities[siege.city]?.owner === war.against &&
          siege.besiegers.some((id) => next.armies[id]?.owner === war.by),
      );
      const marched = orders.some(
        (order) =>
          order.faction === war.by &&
          ((order.kind === 'moveArmy' && enemyCity(order.to)) ||
            (order.kind === 'embark' && next.cities[order.to]?.owner === war.against)),
      );
      const over = !areAtWar(next, war.by, war.against);
      if (fought || besieged || marched || over || day - war.on >= 365) {
        firstActs.push(fought || besieged || marched ? day - war.on : undefined);
        declared.splice(declared.indexOf(war), 1);
      }
    }
    for (const event of events) {
      if (event.kind === 'armyDestroyed' && event.cause === 'sally') {
        sallyArmies++;
      } else if (event.kind === 'battleEnded') {
        if (event.winner === 'defenders') {
          const losers = event.attackers;
          const winners = event.defenders;
          for (const loser of losers.factions.filter(
            (id) => state.factions[id]?.kind === 'greatPower',
          )) {
            for (const winner of winners.factions) {
              const key = `${loser}|${winner}`;
              const before = losses.get(key) ?? [];
              if (
                before.some(
                  (l) =>
                    day - l.day <= 90 &&
                    Math.hypot(l.at.x - event.position.x, l.at.y - event.position.y) <= 50,
                )
              ) {
                lostAgain++;
              }
              losses.set(key, [
                ...before.filter((l) => day - l.day <= 90),
                { day, at: event.position },
              ]);
            }
          }
        }
        battles.push({
          day: event.startedOn,
          days: event.days,
          at: event.position,
          sides: [[...event.attackers.factions], [...event.defenders.factions]],
          lost: [event.attackers.lost, event.defenders.lost],
        });
      }
    }
    for (const siege of Object.values(before.sieges)) {
      if (next.sieges[siege.id]) continue;
      const leader = before.armies[siege.besiegers[0] ?? ('' as never)]?.owner;
      const ordered = orders.some(
        (order) =>
          (order.kind === 'moveArmy' || order.kind === 'embark') &&
          siege.besiegers.includes(order.army),
      );
      if (leader && ordered) siegeEnded.set(`${leader}|${siege.city}`, day);
    }
    for (const siege of Object.values(next.sieges)) {
      if (before.sieges[siege.id]) continue;
      const leader = next.armies[siege.besiegers[0] ?? ('' as never)]?.owner;
      if (!leader) continue;
      sieges++;
      const key = `${leader}|${siege.city}`;
      const ended = siegeEnded.get(key);
      const changed = ownerChanged.get(siege.city) ?? 0;
      if (ended !== undefined && day - ended <= RESTART_DAYS && changed < ended) {
        restarts++;
        if (process.env.DEBUG)
          console.error(`restart seed ${seed} day ${day} ${key} ended ${ended}`);
      }
      if (!firstSiege.has(key)) firstSiege.set(key, day);
    }
    for (const city of Object.values(next.cities)) {
      const was = before.cities[city.id];
      if (!was || was.owner === city.owner) continue;
      ownerChanged.set(city.id, day);
      const power = city.owner as string as PowerId;
      if (!(POWERS as readonly string[]).includes(power) || conquests[power]) continue;
      const fought = battles.filter(
        (b) =>
          day - b.day <= 150 &&
          Math.hypot(b.at.x - city.position.x, b.at.y - city.position.y) <= BATTLE_KM &&
          b.sides.some((side) => side.includes(city.owner)) &&
          b.sides.some((side) => side.includes(was.owner)),
      );
      const first = fought[0];
      const ours = first?.sides[0].includes(city.owner) ? 0 : 1;
      conquests[power] = {
        city: city.name,
        ...(first && {
          battle: {
            day: first.day,
            days: first.days,
            lost: [first.lost[ours], first.lost[1 - ours]] as [number, number],
          },
        }),
        ...(firstSiege.has(`${power}|${city.id}`) && {
          siegeOn: firstSiege.get(`${power}|${city.id}`),
        }),
        fellOn: day,
      };
    }

    for (const power of POWERS) {
      const faction = power as string as FactionId;
      const record = next.factions[faction];
      const busy =
        orders.some((order) => order.faction === faction) ||
        Object.values(next.armies).some(
          (army) => army.owner === faction && army.activity.kind !== 'idle',
        );
      const run = quietRun.get(power) ?? { days: 0, from: day };
      const now =
        !busy && record?.defeatedOn === null && couldFight(next, faction)
          ? { days: run.days + 1, from: run.days === 0 ? day : run.from }
          : { days: 0, from: day };
      quietRun.set(power, now);
      if (now.days > quiet.days) quiet = { power, ...now };
      const strong = strongRun.get(power) ?? { days: 0, from: day };
      const strongNow =
        now.days > 0 && couldTake(next, faction)
          ? { days: strong.days + 1, from: strong.days === 0 ? day : strong.from }
          : { days: 0, from: day };
      strongRun.set(power, strongNow);
      if (strongNow.days > quietStrong.days) quietStrong = { power, ...strongNow };
    }
    standoffs.observe(next);
    state = next;
  }

  const cities = Object.fromEntries(POWERS.map((p) => [p, 0])) as Record<PowerId, number>;
  for (const city of Object.values(state.cities)) {
    if (city.owner in cities) cities[city.owner as string as PowerId]++;
  }
  const alive = POWERS.filter(
    (p) => state.factions[p as string as FactionId]?.defeatedOn === null,
  ).length;
  return {
    seed,
    cities,
    alive,
    sieges,
    restarts,
    repeatedMarches,
    sallyArmies,
    sallyMen: sallies.men,
    lostAgain,
    firstActs,
    pendingActs: declared.length,
    stanceChanges: [...stanceChanges.values()],
    quiet,
    quietStrong,
    conquests,
    standoffs: standoffs.result(),
  };
}

/**
 * The day's systems, with the sieges system counting the men the garrisons' sallies cut
 * down: what the armies in a siege that still stands lost while it ran, and every army
 * it removed, which only a sally does.
 */
function systemsCounting(sallies: { men: number }): readonly System[] {
  const counted: System = (state) => {
    const menOf = (id: string) =>
      (state.armies[id as never]?.formations ?? []).reduce(
        (sum, f) => sum + (state.formations[f]?.men ?? 0),
        0,
      );
    const before = new Map(
      Object.values(state.armies)
        .filter((army) => army.activity.kind === 'idle' || army.activity.kind === 'besieging')
        .map((army) => [army.id as string, menOf(army.id)]),
    );
    sieges(state);
    for (const [id, men] of before) {
      const army = state.armies[id as never];
      if (!army) sallies.men += men;
      else if (army.activity.kind === 'besieging' && state.sieges[army.activity.siege]) {
        sallies.men += men - menOf(id);
      }
    }
  };
  return SYSTEMS.map((system) => (system === sieges ? counted : system));
}

/** Whether the faction is at war and has an idle army that can fight and reaches an enemy city. */
function couldFight(state: GameState, faction: FactionId): boolean {
  const enemies = enemiesOf(state, faction);
  if (enemies.size === 0) return false;
  const idle = sorted(state.armies).filter(
    (army) => army.owner === faction && army.activity.kind === 'idle' && canFight(state, army),
  );
  if (idle.length === 0) return false;
  const router = createRouter(state, world, faction);
  const cities = sorted(state.cities).filter((city) => enemies.has(city.owner));
  return idle.some((army) =>
    cities.some(
      (city) => army.activity.kind === 'idle' && router.reaches(army.activity.position, city),
    ),
  );
}

/**
 * Whether the faction's idle armies together have GARRISON_ODDS times the garrison of an
 * enemy city that one of them has a route to, so the war is one it could fight.
 */
function couldTake(state: GameState, faction: FactionId): boolean {
  const enemies = enemiesOf(state, faction);
  const idle = sorted(state.armies).filter(
    (army) => army.owner === faction && army.activity.kind === 'idle' && canFight(state, army),
  );
  const men = idle.reduce(
    (sum, army) => sum + army.formations.reduce((m, f) => m + (state.formations[f]?.men ?? 0), 0),
    0,
  );
  const router = createRouter(state, world, faction);
  return sorted(state.cities).some(
    (city) =>
      enemies.has(city.owner) &&
      men >= GARRISON_ODDS * city.garrison &&
      idle.some(
        (army) =>
          army.activity.kind === 'idle' &&
          router.routeTo(army.activity.position, city) !== undefined,
      ),
  );
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? Number.NaN : (s[Math.floor((s.length - 1) / 2)] as number);
};
const mark = (ok: boolean) => (ok ? 'met' : 'NOT met');

const games: Seed[] = [];
for (let seed = FROM; seed < FROM + SEEDS; seed++) games.push(play(seed));

console.log(`## The world after ${YEARS} years, seeds ${FROM} to ${FROM + SEEDS - 1}\n`);
console.log(
  `| seed | ${POWERS.join(' | ')} | largest | alive | sieges | begun again after leaving | marches repeated | armies lost to sallies (men) | longest quiet war, with an army that could fight |`,
);
console.log(
  `| ${['---', ...POWERS.map(() => '---'), '---', '---', '---', '---', '---', '---', '---'].join(' | ')} |`,
);
const leaders: PowerId[] = [];
for (const g of games) {
  const top = Math.max(...POWERS.map((p) => g.cities[p]));
  const leader = POWERS.find((p) => g.cities[p] === top) as PowerId;
  leaders.push(leader);
  console.log(
    `| ${[
      g.seed,
      ...POWERS.map((p) => g.cities[p]),
      `${leader} ${top}`,
      g.alive,
      g.sieges,
      g.restarts,
      g.repeatedMarches,
      `${g.sallyArmies} (${g.sallyMen})`,
      `${g.quiet.days} days, ${g.quiet.power} from day ${g.quiet.from}; could take: ${g.quietStrong.days} days, ${g.quietStrong.power} from day ${g.quietStrong.from}`,
    ].join(' | ')} |`,
  );
}
const half = games.filter(
  (g) => Math.max(...POWERS.map((p) => g.cities[p])) <= CITY_COUNT / 2,
).length;
const three = games.filter((g) => g.alive >= 3).length;
const leadCount = POWERS.map((p) => [p, leaders.filter((l) => l === p).length] as const);
const most = Math.max(...leadCount.map(([, n]) => n));
const need = (share: number) => Math.ceil(share * SEEDS);
console.log('\nTargets:\n');
console.log(
  `- The largest power holds at most half the ${CITY_COUNT} cities: ${half}/${SEEDS}. ${mark(half >= need(0.8))} (at least ${need(0.8)}).`,
);
console.log(
  `- At least three powers alive: ${three}/${SEEDS}. ${mark(three >= need(0.8))} (at least ${need(0.8)}).`,
);
console.log(
  `- Seeds each power is the largest: ${leadCount.map(([p, n]) => `${p} ${n}`).join(', ')}. ${mark(most <= SEEDS * 0.4)} (none more than ${Math.floor(SEEDS * 0.4)}).`,
);
const sum = (pick: (g: Seed) => number) => games.reduce((s, g) => s + pick(g), 0);
for (const line of standoffLines(games.map((g) => g.standoffs))) console.log(line);
console.log(
  `- Sieges begun: ${sum((g) => g.sieges)}. Begun again by the same power within ${RESTART_DAYS} days of ordering its besiegers away from the city: ${sum((g) => g.restarts)}.`,
);
console.log(
  `- The same march ordered again within ${RESTART_DAYS} days: ${sum((g) => g.repeatedMarches)}.`,
);
const acts = games.flatMap((g) => g.firstActs);
const acted = acts.filter((d): d is number => d !== undefined);
const pending = games.reduce((sum, g) => sum + g.pendingActs, 0);
console.log(
  `- Wars declared by a great power: ${acts.length + pending}, of which ${pending} were declared less than a year before the end and had seen no act yet, and are left out of what follows. Of the other ${acts.length}: days until it first fought, besieged, or marched on the enemy: median ${median(acted)}, 90th percentile ${[...acted].sort((a, b) => a - b)[Math.floor(acted.length * 0.9)] ?? 0}. Never within a year, or before the war ended: ${acts.length - acted.length}.`,
);
console.log(
  `- Attacks a great power lost to the same enemy within 50 km and 90 days of one it lost before: ${games.reduce((sum, g) => sum + g.lostAgain, 0)}.`,
);
const changes = games.flatMap((g) => g.stanceChanges);
console.log(
  `- Changes of stance by one army in one battle, over ${changes.length} army-battles: median ${median(changes)}, most ${Math.max(0, ...changes)}, none in ${changes.filter((n) => n === 0).length}.`,
);
console.log(
  `- Armies lost to sallies: ${sum((g) => g.sallyArmies)}. Men lost to sallies: ${sum((g) => g.sallyMen)}.`,
);
console.log(
  `- Longest stretch a power at war had an idle army that could reach an enemy city, no army on the move, and gave no order: median ${median(games.map((g) => g.quiet.days))} days, longest ${Math.max(...games.map((g) => g.quiet.days))} days.`,
);
console.log(
  `- The same, counting only days on which its idle armies together had the men to take an enemy city they had a route to: median ${median(games.map((g) => g.quietStrong.days))} days, longest ${Math.max(...games.map((g) => g.quietStrong.days))} days.`,
);

if (CONQUEST_SEEDS > 0) {
  console.log(
    `\n## The first city each power takes, seeds ${FROM} to ${FROM + Math.min(SEEDS, CONQUEST_SEEDS) - 1}\n`,
  );
  console.log(
    '| seed | power | city | battle on day | days fought | lost, power / defender | siege from day | fell on day |',
  );
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const g of games.slice(0, CONQUEST_SEEDS)) {
    for (const power of POWERS) {
      const c = g.conquests[power];
      if (!c) {
        console.log(`| ${g.seed} | ${power} | none | | | | | |`);
        continue;
      }
      console.log(
        `| ${[
          g.seed,
          power,
          c.city,
          c.battle?.day ?? 'no battle',
          c.battle?.days ?? '',
          c.battle ? `${c.battle.lost[0]} / ${c.battle.lost[1]}` : '',
          c.siegeOn ?? 'no siege',
          c.fellOn,
        ].join(' | ')} |`,
      );
    }
  }
}
