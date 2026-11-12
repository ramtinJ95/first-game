declare module 'gifenc' {
  type Format = 'rgb565' | 'rgb444' | 'rgba4444';
  type Palette = number[][];
  type Pixels = Uint8Array | Uint8ClampedArray;

  interface FrameOptions {
    palette?: Palette;
    delay?: number;
    repeat?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
  }

  interface Encoder {
    writeFrame(index: Uint8Array, width: number, height: number, options?: FrameOptions): void;
    finish(): void;
    bytes(): Uint8Array;
  }

  export interface Gifenc {
    GIFEncoder(options?: { auto?: boolean; initialCapacity?: number }): Encoder;
    quantize(rgba: Pixels, maxColors: number, options?: { format?: Format }): Palette;
    applyPalette(rgba: Pixels, palette: Palette, format?: Format): Uint8Array;
  }

  const gifenc: Gifenc;
  export default gifenc;
}
