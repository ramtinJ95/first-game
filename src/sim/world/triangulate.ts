/**
 * A constrained Delaunay triangulation on an integer lattice. Integer input keeps the
 * orientation test exact, so the result is the same on every machine.
 *
 * Triangles are stored as half-edges, three per triangle. Half-edge `e` runs from
 * vertex `triangles[e]` to vertex `triangles[next(e)]`, and `halfedges[e]` is the
 * half-edge running the other way in the neighbouring triangle, or -1 on the frame.
 * Every triangle has a positive `orient` in lattice coordinates.
 */
export interface Triangulation {
  /** Lattice x, y per vertex. The four frame corners come last. */
  coords: Int32Array;
  triangles: Int32Array;
  halfedges: Int32Array;
  /** 1 for both half-edges of a segment that was given as a constraint. */
  constrained: Uint8Array;
}

export const next = (e: number): number => (e % 3 === 2 ? e - 2 : e + 1);
export const prev = (e: number): number => (e % 3 === 0 ? e + 2 : e - 1);

const FRAME_MARGIN = 16;

/**
 * Triangulates the points inside a frame a little larger than their bounding box,
 * then forces each segment, given as a pair of point indices, into the triangulation.
 * Points must be distinct integers. Segments may meet only at their ends, and a point
 * that lies on a segment splits it.
 */
