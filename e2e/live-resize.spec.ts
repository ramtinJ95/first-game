import { expect, test } from '@playwright/test';
import { framePace, openGame, pause, resizeTo, untilDrawn } from './support.ts';

/**
 * The most of its own frames the map may take to follow a resize. A frame the GPU has in
 * hand when the window changes, and the first at the new size, are about three. Redrawing
 * every cached layer at the new size in that frame took seven to eight.
 */
const FOLLOW_FRAMES = 5;

test.use({ viewport: { width: 1280, height: 720 } });

for (const paused of [true, false]) {
  test(`a resize from 1280 to 1024 px ${paused ? 'while paused' : 'while running'} redraws the map at the window's size within a few frames, and the top bar stays on the page`, async ({
    page,
  }) => {
    // The full drawing draws every frame, so its frames are the page's pace.
    await openGame(page, { query: 'draw=full' });
    await untilDrawn(page);
    const pace = await framePace(page);
    if (paused) await pause(page);

    const screens = await resizeTo(page, { width: 1024, height: 768 });
    expect(screens / pace, `${screens} screen frames at ${pace} a drawn frame`).toBeLessThanOrEqual(
      FOLLOW_FRAMES,
    );

    const canvas = await page.locator('canvas[data-renderer]').boundingBox();
    expect(canvas).toMatchObject({ width: 1024, height: 768 });
    const bar = await page.getByTestId('top-bar').boundingBox();
    if (!bar) throw new Error('no top bar');
    expect(bar.x + bar.width).toBeLessThanOrEqual(1024);
    await page.getByRole('button', { name: 'Game', exact: true }).click();
    await expect(page.getByTestId('save-menu')).toBeVisible();
  });
}
