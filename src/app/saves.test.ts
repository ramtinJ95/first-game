import { describe, expect, it } from 'vitest';
import { buildFixture } from '../sim/fixture.ts';
import { loadGame, SAVE_FORMAT, saveGame } from '../sim/save.ts';
import { REFUSED_SAVE } from './saves.ts';

const state = JSON.parse(saveGame(buildFixture())).state as unknown;

/** The sentence the page shows for a save the game refuses. */
function notice(text: string): string {
  const result = loadGame(text);
  if (result.ok) throw new Error('the save loaded');
  return REFUSED_SAVE[result.refusal];
}

describe('a refused save', () => {
  it('tells the player of an older save that it cannot be opened and to begin a new game', () => {
    expect(notice(JSON.stringify({ format: 13, state }))).toBe(
      'This save is from an older version of the game and cannot be opened, so choose a power on the start screen to begin a new game.',
    );
  });

  it('tells the player of a newer save to open it in that version or begin a new game', () => {
    expect(notice(JSON.stringify({ format: [...SAVE_FORMAT, 'future-fleets'], state }))).toBe(
      'This save is from a newer version of the game and cannot be opened here, so open it in that version or choose a power on the start screen to begin a new game.',
    );
  });

  it('tells the player of a file that is no save to drop another or begin a new game', () => {
    expect(notice('not a save')).toBe(
      'This file is not a save the game can open, so drop another save on the page or choose a power on the start screen to begin a new game.',
    );
  });
});
