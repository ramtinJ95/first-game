import { expect } from '@playwright/test';
import {
  carthageDeclaresWar,
  dropSave,
  openGame,
  pause,
  resizeTo,
  resume,
  untilDrawn,
} from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'war-declared',
  title:
    'A great power that declares war on the player stops the game, with the forces it weighed and what to do first, and has its own Game menu switch, at 1280 × 720',
  async run({ page, shot }) {
    await openGame(page, { pauses: true });
    await resizeTo(page, { width: 1280, height: 720 });
    const state = carthageDeclaresWar();
    await pause(page);
    await dropSave(page, state);
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day),
    );
    await untilDrawn(page);
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    const declared = page
      .getByTestId('alerts')
      .getByRole('listitem')
      .filter({
        hasText:
          /^.*Carthage declared war on you, its armies ready against your forces near Roma\. First march your armies to Roma, or raise men: /,
      });
    await expect(declared.getByTestId('alert-paused')).toBeVisible();
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day + 1),
    );
    await untilDrawn(page);
    await shot(
      'war-declared-1280',
      "1280 × 720: Carthage's declaration of war stops the game, marked Paused, naming Roma, whose forces it weighed, and the men to raise first",
    );
    await page.getByRole('button', { name: 'Game', exact: true }).click();
    await expect(page.getByTestId('pause-declared')).toBeChecked();
    await untilDrawn(page);
    await shot(
      'war-declared-switch-1280',
      '1280 × 720: the Game menu turns the stop for a declaration of war off, on by default',
    );
  },
});
