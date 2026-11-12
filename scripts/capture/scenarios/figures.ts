import { gaitSvg, plateSvg } from '../../../src/render/figures/plate.ts';
import { POWER_COLOURS } from '../../../src/render/palette.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'figures',
  title:
    'The plate of figures: the six troops, the general, and a transport ship, at ease, marching, and fighting, in the colours of Rome and Macedon',
  viewport: { width: 1280, height: 720 },
  async run({ page, shot }) {
    const svg = plateSvg([POWER_COLOURS.rome, POWER_COLOURS.macedon]);
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#ecdfbf">${svg}</body></html>`,
    );
    const page2 = (svg: string) =>
      page.setContent(
        `<!doctype html><html><body style="margin:0;background:#ecdfbf">${svg}</body></html>`,
      );
    await shot(
      'plate',
      'The figures drawn by the same SVG code the map rasterises: spearmen, swordsmen, skirmishers, archers, light and heavy cavalry, the general, and a transport',
    );
    await page2(plateSvg([POWER_COLOURS.rome, POWER_COLOURS.macedon], ['run', 'fall', 'march']));
    await shot(
      'plate-broken-fallen',
      'The same figures broken and running, fallen, and, for comparison, marching',
    );
    await page2(gaitSvg(POWER_COLOURS.carthage));
    await shot(
      'plate-gaits',
      'Every frame of the walk and the gallop of the heavy and the light horse',
    );
  },
});
