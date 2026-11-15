import { dateText, factionName, peaceFundsText, reasonText, whole } from '../app/names.ts';
import {
  paymentBetween,
  peaceAnswer,
  peaceWish,
  peaceText,
  termsText,
  type PeaceAnswer,
} from '../sim/ai/peace.ts';
import { MIN_WAR_DAYS, OFFER_GAP_DAYS } from '../sim/ai/thresholds.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import type { Order } from '../sim/orders/orders.ts';
import { standingOffer } from '../sim/peace/offer.ts';
import { warStanding, type WarStanding } from '../sim/peace/standing.ts';
import { AS_THINGS_STAND, copyTerms, termsPoints, termsProblem } from '../sim/peace/terms.ts';
import {
  MAX_PAID_TRUCE_DAYS,
  TRUCE_DAYS,
  TRUCE_DAYS_PER_POINT,
  truceDaysLeft,
  truceLength,
} from '../sim/peace/truce.ts';
import type { GameState } from '../sim/state/game-state.ts';
import type { PeaceTerms } from '../sim/state/peace.ts';
import { warSides } from '../sim/state/war.ts';

type State = DeepReadonly<GameState>;

/** Rules may name records by id; the panel always uses their readable names. */
export function peaceVerdict(state: State, answer: PeaceAnswer): string {
  return reasonText(state, answer.verdict);
}

/** Terms the panel puts ready for the player to offer, with what the enemy would answer. */
export interface PeaceChoice {
  readonly label: string;
  readonly terms: PeaceTerms;
  readonly answer: PeaceAnswer;
}

/** One war of the player's as the wars panel shows it. */
export interface WarRow {
  readonly enemy: FactionId;
  readonly name: string;
  readonly standing: WarStanding;
  /** How the war goes, in one line. */
  readonly summary: string;
  readonly facts: readonly string[];
  /** The enemy's offer that waits for the player's answer. */
  readonly theirOffer:
    | {
        readonly terms: PeaceTerms;
        readonly text: string;
        readonly refusing: string;
        readonly funds: string | undefined;
        readonly change: string | undefined;
        readonly problem: string | undefined;
        /** How long the truce these terms start would hold. */
        readonly truce: string;
        /** The player's answer, queued for the next day. */
        readonly answered: string | undefined;
        /** Cheaper terms the enemy would take today, which the player can send as a counter-offer. */
        readonly counter: (PeaceChoice & { readonly text: string }) | undefined;
      }
    | undefined;
  /** The player's offer that waits, sent or still queued for the next day. */
  readonly ourOffer: string | undefined;
  readonly choices: readonly PeaceChoice[];
  readonly volatile: boolean;
}

export interface TruceRow {
  readonly enemy: FactionId;
  readonly name: string;
  readonly daysLeft: number;
  readonly text: string;
}

export interface WarRoom {
  readonly wars: readonly WarRow[];
  readonly truces: readonly TruceRow[];
}

function otherSide(key: string, faction: FactionId): FactionId | undefined {
  const sides = warSides(key);
  if (!sides?.includes(faction)) return undefined;
  return sides[0] === faction ? sides[1] : sides[0];
}

function citiesText(state: State, ids: readonly CityId[]): string {
  return ids.map((id) => state.cities[id]?.name ?? id).join(', ');
}

/** What a player can read of how the war stands, a line for each fact that counts. */
export function standingFacts(state: State, standing: WarStanding): string[] {
  const enemy = factionName(state, standing.enemy);
  const declared =
    standing.declaredBy === standing.faction ? 'You declared it' : `${enemy} declared it`;
  const facts = [`${declared} on ${dateText(standing.since)}, ${whole(standing.days)} days ago.`];
  if (standing.taken.length > 0) facts.push(`You took ${citiesText(state, standing.taken)}.`);
  if (standing.lost.length > 0) facts.push(`${enemy} took ${citiesText(state, standing.lost)}.`);
  if (standing.menLost + standing.enemyMenLost > 0) {
    facts.push(
      `In battle you lost ${whole(standing.menLost)} men and ${enemy} ${whole(standing.enemyMenLost)}.`,
    );
  }
  if (standing.besieging.length > 0)
    facts.push(`You besiege ${citiesText(state, standing.besieging)}.`);
  if (standing.besieged.length > 0)
    facts.push(`${enemy} besieges ${citiesText(state, standing.besieged)}.`);
  return facts;
}

