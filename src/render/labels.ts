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
/** The step, in px, at which a label's line is tested for land and water. */
const GROUND_STEP = 3;
/**
 * The open water, in px, that a name may cross before land beyond it reads as another
 * shore. Less, such as a lake or an inlet at a wide zoom, and the name still reads as one
 * place's.
 */
const FAR_SHORE_PX = 14;
/** The share of a capital's name over land at which it counts as written on land. */
const ON_LAND = 0.6;

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
 * How a spot's name lies on the ground, read along its middle line outward from the
 * point nearest its place: whether it crosses open water onto another shore, and the
 * share of it over land.
 */
function groundOf(
  box: Box,
  anchor: MapPoint,
  land: (point: MapPoint) => boolean,
): { farShore: boolean; landShare: number } {
  const y = (box.top + box.bottom) / 2;
  const start = Math.min(box.right, Math.max(box.left, anchor.x));
  let dry = 0;
  let count = 0;
  let farShore = false;
  for (const [end, way] of [
    [box.right, 1],
    [box.left, -1],
  ] as const) {
    let water = 0;
    let crossed = false;
    for (let x = start; way > 0 ? x <= end : x >= end; x += way * GROUND_STEP) {
      if (way < 0 && x === start) continue;
      count++;
      if (land({ x, y })) {
        dry++;
        if (crossed) farShore = true;
        water = 0;
      } else {
        water += GROUND_STEP;
        if (water >= FAR_SHORE_PX) crossed = true;
      }
    }
  }
  return { farShore, landShare: count > 0 ? dry / count : 0 };
}

/**
 * Places labels in priority order. Each label takes the first of eight spots (right,
 * left, above, below its city's symbol, then the four corners) that stays on screen and
 * clears every label already placed and every marker: the symbols, and the banners and
 * battle markers that stand on the map. A label with no free spot is hidden, so zooming
 * out hides the smaller cities first and names never pile up. A great power's capital is
 * always named: with no free spot, its name takes the first spot on screen that clears
 * the names already placed, over a lesser symbol or a banner.
 *
 * With `land`, a spot whose name crosses open water onto another shore is not near its
 * place, so it is never taken, and a name with no other spot is not drawn at this zoom.
 * A capital's name takes a spot written on land before one over the sea.
 */
export function placeLabels(
  requests: readonly LabelRequest[],
  markers: readonly Box[],
  viewport: Size,
  land?: (point: MapPoint) => boolean,
): Map<string, Box> {
  const placed = new Map<string, Box>();
  const taken: Box[] = [];
  for (const request of [...requests].sort(compare)) {
    const capital = request.priority === LABEL_PRIORITY.capital;
    const near = candidates(request).map((box) => ({
      box,
      ...(land ? groundOf(box, request.anchor, land) : { farShore: false, landShare: 1 }),
    }));
    const spots = near
      .filter(({ farShore }) => !farShore)
      .map(({ box, landShare }) => ({ box, landShare }));
    // A capital's name is tried on land before over the sea, and within each, clear of
    // the markers before over a lesser one.
    const tiers = capital
      ? [spots.filter((s) => s.landShare >= ON_LAND), spots.filter((s) => s.landShare < ON_LAND)]
      : [spots];
    const onScreen = (box: Box) =>
      box.left >= 0 && box.top >= 0 && box.right <= viewport.width && box.bottom <= viewport.height;
    const clearOfNames = (box: Box) => !taken.some((other) => overlaps(box, other));
    let spot: Box | undefined;
    for (const tier of tiers) {
      spot =
        tier.find(
          ({ box }) =>
            onScreen(box) && clearOfNames(box) && !markers.some((marker) => overlaps(box, marker)),
        )?.box ??
        (capital ? tier.find(({ box }) => onScreen(box) && clearOfNames(box))?.box : undefined);
      if (spot) break;
    }
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
