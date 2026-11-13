import type { PowerId } from '../../../src/sim/map.ts';
import type { FactionId } from '../../../src/sim/ids.ts';
import {
  armyOf,
  camera,
  cityPoint,
  openGame,
  pause,
  romaFallsTomorrow,
  startGame,
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

export default defineScenario({
  name: 'colours',
  title:
    "Who owns what and what is hidden: each power's land in sight and in the fog beside unowned land, and the map after the player's defeat",
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    await loadSave(page, startGame());
    await page.waitForTimeout(800);
    await shot(
      'colours-widest',
      "The widest zoom as Rome on day 1: Rome's red land in sight, the other four powers' land and the minors' land in the fog, and unowned land",
    );

    for (const power of Object.keys(CAPITALS) as PowerId[]) {
      const state = startGame();
      state.player = power as string as FactionId;
      const capital = cityPoint(CAPITALS[power]);
      armyOf(state, state.player).activity = { kind: 'idle', position: capital };
      await loadSave(page, state);
      const view = camera(page);
      await view.jumpTo(capital, 0.5);
      await page.waitForTimeout(1500);
      await shot(
        `colours-${power}-wide`,
        `As ${power}, 0.5 px per km on its capital: its own land in sight, the edge of sight, and the neighbours' and minors' land in the fog`,
      );
      await view.jumpTo(capital, 1.1);
      await page.waitForTimeout(1500);
      await shot(
        `colours-${power}-middle`,
        `As ${power}, the middle zoom on its capital: own land, a minor's land, and the fog`,
      );
      await view.jumpTo(capital, 0.1);
    }

    await openGame(page);
    await loadSave(page, romaFallsTomorrow());
    await page.getByTestId('defeat').waitFor();
    await page.getByRole('button', { name: 'Watch on' }).click();
    await pause(page);
    await page.waitForTimeout(800);
    await shot(
      'colours-defeated-widest',
      "After Rome's defeat, watching on at the widest zoom: the player sees nothing, yet every owner's colour stays clear of the fog",
    );
    const view = camera(page);
    await view.jumpTo(cityPoint('roma'), 1.1);
    await page.waitForTimeout(1500);
    await shot(
      'colours-defeated-middle',
      "After Rome's defeat, the middle zoom on Roma, now Carthage's",
    );
  },
});
