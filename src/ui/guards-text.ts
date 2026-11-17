import { dateText, factionName, reasonText, whole } from '../app/names.ts';
import { warReadiness } from '../sim/ai/war.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import {
  deterrentUntil,
  GUARD_BAND,
  GUARD_DETER_DAYS,
  GUARD_GOLD,
  guardRefusal,
} from '../sim/guards.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { City, GuardBand } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { World } from '../sim/world/world.ts';
import { NOTICE_DAYS, NOTICE_SHARE } from '../sim/ai/thresholds.ts';
import { mayDeclareWhen } from '../app/threat-news.ts';
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
  /**
   * For each great power that weighs this city before it declares war on the owner, how
   * near it stands now and with the band, such as "Carthage 85% → 74% of the strength it
   * needs to declare war, until Year 2, day 100", or that guards do not hold back a power
   * drawn by rival pressure. Empty when the hire is refused for a
   * reason other than gold.
   */
  readonly threats: readonly string[];
}

/** How long great powers count guards against a war, in a sentence with the number. */
export const GUARD_RULE = `A great power counts a band against a war on you for its first ${GUARD_DETER_DAYS} days, then reckons on it leaving. The band holds the walls for the whole year.`;

export interface CityGuards {
  /** The guards the city holds, when each band leaves, and any hire waiting for the next day. */
  readonly line: string;
  /** How many of its guards great powers still count against a war, and until when; undefined with none. */
  readonly weighed: string | undefined;
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
  const open = why === undefined || short;
  return {
    line: guardsLine(city.guards, next.guards.length - city.guards.length),
    weighed: weighedLine(city.guards, state.day),
    hire: {
      threats: hireThreats(
        waiting,
        open ? (short ? withGold(waiting, next) : waiting) : undefined,
        next,
        world,
        next.guards.length > city.guards.length,
      ),
      gold: GUARD_GOLD,
      change: open ? hireChange(short ? withGold(waiting, next) : waiting, next, world) : undefined,
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
 * Each great power that weighs the city before it declares on the owner, by the AI's own
 * reckoning, today and with one more band, played through the rules' handler. A power
 * drawn by rival pressure weighs field armies only, wherever they stand, so every city's
 * section names it and says guards change nothing. `state` is the day as the waiting orders
 * leave it, and `hiring` the state one more band is hired on, undefined when no
 * more band can be. A power at NOTICE_SHARE or more, now or with the band hired for the next
 * day, is told in words beside each number: where it stands now, and where one more band takes
 * it, still at NOTICE_SHARE or more and so free to declare from its day, or below, since a share
 * that falls reads as an answer and is not one while it stays on notice. One below NOTICE_SHARE
 * keeps the share now and with one more band.
 */
function hireThreats(
  state: State,
  hiring: State | undefined,
  city: DeepReadonly<City>,
  world: World,
  hired: boolean,
): string[] {
  let next: GameState | undefined;
  if (hiring) {
    next = structuredClone(hiring) as GameState;
    executeOrder(next, { kind: 'hireGuards', faction: city.owner, city: city.id }, world);
  }
  const until = dateText(state.day + GUARD_DETER_DAYS);
  const percent = (n: number) => `${Math.round(Math.min(1, n) * 100)}%`;
  const lines: string[] = [];
  for (const power of Object.values(state.factions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (power.id === city.owner || power.kind !== 'greatPower') continue;
    const now = warReadiness(state, world, power.id, city.owner);
    if (!now || (now.front !== city.id && !now.pressed)) continue;
    const name = factionName(state, power.id);
    const when = mayDeclareWhen(state, power.id);
    const verdict = (readiness: number) =>
      readiness >= NOTICE_SHARE
        ? `still at ${percent(NOTICE_SHARE)} or more, so it may still declare ${when}`
        : `below ${percent(NOTICE_SHARE)}, so it may not declare until it has stood at ${percent(NOTICE_SHARE)} for ${NOTICE_DAYS} days`;
    if (now.pressed) {
      if (next)
        lines.push(
          `${name} ${percent(now.readiness)} of the strength it needs to declare war, by its field armies against yours: guards do not hold that back`,
        );
      continue;
    }
    const then = next && warReadiness(next, world, power.id, city.owner);
    const oneMore = `One more band, counted until ${until}, takes it to ${percent(then?.readiness ?? 0)}, ${verdict(then?.readiness ?? 0)}`;
    if (hired && now.readiness >= NOTICE_SHARE)
      lines.push(
        `${name}, with the band you hired: ${percent(now.readiness)} of the strength it needs to declare war, ${verdict(now.readiness)}.${next ? ` ${oneMore}.` : ''}`,
      );
    else if (!next) continue;
    else if (now.readiness >= NOTICE_SHARE)
      lines.push(
        `${name} ${percent(now.readiness)} of the strength it needs to declare war. ${oneMore}.`,
      );
    else
      lines.push(
        `${name} ${percent(now.readiness)} → ${percent(then?.readiness ?? 0)} of the strength it needs to declare war, until ${until}`,
      );
  }
  return lines;
}

/**
 * "500 count against a war until Year 1, day 130", the bands great powers still weigh, or
 * "None count against a war now" once every band is past GUARD_DETER_DAYS.
 */
export function weighedLine(
  bands: readonly DeepReadonly<GuardBand>[],
  day: number,
): string | undefined {
  if (bands.length === 0) return undefined;
  const until = new Map<number, number>();
  for (const band of bands) {
    const last = deterrentUntil(band);
    if (last > day) until.set(last, (until.get(last) ?? 0) + GUARD_BAND);
  }
  if (until.size === 0) return 'None count against a war now';
  return [...until]
    .sort((a, b) => a[0] - b[0])
    .map(([last, men]) => `${whole(men)} count against a war until ${dateText(last)}`)
    .join(', ');
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
