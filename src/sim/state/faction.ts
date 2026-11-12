import * as v from 'valibot';
import { FactionIdSchema } from '../ids.ts';

export const FactionSchema = v.object({
  id: FactionIdSchema,
  name: v.string(),
});

export type Faction = v.InferOutput<typeof FactionSchema>;
