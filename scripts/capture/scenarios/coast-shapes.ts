import {
  camera,
  cityPoint,
  crossingToCaralis,
  openGame,
  pause,
  refugeesToCapua,
  siegeOfCarthago,
  startGame,
} from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { COAST_VIEWS } from '../../../e2e/coast-views.ts';
import { withBaseline } from '../baseline.ts';
import { defineScenario, type CaptureContext } from '../scenario.ts';

const BEFORE = 'c02aec7ebaa68132f9add8652b977ce2b57bb028';

async function views({ page, shot }: CaptureContext, stage: string, base = '', load = loadSave) {
  await openGame(page, { base, query: 'hide=fog' });
  await pause(page);
  await load(page, startGame());
  const view = camera(page);
  for (const { name, title, at, scale } of COAST_VIEWS) {
    await view.jumpTo(at, scale);
    await page.waitForFunction(
      (zoom) =>
        Math.abs(
          Number(
            document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset['zoom'],
          ) - zoom,
        ) < 0.001,
      scale,
    );
    await page.locator('canvas[data-terrain="ready"]').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(250);
    await shot(`${stage}-${name}`, `${stage}: ${title}, day 1, ${scale} px/km`);
    await view.jumpTo(at, 0.1);
  }
  const crossing = crossingToCaralis();
  const convoy = Object.values(crossing.convoys).find((c) => c.owner === crossing.player);
  const refugees = refugeesToCapua();
  const column = Object.values(refugees.refugeeColumns)[0];
  if (!convoy || !column) throw new Error('coast ground evidence lacks its convoy or refugees');
  for (const { name, title, state, at } of [
    {
      name: 'siege-ground',
      title: 'Carthage siege camp and harbour',
      state: siegeOfCarthago(),
      at: cityPoint('carthago'),
    },
    {
      name: 'convoy-ground',
      title: 'Convoy crossing to Caralis',
      state: crossing,
      at: convoy.position,
    },
    {
      name: 'refugee-ground',
      title: 'Refugee figures and carts',
      state: refugees,
      at: column.position,
    },
  ]) {
    await load(page, state);
    await view.jumpTo(at, 4);
    await page.locator('canvas[data-terrain="ready"]').waitFor({ timeout: 60_000 });
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset['figures'],
        ) > 0,
    );
    await shot(`${stage}-${name}`, `${stage}: ${title}, 4 px/km, identical physical state`);
    await view.jumpTo(at, 0.1);
  }
}

export default defineScenario({
  name: 'coast-shapes',
  title: 'Real atlas sea coasts, islands and constrained crossings, before and after',
  async run(context) {
    await views(context, 'after');
    await withBaseline(BEFORE, (base, load) => views(context, 'before', base, load));
  },
});
