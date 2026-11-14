import { dateText, factionName, peaceFundsText, reasonText, whole } from '../app/names.ts';
import {
  paymentBetween,
  peaceAnswer,
  peaceWish,
  peaceText,
  type PeaceAnswer,
} from '../sim/ai/peace.ts';
import { OFFER_GAP_DAYS } from '../sim/ai/thresholds.ts';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import type { Order } from '../sim/orders/orders.ts';
import { standingOffer } from '../sim/peace/offer.ts';
import { warStanding, type WarStanding } from '../sim/peace/standing.ts';
import { AS_THINGS_STAND, copyTerms, termsProblem } from '../sim/peace/terms.ts';
import { truceDaysLeft } from '../sim/peace/truce.ts';
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
