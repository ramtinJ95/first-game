import type { Gifenc } from 'gifenc';
import { createRequire } from 'node:module';
import { PNG } from 'pngjs';

// Vitest honours the CommonJS build's __esModule flag and hands `import gifenc` the
// GIFEncoder function, while Node hands it module.exports; require agrees in both.
const { GIFEncoder, quantize, applyPalette } = createRequire(import.meta.url)('gifenc') as Gifenc;

export interface GifFrame {
  png: Buffer;
  delayMs: number;
}

interface Bitmap {
  width: number;
  height: number;
  rgba: Buffer;
}

export function encodeGif(frames: GifFrame[], maxWidth: number): Buffer {
  const scaled = mergeRepeats(
    frames.map((frame) => ({
      bitmap: downscale(PNG.sync.read(frame.png), maxWidth),
      delayMs: frame.delayMs,
    })),
  );
  const [first] = scaled;
  if (!first) throw new Error('a GIF needs at least one frame');
  const samples = [0, Math.floor(scaled.length / 2), scaled.length - 1].map(
    (i) => scaled[i] ?? first,
  );
  const palette = quantize(Buffer.concat(samples.map((sample) => sample.bitmap.rgba)), 256);

  const gif = GIFEncoder();
  for (const [i, frame] of scaled.entries()) {
    // A scenario that resizes the window gives frames of another size, which keep their
    // shape inside the first frame's.
    const bitmap = fitInto(frame.bitmap, first.bitmap.width, first.bitmap.height);
    const { delayMs } = frame;
    gif.writeFrame(applyPalette(bitmap.rgba, palette), bitmap.width, bitmap.height, {
      palette: i === 0 ? palette : undefined,
      delay: delayMs,
      repeat: 0,
    });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

interface TimedBitmap {
  bitmap: Bitmap;
  delayMs: number;
}

const LETTERBOX = [34, 30, 26, 255] as const;

function fitInto(source: Bitmap, width: number, height: number): Bitmap {
  if (source.width === width && source.height === height) return source;
  const k = Math.min(width / source.width, height / source.height);
  const w = Math.max(1, Math.round(source.width * k));
  const h = Math.max(1, Math.round(source.height * k));
  const left = Math.floor((width - w) / 2);
  const top = Math.floor((height - h) / 2);
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) rgba.set(LETTERBOX, i * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(source.height - 1, Math.floor(y / k));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(source.width - 1, Math.floor(x / k));
      const from = (sy * source.width + sx) * 4;
      source.rgba.copy(rgba, ((top + y) * width + left + x) * 4, from, from + 4);
    }
  }
  return { width, height, rgba };
}

function mergeRepeats(frames: TimedBitmap[]): TimedBitmap[] {
  const merged: TimedBitmap[] = [];
  for (const frame of frames) {
    const previous = merged.at(-1);
    if (previous?.bitmap.rgba.equals(frame.bitmap.rgba)) previous.delayMs += frame.delayMs;
    else merged.push({ ...frame });
  }
  return merged;
}

function downscale(source: PNG, maxWidth: number): Bitmap {
  if (source.width <= maxWidth)
    return { width: source.width, height: source.height, rgba: source.data };
  const width = maxWidth;
  const height = Math.max(1, Math.round((source.height * maxWidth) / source.width));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * source.height) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * source.height) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * source.width) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * source.width) / width));
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let sy = y0; sy < y1; sy++) {
          for (let sx = x0; sx < x1; sx++)
            sum += source.data.readUInt8((sy * source.width + sx) * 4 + c);
        }
        rgba.writeUInt8(Math.round(sum / ((y1 - y0) * (x1 - x0))), (y * width + x) * 4 + c);
      }
    }
  }
  return { width, height, rgba };
}
