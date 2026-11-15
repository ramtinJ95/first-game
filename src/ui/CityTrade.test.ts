import { expect, test } from 'vitest';
import { render } from 'svelte/server';
import { buildFixture, fixtureWorld, FIXTURE as f } from '../sim/fixture.ts';
import { expectConsistent } from '../sim/references.ts';
import { sightOf } from '../sim/sight.ts';
import { openTrade } from '../sim/trade/orders.ts';
import type { Actions } from './actions.ts';
import CityTrade from './CityTrade.svelte';

const world = fixtureWorld();

/** Carthage invites Roma by sea and is left with `gold` once it has asked. */
function invited(gold: number) {
  const state = buildFixture();
  const carthage = state.factions[f.carthage];
  if (!carthage) throw new Error('missing Carthage');
  carthage.stores.gold = 10000;
  const invite = {
    kind: 'openTrade',
    faction: f.carthage,
    from: f.carthago,
    to: f.roma,
    mode: 'sea',
  } as const;
  expect(openTrade(state, invite, world)).toBeUndefined();
  carthage.stores.gold = gold;
  expectConsistent(state);
  const roma = state.cities[f.roma];
  if (!roma) throw new Error('missing Roma');
  const { body } = render(CityTrade, {
    props: {
      game: state,
      world,
      city: roma,
      sight: sightOf(state, world, state.player),
      pending: [],
      actions: {} as Actions,
    },
  });
  return body;
}

const acceptButton = (body: string) => /<button[^>]*>Accept trade<\/button>/.exec(body)?.[0];

test('Accept is disabled with the reason when accepting would end the invitation instead', () => {
  const body = invited(10000);
  expect(acceptButton(body)).not.toContain('disabled');
  expect(body).toContain('Accepting uses one of Roma');

  const broke = invited(1900);
  expect(acceptButton(broke)).toContain('disabled');
  expect(broke).toContain(
    'You cannot accept now: accepting would end the invitation, as the inviter must keep its military reserve.',
  );
});
