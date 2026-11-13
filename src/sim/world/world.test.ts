import { describe, expect, test } from 'vitest';
import { LandOracle } from '../../../scripts/movement/land-oracle.ts';
import { fixtureWorld } from '../fixture.ts';
import type { MapPoint } from '../state/map-point.ts';
import { distance, findPath, locate, surfaceAt } from './find-path.ts';
import { buildNavMesh } from './mesh.ts';
import { buildWorld } from './world.ts';

const world = fixtureWorld();
const oracle = new LandOracle(world.map);
const cities = world.map.provinces.map((p) => ({ id: p.id, at: { x: p.city[0], y: p.city[1] } }));

describe('the world built from the committed map', () => {
  test('every city stands on land', () => {
    for (const { id, at } of cities) expect(surfaceAt(world.mesh, at), id).toBe('land');
  });

  test('every port has a harbour on its coast, and one sea joins them all', () => {
    const ports = world.map.provinces.filter((p) => p.port);
    expect([...world.harbours.keys()].sort()).toEqual(ports.map((p) => p.id).sort());
    const seas = new Set<number>();
    for (const port of ports) {
      const harbour = world.harbours.get(port.id as never) as MapPoint;
      expect(locate(world.mesh, harbour, 'land'), port.id).toBeGreaterThanOrEqual(0);
      const sea = locate(world.mesh, harbour, 'sea');
      expect(sea, port.id).toBeGreaterThanOrEqual(0);
      seas.add(world.mesh.component[sea] as number);
      expect(distance(harbour, { x: port.city[0], y: port.city[1] })).toBeLessThan(40);
    }
    expect(seas.size).toBe(1);
  });

  test('each triangle lies on the surface the map outlines say it does', () => {
    const { points, triangles, surface } = world.mesh;
    for (let t = 0; t < surface.length; t += 1) {
      if (surface[t] === 0) continue;
      let x = 0;
      let y = 0;
      for (let k = 0; k < 3; k += 1) {
        x += (points[2 * (triangles[3 * t + k] as number)] as number) / 3;
        y += (points[2 * (triangles[3 * t + k] as number) + 1] as number) / 3;
      }
      const centre = { x, y };
      if (surface[t] === 1) expect(oracle.pointOnLand(centre), `triangle ${t}`).toBe(true);
      else expect(oracle.pointAtSea(centre), `triangle ${t}`).toBe(true);
    }
  });

  test('a search gives the same path after other searches, by land and by sea, as on a fresh mesh', () => {
    const fresh = () => structuredClone(world.mesh);
    const harbours = [...world.harbours.values()];
    const queries = cities.slice(0, 12).flatMap((from, i) => {
      const to = cities[(i * 13 + 29) % cities.length] as (typeof cities)[number];
      const a = harbours[i % harbours.length] as MapPoint;
      const b = harbours[(i * 5 + 3) % harbours.length] as MapPoint;
      return [
        { from: from.at, to: to.at, surface: 'land' as const },
        { from: a, to: b, surface: 'sea' as const },
      ];
    });
    const firsts = queries.map(({ from, to, surface }) => findPath(fresh(), from, to, surface));
    const reused = queries.map(({ from, to, surface }) => findPath(world.mesh, from, to, surface));
    expect(reused).toEqual(firsts);
    expect(firsts.filter(Boolean).length).toBeGreaterThan(12);
  });

  test('land paths between cities stay on land and never come out shorter than the straight line', () => {
    let checked = 0;
    for (let i = 0; i < cities.length && checked < 25; i += 7) {
      const from = cities[i] as (typeof cities)[number];
      const to = cities[(i * 13 + 29) % cities.length] as (typeof cities)[number];
      const path = findPath(world.mesh, from.at, to.at, 'land');
      if (!path) continue;
      checked += 1;
      let at = from.at;
      let length = 0;
      for (const point of path) {
        expect(oracle.segmentOnLand(at, point), `${from.id} to ${to.id}`).toBe(true);
        length += distance(at, point);
        at = point;
      }
      expect(at).toEqual(to.at);
      expect(length).toBeGreaterThanOrEqual(distance(from.at, to.at) - 1e-9);
    }
    expect(checked).toBeGreaterThan(5);
  });

  test('building the world twice gives the same mesh', () => {
    const again = buildWorld(world.map);
    expect(again.mesh).toEqual(world.mesh);
    expect([...again.harbours]).toEqual([...world.harbours]);
  });

  test('interior points can be added for the experiment, and the mesh stays valid', () => {
    const mesh = buildNavMesh(world.map, 200);
    expect(mesh.triangles.length).toBeGreaterThan(world.mesh.triangles.length);
    for (const { id, at } of cities) expect(surfaceAt(mesh, at), id).toBe('land');
  });
});
