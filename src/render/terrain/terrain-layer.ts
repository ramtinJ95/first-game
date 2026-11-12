import { Container, Graphics, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import type { GameMap, MapLine } from '../../sim/map.ts';
import { visibleRect, type Camera, type Size } from '../camera.ts';
import { toPixels } from '../lines.ts';
import { INK, SEA, WATER_LINE } from '../palette.ts';
import { chunkKey, chunkRect, chunkRow, chunksNear, OVERHANG } from './chunks.ts';
import { DETAIL, detailAlpha, type Band } from './detail.ts';
import { drawDesert, drawMarks, drawPeaks, drawValleys, drawWoods, mix } from './draw.ts';
import {
  Land,
  peaksIn,
  placeFields,
  placeRelief,
  placeTexture,
  TIERS,
  type Tier,
} from './marks.ts';
import type { Rect } from './scatter.ts';

/** Pixels of terrain drawn beyond each edge of the view, so a pan can slide the drawing. */
const CACHE_MARGIN = 256;
/** A chunk fades in over this long once it is built, so a late chunk does not pop. */
const CHUNK_FADE_MS = 260;
/**
 * Chunks are built until BUILD_BUDGET_MS of a frame has gone, and always at least one,
 * so a slow chunk delays one frame and never stalls a pan. Once the camera has rested this long, the chunks
 * around the view, and those of a tier that is within this zoom factor of fading in, are
 * built ahead, so a pan or a zoom finds most of its chunks ready.
 */
const PREFETCH_AFTER_MS = 250;
const BUILD_BUDGET_MS = 8;
const PREFETCH_ZOOM = 1.6;
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
  /**
   * How far in km a drawing can reach beyond its chunk: a mountain rises above its foot,
   * and a field or a track runs out from its place. A chunk shows while its rect grown by
   * this much meets the view, so nothing at a chunk's edge vanishes during a pan.
   */
  readonly overhang: number;
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

/**
 * Builds the terrain layer: desert and forest ground at every zoom, then three tiers of
 * relief, trees, and dunes that hand over to each other as the zoom grows, then the
 * fields of the closest zoom. Each tier is cut into square chunks that are placed and
 * drawn the first time they come into view, and kept.
 */
export function createTerrain(map: GameMap, parent: Container, renderer: Renderer): Terrain {
  const land = new Land(map);

  // The watered strips follow rivers and fan out to the coast, so they are clipped to
  // the land. The mask costs only when the cached texture is drawn again.
  const valleys = new Graphics(drawValleys(land.valleys, land.deltas));
  const landMask = new Graphics();
  for (const province of map.provinces) {
    for (const [outer] of province.outline) if (outer) landMask.poly(outer.flat()).fill(0xffffff);
  }
  valleys.mask = landMask;
  const ground = new Container({ label: 'ground' });
  ground.addChild(
    new Graphics(drawDesert(map.terrain.filter((a) => a.kind === 'desert').map((a) => a.outline))),
    valleys,
    landMask,
    new Graphics(drawWoods(land.woods)),
  );

  const tier = (name: Tier, band: Band): Layer => ({
    name,
    band,
    size: TIERS[name].chunk,
    overhang: OVERHANG[name],
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
    overhang: OVERHANG.fields,
    container: new Container({ label: 'fields' }),
    chunks: new Map(),
    build(rect) {
      const chunk = new Container();
      chunk.addChild(new Graphics(drawMarks(placeFields(land, rect), 'close')));
      return chunk;
    },
  };
  const textureLayer: Layer = {
    name: 'texture',
    band: DETAIL.textureWide,
    size: TIERS.texture.chunk,
    overhang: OVERHANG.texture,
    container: new Container({ label: 'texture' }),
    chunks: new Map(),
    build(rect) {
      const chunk = new Container();
      chunk.addChild(new Graphics(drawMarks(placeTexture(land, rect), 'wide')));
      return chunk;
    },
  };
  const layers = [
    fields,
    textureLayer,
    tier('wide', DETAIL.reliefWide),
    tier('middle', DETAIL.reliefMiddle),
    tier('close', DETAIL.reliefClose),
  ];
  // The terrain is thousands of strokes that change only when the view does, so it is
  // drawn into a texture a little larger than the screen and shown as one sprite. A pan
  // slides the sprite and draws again only after moving CACHE_MARGIN pixels.
  const art = new Container();
  art.addChild(ground, ...layers.map((layer) => layer.container));
  const root = new Container();
  root.addChild(art);
  const texture = RenderTexture.create({
    width: 1,
    height: 1,
    resolution: renderer.resolution,
    antialias: true,
  });
  const sprite = new Sprite(texture);
  parent.addChild(sprite);
  let drawn: { x: number; y: number; scale: number } | undefined;
  const shownAlpha = new Map<Layer, number>();

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

  const [, , wide] = layers;
  if (wide) {
    for (let j = 0; j * wide.size < map.height; j++) {
      for (let i = 0; i * wide.size < map.width; i++) {
        const key = chunkKey(i, j);
        const chunk = wide.build(chunkRect(wide.size, key));
        wide.chunks.set(key, { graphics: chunk, bornAt: -Infinity });
        wide.container.addChild(chunk);
      }
    }
  }
  let lastCamera: Camera = { centre: { x: NaN, y: NaN }, scale: NaN };
  let stillSince = 0;

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
      const centre = { x: (view.left + view.right) / 2, y: (view.top + view.bottom) / 2 };
      const moved =
        camera.scale !== lastCamera.scale ||
        camera.centre.x !== lastCamera.centre.x ||
        camera.centre.y !== lastCamera.centre.y;
      if (moved) stillSince = now;
      lastCamera = camera;
      const still = now - stillSince > PREFETCH_AFTER_MS;
      let fading = false;
      let changed = false;
      const missing: { layer: Layer; key: number; distance: number; needed: boolean }[] = [];
      for (const layer of layers) {
        const alpha = detailAlpha(layer.band, camera.scale);
        if (shownAlpha.get(layer) !== alpha) changed = true;
        shownAlpha.set(layer, alpha);
        layer.container.alpha = alpha;
        layer.container.visible = alpha > 0.002;
        const soon = camera.scale > layer.band.in[0] / PREFETCH_ZOOM;
        if (!layer.container.visible && !(still && soon)) continue;
        const { size } = layer;
        const wanted = new Set<number>();
        const shown = layer.container.visible
          ? new Set(chunksNear(view, size, layer.overhang, 0, map.width, map.height))
          : new Set<number>();
        for (const key of chunksNear(
          view,
          size,
          layer.overhang,
          still ? size : 0,
          map.width,
          map.height,
        )) {
          const needed = shown.has(key);
          if (needed) wanted.add(key);
          if (layer.chunks.has(key)) continue;
          const rect = chunkRect(size, key);
          const distance = Math.hypot(
            (rect.left + rect.right) / 2 - centre.x,
            (rect.top + rect.bottom) / 2 - centre.y,
          );
          missing.push({ layer, key, distance, needed });
        }
        for (const [key, chunk] of layer.chunks) {
          const shown = wanted.has(key);
          if (chunk.graphics.visible !== shown) changed = true;
          chunk.graphics.visible = shown;
          if (!shown) continue;
          const age = Math.min(1, (now - chunk.bornAt) / CHUNK_FADE_MS);
          if (chunk.graphics.alpha !== age) changed = true;
          chunk.graphics.alpha = age;
          if (age < 1) fading = true;
        }
      }
      missing.sort((a, b) => Number(b.needed) - Number(a.needed) || a.distance - b.distance);
      const started = performance.now();
      for (const { layer, key, needed } of missing) {
        if (performance.now() - started > BUILD_BUDGET_MS) break;
        const graphics = layer.build(chunkRect(layer.size, key));
        graphics.alpha = 0;
        graphics.visible = needed;
        layer.chunks.set(key, { graphics, bornAt: now });
        const row = chunkRow(key);
        let before = 0;
        for (const other of layer.chunks.keys())
          if (other !== key && chunkRow(other) <= row) before++;
        layer.container.addChildAt(graphics, Math.min(before, layer.container.children.length));
        if (needed) fading = true;
      }
      const x = viewport.width / 2 - camera.centre.x * camera.scale;
      const y = viewport.height / 2 - camera.centre.y * camera.scale;
      const width = Math.ceil(viewport.width) + 2 * CACHE_MARGIN;
      const height = Math.ceil(viewport.height) + 2 * CACHE_MARGIN;
      const resized = texture.width !== width || texture.height !== height;
      if (resized) texture.resize(width, height, renderer.resolution);
      if (
        changed ||
        resized ||
        !drawn ||
        drawn.scale !== camera.scale ||
        Math.abs(x - drawn.x) > CACHE_MARGIN ||
        Math.abs(y - drawn.y) > CACHE_MARGIN
      ) {
        art.scale.set(camera.scale);
        art.position.set(x + CACHE_MARGIN, y + CACHE_MARGIN);
        renderer.render({ container: root, target: texture, clear: true });
        drawn = { x, y, scale: camera.scale };
        sprite.scale.set(1 / camera.scale);
        sprite.position.set((-CACHE_MARGIN - x) / camera.scale, (-CACHE_MARGIN - y) / camera.scale);
      }
      return fading;
    },
  };
}
