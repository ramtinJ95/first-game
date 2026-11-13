import type { Rect } from './scatter.ts';

/**
 * The farthest a drawing reaches past its chunk, in km, per layer: the widest and
 * tallest mountain of a tier, the longest dune, and the outer fields and the tracks.
 */
export const OVERHANG = { wide: 100, texture: 50, middle: 30, close: 14, fields: 36 } as const;

const ROW = 4096;

export function chunkKey(i: number, j: number): number {
  return i * ROW + j;
}

export function chunkRect(size: number, key: number): Rect {
  const i = Math.floor(key / ROW);
  const j = key % ROW;
  return { left: i * size, top: j * size, right: (i + 1) * size, bottom: (j + 1) * size };
}

/** The row of a chunk, so chunks can be drawn from the north down. */
export function chunkRow(key: number): number {
  return key % ROW;
}

/**
 * The chunks of side `size` on a map of `width` by `height` km whose rect, grown by
 * `overhang`, meets `view` grown by `ring`. A chunk shows while any of its drawings can.
 */
export function chunksNear(
  view: Rect,
  size: number,
  overhang: number,
  ring: number,
  width: number,
  height: number,
): number[] {
  const reach = overhang + ring;
  const keys: number[] = [];
  const i0 = Math.max(0, Math.floor((view.left - reach) / size));
  const j0 = Math.max(0, Math.floor((view.top - reach) / size));
  const i1 = Math.min(Math.ceil(width / size) - 1, Math.floor((view.right + reach) / size));
  const j1 = Math.min(Math.ceil(height / size) - 1, Math.floor((view.bottom + reach) / size));
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) keys.push(chunkKey(i, j));
  return keys;
}

/** When work runs, so a test can drive the queue by hand. */
export interface Timers {
  later(run: () => void): unknown;
  cancel(handle: unknown): void;
  now(): number;
}

const REAL_TIMERS: Timers = {
  later: (run) => setTimeout(run, 0),
  cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => performance.now(),
};

/**
 * Chunks waiting to be built, built in slices of `sliceMs` on a timer between frames
 * and not inside a frame, so building runs at the speed of the main thread however
 * slow the frames are. `want` replaces the waiting list with the chunks the view needs
 * now, those it needs first. An item already built when its turn comes is skipped.
 */
export class BuildQueue<T extends { readonly needed: boolean }> {
  readonly #build: (item: T) => void;
  readonly #built: (item: T) => boolean;
  readonly #sliceMs: number;
  readonly #timers: Timers;
  #items: T[] = [];
  #handle: unknown;

  constructor(
    build: (item: T) => void,
    built: (item: T) => boolean,
    sliceMs: number,
    timers: Timers = REAL_TIMERS,
  ) {
    this.#build = build;
    this.#built = built;
    this.#sliceMs = sliceMs;
    this.#timers = timers;
  }

  want(items: readonly T[]) {
    this.#items = [...items];
    if (this.#items.length > 0) this.#schedule();
  }

  /** Whether a chunk the view shows still waits to be built. */
  get waitingInView(): boolean {
    return this.#items.some((item) => item.needed);
  }

  /** Stops building: nothing waits, and a scheduled slice does not run. */
  destroy() {
    if (this.#handle !== undefined) this.#timers.cancel(this.#handle);
    this.#handle = undefined;
    this.#items = [];
  }

  #schedule() {
    this.#handle ??= this.#timers.later(() => this.#slice());
  }

  #slice() {
    this.#handle = undefined;
    const started = this.#timers.now();
    while (this.#items.length > 0 && this.#timers.now() - started < this.#sliceMs) {
      const item = this.#items.shift() as T;
      if (!this.#built(item)) this.#build(item);
    }
    if (this.#items.length > 0) this.#schedule();
  }
}
