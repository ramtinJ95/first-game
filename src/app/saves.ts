import * as v from 'valibot';
import type { DeepReadonly } from '../sim/deep-readonly.ts';
import { saveGame } from '../sim/save.ts';
import type { GameState } from '../sim/state/game-state.ts';

/** The game keeps one save the player writes and one it writes itself each month. */
export const SLOTS = ['manual', 'auto'] as const;
export type Slot = (typeof SLOTS)[number];

/**
 * A game month is 30 days, counted from day 1. The game saves itself on the first day
 * of each month but the first, so that choosing a power does not overwrite "Continue".
 */
export const MONTH_DAYS = 30;

export function startsMonth(day: number): boolean {
  return day > 1 && (day - 1) % MONTH_DAYS === 0;
}

const SavedSchema = v.object({
  savedAt: v.number(),
  day: v.number(),
  realm: v.string(),
  /** The save as `saveGame` writes it. Loading it runs every check of `loadGame`. */
  text: v.string(),
});

export type Saved = v.InferOutput<typeof SavedSchema> & { readonly slot: Slot };

const key = (slot: Slot) => `save:${slot}`;

/** The page's local storage, or undefined where the browser blocks it. */
export function browserStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function readSaved(storage: Storage | undefined, slot: Slot): Saved | undefined {
  try {
    const raw = storage?.getItem(key(slot));
    if (!raw) return undefined;
    const parsed = v.safeParse(SavedSchema, JSON.parse(raw));
    return parsed.success ? { ...parsed.output, slot } : undefined;
  } catch {
    return undefined;
  }
}

/** Writes the day to the slot, or returns why the browser refused it. */
export function writeSaved(
  storage: Storage | undefined,
  slot: Slot,
  state: DeepReadonly<GameState>,
  savedAt: number,
): Saved | string {
  if (!storage) return 'This browser keeps no storage for the page.';
  const saved: Saved = {
    slot,
    savedAt,
    day: state.day,
    realm: state.factions[state.player]?.name ?? state.player,
    text: saveGame(state),
  };
  try {
    storage.setItem(key(slot), JSON.stringify({ ...saved, slot: undefined }));
    return saved;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** The save "Continue" loads: the one written last. */
export function latestSaved(saves: Partial<Record<Slot, Saved>>): Saved | undefined {
  return SLOTS.flatMap((slot) => saves[slot] ?? []).sort((a, b) => b.savedAt - a.savedAt)[0];
}