export function triangulate(
  points: readonly (readonly [number, number])[],
  segments: readonly (readonly [number, number])[],
): Triangulation {
  const n = points.length;
  const xs: number[] = points.map(([x]) => x);
  const ys: number[] = points.map(([, y]) => y);
  for (let i = 0; i < n; i += 1) {
    if (!Number.isInteger(xs[i]) || !Number.isInteger(ys[i])) {
      throw new Error(`point ${i} is not on the lattice`);
    }
  }
  const minX = Math.min(...xs) - FRAME_MARGIN;
  const minY = Math.min(...ys) - FRAME_MARGIN;
  const maxX = Math.max(...xs) + FRAME_MARGIN;
  const maxY = Math.max(...ys) + FRAME_MARGIN;
  xs.push(minX, maxX, maxX, minX);
  ys.push(minY, minY, maxY, maxY);

  const tri: number[] = [];
  const he: number[] = [];
  const cons: number[] = [];
  const vEdge = new Int32Array(n + 4).fill(-1);

  const orient = (a: number, b: number, c: number): number => {
    const ax = xs[a] as number;
    const ay = ys[a] as number;
    return (
      ((xs[b] as number) - ax) * ((ys[c] as number) - ay) -
      ((ys[b] as number) - ay) * ((xs[c] as number) - ax)
    );
  };
  const sign = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0);

  const addTriangle = (a: number, b: number, c: number): number => {
    const t = tri.length / 3;
    tri.push(a, b, c);
    he.push(-1, -1, -1);
    cons.push(0, 0, 0);
    return t;
  };
  const link = (a: number, b: number) => {
    he[a] = b;
    if (b >= 0) he[b] = a;
  };
  const opposite = (e: number): number => he[e] as number;
  const from = (e: number): number => tri[e] as number;

  const inCircle = (a: number, b: number, c: number, d: number): number =>
    inCircleSign(xs, ys, a, b, c, d);

  const flip = (a: number, b: number) => {
    const al = next(a);
    const ar = prev(a);
    const bl = prev(b);
    const br = next(b);
    const p0 = from(ar);
    const pr = from(a);
    const pl = from(al);
    const p1 = from(bl);
    tri[a] = p1;
    tri[b] = p0;
    const hbl = opposite(bl);
    const har = opposite(ar);
    const cbl = cons[bl] as number;
    const car = cons[ar] as number;
    link(a, hbl);
    link(b, har);
    link(ar, bl);
    cons[a] = cbl;
    cons[b] = car;
    cons[ar] = 0;
    cons[bl] = 0;
    vEdge[p1] = a;
    vEdge[pl] = al;
    vEdge[p0] = b;
    vEdge[pr] = br;
  };

  /** Flips edges opposite a new point until every one of them is locally Delaunay. */
  const legalize = (start: number) => {
    const stack = [start];
    while (stack.length > 0) {
      const a = stack.pop() as number;
      const b = opposite(a);
      if (b < 0 || cons[a]) continue;
      if (inCircle(from(prev(a)), from(a), from(next(a)), from(prev(b))) > 0) {
        const br = next(b);
        flip(a, b);
        stack.push(a, br);
      }
    }
  };

  const setVertexEdges = (t: number) => {
    for (let i = 0; i < 3; i += 1) vEdge[tri[3 * t + i] as number] = 3 * t + i;
  };

  addTriangle(n, n + 1, n + 2);
  addTriangle(n, n + 2, n + 3);
  link(2, 3);
  setVertexEdges(0);
  setVertexEdges(1);

  let last = 0;
  const locate = (p: number): { t: number; onEdge: number } | undefined => {
    let t = last;
    for (let steps = 0; steps < 4 * tri.length + 16; steps += 1) {
      let moved = false;
      let onEdge = -1;
      let zeros = 0;
      for (let i = 0; i < 3; i += 1) {
        const e = 3 * t + i;
        const o = orient(from(e), from(next(e)), p);
        if (o < 0) {
          t = Math.floor(opposite(e) / 3);
          moved = true;
          break;
        }
        if (o === 0) {
          zeros += 1;
          onEdge = e;
        }
      }
      if (!moved) {
        if (zeros > 1) return undefined;
        return { t, onEdge };
      }
    }
    throw new Error(`point ${p} could not be located`);
  };

  const insertPoint = (p: number) => {
    const found = locate(p);
    if (!found) throw new Error(`point ${p} repeats another point`);
    const { t, onEdge } = found;
    if (onEdge < 0) {
      const e0 = 3 * t;
      const a = from(e0);
      const b = from(e0 + 1);
      const c = from(e0 + 2);
      const o0 = opposite(e0);
      const o1 = opposite(e0 + 1);
      const o2 = opposite(e0 + 2);
      const t1 = addTriangle(b, c, p);
      const t2 = addTriangle(c, a, p);
      tri[e0 + 2] = p;
      link(e0, o0);
      link(3 * t1, o1);
      link(3 * t2, o2);
      link(e0 + 1, 3 * t1 + 2);
      link(3 * t1 + 1, 3 * t2 + 2);
      link(3 * t2 + 1, e0 + 2);
      setVertexEdges(t);
      setVertexEdges(t1);
      setVertexEdges(t2);
      last = t;
      legalize(e0);
      legalize(3 * t1);
      legalize(3 * t2);
      return;
    }
    const e = onEdge;
    const f = opposite(e);
    if (f < 0) throw new Error(`point ${p} lies on the frame`);
    const a = from(e);
    const b = from(next(e));
    const c = from(prev(e));
    const d = from(prev(f));
    const outBC = opposite(next(e));
    const outCA = opposite(prev(e));
    const outAD = opposite(next(f));
    const outDB = opposite(prev(f));
    const tt = Math.floor(e / 3);
    const u = Math.floor(f / 3);
    const writeTriangle = (at: number, x: number, y: number, z: number) => {
      tri[3 * at] = x;
      tri[3 * at + 1] = y;
      tri[3 * at + 2] = z;
    };
    writeTriangle(tt, a, p, c);
    const t2 = addTriangle(p, b, c);
    writeTriangle(u, b, p, d);
    const u2 = addTriangle(p, a, d);
    link(3 * tt + 2, outCA);
    link(3 * t2 + 1, outBC);
    link(3 * u + 2, outDB);
    link(3 * u2 + 1, outAD);
    link(3 * tt + 1, 3 * t2 + 2);
    link(3 * t2, 3 * u);
    link(3 * u + 1, 3 * u2 + 2);
    link(3 * u2, 3 * tt);
    for (const at of [tt, t2, u, u2]) setVertexEdges(at);
    last = tt;
    legalize(3 * tt + 2);
    legalize(3 * t2 + 1);
    legalize(3 * u + 2);
    legalize(3 * u2 + 1);
  };

  for (const p of insertionOrder(points)) insertPoint(p);

  const outgoing = (v: number): number[] => {
    const start = vEdge[v] as number;
    const edges: number[] = [];
    let e = start;
    do {
      edges.push(e);
      const twin = opposite(prev(e));
      if (twin < 0) {
        let back = start;
        for (;;) {
          const t = opposite(back);
          if (t < 0) break;
          back = next(t);
          edges.push(back);
        }
        return edges;
      }
      e = twin;
    } while (e !== start);
    return edges;
  };
  const findEdge = (u: number, w: number): number => {
    for (const e of outgoing(u)) if (from(next(e)) === w) return e;
    return -1;
  };
  const crosses = (a: number, b: number, p: number, q: number) =>
    sign(orient(a, b, p)) * sign(orient(a, b, q)) < 0 &&
    sign(orient(p, q, a)) * sign(orient(p, q, b)) < 0;
  const ahead = (a: number, b: number, v: number) =>
    ((xs[v] as number) - (xs[a] as number)) * ((xs[b] as number) - (xs[a] as number)) +
      ((ys[v] as number) - (ys[a] as number)) * ((ys[b] as number) - (ys[a] as number)) >
    0;

  const restoreDelaunay = (edges: [number, number][]) => {
    const stack = [...edges];
    let budget = 64 * tri.length + 1024;
    while (stack.length > 0) {
      if ((budget -= 1) < 0) throw new Error('restoring the Delaunay property did not finish');
      const [u, w] = stack.pop() as [number, number];
      const a = findEdge(u, w);
      if (a < 0 || cons[a]) continue;
      const b = opposite(a);
      if (b < 0) continue;
      const p0 = from(prev(a));
      const p1 = from(prev(b));
      if (inCircle(p0, u, w, p1) > 0) {
        flip(a, b);
        stack.push([u, p1], [p1, w], [w, p0], [p0, u]);
      }
    }
  };

  const insertSegment = (a: number, b: number) => {
    if (a === b) return;
    const existing = findEdge(a, b);
    if (existing >= 0) {
      cons[existing] = 1;
      const twin = opposite(existing);
      if (twin >= 0) cons[twin] = 1;
      return;
    }
    let h = -1;
    for (const e of outgoing(a)) {
      const x = from(next(e));
      const y = from(prev(e));
      const ox = orient(a, x, b);
      const oy = orient(a, y, b);
      if (ox === 0 && ahead(a, b, x)) {
        insertSegment(a, x);
        insertSegment(x, b);
        return;
      }
      if (oy === 0 && ahead(a, b, y)) {
        insertSegment(a, y);
        insertSegment(y, b);
        return;
      }
      if (ox > 0 && oy < 0) {
        h = next(e);
        break;
      }
    }
    if (h < 0) throw new Error(`segment ${a}-${b} leaves no triangle at its start`);

    const crossing: [number, number][] = [];
    for (;;) {
      const u = from(h);
      const w = from(next(h));
      if (cons[h]) throw new Error(`segment ${a}-${b} crosses segment ${u}-${w}`);
      crossing.push([u, w]);
      const t = opposite(h);
      if (t < 0) throw new Error(`segment ${a}-${b} runs off the frame`);
      const v = from(prev(t));
      if (v === b) break;
      const ov = orient(a, b, v);
      if (ov === 0) {
        insertSegment(a, v);
        insertSegment(v, b);
        return;
      }
      h = sign(ov) === sign(orient(a, b, u)) ? prev(t) : next(t);
    }

    const created: [number, number][] = [];
    let budget = 64 * crossing.length * crossing.length + 1024;
    for (let i = 0; i < crossing.length; i += 1) {
      if ((budget -= 1) < 0) throw new Error(`segment ${a}-${b} could not be recovered`);
      const [u, w] = crossing[i] as [number, number];
      const e = findEdge(u, w);
      const f = opposite(e);
      const p = from(prev(e));
      const q = from(prev(f));
      if (sign(orient(p, q, u)) * sign(orient(p, q, w)) < 0) {
        flip(e, f);
        if (p !== a && p !== b && q !== a && q !== b && crosses(a, b, p, q)) crossing.push([p, q]);
        else created.push([p, q]);
      } else {
        crossing.push([u, w]);
      }
    }
    const e = findEdge(a, b);
    if (e < 0) throw new Error(`segment ${a}-${b} is missing after recovery`);
    cons[e] = 1;
    cons[opposite(e)] = 1;
    restoreDelaunay(created);
  };

  for (const [a, b] of segments) insertSegment(a, b);

  const coords = new Int32Array(2 * (n + 4));
  for (let i = 0; i < n + 4; i += 1) {
    coords[2 * i] = xs[i] as number;
    coords[2 * i + 1] = ys[i] as number;
  }
  return {
    coords,
    triangles: Int32Array.from(tri),
    halfedges: Int32Array.from(he),
    constrained: Uint8Array.from(cons),
  };
}

