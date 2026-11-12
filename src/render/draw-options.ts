import { LAYERS, type LayerName } from './renderer.ts';

/** How much of the picture the renderer draws. The game draws all of it. */
export interface DrawOptions {
  /** Layers left out of the picture. */
  readonly hidden: ReadonlySet<LayerName>;
  /** The sea's moving swell, a displacement filter over the whole screen. */
  readonly swell: boolean;
  readonly antialias: boolean;
  /** Canvas pixels per CSS pixel. Undefined follows the screen's device pixel ratio. */
  readonly resolution: number | undefined;
}

export const FULL_DRAWING: DrawOptions = {
  hidden: new Set(),
  swell: true,
  antialias: true,
  resolution: undefined,
};

/**
 * What browser tests draw with `?draw=test`. A test checks behaviour, so it leaves out
 * the full-screen passes that a computer with no graphics card draws slowly.
 */
export const TEST_DRAWING: DrawOptions = {
  hidden: new Set(['grain']),
  swell: false,
  antialias: false,
  resolution: 1,
};

function isLayer(name: string): name is LayerName {
  return LAYERS.some((layer) => layer.name === name);
}

/**
 * Reads the drawing from the page's query: `draw=test` picks the test drawing,
 * `hide=sea,grain` leaves out layers, and `swell=off`, `antialias=off`,
 * `resolution=<n>`, and `fog=off` each turn off one thing. Unknown names are an error.
 */
export function parseDrawOptions(search: string): DrawOptions {
  const query = new URLSearchParams(search);
  const draw = query.get('draw');
  if (draw !== null && draw !== 'test') throw new Error(`draw=${draw}: expected draw=test`);
  const base = draw === 'test' ? TEST_DRAWING : FULL_DRAWING;
  const hidden = new Set(base.hidden);
  for (const name of (query.get('hide') ?? '').split(',').filter(Boolean)) {
    if (!isLayer(name)) throw new Error(`hide=${name}: no such layer`);
    hidden.add(name);
  }
  if (query.get('fog') === 'off') hidden.add('fog');
  const resolution = query.get('resolution');
  const scale = resolution === null ? base.resolution : Number(resolution);
  if (scale !== undefined && !(scale > 0)) throw new Error(`resolution=${resolution}: not > 0`);
  return {
    hidden,
    swell: base.swell && query.get('swell') !== 'off',
    antialias: base.antialias && query.get('antialias') !== 'off',
    resolution: scale,
  };
}
