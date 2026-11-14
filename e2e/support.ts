import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import {
  fitCamera,
  mapToScreen,
  panBy,
  wheelFactor,
  zoomAt,
  type Camera,
} from '../src/render/camera.ts';
import { BANNER } from '../src/render/markers.ts';
import { nameNewArmy } from '../src/sim/army-names.ts';
import { decideAll } from '../src/sim/ai/decide.ts';
import { changeCityOwner } from '../src/sim/cities.ts';
import {
  allocateId,
  type ArmyId,
  type CityId,
  type FactionId,
  type FormationId,
} from '../src/sim/ids.ts';
import { removeRecord } from '../src/sim/records.ts';
import type { Troop } from '../src/sim/troops.ts';
import { parseMap, type PowerId } from '../src/sim/map.ts';
import { newGame } from '../src/sim/new-game.ts';
import type { Order } from '../src/sim/orders/orders.ts';
import { saveGame } from '../src/sim/save.ts';
import { sightOf } from '../src/sim/sight.ts';
import type { Army } from '../src/sim/state/army.ts';
import type { Day } from '../src/sim/state/day.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import type { MapPoint } from '../src/sim/state/map-point.ts';
import { newWar, warKey } from '../src/sim/state/war.ts';
import { limitsOf } from '../src/sim/systems/economy.ts';
import { tick } from '../src/sim/tick.ts';
import { areAtWar } from '../src/sim/wars.ts';
import { buildWorld, type World } from '../src/sim/world/world.ts';

export const map = parseMap(
  JSON.parse(readFileSync(resolve(import.meta.dirname, '../data/map/map.json'), 'utf8')),
);

let world: World | undefined;

export function cityPoint(id: string): MapPoint {
  const province = map.provinces.find((p) => p.id === id);
  if (!province) throw new Error(`no province ${id}`);
  return { x: province.city[0], y: province.city[1] };
}

export const rome = 'rome' as FactionId;
export const carthage = 'carthage' as FactionId;

/**
 * The one way a browser test or a capture scenario enters a game: a running game as
 * `power`, at the widest zoom, with no start screen and no guide, by the page's
 * `?play=` query. `query` adds to it, such as `draw=full`, and `base` names another
 * server than the test's own. The news does not stop the game (`pauses=off`) unless
 * `pauses` asks for the Game menu's settings, so a test that plays through a battle at
 * speed sees it play out, and a test of the pauses says so.
 */
export async function openGame(
  page: Page,
  {
    query = '',
    power = 'rome',
    base = '',
    pauses = false,
  }: { query?: string; power?: PowerId; base?: string; pauses?: boolean } = {},
) {
  const asked = [query, pauses ? '' : 'pauses=off'].filter(Boolean).join('&');
  // Captures also call this helper outside Playwright's test runner.
  const start = async () => {
    await page.goto(`${base}/?play=${power}${asked ? `&${asked}` : ''}`);
    await page.getByTestId('top-bar').waitFor({ state: 'visible' });
  };
  if (process.env['TEST_WORKER_INDEX'] !== undefined) await test.step('game start', start);
  else await start();
}

/**
 * Waits until the map has drawn the state the page holds now. Call it once the page
 * shows the state the test wants, such as a loaded day: a click picks what the map last
 * drew. The canvas numbers each state it is given and says the latest it was given and
 * the latest it drew. One animation frame first, so the draw loop has been handed the
 * page's state, then wait until the drawn number reaches it. Counting animation frames
 * is not enough, because a frame is held while the GPU still draws the one before.
 */
export async function untilDrawn(page: Page) {
  await page.waitForFunction(
    () =>
      new Promise<boolean>((done) => {
        requestAnimationFrame(() => {
          const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
          const latest = Number(canvas?.dataset['latestState'] ?? 0);
          const check = () => {
            if (Number(canvas?.dataset['drawnState'] ?? 0) >= latest) done(true);
            else requestAnimationFrame(check);
          };
          check();
        });
      }),
  );
}

/** A new game like the one `openGame` starts, with Rome as the player. */
export function startGame(): GameState {
  return newGame(map, { seed: 1, player: 'rome' });
}

