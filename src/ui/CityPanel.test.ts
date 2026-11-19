import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';
import { expect, it } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import type { CityId, FactionId } from '../sim/ids.ts';
import { parseMap } from '../sim/map.ts';
import { newGame } from '../sim/new-game.ts';
import { sightOf } from '../sim/sight.ts';
import type { Day } from '../sim/state/day.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { newWar, warKey } from '../sim/state/war.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import { TROOPS } from '../sim/troops.ts';
import { buildWorld } from '../sim/world/world.ts';
import { TROOP_NAMES } from '../app/names.ts';
import type { Actions } from './actions.ts';
import CityPanel from './CityPanel.svelte';

const map = parseMap(
  JSON.parse(readFileSync(new URL('../../data/map/map.json', import.meta.url), 'utf8')),
);
const world = buildWorld(map);
const rome = 'rome' as FactionId;
const carthage = 'carthage' as FactionId;

/**
 * The thirteenth play-through's Rome on Year 5, day 212: Carthage near war, the treasury full,
 * 585 manpower, so Spearmen and Swordsmen need more men and the other four can be raised.
 */
function nearWar(): GameState {
  const state = newGame(map, { seed: 1, player: 'rome' });
  for (const id of [
    'caralis',
    'cirta',
    'iol-caesarea',
    'cidamus',
    'tarraco',
    'carthago-nova',
    'numantia',
    'burdigala',
  ] as CityId[])
    changeCityOwner(state, id, carthage);
  for (const faction of Object.values(state.factions))
    if (faction.kind === 'minor')
      state.truces[warKey(carthage, faction.id)] = { since: state.day, endsOn: 365 as Day };
  for (const army of Object.values(state.armies)) {
    const formation = state.formations[army.formations[0] as never];
    if (formation && army.owner === carthage) formation.men = 5300;
    if (formation && army.owner === rome) formation.men = 4000;
  }
  const romans = state.factions[rome];
  const punic = state.factions[carthage];
  if (!romans || !punic) throw new Error('no Rome or Carthage');
  romans.stores.gold = limitsOf(state).get(rome)?.gold ?? 0;
  romans.stores.manpower = 585;
  punic.noticeSince = 1 as Day;
  state.cities['roma' as CityId]?.buildings.push('forum', 'towers', 'canals');
  return state;
}

/** Each troop card of the city panel as the page first draws it, by troop name. */
function cardsOf(state: GameState, paused: boolean) {
  const city = state.cities['roma' as CityId];
  if (!city) throw new Error('no Roma');
  const { body } = render(CityPanel, {
    props: {
      game: state,
      map,
      world,
      city,
      sight: sightOf(state, world, rome),
      pending: [],
      occupied: new Map(),
      paused,
      actions: {} as Actions,
    },
  });
  const cards = body.slice(body.indexOf('data-testid="recruit-cards"'));
  return new Map(
    (Object.keys(TROOPS) as (keyof typeof TROOPS)[]).map((troop) => {
      const from = cards.indexOf(`>${TROOP_NAMES[troop]}</span>`);
      const to = cards.indexOf('</button>', from);
      return [troop, cards.slice(from, to).replace(/<[^>]+>/g, ' ')] as const;
    }),
  );
}

it('every troop card says something at a warning before its reckoning arrives: why it cannot be raised, or that it is reckoned', () => {
  const cards = cardsOf(nearWar(), true);
  expect(cards.get('spearmen')).toContain('Needs 415 more manpower');
  expect(cards.get('swordsmen')).toContain('Needs 415 more manpower');
  for (const troop of ['skirmishers', 'archers', 'lightCavalry', 'heavyCavalry'] as const)
    expect(cards.get(troop), troop).toContain('Reckoning what they do to the threat of Carthage…');
});

it('says nothing of a reckoning while the clock runs, where a line above the cards says to pause', () => {
  for (const [troop, card] of cardsOf(nearWar(), false))
    expect(card, troop).not.toContain('Reckoning');
});

it('a city with an enemy at its walls says so on each card, as the rules refuse its training', () => {
  const state = nearWar();
  const macedon = 'macedon' as FactionId;
  state.wars[warKey(rome, macedon)] = newWar(macedon, rome, state.day);
  const roma = state.cities['roma' as CityId];
  const army = Object.values(state.armies).find((a) => a.owner === macedon);
  if (!roma || !army) throw new Error('no Roma or Macedonian army');
  army.activity = { kind: 'idle', position: { x: roma.position.x + 1, y: roma.position.y } };
  for (const [troop, card] of cardsOf(state, true))
    expect(card, troop).toContain('An enemy is at the walls, so no training starts');
});

it('the Raising list counts one day as a day', () => {
  const state = nearWar();
  state.cities['roma' as CityId]?.recruits.push(
    { troop: 'spearmen', readyOn: (state.day + 1) as Day },
    { troop: 'archers', readyOn: (state.day + 2) as Day },
  );
  const city = state.cities['roma' as CityId];
  if (!city) throw new Error('no Roma');
  const { body } = render(CityPanel, {
    props: {
      game: state,
      map,
      world,
      city,
      sight: sightOf(state, world, rome),
      pending: [],
      occupied: new Map(),
      paused: false,
      actions: {} as Actions,
    },
  });
  const raising = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  expect(raising).toContain('Spearmen · 1 day left');
  expect(raising).toContain('Archers · 2 days left');
});

it("a card that needs more manpower names Barracks, and a card that needs nothing names none: the tester's Year 7 Rome", () => {
  const state = nearWar();
  const stores = state.factions[rome]?.stores;
  if (!stores) throw new Error('no Roman stores');
  stores.food = limitsOf(state).get(rome)?.food ?? 0;
  stores.gold = 20_000;
  const cards = cardsOf(state, false);
  for (const troop of ['spearmen', 'swordsmen'] as const) {
    expect(cards.get(troop), troop).toContain('Needs 415 more manpower');
    expect(cards.get(troop), troop).toMatch(
      /Or build Barracks at \w+ for 7,000 gold, which give [\d,]+ more men to call up and \d+\.\d more a day once built in 40 days: with them these men can be raised in about [\d,]+ days, on Year \d+, day \d+\./,
    );
  }
  for (const troop of ['skirmishers', 'archers', 'lightCavalry', 'heavyCavalry'] as const)
    expect(cards.get(troop), troop).not.toContain('Barracks');
});
