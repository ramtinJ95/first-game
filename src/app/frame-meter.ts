/** The meter reports the frames of this many last milliseconds. */
export const FRAME_WINDOW_MS = 5000;

export interface FrameStats {
  readonly median: number;
  readonly p95: number;
  readonly frames: number;
}

/** The median and 95th percentile of frame intervals in ms, by nearest rank. */
export function frameStats(intervals: readonly number[]): FrameStats | undefined {
  if (intervals.length === 0) return undefined;
  const sorted = [...intervals].sort((a, b) => a - b);
  const rank = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(share * sorted.length) - 1)] as number;
  return { median: rank(0.5), p95: rank(0.95), frames: sorted.length };
}

/** Times within the last FRAME_WINDOW_MS, oldest first. */
function recent<T extends { at: number }>(list: T[], now: number) {
  while (list[0] && list[0].at < now - FRAME_WINDOW_MS) list.shift();
}

function describe(name: string, stats: FrameStats | undefined): string {
  if (!stats) return `${name} none`;
  return `${name} ${stats.median.toFixed(1)} ms median, ${stats.p95.toFixed(1)} ms p95 (${stats.frames})`;
}

export interface FrameMeter {
  /** One drawn frame took `ms`, from the start of the draw until the graphics card finished it. */
  drew(ms: number): void;
}

/**
 * A readout in the page's corner over the last FRAME_WINDOW_MS, refreshed each second:
 * the interval between animation frames, and the time each drawn frame took. It also
 * writes them in ms to `data-median`, `data-p95`, `data-draw-median`, and
 * `data-draw-p95`, so a script reads the same numbers.
 */
export function showFrameMeter(host: HTMLElement): FrameMeter {
  const readout = document.createElement('output');
  readout.dataset['testid'] = 'frame-meter';
  Object.assign(readout.style, {
    position: 'fixed',
    left: '8px',
    top: '8px',
    zIndex: '10',
    padding: '4px 8px',
    font: '12px ui-monospace, monospace',
    color: '#f4ead0',
    background: 'rgb(59 40 22 / 85%)',
    borderRadius: '4px',
    pointerEvents: 'none',
  });
  readout.textContent = 'frame interval: measuring';
  host.appendChild(readout);

  const frames: { at: number; interval: number }[] = [];
  const draws: { at: number; ms: number }[] = [];
  let last: number | undefined;
  let shownAt = 0;
  const frame = (now: number) => {
    if (last !== undefined) frames.push({ at: now, interval: now - last });
    last = now;
    recent(frames, now);
    recent(draws, now);
    if (now - shownAt >= 1000) {
      shownAt = now;
      const interval = frameStats(frames.map((f) => f.interval));
      const draw = frameStats(draws.map((d) => d.ms));
      Object.assign(readout.dataset, {
        median: interval?.median.toFixed(1) ?? '',
        p95: interval?.p95.toFixed(1) ?? '',
        drawMedian: draw?.median.toFixed(1) ?? '',
        drawP95: draw?.p95.toFixed(1) ?? '',
      });
      readout.textContent = `${describe('frame interval', interval)} · ${describe('drawn frame', draw)} · last ${FRAME_WINDOW_MS / 1000} s`;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return {
    drew(ms) {
      draws.push({ at: performance.now(), ms });
    },
  };
}
