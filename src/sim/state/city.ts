import * as v from 'valibot';
import { MAX_UNREST_DAYS } from '../cities.ts';
import { CityIdSchema, FactionIdSchema, ProvinceIdSchema } from '../ids.ts';
import { TroopSchema } from '../troops.ts';
import { DaySchema } from './day.ts';
import { MapPointSchema } from './map-point.ts';

/** A formation the city's owner paid for, which joins an army on its day. */
export const RecruitSchema = v.object({ troop: TroopSchema, readyOn: DaySchema });
export type Recruit = v.InferOutput<typeof RecruitSchema>;

/** A city's rank sets its starting population and its full defences. */
export const CITY_RANKS = ['capital', 'greatPowerCity', 'minorCity'] as const;
export type CityRank = (typeof CITY_RANKS)[number];

export const CitySchema = v.object({
  id: CityIdSchema,
  name: v.string(),
  province: ProvinceIdSchema,
  rank: v.picklist(CITY_RANKS),
  owner: FactionIdSchema,
  position: MapPointSchema,
  /** A fraction of a person is kept, so slow daily growth adds up. */
  population: v.pipe(v.number(), v.finite(), v.minValue(0)),
  /** Days of unrest left. 0 is a calm city. */
  unrestDays: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_UNREST_DAYS)),
  recruits: v.array(RecruitSchema),
  /**
   * What is left of the walls, the garrison, and the food. A siege wears them down
   * and they stay worn when it ends, so the next siege starts where this one stopped.
   */
  walls: v.pipe(v.number(), v.finite(), v.minValue(0)),
  garrison: v.pipe(v.number(), v.integer(), v.minValue(0)),
  foodDays: v.pipe(v.number(), v.finite(), v.minValue(0)),
  /** The day the city fell to its owner, until the owner decides its fate. */
  fellOn: v.nullable(DaySchema),
  /** The day the city was last sacked, or null if it never was. Its gold stays low for `SACK.poorDays` after. */
  sackedOn: v.nullable(DaySchema),
});

export type City = v.InferOutput<typeof CitySchema>;
