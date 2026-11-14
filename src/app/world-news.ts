import { LEADER_SHARE } from '../sim/ai/thresholds.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { DayEvent } from '../sim/events.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { warSides, type WarKey } from '../sim/state/war.ts';
import type { World } from '../sim/world/world.ts';
import type { Alert } from './alerts.ts';
import { factionName, whole } from './names.ts';

type State = DeepReadonly<GameState>;

/**
 * A city that changes hands between two other factions is news to the player when it
 * stands this close to one of the player's cities, in km: 16 days' march, which takes in
 * the cities on a great power's borders at the start, such as Mediolanum and Salona for
 * Rome, at about 310 km.
 */
export const NEAR_KM = 400;

/**
 * The news of the world beyond the player's own affairs, which every power hears
 * whether it sees the place or not: a war between two other great powers and a peace
 * between them, a great capital that falls, a great power destroyed, a new leading
 * power, and a city near the player's land that changes hands, in war or by a peace. The player's own wars,
 * cities, and defeat are told by `alertsOfDay`, so none of these is about the player.
 */
export function worldNewsOfDay(
  before: State,
  after: State,
  events: readonly DeepReadonly<DayEvent>[],
  world: World,
): Alert[] {
  const player = after.player;
  const day = before.day;
  const news: Alert[] = [];
  const add = (alert: Omit<Alert, 'day' | 'tone'>) => news.push({ ...alert, day, tone: 'neutral' });
  const great = (faction: FactionId) => after.factions[faction]?.kind === 'greatPower';
  const others = (a: FactionId, b: FactionId) => a !== player && b !== player;

  for (const event of events) {
    if (event.kind !== 'warDeclared') continue;
    if (!others(event.by, event.against) || !great(event.by) || !great(event.against)) continue;
    add({
      kind: 'powersAtWar',
      world: 'corner',
      text: `${factionName(after, event.by)} declared war on ${factionName(after, event.against)}`,
    });
  }

  for (const key of Object.keys(before.wars) as WarKey[]) {
    const sides = warSides(key);
    if (after.wars[key] || !sides) continue;
    const [a, b] = sides;
    if (!others(a, b) || !great(a) || !great(b)) continue;
    // A war that ends with a power's fall is told as that fall.
    if (after.factions[a]?.defeatedOn !== null || after.factions[b]?.defeatedOn !== null) continue;
    add({
      kind: 'powersMadePeace',
      world: 'corner',
      text: `${factionName(after, a)} and ${factionName(after, b)} made peace`,
    });
  }

  // A city a peace hands over, by who receives it, so one taken from them later that day fell.
  const ceded = new Map<CityId, FactionId>();
  for (const event of events) {
    if (event.kind !== 'peaceMade' || event.terms.kind !== 'payment') continue;
    const payer = event.terms.payer;
    const receiver = event.between.find((side) => side !== payer);
    if (receiver) for (const id of event.terms.cities) ceded.set(id, receiver);
  }
  const own = Object.values(after.cities).filter((city) => city.owner === player);
  const near = (at: MapPoint) =>
    own.some((city) => Math.hypot(city.position.x - at.x, city.position.y - at.y) <= NEAR_KM);
  for (const city of Object.values(after.cities)) {
    const was = before.cities[city.id];
    if (!was || was.owner === city.owner || !others(was.owner, city.owner)) continue;
    const byPeace = ceded.get(city.id) === city.owner;
    const focus = {
      at: city.position,
      select: { kind: 'province', province: city.province },
    } as const;
    if (city.rank === 'capital') {
      // The map names each great power's capital by the id its city keeps.
      const home = world.map.provinces.find(
        (province) => province.capital && (province.id as string) === city.id,
      );
      const first = home && home.owner !== 'independent' ? (home.owner as FactionId) : was.owner;
      add({
        kind: 'capitalFell',
        world: 'corner',
        text:
          first === city.owner
            ? `${factionName(after, city.owner)} took back its capital ${city.name} from ${factionName(after, was.owner)}${byPeace ? ' by a peace' : ''}`
            : first === was.owner
              ? `${city.name}, the capital of ${factionName(after, first)}, ${byPeace ? 'was ceded' : 'fell'} to ${factionName(after, city.owner)}`
              : `${city.name}, the capital of ${factionName(after, first)}, ${byPeace ? 'was ceded by' : 'fell from'} ${factionName(after, was.owner)} to ${factionName(after, city.owner)}`,
        focus,
      });
    } else if (near(city.position)) {
      add({
        kind: 'cityNearFell',
        world: 'chronicle',
        text: `${city.name} ${byPeace ? 'was ceded' : 'fell'} to ${factionName(after, city.owner)}, ${whole(nearestKm(own, city.position))} km from your land`,
        focus,
      });
    }
  }

  for (const faction of Object.values(after.factions)) {
    if (faction.id === player || faction.kind !== 'greatPower') continue;
    if (faction.defeatedOn === null || before.factions[faction.id]?.defeatedOn !== null) continue;
    add({
      kind: 'powerFell',
      world: 'corner',
      text: `${faction.name} has fallen: it holds no city`,
    });
  }

  const leader = leadingPower(after);
  if (leader && leader !== leadingPower(before)) {
    const cities = Object.values(after.cities).filter((city) => city.owner === leader).length;
    add({
      kind: 'newLeader',
      world: 'corner',
      text:
        leader === player
          ? `You are now the leading power, with ${cities} cities: the other powers will join against you`
          : `${factionName(after, leader)} is now the leading power, with ${cities} cities: the other powers will join against it`,
    });
  }

  return news;
}

/**
 * The great power the others join against, by the AI's own rule: it holds at least
 * `LEADER_SHARE` of all cities and more than any other great power.
 */
export function leadingPower(state: State): FactionId | undefined {
  const counts = new Map<FactionId, number>();
  const cities = Object.values(state.cities);
  for (const city of cities) {
    if (state.factions[city.owner]?.kind !== 'greatPower') continue;
    counts.set(city.owner, (counts.get(city.owner) ?? 0) + 1);
  }
  const [first, second] = [...counts].sort((a, b) => b[1] - a[1]);
  if (!first || first[1] < LEADER_SHARE * cities.length) return undefined;
  return second && second[1] === first[1] ? undefined : first[0];
}

function nearestKm(cities: readonly DeepReadonly<{ position: MapPoint }>[], at: MapPoint): number {
  return Math.min(...cities.map((c) => Math.hypot(c.position.x - at.x, c.position.y - at.y)));
}
