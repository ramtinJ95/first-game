import * as v from 'valibot';
import { FactionIdSchema } from '../ids.ts';

export const FACTION_KINDS = ['greatPower', 'minor'] as const;

export const FactionSchema = v.object({
  id: FactionIdSchema,
  name: v.string(),
  /** Saves from before minor factions existed hold only great powers. */
  kind: v.optional(v.picklist(FACTION_KINDS), 'greatPower'),
});

export type Faction = v.InferOutput<typeof FactionSchema>;
export type FactionKind = Faction['kind'];