/** Plays the days through the rules, with the orders on the first of them. */
export function playDays(state: GameState, days: number, orders: Order[] = []): GameState {
  world ??= buildWorld(map);
  let current = state;
  for (let i = 0; i < days; i++) current = tick(current, i === 0 ? orders : [], world).state;
  return current;
}

export function armyOf(state: GameState, owner: FactionId): Army {
  const army = Object.values(state.armies).find((a) => a.owner === owner);
  if (!army) throw new Error(`no army of ${owner}`);
  return army;
}

export function declareWar(state: GameState, a: FactionId, b: FactionId) {
  state.wars[warKey(a, b)] = newWar(a, b, state.day);
}

export function setRich(state: GameState) {
  const stores = state.factions[rome]?.stores;
  if (stores) Object.assign(stores, { gold: 20_000, food: 5_000, manpower: 6_000 });
}

/**
 * The city's own army holds the minor city, at war with Rome, and Rome's army stands 12 km
 * east of it, so they fight the next day. A minor keeps its army at home, so the faction
 * AI does not march it out of the battle.
 */
export function battleAt(state: GameState, city: string) {
  const target = state.cities[city as CityId];
  if (!target) throw new Error(`no city ${city}`);
  declareWar(state, rome, target.owner);
  const defenders = `army-${city}` as ArmyId;
  const formations = [
    { id: `formation-${city}-spears` as FormationId, troop: 'spearmen', men: 1200 },
    { id: `formation-${city}-horse` as FormationId, troop: 'lightCavalry', men: 300 },
  ] as const;
  for (const { id, troop, men } of formations) {
    state.formations[id] = { id, army: defenders, troop, men, morale: 1 };
  }
  state.armies[defenders] = {
    id: defenders,
    owner: target.owner,
    name: nameNewArmy(state, target.owner),
    formations: formations.map(({ id }) => id),
    stance: 'holdTheLine',
    generalSkill: 3,
    activity: { kind: 'idle', position: { ...target.position } },
  };
  armyOf(state, rome).activity = {
    kind: 'idle',
    position: { x: target.position.x + 12, y: target.position.y },
  };
}

/**
 * Rome's army stands beside its own city, at war with Carthage, and a Carthaginian army
 * of the given men, two thirds spearmen and a third heavy cavalry, stands 10 km east of
 * it, so they fight the next day.
 */
export function outnumberedAt(state: GameState, city: string, enemyMen: number) {
  const target = state.cities[city as CityId];
  if (!target || target.owner !== rome) throw new Error(`${city} is not a city of Rome`);
  declareWar(state, rome, carthage);
  const at = target.position;
  armyOf(state, rome).activity = { kind: 'idle', position: { x: at.x + 2, y: at.y } };
  const invaders = 'army-invaders' as ArmyId;
  const formations = [
    { id: 'formation-invaders-spears' as FormationId, troop: 'spearmen', share: 2 / 3 },
    { id: 'formation-invaders-horse' as FormationId, troop: 'heavyCavalry', share: 1 / 3 },
  ] as const;
  for (const { id, troop, share } of formations) {
    state.formations[id] = {
      id,
      army: invaders,
      troop,
      men: Math.round(enemyMen * share),
      morale: 1,
    };
  }
  state.armies[invaders] = {
    id: invaders,
    owner: carthage,
    name: nameNewArmy(state, carthage),
    formations: formations.map(({ id }) => id),
    stance: 'holdTheLine',
    generalSkill: 3,
    activity: { kind: 'idle', position: { x: at.x + 12, y: at.y } },
  };
  return invaders;
}

/** Rome's army stands at the city, which fell to Rome today, so its fate is open. */
export function fallenTo(state: GameState, id: string) {
  const city = state.cities[id as CityId];
  if (!city) throw new Error(`no city ${id}`);
  armyOf(state, rome).activity = { kind: 'idle', position: { ...city.position } };
  changeCityOwner(state, city.id, rome);
  city.fellOn = state.day;
}

export async function dropSave(page: Page, state: GameState) {
  const dataTransfer = await page.evaluateHandle((save) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([save], 'save.json', { type: 'application/json' }));
    return transfer;
  }, saveGame(state));
  await page.dispatchEvent('canvas', 'drop', { dataTransfer });
}

