import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { GameState } from '../src/sim/state/game-state.ts';
import { newWar, warKey } from '../src/sim/state/war.ts';
import type { FactionId } from '../src/sim/ids.ts';
import { executeOrder } from '../src/sim/orders/orders.ts';
import { fixtureWorld } from '../src/sim/fixture.ts';
import { peaceStanding, stalePeaceForecast } from './peace-support.ts';
import { risingPeacePrice, winningSecondFront } from './peace-support.ts';
import { saveGame } from '../src/sim/save.ts';
import type { Day } from '../src/sim/state/day.ts';
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

  for (const enemy of ['mediolanum', 'macedon'] as const) {
    test(`an unaffordable ${enemy} verdict uses a readable capitalized name`, async ({ page }) => {
      const state = peaceStanding(enemy, 2);
      const faction = state.factions[enemy as FactionId];
      if (!faction) throw new Error('fixture');
      faction.stores.gold = 416;
      await load(page, state);
      await page.getByTestId('wars-button').click();
      const panel = page.getByTestId('wars-panel');
      await panel.getByLabel(`${faction.name} pays you`).check();
      await panel.getByTestId('peace-gold').fill('900');
      await expect(panel.getByTestId('peace-verdict')).toHaveText(
        `These terms cannot be met: ${faction.name} has 416 gold, not the 900 the terms ask.`,
      );
    });
  }

  test('makes peace through the wars panel: a refusal explained, an accepted offer, the siege lifted, and a truce', async ({
    page,
  }) => {
    await load(page, siegeToEndInPeace());
    const panel = await openWars(page);
    const war = panel.getByTestId('war-row');
    await expect(war).toHaveAttribute('data-enemy', 'carthage');
    await expect(war.getByTestId('war-summary')).toHaveText('The war goes your way (+35)');
    await expect(war).toContainText('You besiege Carthago.');

    await panel.getByLabel('Carthage pays you').check();
    await panel.getByTestId('peace-gold').fill('3000');
    await expect(panel.getByTestId('peace-verdict')).toHaveText(
      'Carthage would refuse. It wants terms worth 2 points more, such as 200 gold more.',
    );
    await expect(panel).toContainText('Carthage is losing the war +35');
    await expect(panel).toContainText('Carthage does not end a war for nothing -15');
    await expect(panel.getByTestId('peace-forecast-warning')).toContainText(
      'This forecast may change',
    );

    // Play the refusal, not just its forecast, and find the same reason in the Chronicle.
    await panel.getByTestId('offer-peace').click();
    await expect(panel.getByTestId('offer-peace')).toBeDisabled();
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('Carthage refused your offer of peace');
    await pause(page);
    await expect(page.getByTestId('alerts')).toContainText(/It wants terms worth \d+ points more/);
    await panel.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await expect(page.getByTestId('chronicle')).toContainText(
      /Carthage refused your offer of peace.*It wants terms worth \d+ points more/,
    );
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await openWars(page);

    await panel.getByRole('button', { name: 'Send offer — Peace as things stand' }).click();
    await expect(panel.getByTestId('offer-peace')).toBeDisabled();
    await expect(panel.getByTestId('our-offer')).toHaveText(
      'You offer Carthage peace as things stand. Carthage hears it with the next day.',
    );

    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText(
      /Peace with Carthage as things stand\. The truce holds until Year \d+, day \d+/,
    );
    await pause(page);
    await expect(panel.getByTestId('truce-row')).toHaveText(
      /^Truce with Carthage: \d+ days left\./,
    );
    await expect(panel.getByTestId('war-row')).toHaveCount(0);

    await panel.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Overview' }).click();
    const armies = page.getByTestId('overview-armies');
    await expect(armies).not.toContainText('Besieging');
    await expect(armies).toContainText(/Gathering ships|At sea|Marching/);

    await page.getByRole('button', { name: 'Overview' }).click();
    const view = camera(page);
    const carthago = view.city('carthago');
    await page.mouse.click(carthago.x, carthago.y);
    const city = page.getByTestId('city-panel');
    await expect(city.getByTestId('truce')).toHaveText(
      /A truce with Carthage holds for \d+ more days\. Neither side may declare war until Year \d+, day \d+\./,
    );
    await expect(city.getByRole('button', { name: /Declare war/ })).toHaveCount(0);
  });

  test('one click on the suggested payment really sends it, without a second Send click', async ({
    page,
  }) => {
    await load(page, siegeToEndInPeace());
    const panel = await openWars(page);
    const choice = panel.getByRole('button', {
      name: /Send offer — The most Carthage gives: Carthage gives you 2,800 gold/,
    });
    await choice.click();
    await expect(panel.getByTestId('our-offer')).toHaveText(
      'You offer Carthage peace: Carthage gives you 2,800 gold. Carthage hears it with the next day.',
    );
    await expect(choice).toBeDisabled();
    await expect(panel.getByTestId('offer-peace')).toBeDisabled();
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText(
      'Peace with Carthage: Carthage gives you 2,800 gold',
    );
  });

  test('an incoming price shows the current treasury and its rise, with the conquest named in panel and news', async ({
    page,
  }) => {
    const fixture = risingPeacePrice();
    await pause(page);
    await dropSave(page, fixture.save);
    const panel = page.getByTestId('wars-panel');
    await expect(panel.getByTestId('peace-funds')).toHaveText(
      'You hold 8,940 gold. You can pay the 5,100 gold asked.',
    );
    await expect(panel.getByTestId('peace-price-rise')).toContainText(
      'last time you give 4,500 gold; now you give 5,100 gold',
    );
    await expect(panel.getByTestId('peace-price-rise')).toContainText('it took Capua');
    await expect(panel.getByTestId('accept-peace')).toBeEnabled();
    await expect(panel).toContainText('Carthage declared it on Year 2, day 21');
    await expect(page.getByTestId('alerts')).toContainText('You hold 8,940 gold');
    await expect(page.getByTestId('alerts')).toContainText('The price rose');
    await expect(page.getByTestId('alerts')).toContainText('it took Capua');
  });

  test('an offer no longer affordable says the shortfall and cannot be accepted', async ({
    page,
  }) => {
    const fixture = risingPeacePrice(8900);
    const treasury = fixture.state.factions[fixture.state.player];
    if (!treasury) throw new Error('fixture');
    treasury.stores.gold = 8800;
    await load(page, fixture.state);
    const panel = page.getByTestId('wars-panel');
    await expect(panel.getByTestId('peace-funds')).toHaveText(
      'You hold 8,800 gold. You need 100 gold more to pay the 8,900 asked.',
    );
    await expect(panel.getByTestId('accept-peace')).toBeDisabled();
    await expect(panel.getByTestId('refuse-peace')).toBeEnabled();
    treasury.stores.gold = -20.4;
    await load(page, fixture.state);
    await expect(panel.getByTestId('peace-funds')).toHaveText(
      'Your treasury is -21 gold. You need 8,921 gold more to pay the 8,900 asked.',
    );
    await expect(panel.getByTestId('accept-peace')).toBeDisabled();
  });

  test('a winning second-front AI explains its discount, but still refuses free early peace', async ({
    page,
  }) => {
    await load(page, winningSecondFront());
    const panel = await openWars(page);
    await expect(panel).toContainText('Carthage is also at war with Egypt +15');
    await expect(panel.getByTestId('peace-verdict')).toContainText('such as 100 gold more');
  });

  test('peace-talk and truce deadlines already use the shared year/day form', async ({ page }) => {
    const state = winningSecondFront();
    const carthage = 'carthage' as FactionId;
    state.wars = { [warKey(state.player, carthage)]: newWar(carthage, state.player, 885 as Day) };
    state.day = 900 as Day;
    await load(page, state);
    const panel = await openWars(page);
    await expect(panel.getByTestId('peace-verdict')).toHaveText(
      'Carthage will not talk of peace before Year 3, day 215.',
    );
    state.wars = {};
    state.truces[warKey(state.player, carthage)] = { since: 3549 as Day, endsOn: 3914 as Day };
    state.day = 3900 as Day;
    await pause(page);
    await dropSave(
      page,
      saveGame(state, {
        paused: true,
        panel: 'wars',
        chronicle: [],
        occupied: [],
        told: [],
        weakSieges: [],
      }),
    );
    await expect(panel.getByTestId('truce-row')).toContainText('before Year 11, day 264.');
    await expect(panel.getByTestId('truce-row')).not.toContainText('day 3914');
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

  test('an offer queued while paused survives a browser save and reload, then reaches a truce', async ({
    page,
  }) => {
    await load(page, siegeToEndInPeace());
    const panel = await openWars(page);
    await panel.getByTestId('offer-peace').click();
    await page.getByRole('button', { name: 'Game', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Save in this browser' }).click();
    await page.goto('/');
    await page.getByTestId('start-screen').getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
    await expect(panel.getByTestId('our-offer')).toContainText('hears it with the next day');
    await expect(panel.getByTestId('offer-peace')).toBeDisabled();
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('Peace with Carthage as things stand');
    await pause(page);
    await expect(panel.getByTestId('truce-row')).toBeVisible();
  });

  for (const accept of [true, false]) {
    for (const manual of [false, true]) {
      test(`export/load preserves ${manual ? 'manual' : 'offer-owned'} pause before ${accept ? 'accepting' : 'refusing'}`, async ({
        page,
      }) => {
        await load(page, carthageOffersPeace());
        await resume(page);
        const panel = page.getByTestId('wars-panel');
        await expect(panel.getByTestId('peace-paused')).toBeVisible();
        if (manual) {
          await resume(page);
          await pause(page);
        }
        const download = page.waitForEvent('download');
        await page.getByRole('button', { name: 'Game', exact: true }).click();
        await page.getByRole('menuitem', { name: 'Export to a file' }).click();
        const file = await (await download).path();
        if (!file) throw new Error('the exported save was not downloaded');
        const text = readFileSync(file, 'utf8');
        expect(JSON.parse(text).page).toMatchObject({ paused: true, resumeOnClose: !manual });
        await dropSave(page, text);
        await expect(panel.getByTestId('peace-paused')).toBeVisible();
        await panel.getByTestId(accept ? 'accept-peace' : 'refuse-peace').click();
        if (manual) {
          await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
          await resume(page);
        } else {
          await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
        }
        await expect(page.getByTestId('alerts')).toContainText(
          accept ? 'Peace with Carthage' : 'You refused peace with Carthage',
        );
      });
    }

    test(`a manual pause supersedes the offer's automatic pause before ${accept ? 'accepting' : 'refusing'}`, async ({
      page,
    }) => {
      await load(page, carthageOffersPeace());
      await resume(page);
      const panel = page.getByTestId('wars-panel');
      await expect(panel.getByTestId('peace-paused')).toBeVisible();
      // The player deliberately takes ownership of the clock, without advancing a day.
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await panel.getByTestId(accept ? 'accept-peace' : 'refuse-peace').click();
      await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
      await resume(page);
      await expect(page.getByTestId('alerts')).toContainText(
        accept ? 'Peace with Carthage' : 'You refused peace with Carthage',
      );
    });

    test(`${accept ? 'accepting' : 'refusing'} an incoming offer preserves a player pause while another war continues`, async ({
      page,
    }) => {
      const state = carthageOffersPeace();
      const rome = 'rome' as FactionId;
      const carthage = 'carthage' as FactionId;
      const macedon = 'macedon' as FactionId;
      state.wars[warKey(rome, macedon)] = newWar(macedon, rome, state.day);
      expect(
        executeOrder(
          state,
          { kind: 'offerPeace', faction: carthage, to: rome, terms: { kind: 'asThingsStand' } },
          fixtureWorld(),
        ),
      ).toBeUndefined();
      await load(page, state);
      const panel = page.getByTestId('wars-panel');
      await expect(panel.getByTestId('peace-paused')).toBeVisible();
      await panel.getByTestId(accept ? 'accept-peace' : 'refuse-peace').click();
      await expect(page.getByTestId('time-controls-speed')).toHaveText('Paused');
      await page.getByRole('button', { name: 'Overview' }).click();
      await expect(page.getByTestId('overview-wars')).toContainText('At war with Macedon');
      await resume(page);
      await expect(page.getByTestId('alerts')).toContainText(
        accept ? 'Peace with Carthage as things stand' : 'You refused peace with Carthage',
      );
    });
  }

  test('a changed forecast refuses with the battle losses that changed it, including after load', async ({
    page,
  }) => {
    const state = stalePeaceForecast();
    const offer = state.peaceOffers[warKey(state.player, 'macedon' as FactionId)];
    expect(offer?.forecast?.accepts).toBe(true);
    await load(page, state);
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('Macedon refused your offer of peace');
    await pause(page);
    await expect(page.getByTestId('alerts')).toContainText(
      'The forecast changed: battle losses changed',
    );
    await expect(page.getByTestId('alerts')).toContainText('its war standing changed from');
  });
});
