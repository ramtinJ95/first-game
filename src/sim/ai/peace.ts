import type { DeepReadonly } from '../deep-readonly.ts';
import type { CityId, FactionId } from '../ids.ts';
import type { Order } from '../orders/orders.ts';
import { standingOffer } from '../peace/offer.ts';
import { warStanding, type WarStanding } from '../peace/standing.ts';
import {
  AS_THINGS_STAND,
  copyTerms,
  GOLD_PER_POINT,
  termsPoints,
  termsProblem,
} from '../peace/terms.ts';
import type { City } from '../state/city.ts';
import type { Day } from '../state/day.ts';
import type { PeaceTerms } from '../state/peace.ts';
import { warSides } from '../state/war.ts';
import { distance } from '../world/find-path.ts';
import type { Context } from './armies.ts';
import { sorted, type State } from './situation.ts';
import {
  GOLD_STEP,
  MAX_WEARINESS,
  MIN_WAR_DAYS,
  OFFER_GAP_DAYS,
  OTHER_WAR_POINTS,
  PEACE_RESOLVE,
  SHORTAGE_POINTS,
  WEARY_DAYS,
} from './thresholds.ts';

export type PeaceFactorKind =
  'standing' | 'weariness' | 'otherWars' | 'shortage' | 'resolve' | 'restraint' | 'terms';

/** A token clash is not a defeat. Count actual losses against survivors plus those losses. */
export const SMALL_LOSS_SHARE = 0.1;
export const EVEN_WAR_DAYS = PEACE_RESOLVE * WEARY_DAYS;

/** Sieges affect the bargaining score, but cannot manufacture a defeat for the floor. */
export function warDamage(state: State, standing: WarStanding) {
  const living = (faction: FactionId) => Object.values(state.formations).reduce(
    (men, formation) => men + (state.armies[formation.army]?.owner === faction ? formation.men : 0), 0,
  );
  const ownShare = standing.menLost / Math.max(1, standing.menLost + living(standing.faction));
  const enemyShare = standing.enemyMenLost / Math.max(1, standing.enemyMenLost + living(standing.enemy));
  const citiesChanged = standing.taken.length + standing.lost.length > 0;
  return {
    ownShare,
    enemyShare,
    even: !citiesChanged && ownShare <= SMALL_LOSS_SHARE && enemyShare <= SMALL_LOSS_SHARE,
    losing: standing.points.cities + standing.points.battles < 0 &&
      (standing.lost.length > 0 || ownShare > SMALL_LOSS_SHARE),
  };
}

/** One reason that moves a faction toward peace, with positive points, or away from it. */
export interface PeaceFactor {
  readonly kind: PeaceFactorKind;
  readonly points: number;
  readonly text: string;
}

/** "peace as things stand", or "peace: you give 1,000 gold", as the reader reads an offer. */
export function peaceText(
  state: State,
  terms: DeepReadonly<PeaceTerms>,
  reader?: FactionId,
): string {
  return terms.kind === 'asThingsStand'
    ? 'peace as things stand'
    : `peace: ${termsText(state, terms, reader)}`;
}

/** How much a faction wants peace with an enemy, before any terms. */
export interface PeaceWish {
  readonly faction: FactionId;
  readonly enemy: FactionId;
  /** The first day it talks of peace, while the war is younger than MIN_WAR_DAYS. */
  readonly talksFrom: Day | undefined;
  readonly factors: readonly PeaceFactor[];
  /** The sum of the factors. Terms worth at least minus this to the faction satisfy it. */
  readonly wish: number;
}

/** A faction's answer to terms of peace, and every reason for it. */
export interface PeaceAnswer {
  readonly accepts: boolean;
  /** Why the terms cannot be met today, such as gold the payer lacks. */
  readonly problem: string | undefined;
  readonly wish: PeaceWish;
  readonly terms: PeaceFactor;
  /** The points of terms the faction still wants, 0 when it accepts. */
  readonly short: number;
  /** One sentence a player reads: the answer and what stands against it. */
  readonly verdict: string;
}

