import { expect } from '@playwright/test';
import {
  carthageNearsWar,
  dropSave,
  openGame,
  pause,
  resume,
  untilDrawn,
} from '../../../e2e/support.ts';
import { THREAT_STAND_DAYS } from '../../../src/app/threat-news.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'war-warning-pause',
  title:
    "A great power's first warning of a coming war stops the game once its strength has stood a week, and names the day it may declare",
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
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    const warning = page
      .getByTestId('alerts')
      .getByRole('listitem')
      .filter({ hasText: /could soon declare war on you/ });
    await expect(warning.getByTestId('alert-paused')).toBeVisible();
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day + THREAT_STAND_DAYS),
    );
    await expect(page.getByText('Paused', { exact: true }).first()).toBeVisible();
    await untilDrawn(page);
    await shot(
      'war-warning-paused',
      "Carthage's warning stops the game once its strength has stood a week, marked Paused and naming the day it may declare, with the Wars button counting the threat",
    );
  },
});
