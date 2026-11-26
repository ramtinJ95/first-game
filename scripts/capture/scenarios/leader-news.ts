import { expect, type Page } from '@playwright/test';
import {
  dropSave,
  map,
  openGame,
  pause,
  playAi,
  resume,
  untilDrawn,
} from '../../../e2e/support.ts';
import { untilDay } from '../../../e2e/watch.ts';
import type { FactionId } from '../../../src/sim/ids.ts';
import { newGame } from '../../../src/sim/new-game.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

/**
 * Seed 8 under the AI, days before Carthage takes the lead from Macedon on day 1394, loses it
 * to a tie on day 1396 and takes it back on day 1463. Played as an idle Persia, at war with no
 * one from here, no fate, offer, or defeat stops the clock.
 */
const BEFORE_CARTHAGE_LEADS = 1370;
const AFTER_THE_LEAD = 1490;

export default defineScenario({
  name: 'leader-news',
  title:
    'The leading-power news of a ten-year game around a change of lead, told once for each power that takes the lead',
  async run({ page, shot }) {
    await openGame(page);
    // Rome has fallen by then, so the page plays the world as Persia.
    const tenYears = playAi(newGame(map, { seed: 8, player: 'rome' }), BEFORE_CARTHAGE_LEADS - 1);
    tenYears.player = 'persia' as FactionId;
    await load(page, tenYears);
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    await untilDay(page, AFTER_THE_LEAD, 0, 120_000);
    await pause(page);
    await page.getByRole('button', { name: 'Chronicle' }).click();
    const chronicle = page.getByTestId('chronicle');
    await chronicle
      .getByText(/is now the leading power/)
      .first()
      .scrollIntoViewIfNeeded();
    await shot(
      'leader-news',
      'Seed 8, 120 days around a change of lead: Carthage is told once as it takes the lead, and not again after a tie',
    );
  },
});
