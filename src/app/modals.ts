import type { CityId } from '../sim/ids.ts';
import type { TurningPoint } from './turning-points.ts';

/**
 * What covers the game, one at a time. The start screen and the loss replace whatever
 * waits; a win, a fate, and the guide wait their turn in this order. The question
 * whether to leave for the start screen goes in front of them all.
 */
export type Modal =
  | { readonly kind: 'start' }
  | { readonly kind: 'leave' }
  | Extract<TurningPoint, { kind: 'lost' | 'won' | 'fate' }>
  | { readonly kind: 'guide' };

const RANK: Record<Modal['kind'], number> = {
  start: 0,
  leave: 0,
  lost: 1,
  won: 2,
  fate: 3,
  guide: 4,
};

export function enqueue(queue: readonly Modal[], modal: Modal): Modal[] {
  if (modal.kind === 'start' || modal.kind === 'lost') return [modal];
  if (queue.some((waiting) => same(waiting, modal))) return [...queue];
  const at = queue.findIndex((waiting) => RANK[waiting.kind] > RANK[modal.kind]);
  return at < 0 ? [...queue, modal] : [...queue.slice(0, at), modal, ...queue.slice(at)];
}

function same(a: Modal, b: Modal): boolean {
  if (a.kind === 'fate' && b.kind === 'fate') return a.city === b.city;
  return a.kind === b.kind;
}

/** A fate prompt waits only while its city's fate is open. */
export function keepOpen(queue: readonly Modal[], open: (city: CityId) => boolean): Modal[] {
  return queue.filter((modal) => modal.kind !== 'fate' || open(modal.city));
}
