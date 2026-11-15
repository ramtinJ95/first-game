import { reasonText, whole } from '../app/names.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import {
  dismissedGuards,
  dismissRefusal,
  GUARD_GOLD,
  GUARD_UPKEEP,
  guardRefusal,
} from '../sim/guards.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { City } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { dailyBalances } from '../sim/systems/economy.ts';
import type { World } from '../sim/world/world.ts';
import { afterWaiting } from './buildings-text.ts';
import { signed } from './describe.ts';

type State = DeepReadonly<GameState>;

export interface GuardsHire {
  readonly gold: number;
  /**
   * What a hire changes, such as "Garrison 3,000 → 3,500 · gold +20.1 → +10.1 a day",
   * also when gold is all it lacks. Undefined when the rules refuse it for another reason.
   */
  readonly change: string | undefined;
  /** Why the rules would refuse the hire tomorrow, in words, or undefined. */
  readonly why: string | undefined;
}

export interface CityGuards {
  /** The guards the city holds, their daily cost, and any hire or dismissal waiting for the next day. */
  readonly line: string;
  readonly hire: GuardsHire;
  /** The men a dismissal lets go, while the city will hold any. */
  readonly dismiss: number | undefined;
}

/**
 * The city's hired guards for its owner's panel, on the day as the waiting orders leave
 * it, so the gold of today's orders is already spent. A hire is played through the
 * rules' own handler, so its garrison and daily gold are the rules' answer.
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
    line: guardsLine(city.guards, next.guards - city.guards),
    hire: {
      gold: GUARD_GOLD,
      change:
        why === undefined || short
          ? hireChange(short ? withGold(waiting, next) : waiting, next, world)
          : undefined,
      why: hireRefusalText(waiting, next, why, short),
    },
    dismiss: dismissRefusal(next, state.player) ? undefined : dismissedGuards(next),
  };
}

/** A hire played through the rules' own handler on a copy of the day. */
function hireChange(state: State, city: DeepReadonly<City>, world: World): string {
  const hired = structuredClone(state) as GameState;
  executeOrder(hired, { kind: 'hireGuards', faction: city.owner, city: city.id }, world);
  const garrison = hired.cities[city.id]?.garrison ?? city.garrison;
  const now = dailyBalances(state).get(city.owner)?.gold ?? 0;
  const after = dailyBalances(hired).get(city.owner)?.gold ?? 0;
  return `Garrison ${whole(city.garrison)} → ${whole(garrison)} · gold ${signed(now)} → ${signed(after)} a day`;
}

/** "No guards hired", or "500 guards · 10 gold a day", with what the next day changes. */
export function guardsLine(guards: number, ordered: number): string {
  const held =
    guards === 0 ? 'No guards hired' : `${whole(guards)} guards · ${upkeepText(guards)} gold a day`;
  if (ordered === 0) return held;
  const change = ordered > 0 ? `${whole(ordered)} more hired` : `${whole(-ordered)} dismissed`;
  return `${held} · ${change} for the next day`;
}

function upkeepText(guards: number): string {
  const gold = guards * GUARD_UPKEEP;
  return Number.isInteger(gold) ? whole(gold) : gold.toFixed(1);
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
