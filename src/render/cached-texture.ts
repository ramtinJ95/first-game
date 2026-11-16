import { Container, RenderTexture, Sprite, type Renderer } from 'pixi.js';
import type { Camera, Size } from './camera.ts';

/**
 * A render texture of this size for a layer cached on screen, the same one when its size
 * already fits. Pixi's `RenderTexture.resize` leaves a texture that has been drawn into at
 * its old size, so after a window resize the sea and the terrain drew scaled and offset
 * against the coast and the names. A new size gets a new texture, and the old one goes.
 */
export function fitTexture(
  texture: RenderTexture,
  width: number,
  height: number,
  resolution: number,
): RenderTexture {
  if (texture.width === width && texture.height === height) return texture;
  const antialias = texture.source.antialias;
  texture.destroy(true);
  return RenderTexture.create({ width, height, resolution, antialias });
}

/**
 * Whether a cached texture, whose top left corner stands at `left`, `top` on the screen,
 * still covers the whole view. A resize that leaves it covering keeps the texture, so the
 * frame after the resize costs no more than any other, and the texture takes the new size
 * the next time it is drawn again. Redrawing every cached layer at the new size in that one
 * frame held the screen on the old frame for seconds on a software GPU.
 */
export function coversView(
  texture: RenderTexture,
  left: number,
  top: number,
  view: { readonly width: number; readonly height: number },
): boolean {
  return (
    left <= 0 &&
    top <= 0 &&
    left + texture.width >= view.width &&
    top + texture.height >= view.height
  );
}

/** Static map art in a world layer: pay its vertices only when the view changes. */
export function cacheDrawing(art: Container, renderer: Renderer, margin: number) {
  const viewArt = new Container();
  viewArt.addChild(art);
  const root = new Container();
  root.addChild(viewArt);
  let texture = RenderTexture.create({
    width: 1,
    height: 1,
    resolution: renderer.resolution,
    antialias: true,
  });
  const sprite = new Sprite(texture);
  let drawn: { x: number; y: number; scale: number } | undefined;
  return {
    sprite,
    invalidate() {
      drawn = undefined;
    },
    /** Draws the texture again when the view has left it, and says whether it did. */
    render(camera: Camera, view: Size): boolean {
      const { scale } = camera;
      const x = view.width / 2 - camera.centre.x * scale;
      const y = view.height / 2 - camera.centre.y * scale;
      if (
        !drawn ||
        drawn.scale !== scale ||
        !coversView(texture, x - drawn.x - margin, y - drawn.y - margin, view)
      ) {
        texture = fitTexture(
          texture,
          Math.ceil(view.width) + 2 * margin,
          Math.ceil(view.height) + 2 * margin,
          renderer.resolution,
        );
        sprite.texture = texture;
        viewArt.scale.set(scale);
        viewArt.position.set(x + margin, y + margin);
        renderer.render({ container: root, target: texture, clear: true });
        drawn = { x, y, scale };
        sprite.scale.set(1 / scale);
        sprite.position.set((-margin - x) / scale, (-margin - y) / scale);
        return true;
      }
      return false;
    },
    destroy() {
      root.destroy({ children: true });
      sprite.destroy();
      texture.destroy(true);
    },
  };
}
