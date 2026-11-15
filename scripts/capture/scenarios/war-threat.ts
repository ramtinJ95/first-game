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
  name: 'war-threat',
  title:
    'A Carthage of twelve cities nears the strength it needs to declare war on a Rome whose treasury is full, and the news says so before it comes',
  async run({ page, shot }) {
    await openGame(page);
    const state = carthageNearsWar();
    await pause(page);
    await dropSave(page, state);
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day),
    );
    await untilDrawn(page);
    await resume(page);
    const line = page.getByTestId('alerts').getByText(/could soon declare war on you/);
    await line.waitFor();
    await pause(page);
    await shot(
      'war-threat-corner',
      "Carthage, grown to twelve cities, has most of the strength it needs against Rome's forces near Roma, and Rome's full treasury takes a quarter off what it needs: the corner tells it",
    );
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await page
      .getByTestId('chronicle')
      .getByText(/could soon declare war on you/)
      .waitFor();
    await shot('war-threat-chronicle', 'The chronicle keeps the warning with its numbers');
  },
});
