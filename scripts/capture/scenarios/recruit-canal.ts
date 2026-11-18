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
    'The Spearmen card at Roma names Year 1, day 252; after 500 Skirmishers it names Year 5, day 35, says the Skirmishers moved it, and says Canals at Roma, for 4,000 gold and 5 more food a day, would feed the Spearmen if raised now',
  viewport: WIDE,
  async run({ page, shot }) {
    await openGame(page);
    await loadWarnings(page, foodShortUnlessWaiting());
    await showOwnCity(page, 'Roma');
    const cards = page.getByTestId('recruit-cards');
    const warning = page.getByTestId('recruit-warning');
    await cards.getByRole('button', { name: /^Spearmen/ }).click();
    await expect(warning).toContainText('on Year 1, day 252');
    await warning.getByRole('button', { name: 'Cancel raising' }).click();
    await cards.getByRole('button', { name: /^Skirmishers/ }).click();
    await expect(page.getByTestId('city-raising')).toContainText('Skirmishers');
    await cards.getByRole('button', { name: /^Spearmen/ }).click();
    await expect(page.getByTestId('recruit-moved')).toContainText(
      'Now Year 5, day 35, not Year 1, day 252',
    );
    await expect(page.getByTestId('recruit-canal')).toContainText('fed if raised now');
    await showCanal(page);
    await shot(
      'recruit-canal-1280',
      'The Spearmen card after 500 Skirmishers: Year 5, day 35, the line that says the Skirmishers moved it from Year 1, day 252, and the Canals line that feeds the Spearmen if raised now, at 1280 by 720',
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
