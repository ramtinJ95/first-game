import type { Point, Projection, Ring } from '../../src/sim/map.ts';
import type { LonLat } from './sources.ts';

const ALBERS = {
  radius: 6371.0088,
  lon0: 27.5,
  lat0: 41,
  parallels: [29, 52],
} as const;

export const EXTENT_CORNERS: readonly LonLat[] = [
  [-11, 23],
  [66, 23],
  [66, 42],
  [22, 55],
  [2, 55],
  [2, 59.5],
  [-11, 59.5],
];

const DENSIFY_STEP = 0.25;
const RAD = Math.PI / 180;
const N = (Math.sin(ALBERS.parallels[0] * RAD) + Math.sin(ALBERS.parallels[1] * RAD)) / 2;
const C = Math.cos(ALBERS.parallels[0] * RAD) ** 2 + 2 * N * Math.sin(ALBERS.parallels[0] * RAD);
const RHO0 = rho(ALBERS.lat0);

function rho(lat: number): number {
  return (ALBERS.radius * Math.sqrt(C - 2 * N * Math.sin(lat * RAD))) / N;
}

/** Spherical Albers equal-area conic, in km with y growing north. */
export function albers([lon, lat]: LonLat): [x: number, y: number] {
  const dLon = ((((lon - ALBERS.lon0 + 180) % 360) + 360) % 360) - 180;
  const theta = N * dLon * RAD;
  const r = rho(lat);
  return [r * Math.sin(theta), RHO0 - r * Math.cos(theta)];
}

export function inverseAlbers([x, y]: [x: number, y: number]): LonLat {
  const dy = RHO0 - y;
  const r = Math.hypot(x, dy);
  const lon = ALBERS.lon0 + Math.atan2(x, dy) / RAD / N;
  const lat = Math.asin((C - ((r * N) / ALBERS.radius) ** 2) / (2 * N)) / RAD;
  return [lon, lat];
}

export function densify(corners: readonly LonLat[]): LonLat[] {
  const out: LonLat[] = [];
  corners.forEach(([lon1, lat1], i) => {
    const [lon2, lat2] = corners[(i + 1) % corners.length] ?? [lon1, lat1];
    const steps = Math.ceil(Math.max(Math.abs(lon2 - lon1), Math.abs(lat2 - lat1)) / DENSIFY_STEP);
    for (let k = 0; k < steps; k++) {
      out.push([lon1 + ((lon2 - lon1) * k) / steps, lat1 + ((lat2 - lat1) * k) / steps]);
    }
  });
  return out;
}

export interface Plane {
  projection: Projection;
  width: number;
  height: number;
  extent: Ring;
  toPlane(position: LonLat): Point;
  toLonLat(point: Point): LonLat;
}

export function mapPlane(): Plane {
  const projected = densify(EXTENT_CORNERS).map(albers);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const left = round(Math.min(...xs));
  const top = round(Math.max(...ys));
  const toPlane = (position: LonLat): Point => {
    const [x, y] = albers(position);
    return [x - left, top - y];
  };
  return {
    projection: {
      kind: 'albers-equal-area-conic',
      radius: ALBERS.radius,
      lon0: ALBERS.lon0,
      lat0: ALBERS.lat0,
      parallels: [...ALBERS.parallels],
      origin: [left, top],
    },
    width: round(Math.max(...xs) - left),
    height: round(top - Math.min(...ys)),
    extent: projected.map(([x, y]) => [x - left, top - y]),
    toPlane,
    toLonLat: ([x, y]) => inverseAlbers([x + left, top - y]),
  };
}

/** Map coordinates are stored to 0.1 km. */
export function round(value: number): number {
  return Math.round(value * 10) / 10;
}