export function summaryText(standing: WarStanding): string {
  if (standing.score > 0) return `The war goes your way (+${standing.score})`;
  if (standing.score < 0) return `The war goes against you (${standing.score})`;
  return 'The war stands even (0)';
}

/**
 * Terms ready to offer: peace as things stand, the least the enemy would take when it
 * wants something, and the most it would give when it is the readier for peace.
 */
export function peaceChoices(state: State, enemy: FactionId): PeaceChoice[] {
  const player = state.player;
  const name = factionName(state, enemy);
  const wish = peaceWish(state, enemy, player)?.wish ?? 0;
  const options: { label: string; terms: PeaceTerms | undefined }[] = [
    { label: 'Peace as things stand', terms: AS_THINGS_STAND },
  ];
  if (wish < 0) {
    options.push({
      label: `The least ${name} takes`,
      terms: paymentBetween(state, player, enemy, -wish, Number.POSITIVE_INFINITY, 'least'),
    });
  } else if (wish > 0) {
    options.push({
      label: `The most ${name} gives`,
      terms: paymentBetween(state, enemy, player, 0, wish, 'most'),
    });
  }
  return options.flatMap(({ label, terms }) => {
    const answer = terms && peaceAnswer(state, enemy, player, terms);
    return terms && answer ? [{ label, terms, answer }] : [];
  });
}

/**
 * The cheapest terms the enemy would accept today when they cost the player less than
 * the enemy's own demand, with the saving in words.
 */
export function cheaperCounter(
  state: State,
  enemy: FactionId,
  asked: DeepReadonly<PeaceTerms>,
): (PeaceChoice & { readonly text: string }) | undefined {
  const player = state.player;
  const cost = (terms: DeepReadonly<PeaceTerms>) => -termsPoints(state, terms, player);
  const [cheapest] = peaceChoices(state, enemy)
    .filter((choice) => choice.answer.accepts && cost(choice.terms) < cost(asked))
    .sort((a, b) => cost(a.terms) - cost(b.terms));
  if (!cheapest) return undefined;
  const name = factionName(state, enemy);
  const instead =
    cheapest.terms.kind === 'asThingsStand'
      ? 'peace as things stand'
      : `peace in which ${termsText(state, cheapest.terms, player)}`;
  const lead =
    asked.kind === 'payment' && asked.payer === player
      ? `${name} asks more than it would take.`
      : `${name} would accept terms better for you.`;
  return {
    ...cheapest,
    text: `${lead} By its reckoning today it would accept ${instead}. A counter-offer replaces its demand, and ${name} answers with the next day. ${truceText(state, cheapest.terms)}`,
  };
}

/** The newest offer made to the player after the given day, in a war of the player's only. */
export function newestOfferToPlayer(
  state: State,
  after: number,
): { readonly from: FactionId; readonly madeOn: number } | undefined {
  const player = state.player;
  return Object.entries(state.peaceOffers)
    .filter(
      ([key, offer]) =>
        offer.from !== player && offer.madeOn > after && warSides(key)?.includes(player),
    )
    .map(([, offer]) => ({ from: offer.from, madeOn: offer.madeOn }))
    .sort((a, b) => b.madeOn - a.madeOn || (a.from < b.from ? -1 : 1))[0];
}

/** How long a truce peace on the terms would start, which a payment lengthens. */
export function truceText(state: State, terms: DeepReadonly<PeaceTerms>): string {
  const paid = terms.kind === 'payment' ? -termsPoints(state, terms, terms.payer) : 0;
  const days = truceLength(paid);
  return `This peace starts a truce of ${whole(days)} days, until ${dateText(state.day + days)}.`;
}

