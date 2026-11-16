import {
  BigPool,
  BufferImageSource,
  Container,
  Graphics,
  GraphicsContextRenderData,
  RenderTexture,
  Sprite,
  Texture,
  type Renderer,
} from 'pixi.js';
import type { GameMap, MultiPolygon } from '../../sim/map.ts';
import { coversView, fitTexture } from '../cached-texture.ts';
import { fillLand, landOutline } from '../land-outline.ts';
import { visibleRect, type Camera, type Size } from '../camera.ts';
import {
  BuildQueue,
  chunkKey,
  chunkRect,
  chunkRow,
  chunksNear,
  chunksToFree,
  OVERHANG,
} from './chunks.ts';
import { DETAIL, detailAlpha, type Band } from './detail.ts';
import { PAPER } from '../palette.ts';
import { createLakes } from './lakes.ts';
import {
  drawDesert,
  drawMarks,
  drawPans,
  drawPeaks,
  drawValleys,
  drawWoods,
  groundTint,
  TINT_CELL,
} from './draw.ts';
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
import { startupStep } from '../startup.ts';

/** Pixels of terrain drawn beyond each edge of the view, so a pan can slide the drawing. */
const CACHE_MARGIN = 256;
/** A chunk fades in over this long once it is built, so a late chunk does not pop. */
const CHUNK_FADE_MS = 260;
/**
 * A chunk fainter than this counts as not drawn, so a fade's first frame, which shows
 * almost nothing, does not draw the whole texture again on its own.
 */
const FAINT = 0.1;
const drawnAs = (alpha: number) => (alpha < FAINT ? -1 : alpha);
/**
 * While chunks the texture shows still wait to be built, those already built wait this
 * long at most to be drawn with them. On a software GPU each drawing of the texture took
 * 0.8 s of the cores that build the chunks, so drawing each as it came slowed the rest.
 */
export const BATCH_MS = 1500;

/**
 * Whether to draw the texture again this frame, and since when built chunks have waited
 * for it. `built` says chunks in view changed, `other` that something else needs drawing,
 * and `waiting` that chunks the texture shows still wait to be built.
 */
export function drawDecision(
  { built, other, waiting }: { built: boolean; other: boolean; waiting: boolean },
  now: number,
  since: number | undefined,
): { draw: boolean; since: number | undefined } {
  if (other || (built && !waiting)) return { draw: true, since: undefined };
  if (!built) return { draw: false, since };
  const start = since ?? now;
  return now - start < BATCH_MS ? { draw: false, since: start } : { draw: true, since: undefined };
}
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
/**
 * A tier keeps as many chunks as this many views like the current one hold, with the
 * ring built ahead, and frees those shown longest ago beyond them, so a pan back or a
 * zoom out and in again finds its chunks built, and a session that looks at the whole
 * map does not keep the whole map.
 */
const KEPT_VIEWS = 1;

interface Chunk {
  readonly graphics: Container;
  bornAt: number;
  usedAt: number;
  /** Its alpha in the cached texture as last drawn, or -1 when the texture lacks it. */
  drawnAlpha: number;
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
  /**
   * The borders between provinces, painted into the terrain over the relief, trees, and
   * fields. They change only with the zoom, and drawn each frame without a graphics card
   * they cost about an eighth of the frame. Call `repaint` after stroking them again.
   */
  readonly borders: Container;
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
  restroke(scale: number, outline?: MultiPolygon): void;
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
  const land = startupStep('land', () => new Land(map));

  // The ground's colour is a raster of 16 km cells drawn larger with smoothing, and the
  // watered strips follow rivers and fan out to the coast, so both are clipped to the
  // land, by one mask. The mask costs only when the cached texture is drawn again.
  const outline = landOutline(map);
  let drawnOutline = outline;
  const landMask = new Graphics();
  fillLand(landMask, outline, 0xffffff);
  const tint = startupStep('ground-tint', () => groundTint(land, map.width, map.height));
  const tintSprite = new Sprite(
    new Texture({
      source: new BufferImageSource({
        resource: tint.pixels,
        width: tint.width,
        height: tint.height,
        format: 'rgba8unorm',
      }),
    }),
  );
  tintSprite.scale.set(TINT_CELL);
  const clipped = new Container();
  clipped.addChild(
    tintSprite,
    new Graphics(drawDesert(land.terrain.filter((a) => a.kind === 'desert').map((a) => a.outline))),
    new Graphics(drawPans(land.pans)),
    new Graphics(drawValleys(land.valleys, land.deltas)),
  );
  clipped.mask = landMask;
  const paper = new Graphics();
  fillLand(paper, outline, PAPER);
  const washes = new Container({ label: 'washes' });
  const borders = new Container({ label: 'borders' });
  let repaint = true;
  const ground = new Container({ label: 'ground' });
  ground.addChild(clipped, landMask, new Graphics(drawWoods(land.woods)));

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
  art.addChild(paper, ground, washes, ...layers.map((layer) => layer.container), borders);
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
        wide.chunks.set(key, {
          graphics: chunk,
          bornAt: -Infinity,
          usedAt: Infinity,
          drawnAlpha: -1,
        });
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
      const now = performance.now();
      layer.chunks.set(key, { graphics, bornAt: now, usedAt: now, drawnAlpha: -1 });
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
  let batchSince: number | undefined;
  let stillSince = 0;

