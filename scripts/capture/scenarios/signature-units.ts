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
  resume,
  untilDrawn,
  withFormations,
} from '../../../e2e/support.ts';
import { loadSave, stillAfter, untilDay } from '../../../e2e/watch.ts';
import type { FactionId } from '../../../src/sim/ids.ts';
import type { Order } from '../../../src/sim/orders/orders.ts';
import { POWERS } from '../../../src/sim/map.ts';
import { newGame } from '../../../src/sim/new-game.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import type { MapPoint } from '../../../src/sim/state/map-point.ts';
import { troopsFor, type Troop } from '../../../src/sim/troops.ts';
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

type Troops = readonly (readonly [Troop, number])[];

/** Stands `power`'s army in these troops at `dx`, `dy` km from Pella. */
function stand(state: GameState, power: string, troops: Troops, dx: number, dy: number) {
  const pella = cityPoint('pella');
  const army = withFormations(state, armyOf(state, power as FactionId), troops);
  army.activity = { kind: 'idle', position: { x: pella.x + dx, y: pella.y + dy } };
  return army;
}

/** Carthage, Egypt, and Persia at rest outside Pella, each in its new figure and the troop it stood in for. */
function beside(): GameState {
  const state = newGame(map, { seed: 1, player: 'macedon' });
  const pairs: readonly [string, Troops][] = [
    [
      'carthage',
      [
        ['warElephants', 600],
        ['heavyCavalry', 600],
      ],
    ],
    [
      'egypt',
      [
        ['chariots', 600],
        ['lightCavalry', 600],
      ],
    ],
    [
      'persia',
      [
        ['cataphracts', 600],
        ['heavyCavalry', 600],
      ],
    ],
  ];
  pairs.forEach(([power, troops], i) => stand(state, power, troops, -60 + 80 * i, -30));
  return state;
}

/**
 * Persia marches on Egypt and Carthage on Macedon, 100 km apart east of Pella, at war:
 * a day on the road, then they meet and fight.
 */
function onTheMarch(): GameState {
  const state = newGame(map, { seed: 1, player: 'macedon' });
  declareWar(state, 'persia' as FactionId, 'egypt' as FactionId);
  declareWar(state, 'carthage' as FactionId, 'macedon' as FactionId);
  const sides: readonly [string, Troops, number, number][] = [
    [
      'persia',
      [
        ['cataphracts', 1500],
        ['heavyCavalry', 800],
      ],
      60,
      -20,
    ],
    [
      'egypt',
      [
        ['chariots', 1500],
        ['lightCavalry', 800],
      ],
      160,
      -20,
    ],
    [
      'carthage',
      [
        ['warElephants', 1500],
        ['heavyCavalry', 800],
      ],
      60,
      -60,
    ],
    [
      'macedon',
      [
        ['phalangites', 1500],
        ['companionCavalry', 800],
      ],
      160,
      -60,
    ],
  ];
  const pella = cityPoint('pella');
  const orders: Order[] = sides.map(([power, troops, dx, dy]) => {
    const army = stand(state, power, troops, dx, dy);
    return {
      kind: 'moveArmy',
      faction: army.owner,
      army: army.id,
      to: { x: pella.x + 110, y: pella.y + dy },
    };
  });
  return playDays(state, 1, orders);
}

export default defineScenario({
  name: 'signature-units',
  title:
    "Each great power's own two troops: war elephants, chariots, and cataphracts in figures of their own beside the troops they stood in for, marching and fighting; the figures of every power's own troops on the map; and its recruit cards in its colour",
  viewport: { width: 1280, height: 720 },
  clipSeconds: 45,
  async run({ page, shot }) {
    await openGame(page, { power: 'macedon' });
    await pause(page);
    await loadSave(page, beside());
    const pella = cityPoint('pella');
    await camera(page).jumpTo({ x: pella.x + 30, y: pella.y - 32 }, 4);
    await untilDrawn(page);
    await page.waitForTimeout(1500);
    await shot(
      'figures-beside-replaced',
      "Outside Pella at the closest zoom: Carthage's war elephants beside heavy horse, Egypt's chariots beside light horse, and Persia's cataphracts beside heavy horse, the troops each stood in for",
    );

    const march = onTheMarch();
    await loadSave(page, march);
    await camera(page).jumpTo({ x: pella.x + 110, y: pella.y - 40 }, 4);
    await resume(page);
    await untilDay(page, march.day + 1, 0, 60_000);
    await page.waitForTimeout(500);
    await pause(page);
    await shot(
      'figures-new-fighting',
      "East of Pella: the first day of battle after a day on the march: Persia's cataphracts fight Egypt's chariots, and Carthage's war elephants fight Macedon's phalangites",
    );

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
