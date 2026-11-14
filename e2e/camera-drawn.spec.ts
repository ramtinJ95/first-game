import { expect, test } from '@playwright/test';
import { planCommand } from '../src/app/command.ts';
import { buildWorld } from '../src/sim/world/world.ts';
import {
  armyOf,
  camera,
  idleBesideEnemyCity,
  map,
  openGame,
  pause,
  rome,
  untilDrawn,
} from './support.ts';
import { loadSave } from './watch.ts';

test.use({ storageState: { cookies: [], origins: [] } });

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
});
test.afterEach(() => expect(errors).toEqual([]));

test('the order-paths close-up waits for its first sheet and keeps a pickable flag meanwhile', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const decode = HTMLImageElement.prototype.decode;
    let first = true;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (first) {
        first = false;
        await new Promise<void>((done) => {
          Reflect.set(window, 'releaseSheet', done);
        });
      }
    };
  });
  await openGame(page);
  await pause(page);
  const state = idleBesideEnemyCity('mediolanum');
  await loadSave(page, state);
  const view = camera(page);
  const army = armyOf(state, rome);
  if (army.activity.kind !== 'idle') throw new Error('no idle army');
  const position = army.activity.position;
  let returned = false;
  const move = view.jumpTo(position, 2).then(() => {
    returned = true;
  });
  const canvas = page.getByTestId('map');
  await expect(canvas).toHaveAttribute('data-zoom', '2.0000');
  await page.waitForFunction(() => Reflect.has(window, 'releaseSheet'));
  expect(returned).toBe(false);
  const pending = await canvas.evaluate((element) => ({
    latest: Number(element.dataset['latestView']),
    drawn: Number(element.dataset['drawnView']),
  }));
  expect(pending.drawn).toBeLessThan(pending.latest);
  const flag = view.banner(position);
  await page.mouse.click(flag.x, flag.y);
  await expect(page.getByTestId('army-name')).toHaveText('First Legion');
  await page.keyboard.press('Escape');

  await page.evaluate(() => {
    const release = Reflect.get(window, 'releaseSheet') as () => void;
    release();
  });
  await move;
  const centred = view.banner(position);
  await page.mouse.click(centred.x, centred.y);
  await expect(page.getByTestId('army-name')).toHaveText('First Legion');
  await expect(page.getByTestId('army-besiege')).toBeVisible();
});

for (const scale of [0.6, 2]) {
  for (const movement of ['zoom', 'pan'] as const) {
    test(`${movement} followed by a click before drawing still picks the visible army at ${scale} px/km`, async ({
      page,
    }) => {
      await openGame(page);
      await pause(page);
      const state = idleBesideEnemyCity('mediolanum');
      await loadSave(page, state);
      const view = camera(page);
      const army = armyOf(state, rome);
      if (army.activity.kind !== 'idle') throw new Error('no idle army');
      await view.jumpTo(army.activity.position, scale);
      const point = view.banner(army.activity.position);
      // Verify that the target really selects the visible army before moving the camera.
      await page.mouse.click(point.x, point.y);
      await expect(page.getByTestId('army-name')).toHaveText('First Legion');
      await page.keyboard.press('Escape');
      await page.mouse.move(point.x, point.y);
      await page.mouse.down();
      // One task makes the input/frame ordering deterministic; the real mouse press
      // provides an active pointer, so pointer capture follows the player's path too.
      await page.locator('canvas').evaluate(
        (canvas, { point, movement }) => {
          const pointer = (type: string, x = point.x, y = point.y) =>
            canvas.dispatchEvent(
              new PointerEvent(type, {
                clientX: x,
                clientY: y,
                pointerId: 1,
                button: 0,
                buttons: 1,
                bubbles: true,
              }),
            );
          if (movement === 'zoom') {
            canvas.dispatchEvent(
              new WheelEvent('wheel', {
                clientX: 800,
                clientY: 500,
                deltaY: -800,
                bubbles: true,
                cancelable: true,
              }),
            );
          } else {
            pointer('pointermove', point.x + 150, point.y);
            pointer('pointerup', point.x + 150, point.y);
            pointer('pointerdown');
          }
          pointer('pointerup');
        },
        { point, movement },
      );
      await page.mouse.up();
      await expect(page.getByTestId('army-name')).toHaveText('First Legion');
    });
  }
}

test('a right click during a held GPU frame orders the visible map point, not the pending view', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let held = false;
    Reflect.set(window, 'holdGpu', (value: boolean) => {
      held = value;
    });
    const original = WebGL2RenderingContext.prototype.getSyncParameter;
    WebGL2RenderingContext.prototype.getSyncParameter = function (sync, name) {
      if (held && name === this.SYNC_STATUS) {
        document.querySelector('canvas')?.setAttribute('data-test-gpu-held', 'yes');
        return this.UNSIGNALED;
      }
      return original.call(this, sync, name);
    };
  });
  await openGame(page);
  await pause(page);
  const state = idleBesideEnemyCity('mediolanum');
  await loadSave(page, state);
  const army = armyOf(state, rome);
  if (army.activity.kind !== 'idle') throw new Error('no idle army');
  const position = army.activity.position;
  const view = camera(page);
  await view.jumpTo(position, 0.6);
  const flag = view.banner(position);
  await page.mouse.click(flag.x, flag.y);
  await expect(page.getByTestId('army-name')).toHaveText('First Legion');
  const target = { x: position.x + 100, y: position.y + 100 };
  const plan = planCommand(state, buildWorld(map), army, { kind: 'point', point: target });
  if (plan.kind !== 'issue') throw new Error('expected a march into open land');
  const screen = view.screen(target);
  await page.evaluate(() => {
    const hold = Reflect.get(window, 'holdGpu') as (value: boolean) => void;
    hold(true);
  });
  const canvas = page.getByTestId('map');
  await canvas.evaluate((element) =>
    element.dispatchEvent(
      new WheelEvent('wheel', {
        clientX: 800,
        clientY: 500,
        deltaY: 600,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await expect(canvas).toHaveAttribute('data-test-gpu-held', 'yes');
  await expect(canvas).toHaveAttribute('data-zoom', '0.6000');
  await canvas.evaluate(
    (element, point) =>
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          clientX: point.x,
          clientY: point.y,
          button: 2,
          bubbles: true,
          cancelable: true,
        }),
      ),
    screen,
  );
  await expect(page.getByTestId('notice')).toHaveText(plan.info);
  await page.evaluate(() => {
    const hold = Reflect.get(window, 'holdGpu') as (value: boolean) => void;
    hold(false);
  });
  await untilDrawn(page);
  await expect(canvas).not.toHaveAttribute('data-zoom', '0.6000');
});
