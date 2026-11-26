import type { CityId, FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import { truceBetween } from '../peace/truce.ts';
import { BLOCKADE_ODDS } from '../systems/sieges.ts';
import { distance } from '../world/find-path.ts';
import { endRate, tradeIncome } from '../trade/routes.ts';
import { adminCitiesOf, limitsOf } from '../systems/economy.ts';
import type { World } from '../world/world.ts';
import { weighedGarrison } from '../guards.ts';
import type { Context } from './armies.ts';
import { createRouter } from './routes.ts';
import {
  canFight,
  enemiesOf,
  sorted,
  strengthNear,
  strengthOf,
  targetsOf,
  type CityView,
  type State,
} from './situation.ts';
import {
  COALITION_ODDS,
  HOARD_ODDS_SHARE,
  LEADER_SHARE,
  PEACE_WAR_ODDS,
  RIVAL_ODDS,
  NOTICE_DAYS,
  RIVAL_PRESSURE_ODDS,
  SATED_EXPONENT,
  STAY_HOME_CAP,
  STAY_HOME_PER_YEAR,
  WAR_DISTANCE_KM,
  WAR_FRONT_KM,
  WAR_ODDS,
  WAR_REACH_KM,
} from './thresholds.ts';

/**
 * Declares at most one war a day. A neighbour is a faction at peace with this one that
 * holds a city within WAR_REACH_KM of one of its cities, reachable by land or sea. Its
 * strength is its armies on land within WAR_FRONT_KM of that nearest city plus the
 * city's garrison, with hired guards counted only in their first GUARD_DETER_DAYS
 * (`weighedGarrison`). Each war in which the power can still take a city holds back all that
 * enemy's armies, but not its garrisons, which never leave their walls, and what is left
 * is its free strength. It declares on the neighbour with the best odds, free strength over the
 * neighbour's, once they reach WAR_ODDS raised by distance over WAR_DISTANCE_KM. A power
 * at peace with everyone needs only PEACE_WAR_ODDS, whatever the distance. Against a
 * rival great power it needs no more than RIVAL_ODDS in either case, and against the
 * leader, a great power with LEADER_SHARE of all cities and more than any other, no more
 * than COALITION_ODDS. A power past ADMIN_CITIES needs less against a rival great power
 * whose treasury is full, since the gold is what a peace would make the rival pay: the
 * odds fall by HOARD_ODDS_SHARE times the share of the rival's treasury that is full
 * times the share of its own cities past ADMIN_CITIES, which its gold cannot arm.
 * Against a rival great power that holds no more cities than the map gave it, the odds fall
 * by STAY_HOME_PER_YEAR for each year of the game, to at most STAY_HOME_CAP, so a realm that
 * only builds at home draws its neighbours as the years pass.
 * Against a minor the odds it needs grow with its cities over those the map gave it,
 * raised to SATED_EXPONENT, so a realm that has grown is slower to start a new war
 * on a minor.
 */
export function warDeclaration(context: Context): Order[] {
  const reckoning = reckon(context);
  if (!reckoning || reckoning.free <= 0) return [];
  const { faction, state } = context;
  const since = state.factions[faction]?.noticeSince ?? null;
  // The player is declared on only after the notice its warning gives.
  const may = (against: FactionId) =>
    against !== state.player || (since !== null && state.day - since >= NOTICE_DAYS);
  let best: { against: FactionId; score: number } | undefined;
  for (const { id, bound } of reckoning.candidates) {
    if (best && bound <= best.score) break;
    if (!may(id)) continue;
    const front = reckoning.frontOf(id);
    if (!front) continue;
    const score = reckoning.scoreOf(id, reckoning.measure(id, front.city), front.km);
    if (score >= 1 && (!best || score > best.score)) best = { against: id, score };
  }
  if (best) return [{ kind: 'declareWar', faction, against: best.against }];
  let pressed: { against: FactionId; odds: number } | undefined;
  for (const rival of [...reckoning.rivals].sort()) {
    const odds = reckoning.pressureOn(rival);
    if (odds === undefined || odds < RIVAL_PRESSURE_ODDS || (pressed && odds <= pressed.odds))
      continue;
    if (!may(rival)) continue;
    if (reckoning.frontOf(rival)) pressed = { against: rival, odds };
  }
  return pressed ? [{ kind: 'declareWar', faction, against: pressed.against }] : [];
}

/** How near a power stands to declaring war on another, by the reckoning of `warDeclaration`. */
export interface WarReadiness {
  /** Its odds over the odds it needs: at 1 or more it declares, unless another neighbour scores higher. */
  readonly readiness: number;
  /** The share by which the other's full treasury lowers the odds it needs, 0 when it does not. */
  readonly hoard: number;
  /** The other's city nearest the power, whose defenders it weighs. */
  readonly front: CityId;
  /** Whether rival pressure, which weighs field armies only, stands nearer than the odds. */
  readonly pressed: boolean;
  /** The enemies whose wars hold back their whole field strength from the power's own, by id. */
  readonly heldBy: readonly FactionId[];
  /** The share by which the other's staying in the cities the map gave it lowers the odds it needs (STAY_HOME_PER_YEAR), 0 when it does not. */
  readonly stayedHome: number;
}

/**
 * How near a great power stands to declaring war on another faction, by its odds or, for
 * a rival it may press, by its uncommitted strength over RIVAL_PRESSURE_ODDS, whichever
 * is nearer. A power whose strength is all held back by its wars stands at 0. Nothing
 * when it could not declare on that faction at all: at war or in a truce with it, out of
 * reach, or with no army ready to march.
 */
export function warReadiness(
  state: State,
  world: World,
  faction: FactionId,
  against: FactionId,
): WarReadiness | undefined {
  const record = state.factions[faction];
  if (record?.kind !== 'greatPower' || record.defeatedOn !== null) return undefined;
  const context: Context = {
    state,
    world,
    faction,
    enemies: enemiesOf(state, faction),
    router: createRouter(state, world, faction),
  };
  const reckoning = reckon(context);
  if (!reckoning?.eligible.has(against)) return undefined;
  const front = reckoning.frontOf(against);
  if (!front) return undefined;
  const pressure = (reckoning.pressureOn(against) ?? 0) / RIVAL_PRESSURE_ODDS;
  const odds = reckoning.scoreOf(against, reckoning.measure(against, front.city), front.km);
  return {
    readiness: Math.max(odds, pressure),
    hoard: reckoning.hoardShare(against),
    stayedHome: reckoning.stayedHome(against),
    front: front.city.id,
    pressed: pressure > odds,
    heldBy: reckoning.heldBy,
  };
}

/** The day's reckoning of war: its free strength, the neighbours it might declare on, and its odds against each. */
function reckon(context: Context) {
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
  if (!ready) return undefined;
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
    strengthNear(state, armiesOf.get(other) ?? [], city.position, WAR_FRONT_KM) +
    weighedGarrison(city, state.day);

  const fighting = new Set(targetsOf(state, faction, enemies).map((city) => city.owner));
  let free = strength.get(faction) ?? 0;
  let pressureFree = free;
  const heldBy: FactionId[] = [];
  for (const enemy of [...fighting].sort()) {
    const front = frontOf(enemy);
    if (front) {
      heldBy.push(enemy);
      const field = strength.get(enemy) ?? 0;
      free -= field;
      // A broken field army does not release the troops needed to finish its city.
      pressureFree -= Math.max(field, front.city.garrison * BLOCKADE_ODDS);
    }
  }
  const rivals = new Set(
    sorted(state.factions)
      .filter((other) => other.kind === 'greatPower' && other.defeatedOn === null)
      .map((other) => other.id),
  );
  const odds = enemies.size === 0 ? PEACE_WAR_ODDS : WAR_ODDS;
  const leader = leaderOf(citiesOf, rivals);
  const homeland = context.world.map.provinces.filter(
    (province) => (province.owner as string) === faction,
  ).length;
  const sated = Math.max(1, ownCities.length / Math.max(1, homeland)) ** SATED_EXPONENT;
  const limits = limitsOf(state);
  const hoard = (other: FactionId) => {
    const limit = limits.get(other)?.gold ?? 0;
    const gold = state.factions[other]?.stores.gold ?? 0;
    return limit > 0 ? Math.min(1, Math.max(0, gold / limit)) : 0;
  };
  const growth = Math.max(0, 1 - adminCitiesOf(faction) / Math.max(1, ownCities.length));
  const hoardShare = (other: FactionId) =>
    other !== leader && rivals.has(other) ? HOARD_ODDS_SHARE * growth * hoard(other) : 0;
  const stayedHome = (other: FactionId) =>
    other !== leader &&
    rivals.has(other) &&
    (citiesOf.get(other)?.length ?? 0) <= homelandOf(context.world, other)
      ? Math.min(STAY_HOME_CAP, (state.day / 365) * STAY_HOME_PER_YEAR)
      : 0;
  const needed = (other: FactionId) =>
    other === leader
      ? Math.min(odds, COALITION_ODDS)
      : rivals.has(other)
        ? Math.min(odds, RIVAL_ODDS) * (1 - hoardShare(other)) * (1 - stayedHome(other))
        : odds * sated;
  const income = tradeIncome(state).get(faction) ?? 0;
  const tradeCost = (other: FactionId) =>
    Object.values(state.tradeRoutes)
      .filter(
        (r) =>
          r.status === 'running' &&
          r.blocked === null &&
          ((r.owner === faction && r.partner === other) ||
            (r.partner === faction && r.owner === other)),
      )
      .reduce((sum, r) => sum + endRate(state, r, r.owner === faction ? r.from : r.to), 0);
  const scoreOf = (other: FactionId, theirs: number, km: number) =>
    Math.max(0, free) /
    Math.max(1, theirs) /
    (1 + Math.min(0.25, (tradeCost(other) / Math.max(1, income)) * 0.25)) /
    (needed(other) * (enemies.size === 0 ? 1 : 1 + km / WAR_DISTANCE_KM));

  // A neighbour scores at most its best city in reach would with no army near it, so
  // most are ruled out before a route to their front is looked for.
  const eligible = new Set<FactionId>();
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
        if (km > WAR_REACH_KM) continue;
        eligible.add(other.id);
        bound = Math.max(bound, scoreOf(other.id, weighedGarrison(theirs, state.day), km));
      }
      return bound > 0 ? [{ id: other.id, bound }] : [];
    })
    .sort((a, b) => b.bound - a.bound || (a.id < b.id ? -1 : 1));

  /**
   * A power at war with no great power presses a great-power neighbour that has kept to
   * its homeland, holding no more cities than the map gave it: its uncommitted armies
   * over that neighbour's, or nothing for one it may not press. Each existing front keeps
   * back at least its field strength or its city's blockade requirement, whichever is
   * greater, in the same strength points used for a garrison in normal war scoring. So a
   * rival who stays at home is pressed while minor cities are still left.
   */
  const atWarWithPower = [...enemies].some((enemy) => rivals.has(enemy));
  const pressureOn = (rival: FactionId) => {
    if (atWarWithPower || rival === faction || !rivals.has(rival)) return undefined;
    if ((citiesOf.get(rival)?.length ?? 0) > homelandOf(context.world, rival)) return undefined;
    if (truceBetween(state, faction, rival)) return undefined;
    return pressureFree / Math.max(1, strength.get(rival) ?? 0) / (1 - stayedHome(rival));
  };

  return {
    free,
    heldBy,
    rivals,
    frontOf,
    measure,
    scoreOf,
    hoardShare,
    stayedHome,
    pressureOn,
    eligible,
    candidates: candidates.filter((candidate) => candidate.bound >= 1),
  };
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

/** The provinces the map gives the faction, the cities it holds at the start. */
function homelandOf(world: World, faction: FactionId): number {
  return world.map.provinces.filter((province) => (province.owner as string) === faction).length;
}
