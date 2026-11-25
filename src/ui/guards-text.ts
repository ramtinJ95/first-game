import { dateText, factionName, reasonText, whole } from '../app/names.ts';
import { warReadiness } from '../sim/ai/war.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import {
  deterrentUntil,
  GUARD_BAND,
  GUARD_DETER_DAYS,
  GUARD_GOLD,
  guardLimit,
  guardMen,
  guardRefusal,
  hiredOn,
  replaced,
} from '../sim/guards.ts';
import { executeOrder, type Order } from '../sim/orders/orders.ts';
import type { City, GuardBand } from '../sim/state/city.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { World } from '../sim/world/world.ts';
import type { FactionId } from '../sim/ids.ts';
import { NOTICE_SHARE } from '../sim/ai/thresholds.ts';
import { share, verdictText } from '../app/threat-news.ts';
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
/** The rule in a sentence, for a band that serves `term`, such as "a year". */
export const guardRule = (term: string) =>
  `A great power counts a band against a war on you for its first ${GUARD_DETER_DAYS} days, then reckons on it leaving. The band holds the walls for ${term === 'a year' ? 'the whole year' : `all its ${term}`}.`;

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
  // A band that takes the place of an old one leaves the count as it was, so a waiting hire is a band of the day's term.
  const ofToday = (bands: readonly DeepReadonly<GuardBand>[]) =>
    bands.filter((band) => hiredOn(band) >= state.day).length;
  const hired = ofToday(next.guards) - ofToday(city.guards);
  return {
    line: guardsLine(city.guards, hired),
    weighed: weighedLine(city.guards, state.day),
    hire: {
      threats: hireThreats(
        waiting,
        open ? (short ? withGold(waiting, next) : waiting) : undefined,
        next,
        world,
        hired,
        guardMen(next) + GUARD_BAND > guardLimit(next) && replaced(next, waiting.day) < 0,
      ),
      gold: GUARD_GOLD,
      change: open ? hireChange(short ? withGold(waiting, next) : waiting, next, world) : undefined,
      why: hireRefusalText(waiting, next, why, short),
    },
  };
}

/**
 * A hire played through the rules' own handler on a copy of the day. At a city full of guards
 * the new band takes the place of one no great power still counts, which leaves the garrison
 * as it is, so the change names that band instead.
 */
function hireChange(state: State, city: DeepReadonly<City>, world: World): string {
  const old =
    guardMen(city) + GUARD_BAND > guardLimit(city)
      ? city.guards[replaced(city, state.day)]
      : undefined;
  if (old)
    return `Takes the place of the ${whole(GUARD_BAND)} who leave ${dateText(old.until)}, whom no great power still counts`;
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
 * leave it, with `hired` bands hired for the next day, and `hiring` the state one more band is
 * hired on, undefined when no more band can be. A power at NOTICE_SHARE or more, now or with the
 * bands hired, is told whether it is still free to declare from its day, once, and where one more
 * band takes it; when one is not enough, how many bands the city may still hold take it below
 * NOTICE_SHARE, or that guards alone cannot, since a share that falls reads as an answer and is
 * not one while it stays on notice, and, at a city that holds the most guards it may (`full`), that
 * guards alone cannot. One below NOTICE_SHARE keeps the share now and with one more band.
 */
function hireThreats(
  state: State,
  hiring: State | undefined,
  city: DeepReadonly<City>,
  world: World,
  hired: number,
  full: boolean,
): string[] {
  const until = dateText(state.day + GUARD_DETER_DAYS);
  const lines: string[] = [];
  for (const power of Object.values(state.factions).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (power.id === city.owner || power.kind !== 'greatPower') continue;
    const now = warReadiness(state, world, power.id, city.owner);
    if (!now || (now.front !== city.id && !now.pressed)) continue;
    const name = factionName(state, power.id);
    if (now.pressed) {
      if (hiring)
        lines.push(
          `${name} ${share(now.readiness)} of the strength it needs to declare war, by its field armies against yours: guards do not hold that back`,
        );
      continue;
    }
    const bands = hiring ? sharesWithBands(hiring, city, world, power.id) : [];
    const [then] = bands;
    const held = now.readiness >= NOTICE_SHARE;
    if (!held) {
      if (then !== undefined)
        lines.push(
          `${name} ${share(now.readiness)} → ${share(then)} of the strength it needs to declare war, until ${until}`,
        );
      continue;
    }
    if (hired === 0 && then === undefined && !full) continue;
    const opening =
      hired > 0
        ? `${name}, with the ${hired === 1 ? 'band' : `${whole(hired)} bands`} you hired: ${share(now.readiness)} of the strength it needs to declare war`
        : `${name} ${share(now.readiness)} of the strength it needs to declare war`;
    lines.push(
      `${opening}${bandsText(state, power.id, now.readiness, bands, hired > 0, until, city)}${full ? ` ${city.name} holds the most guards it may: guards alone cannot take it below ${share(NOTICE_SHARE)}.` : ''}`,
    );
  }
  return lines;
}

/**
 * The power's share with one more band, two, and so on, each played through the rules' handler
 * with the gold a band costs where the treasury runs short, until it falls below NOTICE_SHARE or
 * the city holds the most guards it can.
 */
function sharesWithBands(
  hiring: State,
  city: DeepReadonly<City>,
  world: World,
  power: FactionId,
): number[] {
  const shares: number[] = [];
  let next = hiring;
  for (;;) {
    const copy = structuredClone(next) as GameState;
    const stores = copy.factions[city.owner]?.stores;
    if (stores && stores.gold < GUARD_GOLD) stores.gold = GUARD_GOLD;
    if (executeOrder(copy, { kind: 'hireGuards', faction: city.owner, city: city.id }, world))
      return shares;
    const readiness = warReadiness(copy, world, power, city.owner)?.readiness ?? 0;
    shares.push(readiness);
    if (readiness < NOTICE_SHARE) return shares;
    next = copy;
  }
}

/**
 * After the share now: still free to declare from its day, said once, and where one more band
 * takes it, then, when one is not enough, the bands that take it below NOTICE_SHARE or that the
 * city may hold no more.
 */
function bandsText(
  state: State,
  power: FactionId,
  now: number,
  bands: readonly number[],
  hired: boolean,
  until: string,
  city: DeepReadonly<City>,
): string {
  const [then] = bands;
  const held = `, ${verdictText(state, power, now)}.`;
  if (then === undefined) return held;
  const one = `One more band, counted until ${until}`;
  if (then < NOTICE_SHARE)
    return `${hired ? held : '.'} ${one}, takes it to ${share(then)}, ${verdictText(state, power, then)}.`;
  const last = bands.at(-1) ?? then;
  const count = bands.length;
  if (last < NOTICE_SHARE)
    return `${held} ${one}, takes it to ${share(then)}; ${whole(count)} bands, ${whole(count * GUARD_GOLD)} gold, take it to ${share(last)}, ${verdictText(state, power, last)}.`;
  const cap = `guards alone cannot take it below ${share(NOTICE_SHARE)}`;
  return count === 1
    ? `${held} ${one} and the last ${city.name} may hold, takes it to ${share(then)}: ${cap}.`
    : `${held} ${one}, takes it to ${share(then)}, and all ${whole(count)} bands ${city.name} may still hire, ${whole(count * GUARD_GOLD)} gold, take it ${share(last) === share(then) ? 'no lower' : `to ${share(last)}`}: ${cap}.`;
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
