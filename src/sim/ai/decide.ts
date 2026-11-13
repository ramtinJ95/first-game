import type { FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import { SIEGE_DISTANCE } from '../systems/sieges.ts';
import { distance } from '../world/find-path.ts';
import type { World } from '../world/world.ts';
import { endOverlongMarches, fates, movements, retreats, storms, type Context } from './armies.ts';
import { recruitment } from './budget.ts';
import { construction } from './build.ts';
import { minorOrders } from './minor.ts';
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
  if (record.kind === 'minor') return [...stances(context), ...minorOrders(context)];
  const muster = musterCity(context);
  const recruits = recruitment(state, faction, muster);
  return [
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
