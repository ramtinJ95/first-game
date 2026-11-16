import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  carthage,
  carthageNearsWar,
  dropSave,
  fiveFleetsOnRoma,
  openGame,
  outnumberedAt,
  pause,
  resizeTo,
  resume,
  rome,
  startGame,
  untilDrawn,
  weakSiegeOfMediolanum,
} from '../../../e2e/support.ts';
import { ownCityInDangerTomorrow } from '../../../e2e/warnings-game.ts';
import type { FormationId } from '../../../src/sim/ids.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

/** Rome with 1,000 men in the field beside a Carthage of 2,000: Carthage presses it by its field armies. */
function carthagePresses(): GameState {
  const state = carthageNearsWar();
  const punic = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const roman = state.formations[armyOf(state, rome).formations[0] as FormationId];
  if (!punic || !roman) throw new Error('no armies');
  punic.men = 2000;
  roman.men = 1000;
  return state;
}

function battleTomorrow(): GameState {
  const state = startGame();
  outnumberedAt(state, 'roma', 1500);
  return state;
}

/** The news of each kind that stops the game, with its longest text the saves give. */
const STOPS: readonly { name: string; make: () => GameState; line: RegExp; shot?: string }[] = [
  {
    name: 'a warning by a city',
    make: carthageNearsWar,
    line: /could soon declare war on you/,
    shot: 'warning',
  },
  {
    name: 'a warning by field armies',
    make: carthagePresses,
    line: /all your armies in the field/,
    shot: 'field-warning',
  },
  { name: 'a city in danger', make: ownCityInDangerTomorrow, line: /is in danger/ },
  { name: 'fleets sighted', make: fiveFleetsOnRoma, line: /sail|march/ },
  { name: 'a weak siege', make: weakSiegeOfMediolanum, line: /Too few|too weak/ },
  { name: 'a battle', make: battleTomorrow, line: /Battle at Roma/ },
];

async function stopOn(page: Page, state: GameState, line: RegExp) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
  await resume(page);
  const alerts = page.getByTestId('alerts');
  const item = alerts
    .getByRole('listitem')
    .filter({ has: page.getByTestId('alert-paused') })
    .filter({ hasText: line })
    .first();
  await item.waitFor();
  await untilDrawn(page);
  const box = await item.boundingBox();
  const list = await alerts.boundingBox();
  const window = page.viewportSize();
  if (!box || !list || !window) throw new Error('no alert, corner or window');
  expect(box.y, 'the stopped line starts inside the corner').toBeGreaterThanOrEqual(list.y - 0.5);
  expect(box.y + box.height, 'the stopped line ends inside the corner').toBeLessThanOrEqual(
    list.y + list.height + 0.5,
  );
  expect(box.y + box.height, 'the stopped line ends inside the window').toBeLessThanOrEqual(
    window.height,
  );
}

export default defineScenario({
  name: 'paused-news-fits',
  title:
    'News that stops the game is read whole in the corner at 1280 × 720 and 1024 × 720: the war warnings, a city in danger, fleets sighted, a weak siege, and a battle',
  async run({ page, shot }) {
    await openGame(page, { pauses: true });
    for (const width of [1280, 1024]) {
      await resizeTo(page, { width, height: 720 });
      for (const stop of STOPS) {
        await stopOn(page, stop.make(), stop.line);
        if (stop.shot)
          await shot(
            `${stop.shot}-${width}`,
            `${width} × 720: ${stop.name} stops the game and is read to its last word`,
          );
      }
    }
  },
});
