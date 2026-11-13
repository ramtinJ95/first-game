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
