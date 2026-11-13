import type { BuildingKind } from './buildings/buildings.ts';
import type { ArmyId, BattleId, CityId, FactionId } from './ids.ts';
import type { Day } from './state/day.ts';
import type { GameState } from './state/game-state.ts';
import type { MapPoint } from './state/map-point.ts';

export type BattleSideName = 'attackers' | 'defenders';

export interface BattleSideOutcome {
  factions: readonly FactionId[];
  lost: number;
}

/** How an army left the game. */
export type ArmyLoss = 'battle' | 'surrender' | 'storm' | 'sally' | 'defeat';

/**
 * Something that happened during one day. A tick returns the day's events in the order
 * they happened, so news of a thing that began and ended inside the day still reaches
 * the page. An event carries what a reader needs, because the records it names may be
 * gone by the end of the day.
 */
export type DayEvent =
  | {
      kind: 'battleBegan';
      battle: BattleId;
      position: MapPoint;
      attackers: readonly FactionId[];
      defenders: readonly FactionId[];
    }
  | {
      kind: 'battleEnded';
      battle: BattleId;
      position: MapPoint;
      startedOn: Day;
      /** The days fought, counting the first and the last. */
      days: number;
      /** The side left on the field, or none when both sides broke on the same day. */
      winner: BattleSideName | 'none';
      /** The winner's armies, which hold the field. */
      standing: readonly ArmyId[];
      attackers: BattleSideOutcome;
      defenders: BattleSideOutcome;
    }
  | {
      kind: 'armyRetreated';
      army: ArmyId;
      owner: FactionId;
      from: MapPoint;
      to: MapPoint;
      /** True when the army was ordered out, false when it broke. */
      ordered: boolean;
      /** Men lost to the pursuit as it broke off. */
      lost: number;
      men: number;
    }
  | {
      kind: 'armyDestroyed';
      army: ArmyId;
      owner: FactionId;
      position: MapPoint;
      cause: ArmyLoss;
      /** The men the army still had when it left the game. */
      men: number;
    }
  | { kind: 'armyDeserted'; army: ArmyId; owner: FactionId; position: MapPoint; men: number }
  | { kind: 'warDeclared'; by: FactionId; against: FactionId }
  | {
      kind: 'buildingFinished';
      city: CityId;
      owner: FactionId;
      building: BuildingKind;
      position: MapPoint;
    }
  | {
      kind: 'buildingsLost';
      city: CityId;
      /** The faction that held the buildings: the sacker, or the owner the city fell from. */
      owner: FactionId;
      /** The buildings destroyed, and the one at work, which is lost with its gold. */
      buildings: readonly BuildingKind[];
      cause: 'sack' | 'siege';
      position: MapPoint;
    };

const sinks = new WeakMap<GameState, DayEvent[]>();

/**
 * Runs one day's changes to the state and returns the events they emitted. The list is
 * kept beside the state, never in it, so the news of a day is not saved with the game.
 */
export function recordEvents(state: GameState, run: () => void): DayEvent[] {
  const events: DayEvent[] = [];
  sinks.set(state, events);
  try {
    run();
  } finally {
    sinks.delete(state);
  }
  return events;
}

/** Adds an event to the day being recorded on this state. Outside a recorded day it is dropped. */
export function emit(state: GameState, event: DayEvent): void {
  sinks.get(state)?.push(event);
}
