import {
  armyOf,
  camera,
  cityPoint,
  declareWar,
  openGame,
  pause,
  playDays,
  rome,
  setRich,
  startGame,
  withFormations,
} from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import type { CityId, FactionId } from '../../../src/sim/ids.ts';
import { defineScenario } from '../scenario.ts';

/** Zembra, an islet off Cap Bon that the atlas draws and no province holds. */
const ZEMBRA = { x: 2276.8, y: 2842.4 };
/** The islet east of Cap Bon that Carthago's province holds and no city stands on. */
const CARTHAGO_ISLET = { x: 2370.5, y: 2895.9 };

/** Rome's four formations besieging Massalia on the fourth day. */
function siegeOfMassalia() {
  const state = startGame();
  const owner = state.cities['massalia' as CityId]?.owner as FactionId;
  declareWar(state, rome, owner);
  const army = withFormations(state, armyOf(state, rome), [
    ['spearmen', 1500],
    ['swordsmen', 1500],
    ['archers', 500],
    ['spearmen', 1500],
  ]);
  const at = cityPoint('massalia');
  army.activity = { kind: 'idle', position: { x: at.x + 6, y: at.y - 3 } };
  setRich(state);
  return playDays(state, 3, [{ kind: 'moveArmy', faction: rome, army: army.id, to: at }]);
}

export default defineScenario({
  name: 'islet-orders',
  title:
    'A right click on an islet the atlas draws, or on one a province holds with no city on it, says no army can land there, and a siege camp at Massalia beside Aquae Sextiae',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const view = camera(page);
    const roma = cityPoint('roma');
    await view.jumpTo(roma, 0.5);
    const flag = view.banner(roma);
    await page.mouse.click(flag.x, flag.y);
    await page.getByTestId('army-activity').waitFor();
    await view.jumpTo(ZEMBRA, 4);
    const islet = view.screen(ZEMBRA);
    await page.mouse.click(islet.x, islet.y, { button: 'right' });
    await page.getByText('Order refused. No army can land on that islet.').waitFor();
    await shot(
      'islet-refused',
      'First Legion selected, a right click on Zembra off Cap Bon at the closest zoom: no army can land on that islet',
    );
    await view.jumpTo(CARTHAGO_ISLET, 4);
    await page
      .getByText('Order refused. No army can land on that islet.')
      .waitFor({ state: 'hidden' });
    const held = view.screen(CARTHAGO_ISLET);
    await page.mouse.click(held.x, held.y, { button: 'right' });
    await page.getByText('Order refused. No army can land on that islet.').waitFor();
    await shot(
      'islet-of-carthago-refused',
      "A right click on the islet east of Cap Bon, which Carthago's province holds and no city stands on: the same words, no army can land on that islet",
    );

    await openGame(page);
    await pause(page);
    await loadSave(page, siegeOfMassalia());
    await camera(page).jumpTo(cityPoint('massalia'), 4);
    await shot(
      'massalia-camp',
      'Rome besieging Massalia at the closest zoom: the camp keeps off the Aquae Sextiae symbol and name, close beside them',
    );
  },
});
