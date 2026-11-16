import { expect } from '@playwright/test';
import {
  carthageNearsWar,
  dropSave,
  openGame,
  pause,
  resume,
  untilDrawn,
} from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'war-warning-pause',
  title: "A great power's first warning of a coming war stops the game, as a city in danger does",
  async run({ page, shot }) {
    await openGame(page, { pauses: true });
    const state = carthageNearsWar();
    await pause(page);
    await dropSave(page, state);
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day),
    );
    await untilDrawn(page);
    await resume(page);
    const warning = page
      .getByTestId('alerts')
      .getByRole('listitem')
      .filter({ hasText: /could soon declare war on you/ });
    await expect(warning.getByTestId('alert-paused')).toBeVisible();
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day + 1),
    );
    await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
    await untilDrawn(page);
    await shot(
      'war-warning-paused',
      "Carthage's warning stops the game on the day it comes, marked Paused, with the Wars button counting the threat",
    );
  },
});
