import { expect, type Page } from '@playwright/test';
import {
  camera,
  cityPoint,
  dropSave,
  openGame,
  pause,
  resume,
  romaFallsTomorrow,
  romaMustersUnderSiege,
  sackedMediolanum,
  sixSpearmenMusterTomorrow,
  storesAtTheirLimits,
  weakSiegeOfMediolanum,
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
}

/** Rome's army stands on the city's symbol, so the click goes to its province 40 km south. */
async function openMediolanum(page: Page) {
  const at = cityPoint('mediolanum');
  const point = camera(page).screen({ x: at.x, y: at.y + 40 });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('city-name')).toHaveText('Mediolanum');
}

export default defineScenario({
  name: 'news',
  title:
    'What the page tells of stores, cities, and sieges: grouped alerts, an early muster, a sacked city, stores at their limits, a siege too weak to starve its city, and a defeated player watching on',
  async run({ page, shot }) {
    await openGame(page);
    const alerts = page.getByTestId('alerts');

    await load(page, sixSpearmenMusterTomorrow());
    await resume(page);
    await alerts.getByTestId('alert-count').filter({ hasText: '×6' }).waitFor();
    await pause(page);
    await shot(
      'grouped-alert',
      'Six formations of spearmen mustered at Roma on one day: one alert line with ×6',
    );

    await load(page, romaMustersUnderSiege());
    await resume(page);
    await alerts.getByText(/mustered its recruits early/).waitFor();
    await pause(page);
    await shot(
      'early-muster',
      'Carthage besieges Roma, and Roma musters its recruits at once: the alert says the city cannot fall or be stormed while they stand',
    );

    await load(page, sackedMediolanum());
    await openMediolanum(page);
    await shot(
      'city-sacked',
      'Mediolanum thirty days after Rome sacked it: the city panel gives its gold and harvest a day, and how long it yields half its gold',
    );

    await load(page, storesAtTheirLimits());
    await page.getByTestId('store-food-note').waitFor();
    await shot(
      'top-bar-limits',
      'The top bar with Rome\'s food and manpower at their limits: "Granaries full" and "At the call-up limit", with the reason on hover',
    );

    await load(page, weakSiegeOfMediolanum());
    await openMediolanum(page);
    await page.getByTestId('city-weak-siege').waitFor();
    await shot(
      'weak-siege-city',
      "Mediolanum's city panel under a siege of 600 spearmen: too few to starve it, and how many more men the blockade needs",
    );
    await page.getByRole('button', { name: 'Overview' }).click();
    await page
      .getByTestId('overview')
      .getByRole('button', { name: /Besieging Mediolanum/ })
      .click();
    await page.getByTestId('army-weak-siege').waitFor();
    await shot('weak-siege-army', 'The besieging army panel says the same in plain words');

    await load(page, romaFallsTomorrow());
    await resume(page);
    const defeat = page.getByTestId('defeat');
    await defeat.waitFor();
    await defeat.getByRole('button', { name: 'Watch on' }).click();
    await defeat.waitFor({ state: 'detached' });
    await pause(page);
    await shot(
      'watching-on',
      'Rome has fallen and the player watches on: the top bar says the realm has fallen, no store alerts, and every army on the map shows',
    );
  },
});
