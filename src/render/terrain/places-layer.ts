import { Container, Graphics, GraphicsContext, Text } from 'pixi.js';
import type { GameMap } from '../../sim/map.ts';
import { mapToScreen, symbolGrowth, type Camera, type Size } from '../camera.ts';
import { LABEL_PRIORITY, type Box, type LabelRequest } from '../labels.ts';
import { INK, LABEL_HALO, PAPER } from '../palette.ts';
import { DETAIL, detailAlpha } from './detail.ts';
import { mix } from './draw.ts';
import { approach, claimSymbols, peakName } from './places.ts';

type Rank = 'town' | 'village';

/**
 * A symbol or name fades in over this long when it gains its place. One that loses its
 * place hides at once, since the name or symbol that took the place is already there.
 */
const FADE_MS = 220;
const SERIF = [
  'Palatino Linotype',
  'Palatino',
  'Book Antiqua',
  'Georgia',
  'Times New Roman',
  'serif',
];
const ROOF = mix(INK, 0x8a3b22, 0.35);
const ROOF_LIT = mix(PAPER, 0xa2482a, 0.75);
const WALL_SHADE = mix(PAPER, 0x6b4a2a, 0.32);

/** A house with a lit and a shaded side to its wall and roof, inked round. */
function house(g: GraphicsContext, x: number, base: number, width: number, height: number) {
  const left = x - width / 2;
  const top = base - height;
  const peak = top - width * 0.55;
  g.rect(left, top, width, height).fill(PAPER);
  g.rect(x + width * 0.15, top, width * 0.35, height).fill(WALL_SHADE);
  g.rect(left, top, width, height).stroke({ color: INK, width: 0.8, join: 'miter' });
  g.rect(x - width * 0.12, base - height * 0.55, width * 0.24, height * 0.55).fill(INK);
  g.poly([left - 0.6, top, x, peak, x, top]).fill(ROOF_LIT);
  g.poly([x, peak, x + width / 2 + 0.6, top, x, top]).fill(ROOF);
  g.poly([left - 0.6, top, x, peak, x + width / 2 + 0.6, top]).stroke({
    color: INK,
    width: 0.7,
    join: 'miter',
  });
}

/** A town is a few roofs and a small tower, a village one or two roofs: both less than a walled city. */
function settlementSymbols(): Record<Rank, GraphicsContext> {
  const town = new GraphicsContext();
  house(town, -3.2, 3, 3.6, 2.8);
  town.rect(-0.9, -3.2, 2.4, 6.2).fill(PAPER);
  town.rect(0.5, -3.2, 1, 6.2).fill(WALL_SHADE);
  town.rect(-0.9, -3.2, 2.4, 6.2).stroke({ color: INK, width: 0.9 });
  town.rect(-0.9, -4.2, 0.8, 1).fill(INK);
  town.rect(0.7, -4.2, 0.8, 1).fill(INK);
  house(town, 3.4, 3, 3.4, 2.4);
  town.moveTo(-6, 3.6).lineTo(6, 3.6).stroke({ color: INK, width: 1, cap: 'round' });
  const village = new GraphicsContext();
  house(village, 0.75, -0.75, 3.25, 2.4);
  house(village, -2.9, 2.75, 3.75, 2.75);
  house(village, 3.25, 3, 3.25, 2.4);
  village.moveTo(-5.75, 3.6).lineTo(5.75, 3.6).stroke({ color: INK, width: 0.9, cap: 'round' });
  return { town, village };
}

const HALF: Record<Rank, { x: number; y: number }> = {
  town: { x: 6.5, y: 5.5 },
  village: { x: 6.25, y: 5.5 },
};

interface Drawn {
  readonly id: string;
  readonly kind: Rank | 'peak';
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly symbol: Graphics | undefined;
  label: Text | undefined;
  symbolAlpha: number;
  symbolWanted: boolean;
  labelAlpha: number;
  labelWanted: boolean;
}

export interface PlacesLayer {
  /**
   * Places the town and village symbols that have room beside `cityBoxes` and returns
   * the name requests of the shown towns, villages, and peaks, with their symbol boxes.
   */
  layout(
    camera: Camera,
    viewport: Size,
    cityBoxes: readonly Box[],
  ): { requests: LabelRequest[]; boxes: Box[] };
  /** Shows the names that won a place, at `box`, and hides the others. */
  placeLabels(placed: ReadonlyMap<string, Box>): void;
  /** Steps the fades. Returns true while one still runs. */
  step(now: number): boolean;
}

