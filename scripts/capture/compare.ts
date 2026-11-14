import { PNG } from 'pngjs';

/**
 * The sea's swell moves pixels by up to `SWELL.bend` (2.2 px) in
 * `src/render/renderer.ts`, so two captures of one view never match byte for byte.
 * A pixel counts as changed only when its colour lies outside the range of the
 * other picture's pixels within `RADIUS`, which a shift of that size cannot do.
 */
export const RADIUS = 3;
export const CHANNEL_SLACK = 8;
export const CHANGED_PIXELS = 24;

interface Bitmap {
  width: number;
  height: number;
  data: Uint8Array;
}

export function changedPixels(
  a: Buffer,
  b: Buffer,
  radius = RADIUS,
  slack = CHANNEL_SLACK,
): number {
  if (a.equals(b)) return 0;
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  if (left.width !== right.width || left.height !== right.height) {
    return Math.max(left.width * left.height, right.width * right.height);
  }
  let count = 0;
  for (let pixel = 0; pixel < left.width * left.height; pixel++) {
    if (
      !withinRange(left, right, pixel, radius, slack) ||
      !withinRange(right, left, pixel, radius, slack)
    ) {
      count++;
    }
  }
  return count;
}

export function screenshotChanged(a: Buffer, b: Buffer): boolean {
  return changedPixels(a, b) > CHANGED_PIXELS;
}

function withinRange(
  picture: Bitmap,
  reference: Bitmap,
  pixel: number,
  radius: number,
  slack: number,
): boolean {
  const { width, height } = reference;
  const x = pixel % width;
  const y = (pixel - x) / width;
  for (let channel = 0; channel < 3; channel++) {
    const value = picture.data[pixel * 4 + channel]!;
    if (Math.abs(value - reference.data[pixel * 4 + channel]!) <= slack) continue;
    let low = 255;
    let high = 0;
    for (let ny = Math.max(0, y - radius); ny <= Math.min(height - 1, y + radius); ny++) {
      for (let nx = Math.max(0, x - radius); nx <= Math.min(width - 1, x + radius); nx++) {
        const sample = reference.data[(ny * width + nx) * 4 + channel]!;
        if (sample < low) low = sample;
        if (sample > high) high = sample;
      }
    }
    if (value < low - slack || value > high + slack) return false;
  }
  return true;
}
