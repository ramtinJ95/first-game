import { expect } from '@playwright/test';
import {
  carthageDemandsPeace,
  dropSave,
  openGame,
  pause,
  resume,
  untilDrawn,
} from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'truce-bought',
  title:
    'At war with a Carthage that holds Capua, Rome sends the one-click suggestion, and the truce the news tells is the one its line named',
  async run({ page, shot }) {
    await openGame(page);
    const state = carthageDemandsPeace();
    await pause(page);
    await dropSave(page, state);
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day),
    );
    await untilDrawn(page);
    await page.getByTestId('wars-button').click();
    const wars = page.getByTestId('wars-panel');
    const choice = wars.getByTestId('peace-choice').filter({ hasText: 'The least Carthage takes' });
    const line = await choice.getByTestId('peace-choice-truce').textContent();
    const until = /until (Year \d+, day \d+)\.$/.exec(line ?? '')?.[1];
    if (!until) throw new Error(`the suggestion names no truce: "${line}"`);
    await shot(
      'truce-bought-suggestion',
      'The one-click suggestion names the truce it buys under its own button; the written form below still says what nothing changing hands buys',
    );
    await choice.getByRole('button').click();
    await resume(page);
    await expect(page.getByTestId('alerts')).toContainText(`The truce holds until ${until}`);
    await pause(page);
    await expect(wars.getByText(/^Truce with Carthage:/)).toBeVisible();
    await shot(
      'truce-bought-news',
      'The news of the peace and the wars panel name the same last day of the truce as the suggestion did',
    );
  },
});
