import * as v from 'valibot';
import { CityIdSchema, FactionIdSchema } from '../ids.ts';
import { DaySchema } from './day.ts';

/**
 * What a peace asks. As things stand, nothing changes hands. A payment has one side, the
 * payer, give the other gold, cities, or both.
 */
export const PeaceTermsSchema = v.variant('kind', [
  v.object({ kind: v.literal('asThingsStand') }),
  v.object({
    kind: v.literal('payment'),
    payer: FactionIdSchema,
    gold: v.pipe(v.number(), v.integer(), v.minValue(0)),
    cities: v.array(CityIdSchema),
  }),
]);
export type PeaceTerms = v.InferOutput<typeof PeaceTermsSchema>;

/** An offer of peace that waits for the other side of the war to accept or refuse it. */
export const PeaceOfferSchema = v.object({
  from: FactionIdSchema,
  terms: PeaceTermsSchema,
  madeOn: DaySchema,
});
export type PeaceOffer = v.InferOutput<typeof PeaceOfferSchema>;

/** After a peace, neither side may declare war on the other before `endsOn`. */
export const TruceSchema = v.object({ since: DaySchema, endsOn: DaySchema });
export type Truce = v.InferOutput<typeof TruceSchema>;
