import { expect, test, type Page } from '@playwright/test';
import { changeCityOwner } from '../src/sim/cities.ts';
import type { CityId, FactionId } from '../src/sim/ids.ts';
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
  playDays,
  resume,
  rome,
  setRich,
  startGame,
  untilDrawn,
} from './support.ts';

const mediolanum = 'mediolanum' as CityId;

function amount(text: string | null): number {
  return Number((text ?? '').replace(/[^\d.-]/g, ''));
}

async function load(page: Page, state: GameState) {
  await dropSave(page, state);
  await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
    'data-day',
    String(state.day),
  );
  await untilDrawn(page);
}

/** Rome sees foreign armies only in its sight, so the Punic army visits Capua. */
function punicArmyAtCapua(state: GameState) {
  armyOf(state, carthage).activity = { kind: 'idle', position: cityPoint('capua') };
}

test.describe('the panels', () => {
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

  test('the top bar shows each store with its daily change and the date, and marks a store that runs out', async ({
    page,
  }) => {
    const bar = page.getByTestId('top-bar');
    await expect(bar.getByTestId('time-controls-day')).toHaveText(/^Year 1, day \d+$/);
    for (const store of ['gold', 'food', 'manpower']) {
      await expect(bar.getByTestId(`store-${store}-change`)).toHaveText(/^\+\d+\.\d\/day$/);
    }
    await expect(bar.getByTestId('store-gold')).not.toHaveClass(/falling/);

    const state = startGame();
    const spearmen = state.formations[armyOf(state, rome).formations[0] ?? ('' as never)];
    if (!spearmen) throw new Error('no spearmen');
    spearmen.men = 5000;
    const stores = state.factions[rome]?.stores;
    if (stores) stores.gold = 200;
    await pause(page);
    await load(page, state);
    await expect(bar.getByTestId('store-gold-amount')).toHaveText('200');
    await expect(bar.getByTestId('store-gold-change')).toHaveText(/^−\d+\.\d\/day$/);
    await expect(bar.getByTestId('store-gold')).toHaveClass(/falling/);
    await expect(bar.getByTestId('store-gold')).toContainText(/\d+ days left/);
  });

  test('a right click on land marches your selected army there with moveArmy, and Halt stops it', async ({
    page,
  }) => {
    await pause(page);
    const view = camera(page);
    await page.mouse.click(view.banner(cityPoint('roma')).x, view.banner(cityPoint('roma')).y);
    const panel = page.getByTestId('army-panel');
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Army of Rome');
    await expect(panel.getByTestId('army-activity')).toHaveText('Idle at Roma');

    const target = view.city('mediolanum');
    await page.mouse.click(target.x, target.y, { button: 'right' });
    await expect(page.getByTestId('orders-waiting')).toHaveText(
      '1 army has orders for the next day',
    );
    await resume(page);
    await expect(panel.getByTestId('army-activity')).toHaveText(
      /^Marching to Mediolanum · \d+ days left$/,
    );

    await panel.getByRole('button', { name: 'Halt' }).click();
    await expect(panel.getByTestId('army-activity')).toHaveText(/^Idle (near|at) /);
    await expect(panel.getByRole('button', { name: 'Halt' })).toHaveCount(0);
  });

  test('a stance button sets the stance of your army with setStance', async ({ page }) => {
    const view = camera(page);
    await page.mouse.click(view.banner(cityPoint('roma')).x, view.banner(cityPoint('roma')).y);
    const panel = page.getByTestId('army-panel');
    await expect(panel.getByTestId('army-general')).toHaveText(
      "General's skill 3 of 10 · Hold the line",
    );
    await panel.getByRole('button', { name: 'All-out assault' }).click();
    await expect(panel.getByTestId('army-general')).toHaveText(
      "General's skill 3 of 10 · All-out assault",
    );
    await expect(panel.getByRole('button', { name: 'All-out assault' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('a right click on a port city, from your port, offers the crossing by sea with embark', async ({
    page,
  }) => {
    await pause(page);
    const view = camera(page);
    await page.mouse.click(view.banner(cityPoint('roma')).x, view.banner(cityPoint('roma')).y);
    const massalia = view.city('massalia');
    await page.mouse.click(massalia.x, massalia.y, { button: 'right' });
    const menu = page.getByTestId('command-menu');
    await expect(menu.getByRole('menuitem')).toHaveText([
      /^Sail from Roma to Massalia \d+ days$/,
      /^March to Massalia \d+ days$/,
      'Cancel',
    ]);
    await menu.getByRole('menuitem', { name: 'Sail from Roma to Massalia' }).click();
    await expect(menu).toHaveCount(0);
    await resume(page);
    await expect(page.getByTestId('army-activity')).toHaveText(
      /^At sea (to|toward) Massalia · \d+ days left$/,
    );
  });

  test('a right click on a port covered by a battle marker still offers the crossing by sea', async ({
    page,
  }) => {
    const start = startGame();
    const macedon = 'macedon' as FactionId;
    declareWar(start, carthage, macedon);
    const salona = cityPoint('salona');
    armyOf(start, carthage).activity = { kind: 'idle', position: salona };
    armyOf(start, macedon).activity = { kind: 'idle', position: { x: salona.x, y: salona.y } };
    // Rome sees a foreign battle only in its sight, so Salona is Roman here.
    changeCityOwner(start, 'salona' as CityId, rome);
    // From Ariminum the crossing to Salona is the quicker way, so the menu offers it.
    armyOf(start, rome).activity = { kind: 'idle', position: cityPoint('ariminum') };
    const state = playDays(start, 1);
    expect(Object.keys(state.battles)).toHaveLength(1);
    await pause(page);
    await load(page, state);
    const view = camera(page);
    const at = view.city('salona');
    await page.mouse.click(at.x, at.y);
    await expect(page.getByTestId('battle-panel')).toBeVisible();
    await page.mouse.click(
      view.banner(cityPoint('ariminum')).x,
      view.banner(cityPoint('ariminum')).y,
    );
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await expect(
      page
        .getByTestId('command-menu')
        .getByRole('menuitem', { name: 'Sail from Ariminum to Salona' }),
    ).toBeVisible();
  });

  test('a foreign army shows its facts and no orders, and the panel declares war on its owner after a confirmation', async ({
    page,
  }) => {
    // Paused before the first day, so the AI cannot march Carthage's army away from Capua.
    await pause(page);
    const state = startGame();
    punicArmyAtCapua(state);
    await load(page, state);
    const view = camera(page);
    const capua = view.banner(cityPoint('capua'));
    await page.mouse.click(capua.x, capua.y);
    const panel = page.getByTestId('army-panel');
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText('Army of Carthage');
    await expect(panel.getByTestId('formation')).toHaveCount(2);
    await expect(panel.getByRole('group', { name: 'Stance' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Halt' })).toHaveCount(0);

    const war = panel.getByTestId('war-status');
    await expect(war).toContainText('At peace with Carthage');
    await war.getByRole('button', { name: 'Declare war on Carthage' }).click();
    await war.getByRole('button', { name: 'Cancel' }).click();
    await expect(war.getByRole('button', { name: 'Confirm war' })).toHaveCount(0);
    await war.getByRole('button', { name: 'Declare war on Carthage' }).click();
    await war.getByRole('button', { name: 'Confirm war' }).click();
    await resume(page);
    await expect(war).toHaveText(/At war with Carthage since day \d+/);
  });

  test('a foreign city panel declares war on its owner with declareWar', async ({ page }) => {
    const view = camera(page);
    const city = view.city('mediolanum');
    await page.mouse.click(city.x, city.y);
    const panel = page.getByTestId('city-panel');
    await expect(panel.getByTestId('city-name')).toHaveText('Mediolanum');
    await expect(panel.getByTestId('city-owner')).toHaveText('Mediolanum, an independent city');
    await expect(panel.getByRole('button', { name: /^Spearmen/ })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Declare war on Mediolanum' }).click();
    await panel.getByRole('button', { name: 'Confirm war' }).click();
    await expect(panel.getByTestId('war-status')).toHaveText(
      /At war with Mediolanum since day \d+/,
    );
  });

  test('the city panel raises a troop with recruit, shows it under way, and refuses one you cannot afford', async ({
    page,
  }) => {
    const view = camera(page);
    const roma = view.city('roma');
    await page.mouse.click(roma.x, roma.y);
    const panel = page.getByTestId('city-panel');
    const spearmen = panel.getByRole('button', { name: /^Spearmen/ });
    await expect(spearmen).toBeDisabled();
    await expect(spearmen).toContainText(/Needs [\d,]+ more gold/);

    const state = startGame();
    setRich(state);
    await pause(page);
    await load(page, state);
    await expect(spearmen).toBeEnabled();
    await panel.getByRole('button', { name: /^Skirmishers/ }).click();
    await expect(panel.getByTestId('city-raising')).toHaveText(
      'Skirmishers · ordered for the next day',
    );
    await resume(page);
    await expect(panel.getByTestId('city-raising')).toHaveText(/^Skirmishers · \d+ days left$/);
    expect(amount(await page.getByTestId('store-gold-amount').textContent())).toBeLessThan(
      20_000 - 800,
    );
  });

  test('the city panel evacuates a share of the people to another of your cities', async ({
    page,
  }) => {
    await pause(page);
    const view = camera(page);
    const roma = view.city('roma');
    await page.mouse.click(roma.x, roma.y);
    const panel = page.getByTestId('city-panel');
    const before = amount(await panel.getByTestId('city-population').textContent());
    await panel.getByLabel('Share of the people').selectOption('0.1');
    await panel.getByLabel('Destination').selectOption({ label: 'Capua' });
    const leaving = Math.floor(before * 0.1);
    await panel
      .getByRole('button', { name: `Evacuate ${leaving.toLocaleString('en')} people` })
      .click();
    await resume(page);
    await expect
      .poll(async () => amount(await panel.getByTestId('city-population').textContent()))
      .toBeLessThan(before - leaving + 100);
  });

  test('a battle shows as a marker that selects it, its panel shows both sides, and retreat pulls your army out', async ({
    page,
  }) => {
    const state = startGame();
    battleAt(state, 'mediolanum');
    await load(page, state);
    const battle = page.getByTestId('battle-panel');
    await expect(battle).toBeVisible();
    await pause(page);
    await expect(battle.getByTestId('battle-day')).toHaveText(/^day \d+$/);
    await expect(battle.getByTestId('battle-attackers')).toContainText(/men$/);
    await expect(battle.getByTestId('formation')).toHaveCount(4);

    const view = camera(page);
    const at = view.screen(cityPoint('mediolanum'));
    await page.mouse.click(at.x + 1, at.y + 6);
    await expect(battle).toBeVisible();
    await expect(page.getByTestId('city-panel')).toHaveCount(0);
    await expect(page.getByTestId('army-panel')).toHaveCount(0);

    await battle.getByRole('button', { name: /^Rome ·/ }).click();
    const army = page.getByTestId('army-panel');
    await expect(army.getByTestId('army-activity')).toHaveText(
      /^In battle (at|near) Mediolanum · day \d+$/,
    );
    await army.getByRole('button', { name: /^Retreat/ }).click();
    await resume(page);
    await expect(army.getByTestId('army-activity')).toHaveText(/^Retreating to /);
    await expect(army.getByRole('button', { name: /^Retreat/ })).toHaveCount(0);
    await expect(battle).toHaveCount(0);
  });

  test('the city panel shows a siege and storms the walls with storm', async ({ page }) => {
    let state = startGame();
    setRich(state);
    declareWar(state, rome, 'mediolanum' as FactionId);
    const army = armyOf(state, rome);
    const city = state.cities[mediolanum];
    if (!city) throw new Error('no Mediolanum');
    army.activity = { kind: 'idle', position: { ...city.position } };
    state = playDays(state, 2);
    await pause(page);
    await load(page, state);
    const view = camera(page);
    const at = view.city('mediolanum');
    await page.mouse.click(at.x, at.y);
    const panel = page.getByTestId('city-panel');
    await expect(panel.getByTestId('city-siege')).toHaveText(/^Besieged by Rome · day \d+$/);
    const garrison = amount(
      (await panel.getByTestId('city-garrison').textContent())?.split(' of ')[0] ?? '',
    );
    await panel.getByRole('button', { name: 'Storm the walls' }).click();
    await panel.getByRole('button', { name: 'Confirm storm' }).click();
    await resume(page);
    await expect
      .poll(async () => {
        const owner = await panel.getByTestId('city-owner').textContent();
        const left = amount(
          (await panel.getByTestId('city-garrison').textContent())?.split(' of ')[0] ?? '',
        );
        return owner === 'Rome (you)' || left < garrison;
      })
      .toBe(true);
  });

  for (const fate of ['sack', 'enslave'] as const) {
    test(`the city panel decides the fate of a fallen city with ${fate}`, async ({ page }) => {
      const state = startGame();
      fallenTo(state, 'mediolanum');
      await pause(page);
      await load(page, state);
      await page.getByTestId('fate-occupy').click();
      const view = camera(page);
      const at = view.city('mediolanum');
      await page.mouse.click(at.x, at.y);
      const panel = page.getByTestId('city-panel');
      await expect(panel).toContainText(/Fate of the city · \d+ days to choose/);
      const people = amount(await panel.getByTestId('city-population').textContent());
      const gold = amount(await page.getByTestId('store-gold-amount').textContent());
      await panel.getByRole('button', { name: fate === 'sack' ? /^Sack for/ : /^Enslave/ }).click();
      await resume(page);
      await expect(panel.getByTestId('city-unrest')).toHaveText(/^Unrest · 3[56]\d days left$/);
      await expect(panel).not.toContainText('Fate of the city');
      const now = amount(await panel.getByTestId('city-population').textContent());
      expect(now).toBeLessThan(people * (fate === 'sack' ? 0.61 : 0.71));
      if (fate === 'sack') {
        expect(amount(await page.getByTestId('store-gold-amount').textContent())).toBeGreaterThan(
          gold + 1000,
        );
      }
    });
  }

  test('an alert tells that your army arrived, and a click on it selects the army', async ({
    page,
  }) => {
    await pause(page);
    const view = camera(page);
    await page.mouse.click(view.banner(cityPoint('roma')).x, view.banner(cityPoint('roma')).y);
    const capua = view.city('capua');
    await page.mouse.click(capua.x, capua.y, { button: 'right' });
    await page.getByRole('button', { name: 'Speed 3', exact: true }).click();
    await resume(page);
    const alert = page.getByTestId('alerts').getByRole('button', { name: /Your army arrived/ });
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('army-panel')).toHaveCount(0);
    await alert.click();
    await expect(page.getByTestId('army-panel').getByTestId('army-activity')).toHaveText(
      /^Idle (at|near) Capua$/,
    );
  });

  test('the reason for a refused order shows for a few seconds', async ({ page }) => {
    const view = camera(page);
    await page.mouse.click(view.banner(cityPoint('roma')).x, view.banner(cityPoint('roma')).y);
    const sea = view.screen({ x: 2400, y: 2500 });
    await page.mouse.click(sea.x, sea.y, { button: 'right' });
    const notice = page.getByTestId('notice');
    await expect(notice).toHaveText('Order refused. The destination is in the sea.');
    await expect(notice).toHaveCount(0, { timeout: 6000 });
  });

  test("a foreign army's panel shows a war under way with its owner", async ({ page }) => {
    const state = startGame();
    declareWar(state, rome, carthage);
    punicArmyAtCapua(state);
    await pause(page);
    await load(page, state);
    const view = camera(page);
    const capua = view.banner(cityPoint('capua'));
    await page.mouse.click(capua.x, capua.y);
    await expect(page.getByTestId('war-status')).toHaveText(/At war with Carthage since day 1/);
  });
});
