import type { CityId, FactionId } from '../sim/ids.ts';
import type { TurningPoint } from './turning-points.ts';
import type { Page } from './page.ts';

/** Loading a saved automatic stop must not turn it into a player-owned pause. */
export function restoreModalResume({ saved, hasModal, paused, forcePause }: {
  saved: Pick<Page, 'paused' | 'resumeOnClose'> | undefined;
  hasModal: boolean;
  paused: boolean;
  forcePause: boolean;
}): boolean {
  return hasModal && (saved?.resumeOnClose ?? (!forcePause && !(saved?.paused ?? paused)));
}

/**
 * What covers the game, one at a time. The start screen and the loss replace whatever
 * waits; a win, a fate, and the guide wait their turn in this order. The question
 * whether to leave for the start screen goes in front of them all.
 */
export type Modal =
  | { readonly kind: 'start' }
  | { readonly kind: 'leave' }
  | Extract<TurningPoint, { kind: 'lost' | 'won' | 'fate' | 'peaceOffer' }>
  | { readonly kind: 'guide' };

const RANK: Record<Modal['kind'], number> = {
  start: 0,
  leave: 0,
  lost: 1,
  won: 2,
  fate: 3,
  peaceOffer: 4,
  guide: 5,
};

export function enqueue(queue: readonly Modal[], modal: Modal): Modal[] {
  if (modal.kind === 'start' || modal.kind === 'lost') return [modal];
  if (queue.some((waiting) => same(waiting, modal))) return [...queue];
  const at = queue.findIndex((waiting) => RANK[waiting.kind] > RANK[modal.kind]);
  return at < 0 ? [...queue, modal] : [...queue.slice(0, at), modal, ...queue.slice(at)];
}

function same(a: Modal, b: Modal): boolean {
  if (a.kind === 'fate' && b.kind === 'fate') return a.city === b.city;
  if (a.kind === 'peaceOffer' && b.kind === 'peaceOffer') return a.from === b.from;
  return a.kind === b.kind;
}

/** A fate prompt waits only while its city's fate is open, and an offer of peace while it stands. */
export function keepOpen(
  queue: readonly Modal[],
  open: (city: CityId) => boolean,
  offers: (from: FactionId) => boolean = () => true,
): Modal[] {
  return queue.filter(
    (modal) =>
      (modal.kind !== 'fate' || open(modal.city)) &&
      (modal.kind !== 'peaceOffer' || offers(modal.from)),
  );
}
