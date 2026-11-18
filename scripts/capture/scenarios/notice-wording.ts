import { expect, type Page } from '@playwright/test';
import {
  armyOf,
  camera,
  carthage,
  carthageNearsWar,
  cityPoint,
  dropSave,
  openGame,
  pause,
  resume,
  rome,
  untilDrawn,
} from '../../../e2e/support.ts';
import { pageData } from '../../../src/app/page.ts';
import type { CityId, FormationId } from '../../../src/sim/ids.ts';
import { removeRecord } from '../../../src/sim/records.ts';
import { saveGame } from '../../../src/sim/save.ts';
import type { Day } from '../../../src/sim/state/day.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

/** `carthageNearsWar` on day 100 with `men` Carthaginians, on notice since day 80. */
function carthageWith(men: number): GameState {
  const state = carthageNearsWar();
  state.day = 100 as Day;
  const punic = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  const power = state.factions[carthage];
  if (!punic || !power) throw new Error('no Carthaginian army');
  punic.men = men;
  power.noticeSince = 80 as Day;
  return state;
}

/**
 * Carthage of 2,000 presses a Rome of 1,000 by its field armies, war may first come on day 110,
 * and Skirmishers ordered at Roma on day 100 muster that day.
 */
function skirmishersInTraining(): GameState {
  const state = carthageWith(2000);
  const roman = state.formations[armyOf(state, rome).formations[0] as FormationId];
  const stores = state.factions[rome]?.stores;
  const roma = state.cities['roma' as CityId];
  if (!roman || !stores || !roma) throw new Error('no Roman army or stores');
  roman.men = 1000;
  stores.gold = 5000;
  stores.manpower = 5000;
  roma.recruits.push({ troop: 'skirmishers', readyOn: 110 as Day });
  return state;
}

/**
 * Carthage on day 200 on the notice Rome was warned of on day 186, with no army left, so a week
 * after its notice ends the line says why its threat passed.
 */
function carthageWithNoArmy(): string {
  const state = carthageWith(5300);
  state.day = 200 as Day;
  const power = state.factions[carthage];
  if (!power) throw new Error('no Carthage');
  power.noticeSince = 180 as Day;
  for (const army of Object.values(state.armies)) {
    if (army.owner !== carthage) continue;
    for (const id of army.formations) removeRecord(state.formations, id);
    removeRecord(state.armies, army.id);
  }
  return saveGame(
    state,
    pageData({
      chronicle: [],
      camera: undefined,
      selection: undefined,
      panel: undefined,
      occupied: new Map(),
      told: new Set(['threat:carthage:186']),
      weakSieges: new Map(),
    }),
  );
}

async function load(page: Page, state: GameState | string, day: number) {
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute('data-day', String(day));
  await untilDrawn(page);
}

/** Opens Roma's panel from a click 40 km south of it, clear of the army on its symbol. */
async function openRoma(page: Page) {
  const at = cityPoint('roma');
  const point = camera(page).screen({ x: at.x, y: at.y + 40 });
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId('city-name')).toHaveText('Roma');
  await page.getByTestId('city-guards').scrollIntoViewIfNeeded();
}

export default defineScenario({
  name: 'notice-wording',
  title:
    "The twelfth play-through's wording at 1280 by 720: men already in training in the At peace line, the guards line at the most bands a city may hold and after two hires, a share just under 80% written one way, and the line of a threat that passed with the power as its subject",
  viewport: { width: 1280, height: 720 },
  async run({ page, shot }) {
    await openGame(page);

    await load(page, skirmishersInTraining(), 100);
    await page.getByTestId('wars-button').click();
    const line = page.getByTestId('wars-panel').getByTestId('threat-row').first();
    await expect(line).toContainText(
      'More men lower it, not guards. Skirmishers in training at Roma muster on Year 1, day 110 and take it to',
    );
    await expect(line).toContainText('. Besides them, order Skirmishers now for 900 gold;');
    await shot(
      'notice-wording-training',
      'Skirmishers ordered at Roma are in training: the At peace line names them, their muster day and what they do to Carthage’s share before what more could be ordered',
    );
    await page.getByTestId('wars-button').click();

    await load(page, carthageWith(8000), 100);
    await openRoma(page);
    await page.getByTestId('guards-hire').click();
    await page.getByTestId('guards-hire').click();
    const threat = page.getByTestId('guards-threat');
    await expect(threat).toContainText(/^Carthage, with the 2 bands you hired: /);
    await expect(threat).toContainText('guards alone cannot take it below 80%');
    await shot(
      'notice-wording-cap',
      'Two bands hired at Roma in a day against a Carthage of 8,000: the line names both bands, says once that Carthage may still declare from its day, and that the bands Roma may still hire leave it at 80% or more',
    );

    await load(page, carthageWith(6000), 100);
    await openRoma(page);
    await expect(threat).toContainText('; 2 bands, 4,000 gold, take it to 78%, below 80%');
    await shot(
      'notice-wording-bands',
      'Against a Carthage of 6,000 one band is not enough: the line says how many bands take it below 80% and what they cost',
    );

    await load(page, carthageWith(5400), 100);
    await openRoma(page);
    await expect(threat).toContainText('takes it to just under 80%');
    await page.getByTestId('guards-hire').click();
    await expect(threat).toContainText(/^Carthage just under 80% → \d+% /);
    await shot(
      'notice-wording-just-under',
      'After the hire whose line said "takes it to just under 80%", Carthage’s line keeps "just under 80%" before the arrow',
    );

    await load(page, carthageWith(4690), 100);
    await page.getByTestId('wars-button').click();
    await expect(page.getByTestId('wars-panel').getByTestId('threat-row').first()).toContainText(
      'Carthage has just under 80% of the strength it needs to declare war on you',
    );
    await shot(
      'notice-wording-at-peace-just-under',
      'A share just under 80% reads the same in the At peace list as in the guards line',
    );
    await page.getByTestId('wars-button').click();

    await load(page, carthageWithNoArmy(), 200);
    await resume(page);
    await page
      .getByTestId('alerts')
      .getByText(
        "Carthage's threat has passed for now: none of its armies stands ready to march, and Carthage must stand at 80% for 30 days before it may declare.",
      )
      .waitFor();
    await pause(page);
    await untilDrawn(page);
    await shot(
      'notice-wording-faded',
      'A warned Carthage left with no army: the line says why its threat passed, with Carthage as the subject of what it must do',
    );
  },
});
