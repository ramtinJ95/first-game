import { nameNewArmy } from './army-names.ts';
import { buildFixture, FIXTURE, fixtureWorld } from './fixture.ts';
import { allocateId, type ArmyId, type FactionId } from './ids.ts';
import type { Stance } from './state/army.ts';
import type { GameState } from './state/game-state.ts';
import type { MapPoint } from './state/map-point.ts';
import { warKey } from './state/war.ts';
import { tick } from './tick.ts';
import type { Troop } from './troops.ts';

export interface ArmySpec {
  troops: Partial<Record<Troop, number>>;
  stance?: Stance;
  generalSkill?: number;
}

/** Army `a` belongs to Rome and army `b` to Carthage. They meet beside Roma, at war. */
export interface Matchup {
  name: string;
  a: ArmySpec;
  b: ArmySpec;
}

export interface FormationDay {
  army: 'a' | 'b';
  troop: Troop;
  men: number;
  morale: number;
}

export interface TrialResult {
  winner: 'a' | 'b' | 'none';
  days: number;
  /** The share of its men each side still has when the battle ends. */
  kept: { a: number; b: number };
  /** Each formation at the end of each day of battle. */
  log: FormationDay[][];
  state: GameState;
}

export const TRIAL_ARMIES = { a: 'army-trial-a' as ArmyId, b: 'army-trial-b' as ArmyId };

export function buildTrial(matchup: Matchup, seed: number): GameState {
  const state = buildFixture(seed);
  state.armies = {};
  state.formations = {};
  state.wars = { [warKey(FIXTURE.rome, FIXTURE.carthage)]: { since: state.day } };
  addArmy(state, TRIAL_ARMIES.a, FIXTURE.rome, matchup.a, { x: 2511.3, y: 2350.8 });
  addArmy(state, TRIAL_ARMIES.b, FIXTURE.carthage, matchup.b, { x: 2521.3, y: 2350.8 });
  return state;
}

function addArmy(
  state: GameState,
  id: ArmyId,
  owner: FactionId,
  spec: ArmySpec,
  position: MapPoint,
) {
  const formations = Object.entries(spec.troops).map(([troop, men]) => {
    const formation = allocateId(state, 'formation');
    state.formations[formation] = {
      id: formation,
      army: id,
      troop: troop as Troop,
      men,
      morale: 1,
    };
    return formation;
  });
  state.armies[id] = {
    id,
    owner,
    name: nameNewArmy(state, owner),
    formations,
    stance: spec.stance ?? 'holdTheLine',
    generalSkill: spec.generalSkill ?? 3,
    activity: { kind: 'idle', position },
  };
}

/** Plays the matchup through the real tick until its battle ends. */
export function playTrial(matchup: Matchup, seed: number, maxDays = 200): TrialResult {
  const world = fixtureWorld();
  let state = buildTrial(matchup, seed);
  const men = (s: GameState, id: ArmyId) =>
    (s.armies[id]?.formations ?? []).reduce((sum, f) => sum + (s.formations[f]?.men ?? 0), 0);
  const start = { a: men(state, TRIAL_ARMIES.a), b: men(state, TRIAL_ARMIES.b) };
  const log: FormationDay[][] = [];
  do {
    state = tick(state, [], world).state;
    log.push(
      (['a', 'b'] as const).flatMap((side) =>
        (state.armies[TRIAL_ARMIES[side]]?.formations ?? []).flatMap((id) => {
          const f = state.formations[id];
          return f ? [{ army: side, troop: f.troop, men: f.men, morale: f.morale }] : [];
        }),
      ),
    );
  } while (Object.keys(state.battles).length > 0 && log.length < maxDays);

  const won = (id: ArmyId) => state.armies[id]?.activity.kind === 'idle';
  return {
    winner: won(TRIAL_ARMIES.a) ? 'a' : won(TRIAL_ARMIES.b) ? 'b' : 'none',
    days: log.length,
    kept: { a: men(state, TRIAL_ARMIES.a) / start.a, b: men(state, TRIAL_ARMIES.b) / start.b },
    log,
    state,
  };
}
