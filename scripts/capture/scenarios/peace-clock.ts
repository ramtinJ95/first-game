import { expect } from '@playwright/test';
import {
  camera,
  carthageDemandsPeace,
  dropSave,
  openGame,
  pause,
  resume,
  siegeToEndInPeace,
  startGame,
  untilDrawn,
} from '../../../e2e/support.ts';
import { saveGame } from '../../../src/sim/save.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'peace-clock',
  title:
    'An offer waits for the player with the game paused, names the cheaper counter, and the panels say how wars start and when the game stops',
  viewport: { width: 1280, height: 900 },
  async run({ page, shot }) {
    await openGame(page);
    const panel = page.getByTestId('wars-panel');
    const speed = page.getByTestId('time-controls-speed');
    async function show(state: GameState, wars: boolean) {
      await pause(page);
      await dropSave(
        page,
        saveGame(state, {
          paused: true,
          ...(wars ? { panel: 'wars' } : {}),
          chronicle: [],
          occupied: [],
          told: [],
          weakSieges: [],
        }),
      );
      await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
        'data-day',
        String(state.day),
      );
      await untilDrawn(page);
    }

    await show(carthageDemandsPeace(), false);
    await resume(page);
    await expect(panel.getByTestId('peace-counter')).toBeVisible();
    await expect(speed).toHaveText('Paused');
    await shot(
      'offer-counter',
      "Carthage's demand stops the game; the offer names the cheaper terms Carthage would take and sends them in one click",
    );

    await page.getByRole('button', { name: 'Overview' }).click();
    await expect(page.getByTestId('overview')).toBeVisible();
    await expect(speed).toHaveText('Paused');
    await shot(
      'overview-offer-paused',
      'Overview opens over the wars panel while the offer waits, and the clock stays paused',
    );

    await show(siegeToEndInPeace(), true);
    await panel.getByLabel('Carthage pays you').check();
    await panel.getByTestId('peace-gold').fill('3000');
    await expect(panel.getByTestId('peace-verdict')).toHaveText(
      'Carthage would refuse. It would give terms worth 2 points less, such as 200 gold less.',
    );
    await panel.getByTestId('offer-peace').click();
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText('Carthage refused your offer of peace');
    await pause(page);
    await expect(page.getByTestId('alerts')).toContainText('It would give terms worth');
    await shot(
      'winner-refusal',
      'Rome is winning and asks Carthage for 3,000 gold; the refusal, in the panel and the news, says Carthage would give 200 less',
    );

    await show(startGame(), true);
    await expect(panel.getByTestId('wars-at-peace')).toBeVisible();
    await shot('wars-at-peace', 'The wars panel at peace says how a war starts and how it ends');

    await panel.getByRole('button', { name: 'Close' }).click();
    const city = camera(page).city('mediolanum');
    await page.mouse.click(city.x, city.y);
    const cityPanel = page.getByTestId('city-panel');
    await cityPanel.getByRole('button', { name: 'Declare war on Mediolanum' }).click();
    await expect(cityPanel.getByTestId('war-consequences')).toBeVisible();
    await shot('war-confirmation', 'The war confirmation lists what a declaration sets in motion');

    await page.getByRole('button', { name: 'Guide', exact: true }).click();
    const pauses = page.getByTestId('guide-pauses');
    await pauses.scrollIntoViewIfNeeded();
    await expect(pauses).toContainText('Your city is besieged, in danger, or falls');
    await shot(
      'guide-pauses',
      'The guide lists every stop the Game menu sets, own sieges and fallen cities included',
    );
  },
});
