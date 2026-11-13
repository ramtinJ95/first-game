import { Container, Graphics, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import type { GameMap } from '../../sim/map.ts';
import { coversView, fitTexture } from '../cached-texture.ts';
import { visibleRect, type Camera, type Size } from '../camera.ts';
import { BuildQueue, chunkKey, chunkRect, chunkRow, chunksNear, OVERHANG } from './chunks.ts';
import { DETAIL, detailAlpha, type Band } from './detail.ts';
import { PAPER } from '../palette.ts';
import { createLakes } from './lakes.ts';
import { drawDesert, drawMarks, drawPeaks, drawValleys, drawWoods } from './draw.ts';
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
 * Chunks are built in slices of BUILD_SLICE_MS between frames, on a timer and not in
 * the frame, so the building runs at the speed of the main thread however slow the
 * frames are, and a frame only draws what has been built. Once the camera has rested
 * PREFETCH_AFTER_MS, the chunks around the view, and those of a tier within
 * PREFETCH_ZOOM of fading in, are built ahead, so a pan or a zoom finds most ready.
 */
const BUILD_SLICE_MS = 12;
const PREFETCH_AFTER_MS = 250;
const PREFETCH_ZOOM = 1.6;

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
  /**
   * The owners' washes, painted into the terrain over the paper and the ground and under
   * the relief, trees, and fields, so the drawings keep their ink and their lit and
   * shaded sides under every owner's colour. Call `repaint` after changing one.
   */
  readonly washes: Container;
  repaint(): void;
  /** The lakes, which sit over the washes so no owner's colour tints them. */
  readonly lakes: Container;
  readonly land: Land;
  /**
   * Places and shows the drawings for this view. Says whether something still builds or
   * fades in, and whether the cached texture was drawn again, which the frame must show.
   */
  update(camera: Camera, viewport: Size, now: number): { busy: boolean; redrawn: boolean };
  /** Rebuilds the lakes' lines at a fixed width on screen, as the renderer does for the coast. */
  restroke(scale: number): void;
  /** Stops building chunks, before the renderer is destroyed. */
  destroy(): void;
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
  const paper = new Graphics();
  for (const province of map.provinces) {
    for (const polygon of province.outline) {
      const [outer, ...holes] = polygon;
      if (!outer) continue;
      paper.poly(outer.flat()).fill(PAPER);
      for (const hole of holes) paper.poly(hole.flat()).cut();
    }
  }
  const washes = new Container({ label: 'washes' });
  let repaint = true;
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
  art.addChild(paper, ground, washes, ...layers.map((layer) => layer.container));
  const root = new Container();
  root.addChild(art);
  let texture = RenderTexture.create({
    width: 1,
    height: 1,
    resolution: renderer.resolution,
    antialias: true,
  });
  const sprite = new Sprite(texture);
  parent.addChild(sprite);
  let drawn: { x: number; y: number; scale: number } | undefined;
  const shownAlpha = new Map<Layer, number>();

  const lakes = createLakes(map, renderer);
  let lakesStale = true;

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
  type Pending = { layer: Layer; key: number; distance: number; needed: boolean };
  const queue = new BuildQueue<Pending>(
    ({ layer, key, needed }) => {
      const graphics = layer.build(chunkRect(layer.size, key));
      graphics.alpha = 0;
      graphics.visible = needed;
      layer.chunks.set(key, { graphics, bornAt: performance.now() });
      const row = chunkRow(key);
      let before = 0;
      for (const other of layer.chunks.keys())
        if (other !== key && chunkRow(other) <= row) before++;
      layer.container.addChildAt(graphics, Math.min(before, layer.container.children.length));
    },
    ({ layer, key }) => layer.chunks.has(key),
    BUILD_SLICE_MS,
  );

  let lastCamera: Camera = { centre: { x: NaN, y: NaN }, scale: NaN };
  let stillSince = 0;

  return {
    washes,
    repaint() {
      repaint = true;
    },
    lakes: lakes.container,
    land,
    destroy() {
      queue.destroy();
    },
    restroke(scale) {
      lakes.restroke(scale);
      lakesStale = true;
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
      let redrawn = false;
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
      queue.want(missing);
      if (queue.waitingInView) fading = true;
      const x = viewport.width / 2 - camera.centre.x * camera.scale;
      const y = viewport.height / 2 - camera.centre.y * camera.scale;
      const width = Math.ceil(viewport.width) + 2 * CACHE_MARGIN;
      const height = Math.ceil(viewport.height) + 2 * CACHE_MARGIN;
      if (
        repaint ||
        lakesStale ||
        changed ||
        !drawn ||
        drawn.scale !== camera.scale ||
        !coversView(texture, x - drawn.x - CACHE_MARGIN, y - drawn.y - CACHE_MARGIN, viewport)
      ) {
        texture = fitTexture(texture, width, height, renderer.resolution);
        sprite.texture = texture;
        art.scale.set(camera.scale);
        art.position.set(x + CACHE_MARGIN, y + CACHE_MARGIN);
        renderer.render({ container: root, target: texture, clear: true });
        redrawn = true;
        drawn = { x, y, scale: camera.scale };
        repaint = false;
        sprite.scale.set(1 / camera.scale);
        sprite.position.set((-CACHE_MARGIN - x) / camera.scale, (-CACHE_MARGIN - y) / camera.scale);
        lakes.render(x, y, camera.scale, {
          left: -CACHE_MARGIN,
          top: -CACHE_MARGIN,
          right: width - CACHE_MARGIN,
          bottom: height - CACHE_MARGIN,
        });
        lakesStale = false;
      }
      return { busy: fading, redrawn };
    },
  };
}
