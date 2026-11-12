import * as v from 'valibot';
import { ArmyIdSchema, CityIdSchema, SiegeIdSchema } from '../ids.ts';
import { DaySchema } from './day.ts';

export const SiegeSchema = v.object({
  id: SiegeIdSchema,
  city: CityIdSchema,
  besiegers: v.array(ArmyIdSchema),
  startedOn: DaySchema,
});

export type Siege = v.InferOutput<typeof SiegeSchema>;
