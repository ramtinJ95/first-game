import type { DeepReadonly } from '../sim/deep-readonly.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import type { Order } from '../sim/orders/orders.ts';
import { standingOffer } from '../sim/peace/offer.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { warSides } from '../sim/state/war.ts';
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

/** The first enemy whose offer of peace stands for the player with no answer yet queued. */
export function unansweredOffer(
  state: DeepReadonly<GameState>,
  pending: readonly Order[],
): FactionId | undefined {
  const player = state.player;
  return Object.keys(state.peaceOffers)
    .sort()
    .flatMap((key) => {
      const sides = warSides(key);
      if (!sides?.includes(player)) return [];
      const enemy = sides[0] === player ? sides[1] : sides[0];
      if (standingOffer(state, player, enemy)?.from !== enemy) return [];
      const answered = pending.some(
        (order) =>
          (order.kind === 'acceptPeace' ||
            order.kind === 'refusePeace' ||
            order.kind === 'offerPeace') &&
          order.faction === player &&
          (order.kind === 'offerPeace' ? order.to : order.from) === enemy,
      );
      return answered ? [] : [enemy];
    })[0];
}
