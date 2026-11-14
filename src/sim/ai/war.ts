import type { FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import { truceBetween } from '../peace/truce.ts';
import { distance } from '../world/find-path.ts';
import type { Context } from './armies.ts';
import {
  canFight,
  sorted,
  strengthNear,
  strengthOf,
  targetsOf,
  type CityView,
} from './situation.ts';
import {
  COALITION_ODDS,
  LEADER_SHARE,
  PEACE_WAR_ODDS,
  RIVAL_ODDS,
  RIVAL_PRESSURE_ODDS,
  WAR_DISTANCE_KM,
  WAR_FRONT_KM,
  WAR_ODDS,
  WAR_REACH_KM,
} from './thresholds.ts';

/**
 * Declares at most one war a day. A neighbour is a faction at peace with this one that
 * holds a city within WAR_REACH_KM of one of its cities, reachable by land or sea. Its
 * strength is its armies on land within WAR_FRONT_KM of that nearest city plus the
 * city's garrison. Each war in which the power can still take a city holds back all that
 * enemy's armies, but not its garrisons, which never leave their walls, and what is left
 * is its free strength. It declares on the neighbour with the best odds, free strength over the
 * neighbour's, once they reach WAR_ODDS raised by distance over WAR_DISTANCE_KM. A power
 * at peace with everyone needs only PEACE_WAR_ODDS, whatever the distance. Against a
 * rival great power it needs no more than RIVAL_ODDS in either case, and against the
 * leader, a great power with LEADER_SHARE of all cities and more than any other, no more
 * than COALITION_ODDS.
 */
export function warDeclaration(context: Context): Order[] {
  const { state, faction, enemies, router } = context;
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
  const armiesOf = new Map<FactionId, (typeof armies)[number][]>();
  for (const army of armies) armiesOf.set(army.owner, [...(armiesOf.get(army.owner) ?? []), army]);
  const measure = (other: FactionId, city: CityView) =>
    strengthNear(state, armiesOf.get(other) ?? [], city.position, WAR_FRONT_KM) + city.garrison;

  const fighting = new Set(targetsOf(state, faction, enemies).map((city) => city.owner));
  let free = strength.get(faction) ?? 0;
  for (const enemy of [...fighting].sort()) {
    const front = frontOf(enemy);
    if (front) free -= strength.get(enemy) ?? 0;
  }
  const rivals = new Set(
    sorted(state.factions)
      .filter((other) => other.kind === 'greatPower' && other.defeatedOn === null)
      .map((other) => other.id),
  );
  if (free <= 0) return rivalPressure(context, strength, rivals, frontOf);
  const odds = enemies.size === 0 ? PEACE_WAR_ODDS : WAR_ODDS;
  const leader = leaderOf(citiesOf, rivals);
  const oddsAgainst = (other: FactionId) =>
    other === leader ? COALITION_ODDS : rivals.has(other) ? RIVAL_ODDS : odds;
  const scoreOf = (other: FactionId, theirs: number, km: number) =>
    free /
    Math.max(1, theirs) /
    (Math.min(odds, oddsAgainst(other)) * (enemies.size === 0 ? 1 : 1 + km / WAR_DISTANCE_KM));

  // A neighbour scores at most its best city in reach would with no army near it, so
  // most are ruled out before a route to their front is looked for.
  const candidates = sorted(state.factions)
    .filter(
      (other) =>
        other.id !== faction &&
        other.defeatedOn === null &&
        !enemies.has(other.id) &&
        !truceBetween(state, faction, other.id),
    )
    .flatMap((other) => {
      let bound = 0;
      for (const theirs of citiesOf.get(other.id) ?? []) {
        let km = Number.POSITIVE_INFINITY;
        for (const ours of ownCities) km = Math.min(km, distance(ours.position, theirs.position));
        if (km <= WAR_REACH_KM) bound = Math.max(bound, scoreOf(other.id, theirs.garrison, km));
      }
      return bound > 0 ? [{ id: other.id, bound }] : [];
    })
    .filter((candidate) => candidate.bound >= 1)
    .sort((a, b) => b.bound - a.bound || (a.id < b.id ? -1 : 1));

  let best: { against: FactionId; score: number } | undefined;
  for (const { id, bound } of candidates) {
    if (best && bound <= best.score) break;
    const front = frontOf(id);
    if (!front) continue;
    const score = scoreOf(id, measure(id, front.city), front.km);
    if (score >= 1 && (!best || score > best.score)) best = { against: id, score };
  }
  if (best) return [{ kind: 'declareWar', faction, against: best.against }];
  return rivalPressure(context, strength, rivals, frontOf);
}

/** The great power that holds at least LEADER_SHARE of all cities and more than any other. */
function leaderOf(
  citiesOf: ReadonlyMap<FactionId, readonly CityView[]>,
  rivals: ReadonlySet<FactionId>,
): FactionId | undefined {
  let total = 0;
  for (const cities of citiesOf.values()) total += cities.length;
  const counts = [...rivals]
    .map((rival) => ({ rival, count: citiesOf.get(rival)?.length ?? 0 }))
    .sort((a, b) => b.count - a.count || (a.rival < b.rival ? -1 : 1));
  const [first, second] = counts;
  if (!first || first.count < LEADER_SHARE * total) return undefined;
  return second && second.count === first.count ? undefined : first.rival;
}

/**
 * A power at war with no great power declares on a great-power neighbour that has kept
 * to its homeland, holding no more cities than the map gave it, once its own armies
 * outweigh that neighbour's RIVAL_PRESSURE_ODDS times. It picks the one it outweighs
 * most. So a rival who stays at home is pressed while minor cities are still left.
 */
function rivalPressure(
  { state, world, faction, enemies }: Context,
  strength: ReadonlyMap<FactionId, number>,
  rivals: ReadonlySet<FactionId>,
  frontOf: (other: FactionId) => unknown,
): Order[] {
  if ([...enemies].some((enemy) => rivals.has(enemy))) return [];
  const own = strength.get(faction) ?? 0;
  const homeland = (rival: FactionId) =>
    world.map.provinces.filter((province) => (province.owner as string) === rival).length;
  const held = (rival: FactionId) =>
    sorted(state.cities).filter((city) => city.owner === rival).length;
  let best: { against: FactionId; odds: number } | undefined;
  for (const rival of [...rivals].sort()) {
    if (rival === faction || held(rival) > homeland(rival)) continue;
    if (truceBetween(state, faction, rival)) continue;
    const odds = own / Math.max(1, strength.get(rival) ?? 0);
    if (odds < RIVAL_PRESSURE_ODDS || (best && odds <= best.odds)) continue;
    if (frontOf(rival)) best = { against: rival, odds };
  }
  return best ? [{ kind: 'declareWar', faction, against: best.against }] : [];
}
