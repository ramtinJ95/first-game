import { RenderTexture } from 'pixi.js';

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
