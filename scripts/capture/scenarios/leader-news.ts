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
 * Seed 5 under the AI, days before Persia takes the lead on day 1463, loses it to a tie on
 * day 1548 and takes it back on day 1555. Played as an idle Carthage from here, as the page
 * plays it, no fate, offer, or defeat stops the clock.
 */
const BEFORE_PERSIA_LEADS = 1450;
const AFTER_THE_LEAD = 1600;

export default defineScenario({
  name: 'leader-news',
  title:
    'The leading-power news of a ten-year game around a change of lead, told once for each power that takes the lead',
  async run({ page, shot }) {
    await openGame(page);
    // An idle Rome has fallen by then, so the page plays the world as Carthage.
    const tenYears = playAi(newGame(map, { seed: 5, player: 'rome' }), BEFORE_PERSIA_LEADS - 1);
    tenYears.player = 'carthage' as FactionId;
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
      'Seed 5, 150 days around a change of lead: Persia is told once as it takes the lead, and not again after a tie',
    );
  },
});
