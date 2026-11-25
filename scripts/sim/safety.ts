import { parseArgs } from 'node:util';
import { threatNewsOfDay } from '../../src/app/threat-news.ts';
import { reserveOf, strengthNear, strengthOf } from '../../src/sim/ai/situation.ts';
import { bestStudy } from '../../src/sim/ai/study.ts';
import { WAR_FRONT_KM } from '../../src/sim/ai/thresholds.ts';
import { warReadiness } from '../../src/sim/ai/war.ts';
import { BUILDINGS } from '../../src/sim/buildings/buildings.ts';
import { deterrentUntil, GUARD_BAND, weighedGarrison } from '../../src/sim/guards.ts';
import type { FactionId } from '../../src/sim/ids.ts';
import type { Order } from '../../src/sim/orders/orders.ts';
import { truceBetween } from '../../src/sim/peace/truce.ts';
import type { GameState } from '../../src/sim/state/game-state.ts';
import { dailyBalances, limitsOf, menOf } from '../../src/sim/systems/economy.ts';
import { TROOPS } from '../../src/sim/troops.ts';
import { areAtWar } from '../../src/sim/wars.ts';
import { distance } from '../../src/sim/world/find-path.ts';
import { marked } from '../../src/ui/advances-text.ts';
import { panelBuilds, playCautiousRome, rome, world } from '../cautious-rome.ts';

/**
 * How safe a Rome that builds is, and why the other powers stand still. Plays the panel Romes
 * of `sim -- slide` and the `builder` of `sim -- advances` for ten years and prints one JSON line
 * a game: Rome's warnings, stops, wars and losses; the highest share of the strength it needs
 * any great power reached against Rome in each year (sampled every SAMPLE_DAYS); at the end of
 * years 3, 5 and 10, the terms of the share of Rome's nearest great power and of the largest;
 * each great power's cities, buildings, men, advances and treasury at years 5 and 10; and where
 * the largest power's gold went each year.
 *
 *   node scripts/sim/safety.ts --players panel-answering --seeds 20 --from 1 > out.jsonl
 */
const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '20' },
    from: { type: 'string', default: '1' },
    years: { type: 'string', default: '10' },
    players: { type: 'string', default: 'panel-ignoring,panel-answering,builder' },
  },
});

const SAMPLE_DAYS = 15;
const TERM_YEARS = [3, 5, 10];
const WORLD_YEARS = [5, 10];
type State = GameState;

/** Rome's study as the advances run's `builder` gives it: the panel's advance with the gold its buildings and reserve leave. */
function builderOrders(orders: Order[], state: State): Order[] {
  const kept = orders.filter((o) => o.faction !== rome || o.kind !== 'study');
  const realm = state.factions[rome];
  if (!realm || realm.study || marked(state, rome).building) return kept;
  const building = kept.reduce(
    (sum, o) => sum + (o.faction === rome && o.kind === 'build' ? BUILDINGS[o.building].gold : 0),
    0,
  );
  const gold = realm.stores.gold - building - reserveOf(state, rome, 'gold');
  const best = bestStudy(state, rome, gold);
  return best ? [...kept, { kind: 'study', faction: rome, advance: best.advance }] : kept;
}

const PLAYERS = {
  'panel-ignoring': { peaceful: true, builds: panelBuilds },
  'panel-answering': {
    peaceful: true,
    answer: true,
    follows: true,
    guards: 'enough' as const,
    builds: panelBuilds,
  },
  builder: { peaceful: true, answer: true, builds: panelBuilds, orders: builderOrders },
};
type Player = keyof typeof PLAYERS;

const powersOf = (state: State) =>
  Object.values(state.factions).filter(
    (f) => f.kind === 'greatPower' && f.id !== rome && f.defeatedOn === null,
  );
const citiesOf = (state: State, faction: FactionId) =>
  Object.values(state.cities).filter((c) => c.owner === faction);

