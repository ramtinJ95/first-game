import { readFileSync } from 'node:fs';
import { nameNewArmy } from '../src/sim/army-names.ts';
import { allocateId, type ArmyId, type CityId, type FactionId } from '../src/sim/ids.ts';
import { parseMap } from '../src/sim/map.ts';
import { newGame, STARTING_FORMATIONS, STARTING_GENERAL_SKILL } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import { removeArmy } from '../src/sim/armies.ts';
import type { City } from '../src/sim/state/city.ts';
import type { Stores } from '../src/sim/state/faction.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import { newWar, warKey } from '../src/sim/state/war.ts';
import { surfaceAt } from '../src/sim/world/find-path.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { menOf, OUTPUT_PER_PERSON } from '../src/sim/systems/economy.ts';
import { tick } from '../src/sim/tick.ts';
import type { Troop } from '../src/sim/troops.ts';

type Troops = Partial<Record<Troop, number>>;

/** Rome besieges either the minor city nearest Roma or Carthago. Edit this list to tune. */
interface Case {
  name: string;
  target: 'minor' | 'capital';
  army: Troops;
  /** Storm on the first day of the siege. */
  storm?: boolean;
  /** An army of the city's owner that comes up beside the besiegers on this day. */
  relief?: { day: number; army: Troops };
  /** Play the three fates of the city after it falls. */
  fates?: boolean;
}

const STARTING_ARMY: Troops = Object.fromEntries(STARTING_FORMATIONS.map((f) => [f.troop, f.men]));

const CASES: Case[] = [
  { name: 'siege: starting army v minor city', target: 'minor', army: STARTING_ARMY, fates: true },
  {
    name: 'siege: starting army v great capital',
    target: 'capital',
    army: STARTING_ARMY,
    fates: true,
  },
  {
    name: 'storm day 1: starting army v minor, walls up',
    target: 'minor',
    army: STARTING_ARMY,
    storm: true,
    fates: true,
  },
  {
    name: 'storm day 1: 500 spearmen v minor, walls up',
    target: 'minor',
    army: { spearmen: 500 },
    storm: true,
  },
  {
    name: 'relief of 3,000 on day 20 v starting army at minor',
    target: 'minor',
    army: STARTING_ARMY,
    relief: { day: 20, army: { spearmen: 3000 } },
  },
  {
    name: 'relief of 600 on day 20 v starting army at minor',
    target: 'minor',
    army: STARTING_ARMY,
    relief: { day: 20, army: { spearmen: 600 } },
  },
  { name: 'token siege: 100 spearmen v minor city', target: 'minor', army: { spearmen: 100 } },
  {
    name: 'beyond means: 6,000 spearmen v great capital',
    target: 'capital',
    army: { spearmen: 6000 },
  },
];

const SEEDS = 50;
const MAX_DAYS = 400;
const ROME = 'rome' as FactionId;
/** Gold worth of one unit of each store: a person makes them at these rates, so each is worth the gold made alongside it. */
const WORTH: Stores = {
  gold: 1,
  food: OUTPUT_PER_PERSON.gold / OUTPUT_PER_PERSON.food,
  manpower: OUTPUT_PER_PERSON.gold / OUTPUT_PER_PERSON.manpower,
};

const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);

function targetOf(state: GameState, target: Case['target']): City {
  const roma = state.cities['roma' as CityId];
  if (!roma) throw new Error('the map has no Roma');
  const candidates = Object.values(state.cities).filter((city) =>
    target === 'minor' ? city.rank === 'minorCity' : city.id === 'carthago',
  );
  const [city] = candidates.sort(
    (a, b) => far(a.position, roma.position) - far(b.position, roma.position),
  );
  if (!city) throw new Error(`the map has no ${target} target`);
  return city;
}

