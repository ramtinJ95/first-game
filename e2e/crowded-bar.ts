import type { FactionId } from '../src/sim/ids.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { carthageNearsWar, declareWar, rome } from './support.ts';

/** Carthage near war, Rome at war with Egypt, an advance at work, and food short: the longest top bar. */
export function crowdedBar(): GameState {
  const state = carthageNearsWar();
  declareWar(state, rome, 'egypt' as FactionId);
  const realm = state.factions[rome];
  if (!realm) throw new Error('no Rome');
  realm.study = { advance: 'marchingRations', daysLeft: 240, paid: 3000 };
  realm.stores.food = -15_400;
  return state;
}
