import { expect, test } from '@playwright/test';
import { countObjects } from './count-objects.ts';

/**
 * Takes the last round's subtree out of the page and attaches a new one of 51 nodes and
 * a canvas, as a new game replaces the page's top bar after the last count saw the old one.
 */
const NEXT_ROUND = `(() => {
  document.getElementById('round')?.remove();
  const box = document.createElement('div');
  box.id = 'round';
  for (let i = 0; i < 50; i++) box.appendChild(document.createElement('span'));
  box.appendChild(document.createElement('canvas'));
  document.body.appendChild(box);
})()`;

test('counting detached nodes and canvases keeps none of them, and still finds those the page keeps', async ({
  page,
}) => {
  await page.setContent('<!doctype html><body><p>count</p></body>');
  const cdp = await page.context().newCDPSession(page);
  const counts = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    return {
      detached: await countObjects(cdp, 'Node.prototype', '!node.isConnected'),
      canvases: await countObjects(cdp, 'HTMLCanvasElement.prototype', 'true'),
    };
  };

  const rounds = [];
  for (let round = 0; round < 5; round++) {
    await page.evaluate(NEXT_ROUND);
    rounds.push(await counts());
  }
  const [first] = rounds;
  for (const round of rounds) expect(round).toEqual(first);

  await page.evaluate(`window.kept = document.getElementById('round')`);
  await page.evaluate(NEXT_ROUND);
  const kept = await counts();
  expect(kept.detached).toBeGreaterThanOrEqual((first?.detached ?? 0) + 51);
  expect(kept.canvases).toBe((first?.canvases ?? 0) + 1);
});