/** The terms of a power's share against Rome: its strength, what its wars hold, Rome's at the front, and the divisor left. */
function terms(state: State, power: FactionId) {
  const threat = warReadiness(state, world, power, rome);
  const own = Object.values(state.armies)
    .filter((a) => a.owner === power)
    .reduce((s, a) => s + strengthOf(state, a), 0);
  const romeArmies = Object.values(state.armies).filter((a) => a.owner === rome);
  const romeAll = romeArmies.reduce((s, a) => s + strengthOf(state, a), 0);
  const front = threat ? state.cities[threat.front] : undefined;
  const romeField = front ? strengthNear(state, romeArmies, front.position, WAR_FRONT_KM) : 0;
  const garrison = front ? weighedGarrison(front, state.day) : 0;
  const guards = front
    ? front.guards.filter((b) => deterrentUntil(b) > state.day).length * GUARD_BAND
    : 0;
  const held = (threat?.heldBy ?? []).reduce(
    (s, enemy) =>
      s +
      Object.values(state.armies)
        .filter((a) => a.owner === enemy)
        .reduce((t, a) => t + strengthOf(state, a), 0),
    0,
  );
  let km = Infinity;
  for (const ours of citiesOf(state, power))
    for (const theirs of citiesOf(state, rome))
      km = Math.min(km, distance(ours.position, theirs.position));
  const free = Math.max(0, own - held);
  const theirs = Math.max(1, romeField + garrison);
  return {
    power,
    cities: citiesOf(state, power).length,
    readiness: threat ? +threat.readiness.toFixed(3) : null,
    pressed: threat?.pressed ?? null,
    front: threat?.front ?? null,
    km: Math.round(km),
    own: Math.round(own),
    held: Math.round(held),
    heldBy: threat?.heldBy ?? [],
    romeField: Math.round(romeField),
    romeAll: Math.round(romeAll),
    garrison: Math.round(garrison - guards),
    guards,
    walls: front ? Math.round(front.walls) : 0,
    hoard: threat ? +threat.hoard.toFixed(3) : null,
    atWar: Object.keys(state.wars).filter((k) => k.includes(`"${power}"`)).length,
    // The odds the power's free strength gives over Rome's at the front, and what the rule divides them by.
    odds: +(free / theirs).toFixed(3),
    divisor:
      threat && threat.readiness > 0 && !threat.pressed
        ? +(free / theirs / threat.readiness).toFixed(3)
        : null,
  };
}

function nearestAndLargest(state: State) {
  const powers = powersOf(state);
  const romeCities = citiesOf(state, rome);
  let nearest: FactionId | undefined;
  let best = Infinity;
  for (const p of powers)
    for (const c of citiesOf(state, p.id))
      for (const r of romeCities) {
        const km = distance(c.position, r.position);
        if (km < best) {
          best = km;
          nearest = p.id;
        }
      }
  const largest = [...powers].sort(
    (a, b) => citiesOf(state, b.id).length - citiesOf(state, a.id).length || (a.id < b.id ? -1 : 1),
  )[0]?.id;
  return { nearest, largest };
}

function worldAt(state: State) {
  const limits = limitsOf(state);
  return powersOf(state).map((p) => {
    const cities = citiesOf(state, p.id);
    return {
      power: p.id,
      cities: cities.length,
      buildings: cities.reduce((s, c) => s + c.buildings.length, 0),
      men: Object.values(state.armies)
        .filter((a) => a.owner === p.id)
        .reduce((s, a) => s + menOf(state, a), 0),
      advances: p.advances.length,
      gold: Math.round(p.stores.gold),
      goldLimit: Math.round(limits.get(p.id)?.gold ?? 0),
      wars: Object.keys(state.wars).filter((k) => k.includes(`"${p.id}"`)).length,
    };
  });
}

interface Flow {
  income: number;
  upkeep: number;
  trade: number;
  wasted: number;
  recruits: number;
  buildings: number;
  study: number;
  /** Gold the day brought beyond the cities' yield: caravans delivered, a peace paid to it. */
  tradeIn: number;
  /** Gold spent beyond recruits, buildings and study: trade routes opened and improved, guards, a peace paid. */
  otherOut: number;
  daysAtLimit: number;
  daysRecruiting: number;
}
const emptyFlow = (): Flow => ({
  income: 0,
  upkeep: 0,
  trade: 0,
  wasted: 0,
  recruits: 0,
  buildings: 0,
  study: 0,
  tradeIn: 0,
  otherOut: 0,
  daysAtLimit: 0,
  daysRecruiting: 0,
});

