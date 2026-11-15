import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';
import drawing from '../data/map/drawing-coast.json' with { type: 'json' };
import { atlasCoast, atlasLand } from '../src/render/atlas-coast.ts';
import { coastalSurface, fitCoastalSprite } from '../src/render/coastal-ground.ts';
import { Land } from '../src/render/terrain/marks.ts';
import { mapToScreen, screenToMap } from '../src/render/camera.ts';
import { BANNER } from '../src/render/markers.ts';
import { factionColour } from '../src/render/palette.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import { locate } from '../src/sim/world/find-path.ts';
import { provinceAt } from '../src/render/pick.ts';
import { contains, distanceToBoundary } from '../scripts/map/geometry.ts';
import { mapPlane } from '../scripts/map/projection.ts';
import type { Point } from '../src/sim/map.ts';
import type { ProvinceId } from '../src/sim/ids.ts';
import type { Pick as MapPick } from '../src/render/pick.ts';
import { pageData } from '../src/app/page.ts';
import { saveGame } from '../src/sim/save.ts';
import { camera, map, openGame, pause, startGame, untilDrawn } from './support.ts';
import { armyOf, rome } from './support.ts';
import { loadSave } from './watch.ts';

type FenceControl = { hold: boolean; polls: number; restore(): void };

test('a held frame keeps its completed coast until the new atlas/widest view can draw', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openGame(page);
  await pause(page);
  await camera(page).jumpTo({ x: 3540, y: 2989 }, 4);
  const canvas = page.locator('canvas[data-renderer]');
  await expect(canvas).toHaveAttribute('data-terrain', 'ready');
  await canvas.evaluate((element) => {
    const gl = (element as HTMLCanvasElement).getContext('webgl2');
    if (!gl) throw new Error('held-pacer regression requires WebGL 2');
    const original = gl.getSyncParameter;
    const control: FenceControl = {
      hold: true,
      polls: 0,
      restore: () => {
        gl.getSyncParameter = original;
      },
    };
    gl.getSyncParameter = function (sync, parameter) {
      if (control.hold && parameter === gl.SYNC_STATUS) {
        control.polls++;
        return gl.UNSIGNALED;
      }
      return original.call(this, sync, parameter);
    };
    (window as unknown as { coastFence: FenceControl }).coastFence = control;
  });
  try {
    for (const [deltaY, coast] of [
      [2000, 'physical'],
      [-2000, 'atlas'],
    ] as const) {
      await page.evaluate(() => {
        const control = (window as unknown as { coastFence: FenceControl }).coastFence;
        control.hold = true;
        control.polls = 0;
      });
      // Submit a frame, then force its fence unsignalled. The following zoom must
      // remain pending without changing the completed frame or its coast.
      await canvas.dispatchEvent('wheel', { deltaY: 0, clientX: 640, clientY: 360 });
      await page.waitForFunction(
        () => (window as unknown as { coastFence: FenceControl }).coastFence.polls > 0,
      );
      const previousCoast = await canvas.getAttribute('data-coast');
      const previousZoom = await canvas.getAttribute('data-zoom');
      await canvas.evaluate((element, deltaY) => {
        (window as unknown as { coastFence: FenceControl }).coastFence.polls = 0;
        element.dispatchEvent(new WheelEvent('wheel', { deltaY, clientX: 640, clientY: 360 }));
      }, deltaY);
      await page.waitForFunction(
        () => (window as unknown as { coastFence: FenceControl }).coastFence.polls > 0,
      );
      await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
      expect(errors).toEqual([]);
      expect(await canvas.getAttribute('data-coast')).toBe(previousCoast);
      expect(await canvas.getAttribute('data-zoom')).toBe(previousZoom);
      await page.evaluate(() => {
        (window as unknown as { coastFence: FenceControl }).coastFence.hold = false;
      });
      await expect(canvas).toHaveAttribute('data-coast', coast);
      await expect
        .poll(async () => Number(await canvas.getAttribute('data-zoom')) >= 0.6)
        .toBe(coast === 'atlas');
    }
  } finally {
    await page.evaluate(() => {
      const control = (window as unknown as { coastFence: FenceControl }).coastFence;
      control.hold = false;
      control.restore();
    });
  }
});

test('a cold figure sheet keeps a coastal fallback banner visible, dry and pickable', async ({
  page,
}) => {
  const physical = new Land(map),
    art = atlasLand(map),
    world = buildWorld(map);
  const near = mapPlane().toPlane([20.8375, 39.0935]);
  let point: { x: number; y: number } | undefined;
  for (let dx = -8; dx <= 8 && !point; dx++)
    for (let dy = -8; dy <= 8; dy++) {
      const p = { x: near[0] + dx, y: near[1] + dy };
      if (physical.open(p.x, p.y) && !art.inside(p.x, p.y) && locate(world.mesh, p, 'land') >= 0) {
        point = p;
        break;
      }
    }
  if (!point) throw new Error('no physical-land/drawn-water coastal fixture');
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    let first = true;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (first) {
        first = false;
        await new Promise<void>((done) => Reflect.set(window, 'releaseCoastSheet', done));
      }
    };
  });
  await openGame(page, { query: 'hide=fog' });
  await pause(page);
  const state = startGame(),
    army = armyOf(state, rome);
  army.activity = { kind: 'idle', position: point };
  await loadSave(page, state);
  const view = camera(page);
  let returned = false;
  const move = view.jumpTo(point, 2).then(() => {
    returned = true;
  });
  try {
    await page.waitForFunction(() => Reflect.has(window, 'releaseCoastSheet'));
    const canvas = page.locator('canvas[data-renderer]');
    await expect(canvas).toHaveAttribute('data-zoom', '2.0000');
    expect(returned).toBe(false);
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport');
    const land = coastalSurface(
      () => art,
      (p) => screenToMap(view.camera, viewport, p),
      physical.land,
    );
    const at = mapToScreen(view.camera, viewport, point);
    expect(land(at)).toBe(false);
    const fitted = fitCoastalSprite(
      { key: 'standard.0', ...at, size: 0, mirror: false, alpha: 1, rotation: 0, depth: at.y },
      land,
      2,
    );
    expect(land(fitted)).toBe(true);
    const image = PNG.sync.read(await canvas.screenshot());
    const colour = factionColour(state, army.owner);
    let pixels = 0;
    for (
      let y = Math.ceil(fitted.y - BANNER.pole + 1);
      y < fitted.y - BANNER.pole + BANNER.flagHeight - 1;
      y++
    )
      for (let x = Math.ceil(fitted.x + 2); x < fitted.x + BANNER.flagWidth - 5; x++) {
        const offset = (y * image.width + x) * 4;
        if (
          Math.abs((image.data[offset] ?? -255) - ((colour >> 16) & 255)) < 3 &&
          Math.abs((image.data[offset + 1] ?? -255) - ((colour >> 8) & 255)) < 3 &&
          Math.abs((image.data[offset + 2] ?? -255) - (colour & 255)) < 3
        )
          pixels++;
      }
    expect(pixels).toBeGreaterThan(4);
    await page.mouse.click(fitted.x + BANNER.flagWidth - 2, fitted.y - BANNER.pole + 2);
    await expect(page.getByTestId('army-name')).toHaveText(army.name);
  } finally {
    await page.evaluate(() => {
      (Reflect.get(window, 'releaseCoastSheet') as () => void)();
    });
    await move;
  }
});

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
    [4, 'atlas'],
    [0.15824, 'physical'],
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
