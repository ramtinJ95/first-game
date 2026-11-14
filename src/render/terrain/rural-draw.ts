import type { GraphicsContext } from 'pixi.js';
import type { Point } from '../../sim/map.ts';
import { INK, PAPER, SEA } from '../palette.ts';
import { stream } from './random.ts';
import type { RuralMark } from './rural.ts';

function at(x: number, y: number, angle: number, u: number, v: number): Point {
  return [
    x + Math.cos(angle) * u - Math.sin(angle) * v,
    y + Math.sin(angle) * u + Math.cos(angle) * v,
  ];
}

/** Batched ground drawing, paid only when a close terrain chunk is built. */
export function drawRural(g: GraphicsContext, marks: readonly RuralMark[]): void {
  const channels = marks.filter((m) => m.kind === 'channel');
  for (const style of [
    { width: 0.65, color: 0x8f9b64, alpha: 0.5 },
    { width: 0.22, color: 0x557d8c, alpha: 0.9 },
  ]) {
    for (const m of channels) {
      const [first, ...rest] = m.points;
      if (!first) continue;
      g.moveTo(...first);
      for (const p of rest) g.lineTo(...p);
    }
    if (channels.length) g.stroke({ ...style, cap: 'round', join: 'round' });
  }

  const grass = marks.filter((m) => m.kind === 'grassland');
  for (const m of grass) {
    const random = stream(m.seed),
      points: number[] = [];
    for (let n = 0; n < 12; n++) {
      const angle = (n / 12) * Math.PI * 2;
      const radius = m.size * (0.65 + random() * 0.35);
      points.push(
        ...at(m.x, m.y, m.angle, Math.cos(angle) * radius, Math.sin(angle) * radius * 0.4),
      );
    }
    g.poly(points);
  }
  if (grass.length) g.fill({ color: 0x8d9859, alpha: 0.1 });
  for (const m of grass) {
    const random = stream(m.seed);
    const count = 13 + Math.floor(random() * 10);
    for (let n = 0; n < count; n++) {
      const u = (random() - 0.5) * m.size * 1.5;
      const v = (random() - 0.5) * m.size * 0.6;
      const height = 0.5 + random() * 0.8;
      g.moveTo(...at(m.x, m.y, m.angle, u, v)).quadraticCurveTo(
        ...at(m.x, m.y, m.angle, u + 0.35, v - height * 0.6),
        ...at(m.x, m.y, m.angle, u + 0.8, v - height),
      );
    }
  }
  if (grass.length) g.stroke({ width: 0.12, color: 0x8a8e4d, alpha: 0.65, cap: 'round' });

  for (const m of marks) {
    if (m.kind === 'wetland') {
      const random = stream(m.seed),
        rim: number[] = [];
      for (let n = 0; n < 20; n++) {
        const a = (n / 20) * Math.PI * 2;
        const radius = m.size * (0.8 + 0.2 * random());
        rim.push(...at(m.x, m.y, m.angle, Math.cos(a) * radius, Math.sin(a) * radius * 0.5));
      }
      g.poly(rim)
        .fill({ color: 0x819666, alpha: 0.3 })
        .stroke({ width: 0.35, color: 0x819666, alpha: 0.25, join: 'round' });
      const pool = rim.map(
        (coordinate, n) =>
          (n % 2 === 0 ? m.x : m.y) + (coordinate - (n % 2 === 0 ? m.x : m.y)) * 0.73,
      );
      g.poly(pool).fill({ color: SEA, alpha: 0.9 });
      const reeds = 6 + Math.floor(random() * 8);
      for (let n = 0; n < reeds; n++) {
        const [x, y] = at(
          m.x,
          m.y,
          m.angle,
          (random() - 0.5) * m.size * 1.8,
          m.size * (0.25 + random() * 0.4),
        );
        const height = 0.5 + random() * 0.8;
        g.moveTo(x, y)
          .lineTo(x - 0.2, y - height)
          .moveTo(x, y)
          .lineTo(x + 0.35, y - height * 0.8);
      }
      g.stroke({ width: 0.13, color: 0x5f7548, alpha: 0.85, cap: 'round' });
      const [px, py] = at(m.x, m.y, m.angle, m.size * 0.9, 0);
      g.moveTo(px, py)
        .quadraticCurveTo(px - 0.2, py - 1.1, px + 0.15, py - 2.1)
        .stroke({ width: 0.18, color: 0x7e6136, cap: 'round' });
      for (let n = 0; n < 5; n++) {
        const a = (n / 5) * Math.PI * 2 + random() * 0.4;
        g.moveTo(px + 0.15, py - 2.1).quadraticCurveTo(
          px + Math.cos(a) * 0.8,
          py - 2.4 + Math.sin(a) * 0.6,
          px + Math.cos(a) * 1.3,
          py - 2.1 + Math.sin(a) * 0.9,
        );
      }
      g.stroke({ width: 0.21, color: 0x4f7044, alpha: 0.9, cap: 'round' });
    } else if (m.kind === 'pastoralCamp') {
      const random = stream(m.seed),
        pen: number[] = [];
      for (let n = 0; n <= 12; n++) {
        const a = (n / 12) * Math.PI * 2;
        pen.push(...at(m.x, m.y, m.angle, Math.cos(a) * 2.8, Math.sin(a) * 1.5));
      }
      g.poly(pen).stroke({ width: 0.13, color: 0x89704b, alpha: 0.75 });
      const tents = 1 + Math.floor(random() * 2);
      for (let n = 0; n < tents; n++) {
        const [x, y] = at(m.x, m.y, m.angle, n * 2.3 - 1, 3);
        const w = 1.4 + random() * 0.5,
          h = 1.5 + random() * 0.7;
        g.poly([x - w, y, x - 0.2, y - h, x + w, y])
          .fill({ color: PAPER, alpha: 0.9 })
          .stroke({ width: 0.14, color: INK, alpha: 0.8, join: 'round' });
        g.poly([x - 0.2, y - h, x + w, y, x + 0.2, y]).fill({ color: 0x9f8964, alpha: 0.7 });
      }
      const sheep = 4 + Math.floor(random() * 5);
      for (let n = 0; n < sheep; n++) {
        const [x, y] = at(m.x, m.y, m.angle, (random() - 0.5) * 8, -2 - random() * 2.5);
        g.ellipse(x, y, 0.65 + random() * 0.15, 0.4)
          .fill(0xf0e7d0)
          .stroke({ width: 0.12, color: INK, alpha: 0.7 });
        g.circle(x + (random() < 0.5 ? -0.65 : 0.65), y - 0.05, 0.2).fill(0x67543c);
      }
    }
  }
}
