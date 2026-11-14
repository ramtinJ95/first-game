import { Container, Graphics, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import type { GameMap, MultiPolygon } from '../../sim/map.ts';
import { toPixels } from '../lines.ts';
import { fillLand } from '../land-outline.ts';
import { INK, SEA, WATER_LINE } from '../palette.ts';
import { mix } from './draw.ts';
import type { Rect } from './scatter.ts';
import { naturalLakeOutline } from './lake-shore.ts';

/** Lake water lines in screen pixels from the shore, like the sea's but closer. */
const LAKE_LINES = [
  { distance: 9, strength: 0.16 },
  { distance: 5.5, strength: 0.3 },
  { distance: 2.8, strength: 0.5 },
] as const;
/** Pixels drawn round each lake, so its shore line is not cut at the texture's edge. */
const PAD = 4;

interface Lake {
  readonly bounds: Rect;
  readonly rings: readonly (readonly (readonly [number, number])[])[];
  readonly art: Container;
  readonly root: Container;
  readonly lines: Graphics;
  readonly shore: Graphics;
  readonly sprite: Sprite;
  texture: RenderTexture | undefined;
}

export interface Lakes {
  /** Sits over the washes, so no owner's colour tints a lake. */
  readonly container: Container;
  /** Rebuilds the water lines at a fixed width on screen for `scale`. */
  restroke(scale: number): void;
  /**
   * Draws each lake near the view into its own small texture. `x`, `y` is where the
   * map's origin falls on screen, and `near` the screen rect worth drawing.
   */
  render(x: number, y: number, scale: number, near: Rect): void;
}

function lakeOf(source: MultiPolygon): Lake {
  const outline = naturalLakeOutline(source);
  const points = outline.flat(2);
  const xs = points.map(([px]) => px);
  const ys = points.map(([, py]) => py);
  const bounds = {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
  const fill = fillLand(new Graphics(), outline, SEA);
  const mask = fillLand(new Graphics(), outline, 0xffffff);
  const lines = new Graphics();
  lines.mask = mask;
  const shore = new Graphics();
  const art = new Container();
  art.addChild(fill, lines, mask, shore);
  const root = new Container();
  root.addChild(art);
  const rings = outline.flatMap((polygon) =>
    polygon.map((ring) => [...ring, ring[0] as (typeof ring)[0]]),
  );
  return { bounds, rings, art, root, lines, shore, sprite: new Sprite(), texture: undefined };
}

/**
 * The lakes, drawn as the sea is drawn, with water lines that follow the shore. Each
 * lake is cached in a texture of its own size, so the mask on its water lines costs
 * only when it is drawn again and a frame pays to fill the lakes and nothing round them.
 */
export function createLakes(map: GameMap, renderer: Renderer): Lakes {
  const lakes = map.terrain.filter((a) => a.kind === 'lake').map((a) => lakeOf(a.outline));
  const container = new Container({ label: 'lakes' });
  for (const lake of lakes) container.addChild(lake.sprite);

  function trace(g: Graphics, lake: Lake, scale: number) {
    for (const ring of lake.rings) {
      const flat = toPixels(ring, scale, 0.75);
      if (flat.length < 6) continue;
      g.moveTo(flat[0] as number, flat[1] as number);
      for (let i = 2; i < flat.length; i += 2) g.lineTo(flat[i] as number, flat[i + 1] as number);
    }
    return g;
  }

  return {
    container,
    restroke(scale) {
      for (const lake of lakes) {
        lake.lines.clear();
        for (const { distance, strength } of LAKE_LINES) {
          trace(lake.lines, lake, scale).stroke({
            width: 2 * distance + 0.9,
            color: mix(SEA, WATER_LINE, strength),
            join: 'round',
          });
          trace(lake.lines, lake, scale).stroke({
            width: 2 * distance - 0.9,
            color: SEA,
            join: 'round',
          });
        }
        lake.shore.clear();
        trace(lake.shore, lake, scale).stroke({ width: 1.2, color: INK, join: 'round' });
        for (const g of [lake.lines, lake.shore]) g.scale.set(1 / scale);
      }
    },
    render(x, y, scale, near) {
      for (const lake of lakes) {
        const b = lake.bounds;
        const left = Math.floor(Math.max(near.left, b.left * scale + x - PAD));
        const top = Math.floor(Math.max(near.top, b.top * scale + y - PAD));
        const right = Math.ceil(Math.min(near.right, b.right * scale + x + PAD));
        const bottom = Math.ceil(Math.min(near.bottom, b.bottom * scale + y + PAD));
        lake.sprite.visible = right > left && bottom > top;
        if (!lake.sprite.visible) continue;
        const width = right - left;
        const height = bottom - top;
        // A texture is made again at a new size, since one resized between renders
        // kept its old picture under the Canvas renderer.
        if (lake.texture?.width !== width || lake.texture.height !== height) {
          lake.texture?.destroy(true);
          lake.texture = RenderTexture.create({
            width,
            height,
            resolution: renderer.resolution,
            antialias: true,
          });
          lake.sprite.texture = lake.texture;
        }
        lake.art.scale.set(scale);
        lake.art.position.set(x - left, y - top);
        renderer.render({ container: lake.root, target: lake.texture, clear: true });
        lake.sprite.scale.set(1 / scale);
        lake.sprite.position.set((left - x) / scale, (top - y) / scale);
      }
    },
  };
}
