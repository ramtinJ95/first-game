import {
  armyOf,
  camera,
  carthage,
  declareWar,
  openGame,
  pause,
  playDays,
  rome,
  ROMAN_FOUR,
  startGame,
  withFormations,
} from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import { defineScenario } from '../scenario.ts';

/** The village of Arausa on the Dalmatian coast, with the sea a few km to its west. */
const ARAUSA = { x: 2804.2, y: 2160 };

export default defineScenario({
  name: 'coast',
  title: 'An army at rest and a battle on a coast, with every figure on land',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const view = camera(page);

    const resting = startGame();
    withFormations(resting, armyOf(resting, rome), ROMAN_FOUR).activity = {
      kind: 'idle',
      position: { x: ARAUSA.x + 6, y: ARAUSA.y + 4 },
    };
    await loadSave(page, resting);
    await view.jumpTo(ARAUSA, 4);
    await page.mouse.click(80, 650);
    await page.waitForTimeout(2500);
    await shot(
      'coast-army',
      "Rome's army at rest at Arausa, on the shore: every block, the horse, and the camp stand on land",
    );

    const battle = startGame();
    declareWar(battle, rome, carthage);
    withFormations(battle, armyOf(battle, rome), ROMAN_FOUR).activity = {
      kind: 'idle',
      position: { x: ARAUSA.x + 2, y: ARAUSA.y },
    };
    withFormations(battle, armyOf(battle, carthage), [
      ['spearmen', 1300],
      ['skirmishers', 500],
      ['lightCavalry', 400],
      ['swordsmen', 1100],
    ]).activity = { kind: 'idle', position: { x: ARAUSA.x + 10, y: ARAUSA.y } };
    await view.jumpTo(ARAUSA, 0.1);
    await loadSave(page, playDays(battle, 2));
    await view.jumpTo({ x: ARAUSA.x + 55, y: ARAUSA.y + 10 }, 4);
    // A short drag may select the battle, and its panel would cover the lines. A click
    // on the open sea selects nothing.
    await page.mouse.click(80, 650);
    await page.waitForTimeout(2500);
    await shot(
      'coast-battle',
      'Rome and Carthage fight on the shore at Arausa: both lines stand on land, none in the sea',
    );
  },
});
