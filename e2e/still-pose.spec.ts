import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { stillScreenshot } from '../scripts/capture/still.ts';
import { openGame, pause, untilDrawn } from './support.ts';

test('two capture screenshots of a paused view match pixel for pixel while the swell moves', async ({
  page,
}, testInfo) => {
  await openGame(page, { query: 'draw=full' });
  await pause(page);
  await untilDrawn(page);
  const drawnFrames = () =>
    page.evaluate(() =>
      Number(
        document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset['drawnFrames'],
      ),
    );

  const first = testInfo.outputPath('first.png');
  await stillScreenshot(page, first);
  const after = (await drawnFrames()) + 5;
  await page.waitForFunction(
    (frames) =>
      Number(
        document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset['drawnFrames'],
      ) >= frames,
    after,
  );
  const second = testInfo.outputPath('second.png');
  await stillScreenshot(page, second);

  expect(readFileSync(second).equals(readFileSync(first))).toBe(true);
});
