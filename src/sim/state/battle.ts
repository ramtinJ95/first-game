import * as v from 'valibot';
import { ArmyIdSchema, BattleIdSchema, FactionIdSchema } from '../ids.ts';
import { DaySchema } from './day.ts';
import { MapPointSchema } from './map-point.ts';

/** Every faction that has fought on a side of the battle, and the men that side has lost. */
export const BattleSideSchema = v.object({
  factions: v.array(FactionIdSchema),
  lost: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export const BattleSchema = v.object({
  id: BattleIdSchema,
  position: MapPointSchema,
  attackers: v.array(ArmyIdSchema),
  defenders: v.array(ArmyIdSchema),
  startedOn: DaySchema,
  sides: v.object({ attackers: BattleSideSchema, defenders: BattleSideSchema }),
});

export type Battle = v.InferOutput<typeof BattleSchema>;
