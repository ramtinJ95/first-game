import * as v from 'valibot';
import { FactionIdSchema } from '../ids.ts';

export const FACTION_KINDS = ['greatPower', 'minor'] as const;

const AmountSchema = v.pipe(v.number(), v.finite());

/** Gold and food go below zero when upkeep outruns them. That debt is a shortage. */
export const StoresSchema = v.object({
  gold: AmountSchema,
  food: AmountSchema,
  manpower: v.pipe(AmountSchema, v.minValue(0)),
});
export type Stores = v.InferOutput<typeof StoresSchema>;

export const FactionSchema = v.object({
  id: FactionIdSchema,
  name: v.string(),
  /** Saves from before minor factions existed hold only great powers. */
  kind: v.optional(v.picklist(FACTION_KINDS), 'greatPower'),
  stores: StoresSchema,
});

export type Faction = v.InferOutput<typeof FactionSchema>;
export type FactionKind = Faction['kind'];
