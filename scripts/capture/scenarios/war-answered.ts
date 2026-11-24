import { expect, type Page } from '@playwright/test';
import { createAnswerNews } from '../../../src/app/answer-news.ts';
import type { Alert } from '../../../src/app/alerts.ts';
import { pageData } from '../../../src/app/page.ts';
import { decideAll } from '../../../src/sim/ai/decide.ts';
import { warReadiness } from '../../../src/sim/ai/war.ts';
import type { DayEvent } from '../../../src/sim/events.ts';
import type { CityId, FormationId } from '../../../src/sim/ids.ts';
import { buildFixture, FIXTURE, fixtureWorld } from '../../../src/sim/fixture.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { warKey } from '../../../src/sim/state/war.ts';
import type { World } from '../../../src/sim/world/world.ts';
import type { Order } from '../../../src/sim/orders/orders.ts';
import { makePeace } from '../../../src/sim/peace/make-peace.ts';
import { saveGame } from '../../../src/sim/save.ts';
import type { Day } from '../../../src/sim/state/day.ts';
import { tick } from '../../../src/sim/tick.ts';
import {
  armyOf,
  carthage,
  carthageNearsWar,
  dropSave,
  openGame,
  pause,
  resizeTo,
  rome,
  untilDrawn,
} from '../../../e2e/support.ts';
import { world } from '../../cautious-rome.ts';
import { defineScenario } from '../scenario.ts';

/**
 * The game from `start` on day 100, with Carthage on notice since day 80 so its first day of war
 * is day 110, Rome hiring `bands` of guards at the city Carthage weighs on day 100, played under
 * the AI for `days` with the page's own answer news, and peace made on `peaceOn`.
 */
function answered(start: GameState, world: World, bands: number, days: number, peaceOn?: number) {
  let state = start;
  state.day = 100 as Day;
  const punic = state.factions[carthage];
  if (!punic) throw new Error('no Carthage');
  punic.noticeSince = 80 as Day;
  const front = warReadiness(state, world, carthage, rome)?.front;
  if (!front) throw new Error('Carthage weighs no city of Rome');
  const news = createAnswerNews(world);
  const told: Alert[] = [];
  for (let i = 0; i < days; i++) {
    const made: DayEvent[] = [];
    if (state.day === peaceOn) {
      state = structuredClone(state);
      const terms = { kind: 'asThingsStand' } as const;
      makePeace(state, carthage, rome, terms);
      made.push({ kind: 'peaceMade', between: [carthage, rome], terms });
    }
    const orders: Order[] =
      state.day === 100
        ? Array.from({ length: bands }, () => ({ kind: 'hireGuards', faction: rome, city: front }))
        : [];
    const result = tick(state, [...orders, ...decideAll(state, world)], world);
    const taken = orders.filter((order) => !result.rejected.some((r) => r.order === order));
    told.unshift(...news.onDay(state, result.state, [...made, ...result.events], taken));
    state = result.state;
  }
  return { state, told };
}

/** `carthageNearsWar` with 6,400 Carthaginians, at full strength against Roma, the treaties kept for ten years. */
function carthageAtRoma(): GameState {
  const state = carthageNearsWar();
  for (const truce of Object.values(state.truces)) truce.endsOn = (100 + 3650) as Day;
  const spearmen = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  if (!spearmen) throw new Error('no Carthaginian army');
  spearmen.men = 6400;
  return state;
}

/** The fixture's Carthage of 3,000 men beside its Rome, in a truce with Syracusae, as `answer-news.test.ts` plays it. */
function fixtureCarthage(): GameState {
  const state = buildFixture();
  state.truces[warKey(FIXTURE.carthage, FIXTURE.syracusaeFaction)] = {
    since: 100 as Day,
    endsOn: (100 + 3650) as Day,
  };
  const spearmen = state.formations[armyOf(state, carthage).formations[0] as FormationId];
  if (!spearmen) throw new Error('no Carthaginian army');
  spearmen.men = 3000;
  return state;
}

/**
 * The three new lines, each as the page's rule told it. On the full map 3 bands at Roma keep
 * a Carthage of 6,400 from its war on day 110 and put it off to day 212. The AI there takes
 * Capua before it tries Roma, so the third line comes from the small world of the unit tests:
 * 3 bands at Capua hold it against a Carthage that declares anyway, which without them takes
 * Capua on day 189, to a peace on day 194. Its focus is the full map's Capua.
 */
function answeredLines() {
  const later = answered(carthageAtRoma(), world, 3, 120);
  const held = answered(fixtureCarthage(), fixtureWorld(), 3, 95, 194);
  const capua = later.state.cities['capua' as CityId];
  if (!capua) throw new Error('no Capua');
  const lines = [
    ...held.told.map((line) => ({ ...line, focus: { at: capua.position } })),
    ...later.told,
  ].sort((a, b) => b.day - a.day);
  expect(lines.map((line) => line.kind)).toEqual(['warAnswered', 'warAnswered', 'warAnswered']);
  return { state: later.state, lines };
}

/** The full map's game with `chronicle` for its news, opened on `panel`. */
function saved(state: GameState, chronicle: Alert[], panel: 'chronicle' | undefined): string {
  return saveGame(
    state,
    pageData({
      chronicle,
      camera: undefined,
      selection: undefined,
      panel,
      occupied: new Map(),
      told: new Set(),
      weakSieges: new Map(),
    }),
  );
}

/** Each line of the list that tells what an answer bought stands whole inside the window. */
async function eachWhole(page: Page, where: 'alerts' | 'chronicle', count: number) {
  const window = page.viewportSize();
  const items = page
    .getByTestId(where)
    .getByRole('listitem')
    .filter({ hasText: /[Ww]ithout the/ });
  await expect(items).toHaveCount(count);
  for (const item of await items.all()) {
    const box = await item.boundingBox();
    expect(box).not.toBeNull();
    if (!box || !window) continue;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(window.width);
    expect(box.y + box.height).toBeLessThanOrEqual(window.height);
  }
}

const NAMES = ['later', 'peace', 'stood-down'] as const;
const TITLES = {
  peace: 'A peace without the city the warning named, which without the guards would have fallen',
  later: 'A war that came later than it would have without the guards',
  'stood-down': 'A war that did not come on its day, which without the guards would have',
} as const;

export default defineScenario({
  name: 'war-answered',
  title:
    'The news of what an answer to a war warning bought, each line held against the game played without the answer: a war that did not come on its day, one that came later, and a peace without the city the warning named',
  async run({ page, shot }) {
    const { state, lines } = answeredLines();
    await openGame(page);
    await pause(page);
    // The lines come months apart in a game, so the corner is shot with each alone in its news.
    for (const [i, line] of lines.entries()) {
      const name = NAMES[i] ?? String(i);
      await dropSave(page, saved(state, [line], undefined));
      for (const width of [1280, 1024]) {
        await resizeTo(page, { width, height: 720 });
        await untilDrawn(page);
        await eachWhole(page, 'alerts', 1);
        await shot(
          `war-answered-${name}-${width}`,
          `${TITLES[name as keyof typeof TITLES]}, in the news corner at ${width} × 720`,
        );
      }
    }
    await dropSave(page, saved(state, lines, 'chronicle'));
    await resizeTo(page, { width: 390, height: 844 });
    const chronicle = page.getByTestId('chronicle');
    await expect(chronicle).toBeVisible();
    await untilDrawn(page);
    await shot(
      'war-answered-chronicle-390',
      'The three lines in the Chronicle at 390 px wide, newest first',
    );
  },
});
