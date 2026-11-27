import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE as f } from '../sim/fixture.ts';
import { dateText, peaceFundsText, reasonText } from './names.ts';

describe('reasonText', () => {
  const state = buildFixture();

  it('names cities and factions and drops serial ids', () => {
    expect(reasonText(state, 'city capua belongs to carthage, not rome')).toBe(
      'City Capua belongs to Carthage, not Rome',
    );
    expect(reasonText(state, 'army army-12 is in battle battle-3 and must retreat first')).toBe(
      'The army is in the battle and must retreat first',
    );
    expect(reasonText(state, 'destination 2400.5, 2500 is in the sea')).toBe(
      'The destination is in the sea',
    );
    expect(reasonText(state, 'no land route reaches 2400.5, -12.25')).toBe(
      'No land route reaches that point',
    );
  });

  it('formats calendar dates in rule refusals, including a truce and peace talks', () => {
    expect(reasonText(state, 'rome keeps a truce with carthage until day 568')).toBe(
      'Rome keeps a truce with Carthage until Year 2, day 203',
    );
    expect(reasonText(state, 'Carthage will not talk of peace before day 426.')).toBe(
      'Carthage will not talk of peace before Year 2, day 61.',
    );
  });
});

describe('reasonText amounts', () => {
  it('writes amounts with the thousands comma the news uses', () => {
    const state = buildFixture();
    expect(reasonText(state, 'Rome has 2014 gold, not the 2500 the terms ask')).toBe(
      'Rome has 2,014 gold, not the 2,500 the terms ask',
    );
    expect(reasonText(state, 'citizenRolls costs 12000 gold, but rome has 900')).toBe(
      'CitizenRolls costs 12,000 gold, but Rome has 900',
    );
  });
});

describe('dateText', () => {
  it('counts days within years of 365 days', () => {
    expect(dateText(1)).toBe('Year 1, day 1');
    expect(dateText(365)).toBe('Year 1, day 365');
    expect(dateText(366)).toBe('Year 2, day 1');
  });
});

describe('an incoming peace price against the present treasury', () => {
  it('says what the player holds and whether the offered gold is affordable', () => {
    const state = buildFixture();
    const treasury = state.factions[f.rome];
    if (!treasury) throw new Error('fixture');
    treasury.stores.gold = 8940;
    const terms = { kind: 'payment', payer: f.rome, gold: 8900, cities: [] } as const;
    expect(peaceFundsText(state, terms)).toBe(
      'You hold 8,940 gold. You can pay the 8,900 gold asked.',
    );
    treasury.stores.gold = 8899.9;
    expect(peaceFundsText(state, terms)).toBe(
      'You hold 8,899 gold. You need 1 gold more to pay the 8,900 asked.',
    );
    expect(peaceFundsText(state, { ...terms, payer: f.carthage })).toBeUndefined();
    expect(peaceFundsText(state, { kind: 'asThingsStand' })).toBeUndefined();
    treasury.stores.gold = -20.4;
    expect(peaceFundsText(state, terms)).toBe(
      'Your treasury is -21 gold. You need 8,921 gold more to pay the 8,900 asked.',
    );
    expect(peaceFundsText(state, { ...terms, gold: 0, cities: [f.capua] })).toBeUndefined();
  });
});
