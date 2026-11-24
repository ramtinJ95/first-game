import * as v from 'valibot';
import { BUILDING_KINDS, isGreatWork, neededFirst } from '../buildings/buildings.ts';
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

/** The building a city is at work on, and the days of work left, which pause while it is besieged or in unrest. */
export const ConstructionSchema = v.object({
  building: v.picklist(BUILDING_KINDS),
  daysLeft: v.pipe(v.number(), v.integer(), v.minValue(1)),
});
export type Construction = v.InferOutput<typeof ConstructionSchema>;

/**
 * A band of `GUARD_BAND` men hired for gold, who hold the walls until their day. A band
 * that serves longer than `GUARD_DAYS`, under Long contracts, names the day it was hired.
 */
export const GuardBandSchema = v.object({ until: DaySchema, hiredOn: v.optional(DaySchema) });
export type GuardBand = v.InferOutput<typeof GuardBandSchema>;

export const CitySchema = v.pipe(
  v.object({
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
    /** Scales its rank's full walls and food, which a siege wears down and the city recovers to. */
    fortified: v.pipe(v.number(), v.finite(), v.minValue(0)),
    /** The day the city fell to its owner, until the owner decides its fate. */
    fellOn: v.nullable(DaySchema),
    /** The day the city was last sacked, or null if it never was. Its gold stays low for `SACK.poorDays` after. */
    sackedOn: v.nullable(DaySchema),
    /** The buildings the city stands with, in the order they were finished. */
    buildings: v.array(v.picklist(BUILDING_KINDS)),
    construction: v.nullable(ConstructionSchema),
    /** The bands of guards hired for gold, in the order hired. They raise the full garrison by their men. */
    guards: v.array(GuardBandSchema),
  }),
  v.check(
    (city) =>
      new Set(city.buildings).size === city.buildings.length &&
      !(city.construction && city.buildings.includes(city.construction.building)),
    'a city has each building once, and works only on one it has not finished',
  ),
  v.check((city) => {
    const at = city.construction?.building;
    return [...city.buildings, ...(at ? [at] : [])].every((kind) => {
      const first = neededFirst(kind);
      return !first || city.buildings.includes(first);
    });
  }, 'a city builds a second level or a great work only on the building it needs'),
  v.check(
    (city) =>
      [...city.buildings, ...(city.construction ? [city.construction.building] : [])].filter(
        isGreatWork,
      ).length <= 1,
    'a city holds and works on one great work at most',
  ),
);

export type City = v.InferOutput<typeof CitySchema>;
