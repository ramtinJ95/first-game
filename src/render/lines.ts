/**
 * Scales map points into pixels for a stroke, keeping a point only when it lies at
 * least `minStep` pixels from the last one kept. Both ends stay, so lines still meet.
 * Strokes are built in pixels because PixiJS sizes round joins by the line width in
 * the units it draws in, and a few pixels in km at the widest zoom is a vast join.
 */
export function toPixels(
  points: readonly (readonly [number, number])[],
  scale: number,
  minStep: number,
): number[] {
  const flat: number[] = [];
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  for (const [i, [x, y]] of points.entries()) {
    const px = x * scale;
    const py = y * scale;
    const end = i === 0 || i === points.length - 1;
    if (!end && Math.hypot(px - lastX, py - lastY) < minStep) continue;
    flat.push(px, py);
    lastX = px;
    lastY = py;
  }
  return flat;
}
