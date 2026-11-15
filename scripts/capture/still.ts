import type { Page } from '@playwright/test';

let requests = 0;

/**
 * Takes a screenshot with the map in its still pose, the `data-still` request in
 * src/render/renderer.ts, and with CSS animations settled. Two captures of one view then
 * match pixel for pixel, so publishing can leave out what a pull request did not change.
 * The renderer answers each request by its own token, so an answer to an earlier shot
 * cannot pass for this one. A pinned historical build has no still pose and is shot as it
 * draws.
 */
export async function stillScreenshot(page: Page, path: string): Promise<void> {
  const token = String(++requests);
  const requested = await page.evaluate((token) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
    if (!canvas?.dataset['stillPose']) return false;
    canvas.dataset['still'] = token;
    return true;
  }, token);
  try {
    if (requested) {
      await page.waitForFunction(
        (token) =>
          document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset[
            'drawnStill'
          ] === token,
        token,
      );
    }
    await page.screenshot({ path, animations: 'disabled' });
  } finally {
    if (requested) {
      await page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
        if (canvas) delete canvas.dataset['still'];
      });
    }
  }
}
