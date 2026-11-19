import { expect, test, type Page } from '@playwright/test';
import { REDRAW_CAUSES, type RedrawCause } from '../src/render/redraw.ts';
import {
  camera,
  cityPoint,
  dropSave,
  openGame,
  pause,
  playDays,
  resizeTo,
  startGame,
  untilDrawn,
} from './support.ts';
import { tradingRome } from './trade-game.ts';

/**
 * How many screen frames after the input the frame that shows it may start. The page
 * draws in its next animation frame, which runs one or two screen frames after the input,
 * depending on where in the frame the input lands.
 */
const NEXT_FRAME = 2;
/** Screen frames of a still, paused map in which no frame may start. */
const UNTOUCHED_SCREENS = 180;

test.use({ viewport: { width: 1280, height: 720 } });

/** The frames the map has sent the GPU and those it has finished, and the unnamed ones. */
function counts(page: Page) {
  return page.evaluate(() => {
    const data = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset;
    return {
      submitted: Number(data?.['submittedFrames']),
      drawn: Number(data?.['drawnFrames']),
      unnamed: Number(data?.['unnamedFrames']),
    };
  });
}

/**
 * Waits until the map has finished every frame it started, its terrain is built, and it
 * has started no frame for `quiet` screen frames.
 */
async function untilStill(page: Page, quiet = 20) {
  await page.waitForFunction(
    (quiet) => {
      const data = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset;
      const seen = window as unknown as { stillAt?: string; stillScreens?: number };
      const now = `${data?.['submittedFrames']}/${data?.['drawnFrames']}`;
      if (seen.stillAt !== now) {
        seen.stillAt = now;
        seen.stillScreens = 0;
      } else seen.stillScreens = (seen.stillScreens ?? 0) + 1;
      return (
        data?.['submittedFrames'] === data?.['drawnFrames'] &&
        data?.['terrain'] === 'ready' &&
        data['figureSheets'] !== 'busy' &&
        seen.stillScreens >= quiet
      );
    },
    quiet,
    { polling: 'raf', timeout: 60_000 },
  );
}

/** Counts the screen frames from now and gives the frames the map started in them. */
function framesOver(page: Page, screens: number) {
  return page.evaluate(
    (screens) =>
      new Promise<{ started: number; because: string }>((done) => {
        const data = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset;
        const start = Number(data?.['submittedFrames']);
        let left = screens;
        const count = () => {
          if (--left > 0) requestAnimationFrame(count);
          else
            done({
              started: Number(data?.['submittedFrames']) - start,
              because: data?.['submittedBecause'] ?? '',
            });
        };
        requestAnimationFrame(count);
      }),
    screens,
  );
}

interface FirstFrame {
  /** Screen frames from the input's event to the first frame the map started after it. */
  screens: number;
  because: string[];
}

/**
 * Does `act`, whose input reaches the page as the window event `event`, and gives the
 * first frame the map started after it and how many screen frames after the event.
 */
async function firstFrameAfter(page: Page, event: string, act: () => Promise<unknown>) {
  await page.evaluate((event) => {
    const data = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset;
    const watch = window as unknown as { firstFrame?: FirstFrame };
    delete watch.firstFrame;
    const start = Number(data?.['submittedFrames']);
    let screens: number | undefined;
    addEventListener(event, () => (screens ??= 0), { capture: true, once: true });
    const count = () => {
      if (screens !== undefined) screens++;
      if (Number(data?.['submittedFrames']) > start) {
        watch.firstFrame = {
          screens: screens ?? -1,
          because: (data?.['submittedBecause'] ?? '').split(' '),
        };
      } else requestAnimationFrame(count);
    };
    requestAnimationFrame(count);
  }, event);
  await act();
  const frame = await page.waitForFunction(
    () => (window as unknown as { firstFrame?: FirstFrame }).firstFrame,
  );
  return (await frame.jsonValue()) as FirstFrame;
}

