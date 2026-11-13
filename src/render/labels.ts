import type { MapPoint } from '../sim/state/map-point.ts';
import type { Size } from './camera.ts';

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface LabelRequest {
  readonly id: string;
  /** The city marker's centre on screen. */
  readonly anchor: MapPoint;
  /** Half the width and height of the city's symbol, which its label must clear. */
  readonly clearance: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
  /** Lower places first: see `LABEL_PRIORITY`. */
  readonly priority: number;
  readonly population: number;
}

/** Which kind of name wins a place: a great power's capital, then any city, a peak, a town, a village. */
export const LABEL_PRIORITY = { capital: 0, city: 1, peak: 2, town: 3, village: 4 } as const;

/** Space between a city's symbol and its label. */
const GAP = 3;
const PADDING = 2;

/** By priority, then the larger place, then by name so the order is stable. */
function compare(a: LabelRequest, b: LabelRequest): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.population !== b.population) return b.population - a.population;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function candidates({ anchor: { x, y }, width: w, height: h, clearance }: LabelRequest): Box[] {
  const box = (left: number, top: number) => ({ left, top, right: left + w, bottom: top + h });
  const dx = clearance.x + GAP;
  const dy = clearance.y + GAP;
  return [
    box(x + dx, y - h / 2),
    box(x - dx - w, y - h / 2),
    box(x - w / 2, y - dy - h),
    box(x - w / 2, y + dy),
    box(x + dx, y - dy - h),
    box(x - dx - w, y - dy - h),
    box(x + dx, y + dy),
    box(x - dx - w, y + dy),
  ];
}

/**
 * Places labels in priority order. Each label takes the first of eight spots (right,
 * left, above, below its city's symbol, then the four corners) that stays on screen and
 * clears every label already placed and every marker: the symbols, and the banners and
 * battle markers that stand on the map. A label with no free spot is hidden, so zooming
 * out hides the smaller cities first and names never pile up. A great power's capital is
 * always named: with no free spot, its name takes the first spot on screen that clears
 * the names already placed, over a lesser symbol or a banner.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  markers: readonly Box[],
  viewport: Size,
): Map<string, Box> {
  const placed = new Map<string, Box>();
  const taken: Box[] = [];
  for (const request of [...requests].sort(compare)) {
    const spots = candidates(request);
    const onScreen = (box: Box) =>
      box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height;
    const clearOfNames = (box: Box) => !taken.some((other) => overlaps(box, other));
    const spot =
      spots.find(
        (box) =>
          onScreen(box) && clearOfNames(box) && !markers.some((marker) => overlaps(box, marker)),
      ) ??
      (request.priority === LABEL_PRIORITY.capital
        ? spots.find((box) => onScreen(box) && clearOfNames(box))
        : undefined);
    if (!spot) continue;
    placed.set(request.id, spot);
    taken.push({
      left: spot.left - PADDING,
      top: spot.top - PADDING,
      right: spot.right + PADDING,
      bottom: spot.bottom + PADDING,
    });
  }
  return placed;
}