/** Plays one day as the page plays it, with every faction but the player under the AI. */
export function nextDay(state: GameState): GameState {
  world ??= buildWorld(map);
  return tick(state, decideAll(state, world), world).state;
}

/**
 * The attacker's army stands at the city, at war with its owner, and the city has no
 * garrison left, so the city falls to the attacker on the next day.
 */
export function fallsTomorrow(state: GameState, city: string, attacker: FactionId) {
  const target = state.cities[city as CityId];
  if (!target) throw new Error(`no city ${city}`);
  if (!areAtWar(state, attacker, target.owner)) declareWar(state, attacker, target.owner);
  armyOf(state, attacker).activity = { kind: 'idle', position: { ...target.position } };
  target.garrison = 0;
  target.foodDays = 0;
}

/** Rome holds Roma alone, and Carthage's army takes it tomorrow. */
export function romaFallsTomorrow(): GameState {
  const state = startGame();
  for (const id of ['capua', 'arretium', 'ariminum'] as CityId[]) {
    changeCityOwner(state, id, carthage);
  }
  fallsTomorrow(state, 'roma', carthage);
  armyOf(state, rome).activity = { kind: 'idle', position: cityPoint('massalia') };
  return state;
}

/** Rome takes Mediolanum tomorrow, and nobody else is at war. */
export function mediolanumFallsTomorrow(): GameState {
  const state = startGame();
  fallsTomorrow(state, 'mediolanum', rome);
  return state;
}

/**
 * News of the world for Rome tomorrow, out of its sight: Egypt takes Carthago, the
 * capital of Carthage, whose army is away at Hadrumetum, and Macedon takes Mediolanum, on
 * Rome's border. Nobody is at war with Rome.
 */
export function worldNewsTomorrow(): GameState {
  const state = startGame();
  armyOf(state, carthage).activity = { kind: 'idle', position: cityPoint('hadrumetum') };
  fallsTomorrow(state, 'carthago', 'egypt' as FactionId);
  fallsTomorrow(state, 'mediolanum', 'macedon' as FactionId);
  return state;
}

/**
 * Rome holds 31 provinces with Roma, Carthago, and Alexandria, and takes Mediolanum
 * tomorrow, which meets the victory rule.
 */
export function romeWinsTomorrow(): GameState {
  const state = mediolanumFallsTomorrow();
  for (const id of ['carthago', 'alexandria'] as CityId[]) changeCityOwner(state, id, rome);
  const minors = Object.values(state.cities)
    .filter((city) => city.rank === 'minorCity' && city.id !== 'mediolanum')
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const city of minors.slice(0, 25)) changeCityOwner(state, city.id, rome);
  return state;
}

/** Follows the page's camera with the same maths while it drives the mouse. */
export function camera(page: Page) {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  let at: Camera = fitCamera(viewport, map);
  return {
    get camera(): Camera {
      return at;
    },
    screen: (point: MapPoint) => mapToScreen(at, viewport, point),
    city(id: string) {
      return this.screen(cityPoint(id));
    },
    /** A point on the flag of a banner whose foot stands at the map point. */
    banner(point: MapPoint) {
      const foot = this.screen(point);
      return { x: foot.x + BANNER.flagWidth / 2, y: foot.y - BANNER.pole + 5 };
    },
    async zoom(screen: MapPoint, notches: number, pauseMs = 60) {
      await page.mouse.move(screen.x, screen.y);
      for (let i = 0; i < Math.abs(notches); i++) {
        const deltaY = notches > 0 ? -100 : 100;
        await page.mouse.wheel(0, deltaY);
        at = zoomAt(at, screen, wheelFactor(deltaY), viewport, map);
        await page.waitForTimeout(pauseMs);
      }
    },
    async drag(from: MapPoint, to: MapPoint, steps = 12) {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps });
      await page.mouse.up();
      at = panBy(at, to.x - from.x, to.y - from.y, viewport, map);
    },
    /** Zooms in on a map point and brings it to the middle of the view. */
    async closeUp(point: MapPoint, notches: number) {
      await this.zoom(this.screen(point), notches);
      await this.drag(this.screen(point), { x: viewport.width / 2, y: viewport.height / 2 });
    },
    /**
     * Zooms to `scale` px per km in one wheel event and brings the point to the middle in
     * one short drag. A page that draws in software takes seconds per step of a zoom, so a
     * recorded clip starts on its subject this way.
     */
    async jumpTo(point: MapPoint, scale: number) {
      const screen = this.screen(point);
      const deltaY = -Math.log(scale / at.scale) / 0.002;
      await page.mouse.move(screen.x, screen.y);
      await page.mouse.wheel(0, deltaY);
      at = zoomAt(at, screen, wheelFactor(deltaY), viewport, map);
      await page.waitForTimeout(200);
      await this.drag(this.screen(point), { x: viewport.width / 2, y: viewport.height / 2 }, 3);
    },
  };
}

