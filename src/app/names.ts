import { BUILDINGS, type BuildingKind } from '../sim/buildings/buildings.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import type { Stance } from '../sim/state/army.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { SIEGE_DISTANCE } from '../sim/systems/sieges.ts';
import type { Troop } from '../sim/troops.ts';

export const TROOP_NAMES: Record<Troop, string> = {
  spearmen: 'Spearmen',
  swordsmen: 'Swordsmen',
  skirmishers: 'Skirmishers',
  archers: 'Archers',
  lightCavalry: 'Light cavalry',
  heavyCavalry: 'Heavy cavalry',
};

export const STANCE_NAMES: Record<Stance, string> = {
  holdTheLine: 'Hold the line',
  allOutAssault: 'All-out assault',
  skirmishAndWithdraw: 'Skirmish and withdraw',
};

/**
 * A point this close to a city is at it rather than near it, in km. It is the siege
 * distance, so an army the panel calls "at" an enemy city is one that besieges it.
 */
export const AT_CITY_KM = SIEGE_DISTANCE;

export function factionName(state: DeepReadonly<GameState>, faction: FactionId): string {
  return state.factions[faction]?.name ?? faction;
}

/** The city closest to the point and how far it is, in km. */
export function nearestCity(
  state: DeepReadonly<GameState>,
  point: MapPoint,
): { name: string; km: number } | undefined {
  let best: { name: string; km: number } | undefined;
  for (const city of Object.values(state.cities)) {
    const km = Math.hypot(city.position.x - point.x, city.position.y - point.y);
    if (!best || km < best.km) best = { name: city.name, km };
  }
  return best;
}

/** "at Roma" or "near Roma", after the city closest to the point. */
export function placeName(state: DeepReadonly<GameState>, point: MapPoint): string {
  const best = nearestCity(state, point);
  if (!best) return 'in the field';
  return `${best.km <= AT_CITY_KM ? 'at' : 'near'} ${best.name}`;
}

/**
 * A rejection reason as the rules write it, with record ids put into names. The rules
 * name armies, battles, sieges, and convoys by serial ids, which mean nothing to a player.
 */
export function reasonText(state: DeepReadonly<GameState>, reason: string): string {
  return reason
    .replace(/\bdestination -?[\d.]+, -?[\d.]+/g, 'the destination')
    .replace(/\b(?:the start )?-?[\d.]+, -?[\d.]+/g, (pair) =>
      pair.startsWith('the start') ? 'the start' : 'that point',
    )
    .replace(/\b(army|battle|siege|convoy) \1-\d+/g, 'the $1')
    .replace(/\b(?:army|battle|siege|convoy)-\d+/g, (id) => `the ${id.replace(/-\d+$/, '')}`)
    .replace(/[a-z][a-z-]*/g, (word) => {
      const city = Object.hasOwn(state.cities, word) ? state.cities[word as CityId] : undefined;
      if (city) return city.name;
      const faction = Object.hasOwn(state.factions, word)
        ? state.factions[word as FactionId]
        : undefined;
      return faction?.name ?? word;
    })
    .replace(/^./, (first) => first.toUpperCase());
}

/** What the player reads when the rules refuse an order. */
export function refusalText(state: DeepReadonly<GameState>, reason: string): string {
  return `Order refused. ${reasonText(state, reason)}.`;
}

/** Year 1 starts on day 1. A year is 365 days. */
export function dateText(day: number): string {
  return `Year ${Math.floor((day - 1) / 365) + 1}, day ${((day - 1) % 365) + 1}`;
}

export function whole(value: number): string {
  return Math.round(value).toLocaleString('en');
}

/** "Forum", "Forum and Towers", or "Forum, Canals and Towers", in the order given. */
export function buildingList(kinds: readonly BuildingKind[]): string {
  const names = kinds.map((kind) => BUILDINGS[kind].name);
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
    : (names[0] ?? '');
}
