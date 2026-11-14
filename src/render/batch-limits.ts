import { extensions, GlLimitsSystem } from 'pixi.js';

/**
 * This atlas mostly batches ink and a few cached surfaces, not dozens of textures.
 * SwiftShader reports 32 samplers: linking those two giant branch shaders costs
 * seconds. Eight keeps the same drawing, splitting a batch rather than dropping art.
 * Apply at context creation (and restoration), before either graphics shader exists.
 */
export const MAP_BATCH_TEXTURES = 8;

class MapGlLimits extends GlLimitsSystem {
  override contextChange(): void {
    super.contextChange();
    this.maxBatchableTextures = Math.min(this.maxBatchableTextures, MAP_BATCH_TEXTURES);
  }
}

extensions.remove(GlLimitsSystem);
extensions.add(MapGlLimits);
