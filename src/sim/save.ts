import * as v from 'valibot';
import type { DeepReadonly } from './deep-readonly.ts';
import { findBrokenReferences } from './references.ts';
import { GameStateSchema, type GameState } from './state/game-state.ts';
import changes from './save-changes.generated.json' with { type: 'json' };

/** Add an immutable JSON file in save-changes/, never another shared version number. */
export const SAVE_FORMAT: readonly string[] = Object.freeze(changes.map((change) => change.name));

/**
 * Why a save was refused, for the player: it comes from an older version of the game,
 * from a newer one, or it is not a save the game can read.
 */
export type Refusal = 'older' | 'newer' | 'damaged';

function formatError(format: unknown): { refusal: Refusal; error: string } | undefined {
  if (!Array.isArray(format) || !format.every((name): name is string => typeof name === 'string')) {
    return {
      refusal: 'older',
      error: `The save has legacy or malformed format ${JSON.stringify(format)}; it lacks changes: ${SAVE_FORMAT.join(', ')}.`,
    };
  }
  if (new Set(format).size !== format.length) {
    return { refusal: 'damaged', error: 'The save repeats a format change.' };
  }
  const missing = changes.filter((change) => !format.includes(change.name));
  const unknown = format.filter((name) => !SAVE_FORMAT.includes(name)).sort();
  const differences = [
    ...(missing.length
      ? [`lacks changes: ${missing.map((change) => `${change.name} (${change.adds})`).join(', ')}`]
      : []),
    ...(unknown.length ? [`has unknown changes: ${unknown.join(', ')}`] : []),
  ];
  if (differences.length === 0) return undefined;
  return {
    refusal: missing.length ? 'older' : 'newer',
    error: `The save ${differences.join('; ')}.`,
  };
}

/**
 * `page` is what the page kept beside the game, such as its chronicle and where the
 * player was looking. The rules never read it, so the page checks it. A refused save
 * says why in `refusal`, and `error` holds the detail for a developer.
 */
export type LoadResult =
  { ok: true; state: GameState; page: unknown } | { ok: false; refusal: Refusal; error: string };

export function saveGame(state: DeepReadonly<GameState>, page?: unknown): string {
  return JSON.stringify(
    page === undefined ? { format: SAVE_FORMAT, state } : { format: SAVE_FORMAT, state, page },
  );
}

/** The one place that checks outside data. Rules code trusts the state it returns. */
export function loadGame(text: string): LoadResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, refusal: 'damaged', error: 'The save is not valid JSON.' };
  }
  if (typeof data !== 'object' || data === null || !('format' in data) || !('state' in data)) {
    return {
      ok: false,
      refusal: 'damaged',
      error: 'The save has no format version or no game state.',
    };
  }
  const incompatible = formatError(data.format);
  if (incompatible) return { ok: false, ...incompatible };
  const parsed = v.safeParse(GameStateSchema, data.state);
  if (!parsed.success) {
    const [first] = parsed.issues;
    const path = v.getDotPath(first);
    const more = parsed.issues.length > 1 ? ` (and ${parsed.issues.length - 1} more problems)` : '';
    return {
      ok: false,
      refusal: 'damaged',
      error: `The save's game state is malformed at ${path ? `state.${path}` : 'state'}: ${first.message}${more}`,
    };
  }
  const broken = findBrokenReferences(parsed.output);
  if (broken.length > 0) {
    return {
      ok: false,
      refusal: 'damaged',
      error: `The save's records disagree: ${broken.join('; ')}.`,
    };
  }
  return { ok: true, state: parsed.output, page: 'page' in data ? data.page : undefined };
}
