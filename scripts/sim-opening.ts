import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { retreats, storms, type Context } from '../src/sim/ai/armies.ts';
import { decideAll } from '../src/sim/ai/decide.ts';
import { createRouter } from '../src/sim/ai/routes.ts';
import { byLand, enemiesOf, homeCapital, menUnderArms } from '../src/sim/ai/situation.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { parseMap, POWERS } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import type { City } from '../src/sim/state/city.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { CITY_DEFENCES, RECOVERY_DAYS } from '../src/sim/systems/sieges.ts';
import { tick } from '../src/sim/tick.ts';
import { distance } from '../src/sim/world/find-path.ts';
import { buildWorld } from '../src/sim/world/world.ts';

/**
 * The scripted opening of each great power, as a player plays it. On day 1 the power
 * declares war on the nearest independent city its capital reaches by land and marches
 * its starting army there. After that it gives only the orders the faction AI would give
 * that army in the siege: storm when the AI's storm rule says so, and retreat from a
 * battle it is losing. It recruits nothing and occupies the city. Every other faction
 * plays under the AI.
 */

const { values } = parseArgs({
  options: { seeds: { type: 'string', default: '5' }, power: { type: 'string', default: 'all' } },
});
const SEEDS = Number(values.seeds);
const OPENERS = values.power === 'all' ? POWERS : POWERS.filter((p) => p === values.power);
const YEAR = 365;
/** A battle this close to the target, in km, is a battle for it. */
const BATTLE_KM = 40;

const map = parseMap(
  JSON.parse(readFileSync(new URL('../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const whole = (n: number) => Math.round(n).toLocaleString('en-US');

function target(state: GameState, power: FactionId): City {
  const capital = homeCapital(state, world, power);
  if (!capital) throw new Error(`${power} has no capital`);
  const [nearest] = Object.values(state.cities)
    .filter(
      (city) =>
        state.factions[city.owner]?.kind === 'minor' &&
        byLand(world, capital.position, city.position),
    )
    .sort(
      (a, b) => distance(capital.position, a.position) - distance(capital.position, b.position),
    );
  if (!nearest) throw new Error(`${power} reaches no minor city by land`);
  return nearest;
}

function openerOrders(state: GameState, power: FactionId): Order[] {
  const context: Context = {
    state,
    world,
    faction: power,
    enemies: enemiesOf(state, power),
    router: createRouter(state, world, power),
  };
  return [...retreats(context), ...storms(context)];
}

const header = [
  'power',
  'seed',
  'target',
  'most men the defender fielded',
  'battles: day, days, lost (ours / theirs)',
  'siege from day',
  'fell on day',
  'storms ordered',
  'men lost by the fall',
  'cities at day 365',
];
console.log(`| ${header.join(' | ')} |`);
console.log(`| ${header.map(() => '---').join(' | ')} |`);
for (const opener of OPENERS) {
  const power = opener as string as FactionId;
  for (let seed = 1; seed <= SEEDS; seed++) {
    let state = newGame(map, { seed, player: opener });
    const city = target(state, power);
    const defender = city.owner;
    const [army] = Object.values(state.armies).filter((a) => a.owner === power);
    if (!army) throw new Error(`${power} has no starting army`);
    const startMen = menUnderArms(state, power);
    let defenders = 0;
    let orders: Order[] = [
      { kind: 'declareWar', faction: power, against: defender },
      { kind: 'moveArmy', faction: power, army: army.id, to: city.position },
    ];
    const battles: string[] = [];
    let fell: { day: number; how: string; men: number } | undefined;
    let sieged: number | undefined;
    let stormed = 0;
    for (let day = 1; day <= YEAR; day++) {
      const before = state;
      const all = [...orders, ...decideAll(state, world, [power])];
      stormed += orders.filter((o) => o.kind === 'storm').length;
      const result = tick(state, all, world);
      state = result.state;
      if (!fell) defenders = Math.max(defenders, menUnderArms(state, defender));
      for (const event of result.events) {
        if (event.kind !== 'battleEnded' || fell) continue;
        if (distance(event.position, city.position) > BATTLE_KM) continue;
        const ours = event.attackers.factions.includes(power) ? 'attackers' : 'defenders';
        const theirs = ours === 'attackers' ? 'defenders' : 'attackers';
        if (!event[ours].factions.includes(power) || !event[theirs].factions.includes(defender))
          continue;
        battles.push(
          `${event.startedOn}, ${event.days}, ${event[ours].lost} / ${event[theirs].lost}`,
        );
      }
      if (sieged === undefined && Object.values(state.sieges).some((s) => s.city === city.id)) {
        sieged = before.day;
      }
      const owner = state.cities[city.id]?.owner;
      if (!fell && owner !== city.owner) {
        const how =
          owner !== power
            ? `to ${owner}`
            : orders.some((o) => o.kind === 'storm')
              ? 'storm'
              : (state.cities[city.id]?.walls ?? 0) >
                  CITY_DEFENCES[city.rank].walls / RECOVERY_DAYS + 1e-9
                ? 'siege'
                : 'surrender';
        fell = { day: before.day, how, men: startMen - menUnderArms(state, power) };
      }
      orders = state.factions[power]?.defeatedOn === null ? openerOrders(state, power) : [];
    }
    const cities = Object.values(state.cities).filter((c) => c.owner === power).length;
    const row = [
      opener,
      String(seed),
      city.name,
      whole(defenders),
      battles.join('; ') || 'none',
      sieged === undefined ? 'never' : String(sieged),
      fell ? `${fell.day} by ${fell.how}` : 'held',
      String(stormed),
      fell ? `${whole(fell.men)} of ${whole(startMen)}` : '–',
      String(cities),
    ];
    console.log(`| ${row.join(' | ')} |`);
  }
}
