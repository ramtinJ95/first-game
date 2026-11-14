/** User-timing boundaries for the synchronous work before the first map frame. */
export function startupStep<T>(name: string, build: () => T): T {
  const start = performance.now();
  const value = build();
  performance.measure(`startup:${name}`, { start });
  return value;
}
