import * as v from 'valibot';
import type { DeepReadonly } from './deep-readonly.ts';
import { findBrokenReferences } from './references.ts';
import { GameStateSchema, type GameState } from './state/game-state.ts';

/**
 * Raise this when a change to the state makes older saves unreadable. Format 12 added
 * each army's name, the faction's count of armies raised, and the page beside the state.
 */
export const SAVE_FORMAT = 12;

/**
 * `page` is what the page kept beside the game, such as its chronicle and where the
 * player was looking. The rules never read it, so the page checks it.
 */
export type LoadResult =
  { ok: true; state: GameState; page: unknown } | { ok: false; error: string };

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
    return { ok: false, error: 'The save is not valid JSON.' };
  }
  if (typeof data !== 'object' || data === null || !('format' in data) || !('state' in data)) {
    return { ok: false, error: 'The save has no format version or no game state.' };
  }
  if (data.format !== SAVE_FORMAT) {
    return {
      ok: false,
      error: `The save has format ${JSON.stringify(data.format)}, but this game reads format ${SAVE_FORMAT}.`,
    };
  }
  const parsed = v.safeParse(GameStateSchema, data.state);
  if (!parsed.success) {
    const [first] = parsed.issues;
    const path = v.getDotPath(first);
    const more = parsed.issues.length > 1 ? ` (and ${parsed.issues.length - 1} more problems)` : '';
    return {
      ok: false,
      error: `The save's game state is malformed at ${path ? `state.${path}` : 'state'}: ${first.message}${more}`,
    };
  }
  const broken = findBrokenReferences(parsed.output);
  if (broken.length > 0) {
    return { ok: false, error: `The save's records disagree: ${broken.join('; ')}.` };
  }
  return { ok: true, state: parsed.output, page: 'page' in data ? data.page : undefined };
}
