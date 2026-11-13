import {
  BlurFilter,
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  Texture,
  TilingSprite,
  type Renderer,
} from 'pixi.js';
import type { ProvinceId } from '../sim/ids.ts';
import type { GameMap } from '../sim/map.ts';
import type { Sight, SightCircle } from '../sim/sight.ts';
import type { MapPoint } from '../sim/state/map-point.ts';
import { fitTexture } from './cached-texture.ts';
import { toPixels } from './lines.ts';
import { INK } from './palette.ts';

/**
 * The fog's look. The land, the cities, and their owners are always known, so the fog
 * marks where sight ends and does not dim the world: pen hatching in a band `bandKm`
 * wide outside the edge of sight, strongest at the edge, and a faint tone beyond. Its
 * masks are drawn in km, one texel to `kmPerTexel`, so a pan never redraws them.
 */
export const FOG = {
  kmPerTexel: 8,
  /** How far the inner edge of the band fades, so the edge is soft but still exact. */
  softKm: 16,
  bandKm: 140,
  shade: 0x4a3720,
  shadeAlpha: 0.07,
  hatch: { spacing: 6, width: 1.1, alpha: 0.55 },
  /** The mask is redrawn once a source of sight has moved this far. */
  redrawKm: 1,
} as const;

/**
 * The circles of sight between two days, each moving source `progress` of the way
 * from where it stood on the previous day. A source that was not there the day
 * before stands at its current place.
 */
export function fogCircles(previous: Sight, current: Sight, progress: number): SightCircle[] {
  const before = new Map(previous.circles.map((circle) => [circle.key, circle.centre]));
  return current.circles.map((circle) => {
    const from = before.get(circle.key) ?? circle.centre;
    const to = circle.centre;
    return {
      ...circle,
      centre: { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress },
    };
  });
}

/** A tile of diagonal pen strokes, made here so the page fetches no image. */
function hatchTexture(): Texture {
  const { spacing, width, alpha } = FOG.hatch;
  const size = spacing * 4;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('fog: no 2D canvas context');
  const ink = [(INK >> 16) & 0xff, (INK >> 8) & 0xff, INK & 0xff].join(' ');
  context.strokeStyle = `rgb(${ink} / ${alpha * 100}%)`;
  context.lineWidth = width;
  context.lineCap = 'square';
  for (let offset = -size; offset <= 2 * size; offset += spacing) {
    context.beginPath();
    context.moveTo(offset, size);
    context.lineTo(offset + size, 0);
    context.stroke();
  }
  const texture = Texture.from(canvas);
  texture.source.addressMode = 'repeat';
  return texture;
}

export interface Fog {
  /** The fog layer's content, drawn in screen pixels. */
  readonly root: Sprite;
  /** Redraws the mask when the sight has moved enough to show. Says whether it did. */
  update(provinces: ReadonlySet<ProvinceId>, circles: readonly SightCircle[]): boolean;
  /** Follows the camera: `x`, `y` is where the map's origin lands on screen. */
  place(x: number, y: number, scale: number, width: number, height: number): void;
  /** Repaints the fog into its texture if the camera or the sight moved since the last paint. */
  paint(): void;
  destroy(): void;
}

