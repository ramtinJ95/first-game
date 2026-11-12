import * as v from 'valibot';
import { ArmyIdSchema, ConvoyIdSchema, FactionIdSchema } from '../ids.ts';
import { MapPointSchema } from './map-point.ts';

/** Transport ships carrying embarked armies across the sea. */
export const ConvoySchema = v.object({
  id: ConvoyIdSchema,
  owner: FactionIdSchema,
  position: MapPointSchema,
  armies: v.array(ArmyIdSchema),
});

export type Convoy = v.InferOutput<typeof ConvoySchema>;
