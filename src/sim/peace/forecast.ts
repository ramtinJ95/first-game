import { peaceAnswer, termsText, warDamage } from '../ai/peace.ts';
import { SMALL_LOSS_SHARE } from '../ai/thresholds.ts';
import type { DeepReadonly } from '../deep-readonly.ts';
import type { FactionId } from '../ids.ts';
import type { GameState } from '../state/game-state.ts';
import type { PeaceForecast, PeaceOffer, PeaceTerms } from '../state/peace.ts';
import { warStanding } from './standing.ts';
import { termsPoints } from './terms.ts';

type State = DeepReadonly<GameState>;

/** Keep the displayed forecast, not a promise: the next day's facts decide the answer. */
export function peaceForecast(
  state: State,
  faction: FactionId,
  enemy: FactionId,
  terms: DeepReadonly<PeaceTerms>,
): PeaceForecast | undefined {
  const answer = peaceAnswer(state, faction, enemy, terms);
  const standing = warStanding(state, faction, enemy);
  if (!answer || !standing) return undefined;
  const damage = warDamage(state, standing);
  return {
    accepts: answer.accepts,
    verdict: answer.verdict,
    score: standing.score,
    menLost: standing.menLost,
    enemyMenLost: standing.enemyMenLost,
    ownLossShare: damage.ownShare,
    enemyLossShare: damage.enemyShare,
    taken: [...standing.taken],
    lost: [...standing.lost],
    besieging: [...standing.besieging],
    besieged: [...standing.besieged],
    factors: answer.wish.factors.map((factor) => ({ ...factor })),
  };
}

/** Name only measured changes, without pretending a battle ended when it is still going. */
export function forecastChanges(
  before: DeepReadonly<PeaceForecast>,
  after: PeaceForecast,
  state: State,
  unchanged = 'the available terms or the day of talks changed',
): string {
  const changes: string[] = [];
  const names = (ids: readonly string[]) =>
    ids.map((id) => state.cities[id as keyof typeof state.cities]?.name ?? id).join(', ');
  const taken = after.taken.filter((id) => !before.taken.includes(id));
  const lost = after.lost.filter((id) => !before.lost.includes(id));
  if (taken.length) changes.push(`it took ${names(taken)}`);
  if (lost.length) changes.push(`it lost ${names(lost)}`);
  if (before.menLost === after.menLost && before.ownLossShare !== after.ownLossShare) {
    changes.push(
      `its surviving forces changed; its recorded losses ${after.ownLossShare > SMALL_LOSS_SHARE ? 'now exceed' : 'no longer exceed'} ${SMALL_LOSS_SHARE * 100}% of its forces`,
    );
  }
  if (
    before.enemyMenLost === after.enemyMenLost &&
    before.enemyLossShare !== after.enemyLossShare
  ) {
    changes.push(`your surviving forces changed the share lost in this war`);
  }
  if (before.menLost !== after.menLost || before.enemyMenLost !== after.enemyMenLost) {
    changes.push(
      `battle losses changed (it lost ${after.menLost - before.menLost} more men; you lost ${after.enemyMenLost - before.enemyMenLost} more)`,
    );
  }
  if (
    JSON.stringify([before.besieging, before.besieged]) !==
    JSON.stringify([after.besieging, after.besieged])
  )
    changes.push('the sieges changed');
  if (before.score !== after.score)
    changes.push(`its war standing changed from ${before.score} to ${after.score}`);
  for (const factor of after.factors) {
    if (['standing', 'restraint'].includes(factor.kind)) continue;
    if (before.factors.find((old) => old.kind === factor.kind)?.points !== factor.points)
      changes.push(factor.text);
  }
  for (const factor of before.factors) {
    if (
      !after.factors.some((current) => current.kind === factor.kind) &&
      ['shortage', 'otherWars'].includes(factor.kind)
    )
      changes.push(`no longer: ${factor.text}`);
  }
  return changes.length ? changes.join('; ') : unchanged;
}

/** Compare this sender's own last offer, not the other side's counter-offer. */
export function offerPriceRise(
  state: State,
  previous: DeepReadonly<PeaceOffer> | null,
  current: PeaceOffer,
  receiver: FactionId,
): string | undefined {
  if (
    !previous ||
    current.terms.kind !== 'payment' ||
    current.terms.payer !== receiver ||
    termsPoints(state, current.terms, current.from) <=
      termsPoints(state, previous.terms, current.from)
  )
    return undefined;
  const reasons: string[] = [];
  if (
    previous.receiverGold !== undefined &&
    current.receiverGold !== undefined &&
    previous.receiverGold !== current.receiverGold
  ) {
    reasons.push(
      `Your treasury ${current.receiverGold > previous.receiverGold ? 'rose' : 'fell'} from ${previous.receiverGold.toLocaleString('en')} to ${current.receiverGold.toLocaleString('en')} gold.`,
    );
    if (
      previous.terms.kind === 'payment' &&
      previous.terms.payer === receiver &&
      previous.terms.gold > 0 &&
      previous.terms.gold === previous.receiverGold
    )
      reasons.push('The previous gold demand reached all the gold you held.');
  }
  if (previous.ownForecast && current.ownForecast) {
    const changed = forecastChanges(previous.ownForecast, current.ownForecast, state, '');
    if (changed) reasons.push(`Changes since the last offer: ${changed}.`);
  }
  if (previous.forecast && current.forecast) {
    for (const kind of ['otherWars', 'shortage']) {
      const before = previous.forecast.factors.find((factor) => factor.kind === kind);
      const after = current.forecast.factors.find((factor) => factor.kind === kind);
      if (before?.points !== after?.points)
        reasons.push(after ? `${after.text}.` : `No longer: ${before?.text}.`);
    }
  }
  return `The price rose: last time ${termsText(state, previous.terms, receiver)}; now ${termsText(state, current.terms, receiver)}. ${reasons.length ? reasons.join(' ') : 'No change in the recorded war facts explains this higher demand.'}`;
}
