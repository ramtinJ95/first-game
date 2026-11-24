import * as v from 'valibot';
import { FactionIdSchema } from '../ids.ts';
import { ADVANCE_KINDS } from '../advances/advances.ts';
import { DaySchema } from './day.ts';

export const FACTION_KINDS = ['greatPower', 'minor'] as const;

const AmountSchema = v.pipe(v.number(), v.finite());

/** Gold and food go below zero when upkeep outruns them. That debt is a shortage. */
export const StoresSchema = v.object({
  gold: AmountSchema,
  food: AmountSchema,
  manpower: v.pipe(AmountSchema, v.minValue(0)),
});
export type Stores = v.InferOutput<typeof StoresSchema>;

/** The advance a faction studies and the days of study left, of which today is one. */
const StudySchema = v.object({
  advance: v.picklist(ADVANCE_KINDS),
  daysLeft: v.pipe(v.number(), v.integer(), v.minValue(1)),
});

export const FactionSchema = v.pipe(
  v.object({
    id: FactionIdSchema,
    name: v.string(),
    /** Saves from before minor factions existed hold only great powers. */
    kind: v.optional(v.picklist(FACTION_KINDS), 'greatPower'),
    stores: StoresSchema,
    /** The minor whose wars this minor joins, and which joins its wars, or null. */
    league: v.optional(v.nullable(FactionIdSchema)),
    /** The day the faction lost its last city and left the game, or null while it plays. */
    defeatedOn: v.nullable(DaySchema),
    /**
     * The day this great power came to stand at NOTICE_SHARE of the strength it needs to
     * declare war on the player, and has stood there since; null while it does not.
     */
    noticeSince: v.optional(v.nullable(DaySchema), null),
    /** The advances the faction has studied, in the order it finished them. A save from before advances has none. */
    advances: v.optional(v.array(v.picklist(ADVANCE_KINDS)), []),
    /** The advance at study, or null. */
    study: v.optional(v.nullable(StudySchema), null),
    /** How many armies the faction has raised, which numbers the next one's name. Absent is none. */
    armiesRaised: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
  }),
  v.check(
    (faction) =>
      new Set(faction.advances).size === faction.advances.length &&
      !(faction.study && faction.advances.includes(faction.study.advance)),
    'A faction studies each advance once.',
  ),
);

export type Faction = v.InferOutput<typeof FactionSchema>;
export type FactionKind = Faction['kind'];
