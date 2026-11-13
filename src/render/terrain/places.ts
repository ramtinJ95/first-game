import type { Box } from '../labels.ts';

export interface SymbolRequest {
  readonly id: string;
  /** Lower wins: a city over a town, a town over a village. */
  readonly priority: number;
  readonly box: Box;
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/**
 * Which settlement symbols have room. Each request, in priority order and then by id,
 * keeps its place when its box clears the boxes already `taken` and every symbol kept
 * before it, so a city always wins a place over a town and a town over a village.
 */
export function claimSymbols(
  requests: readonly SymbolRequest[],
  taken: readonly Box[],
): Set<string> {
  const kept = new Set<string>();
  const boxes = [...taken];
  const sorted = [...requests].sort((a, b) =>
    a.priority !== b.priority ? a.priority - b.priority : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  for (const request of sorted) {
    if (boxes.some((box) => overlaps(box, request.box))) continue;
    kept.add(request.id);
    boxes.push(request.box);
  }
  return kept;
}

/** Moves `from` toward `to` by at most `step`, for fades that run over a few frames. */
export function approach(from: number, to: number, step: number): number {
  return from < to ? Math.min(to, from + step) : Math.max(to, from - step);
}

/**
 * The classical names of the peaks the map marks. Natural Earth names each peak in a
 * modern language, which a map of the ancient world does not write, so a peak takes its
 * name only from this table and is otherwise drawn without one.
 */
export const PEAK_NAMES: Readonly<Record<string, string>> = {
  'Mount Olympus': 'Olympus',
  Olympus: 'Olympus',
  'Uludağ Tepe': 'Olympus',
  'Monte Etna': 'Aetna',
  Vesuvio: 'Vesuvius',
  Psiloritis: 'Ida',
  'Erciyes Dagi': 'Argaeus',
  'Jabal ash Shaykh': 'Hermon',
};

/** The name the map writes for a peak, or undefined for one it marks without a name. */
export function peakName(modern: string): string | undefined {
  return PEAK_NAMES[modern];
}
