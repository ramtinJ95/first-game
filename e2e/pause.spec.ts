import { expect, test, type Page } from '@playwright/test';
import { day, openGame } from './support.ts';

/**
 * Presses Space in the frame in which a new day reaches the map, the moment a late pause
 * would show, and gives the day the top bar showed when the key went down.
 */
function spaceAsADayTurns(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((done) => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
        const first = canvas?.dataset['latestState'];
        const check = () => {
          if (canvas?.dataset['latestState'] === first) return requestAnimationFrame(check);
          const shown = document
            .querySelector('[data-testid="time-controls-day"]')
            ?.getAttribute('data-day');
          window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space' }));
          window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space' }));
          done(Number(shown));
        };
        requestAnimationFrame(check);
      }),
  );
}

for (const query of ['', 'draw=full']) {
  test(`at speed 3 Space pauses on the day the top bar shows (${query || 'draw=test'})`, async ({
    page,
  }) => {
    await openGame(page, { query });
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    const speed = page.getByTestId('time-controls-speed');
    for (let press = 0; press < 3; press++) {
      const shown = await spaceAsADayTurns(page);
      await expect(speed).toHaveText('Paused');
      expect(await day(page)).toBe(shown);
      await page.keyboard.press('Space');
      await expect(speed).toHaveText('Speed 3');
    }
  });
}
