import * as v from 'valibot';
import { ArmyIdSchema, BattleIdSchema } from '../ids.ts';
import { DaySchema } from './day.ts';
import { MapPointSchema } from './map-point.ts';

export const BattleSchema = v.object({
  id: BattleIdSchema,
  position: MapPointSchema,
  attackers: v.array(ArmyIdSchema),
  defenders: v.array(ArmyIdSchema),
  startedOn: DaySchema,
});

export type Battle = v.InferOutput<typeof BattleSchema>;
