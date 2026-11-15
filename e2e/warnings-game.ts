import { expect, type Page } from '@playwright/test';
import { allocateId, type CityId } from '../src/sim/ids.ts';
import type { GameState } from '../src/sim/state/game-state.ts';
import { dailyBalances, limitsOf, UPKEEP_PER_MAN } from '../src/sim/systems/economy.ts';
import { TROOPS } from '../src/sim/troops.ts';
import {
  armyOf,
  battleAt,
  carthage,
  cityPoint,
  declareWar,
  pause,
  playDays,
  rome,
  startGame,
  withFormations,
} from './support.ts';
import { loadSave } from './watch.ts';

export function foodShortfall(): GameState {
  const state = startGame();
  for (const city of Object.values(state.cities)) if (city.owner === rome) city.population = 2000;
  Object.assign(required(state.factions[rome]).stores, {
    gold: 20_000,
    manpower: 20_000,
    food: 60,
  });
  return state;
}

export function ownSiegeTomorrow(): GameState {
  const state = startGame();
  declareWar(state, rome, carthage);
  const enemy = withFormations(state, armyOf(state, carthage), [['spearmen', 2000]]);
  enemy.activity = { kind: 'idle', position: cityPoint('capua') };
  return state;
}

export function ownCityInDangerTomorrow(): GameState {
  const state = playDays(ownSiegeTomorrow(), 1);
  required(state.cities['capua' as CityId]).foodDays = 8;
  return state;
}

export function smallSallyTomorrow(): GameState {
  const state = startGame();
  battleAt(state, 'mediolanum');
  const roman = withFormations(state, armyOf(state, rome), [['spearmen', 100]]);
  const defender = Object.values(state.armies).find(
    (army) => army.owner === state.cities['mediolanum' as CityId]?.owner,
  );
  if (!defender) throw new Error('Mediolanum defender missing');
  withFormations(state, defender, [['spearmen', 150]]);
  required(state.formations[required(roman.formations[0])]).morale = 0.001;
  const id = allocateId(state, 'army');
  state.armies[id] = {
    ...roman,
    id,
    name: 'Second Legion',
    formations: [],
    activity: { kind: 'idle', position: cityPoint('capua') },
  };
  withFormations(state, state.armies[id], [['spearmen', 2000]]);
  return state;
}

export async function loadWarnings(page: Page, state: GameState) {
  await pause(page);
  await loadSave(page, state);
}

export async function showOwnCity(page: Page, name: string) {
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page
    .getByTestId('overview-cities')
    .getByRole('button', { name: new RegExp(name) })
    .click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByTestId('city-name')).toHaveText(name);
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Warning fixture record missing');
  return value;
}

/** Rome's own start with full granaries and an army grown until a spearmen raise leaves food 1.5 a day short, a gap the growing people close. */
export function slowFoodDeficit(): GameState {
  const state = startGame();
  const stores = required(state.factions[rome]).stores;
  Object.assign(stores, { gold: 20_000, manpower: 20_000 });
  const formation = required(state.formations[required(armyOf(state, rome).formations[0])]);
  const food = required(dailyBalances(state).get(rome)).food;
  const after = food - TROOPS.spearmen.recruit.men * UPKEEP_PER_MAN.food;
  formation.men += Math.round((after + 1.5) / UPKEEP_PER_MAN.food);
  stores.food = required(limitsOf(state).get(rome)).food;
  return state;
}
