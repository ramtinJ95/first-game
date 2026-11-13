import { describe, expect, it } from 'vitest';
import { changeCityOwner } from '../sim/cities.ts';
import { buildFixture, FIXTURE as f, fixtureWorld } from '../sim/fixture.ts';
import { fateChoices } from './fates.ts';

/** Carthago fell to Rome today with a Forum and Towers, and Rome's army stands at it. */
function carthagoFallen() {
  const state = buildFixture();
  const carthago = state.cities[f.carthago];
  const army = state.armies[f.romanArmy];
  if (!carthago || !army) throw new Error('no Carthago or no Roman army');
  carthago.buildings = ['forum', 'towers'];
  changeCityOwner(state, f.carthago, f.rome);
  carthago.fellOn = state.day;
  army.activity = { kind: 'idle', position: { ...carthago.position } };
  return state;
}

describe('fateChoices', () => {
  it('says that occupying and enslaving keep the buildings, and that a sack destroys them', () => {
    const choices = fateChoices(carthagoFallen(), fixtureWorld(), f.carthago);
    const byKind = Object.fromEntries(choices.map((choice) => [choice.kind, choice]));
    expect(byKind['occupy']).toMatchObject({
      buildingsKept: ['forum', 'towers'],
      buildingsLost: [],
    });
    expect(byKind['enslave']).toMatchObject({
      buildingsKept: ['forum', 'towers'],
      buildingsLost: [],
    });
    expect(byKind['sack']).toMatchObject({ buildingsKept: [], buildingsLost: ['forum', 'towers'] });
  });
});
