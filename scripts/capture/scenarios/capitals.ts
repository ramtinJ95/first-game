import type { PowerId } from '../../../src/sim/map.ts';
import type { CityId, FactionId } from '../../../src/sim/ids.ts';
import {
  armyOf,
  camera,
  cityPoint,
  openGame,
  pause,
  ROMAN_FOUR,
  startGame,
  withFormations,
} from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

const CAPITALS: Record<PowerId, string> = {
  rome: 'roma',
  carthage: 'carthago',
  macedon: 'pella',
  egypt: 'alexandria',
  persia: 'persepolis',
};

/** Where each power's second army marches from its capital, so its path leaves through the name. */
const MARCH_TO: Record<PowerId, string> = {
  rome: 'capua',
  carthage: 'hadrumetum',
  macedon: 'amphipolis',
  egypt: 'memphis',
  persia: 'susa',
};

export default defineScenario({
  name: 'capitals',
  title:
    "Each great power's capital with its owner's army at rest at it and a march leaving it, at the widest, the middle, and the closest zoom",
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    for (const power of Object.keys(CAPITALS) as PowerId[]) {
      const state = startGame();
      state.player = power as string as FactionId;
      const capital = cityPoint(CAPITALS[power]);
      const army = withFormations(state, armyOf(state, state.player), ROMAN_FOUR);
      army.activity = { kind: 'idle', position: capital };
      const target = state.cities[MARCH_TO[power] as CityId];
      await loadSave(page, state);
      if (target) {
        const view = camera(page);
        await page.mouse.click(view.banner(capital).x, view.banner(capital).y);
        await page.mouse.click(view.city(MARCH_TO[power]).x, view.city(MARCH_TO[power]).y, {
          button: 'right',
        });
        // Between two ports the right click offers the ways by sea and by land.
        const byLand = page.getByRole('button', { name: /^March to/ });
        await page.waitForTimeout(300);
        if (await byLand.isVisible()) await byLand.click();
      }
      await page.waitForTimeout(800);
      const name = CAPITALS[power].toUpperCase();
      await shot(
        `capital-${power}-widest`,
        `The widest zoom as ${power}: ${name} is named, and the army's flag and its waiting march leave the name clear`,
      );
      const view = camera(page);
      await view.jumpTo(capital, 1.1);
      await page.waitForTimeout(1500);
      await shot(
        `capital-${power}-middle`,
        `The middle zoom on ${name}: the army at rest beside the symbol and the name, which nothing covers`,
      );
      await view.jumpTo(capital, 4);
      await page.waitForTimeout(2500);
      await shot(
        `capital-${power}-closest`,
        `The closest zoom on ${name}: the army's blocks and camp beside the city, the name clear of them`,
      );
      await page.keyboard.press('Escape');
      await view.jumpTo(capital, 0.1);
    }
  },
});
