import * as v from 'valibot';
import {
  ArmyIdSchema,
  BattleIdSchema,
  ConvoyIdSchema,
  FactionIdSchema,
  FormationIdSchema,
  SiegeIdSchema,
} from '../ids.ts';
import { DaySchema } from './day.ts';
import { MapPointSchema } from './map-point.ts';

export const STANCES = ['holdTheLine', 'allOutAssault', 'skirmishAndWithdraw'] as const;
export const StanceSchema = v.picklist(STANCES);
export type Stance = v.InferOutput<typeof StanceSchema>;

/**
 * What an army is doing. Each activity is its own variant, so an army cannot be
 * marching and fighting at once. An embarked army has no position: its convoy has one.
 * A retreating army walks its path like a marching one, but no battle takes it and no
 * order turns it until it arrives.
 */
export const ArmyActivitySchema = v.variant('kind', [
  v.object({ kind: v.literal('idle'), position: MapPointSchema }),
  v.object({
    kind: v.literal('marching'),
    position: MapPointSchema,
    /** The points still ahead on the path, in order. The last one is the destination. */
    waypoints: v.pipe(v.array(MapPointSchema), v.nonEmpty()),
  }),
  v.object({
    kind: v.literal('retreating'),
    position: MapPointSchema,
    waypoints: v.pipe(v.array(MapPointSchema), v.nonEmpty()),
  }),
  v.object({
    kind: v.literal('inBattle'),
    position: MapPointSchema,
    battle: BattleIdSchema,
    /** The rest of the march the army was on when the battle took it, empty for none. */
    march: v.array(MapPointSchema),
  }),
  v.object({ kind: v.literal('besieging'), position: MapPointSchema, siege: SiegeIdSchema }),
  v.object({
    kind: v.literal('embarked'),
    convoy: ConvoyIdSchema,
    /** The land path the army marches on from its landing. Without one it stands where it lands. */
    march: v.optional(v.pipe(v.array(MapPointSchema), v.nonEmpty())),
  }),
]);
export type ArmyActivity = v.InferOutput<typeof ArmyActivitySchema>;

export const ArmySchema = v.object({
  id: ArmyIdSchema,
  owner: FactionIdSchema,
  formations: v.array(FormationIdSchema),
  stance: StanceSchema,
  /** The general's skill, from 0 for none to 10 for the best. */
  generalSkill: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10)),
  activity: ArmyActivitySchema,
  /**
   * The day the army last changed its stance, absent if it never did. It re-forms for
   * `REFORM_DAYS` after. It comes last, where a change adds it, so a save keeps its order.
   */
  stanceChangedOn: v.optional(DaySchema),
});

export type Army = v.InferOutput<typeof ArmySchema>;
