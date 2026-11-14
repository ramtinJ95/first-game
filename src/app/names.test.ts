import { describe, expect, it } from 'vitest';
import { buildFixture } from '../sim/fixture.ts';
import { dateText, reasonText } from './names.ts';

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

describe('dateText', () => {
  it('counts days within years of 365 days', () => {
    expect(dateText(1)).toBe('Year 1, day 1');
    expect(dateText(365)).toBe('Year 1, day 365');
    expect(dateText(366)).toBe('Year 2, day 1');
  });
});
