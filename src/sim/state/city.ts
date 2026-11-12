import * as v from 'valibot';
import { CityIdSchema, FactionIdSchema, ProvinceIdSchema } from '../ids.ts';
import { TroopSchema } from '../troops.ts';
import { DaySchema } from './day.ts';
import { MapPointSchema } from './map-point.ts';

/** A formation the city's owner paid for, which joins an army on its day. */
export const RecruitSchema = v.object({ troop: TroopSchema, readyOn: DaySchema });
export type Recruit = v.InferOutput<typeof RecruitSchema>;

export const CitySchema = v.object({
  id: CityIdSchema,
  name: v.string(),
  province: ProvinceIdSchema,
  owner: FactionIdSchema,
  position: MapPointSchema,
  /** A fraction of a person is kept, so slow daily growth adds up. */
  population: v.pipe(v.number(), v.finite(), v.minValue(0)),
  /** Days of unrest left. 0 is a calm city. */
  unrestDays: v.pipe(v.number(), v.integer(), v.minValue(0)),
  recruits: v.array(RecruitSchema),
});

export type City = v.InferOutput<typeof CitySchema>;