export async function pause(page: Page) {
  if (await page.getByRole('button', { name: 'Pause', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
  }
}

export async function resume(page: Page) {
  if (await page.getByRole('button', { name: 'Resume', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
  }
}

export async function day(page: Page): Promise<number> {
  return Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
}

/** Waits until the page shows `target` or a later day. */
export async function untilDay(page: Page, target: number) {
  await expect.poll(() => day(page)).toBeGreaterThanOrEqual(target);
}

/** Replaces the army's formations with fresh ones of these troops and men. */
export function withFormations(
  state: GameState,
  army: Army,
  troops: readonly (readonly [Troop, number])[],
) {
  for (const id of army.formations) removeRecord(state.formations, id);
  army.formations = [];
  for (const [troop, men] of troops) {
    const id = allocateId(state, 'formation');
    state.formations[id] = { id, army: army.id, troop, men, morale: 1 };
    army.formations.push(id);
  }
  army.generalSkill = 4;
  return army;
}

/** Rome's army of four formations: spearmen, swordsmen, archers, and heavy horse. */
export const ROMAN_FOUR = [
  ['spearmen', 1200],
  ['swordsmen', 1000],
  ['archers', 500],
  ['heavyCavalry', 400],
] as const;

/** Rome's four formations at rest beside Roma. */
export function armyAtRest(): GameState {
  const state = startGame();
  const army = withFormations(state, armyOf(state, rome), ROMAN_FOUR);
  army.activity = { kind: 'idle', position: cityPoint('roma') };
  return state;
}

/** Rome's four formations a day into a march of about five days from Roma towards Arretium. */
export function marchToCamp(): GameState {
  const state = armyAtRest();
  const army = armyOf(state, rome);
  const roma = cityPoint('roma');
  const to = { x: roma.x - 45, y: roma.y - 105 };
  return playDays(state, 1, [{ kind: 'moveArmy', faction: rome, army: army.id, to }]);
}

/**
 * Rome's four formations and Carthage's four 12 km apart outside Roma, at war, so they
 * meet the next day. Played on by the AI, Carthage's skirmishers and light horse break
 * on day 6 and its army leaves the field on day 8.
 */
export function fieldBattle(): GameState {
  const state = startGame();
  declareWar(state, rome, carthage);
  const roman = withFormations(state, armyOf(state, rome), ROMAN_FOUR);
  const punic = withFormations(state, armyOf(state, carthage), [
    ['spearmen', 1300],
    ['skirmishers', 500],
    ['lightCavalry', 400],
    ['swordsmen', 1100],
  ]);
  const roma = cityPoint('roma');
  roman.activity = { kind: 'idle', position: { x: roma.x + 30, y: roma.y - 4 } };
  punic.activity = { kind: 'idle', position: { x: roma.x + 42, y: roma.y - 4 } };
  return state;
}

/** A strong Roman army three days into the siege of Carthago, whose walls are already worn. */
export function siegeOfCarthago(): GameState {
  const state = startGame();
  declareWar(state, rome, carthage);
  const roman = withFormations(state, armyOf(state, rome), [
    ['spearmen', 1500],
    ['swordsmen', 1500],
    ['swordsmen', 1500],
    ['archers', 500],
    ['heavyCavalry', 400],
    ['spearmen', 1500],
  ]);
  armyOf(state, carthage).activity = { kind: 'idle', position: cityPoint('tacape') };
  const at = cityPoint('carthago');
  roman.activity = { kind: 'idle', position: { x: at.x - 6, y: at.y + 3 } };
  const city = state.cities['carthago' as CityId];
  if (city) Object.assign(city, { walls: 120, garrison: 1200 });
  setRich(state);
  return playDays(state, 3);
}

/** Rome's four formations twelve days out of Roma on the 20-day crossing to Caralis. */
export function crossingToCaralis(days = 12): GameState {
  const state = armyAtRest();
  const army = armyOf(state, rome);
  return playDays(state, days, [
    { kind: 'embark', faction: rome, army: army.id, to: 'caralis' as CityId },
  ]);
}

/** A third of Roma's people four days out on the road to Capua, with Rome's army away north. */
export function refugeesToCapua(): GameState {
  const state = startGame();
  armyOf(state, rome).activity = { kind: 'idle', position: cityPoint('arretium') };
  return playDays(state, 5, [
    { kind: 'evacuate', faction: rome, city: 'roma' as CityId, to: 'capua' as CityId, share: 0.3 },
  ]);
}

/** Carthago the day after Rome stormed it, with its fate still open. */
export function stormedCarthago(): GameState {
  return playDays(siegeOfCarthago(), 1, [
    { kind: 'storm', faction: rome, city: 'carthago' as CityId },
  ]);
}

/** Plays the days with every faction but the player's run by the AI, as the page plays them. */
export function playAi(state: GameState, days: number): GameState {
  world ??= buildWorld(map);
  let current = state;
  for (let i = 0; i < days; i++) current = tick(current, decideAll(current, world), world).state;
  return current;
}

/**
 * A hundred armies of four formations in a grid over Italy and its neighbours, all
 * Rome's, so every one is in sight: the load a busy front puts on the renderer.
 */
export function hundredArmies(): GameState {
  const state = startGame();
  const first = armyOf(state, rome);
  const roma = cityPoint('roma');
  for (let i = 0; i < 100; i++) {
    const id = (i === 0 ? first.id : allocateId(state, 'army')) as ArmyId;
    const army: Army =
      i === 0 ? first : { ...first, id, name: nameNewArmy(state, rome), formations: [] };
    state.armies[id] = army;
    withFormations(state, army, ROMAN_FOUR);
    army.activity = {
      kind: 'idle',
      position: { x: roma.x - 270 + (i % 10) * 60, y: roma.y - 230 + Math.floor(i / 10) * 50 },
    };
  }
  return state;
}

/** Two full armies of eight formations of 1,500 men, about to meet outside Roma. */
export function greatBattle(): GameState {
  const state = fieldBattle();
  const eight = [
    ['spearmen', 1500],
    ['spearmen', 1500],
    ['swordsmen', 1500],
    ['swordsmen', 1500],
    ['archers', 1500],
    ['skirmishers', 1500],
    ['lightCavalry', 1500],
    ['heavyCavalry', 1500],
  ] as const;
  withFormations(state, armyOf(state, rome), eight);
  withFormations(state, armyOf(state, carthage), eight);
  return state;
}

/**
 * The field battle with Rome on its way east when Carthage meets it, played by the AI
 * to day 7: the next day Rome wins and takes up its march, and Carthage retreats.
 */
export function winnerMarchesOn(): GameState {
  const start = fieldBattle();
  const roma = cityPoint('roma');
  const to = { x: roma.x + 160, y: roma.y + 30 };
  const joined = playDays(start, 1, [
    { kind: 'moveArmy', faction: rome, army: armyOf(start, rome).id, to },
  ]);
  return playAi(joined, 5);
}

/** Rome is rich, and six formations of spearmen finish their training at Roma tomorrow. */
export function sixSpearmenMusterTomorrow(): GameState {
  const state = startGame();
  setRich(state);
  const roma = state.cities['roma' as CityId];
  if (!roma) throw new Error('no Roma');
  roma.recruits = Array.from({ length: 6 }, () => ({ troop: 'spearmen', readyOn: state.day }));
  return state;
}

/**
 * Roma trains two spearmen and archers weeks from done, Rome's army is away at Arretium,
 * and a Carthaginian army stands at Roma's walls, at war, so tomorrow the siege begins
 * and Roma musters its recruits early.
 */
export function romaMustersUnderSiege(): GameState {
  const state = startGame();
  setRich(state);
  declareWar(state, rome, carthage);
  const roma = state.cities['roma' as CityId];
  if (!roma) throw new Error('no Roma');
  roma.recruits = [
    { troop: 'spearmen', readyOn: (state.day + 20) as Day },
    { troop: 'spearmen', readyOn: (state.day + 20) as Day },
    { troop: 'archers', readyOn: (state.day + 25) as Day },
  ];
  armyOf(state, rome).activity = { kind: 'idle', position: cityPoint('arretium') };
  const punic = withFormations(state, armyOf(state, carthage), [
    ['spearmen', 3000],
    ['swordsmen', 2000],
  ]);
  punic.activity = { kind: 'idle', position: { ...roma.position } };
  return state;
}

/** Mediolanum thirty days after Rome sacked it, with Rome's army still there. */
export function sackedMediolanum(): GameState {
  const state = startGame();
  fallenTo(state, 'mediolanum');
  return playDays(state, 30, [{ kind: 'sack', faction: rome, city: 'mediolanum' as CityId }]);
}

/** Mediolanum fell to Rome today with Canals and Towers standing, so its fate is open. */
export function mediolanumFallenWithBuildings(): GameState {
  const state = startGame();
  const city = state.cities['mediolanum' as CityId];
  if (!city) throw new Error('no Mediolanum');
  city.buildings = ['canals', 'towers'];
  fallenTo(state, 'mediolanum');
  return state;
}

/** Rome's food and manpower stand at their limits, so neither grows tomorrow. */
export function storesAtTheirLimits(): GameState {
  const state = startGame();
  const limit = limitsOf(state).get(rome);
  const stores = state.factions[rome]?.stores;
  if (!limit || !stores) throw new Error('no stores of Rome');
  stores.food = limit.food;
  stores.manpower = limit.manpower;
  return state;
}

/** Rome's army of 600 spearmen began the siege of Mediolanum's 1,200 today, too few to cut its food. */
export function weakSiegeOfMediolanum(): GameState {
  const state = startGame();
  const city = state.cities['mediolanum' as CityId];
  if (!city) throw new Error('no Mediolanum');
  declareWar(state, rome, city.owner);
  const army = withFormations(state, armyOf(state, rome), [['spearmen', 600]]);
  army.activity = { kind: 'idle', position: { x: city.position.x + 4, y: city.position.y } };
  return playDays(state, 1);
}

/**
 * The power's starting army, cut to 500 men, is beaten by the enemy's starting army at
 * the enemy's city across the sea. The state is the first day the beaten army retreats,
 * with the power as the player, so its panel shows where the retreat goes.
 */
export function beatenOverseas(power: PowerId, enemy: PowerId, at: string): GameState {
  world ??= buildWorld(map);
  let state = newGame(map, { seed: 1, player: power });
  const ours = power as string as FactionId;
  const theirs = enemy as string as FactionId;
  declareWar(state, ours, theirs);
  const where = cityPoint(at);
  const [loser, ...others] = Object.values(state.armies).filter((a) => a.owner === ours);
  const winner = armyOf(state, theirs);
  if (!loser) throw new Error(`no army of ${power}`);
  for (const other of others) other.activity = { kind: 'idle', position: { x: 0, y: 0 } };
  for (const id of loser.formations.slice(1)) removeRecord(state.formations, id);
  loser.formations = loser.formations.slice(0, 1);
  const formation = state.formations[loser.formations[0] as FormationId];
  if (formation) formation.men = 500;
  loser.activity = { kind: 'idle', position: { x: where.x - 4, y: where.y } };
  winner.activity = { kind: 'idle', position: { x: where.x - 2, y: where.y } };
  for (let day = 0; day < 60; day++) {
    state = tick(state, [], world).state;
    const activity = state.armies[loser.id]?.activity.kind;
    if (activity === 'retreating') return state;
    if (!activity) throw new Error(`${power} lost its army at ${at}`);
  }
  throw new Error(`${power} was not beaten at ${at}`);
}

/**
 * Carthage's army at sea on its way from Carthago to Roma, at war with Rome, on the last
 * day before its fleet comes into Rome's sight.
 */
export function carthageSailsOnRoma(): GameState {
  world ??= buildWorld(map);
  const state = startGame();
  declareWar(state, rome, carthage);
  const punic = armyOf(state, carthage);
  punic.activity = { kind: 'idle', position: cityPoint('carthago') };
  let current = playDays(state, 1, [
    { kind: 'embark', faction: carthage, army: punic.id, to: 'roma' as CityId },
  ]);
  for (let day = 0; day < 60; day++) {
    const next = playDays(current, 1);
    const seen = sightOf(next, world, rome);
    if (Object.values(next.convoys).some((convoy) => seen.convoys.has(convoy.id))) return current;
    current = next;
  }
  throw new Error("Carthage's fleet never came into Rome's sight");
}

/**
 * Carthage at war with Rome sends five armies of 400, 302, 396, 382, and 649 men from
 * Carthago to Roma, each in its own fleet, on the day before Rome first sees them.
 */
export function fiveFleetsOnRoma(): GameState {
  world ??= buildWorld(map);
  const state = startGame();
  declareWar(state, rome, carthage);
  const first = armyOf(state, carthage);
  const orders: Order[] = [400, 302, 396, 382, 649].map((men, i) => {
    const id = (i === 0 ? first.id : allocateId(state, 'army')) as ArmyId;
    const army: Army =
      i === 0 ? first : { ...first, id, name: nameNewArmy(state, carthage), formations: [] };
    state.armies[id] = army;
    withFormations(state, army, [['spearmen', men]]);
    army.activity = { kind: 'idle', position: cityPoint('carthago') };
    return { kind: 'embark', faction: carthage, army: id, to: 'roma' as CityId };
  });
  let current = playDays(state, 1, orders);
  for (let day = 0; day < 60; day++) {
    const next = playDays(current, 1);
    const seen = sightOf(next, world, rome);
    if (Object.values(next.convoys).some((convoy) => seen.convoys.has(convoy.id))) return current;
    current = next;
  }
  throw new Error("Carthage's fleets never came into Rome's sight");
}

/**
 * The centre of the part of the page the top bar, the overview, and the side column
 * leave clear, where the page centres what the player chose.
 */
export async function clearCentre(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      return element && element.childElementCount > 0 ? element.getBoundingClientRect() : undefined;
    };
    const top = box('[data-testid="top-bar"]')?.bottom ?? 0;
    const left = box('[data-testid="overview"]')?.right ?? 0;
    const side = box('aside[aria-label="Selection"]');
    const right = side ? side.left : window.innerWidth;
    return { x: (left + right) / 2, y: (top + window.innerHeight) / 2 };
  });
}

/**
 * How many screen frames the page takes for each frame its map draws, over a few drawn
 * frames, so a test can count a wait in the page's own frames on a slow or a fast GPU.
 * The full drawing draws every frame. The test drawing draws only on a change.
 */
export function framePace(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((done) => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-renderer]');
        const drawn = () => Number(canvas?.dataset['drawnFrames'] ?? 0);
        const start = drawn();
        let screens = 0;
        const tick = () => {
          screens += 1;
          if (drawn() >= start + 4) done(screens / 4);
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
  );
}

/**
 * Resizes the page and waits until the map has followed: the GPU has finished a frame of
 * the window's size, which the screen then shows (`data-drawn-size` on the canvas). The
 * canvas element takes the new size at once, so its own size says nothing. Gives how many
 * screen frames that took. The capture's layout and resize scenarios share it.
 */
export async function resizeTo(page: Page, size: { width: number; height: number }) {
  await page.evaluate(() => {
    const counted = window as unknown as { resizeScreens: number; resizeCounting?: number };
    counted.resizeScreens = 0;
    const count = () => {
      counted.resizeScreens += 1;
      counted.resizeCounting = requestAnimationFrame(count);
    };
    counted.resizeCounting = requestAnimationFrame(count);
  });
  try {
    await page.setViewportSize(size);
    await page.waitForFunction(
      ({ width, height }) =>
        window.innerWidth === width &&
        window.innerHeight === height &&
        document.querySelector<HTMLCanvasElement>('canvas[data-renderer]')?.dataset['drawnSize'] ===
          `${width}x${height}`,
      size,
    );
    return await page.evaluate(
      () => (window as unknown as { resizeScreens: number }).resizeScreens,
    );
  } finally {
    await page.evaluate(() => {
      const counted = window as unknown as { resizeCounting?: number };
      if (counted.resizeCounting !== undefined) cancelAnimationFrame(counted.resizeCounting);
    });
  }
}

/**
 * Rome at war with Carthage lands its army at Carthago's harbour against Carthage's army
 * made three times as large, loses, and falls back into the field near Hadrumetum, where
 * it stands idle with no port of Rome on that shore.
 */
export function beatenNearHadrumetum(): GameState {
  world ??= buildWorld(map);
  let state = startGame();
  declareWar(state, rome, carthage);
  const romans = armyOf(state, rome);
  romans.activity = {
    kind: 'idle',
    position: { ...(world.harbours.get('carthago' as never) as MapPoint) },
  };
  for (const army of Object.values(state.armies).filter((a) => a.owner === carthage)) {
    for (const id of army.formations) {
      const formation = state.formations[id];
      if (formation) formation.men *= 3;
    }
  }
  for (let i = 0; i < 90 && state.armies[romans.id]?.activity.kind !== 'retreating'; i++) {
    state = tick(state, [], world).state;
  }
  for (let i = 0; i < 90 && state.armies[romans.id]?.activity.kind !== 'idle'; i++) {
    state = tick(state, [], world).state;
  }
  return structuredClone(state) as GameState;
}

/**
 * Rome at war with the city's owner, with Rome's army idle on land `km` west of it, too far
 * to besiege it, and no army of the owner anywhere, so a march there besieges it at once.
 */
export function idleBesideEnemyCity(id: string, km = 15): GameState {
  const state = startGame();
  const city = state.cities[id as never];
  if (!city) throw new Error(`no city ${id}`);
  declareWar(state, rome, city.owner);
  for (const army of Object.values(state.armies)) {
    if (army.owner !== city.owner) continue;
    for (const formation of army.formations) removeRecord(state.formations, formation);
    removeRecord(state.armies, army.id);
  }
  armyOf(state, rome).activity = {
    kind: 'idle',
    position: { x: city.position.x - km, y: city.position.y },
  };
  return state;
}

/**
 * Rome's strong army besieges Carthago in a war Rome declared 123 days ago, so Carthage
 * takes peace as things stand and refuses to pay for it.
 */
export function siegeToEndInPeace(): GameState {
  const state = siegeOfCarthago();
  state.day = (state.day + 120) as Day;
  return state;
}

/**
 * Rome took Hadrumetum from Carthage in a war that has run 300 days, so Carthage offers
 * to pay for peace with the next day.
 */
export function carthageOffersPeace(): GameState {
  const state = startGame();
  declareWar(state, carthage, rome);
  changeCityOwner(state, 'hadrumetum' as CityId, rome);
  state.day = (state.day + 300) as Day;
  return state;
}

/**
 * The tester's case in year 2: Carthage and Macedon declared war on Rome on day 400.
 * Carthage took Capua and Macedon took Epidamnos, and Macedon besieges Salona, so Rome
 * holds five cities on two fronts.
 */
export function romeOnTwoFronts(): GameState {
  const state = startGame();
  for (const id of ['mediolanum', 'salona', 'epidamnos'])
    changeCityOwner(state, id as CityId, rome);
  state.day = 400 as Day;
  const macedon = 'macedon' as FactionId;
  declareWar(state, carthage, rome);
  declareWar(state, macedon, rome);
  changeCityOwner(state, 'capua' as CityId, carthage);
  changeCityOwner(state, 'epidamnos' as CityId, macedon);
  const salona = cityPoint('salona');
  armyOf(state, macedon).activity = {
    kind: 'idle',
    position: { x: salona.x + 6, y: salona.y + 4 },
  };
  armyOf(state, carthage).activity = { kind: 'idle', position: cityPoint('capua') };
  state.day = 500 as Day;
  return playDays(state, 1);
}
