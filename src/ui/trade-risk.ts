import { enemiesOf } from '../sim/ai/situation.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import { truceBetween } from '../sim/peace/truce.ts';
import type { Sight } from '../sim/sight.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { menOf } from '../sim/systems/economy.ts';
import { distanceToRoute, RAID_KM } from '../sim/trade/routes.ts';

type State = DeepReadonly<GameState>;

/**
 * What could stop or close a route under today's rules, gravest first: a siege of an end
 * stops it and closes it if the city falls, a war between the two ends closes it, a
 * change of either city's owner closes it, and an enemy of either end near a land road
 * takes its cargo.
 */
export type TradeRisk =
  | { kind: 'besieged'; city: CityId; by: readonly FactionId[] }
  | { kind: 'joinsWar'; city: CityId; owner: FactionId; league: FactionId; against: FactionId }
  | { kind: 'atWar'; city: CityId; owner: FactionId; enemies: readonly FactionId[] }
  | { kind: 'raids'; enemies: readonly FactionId[]; near: number };

const GRAVITY: Record<TradeRisk['kind'], number> = { besieged: 0, joinsWar: 1, atWar: 2, raids: 3 };

/**
 * The risks to a route between two cities, as the player may know them: a siege names
 * only besiegers in sight, and a road counts only enemy armies in sight. `road` is the
 * land path; a sea route has none, since no army raids at sea.
 */
export function tradeRisk(
  state: State,
  sight: Sight,
  ends: readonly [DeepReadonly<City>, DeepReadonly<City>],
  road: readonly MapPoint[] | undefined,
): TradeRisk[] {
  const risks: TradeRisk[] = [];
  const owners = new Set(ends.map((end) => end.owner));
  for (const end of ends) {
    const siege = Object.values(state.sieges).find((s) => s.city === end.id);
    if (siege) {
      const by = siege.besiegers.flatMap((id) => {
        const owner = sight.armies.has(id) ? state.armies[id]?.owner : undefined;
        return owner ? [owner] : [];
      });
      risks.push({ kind: 'besieged', city: end.id, by: [...new Set(by)] });
    }
    if (end.owner === state.player) continue;
    const enemies = [...enemiesOf(state, end.owner)].filter((e) => !owners.has(e)).sort();
    if (enemies.length) risks.push({ kind: 'atWar', city: end.id, owner: end.owner, enemies });
    const league = state.factions[end.owner]?.league;
    if (!league || state.factions[league]?.defeatedOn !== null) continue;
    for (const against of [...enemiesOf(state, league)].sort()) {
      if (against === end.owner || enemiesOf(state, end.owner).has(against)) continue;
      if (truceBetween(state, end.owner, against)) continue;
      risks.push({ kind: 'joinsWar', city: end.id, owner: end.owner, league, against });
    }
  }
  if (road) {
    const raiders = new Set(
      [...owners].flatMap((owner) => [...enemiesOf(state, owner)]).filter((e) => !owners.has(e)),
    );
    if (raiders.size) {
      const near = Object.values(state.armies).filter((army) => {
        const at = army.activity;
        return (
          raiders.has(army.owner) &&
          sight.armies.has(army.id) &&
          (at.kind === 'idle' || at.kind === 'besieging' || at.kind === 'marching') &&
          menOf(state, army) > 0 &&
          distanceToRoute(at.position, { path: road }) <= RAID_KM
        );
      }).length;
      risks.push({ kind: 'raids', enemies: [...raiders].sort(), near });
    }
  }
  return risks.sort((a, b) => gravity(state, a) - gravity(state, b));
}

/** A league war on the player closes the route outright, so it outranks a war elsewhere. */
function gravity(state: State, risk: TradeRisk): number {
  if (risk.kind === 'joinsWar' && risk.against === state.player) return 0.5;
  return GRAVITY[risk.kind];
}

function names(state: State, factions: readonly FactionId[]): string {
  const all = factions.map((f) => (f === state.player ? 'you' : (state.factions[f]?.name ?? f)));
  return all.length > 1 ? `${all.slice(0, -1).join(', ')} and ${all.at(-1)}` : (all[0] ?? '');
}

const cityName = (state: State, city: CityId) => state.cities[city]?.name ?? city;
const factionName = (state: State, faction: FactionId) => state.factions[faction]?.name ?? faction;

/** One sentence a player reads for each risk, in the order `tradeRisk` gives them. */
export function riskText(state: State, risk: TradeRisk): string {
  const city = 'city' in risk ? cityName(state, risk.city) : '';
  switch (risk.kind) {
    case 'besieged':
      return `${city} is besieged${risk.by.length ? ` by ${names(state, risk.by)}` : ''}: deliveries stop while the siege lasts, and if ${city} falls, the route closes.`;
    case 'joinsWar': {
      const owner = factionName(state, risk.owner);
      const league = factionName(state, risk.league);
      return risk.against === state.player
        ? `${owner}'s league partner ${league} is at war with you, and ${owner} will join that war, which closes the route.`
        : `${owner}'s league partner ${league} is at war with ${names(state, [risk.against])}, and ${owner} will join it: if ${city} falls, the route closes.`;
    }
    case 'atWar':
      return `${factionName(state, risk.owner)} is at war with ${names(state, risk.enemies)}: if ${city} changes hands, the route closes.`;
    case 'raids':
      return `${names(state, risk.enemies)} could raid this road and take its cargo${
        risk.near
          ? `; ${risk.near === 1 ? 'one of their armies stands' : `${risk.near} of their armies stand`} within ${RAID_KM} km of it now`
          : ''
      }.`;
  }
}

/** The short mark a list row carries for its gravest risk, or nothing when none. */
export function riskMark(state: State, risks: readonly TradeRisk[]): string {
  const [first] = risks;
  if (!first) return '';
  switch (first.kind) {
    case 'besieged':
      return `${cityName(state, first.city)} besieged`;
    case 'joinsWar':
      return first.against === state.player
        ? `${factionName(state, first.owner)} joins a war on you`
        : `${factionName(state, first.owner)} joins a war`;
    case 'atWar':
      return `${factionName(state, first.owner)} at war`;
    case 'raids':
      return first.near ? 'raiders near the road' : 'road open to raids';
  }
}

/** The payback set against the gravest risk, so a player weighs the two together. */
export function paybackText(
  state: State,
  paybackDays: number,
  risks: readonly TradeRisk[],
): string {
  const years = `pays back in ${(paybackDays / 365).toFixed(1)} years`;
  const [first] = risks;
  if (!first) return `${years}; no war or siege threatens it now.`;
  return `${years}; ${riskText(state, first)}`;
}
