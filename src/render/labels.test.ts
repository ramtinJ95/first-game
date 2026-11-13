import { describe, expect, it } from 'vitest';
import { fixtureWorld } from '../sim/fixture.ts';
import { newGame } from '../sim/new-game.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { fitCamera, mapToScreen, screenToMap, symbolGrowth } from './camera.ts';
import { LABEL_PRIORITY, placeLabels, type Box, type LabelRequest } from './labels.ts';
import { citySymbols } from './symbols.ts';
import { Land } from './terrain/marks.ts';

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

  it('takes another spot for a name that would cross a strait onto the far shore', () => {
    const land = (p: { x: number }) => p.x < 300 || p.x > 330;
    const placed = placeLabels([label('a', 290, 300)], [], viewport, land).get('a');
    expect(placed && placed.right <= 300).toBe(true);
  });

  it('draws no name for an island whose every spot reaches another shore', () => {
    const land = (p: { x: number; y: number }) =>
      Math.hypot(p.x - 300, p.y - 300) < 8 || Math.abs(p.x - 300) > 40;
    const long = label('a', 300, 300, { width: 200 });
    expect(placeLabels([long], [], viewport, land).has('a')).toBe(false);
  });

  it("writes a capital's name on land beside a coast, where a city's takes the first spot", () => {
    const land = (p: { y: number }) => p.y > 300;
    const capital = placeLabels(
      [label('capital', 500, 298, { priority: LABEL_PRIORITY.capital })],
      [],
      viewport,
      land,
    ).get('capital');
    expect(capital && capital.top > 300).toBe(true);
    const city = placeLabels([label('city', 500, 298)], [], viewport, land).get('city');
    expect(city && city.left > 500).toBe(true);
  });

  it("names every great power's capital at the widest zoom of the new game", () => {
    const { requests, symbols, view, capitals } = widestZoom();
    const placed = placeLabels(requests, symbols, view);
    expect(capitals.sort()).toEqual(['alexandria', 'carthago', 'pella', 'persepolis', 'roma']);
    expect(capitals.filter((id) => !placed.has(id))).toEqual([]);
  });

  it('writes every name at the widest zoom on its own shore, and every capital on land', () => {
    const { requests, symbols, view, capitals, onLand } = widestZoom();
    const placed = placeLabels(requests, symbols, view, onLand);
    expect(capitals.filter((id) => !placed.has(id))).toEqual([]);
    const crossing = [...placed].filter(([id, box]) => {
      const request = requests.find((r) => r.id === id);
      if (!request) return true;
      // Open water of 20 px or more between the place and land under its name.
      const y = (box.top + box.bottom) / 2;
      const start = Math.min(box.right, Math.max(box.left, request.anchor.x));
      return [1, -1].some((way) => {
        let water = 0;
        for (let x = start; x >= box.left && x <= box.right; x += way) {
          if (!onLand({ x, y })) water++;
          else if (water >= 20) return true;
          else water = 0;
        }
        return false;
      });
    });
    expect(crossing.map(([id]) => id)).toEqual([]);
    const herakleia = placed.get('herakleia-lynkestis');
    const anchor = requests.find((r) => r.id === 'herakleia-lynkestis')?.anchor;
    if (herakleia && anchor) expect(herakleia.left).toBeGreaterThan(anchor.x - 120);
    const wet = capitals.filter((id) => {
      const box = placed.get(id);
      if (!box) return true;
      const y = (box.top + box.bottom) / 2;
      let dry = 0;
      for (let x = box.left; x <= box.right; x++) if (onLand({ x, y })) dry++;
      return dry < 0.5 * (box.right - box.left);
    });
    expect(wet).toEqual([]);
  });
});

function widestZoom() {
  const { map } = fixtureWorld();
  const land = new Land(map);
  const state = newGame(map, { seed: 1, player: 'rome' });
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
  const capitals = Object.values(state.cities)
    .filter((city) => city.rank === 'capital')
    .map((city) => city.id as string);
  const onLand = (p: MapPoint) => {
    const at = screenToMap(camera, view, p);
    return land.open(at.x, at.y);
  };
  return { requests, symbols, view, capitals, onLand };
}
