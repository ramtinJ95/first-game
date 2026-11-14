import { camera, openGame, pause, startGame } from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { withBaseline } from '../baseline.ts';
import { defineScenario, type CaptureContext } from '../scenario.ts';

const BEFORE = 'bfb56179a57b5878f26bd297cc0420a30e2e889c';
export const NATURAL_VIEWS = [
  { name: 'gaul', title: 'Open Gaul south of Lutetia', at: { x: 1960, y: 1500 } },
  { name: 'italy', title: 'Farmland east of Roma', at: { x: 2545, y: 2360 } },
  { name: 'delta', title: 'The Nile delta', at: { x: 4070, y: 3620 } },
  { name: 'anatolia', title: 'Anatolia east of Ankyra', at: { x: 4220, y: 2660 } },
  { name: 'plateau', title: 'The Persian plateau north of Persepolis', at: { x: 6080, y: 3330 } },
  { name: 'steppe', title: 'The steppe north-east of Olbia', at: { x: 4370, y: 1750 } },
  { name: 'iberia', title: 'The Iberian interior south of Numantia', at: { x: 1340, y: 2160 } },
  { name: 'tatta', title: 'Lake Tatta (Tuz)', at: { x: 4228, y: 2765 } },
  { name: 'urmia', title: 'Lake Urmia', at: { x: 5265, y: 2762 } },
  { name: 'garda', title: 'Lake Garda', at: { x: 2444, y: 1897 } },
] as const;

export async function captureNaturalViews(
  { page, shot }: CaptureContext,
  stage: string,
  base = '',
) {
  await openGame(page, { base });
  await pause(page);
  await loadSave(page, startGame());
  const view = camera(page);
  for (const { name, title, at } of NATURAL_VIEWS) {
    await view.jumpTo(at, 4);
    await page.waitForFunction(
      () =>
        Math.abs(
          Number(
            document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset['zoom'],
          ) - 4,
        ) < 0.001,
    );
    await page.locator('canvas[data-terrain="ready"]').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(250);
    await shot(`${stage}-${name}`, `${stage}: ${title}, closest zoom, the same day-1 view`);
    await view.jumpTo(at, 0.1);
  }
}

export default defineScenario({
  name: 'map-natural',
  title:
    'Natural shores, varied relief, and all seven regions at the closest zoom, before and after',
  async run(context) {
    await withBaseline(BEFORE, (base) => captureNaturalViews(context, 'before', base));
    await captureNaturalViews(context, 'after');
  },
});