/** Where a power's gold went from one day to the next. */
function flowOf(before: State, after: State, power: FactionId, flow: Flow) {
  const realm = before.factions[power];
  const next = after.factions[power];
  if (!realm || !next) return;
  const withTrade = dailyBalances(before).get(power)?.gold ?? 0;
  const bare = dailyBalances(before, false).get(power)?.gold ?? 0;
  const upkeep = Object.values(before.armies)
    .filter((a) => a.owner === power)
    .reduce((s, a) => s + menOf(before, a) * 0.01, 0);
  flow.income += bare + upkeep;
  flow.upkeep += upkeep;
  flow.trade += withTrade - bare;
  let recruits = 0;
  let buildings = 0;
  for (const city of Object.values(after.cities)) {
    if (city.owner !== power) continue;
    const was = before.cities[city.id];
    const added = city.recruits.length - (was && was.owner === power ? was.recruits.length : 0);
    for (const r of city.recruits.slice(Math.max(0, city.recruits.length - Math.max(0, added))))
      recruits += TROOPS[r.troop].recruit.gold;
    if (city.construction && (!was || was.construction?.building !== city.construction.building))
      buildings += BUILDINGS[city.construction.building].gold;
  }
  const study = next.study && !realm.study ? next.study.paid : 0;
  if (recruits > 0) flow.daysRecruiting++;
  const limit = limitsOf(before).get(power)?.gold ?? Infinity;
  const spent = recruits + buildings + study;
  if (realm.stores.gold >= limit - 1) flow.daysAtLimit++;
  // The economy adds the cities' yield less upkeep up to the limit; caravans and the rest come apart from it.
  const yielded = realm.stores.gold - spent + bare;
  const kept = bare > 0 ? Math.max(Math.min(yielded, limit), realm.stores.gold - spent) : yielded;
  if (bare > 0 && yielded > kept) flow.wasted += yielded - kept;
  const rest = next.stores.gold - kept;
  if (rest > 0) flow.tradeIn += rest;
  else flow.otherOut -= rest;
  flow.recruits += recruits;
  flow.buildings += buildings;
  flow.study += study;
}

function play(player: Player, seed: number, years: number) {
  const told = new Set<string>();
  const game = {
    player,
    seed,
    warnings: 0,
    stops: 0,
    wars: 0,
    warDays: [] as number[],
    citiesLost: 0,
    fellOn: null as number | null,
    years: Array.from({ length: years }, () => ({
      maxShare: 0,
      maxPower: '',
      romeMen: 0,
      romeBuildings: 0,
      largestFlow: emptyFlow(),
      largest: '',
    })),
    terms: {} as Record<
      number,
      { nearest: ReturnType<typeof terms> | null; largest: ReturnType<typeof terms> | null }
    >,
    world: {} as Record<number, ReturnType<typeof worldAt>>,
  };
  const end = playCautiousRome(
    seed,
    years,
    ({ before, after, events }) => {
      const day = before.day;
      const y = Math.min(years - 1, Math.floor(day / 365));
      const year = game.years[y];
      if (!year) return;
      for (const alert of threatNewsOfDay(before, after, world, told)) {
        if (alert.kind !== 'warThreat') continue;
        if (alert.pause) game.stops++;
        game.warnings++;
      }
      for (const e of events)
        if (
          e.kind === 'warDeclared' &&
          e.against === rome &&
          after.factions[e.by]?.kind === 'greatPower'
        ) {
          game.wars++;
          game.warDays.push(day);
        }
      for (const c of Object.values(before.cities))
        if (c.owner === rome && after.cities[c.id]?.owner !== rome) game.citiesLost++;
      if (after.day % SAMPLE_DAYS === 0)
        for (const p of powersOf(after)) {
          if (areAtWar(after, p.id, rome) || truceBetween(after, p.id, rome)) continue;
          const r = Math.min(1, warReadiness(after, world, p.id, rome)?.readiness ?? 0);
          if (r > year.maxShare) {
            year.maxShare = +r.toFixed(3);
            year.maxPower = p.id;
          }
        }
      const { largest } = nearestAndLargest(before);
      if (largest) {
        year.largest = largest;
        flowOf(before, after, largest, year.largestFlow);
      }
      if (after.day % 365 === 0) {
        const k = after.day / 365;
        const ry = game.years[k - 1];
        if (ry) {
          ry.romeMen = Object.values(after.armies)
            .filter((a) => a.owner === rome)
            .reduce((s, a) => s + menOf(after, a), 0);
          ry.romeBuildings = citiesOf(after, rome).reduce((s, c) => s + c.buildings.length, 0);
        }
        if (TERM_YEARS.includes(k)) {
          const { nearest, largest: big } = nearestAndLargest(after);
          game.terms[k] = {
            nearest: nearest ? terms(after, nearest) : null,
            largest: big ? terms(after, big) : null,
          };
        }
        if (WORLD_YEARS.includes(k)) game.world[k] = worldAt(after);
      }
    },
    PLAYERS[player],
  );
  game.fellOn = end.factions[rome]?.defeatedOn ?? null;
  for (const y of game.years)
    for (const key of Object.keys(y.largestFlow) as (keyof Flow)[])
      y.largestFlow[key] = Math.round(y.largestFlow[key]);
  return game;
}

const first = Number(values.from);
for (const player of values.players.split(',') as Player[])
  for (let seed = first; seed < first + Number(values.seeds); seed++)
    console.log(JSON.stringify(play(player, seed, Number(values.years))));
