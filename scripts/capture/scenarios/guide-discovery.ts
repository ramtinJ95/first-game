import { expect } from '@playwright/test';
import {
  discoveryGame,
  fullBuildingGame,
  loadDiscovery,
  pickCity,
  staggeredSiege,
  showSiegeWarning,
  pickMinor,
  minorSamples,
  queueStance,
} from '../../../e2e/guide-game.ts';
import { openGame, resizeTo, startGame } from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'guide-discovery',
  title:
    'The whole-game guide, visible wars, useful building cautions, coordinated siege arrivals, and every minor kind',
  viewport: { width: 1280, height: 768 },
  async run({ page, shot }) {
    await openGame(page);
    await loadDiscovery(page, discoveryGame());
    await queueStance(page);
    await page.keyboard.press('Escape');
    for (const width of [1280, 1024]) {
      await resizeTo(page, { width, height: 768 });
      await shot(
        `wars-${width}`,
        `Wars and an offer waiting, Full tomorrow and At the call-up limit, one row at ${width} px`,
      );
    }
    await resizeTo(page, { width: 1280, height: 768 });
    await page.getByRole('button', { name: 'Guide', exact: true }).click();
    const guide = page.getByTestId('guide');
    await shot('guide-first', 'Guide: selecting, sieges, buildings, peace, and pauses');
    await guide.getByRole('button', { name: 'Close', exact: true }).scrollIntoViewIfNeeded();
    await shot('guide-last', 'Guide: stances, Overview, Chronicle, saving, and city-fate pauses');
    await guide.getByRole('button', { name: 'Close', exact: true }).click();
    await loadDiscovery(page, fullBuildingGame());
    await pickCity(page, 'roma');
    await page.getByTestId('build-temple').scrollIntoViewIfNeeded();
    await shot(
      'building-cautions',
      'Food is full and no nearby city is in unrest: Canals and Temple warn but remain allowed',
    );
    await page.keyboard.press('Escape');
    await loadDiscovery(page, staggeredSiege());
    await showSiegeWarning(page);
    await shot(
      'siege-arrivals',
      'Two legions, 17 days apart: arrival dates, committed men, and exposure to sallies',
    );
    await expect(page.getByTestId('notice')).toBeHidden();
    await page.keyboard.press('Escape');
    const state = startGame();
    for (const [kind, city] of minorSamples(state)) {
      await pickMinor(page, state, city);
      await page.getByTestId('city-minor').waitFor();
      await shot(`minor-${kind}`, `${city.name}: the ${kind} minor kind is always described`);
      await page.keyboard.press('Escape');
    }
  },
});
