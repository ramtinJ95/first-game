import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import { LAYERS } from '../src/render/renderer.ts';
import { routePoint } from '../src/sim/trade/routes.ts';
import { camera, openGame, pause, resizeTo, untilDrawn } from './support.ts';
import { loadSave } from './watch.ts';
import { coastalRome, raidedRome, straitRome, tradeRoute, tradingRome } from './trade-game.ts';

function mapColours(shot: Buffer): number {
  // An unobscured map rectangle, clear of the top bar, city panel and Chronicle.
  const image = PNG.sync.read(shot);
  const colours = new Set<number>();
  for (let y = 100; y < image.height - 120; y++)
    for (let x = 100; x < image.width - 380; x++)
      colours.add(image.data.readUIntBE((y * image.width + x) * 4, 3));
  return colours.size;
}

test('a selected city traces trade, goods label the land, and drawn merchants survive loading', async ({
  page,
}) => {
  await openGame(page);
  await pause(page);
  const state = tradingRome();
  await loadSave(page, state);
  const view = camera(page);
  const roma = view.city('roma');
  await page.mouse.click(roma.x, roma.y);
  await expect(page.getByTestId('city-name')).toHaveText('Roma');
  await view.jumpTo(routePoint(tradeRoute(state, 'land')), 1.2);
  await untilDrawn(page);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-trade-paths', '2');
  await expect(canvas).toHaveAttribute('data-trade-caravans', /[1-9]/);
  await expect(canvas).toHaveAttribute('data-goods', /[1-9]/);
  await page.getByRole('button', { name: 'Guide', exact: true }).click();
  await expect(page.getByTestId('guide-trade')).toContainText('trace its routes on the map');
});

test('a trade ship is a drawn figure at the closest zoom, not a land caravan', async ({ page }) => {
  await openGame(page);
  await pause(page);
  const state = tradingRome();
  await loadSave(page, state);
  const view = camera(page);
  await view.jumpTo(routePoint(tradeRoute(state, 'sea')), 4);
  await untilDrawn(page);
  await expect(page.locator('canvas')).toHaveAttribute('data-trade-ships', /[1-9]/);
});

for (const [name, state, mode] of [
  ['the land caravan nine km from the sea', coastalRome(), 'land'],
  ['the ship at Carthago’s harbour mouth', coastalRome(), 'sea'],
  ['the ship in the Strait of Messina', straitRome(), 'sea'],
] as const)
  test(`${name} finds its surface on the drawn coast at middle and closest zoom`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openGame(page);
    await pause(page);
    await loadSave(page, state);
    const canvas = page.locator('canvas');
    const view = camera(page);
    for (const scale of [1.2, 4]) {
      await view.jumpTo(routePoint(tradeRoute(state, mode)), scale);
      await untilDrawn(page);
      await expect(canvas).toHaveAttribute(
        mode === 'sea' ? 'data-trade-ships' : 'data-trade-caravans',
        /[1-9]/,
      );
    }
    expect(errors).toEqual([]);
  });

test('a loaded road raid is marked at its saved location', async ({ page }) => {
  await openGame(page);
  await pause(page);
  const state = raidedRome();
  await loadSave(page, state);
  const raid = tradeRoute(state, 'land').raid;
  if (!raid) throw new Error('missing raid');
  await camera(page).jumpTo(raid.position, 4);
  await untilDrawn(page);
  await expect(page.locator('canvas')).toHaveAttribute('data-raids', '1');
});

test('retained trade paths survive camera changes and context restoration, and clear on load', async ({
  page,
}, testInfo) => {
  const hide = LAYERS.filter(({ name }) => name !== 'markers')
    .map(({ name }) => name)
    .join(',');
  await openGame(page, { query: `swell=off&hide=${hide}` });
  await pause(page);
  const state = tradingRome();
  await loadSave(page, state);
  const view = camera(page);
  const roma = view.city('roma');
  await page.mouse.click(roma.x, roma.y);
  await expect(page.getByTestId('city-name')).toHaveText('Roma');
  const at = routePoint(tradeRoute(state, 'land'));
  await view.jumpTo(at, 4);
  const canvas = page.locator('canvas');
  await expect(canvas).toHaveAttribute('data-trade-paths', '2');
  await untilDrawn(page);
  const before = await canvas.screenshot();
  expect(mapColours(before)).toBeGreaterThan(1);
  // 100 km west and 50 km north is on the canvas at closest zoom, clear of the city panel.
  await view.jumpTo({ x: at.x - 100, y: at.y - 50 }, 1.2);
  await expect(canvas).toHaveAttribute('data-zoom', '1.2000');
  await untilDrawn(page);
  expect((await canvas.screenshot()).equals(before)).toBe(false);
  await view.jumpTo(at, 4);
  await untilDrawn(page);
  await expect(canvas).toHaveAttribute('data-trade-paths', '2');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  await resizeTo(page, { width: viewport.width + 140, height: viewport.height + 100 });
  expect(mapColours(await canvas.screenshot())).toBeGreaterThan(1);
  await resizeTo(page, viewport);
  // Like coast-cache.spec, finish on an observed zoom-only draw, not a drag's
  // preceding submitted view. A drag can arrive between GPU completion and its poll.
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  await page.mouse.wheel(0, -Math.log(3.9 / 4) / 0.002);
  await expect(canvas).toHaveAttribute('data-zoom', '3.9000');
  await page.mouse.wheel(0, -Math.log(4 / 3.9) / 0.002);
  await expect(canvas).toHaveAttribute('data-zoom', '4.0000');
  const returned = await canvas.screenshot();
  const frames = Number(await canvas.getAttribute('data-drawn-frames'));
  await canvas.evaluate(
    (element) =>
      new Promise<void>((done) => {
        const extension = (element as HTMLCanvasElement)
          .getContext('webgl2')
          ?.getExtension('WEBGL_lose_context');
        if (!extension) throw new Error('WebGL context-loss extension unavailable');
        element.addEventListener('webglcontextrestored', () => done(), { once: true });
        element.addEventListener(
          'webglcontextlost',
          () => requestAnimationFrame(() => extension.restoreContext()),
          { once: true },
        );
        extension.loseContext();
      }),
  );
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-drawn-frames')))
    .toBeGreaterThan(frames);
  const restored = await canvas.screenshot();
  if (!PNG.sync.read(restored).data.equals(PNG.sync.read(returned).data)) {
    await testInfo.attach('before-restore', { body: returned, contentType: 'image/png' });
    await testInfo.attach('after-restore', { body: restored, contentType: 'image/png' });
  }
  expect(PNG.sync.read(restored).data.equals(PNG.sync.read(returned).data)).toBe(true);
  const closed = structuredClone(state);
  closed.tradeRoutes = {};
  await loadSave(page, closed);
  await expect(canvas).toHaveAttribute('data-trade-paths', '0');
  await untilDrawn(page);
  expect(mapColours(await canvas.screenshot())).toBe(1);
});
