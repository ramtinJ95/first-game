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

test('back-to-back capture screenshots each wait for their own still frame', async ({
  page,
}, testInfo) => {
  await openGame(page, { query: 'draw=full' });
  await pause(page);
  await untilDrawn(page);
  const shots = ['a.png', 'b.png', 'c.png'].map((name) => testInfo.outputPath(name));
  for (const shot of shots) await stillScreenshot(page, shot);
  const [first, ...rest] = shots.map((shot) => readFileSync(shot).toString('base64'));
  for (const shot of rest) expect(shot).toBe(first);
});

test('a map without the still pose, as a pinned historical build draws, is shot as it draws', async ({
  page,
}, testInfo) => {
  await openGame(page, { query: 'draw=full' });
  await untilDrawn(page);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
    if (canvas) delete canvas.dataset['stillPose'];
  });
  const shot = testInfo.outputPath('historical.png');
  await stillScreenshot(page, shot);
  expect(readFileSync(shot).length).toBeGreaterThan(0);
  expect(
    await page.evaluate(
      () => document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset['still'],
    ),
  ).toBeUndefined();
});
