import { armyOf, cityPoint, startGame } from './support.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { newWar, warKey } from '../src/sim/state/war.ts';
import type { Day } from '../src/sim/state/day.ts';
import { expectConsistent } from '../src/sim/references.ts';
import { fixtureWorld } from '../src/sim/fixture.ts';
import { tick } from '../src/sim/tick.ts';
import { peaceAnswer } from '../src/sim/ai/peace.ts';
import { peaceForecast } from '../src/sim/peace/forecast.ts';
import { AS_THINGS_STAND, GOLD_PER_POINT } from '../src/sim/peace/terms.ts';

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
  if (score !== 0) for (const formation of Object.values(state.formations)) {
    if (state.armies[formation.army]?.owner === (score > 0 ? against : rome)) formation.men = Math.min(formation.men, 100);
  }
  state.wars[warKey(rome, against)] = war;
  expectConsistent(state);
  return state;
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
