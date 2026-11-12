import { Texture } from 'pixi.js';

const SIZE = 256;
const FIBRE = [92, 64, 34] as const;

function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Value noise on a lattice that repeats every SIZE pixels, so the tile has no seams. */
function noise(x: number, y: number, cells: number, seed: number): number {
  const cell = SIZE / cells;
  const gx = x / cell;
  const gy = y / cell;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const tx = smooth(gx - x0);
  const ty = smooth(gy - y0);
  const at = (i: number, j: number) => hash(i % cells, j % cells, seed);
  const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx;
  const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx;
  return top * (1 - ty) + bottom * ty;
}

/**
 * A tile of paper grain, made here so the page fetches no image: soft mottling from
 * a few octaves of noise, fine speckle, and short fibres, all in a brown ink whose
 * alpha carries the pattern, so it darkens whatever lies under it.
 */
export function paperTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('paper: no 2D canvas context');
  const image = context.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const mottle = 0.5 * noise(x, y, 4, 1) + 0.3 * noise(x, y, 16, 2) + 0.2 * noise(x, y, 64, 3);
      const speckle = hash(x, y, 4);
      const alpha = 0.11 * mottle ** 2 + (speckle > 0.985 ? 0.12 : 0.03 * speckle);
      const i = (y * SIZE + x) * 4;
      image.data[i] = FIBRE[0];
      image.data[i + 1] = FIBRE[1];
      image.data[i + 2] = FIBRE[2];
      image.data[i + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, 0, 0);

  context.strokeStyle = `rgb(${FIBRE.join(' ')} / 7%)`;
  context.lineWidth = 0.6;
  for (let n = 0; n < 160; n++) {
    const x = hash(n, 0, 5) * SIZE;
    const y = hash(n, 1, 5) * SIZE;
    const angle = hash(n, 2, 5) * Math.PI * 2;
    const length = 4 + hash(n, 3, 5) * 10;
    for (const ox of [-SIZE, 0, SIZE]) {
      for (const oy of [-SIZE, 0, SIZE]) {
        context.beginPath();
        context.moveTo(x + ox, y + oy);
        context.quadraticCurveTo(
          x + ox + Math.cos(angle + 0.6) * length * 0.5,
          y + oy + Math.sin(angle + 0.6) * length * 0.5,
          x + ox + Math.cos(angle) * length,
          y + oy + Math.sin(angle) * length,
        );
        context.stroke();
      }
    }
  }
  return Texture.from(canvas);
}

/**
 * A repeating map of smooth noise in the red and green channels. The displacement
 * filter reads it to push the sea's drawing a pixel or two, which reads as water.
 */
export function waterTexture(): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('water: no 2D canvas context');
  const image = context.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      image.data[i] = Math.round(255 * (0.6 * noise(x, y, 4, 11) + 0.4 * noise(x, y, 8, 12)));
      image.data[i + 1] = Math.round(255 * (0.6 * noise(x, y, 4, 13) + 0.4 * noise(x, y, 8, 14)));
      image.data[i + 2] = 128;
      image.data[i + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = Texture.from(canvas);
  texture.source.addressMode = 'repeat';
  return texture;
}
