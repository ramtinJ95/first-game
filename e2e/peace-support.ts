import { armyOf, cityPoint, playDays, startGame, withFormations } from './support.ts';
import type { CityId, FactionId } from '../src/sim/ids.ts';
import { newWar, warKey } from '../src/sim/state/war.ts';
import type { Day } from '../src/sim/state/day.ts';
import { expectConsistent } from '../src/sim/references.ts';
import { fixtureWorld } from '../src/sim/fixture.ts';
import { tick } from '../src/sim/tick.ts';
import { peaceAnswer } from '../src/sim/ai/peace.ts';
import { peaceForecast } from '../src/sim/peace/forecast.ts';
import { AS_THINGS_STAND, GOLD_PER_POINT } from '../src/sim/peace/terms.ts';
import { executeOrder, type Order } from '../src/sim/orders/orders.ts';
import { changeCityOwner } from '../src/sim/cities.ts';
import { advanceDay } from '../src/sim/systems/advance-day.ts';
import { saveGame } from '../src/sim/save.ts';
import { alertsOfDay } from '../src/app/alerts.ts';

/** Real offer/refusal orders and an intervening conquest, staged for readable amounts. */
export function risingPeacePrice(price = 5100) {
  const state = startGame();
  const carthage = 'carthage' as FactionId;
  const treasury = state.factions[state.player];
  if (!treasury) throw new Error('no player');
  treasury.stores.gold = 4500;
  state.day = 700 as Day;
  state.wars[warKey(state.player, carthage)] = newWar(carthage, state.player, 386 as Day);
  const offer = (gold: number): Order => ({
    kind: 'offerPeace',
    faction: carthage,
    to: state.player,
    terms: { kind: 'payment', payer: state.player, gold, cities: [] },
  });
  const world = fixtureWorld();
  for (const order of [
    offer(4500),
    { kind: 'refusePeace', faction: state.player, from: carthage } as const,
  ]) {
    const rejected = executeOrder(state, order, world);
    if (rejected) throw new Error(rejected.reason);
  }
  state.day = 790 as Day;
  treasury.stores.gold = 8940;
  changeCityOwner(state, 'capua' as CityId, carthage);
  const result = tick(state, [offer(price)], world, [advanceDay]);
  if (result.rejected.length) throw new Error('the staged price must be affordable when sent');
  const news = alertsOfDay(state, result.state, result.events);
  expectConsistent(result.state);
  return {
    state: result.state,
    news,
    save: saveGame(result.state, {
      paused: true,
      chronicle: news,
      occupied: [],
      told: [],
      weakSieges: [],
    }),
  };
}

/** The reviewer's seed-30 casualty record: the stronger winner also fights Egypt. */
export function winningSecondFront() {
  const state = startGame();
  const carthage = 'carthage' as FactionId;
  const egypt = 'egypt' as FactionId;
  const roman = withFormations(state, armyOf(state, state.player), [['spearmen', 1349]]);
  const punic = withFormations(state, armyOf(state, carthage), [['spearmen', 2928]]);
  roman.activity = { kind: 'idle', position: cityPoint('roma') };
  punic.activity = { kind: 'idle', position: cityPoint('carthago') };
  state.day = 62 as Day;
  const war = newWar(carthage, state.player, 1 as Day);
  const own = war.sides[state.player];
  const enemy = war.sides[carthage];
  if (!own || !enemy) throw new Error('no sides');
  own.lost = 151;
  enemy.lost = 72;
  state.wars[warKey(state.player, carthage)] = war;
  state.wars[warKey(carthage, egypt)] = newWar(carthage, egypt, 1 as Day);
  expectConsistent(state);
  return state;
}

/** Controlled war records, with no hidden armies or scripted diplomatic answers. */
export function peaceStanding(enemy: 'mediolanum' | 'macedon', score: -2 | 0 | 2) {
  const state = startGame();
  const rome = state.player;
  const against = enemy as FactionId;
  state.day = (score === 0 ? 226 : 65) as Day;
  const war = newWar(rome, against, 1 as Day);
  const loser = war.sides[score > 0 ? against : rome];
  if (!loser) throw new Error('missing war side');
  loser.lost = Math.round((Math.abs(score) * 2000) / 30);
  // These captures show a real defeat, rather than a token clash against a full realm.
  if (score !== 0)
    for (const formation of Object.values(state.formations)) {
      if (state.armies[formation.army]?.owner === (score > 0 ? against : rome))
        formation.men = Math.min(formation.men, 100);
    }
  state.wars[warKey(rome, against)] = war;
  expectConsistent(state);
  return state;
}

/** The outside review's exposed-city attack, with twice the strength still elsewhere. */
export function siegeWithoutDefeat() {
  const state = startGame();
  const macedon = 'macedon' as FactionId;
  const roman = withFormations(state, armyOf(state, state.player), [['spearmen', 1500]]);
  const enemy = withFormations(state, armyOf(state, macedon), [['spearmen', 3000]]);
  enemy.activity = { kind: 'idle', position: cityPoint('pella') };
  roman.activity = { kind: 'idle', position: cityPoint('amphipolis') };
  state.wars[warKey(state.player, macedon)] = newWar(state.player, macedon, 1 as Day);
  state.day = 66 as Day;
  const after = playDays(state, 3);
  expectConsistent(after);
  return after;
}

/** The displayed price is paid in full, but the battle fought that day raises it. */
export function stalePeaceForecast() {
  const world = fixtureWorld();
  let state = startGame();
  const rome = state.player;
  const macedon = 'macedon' as FactionId;
  state.day = 121 as Day;
  state.wars[warKey(rome, macedon)] = newWar(rome, macedon, 1 as Day);
  const roman = armyOf(state, rome);
  const enemy = armyOf(state, macedon);
  roman.activity = { kind: 'idle', position: cityPoint('ariminum') };
  enemy.activity = { kind: 'idle', position: cityPoint('ariminum') };
  for (const id of roman.formations) {
    const formation = state.formations[id];
    if (formation) formation.men = Math.min(formation.men, 200);
  }
  const treasury = state.factions[rome];
  if (!treasury) throw new Error('no Rome');
  treasury.stores.gold = 10000;
  state = tick(state, [], world).state;
  const answer = peaceAnswer(state, macedon, rome, AS_THINGS_STAND);
  if (!answer) throw new Error('no peace reckoning');
  const terms = {
    kind: 'payment',
    payer: rome,
    gold: answer.short * GOLD_PER_POINT,
    cities: [],
  } as const;
  const forecast = peaceForecast(state, macedon, rome, terms);
  if (!forecast?.accepts) throw new Error('the initial price must be acceptable');
  state = tick(
    state,
    [{ kind: 'offerPeace', faction: rome, to: macedon, terms: { ...terms, cities: [] }, forecast }],
    world,
  ).state;
  if (peaceAnswer(state, macedon, rome, terms)?.accepts)
    throw new Error('the battle must change the answer');
  expectConsistent(state);
  return state;
}
