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

/** The land caravan nine km from the sea and the ship at Carthago's harbour mouth. */
export function coastalRome(): GameState {
  const state = tradingRome();
  tradeRoute(state, 'land').progress = 0.733;
  tradeRoute(state, 'sea').progress = 0.99;
  return state;
}

/** A home sea route round Italy whose ship is in the Strait of Messina. */
export function straitRome(): GameState {
  const state = startGame();
  const rome = state.factions[state.player];
  if (!rome) throw new Error('Rome is missing');
  rome.stores.gold = 7000;
  const played = playDays(state, 6, [
    {
      kind: 'openTrade',
      faction: state.player,
      from: 'roma' as CityId,
      to: 'ariminum' as CityId,
      mode: 'sea',
    },
  ]);
  tradeRoute(played, 'sea').progress = 0.335;
  return played;
}

/**
 * Rome on day 2 of a new game, having opened its three routes from Roma on day 1: the
 * road to Mogontiacum over the Alps and the lanes to Carthago and Massalia. A new game's
 * 1,500 gold pays for one opening, so the treasury holds enough for three.
 */
export function romaTradesThreeWays(): GameState {
  const state = startGame();
  const rome = state.factions[state.player];
  if (!rome) throw new Error('Rome is missing');
  rome.stores.gold = 7000;
  const open = (to: string, mode: TradeMode) => ({
    kind: 'openTrade' as const,
    faction: state.player,
    from: 'roma' as CityId,
    to: to as CityId,
    mode,
  });
  return playDays(state, 1, [
    open('mogontiacum', 'land'),
    open('carthago', 'sea'),
    open('massalia', 'sea'),
  ]);
}
