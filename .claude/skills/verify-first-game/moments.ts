import {
  armyOf,
  battleAt,
  carthageNearsWar,
  cityPoint,
  fieldBattle,
  nextDay,
  playDays,
  rome,
  startGame,
} from '../../../e2e/support.ts';
import { carthageHeldByLepcis } from '../../../e2e/held-war-game.ts';
import { HINT_SHARE } from '../../../src/app/advance-news.ts';
import { allocateId } from '../../../src/sim/ids.ts';
import type { Day } from '../../../src/sim/state/day.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { limitsOf } from '../../../src/sim/systems/economy.ts';

/** Rome's army one day into a battle with the defenders of `city`, as the stances spec opens it. */
export function battleUnderWay(city = 'mediolanum'): GameState {
  const state = startGame();
  battleAt(state, city);
  return nextDay(state);
}

/** `fieldBattle` one day on, joined outside Roma; loaded fresh, the Punic army marches away. */
export function fieldBattleJoined(): GameState {
  return playDays(fieldBattle(), 1);
}

/**
 * `carthageHeldByLepcis('climbs')`, but the stop of day 87 also named the war with Lepcis Magna
 * and said its end would bring 100%, the most a share can show, so the climb its end brings
 * on day 100 runs the game on.
 */
export function carthageHeldCovered(): string {
  const save = JSON.parse(carthageHeldByLepcis('climbs')) as { page: { told: string[] } };
  save.page.told.push('threat-held:carthage:87:100:lepcis-magna');
  return JSON.stringify(save);
}

/** The First Legion at Roma and a Second Legion of 300 archers beside it, as the join spec sets them. */
export function twoLegionsAtRoma(): GameState {
  const state = startGame();
  const first = armyOf(state, rome);
  const roma = cityPoint('roma');
  first.activity = { kind: 'idle', position: { ...roma } };
  const id = allocateId(state, 'army');
  const formation = allocateId(state, 'formation');
  state.formations[formation] = { id: formation, army: id, troop: 'archers', men: 300, morale: 1 };
  state.armies[id] = {
    ...first,
    id,
    name: 'Second Legion',
    formations: [formation],
    activity: { kind: 'idle', position: { x: roma.x + 4, y: roma.y } },
  };
  return state;
}

function romeOf(state: GameState) {
  const record = state.factions[rome];
  if (!record) throw new Error('no Rome');
  return record;
}

function everyRomanCityBuilds(state: GameState) {
  for (const city of Object.values(state.cities))
    if (city.owner === rome) city.construction = { building: 'temple', daysLeft: 300 };
}

/** Rome has studied Standard coin and finishes Marching rations with the next day, as the advances spec loads it. */
export function advanceDoneTomorrow(): GameState {
  const state = startGame();
  romeOf(state).advances = ['standardCoin'];
  romeOf(state).study = { advance: 'marchingRations', daysLeft: 1, paid: 3000 };
  return state;
}

/** Rome holds 15,000 gold and every Roman city is building, so the Advances panel marks an advance. */
export function advanceMarked(): GameState {
  const state = startGame();
  romeOf(state).stores.gold = 15_000;
  everyRomanCityBuilds(state);
  return state;
}

/** Rome's gold 30 short of the share that tells the Advances hint, and every Roman city building. */
export function advanceHintNear(): GameState {
  const state = startGame();
  const limit = limitsOf(state).get(rome)?.gold ?? 0;
  romeOf(state).stores.gold = HINT_SHARE * limit - 30;
  everyRomanCityBuilds(state);
  return state;
}

/** A new game in which Rome holds `gold`. */
export function romeHolds(gold: number): GameState {
  const state = startGame();
  romeOf(state).stores.gold = gold;
  return state;
}

/**
 * `carthageNearsWar` eight years on, Year 9, day 1, with the truces it sets running a year from
 * then: Rome still holds only the cities it began with, so Carthage needs 12% less and its warning says so.
 */
export function carthageNearsWarLate(): GameState {
  const state = carthageNearsWar();
  state.day = (8 * 365) as Day;
  for (const truce of Object.values(state.truces))
    Object.assign(truce, { since: state.day, endsOn: (state.day + 365) as Day });
  return state;
}
