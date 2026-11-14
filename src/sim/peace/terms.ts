import type { DeepReadonly } from '../deep-readonly.ts';
import { cancelBuilding } from '../buildings/build.ts';
import { changeCityOwner } from '../cities.ts';
import { musterEarly } from '../systems/economy.ts';
import type { CityId, FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import type { PeaceTerms } from '../state/peace.ts';
import { CITY_POINTS } from './standing.ts';

/** A point of a peace's worth is this much gold. A minor city is worth about two years of its gold. */
export const GOLD_PER_POINT = 100;

export const AS_THINGS_STAND: PeaceTerms = { kind: 'asThingsStand' };

/** What the terms are worth to the faction, in points: what it gains less what it gives. */
export function termsPoints(
  state: DeepReadonly<GameState>,
  terms: DeepReadonly<PeaceTerms>,
  faction: FactionId,
): number {
  if (terms.kind === 'asThingsStand') return 0;
  const worth =
    terms.gold / GOLD_PER_POINT +
    terms.cities.reduce((sum, id) => {
      const city = state.cities[id];
      return sum + (city ? CITY_POINTS[city.rank] : 0);
    }, 0);
  return terms.payer === faction ? -worth : worth;
}

/**
 * Why the terms cannot settle the war between the two factions today, or undefined when
 * they can. The payer must be a side, hold the gold and every city, and keep a city.
 */
export function termsProblem(
  state: DeepReadonly<GameState>,
  sides: readonly [FactionId, FactionId],
  terms: DeepReadonly<PeaceTerms>,
): string | undefined {
  if (terms.kind === 'asThingsStand') return undefined;
  const { payer, gold, cities } = terms;
  const payerName = state.factions[payer]?.name ?? payer;
  if (!sides.includes(payer)) return `${payerName} is not a side of the war`;
  if (gold === 0 && cities.length === 0) return 'a payment must give gold or cities';
  const stores = state.factions[payer]?.stores;
  if (!stores || (gold > 0 && stores.gold < gold)) {
    return `${payerName} has ${Math.max(0, Math.floor(stores?.gold ?? 0))} gold, not the ${gold} the terms ask`;
  }
  if (new Set(cities).size !== cities.length) return 'the terms name a city twice';
  for (const id of cities) {
    const city = Object.hasOwn(state.cities, id) ? state.cities[id] : undefined;
    if (!city) return `city ${id} does not exist`;
    if (city.owner !== payer) return `${payerName} does not hold ${city.name}`;
  }
  const held = Object.values(state.cities).filter((city) => city.owner === payer).length;
  if (cities.length >= held) return `${payerName} would hand over its last city`;
  return undefined;
}

/**
 * Pays what the terms ask, to the side that is not the payer. The caller checked
 * `termsProblem`. A city handed over first musters what it trains for the payer, so no
 * paid recruit is lost, and the homecoming of the peace sends them home. Its building
 * under way is cancelled for the payer with the usual refund. Its finished buildings go with it.
 */
export function payTerms(
  state: GameState,
  terms: DeepReadonly<PeaceTerms>,
  receiver: FactionId,
): void {
  if (terms.kind === 'asThingsStand') return;
  const payer = state.factions[terms.payer];
  const gainer = state.factions[receiver];
  if (!payer || !gainer) return;
  payer.stores.gold -= terms.gold;
  gainer.stores.gold += terms.gold;
  for (const id of terms.cities as readonly CityId[]) {
    const city = state.cities[id];
    if (!city) continue;
    musterEarly(state, city);
    if (city.construction)
      cancelBuilding(state, { kind: 'cancelBuilding', faction: terms.payer, city: id });
    changeCityOwner(state, id, receiver);
  }
}

/** A copy of the terms that shares nothing with the state it came from. */
export function copyTerms(terms: DeepReadonly<PeaceTerms>): PeaceTerms {
  return terms.kind === 'asThingsStand'
    ? { kind: 'asThingsStand' }
    : { kind: 'payment', payer: terms.payer, gold: terms.gold, cities: [...terms.cities] };
}
