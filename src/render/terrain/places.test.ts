import { describe, expect, it } from 'vitest';
import { fixtureWorld } from '../../sim/fixture.ts';
import { claimSymbols, PEAK_NAMES, peakName } from './places.ts';

const box = (x: number, y: number, half = 5) => ({
  left: x - half,
  top: y - half,
  right: x + half,
  bottom: y + half,
});

describe('claimSymbols', () => {
  it('lets a city win a place over a town, and a town over a village', () => {
    const city = box(100, 100, 10);
    const kept = claimSymbols(
      [
        { id: 'village-near-town', priority: 1, box: box(203, 100) },
        { id: 'town', priority: 0, box: box(200, 100) },
        { id: 'town-under-city', priority: 0, box: box(104, 100) },
        { id: 'village-alone', priority: 1, box: box(400, 100) },
      ],
      [city],
    );
    expect([...kept].sort()).toEqual(['town', 'village-alone']);
  });

  it('never keeps two symbols that overlap', () => {
    let seed = 3;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const requests = Array.from({ length: 300 }, (_, i) => ({
      id: `s-${i}`,
      priority: i % 2,
      box: box(random() * 500, random() * 300),
    }));
    const kept = requests.filter((r) => claimSymbols(requests, []).has(r.id));
    for (const [i, a] of kept.entries()) {
      for (const b of kept.slice(i + 1)) {
        const overlap =
          a.box.left < b.box.right &&
          b.box.left < a.box.right &&
          a.box.top < b.box.bottom &&
          b.box.top < a.box.bottom;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe('the names the map draws', () => {
  it('are plain names, with no bracket, star, or question mark', () => {
    const { map } = fixtureWorld();
    const names = [
      ...map.provinces.map((p) => p.name),
      ...map.settlements.map((s) => s.name),
      ...map.peaks.map((p) => p.name),
    ];
    expect(names.length).toBeGreaterThan(500);
    expect(names.filter((name) => /[()[\]*?]/.test(name))).toEqual([]);
  });
});

describe('peakName', () => {
  it('names a peak only by its classical name, and every name in the table marks a peak of the map', () => {
    const { map } = fixtureWorld();
    const named = map.peaks.flatMap((peak) => {
      const name = peakName(peak.name);
      return name ? [name] : [];
    });
    expect(named.sort()).toEqual([
      'Aetna',
      'Argaeus',
      'Hermon',
      'Ida',
      'Olympus',
      'Olympus',
      'Olympus',
      'Vesuvius',
    ]);
    const modern = new Set(map.peaks.map((peak) => peak.name));
    expect(Object.keys(PEAK_NAMES).filter((name) => !modern.has(name))).toEqual([]);
    expect(peakName('Mont Blanc')).toBeUndefined();
  });
});
