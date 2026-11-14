import { pause, startGame } from '../../../e2e/support.ts';
import { currentHelpers, withBaseline } from '../baseline.ts';
import { defineScenario, type CaptureContext } from '../scenario.ts';

const BEFORE = '24630b8d14926a302800b50b25491d56630ee83c';
export const COAST_NAME_VIEWS = [
  { name: 'delta', title: 'Nile delta shore', at: { x: 4053, y: 3616 } },
  { name: 'azov', title: 'Sea of Azov', at: { x: 4423, y: 1890 } },
  { name: 'aegean', title: 'Aegean islands', at: { x: 3540, y: 2989 } },
  { name: 'bosporus', title: 'Bosporus', at: { x: 3850, y: 2526 } },
  { name: 'atlantic', title: 'Atlantic shore by Olisipo', at: { x: 684, y: 2171 } },
  { name: 'sand', title: 'Village names on sand', at: { x: 4050, y: 3795 } },
  { name: 'forest', title: 'Village names in Gaul', at: { x: 1960, y: 1500 } },
  { name: 'farmland', title: 'Village names in Italy', at: { x: 2545, y: 2360 } },
] as const;

async function views(
  { page, shot }: CaptureContext,
  stage: string,
  base = '',
  helpers = currentHelpers,
) {
  await helpers.openGame(page, { base });
  await pause(page);
  await helpers.loadSave(page, startGame());
  const view = helpers.camera(page);
  for (const { name, title, at } of COAST_NAME_VIEWS) {
    await view.jumpTo(at, 4);
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset['zoom'],
        ) === 4,
    );
    await page.locator('canvas[data-terrain="ready"]').waitFor({ timeout: 60_000 });
    await page.waitForTimeout(250);
    await shot(`${stage}-${name}`, `${stage}: ${title}, same day 1 at 4 px/km`);
    await view.jumpTo(at, 0.1);
  }
}

export default defineScenario({
  name: 'coast-names',
  title: 'Natural sea shores and readable village names, before and after',
  async run(context) {
    await withBaseline(BEFORE, (base, helpers) => views(context, 'before', base, helpers));
    await views(context, 'after');
  },
});
