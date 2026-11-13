import {
  armyOf,
  camera,
  cityPoint,
  openGame,
  pause,
  rome,
  ROMAN_FOUR,
  startGame,
  withFormations,
} from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

const CORNO_GRANDE = { x: 2607.4, y: 2282.7 };
const DURMITOR = { x: 3050.3, y: 2264.6 };
const ARAUSA = { x: 2804.2, y: 2160 };

export default defineScenario({
  name: 'map-read',
  title:
    'How the map reads: relief under a wash, the woods of Italy, and a village beside an army at the closest zoom',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const state = startGame();
    const army = withFormations(state, armyOf(state, rome), ROMAN_FOUR);
    army.activity = { kind: 'idle', position: { x: ARAUSA.x + 6, y: ARAUSA.y + 4 } };
    await loadSave(page, state);
    const view = camera(page);

    await view.jumpTo(cityPoint('roma'), 0.45);
    await page.waitForTimeout(1500);
    await shot(
      'italy-woods',
      'Italy at 0.45 px per km: the Apennine and Po woods of the map data drawn under the Roman wash',
    );
    await view.jumpTo({ x: 2560, y: 2300 }, 1.3);
    await page.waitForTimeout(1500);
    await shot(
      'italy-woods-middle',
      'Central Italy at the middle zoom: the woods and the Apennines round Roma',
    );
    await view.jumpTo(CORNO_GRANDE, 2.6);
    await page.waitForTimeout(2500);
    await shot(
      'relief-under-wash',
      "Corno Grande under Rome's wash at a close zoom: the mountains keep their ink, their lit side, and their shaded side",
    );
    await view.jumpTo(CORNO_GRANDE, 0.2);
    await view.jumpTo(DURMITOR, 2.6);
    await page.waitForTimeout(2500);
    await shot('relief-minor', "Durmitor under a minor's wash at the same zoom, to compare");
    await view.jumpTo(DURMITOR, 0.2);
    await view.jumpTo(ARAUSA, 4);
    await page.waitForTimeout(2500);
    await shot(
      'village-closest',
      'The village of Arausa at the closest zoom beside a Roman army: the village symbol reads beside figures 54 px tall',
    );
  },
});
