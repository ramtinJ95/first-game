import { expect } from '@playwright/test';
import {
  armyOf,
  camera,
  cityPoint,
  declareWar,
  map,
  openGame,
  pause,
  playDays,
  untilDrawn,
  withFormations,
} from '../../../e2e/support.ts';
import { loadSave, stillAfter } from '../../../e2e/watch.ts';
import type { FactionId } from '../../../src/sim/ids.ts';
import { POWERS } from '../../../src/sim/map.ts';
import { newGame } from '../../../src/sim/new-game.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import type { MapPoint } from '../../../src/sim/state/map-point.ts';
import { troopsFor } from '../../../src/sim/troops.ts';
import { defineScenario } from '../scenario.ts';

/** Rome at war with Carthage outside Roma, each side in its own two troops, or Macedon, Egypt, and Persia at peace outside Pella in theirs, seen by Macedon. */
function signatureArmies(battle: boolean): GameState {
  const state = newGame(map, { seed: 1, player: battle ? 'rome' : 'macedon' });
  const roma = cityPoint('roma');
  const pella = cityPoint('pella');
  if (battle) declareWar(state, 'rome' as FactionId, 'carthage' as FactionId);
  const place = (power: string, dx: number, dy: number, at: MapPoint) => {
    const owner = power as FactionId;
    const own = troopsFor(owner).slice(-2);
    const army = withFormations(state, armyOf(state, owner), [
      [own[0] ?? 'spearmen', 1500],
      [own[1] ?? 'spearmen', 800],
    ]);
    army.activity = { kind: 'idle', position: { x: at.x + dx, y: at.y + dy } };
  };
  if (battle) {
    place('rome', 30, -4, roma);
    place('carthage', 42, -4, roma);
  } else {
    place('macedon', -30, -30, pella);
    place('egypt', 30, -30, pella);
    place('persia', 90, -30, pella);
  }
  return state;
}

export default defineScenario({
  name: 'signature-units',
  title:
    "Each great power's own two troops: its recruit cards in its colour, and the figures of every power's own troops on the map",
  viewport: { width: 1280, height: 720 },
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const fight = playDays(signatureArmies(true), 1);
    await loadSave(page, fight);
    const battle = Object.values(fight.battles)[0];
    if (!battle) throw new Error('the armies outside Roma did not meet');
    await camera(page).jumpTo({ x: battle.position.x + 20, y: battle.position.y - 50 }, 4);
    await stillAfter(page, fight, 1500);
    await shot(
      'figures-rome-carthage',
      "Outside Roma at the closest zoom: Rome's legionaries and triarii fight Carthage's war elephants and Numidian horse",
    );

    await openGame(page, { power: 'macedon' });
    await pause(page);
    const peace = signatureArmies(false);
    await loadSave(page, peace);
    const pella = cityPoint('pella');
    await camera(page).jumpTo({ x: pella.x + 30, y: pella.y - 32 }, 4);
    await untilDrawn(page);
    await page.waitForTimeout(1500);
    await shot(
      'figures-macedon-egypt-persia',
      "Outside Pella at the closest zoom: Macedon's phalangites and companions, Egypt's Nile archers and chariots, and Persia's cataphracts and horse archers at rest",
    );

    for (const power of POWERS) {
      const faction = power as FactionId;
      await openGame(page, { power });
      await pause(page);
      const state = newGame(map, { seed: 1, player: power });
      const stores = state.factions[faction]?.stores;
      if (stores) Object.assign(stores, { gold: 20_000, food: 5_000, manpower: 6_000 });
      await loadSave(page, state);
      const capital = Object.values(state.cities).find(
        (city) => city.owner === faction && city.rank === 'capital',
      );
      if (!capital) throw new Error(`no capital of ${power}`);
      await untilDrawn(page);
      const at = cityPoint(capital.id);
      const point = camera(page).screen({ x: at.x, y: at.y + 40 });
      await page.mouse.click(point.x, point.y);
      await expect(page.getByTestId('city-name')).toHaveText(capital.name);
      const cards = page.getByTestId('recruit-cards').getByRole('button');
      await expect(cards).toHaveCount(troopsFor(faction).length);
      await cards.last().scrollIntoViewIfNeeded();
      await shot(
        `cards-${power}`,
        `${state.factions[faction]?.name}'s recruit cards at ${capital.name}: the shared six, and its own two last, named in its colour`,
      );
    }
  },
});
