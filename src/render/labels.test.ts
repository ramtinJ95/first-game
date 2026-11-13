import { describe, expect, it } from 'vitest';
import { fixtureWorld } from '../sim/fixture.ts';
import type { FactionId } from '../sim/ids.ts';
import { newGame } from '../sim/new-game.ts';
import { fitCamera, mapToScreen, symbolGrowth } from './camera.ts';
import { LABEL_PRIORITY, placeLabels, type Box, type LabelRequest } from './labels.ts';
import { citySymbols } from './symbols.ts';

const viewport = { width: 1000, height: 600 };

function label(id: string, x: number, y: number, extra: Partial<LabelRequest> = {}): LabelRequest {
  return {
    id,
    anchor: { x, y },
    width: 60,
    height: 14,
    clearance: { x: 5, y: 5 },
    priority: 1,
    population: 8000,
    ...extra,
  };
}

const overlap = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe('placeLabels', () => {
  it('shows every name when the cities are far apart', () => {
    const placed = placeLabels(
      [label('a', 100, 100), label('b', 500, 300), label('c', 800, 500)],
      [],
      viewport,
    );
    expect([...placed.keys()].sort()).toEqual(['a', 'b', 'c']);
  });

  it('never lets two shown names overlap, however crowded the cities are', () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const requests = Array.from({ length: 200 }, (_, i) =>
      label(`city-${i}`, random() * 400, random() * 300, {
        population: Math.floor(random() * 50_000),
      }),
    );
    const boxes = [...placeLabels(requests, [], viewport).values()];
    expect(boxes.length).toBeGreaterThan(10);
    expect(boxes.length).toBeLessThan(200);
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(overlap(a, b)).toBe(false);
    }
  });

  it('keeps the capital and then the larger city when names compete for the same place', () => {
    const crowd = [
      label('small', 300, 300, { population: 8000 }),
      label('large', 301, 300, { population: 15_000 }),
      label('capital', 302, 300, { population: 1000, priority: 0 }),
    ];
    const blockers: Box[] = [
      { left: 0, top: 0, right: 1000, bottom: 280 },
      { left: 0, top: 320, right: 1000, bottom: 600 },
    ];
    expect([...placeLabels(crowd, blockers, viewport).keys()]).toEqual(['capital', 'large']);
  });

  it('lets a city name win over a peak, a peak over a town, and a town over a village', () => {
    const onlyRightFree: Box[] = [
      { left: 0, top: 0, right: 1000, bottom: 280 },
      { left: 0, top: 320, right: 1000, bottom: 600 },
      { left: 0, top: 280, right: 299, bottom: 320 },
    ];
    const order = ['city', 'peak', 'town', 'village'] as const;
    for (const [i, higher] of order.entries()) {
      for (const lower of order.slice(i + 1)) {
        const crowd = [
          label(lower, 300, 300, { priority: LABEL_PRIORITY[lower], population: 90_000 }),
          label(higher, 300, 300, { priority: LABEL_PRIORITY[higher], population: 0 }),
        ];
        expect([...placeLabels(crowd, onlyRightFree, viewport).keys()]).toEqual([higher]);
      }
    }
  });

  it('keeps a name off the markers of other cities and off the screen edge', () => {
    const marker: Box = { left: 106, top: 96, right: 114, bottom: 104 };
    const placed = placeLabels([label('a', 100, 100), label('edge', 995, 590)], [marker], viewport);
    const a = placed.get('a');
    expect(a && overlap(a, marker)).toBe(false);
    const edge = placed.get('edge');
    expect(edge && edge.right <= 1000 && edge.bottom <= 600).toBe(true);
  });

  it("names a capital whose four sides each hold another city's symbol", () => {
    const symbol = (x: number, y: number): Box => ({
      left: x - 7,
      top: y - 7,
      right: x + 7,
      bottom: y + 7,
    });
    const neighbours = [symbol(340, 305), symbol(240, 295), symbol(300, 285), symbol(300, 315)];
    const capital = label('capital', 300, 300, { priority: LABEL_PRIORITY.capital });
    const placed = placeLabels([capital], [symbol(300, 300), ...neighbours], viewport).get(
      'capital',
    );
    expect(placed).toBeDefined();
    for (const marker of neighbours) expect(placed && overlap(placed, marker)).toBe(false);
  });

  it('names a capital boxed in on every side, over a lesser symbol but never over another name', () => {
    const everywhere: Box = { left: 0, top: 0, right: 1000, bottom: 600 };
    const placed = placeLabels(
      [
        label('capital', 300, 300, { priority: LABEL_PRIORITY.capital }),
        label('other', 300, 300, { priority: LABEL_PRIORITY.capital, population: 90_000 }),
        label('city', 300, 300),
      ],
      [everywhere],
      viewport,
    );
    expect([...placed.keys()].sort()).toEqual(['capital', 'other']);
    const [a, b] = [placed.get('capital'), placed.get('other')];
    expect(a && b && overlap(a, b)).toBe(false);
  });

  it("names every great power's capital at the widest zoom of the new game", () => {
    const { map } = fixtureWorld();
    const state = newGame(map, { seed: 1, player: 'rome' as FactionId });
    const view = { width: 1280, height: 720 };
    const camera = fitCamera(view, map);
    const grow = symbolGrowth(camera.scale);
    const extents = Object.fromEntries(
      Object.entries(citySymbols()).map(([rank, { bounds }]) => [
        rank,
        {
          x: Math.max(-bounds.minX, bounds.maxX) * grow,
          y: Math.max(-bounds.minY, bounds.maxY) * grow,
        },
      ]),
    );
    const requests: LabelRequest[] = [];
    const symbols: Box[] = [];
    for (const city of Object.values(state.cities)) {
      const at = mapToScreen(camera, view, city.position);
      const clearance = extents[city.rank] ?? { x: 7, y: 7 };
      const capital = city.rank === 'capital';
      symbols.push({
        left: at.x - clearance.x,
        top: at.y - clearance.y,
        right: at.x + clearance.x,
        bottom: at.y + clearance.y,
      });
      requests.push({
        id: city.id,
        anchor: at,
        clearance,
        // The widths of the page's serif names: 14 px capitals spaced out, 12 px italics.
        width: city.name.length * (capital ? 11.5 : 6.2),
        height: capital ? 20 : 17,
        priority: capital ? LABEL_PRIORITY.capital : LABEL_PRIORITY.city,
        population: city.population,
      });
    }
    const placed = placeLabels(requests, symbols, view);
    const capitals = Object.values(state.cities)
      .filter((city) => city.rank === 'capital')
      .map((city) => city.id as string);
    expect(capitals.sort()).toEqual(['alexandria', 'carthago', 'pella', 'persepolis', 'roma']);
    expect(capitals.filter((id) => !placed.has(id))).toEqual([]);
  });
});
