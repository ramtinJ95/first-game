import * as v from 'valibot';

/** A position in the projected map coordinates that the map build writes. */
export const MapPointSchema = v.object({
  x: v.pipe(v.number(), v.finite()),
  y: v.pipe(v.number(), v.finite()),
});

export type MapPoint = v.InferOutput<typeof MapPointSchema>;
