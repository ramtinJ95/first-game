import { expect, type Page } from '@playwright/test';
import {
  dropSave,
  openGame,
  pause,
  resizeTo,
  rome,
  startGame,
  untilDrawn,
} from '../../../e2e/support.ts';
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

/** Resizes the page, waits until the map has followed, and lets its new chunks fade in. */
async function resize(page: Page, size: { width: number; height: number }) {
  await resizeTo(page, size);
  await page.locator('canvas[data-terrain="ready"]').waitFor();
}

/** Rome's gold and food ran out. */
function storesRunOut(): GameState {
  const state = startGame();
  const stores = state.factions[rome]?.stores;
  if (!stores) throw new Error('no stores of Rome');
  stores.gold = -120;
  stores.food = -40;
  return state;
}

export default defineScenario({
  name: 'layout',
  title:
    'The top bar on one row at 1024 px with stores run out, the Game menu inside the page at 1280 px, and the question before leaving for the start screen',
  viewport: { width: 1280, height: 720 },
  async run({ page, shot }) {
    await openGame(page);
    await untilDrawn(page);
    await page.getByRole('button', { name: 'Game', exact: true }).click();
    await page.getByTestId('save-menu').waitFor();
    await shot('game-menu-1280', 'The Game menu at 1280 px opens inside the page');
    await page.keyboard.press('Escape');

    await resize(page, { width: 1024, height: 768 });
    await load(page, storesRunOut());
    await page.getByTestId('store-gold-note').waitFor();
    await resize(page, { width: 1024, height: 768 });
    await shot(
      'top-bar-1024',
      'The top bar at 1024 px on one row with gold and food run out: "Ran out" on each, and why on hover',
    );

    await resize(page, { width: 1280, height: 720 });
    await page.getByRole('button', { name: 'Game', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Start screen' }).click();
    await page.getByTestId('leave-confirm').waitFor();
    await shot(
      'leave-confirm',
      'Start screen in the Game menu asks first, with the game paused: save and leave, leave without saving, or stay',
    );
  },
});
