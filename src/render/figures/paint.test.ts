import { isDeepStrictEqual } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SHEET_COLOURS } from '../armies/scene.ts';
import { paintOps, paintSvg, type PaintOp } from './paint.ts';
import { sheetArt } from './sheet.ts';

interface Painted {
  readonly d: string;
  readonly alpha: number;
  readonly fill?: string;
  readonly stroke?: { colour: string; width: number; cap: string; join: string };
}

/** What a 2D context is asked to paint, op by op. */
function recorder() {
  const painted: Painted[] = [];
  const state = {
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: '',
    lineJoin: '',
  };
  const context = {
    ...state,
    fill(path: { d: string }) {
      painted.push({ d: path.d, alpha: this.globalAlpha, fill: this.fillStyle });
    },
    stroke(path: { d: string }) {
      painted.push({
        d: path.d,
        alpha: this.globalAlpha,
        stroke: {
          colour: this.strokeStyle,
          width: this.lineWidth,
          cap: this.lineCap,
          join: this.lineJoin,
        },
      });
    },
  };
  return { context: context as unknown as CanvasRenderingContext2D, painted };
}

/** What the SVG of the same ops paints, op by op, read back from its attributes. */
function fromSvg(ops: readonly PaintOp[], colour: number): Painted[] {
  const painted: Painted[] = [];
  for (const [, attributes] of paintSvg(ops, colour).matchAll(/<path ([^>]*)\/>/g)) {
    const a = Object.fromEntries(
      [...(attributes ?? '').matchAll(/([a-z-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]),
    );
    const d = a['d'] ?? '';
    const alpha = a['opacity'] === undefined ? 1 : Number(a['opacity']);
    if (a['fill'] !== 'none') painted.push({ d, alpha, fill: a['fill'] });
    if (a['stroke'] !== undefined) {
      painted.push({
        d,
        alpha,
        stroke: {
          colour: a['stroke'],
          width: Number(a['stroke-width']),
          cap: a['stroke-linecap'] ?? '',
          join: a['stroke-linejoin'] ?? '',
        },
      });
    }
  }
  return painted;
}

describe('paintOps', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('paints every picture of the sheets as its SVG does, opacity, colour and outline alike', () => {
    vi.stubGlobal(
      'Path2D',
      class {
        readonly d: string;
        constructor(d: string) {
          this.d = d;
        }
      },
    );
    const art = sheetArt();
    expect(art.some((cell) => cell.ops.some((op) => op.opacity !== undefined))).toBe(true);
    for (const colour of [0, ...SHEET_COLOURS]) {
      for (const cell of art) {
        const { context, painted } = recorder();
        paintOps(context, cell.ops, colour);
        const svg = fromSvg(cell.ops, colour);
        // Strictly equal lists are equal to toEqual too; it is asked only of the rest, as it is slow.
        if (!isDeepStrictEqual(painted, svg))
          expect(painted, `${cell.key} in ${colour.toString(16)}`).toEqual(svg);
      }
    }
  });
});
