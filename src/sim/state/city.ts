import * as v from 'valibot';
import { CityIdSchema, FactionIdSchema, ProvinceIdSchema } from '../ids.ts';
import { MapPointSchema } from './map-point.ts';

export const CitySchema = v.object({
  id: CityIdSchema,
  name: v.string(),
  province: ProvinceIdSchema,
  owner: FactionIdSchema,
  position: MapPointSchema,
  population: v.pipe(v.number(), v.integer(), v.minValue(0)),
});

export type City = v.InferOutput<typeof CitySchema>;
