import { Container, Graphics } from 'pixi.js';
import type { GameMap, MapLine } from '../../sim/map.ts';
import { visibleRect, type Camera, type Size } from '../camera.ts';
import { toPixels } from '../lines.ts';
import { INK, SEA, WATER_LINE } from '../palette.ts';
import { DETAIL, detailAlpha, type Band } from './detail.ts';
import { drawDesert, drawMarks, drawPeaks, drawWoods, mix } from './draw.ts';
import { Land, peaksIn, placeFields, placeRelief, TIERS, type Tier } from './marks.ts';
import type { Rect } from './scatter.ts';

/** A chunk fades in over this long once it is built, so a late chunk does not pop. */
const CHUNK_FADE_MS = 260;
/** Spare time in a frame for building chunks, and the most chunks built in one frame. */
const BUILD_BUDGET_MS = 8;
/** Lake water lines in screen pixels from the shore, like the sea's but closer. */
const LAKE_LINES = [
  { distance: 9, strength: 0.16 },
  { distance: 5.5, strength: 0.3 },
  { distance: 2.8, strength: 0.5 },
] as const;

interface Chunk {
  readonly graphics: Container;
  bornAt: number;
}

interface Layer {
  readonly name: string;
  readonly band: Band;
  readonly size: number;
  readonly container: Container;
  readonly chunks: Map<number, Chunk>;
  build(rect: Rect): Container;
}

export interface Terrain {
  /** The lakes, which sit over the washes so no owner's colour tints them. */
  readonly lakes: Container;
  readonly land: Land;
  /** Places and shows the drawings for this view. Returns true while something still fades in. */
  update(camera: Camera, viewport: Size, now: number): boolean;
  /** Rebuilds the lakes' lines at a fixed width on screen, as the renderer does for the coast. */
  restroke(scale: number): void;
}

function rectOf(size: number, key: number): Rect {
  const i = Math.floor(key / 4096);
  const j = key % 4096;
  return { left: i * size, top: j * size, right: (i + 1) * size, bottom: (j + 1) * size };
}

/**
 * Builds the terrain layer: desert and forest ground at every zoom, then three tiers of
 * relief, trees, and dunes that hand over to each other as the zoom grows, then the
 * fields of the closest zoom. Each tier is cut into square chunks that are placed and
 * drawn the first time they come into view, and kept.
 */
