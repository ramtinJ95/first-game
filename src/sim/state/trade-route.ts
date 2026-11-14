import * as v from 'valibot';
import { CityIdSchema, FactionIdSchema, TradeRouteIdSchema } from '../ids.ts';
import { DaySchema } from './day.ts';
import { MapPointSchema } from './map-point.ts';

const positive = v.pipe(v.number(), v.finite(), v.gtValue(0));
export const TradeRouteSchema = v.object({
  id: TradeRouteIdSchema,
  from: CityIdSchema,
  to: CityIdSchema,
  owner: FactionIdSchema,
  partner: FactionIdSchema,
  mode: v.picklist(['land', 'sea']),
  status: v.picklist(['offered', 'running']),
  path: v.pipe(v.array(v.pipe(MapPointSchema, v.readonly())), v.minLength(2), v.readonly()),
  km: positive,
  days: v.pipe(positive, v.integer()),
  daily: positive,
  cost: positive,
  progress: v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(1)),
  returning: v.boolean(),
  deliveries: v.pipe(v.number(), v.integer(), v.minValue(0)),
  openedOn: DaySchema,
  departsOn: DaySchema,
  blocked: v.nullable(v.picklist(['siege', 'raid'])),
});
export type TradeRoute = v.InferOutput<typeof TradeRouteSchema>;
