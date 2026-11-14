import type { ArmyId, FactionId } from '../ids.ts';
import { joinRefusal } from '../orders/join-army.ts';
import type { Order } from '../orders/orders.ts';
import { reforming } from '../systems/battles.ts';
import { RALLY_DISTANCE } from '../systems/economy.ts';
import { SIEGE_DISTANCE } from '../systems/sieges.ts';
import { distance } from '../world/find-path.ts';
import type { World } from '../world/world.ts';
import {
  endOverlongMarches,
  fates,
  guardOfCapital,
  movements,
  retreats,
  storms,
  type Context,
} from './armies.ts';
import { recruitment } from './budget.ts';
import { construction } from './build.ts';
import { minorOrders } from './minor.ts';
import { peaceOrders } from './peace.ts';
import { createRouter } from './routes.ts';
import { stances } from './stance.ts';
import {
  besieged,
  enemiesOf,
  homeCapital,
  positionOf,
  sorted,
  strengthOf,
  type CityView,
  type State,
} from './situation.ts';
import { warDeclaration } from './war.ts';
import { trading } from './trade.ts';

/**
 * The orders a faction gives today. It reads the state and the world and changes
 * neither, and it draws no random numbers, so the same state gives the same orders. A
 * defeated faction gives none.
 */
export function decideOrders(state: State, world: World, faction: FactionId): Order[] {
  const record = state.factions[faction];
  if (!record || record.defeatedOn !== null) return [];
  const context: Context = {
    state,
    world,
    faction,
    enemies: enemiesOf(state, faction),
    router: createRouter(state, world, faction),
  };
  if (record.kind === 'minor') {
    const orders = [...peaceOrders(context), ...stances(context), ...minorOrders(context)];
    return withJoins(context, [...orders, ...trading(state, world, faction, orders)]);
  }
  const muster = musterCity(context);
  const recruits = recruitment(state, faction, muster);
  const orders = [
    ...peaceOrders(context),
    ...stances(context),
    ...endOverlongMarches(context),
    ...retreats(context),
    ...fates(context),
    ...storms(context),
    ...movements(context, muster),
    ...recruits,
    ...construction(state, faction, recruits.length > 0),
    ...warDeclaration(context),
  ];
  return withJoins(context, [...orders, ...trading(state, world, faction, orders)]);
}

/**
 * The day's orders, with the joins that make one army of the faction's idle armies that
 * stand together at one of its cities first: the lowest id, under the best general. An
 * army joins when it was given no order today or the same orders as the army it joins,
 * which then carries them out for both. The guard of the capital joins only an army that
 * stays, so the army that takes it in stays as well. Each join is weighed against the
 * joins before it: an army that a join of another stance sets re-forming takes no more
 * that day, and an army whose join cannot run keeps its own orders. So a power that
 * gathers at its muster city marches and sails as one army, and a remnant that comes
 * home joins the army there.
 */
function withJoins(context: Context, orders: Order[]): Order[] {
  const { state, faction } = context;
  const guard =
    context.state.factions[faction]?.kind === 'greatPower'
      ? guardOfCapital(context).guard?.id
      : undefined;
  const ordersOf = (id: ArmyId) => orders.filter((order) => 'army' in order && order.army === id);
  const asOrdersOf = (mine: Order[], theirs: Order[], into: ArmyId) =>
    mine.length === theirs.length &&
    mine.every(
      (order, i) => JSON.stringify({ ...order, army: into }) === JSON.stringify(theirs[i]),
    );
  const placed = new Set<ArmyId>();
  const joining = new Set<ArmyId>();
  const reformed = new Set<ArmyId>();
  const joins: Order[] = [];
  for (const city of sorted(state.cities)) {
    if (city.owner !== faction) continue;
    const [into, ...rest] = sorted(state.armies).filter(
      (army) =>
        army.owner === faction &&
        army.activity.kind === 'idle' &&
        !placed.has(army.id) &&
        !reforming(state, army) &&
        distance(army.activity.position, city.position) <= RALLY_DISTANCE,
    );
    if (into?.activity.kind !== 'idle') continue;
    placed.add(into.id);
    for (const army of rest) {
      if (reformed.has(into.id) || joinRefusal(state, { faction, army: army.id, into: into.id })) {
        continue;
      }
      const own = ordersOf(army.id);
      const theirs = ordersOf(into.id);
      if (own.length > 0 && !asOrdersOf(own, theirs, into.id)) continue;
      if (army.id === guard && theirs.length > 0) continue;
      placed.add(army.id);
      joining.add(army.id);
      joins.push({ kind: 'joinArmy', faction, army: army.id, into: into.id });
      if (army.stance !== into.stance) reformed.add(into.id);
    }
  }
  return [...joins, ...orders.filter((order) => !('army' in order && joining.has(order.army)))];
}

/** The orders of every faction the AI runs, in faction id order: all but those it skips and the defeated. */
export function decideAll(
  state: State,
  world: World,
  skip: readonly FactionId[] = [state.player],
): Order[] {
  return sorted(state.factions)
    .filter((faction) => !skip.includes(faction.id))
    .flatMap((faction) => decideOrders(state, world, faction.id));
}

/**
 * Where a power raises recruits and gathers armies too weak for any target, among its
 * calm cities that are not besieged. At war, it is the one nearest an enemy city. At peace, it is the calm city where its
 * strongest idle army stands, so recruits join that army, or else its capital.
 */
function musterCity({ state, world, faction, enemies }: Context): CityView | undefined {
  const calm = sorted(state.cities).filter(
    (city) => city.owner === faction && city.unrestDays === 0 && !besieged(state, city),
  );
  if (calm.length === 0) return undefined;
  const enemyCities = sorted(state.cities).filter((city) => enemies.has(city.owner));
  if (enemyCities.length > 0) {
    let best: { city: CityView; km: number } | undefined;
    for (const ours of calm) {
      for (const theirs of enemyCities) {
        const km = distance(ours.position, theirs.position);
        if (!best || km < best.km) best = { city: ours, km };
      }
    }
    return best?.city;
  }
  const idle = sorted(state.armies)
    .filter((army) => army.owner === faction && army.activity.kind === 'idle')
    .sort((a, b) => strengthOf(state, b) - strengthOf(state, a));
  for (const army of idle) {
    const at = positionOf(army);
    const city = at && calm.find((c) => distance(c.position, at) <= SIEGE_DISTANCE);
    if (city) return city;
  }
  const capital = homeCapital(state, world, faction);
  return capital && capital.unrestDays === 0
    ? capital
    : calm.sort((a, b) => b.population - a.population)[0];
}
