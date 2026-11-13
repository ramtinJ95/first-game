import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/sim/state/game-state.ts';
import {
  camera,
  carthageOffersPeace,
  dropSave,
  openGame,
  pause,
  resume,
  siegeToEndInPeace,
  untilDrawn,
} from './support.ts';

async function load(page: Page, state: GameState) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

async function openWars(page: Page) {
  await page.getByRole('button', { name: 'Overview' }).click();
  await page
    .getByTestId('overview-wars')
    .getByRole('button', { name: /At war with Carthage/ })
    .click();
  return page.getByTestId('wars-panel');
}

test.describe('peace', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
  });

  test('makes peace through the wars panel: a refusal explained, an accepted offer, the siege lifted, and a truce', async ({
    page,
  }) => {
    await load(page, siegeToEndInPeace());
    const panel = await openWars(page);
    const war = panel.getByTestId('war-row');
    await expect(war).toHaveAttribute('data-enemy', 'carthage');
    await expect(war.getByTestId('war-summary')).toHaveText('The war goes your way (+20)');
    await expect(war).toContainText('You besiege Carthago.');

    await panel.getByLabel('Carthage pays you').check();
    await panel.getByTestId('peace-gold').fill('1500');
    await expect(panel.getByTestId('peace-verdict')).toHaveText(
      'Carthage would refuse. It wants terms worth 2 points more, such as 200 gold more.',
    );
    await expect(panel).toContainText('Carthage is losing the war +20');
    await expect(panel).toContainText('Carthage does not end a war for nothing -15');

    await panel.getByRole('button', { name: 'Peace as things stand' }).click();
    await expect(panel.getByTestId('peace-verdict')).toHaveText('Carthage would accept.');
    await panel.getByTestId('offer-peace').click();
    await expect(panel.getByTestId('our-offer')).toHaveText(
      'You offer Carthage peace as things stand. Carthage hears it with the next day.',
    );

    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText(
      /Peace with Carthage as things stand\. The truce holds until day \d+/,
    );
    await pause(page);
    await expect(panel.getByTestId('truce-row')).toHaveText(
      /^Truce with Carthage: \d+ days left\./,
    );
    await expect(panel.getByTestId('war-row')).toHaveCount(0);

    await panel.getByRole('button', { name: 'Close' }).click();
    const armies = page.getByTestId('overview-armies');
    await expect(armies).not.toContainText('Besieging');
    await expect(armies).toContainText(/Gathering ships|At sea|Marching/);

    await page.getByRole('button', { name: 'Overview' }).click();
    const view = camera(page);
    const carthago = view.city('carthago');
    await page.mouse.click(carthago.x, carthago.y);
    const city = page.getByTestId('city-panel');
    await expect(city.getByTestId('truce')).toHaveText(
      /A truce with Carthage holds for \d+ more days\. Neither side may declare war until day \d+\./,
    );
    await expect(city.getByRole('button', { name: /Declare war/ })).toHaveCount(0);
  });

  test("receives Carthage's offer, which pauses the game, and refuses it", async ({ page }) => {
    const state = carthageOffersPeace();
    await load(page, state);
    await resume(page);
    const panel = page.getByTestId('wars-panel');
    await expect(panel.getByTestId('peace-paused')).toHaveText(
      'The game is paused for your answer.',
    );
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible();
    const offer = panel.getByTestId('their-offer');
    await expect(offer).toContainText('Carthage offers peace: Carthage gives you 1,000 gold.');
    await expect(offer).toContainText(
      'Refuse, and the war goes on. Carthage makes no new offer for 90 days.',
    );
    await offer.getByTestId('refuse-peace').click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId('alerts')).toContainText(
      'You refused peace with Carthage, and the war goes on',
    );
    await page.getByRole('button', { name: 'Overview' }).click();
    await expect(page.getByTestId('overview-wars')).toContainText('At war with Carthage');
  });
});
