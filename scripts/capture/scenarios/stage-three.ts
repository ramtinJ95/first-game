import { nameNewArmy } from '../../../src/sim/army-names.ts';
import {
  armyOf,
  camera,
  cityPoint,
  declareWar,
  map,
  openGame,
  pause,
  playAi,
  playDays,
  rome,
  startGame,
  untilDrawn,
  withFormations,
} from '../../../e2e/support.ts';
import { loadSave } from '../../../e2e/watch.ts';
import type { PowerId } from '../../../src/sim/map.ts';
import { allocateId } from '../../../src/sim/ids.ts';
import { startMarch } from '../../../src/sim/march.ts';
import { newGame } from '../../../src/sim/new-game.ts';
import type { Army } from '../../../src/sim/state/army.ts';
import { buildWorld } from '../../../src/sim/world/world.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import type { MapPoint } from '../../../src/sim/state/map-point.ts';
import { defineScenario } from '../scenario.ts';

const ROMAN_ARMY = [
  ['spearmen', 1400],
  ['swordsmen', 1000],
  ['archers', 500],
  ['lightCavalry', 400],
  ['heavyCavalry', 400],
] as const;

const mediolanum = cityPoint('mediolanum');

/**
 * Rome's army at rest at Mediolanum, and a second on day 2 of a march north from it past
 * Lake Como, on a road the rules lay over the lake.
 */
function mediolanumAtRest(): GameState {
  const state = startGame();
  withFormations(state, armyOf(state, rome), ROMAN_ARMY).activity = {
    kind: 'idle',
    position: { ...mediolanum },
  };
  const id = allocateId(state, 'army');
  const start = { x: mediolanum.x + 4, y: mediolanum.y - 20 };
  const marching: Army = {
    id,
    owner: rome,
    name: nameNewArmy(state, rome),
    formations: [],
    stance: 'holdTheLine',
    generalSkill: 0,
    activity: { kind: 'idle', position: start },
  };
  state.armies[id] = marching;
  withFormations(state, marching, [
    ['spearmen', 1200],
    ['lightCavalry', 300],
  ]);
  const refused = startMarch(buildWorld(map), marching, start, {
    x: mediolanum.x + 6,
    y: mediolanum.y - 110,
  });
  if (refused) throw new Error(refused);
  return playDays(state, 1);
}

/** Rome besieges Mediolanum, with Novaria to its west, three days on. */
function siegeOfMediolanum(): GameState {
  const state = startGame();
  const city = state.cities['mediolanum' as keyof typeof state.cities];
  if (!city) throw new Error('no Mediolanum');
  declareWar(state, rome, city.owner);
  withFormations(state, armyOf(state, rome), ROMAN_ARMY).activity = {
    kind: 'idle',
    position: { ...mediolanum },
  };
  return playDays(state, 3);
}

interface View {
  readonly name: string;
  readonly title: string;
  readonly at: MapPoint | 'widest';
  readonly scale: number;
  readonly power?: PowerId;
  readonly state: () => GameState;
}

