import * as v from 'valibot';
import { CityIdSchema, ProvinceIdSchema } from '../ids.ts';

/** A province has no owner of its own: it belongs to whoever owns its city. */
export const ProvinceSchema = v.object({
  id: ProvinceIdSchema,
  name: v.string(),
  city: CityIdSchema,
});

export type Province = v.InferOutput<typeof ProvinceSchema>;
