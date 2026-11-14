import { expect, type Page } from '@playwright/test';
import {
  dropSave,
  fiveFleetsOnRoma,
  mediolanumFallsTomorrow,
  nextDay,
  openGame,
  pause,
  resume,
  untilDrawn,
  worldNewsTomorrow,
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

export default defineScenario({
  name: 'world-news',
  title:
    "News of the world and of invasions: a fallen capital out of sight, a city near Rome's land in the chronicle, five fleets in one line, and a fate chosen in a paused game",
  async run({ page, shot }) {
    await openGame(page);
    const alerts = page.getByTestId('alerts');

    await load(page, worldNewsTomorrow());
    await resume(page);
    await alerts.getByText(/the capital of Carthage, fell to Egypt/).waitFor();
    await pause(page);
    await shot(
      'world-news-corner',
      "Egypt takes Carthago far out of Rome's sight: the corner tells it, in muted italic beside Rome's own news",
    );
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await page
      .getByTestId('chronicle')
      .getByText(/Mediolanum fell to Macedon/)
      .waitFor();
    await shot(
      'world-news-chronicle',
      'The chronicle also keeps the fall of Mediolanum to Macedon, 306 km from Rome, which the corner leaves out',
    );
    await page.getByRole('button', { name: 'Chronicle' }).click();

    await load(page, fiveFleetsOnRoma());
    await resume(page);
    await alerts.getByText(/5 fleets of Carthage/).waitFor();
    await pause(page);
    await shot(
      'five-fleets',
      'Five Punic fleets come into sight on one day: one line, "5 fleets of Carthage with 2,129 men are sailing for Roma"',
    );

    // A save of the day Mediolanum fell, so the fate prompt opens on a game that is paused.
    await load(page, nextDay(mediolanumFallsTomorrow()));
    const prompt = page.getByTestId('fate-prompt');
    await prompt.waitFor();
    await prompt.getByTestId('fate-sack').click();
    await page.getByTestId('notice').waitFor();
    await page.getByRole('button', { name: 'Overview' }).click();
    await page
      .getByTestId('overview-cities')
      .getByRole('button', { name: /^Mediolanum/ })
      .click();
    await page.getByTestId('city-fate-ordered').waitFor();
    await shot(
      'fate-ordered',
      'Sack chosen while the game is paused: the notice says when it happens, and the city panel shows the sack ordered for the next day in place of the choices',
    );
  },
});
