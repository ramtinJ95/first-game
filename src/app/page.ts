import * as v from 'valibot';
import type { Camera } from '../render/camera.ts';
import type { Pick } from '../render/pick.ts';
import {
  ArmyIdSchema,
  BattleIdSchema,
  CityIdSchema,
  ProvinceIdSchema,
  SiegeIdSchema,
  type SiegeId,
} from '../sim/ids.ts';
import { DaySchema } from '../sim/state/day.ts';
import { MapPointSchema } from '../sim/state/map-point.ts';
import { ALERT_KINDS, PAUSE_KINDS, type Alert, type Occupied, type WeakSiege } from './alerts.ts';

/** The panels that open over the map's left side, one at a time. */
export const PANELS = ['overview', 'chronicle'] as const;
export type Panel = (typeof PANELS)[number];

/**
 * The alerts a game keeps, newest first. An alert is some 200 bytes of JSON, so a full
 * chronicle adds about 200 kB to a save and both browser slots stay far inside the
 * space a browser gives a page.
 */
export const CHRONICLE_KEPT = 1000;

const PickSchema = v.variant('kind', [
  v.object({ kind: v.literal('province'), province: ProvinceIdSchema }),
  v.object({ kind: v.literal('army'), army: ArmyIdSchema }),
  v.object({ kind: v.literal('battle'), battle: BattleIdSchema }),
]);

const AlertSchema = v.object({
  kind: v.picklist(ALERT_KINDS),
  day: DaySchema,
  text: v.string(),
  tone: v.picklist(['good', 'bad', 'neutral']),
  focus: v.optional(v.object({ at: MapPointSchema, select: v.optional(PickSchema) })),
  seenAs: v.optional(PickSchema),
  count: v.optional(v.number()),
  pause: v.optional(v.object({ kind: v.picklist(PAUSE_KINDS), once: v.optional(v.string()) })),
  paused: v.optional(v.literal(true)),
});

const PageSchema = v.object({
  chronicle: v.pipe(v.array(AlertSchema), v.maxLength(CHRONICLE_KEPT)),
  camera: v.optional(
    v.object({ centre: MapPointSchema, scale: v.pipe(v.number(), v.finite(), v.minValue(0)) }),
  ),
  selection: v.optional(PickSchema),
  panel: v.optional(v.picklist(PANELS)),
  occupied: v.array(v.tuple([CityIdSchema, DaySchema])),
  told: v.array(v.string()),
  weakSieges: v.array(
    v.tuple([
      SiegeIdSchema,
      v.object({
        men: v.array(v.tuple([ArmyIdSchema, v.number()])),
        killed: v.number(),
        bled: v.boolean(),
      }),
    ]),
  ),
});

/**
 * What the page keeps beside the game in a save, so a loaded game opens where the
 * player left it: the chronicle, the camera, the selection, the open panel, and the
 * cities the player chose to occupy. It also keeps what the news has told already, the
 * keys of news told once and the weak sieges watched, so a loaded game neither tells
 * them again nor stops for them twice.
 */
export interface Page {
  readonly chronicle: readonly Alert[];
  readonly camera: Camera | undefined;
  readonly selection: Pick | undefined;
  readonly panel: Panel | undefined;
  readonly occupied: Occupied;
  readonly told: ReadonlySet<string>;
  readonly weakSieges: ReadonlyMap<SiegeId, WeakSiege>;
}

export function pageData(page: Page): unknown {
  return {
    ...page,
    occupied: [...page.occupied],
    told: [...page.told],
    weakSieges: [...page.weakSieges].map(([id, siege]) => [id, { ...siege, men: [...siege.men] }]),
  };
}

/**
 * The page a save kept, nothing for a save written without one, or why it cannot be
 * read. A save of this format always holds one, so a malformed page refuses the save.
 */
export function parsePage(
  data: unknown,
): { ok: true; page: Page | undefined } | { ok: false; error: string } {
  if (data === undefined) return { ok: true, page: undefined };
  const parsed = v.safeParse(PageSchema, data);
  if (!parsed.success) {
    const [first] = parsed.issues;
    const path = v.getDotPath(first);
    return {
      ok: false,
      error: `The save's page is malformed at ${path ? `page.${path}` : 'page'}: ${first.message}`,
    };
  }
  const { chronicle, camera, selection, panel, occupied, told, weakSieges } = parsed.output;
  return {
    ok: true,
    page: {
      chronicle,
      camera,
      selection,
      panel,
      occupied: new Map(occupied),
      told: new Set(told),
      weakSieges: new Map(
        weakSieges.map(([id, siege]) => [id, { ...siege, men: new Map(siege.men) }]),
      ),
    },
  };
}
