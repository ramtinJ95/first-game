import type { Page } from '@playwright/test';
import {
  armyOf,
  battleAt,
  camera,
  carthage,
  cityPoint,
  declareWar,
  dropSave,
  fallenTo,
  pause,
  playDays,
  resume,
  rome,
  startGame,
} from '../../../e2e/support.ts';
import type { CityId } from '../../../src/sim/ids.ts';
import type { Day } from '../../../src/sim/state/day.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { defineScenario } from '../scenario.ts';

const WIDTHS = [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

function nextFrame(page: Page) {
  return page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/** A click picks among the banners last drawn, so this waits for a frame of the loaded day. */
async function load(page: Page, state: GameState) {
  await dropSave(page, state);
  await page
    .getByTestId('time-controls-day')
    .and(page.locator(`[data-day="${state.day}"]`))
    .waitFor();
  await nextFrame(page);
}

async function start(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto('/');
  await page.getByTestId('top-bar').waitFor({ state: 'visible' });
  await pause(page);
}

function cityOf(state: GameState, id: string) {
  const city = state.cities[id as CityId];
  if (!city) throw new Error(`no city ${id}`);
  return city;
}

/** Roma musters twelve recruits on day 1 and twelve on day 11, so the alerts run long. */
function musteringRome(): GameState {
  const state = startGame();
  cityOf(state, 'roma').recruits = [1, 11].flatMap((day) =>
    Array.from({ length: 12 }, () => ({ troop: 'spearmen' as const, readyOn: day as Day })),
  );
  return state;
}

/** Rome at war with Carthage, which besieges Capua; Mediolanum taken; Roma raising troops. */
function busyRome(): GameState {
  const state = startGame();
  declareWar(state, rome, carthage);
  armyOf(state, carthage).activity = { kind: 'idle', position: cityPoint('capua') };
  fallenTo(state, 'mediolanum');
  cityOf(state, 'roma').recruits = [
    { troop: 'spearmen', readyOn: 40 as Day },
    { troop: 'archers', readyOn: 40 as Day },
  ];
  return playDays(state, 3);
}

export default defineScenario({
  name: 'playtest',
  title:
    'The playtest fixes: the layout at four widths, battle controls, the overview, several armies at one city, why an army does not besiege, and the port menu',
  async run({ page, shot }) {
    await start(page, WIDTHS[1]);
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await shot(
      'speed-pressed',
      'Speed 3 just clicked, still under the pointer and focused: its number stays readable',
    );
    await pause(page);

    const port = camera(page);
    await page.mouse.click(port.banner(cityPoint('roma')).x, port.banner(cityPoint('roma')).y);
    const salona = port.city('salona');
    await page.mouse.click(salona.x, salona.y, { button: 'right' });
    await page.getByTestId('command-menu').waitFor();
    await shot('port-menu', 'With the army at Roma, a right click on Salona opens the port menu');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    const peaceful = startGame();
    armyOf(peaceful, rome).activity = { kind: 'idle', position: cityPoint('massalia') };
    await load(page, peaceful);
    const banner = port.banner(cityPoint('massalia'));
    await page.mouse.click(banner.x, banner.y);
    await page.getByTestId('army-siege-block').waitFor();
    await shot(
      'siege-block',
      "Rome's army at Massalia says why it does not besiege: Rome is at peace with Massalia",
    );

    const battle = startGame();
    battleAt(battle, 'mediolanum');
    await load(page, battle);
    await resume(page);
    await page.getByTestId('battle-panel').waitFor();
    await pause(page);
    await shot(
      'battle-controls',
      "The battle panel: each army a row that selects it, with men and stance, and Rome's stances, what each does, and the retreat",
    );

    await load(page, busyRome());
    await page.getByRole('button', { name: 'Overview' }).click();
    await page.getByTestId('overview').waitFor();
    await shot(
      'overview',
      "The overview: Rome's cities with their state (besieged, in unrest, training), its armies, and its war with Carthage",
    );
    await page
      .getByTestId('overview')
      .getByRole('button', { name: /^Capua/ })
      .click();
    await page.getByTestId('city-panel').waitFor();
    await shot(
      'overview-show',
      "A click on Capua in the overview selects the city and centres the map on it, with Carthage's besieging army under Armies here",
    );
    await page.getByRole('button', { name: 'Overview' }).click();

    await start(page, WIDTHS[1]);
    const crowded = startGame();
    armyOf(crowded, carthage).activity = { kind: 'idle', position: cityPoint('roma') };
    await load(page, crowded);
    const view = camera(page);
    await view.closeUp(cityPoint('roma'), 5);
    const capital = view.city('roma');
    await page.mouse.click(capital.x, capital.y);
    await page.getByTestId('city-panel').waitFor();
    await shot(
      'armies-here',
      'Two armies at Roma draw as one banner; the city panel lists both, each a row that selects it',
    );

    for (const viewport of WIDTHS) {
      await start(page, viewport);
      await load(page, musteringRome());
      const overview = page.getByRole('button', { name: 'Overview' });
      await overview.click();
      await page.getByTestId('overview').getByRole('button', { name: /^Roma/ }).click();
      await overview.click();
      await page.getByTestId('city-panel').waitFor();
      await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
      await resume(page);
      await page.waitForFunction(
        () =>
          Number(
            document.querySelector('[data-testid="time-controls-day"]')?.getAttribute('data-day'),
          ) >= 13,
      );
      await pause(page);
      await nextFrame(page);
      await shot(
        `layout-${viewport.width}`,
        `At ${viewport.width} px: Roma's city panel and two dozen alerts in a list that scrolls, and nothing covers the clock, the stores, or the speed buttons`,
      );
    }
    await page.getByTestId('alerts').evaluate((list) => list.scrollTo({ top: list.scrollHeight }));
    await nextFrame(page);
    await shot(
      'alerts-old',
      'The alert list scrolled to its oldest news: the text stays as dark as fresh news, and only the day is muted',
    );
  },
});
