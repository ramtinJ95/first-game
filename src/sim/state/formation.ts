import * as v from 'valibot';
import { ArmyIdSchema, FormationIdSchema } from '../ids.ts';

/** One body of one troop type inside an army. */
export const FormationSchema = v.object({
  id: FormationIdSchema,
  army: ArmyIdSchema,
  troop: v.string(),
  men: v.pipe(v.number(), v.integer(), v.minValue(0)),
  /** 0 is broken, 1 is fresh. */
  morale: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
});

export type Formation = v.InferOutput<typeof FormationSchema>;
