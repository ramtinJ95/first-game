import { expect, type Page } from '@playwright/test';
import {
  camera,
  carthageOffersPeace,
  cityPoint,
  dropSave,
  openGame,
  pause,
  resizeTo,
  resume,
  romeOnTwoFronts,
  siegeToEndInPeace,
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

async function openWars(page: Page) {
  if (!(await page.getByTestId('overview').isVisible())) {
    await page.getByRole('button', { name: 'Overview' }).click();
  }
  await page.getByTestId('open-wars').click();
  return page.getByTestId('wars-panel');
}

export default defineScenario({
  name: 'peace',
  title:
    'Peace: the wars panel with two wars, an offer refused with its reason, an offer from Carthage, and the map the day after a peace',
  async run({ page, shot }) {
    await openGame(page);

    await load(page, romeOnTwoFronts());
    const panel = await openWars(page);
    await expect(panel.getByTestId('war-tab')).toHaveCount(2);
    await shot(
      'peace-two-wars',
      'Rome in year 2 with five cities, at war with Carthage and Macedon: how the war with Carthage stands, the terms ready to offer with Carthage’s answer to each, and the reckoning behind it',
    );

    await panel.getByTestId('war-tab').filter({ hasText: 'Macedon' }).click();
    await panel.getByLabel('You pay Macedon').check();
    await panel.getByTestId('peace-gold').fill('800');
    await expect(panel.getByTestId('peace-verdict')).toContainText('Macedon would refuse.');
    await shot(
      'peace-refused',
      'An offer of 800 gold to Macedon: Macedon would refuse, wants 16 points more, and lists each reason with its points',
    );

    await resizeTo(page, { width: 390, height: 844 });
    await expect(panel).toBeVisible();
    await shot('peace-narrow', 'The wars panel on a 390 px wide screen');
    await resizeTo(page, { width: 1280, height: 720 });
    await panel.getByRole('button', { name: 'Close' }).click();

    await load(page, carthageOffersPeace());
    await resume(page);
    const prompted = page.getByTestId('wars-panel');
    await prompted.getByTestId('their-offer').waitFor();
    await shot(
      'peace-offer',
      'Carthage offers to pay 1,000 gold for peace: the game pauses, and the panel says what refusing means',
    );
    await prompted.getByTestId('refuse-peace').click();

    await load(page, siegeToEndInPeace());
    const wars = await openWars(page);
    await wars.getByRole('button', { name: 'Peace as things stand' }).click();
    await wars.getByTestId('offer-peace').click();
    await wars.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Overview' }).click();
    const carthago = cityPoint('carthago');
    await camera(page).jumpTo({ x: carthago.x + 10, y: carthago.y - 10 }, 2.2);
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('Peace with Carthage', {
      timeout: 30_000,
    });
    await pause(page);
    await untilDrawn(page);
    await shot(
      'peace-day-after',
      'Just after the peace: the siege camp round Carthago is gone and the Roman army gathers ships on the shore to sail home',
    );
  },
});
