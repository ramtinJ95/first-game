import { PNG } from 'pngjs';

/**
 * Screenshots are taken in the map's still pose (`still.ts`), so two captures of an
 * unchanged view match pixel for pixel and any differing pixel is a change. Any
 * tolerance here would also hide a changed digit in a panel.
 */
export function changedPixels(a: Buffer, b: Buffer): number {
  if (a.equals(b)) return 0;
  const left = PNG.sync.read(a);
  const right = PNG.sync.read(b);
  if (left.width !== right.width || left.height !== right.height) {
    return Math.max(left.width * left.height, right.width * right.height);
  }
  let count = 0;
  for (let i = 0; i < left.data.length; i += 4) {
    if (
      left.data[i] !== right.data[i] ||
      left.data[i + 1] !== right.data[i + 1] ||
      left.data[i + 2] !== right.data[i + 2]
    ) {
      count++;
    }
  }
  return count;
}

export function screenshotChanged(a: Buffer, b: Buffer): boolean {
  return changedPixels(a, b) > 0;
}
