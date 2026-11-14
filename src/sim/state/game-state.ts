import * as v from 'valibot';
import {
  ArmyIdSchema,
  BattleIdSchema,
  CityIdSchema,
  ConvoyIdSchema,
  FactionIdSchema,
  FormationIdSchema,
  MAX_SERIAL,
  ProvinceIdSchema,
  RefugeeColumnIdSchema,
  SiegeIdSchema,
  TradeRouteIdSchema,
} from '../ids.ts';
import { RngStateSchema } from '../rng.ts';
import { ArmySchema } from './army.ts';
import { BattleSchema } from './battle.ts';
import { CitySchema } from './city.ts';
import { ConvoySchema } from './convoy.ts';
import { DaySchema } from './day.ts';
import { FactionSchema } from './faction.ts';
import { FormationSchema } from './formation.ts';
import { PeaceOfferSchema, TruceSchema } from './peace.ts';
import { ProvinceSchema } from './province.ts';
import { RefugeeColumnSchema } from './refugee-column.ts';
import { SiegeSchema } from './siege.ts';
import { WarKeySchema, WarSchema } from './war.ts';
import { TradeRouteSchema } from './trade-route.ts';

/**
 * The whole game as plain data. Each collection maps a record's id to the record.
 * The schema is the one source of the types and the check that a loaded save runs.
 */
export const GameStateSchema = v.object({
  day: DaySchema,
  rng: RngStateSchema,
  nextSerial: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(MAX_SERIAL)),
  player: FactionIdSchema,
  factions: v.record(FactionIdSchema, FactionSchema),
  provinces: v.record(ProvinceIdSchema, ProvinceSchema),
  cities: v.record(CityIdSchema, CitySchema),
  armies: v.record(ArmyIdSchema, ArmySchema),
  formations: v.record(FormationIdSchema, FormationSchema),
  convoys: v.record(ConvoyIdSchema, ConvoySchema),
  refugeeColumns: v.record(RefugeeColumnIdSchema, RefugeeColumnSchema),
  battles: v.record(BattleIdSchema, BattleSchema),
  sieges: v.record(SiegeIdSchema, SiegeSchema),
  /** Each pair of factions at war, once. Factions missing from it are at peace. */
  wars: v.record(WarKeySchema, WarSchema),
  /** The offer of peace that waits for an answer in each war, at most one. */
  peaceOffers: v.record(WarKeySchema, PeaceOfferSchema),
  /** Each pair of factions that made peace and may not declare war on each other yet. */
  truces: v.record(WarKeySchema, TruceSchema),
  tradeRoutes: v.record(TradeRouteIdSchema, TradeRouteSchema),
});

export type GameState = v.InferOutput<typeof GameStateSchema>;
