import type { AdvanceKind } from './advances/advances.ts';
import type { BuildingKind } from './buildings/buildings.ts';
import type { ArmyId, BattleId, CityId, FactionId, TradeRouteId } from './ids.ts';
import type { Day } from './state/day.ts';
import type { GameState } from './state/game-state.ts';
import type { MapPoint } from './state/map-point.ts';
import type { Order } from './orders/orders.ts';
import type { PeaceTerms } from './state/peace.ts';

interface TradeEvent {
  route: TradeRouteId;
  from: CityId;
  to: CityId;
  owners: readonly [FactionId, FactionId];
  position: MapPoint;
}

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
  | (TradeEvent & { kind: 'tradeOpened' | 'tradeOffered' })
  | (TradeEvent & {
      kind: 'tradeClosed';
      cause: string;
      /** The route was an invitation still waiting for consent, so it never ran. */
      invitation: boolean;
    })
  | (TradeEvent & { kind: 'tradeRaided'; cause: 'siege' })
  | (TradeEvent & {
      kind: 'tradeRaided';
      cause: 'raid';
      raider: FactionId;
      /** The raider's gold: one shipment, or nothing when no fresh cargo was on the road. */
      looted: number;
    })
  | {
      kind: 'battleBegan';
      battle: BattleId;
      position: MapPoint;
      attackers: readonly FactionId[];
      defenders: readonly FactionId[];
      /** Men at contact, before losses, including a battle over within this day. */
      forces: readonly { army: ArmyId; faction: FactionId; men: number }[];
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
  | {
      kind: 'sailingRefused';
      army: ArmyId;
      owner: FactionId;
      /** Where the march ended and the army now stands. */
      position: MapPoint;
      /** The port the army was to sail for. */
      to: CityId;
      reason: string;
    }
  | { kind: 'warDeclared'; by: FactionId; against: FactionId }
  | { kind: 'advanceFinished'; faction: FactionId; advance: AdvanceKind }
  | {
      kind: 'orderUnpaid';
      faction: FactionId;
      /** The order refused only for want of gold: with the gold it would have been carried out. */
      order: Order;
      cost: number;
      /** The faction's gold when the order came to be paid. */
      held: number;
      /** The faction's orders that spent gold earlier the same day, in the order paid. */
      paidBefore: readonly Order[];
    }
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
    }
  | { kind: 'peaceOffered'; from: FactionId; to: FactionId; terms: PeaceTerms; change?: string }
  | { kind: 'peaceRefused'; by: FactionId; from: FactionId; terms: PeaceTerms; reason: string }
  | { kind: 'peaceOfferEnded'; from: FactionId; to: FactionId; reason: string }
  | { kind: 'peaceMade'; between: readonly [FactionId, FactionId]; terms: PeaceTerms };

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
