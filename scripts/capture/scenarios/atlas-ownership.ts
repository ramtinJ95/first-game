import { map, openGame, pause, startGame, untilDrawn } from '../../../e2e/support.ts';
import { decideAll } from '../../../src/sim/ai/decide.ts';
import { tick } from '../../../src/sim/tick.ts';
import { buildWorld } from '../../../src/sim/world/world.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { withBaseline } from '../baseline.ts';
import { defineScenario } from '../scenario.ts';

const BEFORE = 'bfb56179a57b5878f26bd297cc0420a30e2e889c';

export default defineScenario({
  name: 'atlas-ownership',
  title:
    'The full atlas on day 1 and ten years in: the same seeded games before and after the ownership change',
  async run({ page, shot }) {
    const opening = startGame();
    const world = buildWorld(map);
    let decade = opening;
    for (let i = 0; i < 3650; i++) decade = tick(decade, decideAll(decade, world, []), world).state;
    // Observe the same surviving power at both dates; every power actually played.
    const observer = Object.values(decade.factions).find(
      (f) => f.kind === 'greatPower' && f.defeatedOn == null,
    );
    if (!observer) throw new Error('ten-year campaign has no surviving power');
    opening.player = observer.id;
    decade.player = observer.id;
    const views = async (stage: string, base = '', load = loadSave) => {
      await openGame(page, { base });
      await pause(page);
      for (const [name, state] of [
        ['opening', opening],
        ['ten-years', decade],
      ] as const) {
        await load(page, state);
        await untilDrawn(page);
        await page.locator('canvas[data-terrain="ready"]').waitFor();
        await shot(
          `${stage}-${name}`,
          `${stage}: the widest zoom as ${observer.id}, ${name === 'opening' ? 'day 1' : 'ten years in'}, seed 1 with every power under the AI; the player’s land outlined first`,
        );
      }
    };
    await withBaseline(BEFORE, (base, load) => views('before', base, load));
    await views('after');
  },
});
