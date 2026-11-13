import type { Page } from '@playwright/test';

/** How long the clip waits for one frame before it gives up on it. */
export const CLIP_FRAME_MS = 5_000;

/** The two things the clip asks of a page. */
export type ClipPage = Pick<Page, 'waitForFunction' | 'screenshot'>;

/**
 * One frame of the clip, or nothing. A screenshot asked for while a page is loading,
 * before its map has drawn, can wait out its whole timeout, and the page's own shots
 * queue behind it. So the clip waits for a drawn map and gives up on a frame that is
 * not ready in CLIP_FRAME_MS, which a clip can spare.
 */
export async function clipFrame(
  page: ClipPage,
  timeout = CLIP_FRAME_MS,
): Promise<Buffer | undefined> {
  try {
    await page.waitForFunction(
      () =>
        new Promise<boolean>((done) => {
          if (!document.querySelector('canvas[data-renderer]')) done(false);
          else requestAnimationFrame(() => done(true));
        }),
      undefined,
      { timeout },
    );
    return await page.screenshot({ timeout });
  } catch {
    return undefined;
  }
}
