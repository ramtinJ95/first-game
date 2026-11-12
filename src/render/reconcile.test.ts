import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE } from '../sim/fixture.ts';
import type { City } from '../sim/state/city.ts';
import { reconcile } from './reconcile.ts';

interface Label {
  text: string;
  removed: boolean;
}

function labelCities(cache: Map<string, Label>, cities: City[], removed: Label[]) {
  reconcile(cache, cities, (city) => city.id, {
    create: (city) => ({ text: city.name, removed: false }),
    update: (label, city) => {
      label.text = city.name;
    },
    remove: (label) => {
      label.removed = true;
      removed.push(label);
    },
  });
}

describe('reconcile', () => {
  it('follows successive loaded states: renames a kept city and removes a city that is gone', () => {
    const cache = new Map<string, Label>();
    const removed: Label[] = [];
    const first = buildFixture();
    labelCities(cache, Object.values(first.cities), removed);
    expect([...cache.values()].map((label) => label.text).sort()).toEqual([
      'Capua',
      'Carthago',
      'Roma',
    ]);

    const second = buildFixture();
    const roma = second.cities[FIXTURE.roma];
    if (!roma) throw new Error('fixture lacks Roma');
    roma.name = 'Roma Quadrata';
    const kept = Object.values(second.cities).filter((city) => city.id !== FIXTURE.capua);
    labelCities(cache, kept, removed);
    expect([...cache.values()].map((label) => label.text).sort()).toEqual([
      'Carthago',
      'Roma Quadrata',
    ]);
    expect(removed.map((label) => label.text)).toEqual(['Capua']);

    labelCities(cache, Object.values(first.cities), removed);
    expect(cache.size).toBe(3);
    expect(cache.get(FIXTURE.roma)?.text).toBe('Roma');
  });
});