export function createFog(renderer: Renderer, map: GameMap): Fog {
  const k = 1 / FOG.kmPerTexel;
  const size = { width: Math.ceil(map.width * k), height: Math.ceil(map.height * k) };
  const target = () => RenderTexture.create({ ...size, antialias: true });
  /** White out of sight, black in sight and off the map: the faint tone. */
  const toneTexture = target();
  /** White in the band just outside sight, fading to black away from the edge. */
  const bandTexture = target();
  const landTone = target();
  const landBand = target();

  // The land parts change only when a province changes owner, so only they are
  // blurred. Circles move every frame, and each is a sprite whose edge is already soft.
  const cover = new Graphics()
    .rect(0, 0, size.width, size.height)
    .fill(0x000000)
    .poly(toPixels(map.extent, k, 0))
    .fill(0xffffff);
  const seenLand = new Graphics();
  const toneLand = new Container();
  toneLand.addChild(cover, seenLand);
  toneLand.filters = [new BlurFilter({ strength: FOG.softKm * k, quality: 3 })];
  const bandEdges = new Graphics();
  const bandLand = new Container();
  bandLand.addChild(new Graphics().rect(0, 0, size.width, size.height).fill(0x000000), bandEdges);
  bandLand.filters = [new BlurFilter({ strength: FOG.softKm * k, quality: 3 })];

  const discs = new Container();
  const tone = new Container();
  tone.addChild(new Sprite(landTone), discs);
  const rings = new Container();
  const inSight = new Sprite({ texture: toneTexture, blendMode: 'multiply' });
  const band = new Container();
  band.addChild(new Sprite(landBand), rings, inSight);
  const discTextures = new Map<number, Texture>();
  const ringTextures = new Map<number, Texture>();

  const toneMask = new Sprite(toneTexture);
  const bandMask = new Sprite(bandTexture);
  const shade = new Sprite(Texture.WHITE);
  shade.tint = FOG.shade;
  shade.alpha = FOG.shadeAlpha;
  shade.mask = toneMask;
  const hatch = new TilingSprite({ texture: hatchTexture(), width: 1, height: 1 });
  hatch.mask = bandMask;
  const paint = new Container();
  paint.addChild(shade, hatch, toneMask, bandMask);
  // The masks cost full-screen passes, so the painted fog is kept in a texture and
  // repainted only when the camera or the sight moves, not on every frame the sea moves.
  let screen = RenderTexture.create({
    width: 1,
    height: 1,
    resolution: renderer.resolution,
    antialias: true,
  });
  const root = new Sprite(screen);
  let stale = true;

  const outlines = new Map(map.provinces.map((p) => [p.id as ProvinceId, p.outline]));
  let drawnProvinces: ReadonlySet<ProvinceId> | undefined;
  let drawnCircles: readonly SightCircle[] = [];

  function drawLand(provinces: ReadonlySet<ProvinceId>) {
    seenLand.clear();
    bandEdges.clear();
    for (const id of provinces) {
      for (const [outer, ...holes] of outlines.get(id) ?? []) {
        if (!outer) continue;
        const ring = toPixels(outer, k, 0.5);
        seenLand.poly(ring).fill(0x000000);
        for (const hole of holes) seenLand.poly(toPixels(hole, k, 0.5)).cut();
        for (const [width, alpha] of BAND_STEPS) {
          bandEdges
            .poly(ring)
            .stroke({ width: 2 * width * FOG.bandKm * k, color: 0xffffff, alpha, join: 'round' });
        }
      }
    }
    renderer.render({ container: toneLand, target: landTone, clear: true });
    renderer.render({ container: bandLand, target: landBand, clear: true });
    drawnProvinces = provinces;
  }

  function cached(textures: Map<number, Texture>, radius: number, make: (r: number) => Texture) {
    let texture = textures.get(radius);
    if (!texture) {
      texture = make(radius);
      textures.set(radius, texture);
    }
    return texture;
  }

  function place(layer: Container, i: number, texture: Texture, centre: MapPoint, span: number) {
    let sprite = layer.children[i] as Sprite | undefined;
    if (!sprite) {
      sprite = new Sprite({ anchor: 0.5 });
      layer.addChild(sprite);
    }
    sprite.texture = texture;
    sprite.visible = true;
    sprite.position.set(centre.x * k, centre.y * k);
    sprite.width = sprite.height = 2 * span * k;
  }

  function drawCircles(circles: readonly SightCircle[]) {
    for (const [i, { centre, radius }] of circles.entries()) {
      place(discs, i, cached(discTextures, radius, softDisc), centre, radius + FOG.softKm);
      place(rings, i, cached(ringTextures, radius, bandRing), centre, radius + FOG.bandKm);
    }
    for (const layer of [discs, rings]) {
      for (const extra of layer.children.slice(circles.length)) extra.visible = false;
    }
    for (const disc of discs.children) (disc as Sprite).tint = 0x000000;
    drawnCircles = circles;
  }

  function moved(circles: readonly SightCircle[]): boolean {
    if (circles.length !== drawnCircles.length) return true;
    return circles.some((circle, i) => {
      const drawn = drawnCircles[i];
      return (
        drawn?.key !== circle.key ||
        drawn.radius !== circle.radius ||
        Math.abs(drawn.centre.x - circle.centre.x) >= FOG.redrawKm ||
        Math.abs(drawn.centre.y - circle.centre.y) >= FOG.redrawKm
      );
    });
  }

  return {
    root,
    update(provinces, circles) {
      const landChanged = !sameSet(drawnProvinces, provinces);
      if (!landChanged && !moved(circles)) return false;
      if (landChanged) drawLand(provinces);
      drawCircles(circles);
      renderer.render({ container: tone, target: toneTexture, clear: true });
      renderer.render({ container: band, target: bandTexture, clear: true });
      stale = true;
      return true;
    },
    place(x, y, scale, width, height) {
      for (const mask of [toneMask, bandMask]) {
        mask.position.set(x, y);
        mask.scale.set(scale * FOG.kmPerTexel);
      }
      shade.width = width;
      shade.height = height;
      hatch.width = width;
      hatch.height = height;
      hatch.tilePosition.set(x, y);
      screen = fitTexture(screen, width, height, renderer.resolution);
      root.texture = screen;
      stale = true;
    },
    paint() {
      if (!stale) return;
      renderer.render({ container: paint, target: screen, clear: true });
      stale = false;
    },
    destroy() {
      for (const container of [toneLand, bandLand, tone, band, paint]) {
        container.destroy({ children: true });
      }
      for (const texture of [...discTextures.values(), ...ringTextures.values()]) {
        texture.destroy(true);
      }
      for (const texture of [toneTexture, bandTexture, landTone, landBand, screen]) {
        texture.destroy(true);
      }
    },
  };
}