/** Towns and villages from the map in the towns layer, and their names and the peaks' names. */
export function createPlaces(map: GameMap, towns: Container, labels: Container): PlacesLayer {
  const symbols = settlementSymbols();
  const all: Drawn[] = [
    ...map.settlements.map((s) => ({
      id: s.id,
      kind: s.rank,
      x: s.at[0],
      y: s.at[1],
      name: s.name,
      symbol: undefined,
    })),
    ...map.peaks.flatMap((p, i) => {
      const name = peakName(p.name);
      return name
        ? [
            {
              id: `peak-${i}`,
              kind: 'peak' as const,
              x: p.at[0],
              y: p.at[1],
              name,
              symbol: undefined,
            },
          ]
        : [];
    }),
  ].map((d) => ({
    ...d,
    symbol: d.kind === 'peak' ? undefined : new Graphics(symbols[d.kind]),
    label: undefined,
    symbolAlpha: 0,
    symbolWanted: false,
    labelAlpha: 0,
    labelWanted: false,
  }));
  for (const d of all) {
    if (!d.symbol) continue;
    d.symbol.visible = false;
    towns.addChild(d.symbol);
  }
  const byId = new Map(all.map((d) => [d.id, d]));
  let bands = { towns: 0, villages: 0, townNames: 0, villageNames: 0, peakNames: 0 };
  let last = 0;

  function labelFor(d: Drawn): Text {
    if (d.label) return d.label;
    const peak = d.kind === 'peak';
    d.label = new Text({
      text: d.name,
      style: {
        fontFamily: SERIF,
        fontSize: peak ? 11 : d.kind === 'town' ? 11 : 10,
        fontStyle: 'italic',
        letterSpacing: peak ? 0.6 : 0.2,
        fill: peak ? mix(INK, 0x6b4a2a, 0.5) : d.kind === 'town' ? INK : mix(INK, PAPER, 0.25),
        stroke: { color: LABEL_HALO, width: 3, join: 'round' },
      },
    });
    d.label.alpha = 0;
    labels.addChild(d.label);
    return d.label;
  }

  return {
    layout(camera, viewport, cityBoxes) {
      const scale = camera.scale;
      bands = {
        towns: detailAlpha(DETAIL.towns, scale),
        villages: detailAlpha(DETAIL.villages, scale),
        townNames: detailAlpha(DETAIL.townNames, scale),
        villageNames: detailAlpha(DETAIL.villageNames, scale),
        peakNames: detailAlpha(DETAIL.peakNames, scale),
      };
      const grow = symbolGrowth(scale);
      const onScreen: { d: Drawn; at: { x: number; y: number }; box: Box }[] = [];
      for (const d of all) {
        d.symbolWanted = false;
        d.labelWanted = false;
        const shown =
          d.kind === 'peak'
            ? bands.peakNames > 0
            : d.kind === 'town'
              ? bands.towns > 0
              : bands.villages > 0;
        if (!shown) continue;
        const at = mapToScreen(camera, viewport, { x: d.x, y: d.y });
        if (at.x < -20 || at.y < -20 || at.x > viewport.width + 20 || at.y > viewport.height + 20)
          continue;
        const peakKm = scale < 1.8 ? 11 : 5;
        const half =
          d.kind === 'peak'
            ? { x: peakKm * scale, y: peakKm * scale }
            : { x: HALF[d.kind].x * grow, y: HALF[d.kind].y * grow };
        d.symbol?.position.set(at.x, at.y);
        d.symbol?.scale.set(grow);
        onScreen.push({
          d,
          at,
          box: {
            left: at.x - half.x,
            top: at.y - half.y,
            right: at.x + half.x,
            bottom: at.y + half.y,
          },
        });
      }
      const settled = onScreen.filter(({ d }) => d.kind !== 'peak');
      const kept = claimSymbols(
        settled.map(({ d, box }) => ({
          id: d.id,
          priority: d.kind === 'town' ? 0 : 1,
          box,
        })),
        cityBoxes,
      );
      const requests: LabelRequest[] = [];
      const boxes: Box[] = [];
      for (const { d, at, box } of onScreen) {
        if (d.kind !== 'peak') {
          if (!kept.has(d.id) || !d.symbol) continue;
          d.symbolWanted = true;
          boxes.push(box);
        }
        const names =
          d.kind === 'peak'
            ? bands.peakNames
            : d.kind === 'town'
              ? bands.townNames
              : bands.villageNames;
        if (names <= 0) continue;
        const label = labelFor(d);
        requests.push({
          id: d.id,
          anchor: at,
          clearance: { x: (box.right - box.left) / 2, y: (box.bottom - box.top) / 2 },
          width: label.width,
          height: label.height,
          priority: LABEL_PRIORITY[d.kind],
          population: 0,
        });
      }
      return { requests, boxes };
    },
    placeLabels(placed) {
      for (const [id, box] of placed) {
        const d = byId.get(id);
        if (!d?.label) continue;
        d.labelWanted = true;
        d.label.position.set(box.left, box.top);
      }
    },
    step(now) {
      const dt = Math.min(100, now - last);
      last = now;
      const delta = dt / FADE_MS;
      let fading = false;
      for (const d of all) {
        if (d.symbol) {
          d.symbolAlpha = d.symbolWanted ? approach(d.symbolAlpha, 1, delta) : 0;
          const band = d.kind === 'town' ? bands.towns : bands.villages;
          d.symbol.alpha = d.symbolAlpha * band;
          d.symbol.visible = d.symbol.alpha > 0.01;
          if (d.symbolAlpha !== (d.symbolWanted ? 1 : 0)) fading = true;
        }
        if (d.label) {
          d.labelAlpha = d.labelWanted ? approach(d.labelAlpha, 1, delta) : 0;
          const band =
            d.kind === 'peak'
              ? bands.peakNames
              : d.kind === 'town'
                ? bands.townNames
                : bands.villageNames;
          d.label.alpha = d.labelAlpha * band;
          d.label.visible = d.label.alpha > 0.01;
          if (d.labelAlpha !== (d.labelWanted ? 1 : 0)) fading = true;
        }
      }
      return fading;
    },
  };
}
