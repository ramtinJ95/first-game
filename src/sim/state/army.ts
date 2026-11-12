import * as v from 'valibot';
import {
  ArmyIdSchema,
  BattleIdSchema,
  ConvoyIdSchema,
  FactionIdSchema,
  FormationIdSchema,
  SiegeIdSchema,
} from '../ids.ts';
import { MapPointSchema } from './map-point.ts';

export const STANCES = ['holdTheLine', 'allOutAssault', 'skirmishAndWithdraw'] as const;
export const StanceSchema = v.picklist(STANCES);
export type Stance = v.InferOutput<typeof StanceSchema>;

/**
 * What an army is doing. Each activity is its own variant, so an army cannot be
 * marching and fighting at once. An embarked army has no position: its convoy has one.
 */
export const ArmyActivitySchema = v.variant('kind', [
  v.object({ kind: v.literal('idle'), position: MapPointSchema }),
  v.object({ kind: v.literal('marching'), position: MapPointSchema, destination: MapPointSchema }),
  v.object({ kind: v.literal('inBattle'), position: MapPointSchema, battle: BattleIdSchema }),
  v.object({ kind: v.literal('besieging'), position: MapPointSchema, siege: SiegeIdSchema }),
  v.object({ kind: v.literal('embarked'), convoy: ConvoyIdSchema }),
]);
export type ArmyActivity = v.InferOutput<typeof ArmyActivitySchema>;

export const ArmySchema = v.object({
  id: ArmyIdSchema,
  owner: FactionIdSchema,
  formations: v.array(FormationIdSchema),
  stance: StanceSchema,
  activity: ArmyActivitySchema,
});

export type Army = v.InferOutput<typeof ArmySchema>;