export function createTerrain(map: GameMap, parent: Container): Terrain {
  const land = new Land(map);

  const ground = new Container({ label: 'ground' });
  ground.addChild(
    new Graphics(drawDesert(map.terrain.filter((a) => a.kind === 'desert').map((a) => a.outline))),
    new Graphics(drawWoods(land.woods)),
  );

  const tier = (name: Tier, band: Band): Layer => ({
    name,
    band,
    size: TIERS[name].chunk,
    container: new Container({ label: name }),
    chunks: new Map(),
    build(rect) {
      const chunk = new Container();
      chunk.addChild(new Graphics(drawMarks(placeRelief(land, rect, name), name)));
      if (name !== 'wide') chunk.addChild(new Graphics(drawPeaks(peaksIn(land, rect), name)));
      return chunk;
    },
  });
  const fields: Layer = {
    name: 'fields',
    band: DETAIL.fields,
    size: TIERS.close.chunk,
    container: new Container({ label: 'fields' }),
    chunks: new Map(),
    build(rect) {
      const chunk = new Container();
      chunk.addChild(new Graphics(drawMarks(placeFields(land, rect), 'close')));
      return chunk;
    },
  };
  const layers = [
    fields,
    tier('wide', DETAIL.reliefWide),
    tier('middle', DETAIL.reliefMiddle),
    tier('close', DETAIL.reliefClose),
  ];
  parent.addChild(ground, ...layers.map((layer) => layer.container));

  const lakeOutlines = map.terrain.filter((a) => a.kind === 'lake').map((a) => a.outline);
  const lakeRings: MapLine[] = lakeOutlines.flatMap((outline) =>
    outline.flatMap((polygon) => polygon.map((ring) => [...ring, ring[0] as (typeof ring)[0]])),
  );
  const lakeFill = new Graphics();
  for (const outline of lakeOutlines) {
    for (const [outer] of outline) if (outer) lakeFill.poly(outer.flat()).fill(SEA);
  }
  const lakeMask = new Graphics();
  for (const outline of lakeOutlines) {
    for (const [outer] of outline) if (outer) lakeMask.poly(outer.flat()).fill(0xffffff);
  }
  const lakeLines = new Graphics();
  lakeLines.mask = lakeMask;
  const lakeShore = new Graphics();
  const lakes = new Container({ label: 'lakes' });
  lakes.addChild(lakeFill, lakeLines, lakeMask, lakeShore);

  function traceRings(g: Graphics, scale: number, step: number) {
    for (const ring of lakeRings) {
      const flat = toPixels(ring, scale, step);
      if (flat.length < 6) continue;
      g.moveTo(flat[0] as number, flat[1] as number);
      for (let i = 2; i < flat.length; i += 2) g.lineTo(flat[i] as number, flat[i + 1] as number);
    }
    return g;
  }

  return {
    lakes,
    land,
    restroke(scale) {
      lakeLines.clear();
      for (const { distance, strength } of LAKE_LINES) {
        traceRings(lakeLines, scale, 0.75).stroke({
          width: 2 * distance + 0.9,
          color: mix(SEA, WATER_LINE, strength),
          join: 'round',
        });
        traceRings(lakeLines, scale, 0.75).stroke({
          width: 2 * distance - 0.9,
          color: SEA,
          join: 'round',
        });
      }
      lakeShore.clear();
      traceRings(lakeShore, scale, 0.75).stroke({ width: 1.2, color: INK, join: 'round' });
      for (const g of [lakeLines, lakeShore]) g.scale.set(1 / scale);
    },
    update(camera, viewport, now) {
      const view = visibleRect(camera, viewport);
      let fading = false;
      const started = performance.now();
      for (const layer of layers) {
        const alpha = detailAlpha(layer.band, camera.scale);
        layer.container.alpha = alpha;
        layer.container.visible = alpha > 0.002;
        if (!layer.container.visible) continue;
        const { size } = layer;
        const margin = size * 0.25;
        const wanted = new Set<number>();
        const i0 = Math.max(0, Math.floor((view.left - margin) / size));
        const j0 = Math.max(0, Math.floor((view.top - margin) / size));
        const i1 = Math.floor((view.right + margin) / size);
        const j1 = Math.floor((view.bottom + margin) / size);
        const centre = { x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 };
        const missing: number[] = [];
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) {
            const key = i * 4096 + j;
            wanted.add(key);
            if (!layer.chunks.has(key)) missing.push(key);
          }
        }
        missing.sort((a, b) => {
          const ra = rectOf(size, a);
          const rb = rectOf(size, b);
          const da = Math.hypot(
            (ra.left + ra.right) / 2 - centre.x,
            (ra.top + ra.bottom) / 2 - centre.y,
          );
          const db = Math.hypot(
            (rb.left + rb.right) / 2 - centre.x,
            (rb.top + rb.bottom) / 2 - centre.y,
          );
          return da - db;
        });
        for (const key of missing) {
          if (performance.now() - started > BUILD_BUDGET_MS) {
            fading = true;
            break;
          }
          const graphics = layer.build(rectOf(size, key));
          graphics.alpha = 0;
          layer.chunks.set(key, { graphics, bornAt: now });
          const row = key % 4096;
          const before = [...layer.chunks.entries()].filter(
            ([other]) => other !== key && other % 4096 <= row,
          ).length;
          layer.container.addChildAt(graphics, Math.min(before, layer.container.children.length));
        }
        for (const [key, chunk] of layer.chunks) {
          const shown = wanted.has(key);
          chunk.graphics.visible = shown;
          if (!shown) continue;
          const age = Math.min(1, (now - chunk.bornAt) / CHUNK_FADE_MS);
          chunk.graphics.alpha = age;
          if (age < 1) fading = true;
        }
      }
      return fading;
    },
  };
}
