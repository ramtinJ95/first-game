import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { stillScreenshot } from '../scripts/capture/still.ts';
import { openGame, pause, resume, startGame, untilDrawn } from './support.ts';
import { loadSave } from './watch.ts';

test('two capture screenshots of one paused view match pixel for pixel when the swell has moved between them', async ({
  page,
}, testInfo) => {
  const state = startGame();
  await openGame(page, { query: 'draw=full' });
  await page.mouse.move(0, 0);
  await pause(page);
  await loadSave(page, state);
  const first = testInfo.outputPath('first.png');
  await stillScreenshot(page, first);

  // A paused game holds its swell, so the game runs until the swell has stepped, and the
  // same save, loaded again while paused, puts back the state and the view.
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
    const seen = window as unknown as { swelled: boolean };
    seen.swelled = false;
    if (!canvas) return;
    new MutationObserver(() => {
      if (canvas.dataset['submittedBecause']?.split(' ').includes('swell')) seen.swelled = true;
    }).observe(canvas, { attributeFilter: ['data-submitted-frames'] });
  });
  await resume(page);
  await page.waitForFunction(() => (window as unknown as { swelled: boolean }).swelled);
  await pause(page);
  await loadSave(page, state);
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
