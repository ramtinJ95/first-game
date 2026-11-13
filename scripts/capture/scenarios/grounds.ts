import { camera, openGame, pause, startGame } from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { changeCityOwner } from '../../../src/sim/cities.ts';
import type { CityId, FactionId } from '../../../src/sim/ids.ts';
import { defineScenario } from '../scenario.ts';

/** Neighbouring provinces of each ground, given in turn to Rome, Carthage, Macedon, Egypt, and Persia. */
const GROUNDS = {
  desert: ['cidamus', 'lepcis-magna', 'cyrene', 'alexandria', 'hierosolyma'],
  wood: ['lutetia', 'colonia-agrippina', 'mogontiacum', 'augusta-vindelicum', 'carnuntum'],
  paper: ['tarsos', 'antiocheia', 'mazaka', 'edessa', 'ninos'],
} as const;
const POWERS = ['rome', 'carthage', 'macedon', 'egypt', 'persia'] as const;
const VIEWS = {
  desert: { x: 3150, y: 3450 },
  wood: { x: 2440, y: 1500 },
  paper: { x: 4640, y: 2900 },
} as const;

export default defineScenario({
  name: 'grounds',
  title: "The five powers' washes side by side over desert ground, wood ground, and plain paper",
  async run({ page, shot }) {
    const state = startGame();
    for (const cities of Object.values(GROUNDS)) {
      cities.forEach((city, i) => {
        changeCityOwner(state, city as CityId, POWERS[i] as string as FactionId);
      });
    }
    state.player = 'egypt' as FactionId;
    await openGame(page, { power: 'egypt' });
    await pause(page);
    await loadSave(page, state);
    await page.waitForTimeout(800);
    await shot(
      'grounds-widest',
      'The widest zoom: Rome, Carthage, Macedon, Egypt, and Persia in turn over the Libyan desert, the woods of Gaul and Germania, and the open land of Syria and Anatolia',
    );
    const view = camera(page);
    for (const [ground, at] of Object.entries(VIEWS)) {
      await view.jumpTo(at, 0.5);
      await page.waitForTimeout(1500);
      await shot(
        `grounds-${ground}`,
        `Over ${ground} ground at 0.5 px per km: Rome, Carthage, Macedon, Egypt, and Persia from west to east, each told from the others`,
      );
      await view.jumpTo(at, 0.18);
    }
  },
});