/**
 * Strokes along a province edge that stack into a band fading outward: each pair is
 * a share of `bandKm` reached and the strength it adds there.
 */
const BAND_STEPS = [1, 0.8, 0.6, 0.4, 0.25, 0.12].map((share) => [share, 0.22] as const);

/**
 * A ring of the band around a circle of sight `radius` km: strongest at the radius and
 * fading to nothing `FOG.bandKm` beyond it. Inside, the tone mask removes it.
 */
function bandRing(radius: number): Texture {
  const pixels = 256;
  const canvas = document.createElement('canvas');
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('fog: no 2D canvas context');
  const outer = radius + FOG.bandKm;
  const half = pixels / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  const edge = radius / outer;
  gradient.addColorStop(0, 'rgb(255 255 255 / 0%)');
  gradient.addColorStop(Math.max(0, (radius - FOG.softKm) / outer), 'rgb(255 255 255 / 100%)');
  for (let step = 0; step <= 8; step++) {
    const t = step / 8;
    gradient.addColorStop(edge + (1 - edge) * t, `rgb(255 255 255 / ${(1 - t) ** 1.6 * 100}%)`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, pixels, pixels);
  return Texture.from(canvas);
}

/**
 * A disc of sight `radius` km across its middle, opaque inside and fading to nothing
 * over `FOG.softKm` around that radius. The texture spans `radius + softKm` each way.
 */
function softDisc(radius: number): Texture {
  const pixels = 128;
  const canvas = document.createElement('canvas');
  canvas.width = pixels;
  canvas.height = pixels;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('fog: no 2D canvas context');
  const outer = radius + FOG.softKm;
  const half = pixels / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  const from = (radius - FOG.softKm / 2) / outer;
  const to = (radius + FOG.softKm / 2) / outer;
  gradient.addColorStop(0, 'white');
  for (let step = 0; step <= 8; step++) {
    const t = step / 8;
    const fade = 1 - t * t * (3 - 2 * t);
    gradient.addColorStop(from + (to - from) * t, `rgb(255 255 255 / ${fade * 100}%)`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, pixels, pixels);
  return Texture.from(canvas);
}

function sameSet<T>(a: ReadonlySet<T> | undefined, b: ReadonlySet<T>): boolean {
  if (a === b) return true;
  if (!a || a.size !== b.size) return false;
  for (const item of a) if (!b.has(item)) return false;
  return true;
}
