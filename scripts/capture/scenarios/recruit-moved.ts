import { expect } from '@playwright/test';
import { openGame } from '../../../e2e/support.ts';
import { foodShortUnlessWaiting, loadWarnings, showOwnCity } from '../../../e2e/warnings-game.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'recruit-moved',
  title:
    'A Spearmen raise warns and names Year 3, day 109; after 500 Skirmishers are raised, the same card names a later day and says the Skirmishers moved it',
  async run({ page, shot }) {
    await openGame(page);
    await loadWarnings(page, foodShortUnlessWaiting());
    await showOwnCity(page, 'Roma');
    const cards = page.getByTestId('recruit-cards');
    const warning = page.getByTestId('recruit-warning');
    await cards.getByRole('button', { name: /^Spearmen/ }).click();
    await expect(warning).toContainText('on Year 3, day 109');
    await warning.scrollIntoViewIfNeeded();
    await shot(
      'recruit-moved-before',
      'Before the second raise: Spearmen at Roma name Year 3, day 109',
    );
    await warning.getByRole('button', { name: 'Cancel raising' }).click();
    await cards.getByRole('button', { name: /^Skirmishers/ }).click();
    await expect(page.getByTestId('city-raising')).toContainText('Skirmishers');
    await cards.getByRole('button', { name: /^Spearmen/ }).click();
    const moved = page.getByTestId('recruit-moved');
    await expect(moved).toContainText('500 Skirmishers');
    await moved.scrollIntoViewIfNeeded();
    await shot(
      'recruit-moved-after',
      'After 500 Skirmishers are raised: the card names Year 10 and says the Skirmishers, fed first, moved the day',
    );
  },
});