function addArmy(state: GameState, owner: FactionId, troops: Troops, position: MapPoint): ArmyId {
  const id = allocateId(state, 'army');
  const formations = Object.entries(troops).map(([troop, men]) => {
    const formation = allocateId(state, 'formation');
    state.formations[formation] = {
      id: formation,
      army: id,
      troop: troop as Troop,
      men,
      morale: 1,
    };
    return formation;
  });
  state.armies[id] = {
    id,
    owner,
    name: nameNewArmy(state, owner),
    formations,
    stance: 'holdTheLine',
    generalSkill: STARTING_GENERAL_SKILL,
    activity: { kind: 'idle', position },
  };
  return id;
}

function setUp(c: Case, seed: number) {
  const state = newGame(map, { seed, player: 'rome' });
  const city = targetOf(state, c.target);
  for (const army of Object.values(state.armies)) {
    if (army.owner === ROME || army.owner === city.owner) removeArmy(state, army, 'defeat');
  }
  state.wars[warKey(ROME, city.owner)] = newWar(ROME, city.owner, state.day);
  const camp = [
    { x: 3, y: 0 },
    { x: -3, y: 0 },
    { x: 0, y: 3 },
    { x: 0, y: -3 },
  ]
    .map(({ x, y }) => ({ x: city.position.x + x, y: city.position.y + y }))
    .find((point) => surfaceAt(world.mesh, point) === 'land');
  if (!camp) throw new Error(`${city.id} has no land beside it to camp on`);
  addArmy(state, ROME, c.army, camp);
  return { state, city: city.id, defender: city.owner, camp };
}

const sideMen = (state: GameState, owner: FactionId) =>
  Object.values(state.armies)
    .filter((army) => army.owner === owner)
    .reduce((sum, army) => sum + menOf(state, army), 0);

interface Run {
  stormed: boolean;
  fell: boolean;
  days: number;
  attackerLost: number;
  defenderLost: number;
  state: GameState;
}

function play(c: Case, seed: number): Run {
  const { state: start, city, defender, camp } = setUp(c, seed);
  let state = start;
  const attackerStart = sideMen(state, ROME);
  const garrison = state.cities[city]?.garrison ?? 0;
  let reliefMen = 0;
  let stormed = false;
  for (let day = 1; day <= MAX_DAYS; day += 1) {
    if (c.relief?.day === day) {
      addArmy(state, defender, c.relief.army, { x: camp.x + 5, y: camp.y });
      reliefMen = sideMen(state, defender);
    }
    const orders: Order[] = c.storm && day === 2 ? [{ kind: 'storm', faction: ROME, city }] : [];
    state = tick(state, orders, world).state;
    if (orders.length > 0) stormed = state.cities[city]?.owner === ROME;
    const owner = state.cities[city]?.owner;
    const besieging = Object.values(state.armies).some(
      (army) => army.owner === ROME && army.activity.kind === 'besieging',
    );
    const fighting = Object.keys(state.battles).length > 0;
    if (owner === ROME || (!besieging && !fighting && day > 1)) {
      const garrisonLeft = owner === ROME ? 0 : (state.cities[city]?.garrison ?? 0);
      return {
        stormed,
        fell: owner === ROME,
        days: day,
        attackerLost: attackerStart - sideMen(state, ROME),
        defenderLost: garrison - garrisonLeft + reliefMen - sideMen(state, defender),
        state,
      };
    }
  }
  throw new Error(`${c.name} with seed ${seed} neither fell nor failed in ${MAX_DAYS} days`);
}

interface Gain {
  now: Stores;
  year: Stores;
  threeYears: Stores;
}

