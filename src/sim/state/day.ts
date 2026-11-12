import * as v from 'valibot';

/** A game day. Day 1 is the first day of a game. */
export const DaySchema = v.pipe(v.number(), v.integer(), v.minValue(1), v.brand('Day'));
export type Day = v.InferOutput<typeof DaySchema>;