const VIEWS: readonly View[] = [
  {
    name: 'alexandria-rest',
    title: "Egypt's army at rest at Alexandria on day 2",
    at: cityPoint('alexandria'),
    scale: 4,
    power: 'egypt',
    state: () => playAi(newGame(map, { seed: 1, player: 'egypt' }), 1),
  },
  {
    name: 'mediolanum-rest',
    title: "Rome's army at rest at Mediolanum, by the lakes",
    at: mediolanum,
    scale: 3,
    state: mediolanumAtRest,
  },
  {
    name: 'siege-novaria',
    title: 'Rome besieges Mediolanum, with Novaria and its name to the west',
    at: { x: mediolanum.x - 12, y: mediolanum.y },
    scale: 2.2,
    state: siegeOfMediolanum,
  },
  {
    name: 'world-widest',
    title: 'The whole map at the widest zoom',
    at: 'widest',
    scale: 0,
    state: startGame,
  },
  {
    name: 'po-plain',
    title: 'The Po plain between Mediolanum and Patavium',
    at: { x: 2470, y: 1930 },
    scale: 1.2,
    state: startGame,
  },
  {
    name: 'nile-delta-closest',
    title: 'The Nile delta at the closest zoom',
    at: { x: 4070, y: 3640 },
    scale: 4,
    state: startGame,
  },
  {
    name: 'sahara-edge',
    title: 'The edge of the Sahara south of Tacape',
    at: { x: 2150, y: 3330 },
    scale: 1.6,
    state: startGame,
  },
  {
    name: 'persia-plateau-closest',
    title: 'The Persian plateau north of Persepolis at the closest zoom',
    at: { x: 6080, y: 3330 },
    scale: 4,
    state: startGame,
  },
  {
    name: 'anatolia',
    title: 'The Anatolian plateau between Ankyra and Mazaka',
    at: { x: 4290, y: 2700 },
    scale: 1.6,
    state: startGame,
  },
  {
    name: 'iberia',
    title: 'The Iberian meseta between Numantia and Carthago Nova',
    at: { x: 1330, y: 2290 },
    scale: 1.6,
    state: startGame,
  },
  {
    name: 'steppe',
    title: 'The steppe north of the Black Sea between Olbia and Tanais',
    at: { x: 4330, y: 1760 },
    scale: 1.6,
    state: startGame,
  },
  {
    name: 'persia-aspadana-closest',
    title: 'The plateau round Aspadana at the closest zoom, where the playtest found it empty',
    at: { x: 5960, y: 3170 },
    scale: 4,
    state: startGame,
  },
  {
    name: 'persia-plateau-middle',
    title: 'The Zagros and the plateau from Ekbatana to Persepolis at the middle zoom',
    at: { x: 6000, y: 3150 },
    scale: 1.6,
    state: startGame,
  },
  {
    name: 'persia-kavir',
    title: 'The salt pans of the Dasht-e Kavir below Hekatompylos',
    at: { x: 6150, y: 2880 },
    scale: 3,
    state: startGame,
  },
  {
    name: 'sahara-edge-closest',
    title: 'The arid coast south-east of Tacape at the closest zoom',
    at: { x: 2220, y: 3320 },
    scale: 4,
    state: startGame,
  },
  {
    name: 'anatolia-closest',
    title: 'The Anatolian plateau south of Ankyra at the closest zoom',
    at: { x: 4200, y: 2700 },
    scale: 4,
    state: startGame,
  },
  {
    name: 'iberia-closest',
    title: 'The meseta between Toletum and Segobriga at the closest zoom',
    at: { x: 1300, y: 2250 },
    scale: 4,
    state: startGame,
  },
  {
    name: 'steppe-closest',
    title: 'The steppe and a river north of the Black Sea at the closest zoom',
    at: { x: 4300, y: 1800 },
    scale: 4,
    state: startGame,
  },
  {
    name: 'gaul-names',
    title: 'Central Gaul west of Lugdunum, where a village was written "Hérisson, Cm."',
    at: { x: 1880, y: 1657 },
    scale: 3,
    state: startGame,
  },
];

export default defineScenario({
  name: 'stage-three',
  title: 'The views the third playtest found wanting, before and after',
  viewport: { width: 1600, height: 900 },
  async run({ page, shot }) {
    for (const view of VIEWS) {
      await openGame(page, { query: 'draw=full', power: view.power ?? 'rome' });
      await pause(page);
      await loadSave(page, view.state());
      if (view.at !== 'widest') await camera(page).jumpTo(view.at, view.scale);
      // A page that draws in software can still say "ready" for the view before the jump
      // until its next frame, so the shot first waits for the new view's chunks to be
      // sought. The figures' sheet is painted once the zoom rests, and a frame in software
      // takes seconds, so the shot then waits for the terrain, a rest, and a frame drawn
      // after it.
      await page
        .locator('canvas[data-terrain="busy"]')
        .waitFor({ timeout: 10_000 })
        .catch(() => undefined);
      const ready = page.locator('canvas[data-terrain="ready"]');
      await ready.waitFor({ timeout: 90_000 });
      await page.waitForTimeout(3000);
      await ready.waitFor({ timeout: 90_000 });
      await untilDrawn(page);
      await shot(view.name, view.title);
    }
  },
});
