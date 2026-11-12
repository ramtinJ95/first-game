import { factionName, nearestCity, placeName } from '../app/names.ts';
import { factionColour } from '../render/palette.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { FactionId } from '../sim/ids.ts';
import { CONVOY_KM_PER_DAY, MARCH_KM_PER_DAY } from '../sim/march.ts';
import type { Order } from '../sim/orders/orders.ts';
import type { Army } from '../sim/state/army.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { MapPoint } from '../sim/state/map-point.ts';

type State = DeepReadonly<GameState>;

export function cssColour(state: State, faction: FactionId): string {
  return `#${factionColour(state, faction).toString(16).padStart(6, '0')}`;
}

function pathKm(from: MapPoint, waypoints: readonly MapPoint[]): number {
  let km = 0;
  let at = from;
  for (const point of waypoints) {
    km += Math.hypot(point.x - at.x, point.y - at.y);
    at = point;
  }
  return km;
}

function daysLeft(km: number, perDay: number): string {
  const days = Math.max(1, Math.ceil(km / perDay));
  return `${days} ${days === 1 ? 'day' : 'days'} left`;
}

function destination(state: State, end: MapPoint | undefined): string {
  const city = end && nearestCity(state, end);
  if (!city) return '';
  return city.km <= 15 ? ` to ${city.name}` : ` toward ${city.name}`;
}

/** What the army is doing, in a line a player reads at a glance. */
export function activityText(state: State, army: DeepReadonly<Army>): string {
  const { activity } = army;
  switch (activity.kind) {
    case 'idle':
      return `Idle ${placeName(state, activity.position)}`;
    case 'marching':
      return `Marching${destination(state, activity.waypoints.at(-1))} · ${daysLeft(
        pathKm(activity.position, activity.waypoints),
        MARCH_KM_PER_DAY,
      )}`;
    case 'inBattle': {
      const battle = state.battles[activity.battle];
      const day = battle ? state.day - battle.startedOn + 1 : 1;
      return `In battle ${placeName(state, activity.position)} · day ${day}`;
    }
    case 'besieging': {
      const siege = state.sieges[activity.siege];
      const city = siege && state.cities[siege.city];
      const day = siege ? state.day - siege.startedOn + 1 : 1;
      return `Besieging ${city?.name ?? 'a city'} · day ${day}`;
    }
    case 'embarked': {
      const convoy = state.convoys[activity.convoy];
      if (!convoy) return 'At sea';
      return `At sea${destination(state, convoy.waypoints.at(-1))} · ${daysLeft(
        pathKm(convoy.position, convoy.waypoints),
        CONVOY_KM_PER_DAY,
      )}`;
    }
  }
}

export function ownerLine(state: State, faction: FactionId): string {
  const record = state.factions[faction];
  if (faction === state.player) return `${factionName(state, faction)} (you)`;
  return record?.kind === 'minor'
    ? `${factionName(state, faction)}, an independent city`
    : factionName(state, faction);
}

/** The last order of a kind waiting for the next day that matches, if any. */
export function pendingOrder<K extends Order['kind']>(
  pending: readonly Order[],
  kind: K,
  matches: (order: Extract<Order, { kind: K }>) => boolean,
): Extract<Order, { kind: K }> | undefined {
  return pending.findLast(
    (order): order is Extract<Order, { kind: K }> =>
      order.kind === kind && matches(order as Extract<Order, { kind: K }>),
  );
}

export function signed(value: number): string {
  const text = Math.abs(value) >= 100 ? Math.round(value).toLocaleString('en') : value.toFixed(1);
  return value >= 0 ? `+${text}` : text.replace('-', '−');
}
