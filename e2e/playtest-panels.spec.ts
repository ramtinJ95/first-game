import { expect, test, type Locator, type Page } from '@playwright/test';
import type { CityId } from '../src/sim/ids.ts';
import type { Day } from '../src/sim/state/day.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import {
  armyOf,
  battleAt,
  camera,
  carthage,
  cityPoint,
  declareWar,
  dropSave,
  fallenTo,
  openGame,
  pause,
  resume,
  rome,
  startGame,
  untilDay,
  untilDrawn,
} from './support.ts';

/**
 * A click picks among the banners last drawn, so this waits for a frame of the loaded day.
 * The save loads into a paused game, because a running one can pass its day before the
 * page is read, and the game runs on after if it was running.
 */
async function load(page: Page, state: GameState) {
  const running = await page.getByRole('button', { name: 'Pause', exact: true }).isVisible();
  await pause(page);
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
  if (running) await resume(page);
}

async function clickCity(page: Page, id: string) {
  const at = camera(page).city(id);
  await page.mouse.click(at.x, at.y);
}

/**
 * The WCAG contrast of the element's text against what lies under it on the page,
 * after every background and opacity from the root down. The map under the panels
 * counts as the page's parchment.
 */
function legibility(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    type Rgb = [number, number, number];
    const parse = (css: string): [Rgb, number] => {
      const [r = 0, g = 0, b = 0, a = 1] = (css.match(/[\d.]+/g) ?? []).map(Number);
      return [[r, g, b], a];
    };
    const mix = ([r, g, b]: Rgb, [r2, g2, b2]: Rgb, share: number): Rgb => [
      r + (r2 - r) * share,
      g + (g2 - g) * share,
      b + (b2 - b) * share,
    ];
    const over = (css: string, under: Rgb): Rgb => {
      const [colour, alpha] = parse(css);
      return mix(under, colour, alpha);
    };
    const luminance = (rgb: Rgb) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      }) as Rgb;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const chain: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
    let background: Rgb = [233, 220, 192];
    let beneath: Rgb | undefined;
    let fade = 1;
    for (const node of chain) {
      const style = getComputedStyle(node);
      const opacity = Number(style.opacity);
      if (opacity < 1) {
        beneath ??= background;
        fade *= opacity;
      }
      background = over(style.backgroundColor, background);
    }
    let text = over(getComputedStyle(element).color, background);
    if (beneath) {
      text = mix(beneath, text, fade);
      background = mix(beneath, background, fade);
    }
    const [ink, paper] = [luminance(text), luminance(background)];
    return (Math.max(ink, paper) + 0.05) / (Math.min(ink, paper) + 0.05);
  });
}

