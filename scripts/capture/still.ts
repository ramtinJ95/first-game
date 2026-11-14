import type { Page } from '@playwright/test';

/**
 * Takes a screenshot with the map in its still pose, the `data-still` request in
 * src/render/renderer.ts, and with CSS animations settled. Two captures of one view then
 * match pixel for pixel, so publishing can leave out what a pull request did not change.
 */
export async function stillScreenshot(page: Page, path: string): Promise<void> {
  const hasMap = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
    if (canvas) canvas.dataset['still'] = '';
    return canvas !== null;
  });
  try {
    if (hasMap) {
      await page.waitForFunction(
        () =>
          document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset[
            'drawnStill'
          ] !== undefined,
      );
    }
    await page.screenshot({ path, animations: 'disabled' });
  } finally {
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
      if (canvas) delete canvas.dataset['still'];
    });
  }
}
