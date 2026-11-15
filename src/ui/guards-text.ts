import { dateText, reasonText, whole } from '../app/names.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import { GUARD_BAND, GUARD_GOLD, guardRefusal } from '../sim/guards.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { City, GuardBand } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { World } from '../sim/world/world.ts';
import { afterWaiting } from './buildings-text.ts';

type State = DeepReadonly<GameState>;

export interface GuardsHire {
  readonly gold: number;
  /**
   * What a hire changes, such as "Garrison 3,000 → 3,500", also when gold is all it
   * lacks. Undefined when the rules refuse it for another reason.
   */
  readonly change: string | undefined;
  /** Why the rules would refuse the hire tomorrow, in words, or undefined. */
  readonly why: string | undefined;
}

export interface CityGuards {
  /** The guards the city holds, when each band leaves, and any hire waiting for the next day. */
  readonly line: string;
  readonly hire: GuardsHire;
}

/**
 * The city's hired guards for its owner's panel, on the day as the waiting orders leave
 * it, so the gold of today's orders is already spent. A hire is played through the
 * rules' own handler, so its garrison is the rules' answer.
 */
export function cityGuards(
  state: State,
  pending: readonly Order[],
  city: DeepReadonly<City>,
  world: World,
): CityGuards {
  const waiting = afterWaiting(state, pending, world);
  const next = waiting.cities[city.id] ?? city;
  const why = guardRefusal(waiting, next, state.player);
  const short = why !== undefined && !guardRefusal(withGold(waiting, next), next, state.player);
  return {
    line: guardsLine(city.guards, next.guards.length - city.guards.length),
    hire: {
      gold: GUARD_GOLD,
      change:
        why === undefined || short
          ? hireChange(short ? withGold(waiting, next) : waiting, next, world)
          : undefined,
      why: hireRefusalText(waiting, next, why, short),
    },
  };
}

/** A hire played through the rules' own handler on a copy of the day. */
function hireChange(state: State, city: DeepReadonly<City>, world: World): string {
  const hired = structuredClone(state) as GameState;
  executeOrder(hired, { kind: 'hireGuards', faction: city.owner, city: city.id }, world);
  const garrison = hired.cities[city.id]?.garrison ?? city.garrison;
  return `Garrison ${whole(city.garrison)} → ${whole(garrison)}`;
}

/**
 * "No guards hired", or "1,000 guards · 500 leave Year 2, day 40, 500 leave Year 2, day 101",
 * with the bands hired for the next day.
 */
export function guardsLine(bands: readonly DeepReadonly<GuardBand>[], ordered: number): string {
  const leaving = new Map<number, number>();
  for (const band of bands) leaving.set(band.until, (leaving.get(band.until) ?? 0) + GUARD_BAND);
  const terms = [...leaving].map(([until, men]) => `${whole(men)} leave ${dateText(until)}`);
  const held =
    bands.length === 0
      ? 'No guards hired'
      : `${whole(bands.length * GUARD_BAND)} guards · ${terms.join(', ')}`;
  return ordered > 0
    ? `${held} · ${whole(ordered * GUARD_BAND)} more hired for the next day`
    : held;
}

/** When gold is all a hire lacks, how much more it needs; else the rules' reason in words. */
function hireRefusalText(
  state: State,
  city: DeepReadonly<City>,
  why: string | undefined,
  short: boolean,
): string | undefined {
  if (why === undefined) return undefined;
  if (short) {
    const gold = state.factions[city.owner]?.stores.gold ?? 0;
    return `Needs ${whole(GUARD_GOLD - gold)} more gold`;
  }
  return reasonText(state, why).replace(/\b\d{4,}\b/g, (n) => whole(Number(n)));
}

function withGold(state: State, city: DeepReadonly<City>): State {
  const record = state.factions[city.owner];
  if (!record) return state;
  const stores = { ...record.stores, gold: GUARD_GOLD };
  return { ...state, factions: { ...state.factions, [city.owner]: { ...record, stores } } };
}