interface Box {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function box(name: string, locator: Locator): Promise<Box> {
  const found = await locator.boundingBox();
  if (!found) throw new Error(`${name} is not on the page`);
  return { name, ...found };
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Rome's capital musters twelve recruits on day 1 and twelve on day 11, so by day 13
 * the alert list holds news older than ten days and fresh news.
 */
function musteringRome(): GameState {
  const state = startGame();
  const roma = state.cities['roma' as CityId];
  if (!roma) throw new Error('no Roma');
  // A troop mustered on a day of its own is a line of its own, since the page folds the
  // same muster at one city on one day into one line.
  roma.recruits = Array.from({ length: 12 }, (_, i) => i + 1).flatMap((day) =>
    (['spearmen', 'archers'] as const).map((troop) => ({ troop, readyOn: day as Day })),
  );
  return state;
}

test.describe('the panels after the playtest', () => {
  const errors: string[] = [];

  test.beforeEach(async ({ page }) => {
    errors.length = 0;
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await openGame(page);
  });

  test.afterEach(() => {
    expect(errors).toEqual([]);
  });

  test('the battle panel lists each army as a row that selects it, and steers and pulls out your army', async ({
    page,
  }) => {
    const state = startGame();
    battleAt(state, 'mediolanum');
    await load(page, state);
    const battle = page.getByTestId('battle-panel');
    await expect(battle).toBeVisible();
    await pause(page);

    const stances = battle.getByRole('group', { name: 'Stance' });
    await expect(stances).toHaveCount(1);
    // Each other stance says on its button what a change to it costs.
    await expect(stances.getByRole('button')).toHaveText([
      'Hold the line',
      /^All-out assault.*re-forms 3 days$/,
      /^Skirmish and withdraw.*re-forms 3 days$/,
    ]);
    await expect(
      stances.getByRole('button', { name: 'Hold the line' }),
    ).toHaveAccessibleDescription(/Deals and takes normal blows$/);
    await expect(
      stances.getByRole('button', { name: 'All-out assault' }),
    ).toHaveAccessibleDescription(/Deals and takes 25% more$/);
    await expect(
      stances.getByRole('button', { name: 'Skirmish and withdraw' }),
    ).toHaveAccessibleDescription(
      /Deals and takes 25% less, normal blows against an enemy that skirmishes too$/,
    );
    await expect(stances).toContainText('Deals and takes 25% more');

    const army = page.getByTestId('army-panel');
    await battle
      .getByRole('button', { name: /^Army of Mediolanum · Hold the line · [\d,]+ men$/ })
      .click();
    await expect(army.getByRole('heading', { level: 2 })).toHaveText('Army of Mediolanum');
    await battle
      .getByRole('button', { name: /^First Legion · Hold the line · [\d,]+ men$/ })
      .click();
    await expect(army.getByRole('heading', { level: 2 })).toHaveText('First Legion');
    await expect(army.getByTestId('army-activity')).toHaveText(
      /^In battle (at|near) Mediolanum · day \d+$/,
    );

    await stances.getByRole('button', { name: 'All-out assault' }).click();
    await expect(stances.getByRole('button', { name: 'All-out assault' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await battle.getByRole('button', { name: 'Retreat, losing 15% of the men' }).click();
    await expect(battle.getByTestId('retreat-ordered')).toHaveText('Retreats with the next day');
    await resume(page);
    await expect(army.getByTestId('army-activity')).toHaveText(/^Retreating (to|toward) /);
    await expect(battle).toHaveCount(0);
  });

  test('the army and city panels list every army in sight at the place, each a row that selects it', async ({
    page,
  }) => {
    await pause(page);
    const state = startGame();
    armyOf(state, carthage).activity = { kind: 'idle', position: cityPoint('roma') };
    await load(page, state);
    await clickCity(page, 'roma');
    const city = page.getByTestId('city-panel');
    const here = city.getByTestId('armies-here').getByRole('button');
    await expect(here).toHaveText([
      /^\s*First Legion · Hold the line · [\d,]+ men\s*Idle at Roma$/,
      /^\s*Carthage's Host of Hanno · Hold the line · [\d,]+ men\s*Idle at Roma$/,
    ]);
    await here.filter({ hasText: 'Carthage' }).click();
    const army = page.getByTestId('army-panel');
    await expect(army.getByRole('heading', { level: 2 })).toHaveText("Carthage's Host of Hanno");
    await army
      .getByTestId('armies-here')
      .getByRole('button', { name: /^First Legion ·/ })
      .click();
    await expect(army.getByRole('heading', { level: 2 })).toHaveText('First Legion');
  });

  test('your army at a foreign city says why it does not besiege it, and besieges once at war', async ({
    page,
  }) => {
    await pause(page);
    const state = startGame();
    armyOf(state, rome).activity = { kind: 'idle', position: cityPoint('massalia') };
    await load(page, state);
    const view = camera(page);
    const banner = view.banner(cityPoint('massalia'));
    await page.mouse.click(banner.x, banner.y);
    const army = page.getByTestId('army-panel');
    await expect(army.getByTestId('army-siege-block')).toHaveText(
      'At peace with Massalia. Declare war to besiege it.',
    );

    await clickCity(page, 'massalia');
    const city = page.getByTestId('city-panel');
    await city.getByRole('button', { name: 'Declare war on Massalia' }).click();
    await city.getByRole('button', { name: 'Confirm war' }).click();
    await page.mouse.click(banner.x, banner.y);
    await expect(army.getByTestId('army-siege-block')).toHaveText(
      'War on Massalia begins with the next day, and the siege with it.',
    );
    await resume(page);
    await expect(army.getByTestId('army-activity')).toHaveText(/^Besieging Massalia · day \d+$/);
    await expect(army.getByTestId('army-siege-block')).toHaveCount(0);
  });

  test("the city panel names a taken city's rank and owner, and a minor's own city stays independent", async ({
    page,
  }) => {
    await pause(page);
    const state = startGame();
    fallenTo(state, 'mediolanum');
    await load(page, state);
    await page.getByTestId('fate-occupy').click();
    const panel = page.getByTestId('city-panel');

    await clickCity(page, 'mediolanum');
    await expect(panel.getByTestId('city-name')).toHaveText('Mediolanum');
    await expect(panel.getByText('Independent city', { exact: true })).toHaveCount(0);
    await expect(panel.getByTestId('city-rank')).toHaveText('City, taken from Mediolanum');
    await expect(panel.getByTestId('city-owner')).toHaveText('Rome (you)');

    await clickCity(page, 'massalia');
    await expect(panel.getByTestId('city-name')).toHaveText('Massalia');
    await expect(panel.getByTestId('city-rank')).toHaveText('Independent city');
    await expect(panel.getByTestId('city-owner')).toHaveText('Massalia, an independent city');

    await clickCity(page, 'roma');
    await expect(panel.getByTestId('city-rank')).toHaveText('Capital');
  });

  test('the overview lists your cities, armies, and wars, and a row shows its army', async ({
    page,
  }) => {
    await pause(page);
    const toggle = page.getByRole('button', { name: 'Overview' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const overview = page.getByTestId('overview');
    const cities = overview.getByTestId('overview-cities').getByRole('button');
    await expect(cities).toHaveCount(4);
    await expect(cities.first()).toHaveText(/^\s*Roma [\d,]+ people\s*Calm$/);
    const armies = overview.getByTestId('overview-armies').getByRole('button');
    await expect(armies).toHaveText([/^\s*First Legion [\d,]+ men\s*Idle at Roma$/]);
    await expect(overview.getByTestId('overview-wars')).toHaveText('At peace with everyone');

    const state = startGame();
    declareWar(state, rome, carthage);
    await load(page, state);
    await expect(overview.getByTestId('overview-wars')).toHaveText(
      'At war with Carthage since day 1',
    );

    await armies.first().click();
    await expect(page.getByTestId('army-panel').getByRole('heading', { level: 2 })).toHaveText(
      'First Legion',
    );
    await cities.filter({ hasText: 'Capua' }).click();
    await expect(page.getByTestId('city-panel').getByTestId('city-name')).toHaveText('Capua');
    await toggle.click();
    await expect(overview).toHaveCount(0);
  });

  test('a speed button you clicked or reached with Tab still shows its number', async ({
    page,
  }) => {
    const speed3 = page.getByRole('button', { name: 'Speed 3', exact: true });
    await speed3.click();
    await expect(speed3).toBeFocused();
    await expect(speed3).toHaveAttribute('aria-pressed', 'true');
    expect(await legibility(speed3)).toBeGreaterThanOrEqual(4.5);

    await page.keyboard.press('Shift+Tab');
    const speed2 = page.getByRole('button', { name: 'Speed 2', exact: true });
    await expect(speed2).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(speed2).toHaveAttribute('aria-pressed', 'true');
    expect(await legibility(speed2)).toBeGreaterThanOrEqual(4.5);
  });
});

for (const viewport of [
  { width: 1600, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
]) {
  test.describe(`the layout at ${viewport.width} px`, () => {
    test.use({ viewport });

    test('no panel covers the clock, the stores, or the speed buttons, and the chronicle keeps the news the corner leaves out', async ({
      page,
    }) => {
      await openGame(page);
      await load(page, musteringRome());
      await clickCity(page, 'roma');
      await expect(page.getByTestId('city-panel').getByTestId('city-name')).toHaveText('Roma');
      await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
      await untilDay(page, 13);
      await pause(page);

      const phone = viewport.width < 720;
      const alerts = page.getByTestId('alerts');
      if (phone) {
        await expect(alerts, 'the open sheet takes the place of the alerts').toBeHidden();
      } else {
        await expect(alerts.getByRole('listitem')).toHaveCount(5);
      }
      await page.getByRole('button', { name: 'Chronicle' }).click();
      const chronicle = page.getByTestId('chronicle');
      expect(await chronicle.getByRole('listitem').count()).toBeGreaterThanOrEqual(13);

      const bar = page.getByTestId('top-bar');
      const uncovered = [
        await box('the date', bar.getByTestId('time-controls-day')),
        await box('the speed', bar.getByTestId('time-controls-speed')),
        ...(await Promise.all(
          ['gold', 'food', 'manpower'].map((store) =>
            box(`the ${store}`, bar.getByTestId(`store-${store}`)),
          ),
        )),
        await box('Resume', bar.getByRole('button', { name: 'Resume' })),
        ...(await Promise.all(
          [1, 2, 3].map((speed) =>
            box(`Speed ${speed}`, bar.getByRole('button', { name: `Speed ${speed}`, exact: true })),
          ),
        )),
      ];
      const side = await box(
        'the side column',
        page.getByRole('complementary', { name: 'Selection' }),
      );
      const kept = await box('the chronicle', chronicle);
      const covering = [side, kept, ...(phone ? [] : [await box('the alert list', alerts)])];

      const offScreen = [...uncovered, ...covering]
        .filter(
          (b) =>
            b.x < 0 ||
            b.y < 0 ||
            b.x + b.width > viewport.width ||
            b.y + b.height > viewport.height,
        )
        .map((b) => b.name);
      expect(offScreen).toEqual([]);
      const covered = uncovered.flatMap((item) =>
        [...covering, ...uncovered]
          .filter((other) => other !== item && overlaps(item, other))
          .map((other) => `${other.name} covers ${item.name}`),
      );
      expect(covered).toEqual([]);
      for (const other of covering.slice(1)) {
        expect(overlaps(side, other), `the side column and ${other.name}`).toBe(false);
      }
      if (!phone) {
        expect((await box('the alert list', alerts)).height).toBeLessThanOrEqual(
          viewport.height * 0.3,
        );
      }
      expect(side.height).toBeLessThanOrEqual(phone ? viewport.height * 0.5 : viewport.height);

      const old = chronicle
        .getByRole('button')
        .filter({ hasText: /^Year 1, day 1\b/ })
        .first();
      expect(await legibility(old.locator('.text'))).toBeGreaterThanOrEqual(4.5);
    });
  });
}
