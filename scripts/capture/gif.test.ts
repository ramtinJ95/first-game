import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { encodeGif } from './gif.ts';

function solidPng(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height; i++) png.data.set([r, g, b, 255], i * 4);
  return PNG.sync.write(png);
}

interface ParsedGif {
  width: number;
  height: number;
  frames: { width: number; height: number; delayMs: number }[];
}

function parseGif(bytes: Buffer): ParsedGif {
  expect(bytes.subarray(0, 6).toString('ascii')).toBe('GIF89a');
  let at = 6;
  const width = bytes.readUInt16LE(at);
  const height = bytes.readUInt16LE(at + 2);
  const flags = bytes[at + 4] ?? 0;
  at += 7;
  if (flags & 0x80) at += 3 * 2 ** ((flags & 7) + 1);

  const skipSubBlocks = () => {
    while (bytes[at] !== 0) at += (bytes[at] ?? 0) + 1;
    at += 1;
  };

  const frames: ParsedGif['frames'] = [];
  let delayMs = 0;
  for (;;) {
    const introducer = bytes[at];
    if (introducer === 0x3b) return { width, height, frames };
    if (introducer === 0x21) {
      if (bytes[at + 1] === 0xf9) delayMs = bytes.readUInt16LE(at + 4) * 10;
      at += 2;
      skipSubBlocks();
    } else if (introducer === 0x2c) {
      frames.push({
        width: bytes.readUInt16LE(at + 5),
        height: bytes.readUInt16LE(at + 7),
        delayMs,
      });
      const localFlags = bytes[at + 9] ?? 0;
      at += 10;
      if (localFlags & 0x80) at += 3 * 2 ** ((localFlags & 7) + 1);
      at += 1;
      skipSubBlocks();
    } else {
      throw new Error(`unexpected GIF block 0x${introducer?.toString(16)} at ${at}`);
    }
  }
}

describe('encodeGif', () => {
  it('downscales wide frames to the maximum width, keeping the aspect ratio', () => {
    const frames = [
      { png: solidPng(1600, 900, [200, 40, 40]), delayMs: 100 },
      { png: solidPng(1600, 900, [40, 200, 40]), delayMs: 100 },
    ];

    const gif = parseGif(encodeGif(frames, 800));

    expect(gif).toMatchObject({ width: 800, height: 450 });
    expect(gif.frames).toEqual([
      { width: 800, height: 450, delayMs: 100 },
      { width: 800, height: 450, delayMs: 100 },
    ]);
  });

  it('fits a frame of another size, from a resized window, into the size of the first', () => {
    const frames = [
      { png: solidPng(1280, 720, [200, 40, 40]), delayMs: 100 },
      { png: solidPng(1024, 768, [40, 200, 40]), delayMs: 100 },
    ];

    const gif = parseGif(encodeGif(frames, 800));

    expect(gif.frames).toEqual([
      { width: 800, height: 450, delayMs: 100 },
      { width: 800, height: 450, delayMs: 100 },
    ]);
  });

  it('keeps frames that already fit at their own size', () => {
    const gif = parseGif(encodeGif([{ png: solidPng(320, 200, [10, 20, 30]), delayMs: 120 }], 800));

    expect(gif).toMatchObject({ width: 320, height: 200 });
    expect(gif.frames).toHaveLength(1);
  });

  it('folds consecutive identical frames into one longer frame', () => {
    const red = solidPng(200, 100, [220, 30, 30]);
    const blue = solidPng(200, 100, [30, 30, 220]);
    const frames = [red, red, red, blue, red].map((png) => ({ png, delayMs: 100 }));

    const gif = parseGif(encodeGif(frames, 800));

    expect(gif.frames.map((frame) => frame.delayMs)).toEqual([300, 100, 100]);
  });
});
