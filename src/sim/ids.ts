import * as v from 'valibot';

export const FactionIdSchema = v.pipe(v.string(), v.brand('FactionId'));
export const ProvinceIdSchema = v.pipe(v.string(), v.brand('ProvinceId'));
export const CityIdSchema = v.pipe(v.string(), v.brand('CityId'));
export const ArmyIdSchema = v.pipe(v.string(), v.brand('ArmyId'));
export const FormationIdSchema = v.pipe(v.string(), v.brand('FormationId'));
export const ConvoyIdSchema = v.pipe(v.string(), v.brand('ConvoyId'));
export const RefugeeColumnIdSchema = v.pipe(v.string(), v.brand('RefugeeColumnId'));
export const BattleIdSchema = v.pipe(v.string(), v.brand('BattleId'));
export const SiegeIdSchema = v.pipe(v.string(), v.brand('SiegeId'));

export type FactionId = v.InferOutput<typeof FactionIdSchema>;
export type ProvinceId = v.InferOutput<typeof ProvinceIdSchema>;
export type CityId = v.InferOutput<typeof CityIdSchema>;
export type ArmyId = v.InferOutput<typeof ArmyIdSchema>;
export type FormationId = v.InferOutput<typeof FormationIdSchema>;
export type ConvoyId = v.InferOutput<typeof ConvoyIdSchema>;
export type RefugeeColumnId = v.InferOutput<typeof RefugeeColumnIdSchema>;
export type BattleId = v.InferOutput<typeof BattleIdSchema>;
export type SiegeId = v.InferOutput<typeof SiegeIdSchema>;

interface IdOfKind {
  faction: FactionId;
  province: ProvinceId;
  city: CityId;
  army: ArmyId;
  formation: FormationId;
  convoy: ConvoyId;
  refugeeColumn: RefugeeColumnId;
  battle: BattleId;
  siege: SiegeId;
}

/** Hands out a fresh id from the counter in the state, so new records stay deterministic. */
export function allocateId<K extends keyof IdOfKind>(
  state: { nextSerial: number },
  kind: K,
): IdOfKind[K] {
  const id = `${kind}-${state.nextSerial}`;
  state.nextSerial += 1;
  return id as IdOfKind[K];
}
