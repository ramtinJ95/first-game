import type { CityId, FactionId } from '../src/sim/ids.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { routePoint, type TradeMode } from '../src/sim/trade/routes.ts';
import { armyOf, declareWar, playDays, startGame } from './support.ts';

export function tradeRoute(game: GameState, mode: TradeMode) {
  const route = Object.values(game.tradeRoutes).find((r) => r.mode === mode);
  if (!route) throw new Error(`expected a ${mode} trade route`);
  return route;
}

export function tradingRome(): GameState {
  const state = startGame();
  const rome = state.factions[state.player];
  if (!rome) throw new Error('Rome is missing');
  rome.stores.gold = 7000;
  return playDays(state, 6, [
    {
      kind: 'openTrade',
      faction: state.player,
      from: 'roma' as CityId,
      to: 'capua' as CityId,
      mode: 'land',
    },
    {
      kind: 'openTrade',
      faction: state.player,
      from: 'roma' as CityId,
      to: 'carthago' as CityId,
      mode: 'sea',
    },
  ]);
}

export function raidedRome(): GameState {
  const state = tradingRome();
  const carthage = 'carthage' as FactionId;
  armyOf(state, carthage).activity = {
    kind: 'idle',
    position: routePoint(tradeRoute(state, 'land'), 0.55),
  };
  declareWar(state, state.player, carthage);
  return playDays(state, 1);
}
