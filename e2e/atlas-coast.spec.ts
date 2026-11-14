import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import drawing from '../data/map/drawing-coast.json' with { type: 'json' };
import { atlasCoast } from '../src/render/atlas-coast.ts';
import { provinceAt } from '../src/render/pick.ts';
import { contains, distanceToBoundary } from '../scripts/map/geometry.ts';
import { mapPlane } from '../scripts/map/projection.ts';
import type { Point } from '../src/sim/map.ts';
import type { ProvinceId } from '../src/sim/ids.ts';
import type { Pick as MapPick } from '../src/render/pick.ts';
import { pageData } from '../src/app/page.ts';
import { saveGame } from '../src/sim/save.ts';
import { camera, map, openGame, pause, startGame, untilDrawn } from './support.ts';

test('crossing the middle-detail boundary restrokes even within the ordinary stroke zoom tolerance', async ({
  page,
}) => {
  await openGame(page);
  await pause(page);
  const view = camera(page);
  const canvas = page.locator('canvas[data-renderer]');
  const at = { x: 3540, y: 2989 };
  for (const [scale, coast] of [
    [0.59, 'physical'],
    [0.61, 'atlas'],
    [0.59, 'physical'],
  ] as const) {
    await view.jumpTo(at, scale);
    await expect(canvas).toHaveAttribute('data-coast', coast);
    await expect(canvas).toHaveAttribute('data-terrain', 'ready');
  }
});

test('a real offshore island is painted as land but cannot select a province or accept a land order', async ({
  page,
}) => {
  const near = mapPlane().toPlane([12.6, 35.51]);
  const land = atlasCoast(map).land;
  const polygon = drawing.scenery
    .map((p) => land[p])
    .filter((p) => p !== undefined)
    .sort(
      (a, b) =>
        Math.hypot((a[0]?.[0]?.[0] ?? Infinity) - near[0], (a[0]?.[0]?.[1] ?? Infinity) - near[1]) -
        Math.hypot((b[0]?.[0]?.[0] ?? Infinity) - near[0], (b[0]?.[0]?.[1] ?? Infinity) - near[1]),
    )[0];
  if (!polygon) throw new Error('no offshore scenery island');
  const outer = polygon[0];
  if (!outer) throw new Error('island has no outer ring');
  const minX = Math.min(...outer.map((p) => p[0])),
    maxX = Math.max(...outer.map((p) => p[0]));
  const minY = Math.min(...outer.map((p) => p[1])),
    maxY = Math.max(...outer.map((p) => p[1]));
  let centre: Point | undefined,
    depth = -1;
  for (let i = 1; i < 20; i++)
    for (let j = 1; j < 20; j++) {
      const p: Point = [minX + ((maxX - minX) * i) / 20, minY + ((maxY - minY) * j) / 20];
      const d = distanceToBoundary([polygon], p);
      if (contains([polygon], p) && d > depth) {
        depth = d;
        centre = p;
      }
    }
  if (!centre) throw new Error('island has no interior');
  const at = { x: centre[0], y: centre[1] };
  expect(provinceAt(map, at)).toBeUndefined();
  await openGame(page, { query: 'hide=fog' });
  await pause(page);
  const state = startGame();
  const army = Object.values(state.armies).find((a) => a.owner === state.player);
  if (!army) throw new Error('no player army');
  const show = async (selection: MapPick) => {
    // Load the exact camera through the supported save API. A native wheel anchor
    // can quantize a fractional client coordinate, magnifying it at close zoom.
    const text = saveGame(
      state,
      pageData({
        paused: true,
        chronicle: [],
        camera: { centre: at, scale: 4 },
        selection,
        panel: undefined,
        occupied: new Map(),
        told: new Set(),
        weakSieges: new Map(),
      }),
    );
    const transfer = await page.evaluateHandle((text) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], 'coast-camera.json', { type: 'application/json' }));
      return transfer;
    }, text);
    await page.dispatchEvent('canvas', 'drop', { dataTransfer: transfer });
    await untilDrawn(page);
  };
  await show({ kind: 'province', province: 'roma' as ProvinceId });
  await expect(page.getByTestId('city-panel')).toBeVisible();
  const canvas = page.locator('canvas[data-renderer]');
  await expect(canvas).toHaveAttribute('data-coast', 'atlas');
  await expect(canvas).toHaveAttribute('data-terrain', 'ready');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const screen = { x: viewport.width / 2, y: viewport.height / 2 };
  const image = PNG.sync.read(await canvas.screenshot());
  const pixel = (Math.round(screen.y) * image.width + Math.round(screen.x)) * 4;
  expect((image.data[pixel] ?? 0) - (image.data[pixel + 2] ?? 0)).toBeGreaterThan(25);
  await page.mouse.click(screen.x, screen.y);
  await expect(page.getByTestId('city-panel')).toHaveCount(0);
  await show({ kind: 'army', army: army.id });
  await expect(page.getByTestId('army-panel')).toBeVisible();
  await page.mouse.click(screen.x, screen.y, { button: 'right' });
  await expect(page.getByTestId('notice')).toHaveText(
    'Order refused. The destination is in the sea.',
  );
});