async function expectDrawnAtOnce(frame: FirstFrame, cause: RedrawCause) {
  expect(frame.because, REDRAW_CAUSES[cause]).toContain(cause);
  expect(frame.screens, 'screen frames from the input to its frame').toBeGreaterThanOrEqual(0);
  expect(frame.screens, 'screen frames from the input to its frame').toBeLessThanOrEqual(
    NEXT_FRAME,
  );
}

/** A paused game at the whole map, still. */
async function pausedGame(page: Page) {
  await openGame(page);
  await pause(page);
  await page.mouse.move(0, 0);
  await untilStill(page);
  return camera(page);
}

/** A paused game at the middle zoom over Roma, still. */
async function pausedOverRoma(page: Page, query = '') {
  await openGame(page, { query });
  await pause(page);
  const view = camera(page);
  await view.jumpTo(cityPoint('roma'), 1);
  await page.mouse.move(0, 0);
  await untilStill(page);
  return view;
}

test.describe('a paused game', () => {
  test.afterEach(async ({ page }) => {
    expect((await counts(page)).unnamed, 'frames drawn for no named cause').toBe(0);
  });

  for (const selected of [false, true]) {
    test(`left untouched at the middle zoom with ${selected ? 'Roma' : 'nothing'} selected draws no frame, in the full drawing`, async ({
      page,
    }) => {
      test.slow();
      const view = await pausedOverRoma(page, 'draw=full');
      if (selected) {
        const at = view.city('roma');
        await page.mouse.click(at.x, at.y);
        await expect(page.getByTestId('city-name')).toHaveText('Roma');
        await page.mouse.move(0, 0);
        await untilStill(page);
      }
      const over = await framesOver(page, UNTOUCHED_SCREENS);
      expect(over.started, `frames started, the last because: ${over.because}`).toBe(0);
    });
  }

  test("a zoom in over Capua's caravans and Roma's ships, once drawn, holds still with nothing left to finish, in the full drawing", async ({
    page,
  }) => {
    test.slow();
    await openGame(page, { query: 'draw=full' });
    await pause(page);
    const state = tradingRome();
    await dropSave(page, state);
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day),
    );
    await untilDrawn(page);
    const view = camera(page);
    await view.jumpTo(
      { x: (cityPoint('roma').x + cityPoint('capua').x) / 2, y: cityPoint('roma').y },
      1,
    );
    await page.mouse.move(0, 0);
    await untilStill(page);
    await view.zoom({ x: 640, y: 360 }, 3);
    await page.mouse.move(0, 0);
    await untilStill(page);
    const over = await framesOver(page, UNTOUCHED_SCREENS);
    expect(
      over.started,
      `frames started after the view was still, the last because: ${over.because}`,
    ).toBe(0);
  });

  test('draws a pan and a zoom in the next frame', async ({ page }) => {
    const view = await pausedGame(page);
    const centre = { x: 640, y: 360 };
    await page.mouse.move(centre.x, centre.y);
    await page.mouse.down();
    await untilStill(page);
    const pan = await firstFrameAfter(page, 'pointermove', () =>
      page.mouse.move(centre.x - 100, centre.y - 60, { steps: 4 }),
    );
    await page.mouse.up();
    await expectDrawnAtOnce(pan, 'camera');
    await untilDrawn(page);
    await untilStill(page);
    const zoom = await firstFrameAfter(page, 'wheel', () => view.zoom(centre, 1));
    await expectDrawnAtOnce(zoom, 'camera');
    await untilStill(page);
  });

  test('draws nothing for a hover, which changes nothing on the map', async ({ page }) => {
    await pausedGame(page);
    const before = await counts(page);
    const hovered = framesOver(page, 60);
    for (const [x, y] of [
      [300, 200],
      [640, 360],
      [900, 500],
      [640, 380],
    ] as const) {
      await page.mouse.move(x, y, { steps: 5 });
    }
    expect((await hovered).started).toBe(0);
    expect((await counts(page)).drawn).toBe(before.drawn);
  });

  test('draws a selection and its clearing in the next frame', async ({ page }) => {
    const view = await pausedGame(page);
    const roma = view.city('roma');
    const select = await firstFrameAfter(page, 'pointerup', () => page.mouse.click(roma.x, roma.y));
    await expectDrawnAtOnce(select, 'selection');
    await expect(page.getByTestId('city-name')).toHaveText('Roma');
    await untilStill(page);
    const clear = await firstFrameAfter(page, 'keydown', () => page.keyboard.press('Escape'));
    await expectDrawnAtOnce(clear, 'selection');
    await expect(page.getByTestId('city-panel')).toHaveCount(0);
    await untilStill(page);
  });

  test('opens and closes a panel over a map that stays drawn', async ({ page }) => {
    await pausedGame(page);
    const overview = page.getByRole('button', { name: 'Overview', exact: true });
    const open = framesOver(page, 30);
    await overview.click();
    await expect(page.getByTestId('overview')).toBeVisible();
    await untilStill(page);
    await overview.click();
    await expect(page.getByTestId('overview')).toHaveCount(0);
    await untilStill(page);
    expect((await open).started, 'a panel over the map changes no pixel of it').toBe(0);
  });

  test('draws a resize of the window in the next frame', async ({ page }) => {
    await pausedGame(page);
    const resized = await firstFrameAfter(page, 'resize', () =>
      resizeTo(page, { width: 1024, height: 640 }),
    );
    await expectDrawnAtOnce(resized, 'camera');
    await untilStill(page);
  });

  test('draws an order given while paused in the next frame', async ({ page }) => {
    await openGame(page);
    await pause(page);
    const view = camera(page);
    const flag = view.banner(cityPoint('roma'));
    await page.mouse.click(flag.x, flag.y);
    await expect(page.getByTestId('army-activity')).toHaveText('Idle at Roma');
    await untilStill(page);
    const capua = view.city('capua');
    const order = await firstFrameAfter(page, 'contextmenu', () =>
      page.mouse.click(capua.x, capua.y, { button: 'right' }),
    );
    await expectDrawnAtOnce(order, 'planned');
    await expect(page.getByTestId('orders-waiting')).toBeVisible();
    await untilStill(page);
  });

  test('draws a loaded save in the next frame after the page reads it', async ({ page }) => {
    await pausedGame(page);
    const state = playDays(startGame(), 3);
    const loaded = await firstFrameAfter(page, 'drop', () => dropSave(page, state));
    expect(loaded.because).toContain('state');
    await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
      'data-day',
      String(state.day),
    );
    await untilDrawn(page);
    await untilStill(page);
  });

  test('draws a new game from the start screen in the next frame', async ({ page }) => {
    await openGame(page);
    await pause(page);
    await untilStill(page);
    await page.getByRole('button', { name: 'Game', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Start screen' }).click();
    await page.getByRole('button', { name: 'Leave without saving' }).click();
    const started = await firstFrameAfter(page, 'click', () =>
      page.getByTestId('power-carthage').click(),
    );
    await expectDrawnAtOnce(started, 'state');
    await untilDrawn(page);
  });

  test('draws one frame when paused and holds still, and the swell moves again once resumed, in the full drawing', async ({
    page,
  }) => {
    test.slow();
    await openGame(page, { query: 'draw=full' });
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
      const seen = window as unknown as { causes: string[] };
      seen.causes = [];
      if (!canvas) return;
      new MutationObserver(() => {
        seen.causes.push(canvas.dataset['submittedBecause'] ?? '');
      }).observe(canvas, { attributeFilter: ['data-submitted-frames'] });
    });
    const causes = () =>
      page.evaluate(() => (window as unknown as { causes: string[] }).causes.join(' ').split(' '));
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await untilStill(page);
    expect(await causes()).toContain('clock');
    expect((await framesOver(page, 60)).started).toBe(0);
    await page.evaluate(() => ((window as unknown as { causes: string[] }).causes = []));
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect.poll(causes).toContain('swell');
  });
});
