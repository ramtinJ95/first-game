import { PNG } from 'pngjs';

export const FIELD = 48;

export function texture(x: number, y: number): number {
  return 100 + ((((x * 73856093) ^ (y * 19349663)) >>> 0) % 20);
}

export function picture(
  shade: (x: number, y: number) => number = texture,
  size: number = FIELD,
): Buffer {
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = Math.min(255, shade(x, y));
      png.data.set([value, value, value, 255], (y * size + x) * 4);
    }
  }
  return PNG.sync.write(png);
}
