import { expect } from '@playwright/test';
import {
  openGame,
  pause,
  resume,
  rome,
  romaFallsTomorrow,
  untilDay,
} from '../../../e2e/support.ts';
import {
  foodShortfall,
  loadWarnings,
  ownCityInDangerTomorrow,
  ownSiegeTomorrow,
  showOwnCity,
  slowFoodDeficit,
  smallSallyTomorrow,
} from '../../../e2e/warnings-game.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'warnings',
  title:
    'A cautious player sees the cost of waiting: recruitment upkeep, continuing desertion, own-city siege pauses, quiet sallies and a modal defeat',
  async run({ page, shot }) {
    await openGame(page, { query: 'draw=full', pauses: true });
    await loadWarnings(page, foodShortfall());
    await showOwnCity(page, 'Roma');
    await page
      .getByTestId('city-panel')
      .getByRole('button', { name: /^Spearmen/ })
      .click();
    await page.getByTestId('recruit-warning').scrollIntoViewIfNeeded();
    await shot(
      'recruit-shortfall',
      'A lasting deficit warns at any distance: 9 days of food and 824 days of gold, both red, and the raise asks Raise anyway',
    );

    await loadWarnings(page, slowFoodDeficit());
    await showOwnCity(page, 'Roma');
    await page.getByTestId('recruit-forecast').scrollIntoViewIfNeeded();
    await shot(
      'recruit-growth-closes',
      "With Spearmen selected, a small deficit the growing people close stays plain: 2,809 days at today's yields, no warning, and a plain Raise troops",
    );

    const hungry = foodShortfall();
    const stores = hungry.factions[rome]?.stores;
    if (!stores) throw new Error('Rome missing');
    stores.food = -1000;
    await loadWarnings(page, hungry);
    await resume(page);
    await untilDay(page, hungry.day + 3);
    await pause(page);
    await page.keyboard.press('Escape');
    await page.getByTestId('desertion-standing').waitFor();
    await shot(
      'standing-desertion',
      'Hunger stays visible each day after its first notice; the Chronicle tracks start, a tenth lost and the final total instead of daily spam',
    );

    for (const [name, make, line, title] of [
      [
        'own-siege-begins',
        ownSiegeTomorrow,
        /besieges Capua/,
        'The siege of your own city pauses on its first day',
      ],
      [
        'own-city-danger',
        ownCityInDangerTomorrow,
        /Capua is in danger: 7 days of food/,
        'Seven days of food left: a second pause says to relieve, sally or seek peace',
      ],
    ] as const) {
      await loadWarnings(page, make());
      await resume(page);
      const alert = page.getByTestId('alerts').getByRole('button').filter({ hasText: line });
      await expect(alert).toContainText('Paused');
      await alert.click();
      await shot(name, title);
    }

    const small = smallSallyTomorrow();
    await loadWarnings(page, small);
    await resume(page);
    await untilDay(page, small.day + 3);
    await pause(page);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Chronicle', exact: true }).click();
    await shot(
      'quiet-sally',
      'A one-day 100-man sally does not pause a realm with a reserve: one quiet result in the corner, details in the Chronicle',
    );
    await page.getByRole('button', { name: 'Chronicle', exact: true }).click();

    await loadWarnings(page, romaFallsTomorrow());
    await resume(page);
    await page.getByRole('dialog', { name: 'Rome has fallen' }).waitFor();
    await shot(
      'defeat-dialog',
      'Defeat is a native modal dialog: focus stays inside it and the backdrop makes the game beneath inert',
    );
  },
});
