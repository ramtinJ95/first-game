import type { FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import { distance } from '../world/find-path.ts';
import type { Context } from './armies.ts';
import { canFight, sorted, strengthOf, targetsOf, type CityView } from './situation.ts';
import { PEACE_WAR_ODDS, WAR_DISTANCE_KM, WAR_ODDS, WAR_REACH_KM } from './thresholds.ts';

/**
 * Declares at most one war a day. A neighbour is a faction at peace with this one that
 * holds a city within WAR_REACH_KM of one of its cities, reachable by land or sea. Its
 * strength is all its armies plus the garrison of that nearest city. Each war in which
 * the power can still take a city holds back the same measure of that enemy, and what is
 * left is its free strength. It declares on the neighbour with the best odds, free strength over the
 * neighbour's, once they reach WAR_ODDS raised by distance over WAR_DISTANCE_KM. A power
 * at peace with everyone needs only PEACE_WAR_ODDS, whatever the distance.
 */
export function warDeclaration({ state, faction, enemies, router }: Context): Order[] {
  const armies = sorted(state.armies);
  const strength = new Map<FactionId, number>();
  for (const army of armies) {
    strength.set(army.owner, (strength.get(army.owner) ?? 0) + strengthOf(state, army));
  }
  const ready = armies.some(
    (army) =>
      army.owner === faction &&
      (army.activity.kind === 'idle' || army.activity.kind === 'marching') &&
      canFight(state, army),
  );
  if (!ready) return [];
  const citiesOf = new Map<FactionId, CityView[]>();
  for (const city of sorted(state.cities)) {
    citiesOf.set(city.owner, [...(citiesOf.get(city.owner) ?? []), city]);
  }
  const ownCities = citiesOf.get(faction) ?? [];

  /** The neighbour's city nearest one of the power's, within WAR_REACH_KM and reachable. */
  const frontOf = (other: FactionId) => {
    const pairs: { ours: CityView; theirs: CityView; km: number }[] = [];
    for (const theirs of citiesOf.get(other) ?? []) {
      for (const ours of ownCities) {
        const km = distance(ours.position, theirs.position);
        if (km <= WAR_REACH_KM) pairs.push({ ours, theirs, km });
      }
    }
    pairs.sort((a, b) => a.km - b.km);
    const found = pairs.find(({ ours, theirs }) => router.reaches(ours.position, theirs));
    return found && { city: found.theirs, km: found.km };
  };
  const measure = (other: FactionId, city: CityView) => (strength.get(other) ?? 0) + city.garrison;

  const fighting = new Set(targetsOf(state, faction, enemies).map((city) => city.owner));
  let free = strength.get(faction) ?? 0;
  for (const enemy of [...fighting].sort()) {
    const front = frontOf(enemy);
    if (front) free -= measure(enemy, front.city);
  }
  if (free <= 0) return [];
  const odds = enemies.size === 0 ? PEACE_WAR_ODDS : WAR_ODDS;
  const scoreOf = (theirs: number, km: number) =>
    free / Math.max(1, theirs) / (odds * (enemies.size === 0 ? 1 : 1 + km / WAR_DISTANCE_KM));

  // A neighbour scores at most as if its weakest city stood next door, so most are
  // ruled out before their front is looked for.
  const candidates = sorted(state.factions)
    .filter((other) => other.id !== faction && other.defeatedOn === null && !enemies.has(other.id))
    .flatMap((other) => {
      const cities = citiesOf.get(other.id) ?? [];
      if (cities.length === 0) return [];
      const weakest = Math.min(...cities.map((city) => city.garrison));
      return [{ id: other.id, bound: scoreOf((strength.get(other.id) ?? 0) + weakest, 0) }];
    })
    .filter((candidate) => candidate.bound >= 1)
    .sort((a, b) => b.bound - a.bound || (a.id < b.id ? -1 : 1));

  let best: { against: FactionId; score: number } | undefined;
  for (const { id, bound } of candidates) {
    if (best && bound <= best.score) break;
    const front = frontOf(id);
    if (!front) continue;
    const score = scoreOf(measure(id, front.city), front.km);
    if (score >= 1 && (!best || score > best.score)) best = { against: id, score };
  }
  return best ? [{ kind: 'declareWar', faction, against: best.against }] : [];
}