const nameOf = (state: State, faction: FactionId) => state.factions[faction]?.name ?? faction;
const cityName = (state: State, id: CityId) => state.cities[id]?.name ?? id;
const gold = (amount: number) => `${Math.round(amount).toLocaleString('en')} gold`;

function listed(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1) as string}`;
}

/** What the payer gives, in words. */
function goodsText(state: State, terms: DeepReadonly<PeaceTerms & { kind: 'payment' }>): string {
  return listed([
    ...(terms.gold > 0 ? [gold(terms.gold)] : []),
    ...terms.cities.map((id) => cityName(state, id)),
  ]);
}

/** The terms in words, as the reader reads them when one is named: "you give", "gives you". */
export function termsText(
  state: State,
  terms: DeepReadonly<PeaceTerms>,
  reader?: FactionId,
): string {
  if (terms.kind === 'asThingsStand') return 'peace as things stand';
  const goods = goodsText(state, terms);
  if (reader === terms.payer) return `you give ${goods}`;
  return `${nameOf(state, terms.payer)} gives ${reader ? 'you ' : ''}${goods}`;
}

/**
 * How much the faction wants peace with the enemy: minus how the war stands for it, plus a
 * point for every WEARY_DAYS of war up to MAX_WEARINESS, plus OTHER_WAR_POINTS for each
 * other war against a great power, plus SHORTAGE_POINTS while it is short of gold or
 * food, less PEACE_RESOLVE. A losing side's wish is floored at zero, with a visible
 * restraint factor: it cannot demand payment from its winner. It does not talk at all
 * in a war younger than MIN_WAR_DAYS.
 */
export function peaceWish(
  state: State,
  faction: FactionId,
  enemy: FactionId,
): PeaceWish | undefined {
  const standing = warStanding(state, faction, enemy);
  const record = state.factions[faction];
  if (!standing || !record) return undefined;
  const name = record.name;
  const factors: PeaceFactor[] = [];
  const add = (kind: PeaceFactorKind, points: number, text: string) => {
    if (points !== 0) factors.push({ kind, points, text });
  };
  add(
    'standing',
    -standing.score,
    standing.score > 0 ? `${name} is winning the war` : `${name} is losing the war`,
  );
  add(
    'weariness',
    Math.min(MAX_WEARINESS, Math.floor(standing.days / WEARY_DAYS)),
    `The war has lasted ${standing.days} days`,
  );
  const others = Object.keys(state.wars)
    .sort()
    .flatMap((key) => {
      const sides = warSides(key);
      if (!sides?.includes(faction)) return [];
      const other = sides[0] === faction ? sides[1] : sides[0];
      const rival = state.factions[other];
      return other !== enemy && rival?.kind === 'greatPower' && rival.defeatedOn === null
        ? [rival.name]
        : [];
    });
  add('otherWars', OTHER_WAR_POINTS * others.length, `${name} also fights ${listed(others)}`);
  const short = (['gold', 'food'] as const).filter((store) => record.stores[store] < 0);
  add('shortage', short.length > 0 ? SHORTAGE_POINTS : 0, `${name} is short of ${listed(short)}`);
  add('resolve', -PEACE_RESOLVE, `${name} does not end a war for nothing`);
  const reckoning = factors.reduce((sum, factor) => sum + factor.points, 0);
  const damage = warDamage(state, standing);
  if (damage.even) {
    const mature = standing.days >= EVEN_WAR_DAYS;
    const target = mature ? Math.max(0, reckoning) : Math.min(reckoning, -Math.max(1, PEACE_RESOLVE - Math.floor(standing.days / WEARY_DAYS)));
    factors.push({ kind: 'restraint', points: target - reckoning,
      text: `Neither side lost a city or more than ${SMALL_LOSS_SHARE * 100}% of its soldiers; ${mature ? `the even war has lasted ${EVEN_WAR_DAYS} days` : `peace as things stand waits ${EVEN_WAR_DAYS} days`}` });
  } else if (damage.losing) {
    add('restraint', Math.max(0, -reckoning), `${name} cannot demand payment while losing`);
  }
  const talksFrom =
    standing.days < MIN_WAR_DAYS ? ((standing.since + MIN_WAR_DAYS) as Day) : undefined;
  return {
    faction,
    enemy,
    talksFrom,
    factors,
    wish: factors.reduce((sum, factor) => sum + factor.points, 0),
  };
}

/**
 * The faction's answer to an offer of peace on the terms from the enemy. It accepts when
 * its wish for peace and the terms' worth to it add up to at least 0, the terms can be
 * met, and the war is at least MIN_WAR_DAYS old. The AI answers by it, and the panel
 * shows it before an offer is made.
 */
export function peaceAnswer(
  state: State,
  faction: FactionId,
  enemy: FactionId,
  terms: DeepReadonly<PeaceTerms>,
): PeaceAnswer | undefined {
  const wish = peaceWish(state, faction, enemy);
  if (!wish) return undefined;
  const name = nameOf(state, faction);
  const worth = termsPoints(state, terms, faction);
  const termsFactor: PeaceFactor = {
    kind: 'terms',
    points: Math.round(worth),
    text:
      terms.kind === 'asThingsStand'
        ? 'Nothing changes hands'
        : `${terms.payer === faction ? `${name} gives` : `${name} gains`} ${goodsText(state, terms)}`,
  };
  const problem = termsProblem(state, [faction, enemy], terms);
  const short = Math.max(0, Math.ceil(-(wish.wish + worth)));
  const accepts = !problem && wish.talksFrom === undefined && short === 0;
  const verdict = problem
    ? `These terms cannot be met: ${problem}.`
    : wish.talksFrom !== undefined
      ? `${name} will not talk of peace before day ${wish.talksFrom}.`
      : accepts
        ? `${name} would accept.`
        : `${name} would refuse. It wants terms worth ${short} points more, such as ${gold(short * GOLD_PER_POINT)} more.`;
  return { accepts, problem, wish, terms: termsFactor, short, verdict };
}

/** A payer's cities it could hand over: neither its capital nor its last, besieged by the receiver first, then nearest the receiver. */
function cedable(state: State, payer: FactionId, receiver: FactionId): DeepReadonly<City>[] {
  const own = sorted(state.cities).filter((city) => city.owner === payer);
  if (own.length < 2) return [];
  const theirs = sorted(state.cities).filter((city) => city.owner === receiver);
  const besieged = new Set(
    sorted(state.sieges)
      .filter((siege) => siege.besiegers.some((id) => state.armies[id]?.owner === receiver))
      .map((siege) => siege.city),
  );
  const near = (city: DeepReadonly<City>) =>
    Math.min(...theirs.map((other) => distance(other.position, city.position)));
  return own
    .filter((city) => city.rank !== 'capital')
    .sort(
      (a, b) =>
        Number(besieged.has(b.id)) - Number(besieged.has(a.id)) ||
        near(a) - near(b) ||
        (a.id < b.id ? -1 : 1),
    );
}

/**
 * Terms in which the payer gives the receiver between `least` and `most` points, gold
 * first and then one city and gold, aiming at `most` or at `least`, or undefined.
 */
export function paymentBetween(
  state: State,
  payer: FactionId,
  receiver: FactionId,
  least: number,
  most: number,
  aim: 'most' | 'least',
): PeaceTerms | undefined {
  const purse = Math.max(
    0,
    Math.floor((state.factions[payer]?.stores.gold ?? 0) / GOLD_STEP) * GOLD_STEP,
  );
  const goldFor = (low: number, high: number): number | undefined => {
    const floor = Math.max(0, Math.ceil((low * GOLD_PER_POINT) / GOLD_STEP) * GOLD_STEP);
    const ceiling = Math.min(purse, Math.floor((high * GOLD_PER_POINT) / GOLD_STEP) * GOLD_STEP);
    if (floor > ceiling) return undefined;
    return aim === 'most' ? ceiling : floor;
  };
  const coins = goldFor(least, most);
  if (coins !== undefined && coins > 0) return { kind: 'payment', payer, gold: coins, cities: [] };
  for (const city of cedable(state, payer, receiver)) {
    const points = termsPoints(
      state,
      { kind: 'payment', payer, gold: 0, cities: [city.id] },
      receiver,
    );
    const rest = goldFor(least - points, most - points);
    if (rest !== undefined) return { kind: 'payment', payer, gold: rest, cities: [city.id] };
  }
  return undefined;
}

/**
 * The terms the faction offers the enemy, or undefined when no terms satisfy both sides
 * by `peaceWish`. A faction that is winning asks for the most the enemy would give. Any
 * other asks for no more than it needs, or offers the least the enemy would take, which is
 * peace as things stand when neither side wants anything.
 */
export function proposal(
  state: State,
  faction: FactionId,
  enemy: FactionId,
): PeaceTerms | undefined {
  const own = peaceWish(state, faction, enemy);
  const theirs = peaceWish(state, enemy, faction);
  if (!own || !theirs || own.talksFrom !== undefined || theirs.talksFrom !== undefined)
    return undefined;
  const need = -own.wish;
  const theirNeed = -theirs.wish;
  if (need + theirNeed > 0) return undefined;
  const most = -theirNeed;
  const winning = (warStanding(state, faction, enemy)?.score ?? 0) > 0;
  const standing = warStanding(state, faction, enemy);
  if (standing && warDamage(state, standing).even && standing.days >= EVEN_WAR_DAYS) return AS_THINGS_STAND;
  if (winning && most > 0) {
    const asked = paymentBetween(state, enemy, faction, Math.max(need, 0), most, 'most');
    if (asked) return asked;
  }
  if (need <= 0 && theirNeed <= 0) return AS_THINGS_STAND;
  if (need > 0) return paymentBetween(state, enemy, faction, need, most, 'least');
  return paymentBetween(state, faction, enemy, theirNeed, -need, 'least');
}

/**
 * The faction's answers to the offers that wait for it, each by `peaceAnswer`, and at most
 * one offer of its own a day: in the first war, by enemy id, with no offer waiting and none
 * made in the last OFFER_GAP_DAYS, where `proposal` finds terms.
 */
export function peaceOrders({ state, faction }: Context): Order[] {
  const orders: Order[] = [];
  const answered = new Set<string>();
  for (const key of Object.keys(state.peaceOffers).sort()) {
    const sides = warSides(key);
    if (!sides?.includes(faction)) continue;
    const enemy = sides[0] === faction ? sides[1] : sides[0];
    const offer = standingOffer(state, faction, enemy);
    if (!offer || offer.from === faction) continue;
    answered.add(enemy);
    const answer = peaceAnswer(state, faction, enemy, offer.terms);
    orders.push(
      answer?.accepts
        ? { kind: 'acceptPeace', faction, from: enemy, terms: copyTerms(offer.terms), reckon: true }
        : { kind: 'refusePeace', faction, from: enemy, reckon: true },
    );
  }
  for (const key of Object.keys(state.wars).sort()) {
    const sides = warSides(key);
    if (!sides?.includes(faction)) continue;
    const enemy = sides[0] === faction ? sides[1] : sides[0];
    const war = state.wars[key as keyof typeof state.wars];
    if (!war || answered.has(enemy) || standingOffer(state, faction, enemy)) continue;
    if (war.offeredOn !== null && state.day - war.offeredOn < OFFER_GAP_DAYS) continue;
    const terms = proposal(state, faction, enemy);
    if (terms) return [...orders, { kind: 'offerPeace', faction, to: enemy, terms }];
  }
  return orders;
}
