import { expect, test, type Page } from '@playwright/test';
import { paymentBetween, peaceWish } from '../src/sim/ai/peace.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { standingOffer } from '../src/sim/peace/offer.ts';
import type { Day } from '../src/sim/state/day.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { newWar, warKey } from '../src/sim/state/war.ts';
import {
  carthageDemandsPeace,
  dropSave,
  nextDay,
  openGame,
  pause,
  resume,
  untilDrawn,
} from './support.ts';

const rome = 'rome' as FactionId;
const carthage = 'carthage' as FactionId;
const macedon = 'macedon' as FactionId;

/**
 * Carthage's demand, with an older war on Macedon listed first in the panel. Macedon
 * offered lately, so it makes no offer of its own.
 */
function behindAnotherWar(): GameState {
  const state = carthageDemandsPeace();
  const carthageWar = state.wars[warKey(rome, carthage)];
  if (!carthageWar) throw new Error('no war with Carthage');
  const war = newWar(macedon, rome, (carthageWar.since - 1) as Day);
  war.offeredOn = state.day;
  state.wars[warKey(rome, macedon)] = war;
  return state;
}

/** Loads the demand's eve, resumes, and waits for the offer that stops the game. */
async function offerWaits(page: Page, state = carthageDemandsPeace()) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
  await resume(page);
  const panel = page.getByTestId('wars-panel');
  await expect(panel.getByTestId('their-offer')).toBeVisible();
  await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
  const day = await page.getByTestId('time-controls-day').getAttribute('data-day');
  return { panel, day };
}

/** The clock still shows the offer's day and no day has run since. */
async function stillPaused(page: Page, day: string | null) {
  await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', day ?? '');
}

test.describe('the clock waits for the player while an offer of peace waits', () => {
  test.beforeEach(async ({ page }) => {
    await openGame(page);
  });

  test('closing the wars panel with the × leaves the game paused', async ({ page }) => {
    const { panel, day } = await offerWaits(page);
    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toHaveCount(0);
    await stillPaused(page, day);
    await page.getByRole('button', { name: /^Wars/ }).click();
    await expect(page.getByTestId('their-offer')).toBeVisible();
  });

  test('refusing leaves the game paused until the player resumes it', async ({ page }) => {
    const { panel, day } = await offerWaits(page);
    await panel.getByTestId('refuse-peace').click();
    await expect(panel.getByTestId('peace-answered')).toBeVisible();
    await stillPaused(page, day);
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('You refused peace with Carthage');
  });

  test('Overview opens over the wars panel and the game stays paused', async ({ page }) => {
    const { day } = await offerWaits(page);
    await page.getByRole('button', { name: 'Overview' }).click();
    await expect(page.getByTestId('overview')).toBeVisible();
    await expect(page.getByTestId('wars-panel')).toHaveCount(0);
    await stillPaused(page, day);
    await page
      .getByTestId('overview-wars')
      .getByRole('button', { name: /At war with Carthage/ })
      .click();
    await expect(page.getByTestId('their-offer')).toBeVisible();
    await stillPaused(page, day);
  });

  test('a demand above what Carthage would take offers the cheaper counter in one click', async ({
    page,
  }) => {
    const offered = nextDay(carthageDemandsPeace());
    const asked = standingOffer(offered, rome, carthage)?.terms;
    const need = -(peaceWish(offered, carthage, rome)?.wish ?? 0);
    const least = paymentBetween(offered, rome, carthage, need, Number.POSITIVE_INFINITY, 'least');
    if (asked?.kind !== 'payment' || least?.kind !== 'payment')
      throw new Error('Carthage should ask Rome for gold');
    expect(least.gold).toBeLessThan(asked.gold);

    const { panel, day } = await offerWaits(page);
    const counter = panel.getByTestId('peace-counter');
    await expect(counter).toContainText('Carthage asks more than it would take.');
    await expect(counter).toContainText(
      `it would accept peace in which you give ${least.gold.toLocaleString('en')} gold`,
    );
    await counter.getByTestId('send-counter').click();
    await expect(panel.getByTestId('our-offer')).toContainText(
      `You offer Carthage peace: you give ${least.gold.toLocaleString('en')} gold.`,
    );
    await stillPaused(page, day);
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('Peace with Carthage');
  });

  for (const answer of ['refuse', 'counter'] as const) {
    test(`with an older war listed first, the ${answer} stays on Carthage's war`, async ({
      page,
    }) => {
      const { panel, day } = await offerWaits(page, behindAnotherWar());
      const war = panel.getByTestId('war-row');
      await expect(panel.getByTestId('war-tab').first()).toHaveText('Macedon');
      await expect(war).toHaveAttribute('data-enemy', 'carthage');
      if (answer === 'refuse') {
        await panel.getByTestId('refuse-peace').click();
        await expect(panel.getByTestId('peace-answered')).toBeVisible();
      } else {
        await panel.getByTestId('send-counter').click();
        await expect(panel.getByTestId('our-offer')).toBeVisible();
      }
      await expect(war).toHaveAttribute('data-enemy', 'carthage');
      await stillPaused(page, day);
    });
  }
});
