import { expect, type Page } from '@playwright/test';
import {
  dropSave,
  openGame,
  pause,
  resizeTo,
  resume,
  rome,
  startGame,
  untilDrawn,
} from '../../../e2e/support.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

const WIDE = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

async function resize(page: Page, size: { width: number; height: number }) {
  await resizeTo(page, size);
  await page.locator('canvas[data-terrain="ready"]').waitFor();
}

/** Rome on day 1 with a full purse, Standard coin studied and Fallow fields at work. */
function studying(daysLeft: number): GameState {
  const state = startGame();
  const realm = state.factions[rome];
  if (!realm) throw new Error('no Rome');
  realm.stores.gold = 15_000;
  realm.advances = ['standardCoin'];
  realm.study = { advance: 'fallowFields', daysLeft };
  return state;
}

export default defineScenario({
  name: 'advances',
  title:
    "The Advances panel's three branches with what each advance would do for Rome today, the top bar's line of what is studied, and the news of an advance finished",
  viewport: WIDE,
  async run({ page, shot }) {
    await openGame(page);
    await load(page, studying(120));
    await expect(page.getByTestId('study-line')).toHaveText('Fallow fields · 120 days');
    await shot(
      'top-bar-1280',
      'The top bar names the advance studied and its days left, at 1280 by 720',
    );

    await page.getByTestId('advances-button').click();
    const panel = page.getByTestId('advances');
    await expect(panel.getByTestId('advance-suggested')).toHaveCount(0);
    await expect(panel.getByTestId('advance-standardCoin')).toContainText('Studied');
    await shot(
      'panel-1280',
      'The Advances panel at 1280 by 720: Fallow fields at work, Standard coin studied, and for each other advance what it does, what it would do for Rome today, its price, its days and its payback',
    );
    await panel.getByTestId('branch-statecraft').scrollIntoViewIfNeeded();
    await shot('panel-statecraft-1280', 'The statecraft branch, scrolled to, at 1280 by 720');

    await resize(page, PHONE);
    await expect(page.getByTestId('study-days')).toHaveText('120 days');
    await shot(
      'panel-390',
      'The Advances panel at 390 px wide, with the top bar naming the days left',
    );
    await resize(page, WIDE);
    await page.getByTestId('advances-button').click();

    await load(page, studying(2));
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('Fallow fields is studied, for good.');
    await pause(page);
    await expect(page.getByTestId('study-line')).toHaveText('None studied');
    await shot(
      'finished-1280',
      'The news of Fallow fields finished, in the corner, with the game still running until paused, and the top bar saying nothing is studied',
    );
    await resize(page, PHONE);
    await shot('finished-390', 'The same news at 390 px wide, the top bar saying None');
  },
});