/** Rows of a fixed height, alternately left to right and right to left, keep each walk short. */
function insertionOrder(points: readonly (readonly [number, number])[]): number[] {
  const row = 2000;
  return points
    .map((_, i) => i)
    .sort((i, j) => {
      const [ax, ay] = points[i] as readonly [number, number];
      const [bx, by] = points[j] as readonly [number, number];
      const ra = Math.floor(ay / row);
      const rb = Math.floor(by / row);
      if (ra !== rb) return ra - rb;
      return (ra % 2 === 0 ? ax - bx : bx - ax) || ay - by;
    });
}

/**
 * The sign of the in-circle determinant: positive when `d` lies inside the circle
 * through the anticlockwise `a`, `b`, `c`. Close calls are settled in exact integers.
 */
function inCircleSign(
  xs: readonly number[],
  ys: readonly number[],
  a: number,
  b: number,
  c: number,
  d: number,
): number {
  const dx = xs[d] as number;
  const dy = ys[d] as number;
  const adx = (xs[a] as number) - dx;
  const ady = (ys[a] as number) - dy;
  const bdx = (xs[b] as number) - dx;
  const bdy = (ys[b] as number) - dy;
  const cdx = (xs[c] as number) - dx;
  const cdy = (ys[c] as number) - dy;
  const alift = adx * adx + ady * ady;
  const blift = bdx * bdx + bdy * bdy;
  const clift = cdx * cdx + cdy * cdy;
  const det =
    alift * (bdx * cdy - cdx * bdy) +
    blift * (cdx * ady - adx * cdy) +
    clift * (adx * bdy - bdx * ady);
  const permanent =
    alift * (Math.abs(bdx * cdy) + Math.abs(cdx * bdy)) +
    blift * (Math.abs(cdx * ady) + Math.abs(adx * cdy)) +
    clift * (Math.abs(adx * bdy) + Math.abs(bdx * ady));
  if (Math.abs(det) > 1e-12 * permanent) return det > 0 ? 1 : -1;
  const [A, B, C, D, E, F] = [adx, ady, bdx, bdy, cdx, cdy].map(BigInt) as [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  const exact =
    (A * A + B * B) * (C * F - E * D) +
    (C * C + D * D) * (E * B - A * F) +
    (E * E + F * F) * (A * D - C * B);
  return exact > 0n ? 1 : exact < 0n ? -1 : 0;
}