  return {
    washes,
    borders,
    repaint() {
      repaint = true;
    },
    lakes: lakes.container,
    land,
    destroy() {
      queue.destroy();
    },
    restroke(scale, nextOutline = outline) {
      if (drawnOutline !== nextOutline) {
        fillLand(paper.clear(), nextOutline, PAPER);
        fillLand(landMask.clear(), nextOutline, 0xffffff);
        // The atlas coast cuts bays out of the physical land that relief, woods and
        // borders stand on, so the whole art is clipped. That mask also clips the
        // ground, and a second one of the same shape would only fill the land again.
        const atlas = nextOutline !== outline;
        art.mask = atlas ? landMask : null;
        clipped.mask = atlas ? null : landMask;
        drawnOutline = nextOutline;
        repaint = true;
      }
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
      let built = false;
      let redrawn = false;
      const x = viewport.width / 2 - camera.centre.x * camera.scale;
      const y = viewport.height / 2 - camera.centre.y * camera.scale;
      const width = Math.ceil(viewport.width) + 2 * CACHE_MARGIN;
      const height = Math.ceil(viewport.height) + 2 * CACHE_MARGIN;
      const moves =
        !drawn ||
        drawn.scale !== camera.scale ||
        !coversView(texture, x - drawn.x - CACHE_MARGIN, y - drawn.y - CACHE_MARGIN, viewport);
      // The chunks of the whole texture are shown, margin and all, so a pan inside the
      // margin finds them drawn. A chunk that changes outside the view waits for the
      // next drawing: each drawing of the texture took 0.8 s on a software GPU, and a
      // pan drew it again whenever a chunk crossed the edge of the view.
      const at =
        moves || !drawn
          ? { x, y, width, height }
          : { x: drawn.x, y: drawn.y, width: texture.width, height: texture.height };
      const cached = {
        left: (-CACHE_MARGIN - at.x) / camera.scale,
        top: (-CACHE_MARGIN - at.y) / camera.scale,
        right: (-CACHE_MARGIN - at.x + at.width) / camera.scale,
        bottom: (-CACHE_MARGIN - at.y + at.height) / camera.scale,
      };
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
          ? new Set(chunksNear(cached, size, layer.overhang, 0, map.width, map.height))
          : new Set<number>();
        for (const key of chunksNear(
          cached,
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
        if (layer !== wide) {
          const near = chunksNear(cached, size, layer.overhang, size, map.width, map.height);
          const keep = KEPT_VIEWS * near.length;
          const usedAt = new Map(
            layer.chunks.size > keep
              ? [...layer.chunks].map(([key, chunk]) => [key, chunk.usedAt])
              : [],
          );
          const freed = chunksToFree(usedAt, wanted, keep);
          for (const key of freed) {
            layer.chunks.get(key)?.graphics.destroy({ children: true, context: true });
            layer.chunks.delete(key);
          }
          // Pixi pools a destroyed drawing's vertex buffers for the next one, at their
          // largest size, so freed chunks still held their memory in the pool.
          if (freed.length > 0) BigPool.getPool(GraphicsContextRenderData).clear();
        }
        const seen = chunksNear(view, size, layer.overhang, 0, map.width, map.height);
        const inView = new Set(layer.container.visible ? seen : []);
        for (const [key, chunk] of layer.chunks) {
          const shown = wanted.has(key);
          chunk.graphics.visible = shown;
          if (!shown) continue;
          chunk.usedAt = now;
          // Built out of sight, a chunk has no fade to show.
          if (!inView.has(key) && chunk.drawnAlpha < 0) chunk.bornAt = -Infinity;
          const age = Math.min(1, (now - chunk.bornAt) / CHUNK_FADE_MS);
          chunk.graphics.alpha = age;
          if (!inView.has(key)) continue;
          if (chunk.drawnAlpha !== drawnAs(age)) built = true;
          if (age < 1) fading = true;
        }
      }
      missing.sort((a, b) => Number(b.needed) - Number(a.needed) || a.distance - b.distance);
      queue.want(missing);
      if (queue.waitingInView) fading = true;
      const decision = drawDecision(
        { built, other: repaint || lakesStale || changed || moves, waiting: queue.waitingInView },
        now,
        batchSince,
      );
      batchSince = decision.since;
      if (decision.draw) {
        for (const layer of layers)
          for (const chunk of layer.chunks.values())
            chunk.drawnAlpha =
              layer.container.visible && chunk.graphics.visible
                ? drawnAs(chunk.graphics.alpha)
                : -1;
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
