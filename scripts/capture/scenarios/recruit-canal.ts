import { expect, type Page } from '@playwright/test';
import { openGame, resizeTo } from '../../../e2e/support.ts';
import { foodShortUnlessWaiting, loadWarnings, showOwnCity } from '../../../e2e/warnings-game.ts';
import { defineScenario } from '../scenario.ts';

const WIDE = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

async function showCanal(page: Page) {
  const canal = page.getByTestId('recruit-canal');
  await expect(canal).toContainText('Or build Canals at Roma for 4,000 gold');
  await canal.scrollIntoViewIfNeeded();
}

export default defineScenario({
  name: 'recruit-canal',
  title:
    'After 500 Skirmishers, the Spearmen card at Roma names a day years away and says Canals at Roma, for 4,000 gold and 5 more food a day, would feed the Spearmen sooner, on a day it names',
  viewport: WIDE,
  async run({ page, shot }) {
    await openGame(page);
    await loadWarnings(page, foodShortUnlessWaiting());
    await showOwnCity(page, 'Roma');
    const cards = page.getByTestId('recruit-cards');
    await cards.getByRole('button', { name: /^Skirmishers/ }).click();
    await expect(page.getByTestId('city-raising')).toContainText('Skirmishers');
    await cards.getByRole('button', { name: /^Spearmen/ }).click();
    await showCanal(page);
    await shot(
      'recruit-canal-1280',
      'The Spearmen card after 500 Skirmishers: its far day, and the Canals line with its price, its food and the sooner day, at 1280 by 720',
    );
    await resizeTo(page, PHONE);
    await page.locator('canvas[data-terrain="ready"]').waitFor();
    await showCanal(page);
    await shot(
      'recruit-canal-390',
      'The same card at 390 px wide, where the side column is a sheet',
    );
  },
});