/** Every war the player is in and how it stands, what peace is on offer, and the truces that hold. */
export function warRoomOf(state: State, pending: readonly Order[]): WarRoom {
  const player = state.player;
  const wars = Object.keys(state.wars)
    .sort()
    .flatMap((key): WarRow[] => {
      const enemy = otherSide(key, player);
      const standing = enemy && warStanding(state, player, enemy);
      if (!enemy || !standing) return [];
      const name = factionName(state, enemy);
      const offer = standingOffer(state, player, enemy);
      const reply = pending.findLast(
        (order) =>
          (order.kind === 'acceptPeace' || order.kind === 'refusePeace') &&
          order.faction === player &&
          order.from === enemy,
      );
      const queued = pending.findLast(
        (order) => order.kind === 'offerPeace' && order.faction === player && order.to === enemy,
      );
      const ours =
        queued?.kind === 'offerPeace'
          ? `You offer ${name} ${peaceText(state, queued.terms, player)}. ${name} hears it with the next day.`
          : offer?.from === player
            ? `You offered ${name} ${peaceText(state, offer.terms, player)}. ${name} answers with the next day.`
            : undefined;
      return [
        {
          enemy,
          name,
          standing,
          summary: summaryText(standing),
          facts: standingFacts(state, standing),
          theirOffer:
            offer && offer.from === enemy
              ? {
                  terms: copyTerms(offer.terms),
                  text: `${name} offers ${peaceText(state, offer.terms, player)}.`,
                  funds: peaceFundsText(state, offer.terms),
                  change: offer.change,
                  problem: termsProblem(state, [player, enemy], offer.terms),
                  refusing: `Refuse, and the war goes on. ${name} makes no new offer for ${OFFER_GAP_DAYS} days.`,
                  truce: truceText(state, offer.terms),
                  answered:
                    reply?.kind === 'acceptPeace'
                      ? `You accept. Peace comes with the next day.`
                      : reply?.kind === 'refusePeace'
                        ? `You refuse. ${name} hears it with the next day.`
                        : undefined,
                  counter: cheaperCounter(state, enemy, offer.terms),
                }
              : undefined,
          ourOffer: ours,
          choices: peaceChoices(state, enemy),
          volatile:
            standing.besieging.length + standing.besieged.length > 0 ||
            Object.values(state.battles).some((battle) => {
              const a = battle.sides.attackers.factions;
              const b = battle.sides.defenders.factions;
              return (
                (a.includes(player) && b.includes(enemy)) ||
                (b.includes(player) && a.includes(enemy))
              );
            }),
        },
      ];
    })
    .sort((a, b) => a.standing.since - b.standing.since || a.name.localeCompare(b.name));
  const truces = Object.keys(state.truces)
    .sort()
    .flatMap((key): TruceRow[] => {
      const enemy = otherSide(key, player);
      const daysLeft = enemy ? truceDaysLeft(state, player, enemy) : 0;
      if (!enemy || daysLeft === 0) return [];
      const name = factionName(state, enemy);
      return [
        {
          enemy,
          name,
          daysLeft,
          text: `Truce with ${name}: ${whole(daysLeft)} days left. Neither side may declare war before ${dateText(state.day + daysLeft)}.`,
        },
      ];
    });
  return { wars, truces };
}

/** What a declaration of war on the faction sets in motion, a line for each, as the confirmation lists it. */
export function declarationFacts(state: State, against: FactionId): string[] {
  const player = state.player;
  const name = factionName(state, against);
  const facts = [`The war begins with the next day, and ${name} may march on your cities.`];
  const partner = state.factions[against]?.league;
  const ally = partner ? state.factions[partner] : undefined;
  if (
    ally &&
    ally.defeatedOn === null &&
    !truceDaysLeft(state, player, ally.id) &&
    Object.values(state.cities).some((city) => city.owner === ally.id)
  ) {
    facts.push(
      `${ally.name} is leagued with ${name}. It declares war on you too, and marches to lift any siege of ${name}.`,
    );
  }
  const routes = Object.values(state.tradeRoutes).filter(
    (route) =>
      (route.owner === player && route.partner === against) ||
      (route.owner === against && route.partner === player),
  ).length;
  if (routes > 0)
    facts.push(
      `${whole(routes)} trade ${routes === 1 ? 'route' : 'routes'} with ${name} ${routes === 1 ? 'closes' : 'close'}.`,
    );
  facts.push(`${name} will not talk of peace for ${whole(MIN_WAR_DAYS)} days. ${TRUCE_RULE}`);
  return facts;
}

/** How long a peace binds, as the confirmation, the panel at peace, and the guide tell it. */
const TRUCE_RULE = `A peace starts a truce of ${whole(TRUCE_DAYS)} days, and ${whole(TRUCE_DAYS_PER_POINT)} more for each 100 gold, or its worth in cities, that one side pays, up to ${whole(MAX_PAID_TRUCE_DAYS)} more.`;

/** How a war starts and ends, as the wars panel at peace and the guide both tell it. */
export const PEACE_TEXT = {
  start: `A war starts when you declare it from a city's panel, with Declare war on its owner, or when another power declares war on you. A minor city's league partner joins a war on it.`,
  end: `The wars panel then shows how each war stands, the enemy's offers of peace, and terms to send. Either side may offer peace once a war is ${whole(MIN_WAR_DAYS)} days old. ${TRUCE_RULE} Neither side may declare war during it.`,
} as const;
