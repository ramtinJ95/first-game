import * as v from 'valibot';
import { CityIdSchema, FactionIdSchema, RefugeeColumnIdSchema } from '../ids.ts';
import { MapPointSchema } from './map-point.ts';

/** People who left a city and walk to another one. */
export const RefugeeColumnSchema = v.object({
  id: RefugeeColumnIdSchema,
  owner: FactionIdSchema,
  people: v.pipe(v.number(), v.integer(), v.minValue(0)),
  from: CityIdSchema,
  to: CityIdSchema,
  position: MapPointSchema,
});

export type RefugeeColumn = v.InferOutput<typeof RefugeeColumnSchema>;