/** What the fate adds to Rome's stores, less what Rome makes anyway with the city emptied. */
function gains(fell: GameState, city: CityId): Record<'occupy' | 'sack' | 'enslave', Gain> {
  const control = structuredClone(fell);
  const emptied = control.cities[city];
  if (emptied) emptied.population = 0;
  const after = (state: GameState, order?: Order) => {
    const marks: Stores[] = [];
    let s = tick(state, order ? [order] : [], world).state;
    for (let day = 2; day <= 3 * 365; day += 1) {
      s = tick(s, [], world).state;
      if (day === 365 || day === 3 * 365) marks.push(storesOf(s));
    }
    return marks;
  };
  const base = after(control);
  const fate = (order?: Order): Gain => {
    const marks = after(fell, order);
    const now = order
      ? diff(storesOf(tick(fell, [order], world, []).state), storesOf(fell))
      : { gold: 0, food: 0, manpower: 0 };
    return {
      now,
      year: diff(marks[0], base[0]),
      threeYears: diff(marks[1], base[1]),
    };
  };
  return {
    occupy: fate(),
    sack: fate({ kind: 'sack', faction: ROME, city }),
    enslave: fate({ kind: 'enslave', faction: ROME, city }),
  };
}

const storesOf = (state: GameState): Stores => {
  const stores = state.factions[ROME]?.stores;
  if (!stores) throw new Error('Rome is gone');
  return { ...stores };
};
const diff = (a: Stores | undefined, b: Stores | undefined): Stores => ({
  gold: (a?.gold ?? 0) - (b?.gold ?? 0),
  food: (a?.food ?? 0) - (b?.food ?? 0),
  manpower: (a?.manpower ?? 0) - (b?.manpower ?? 0),
});
const worth = (s: Stores) =>
  s.gold * WORTH.gold + s.food * WORTH.food + s.manpower * WORTH.manpower;
const round = (n: number) => Math.round(n).toLocaleString('en-US');
const cell = (s: Stores) => `${round(worth(s))} (${round(s.gold)}g ${round(s.manpower)}m)`;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

const rows = CASES.map((c) => {
  const runs = Array.from({ length: SEEDS }, (_, i) => play(c, i + 1));
  const days = runs.map((r) => r.days);
  const first = runs[0];
  const fates =
    c.fates && first?.fell
      ? gains(first.state, targetOf(setUp(c, 1).state, c.target).id)
      : undefined;
  const fateCell = (pick: (g: ReturnType<typeof gains>) => Stores) =>
    fates ? cell(pick(fates)) : '-';
  return [
    c.name,
    c.storm ? `${Math.round((100 * runs.filter((r) => r.stormed).length) / SEEDS)}%` : '-',
    `${Math.round((100 * runs.filter((r) => r.fell).length) / SEEDS)}%`,
    `${Math.round(mean(days))} (${Math.min(...days)}-${Math.max(...days)})`,
    round(mean(runs.map((r) => r.attackerLost))),
    round(mean(runs.map((r) => r.defenderLost))),
    fateCell((g) => g.occupy.year),
    fateCell((g) => g.sack.year),
    fateCell((g) => g.enslave.year),
    fateCell((g) => g.occupy.threeYears),
    fateCell((g) => g.sack.threeYears),
    fateCell((g) => g.enslave.threeYears),
    fateCell((g) => g.sack.now),
    fateCell((g) => g.enslave.now),
  ];
});

function table(header: string[], body: string[][]): string {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...body.map((row) => row[i]?.length ?? 0)),
  );
  const line = (cells: string[]) =>
    `| ${cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(' | ')} |`;
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}

console.log(
  `${SEEDS} seeds per case. Days are the mean (fastest-slowest) until the city falls or the siege fails. ` +
    `Fates are played on seed 1 and give Rome's gain over a city it would hold empty, as worth in gold ` +
    `(gold, manpower). A manpower is worth ${WORTH.manpower.toFixed(3)} gold and a food 1 gold, the rate a person makes them.`,
);
console.log(
  table(
    [
      'case',
      'storm won',
      'falls',
      'days',
      'attacker lost',
      'defender lost',
      'occupy 1y',
      'sack 1y',
      'enslave 1y',
      'occupy 3y',
      'sack 3y',
      'enslave 3y',
      'sack now',
      'enslave now',
    ],
    rows,
  ),
);

function far(a: MapPoint, b: MapPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
