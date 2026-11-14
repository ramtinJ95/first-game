import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { SOFTWARE_GL } from '../playwright.config.ts';

/** Build and preview first. New contexts match openGame's navigation-to-HUD boundary. */
const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://localhost:4173' },
    draw: { type: 'string', default: 'test' },
    rounds: { type: 'string', default: '10' },
    profile: { type: 'string' },
  },
});
const browser = await chromium.launch({ args: [...SOFTWARE_GL] });
const results = [];
for (let i = 0; i < Number(values.rounds); i++) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(() => {
    const links: number[] = [];
    Object.defineProperty(window, '__shaderLinks', { value: links });
    for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const original = prototype.getProgramParameter;
      prototype.getProgramParameter = function (program, parameter) {
        const start = performance.now();
        const result = original.call(this, program, parameter);
        if (parameter === this.LINK_STATUS) links.push(performance.now() - start);
        return result;
      };
    }
  });
  const session = await page.context().newCDPSession(page);
  if (values.profile) {
    await session.send('Profiler.enable');
    await session.send('Profiler.start');
  }
  const start = performance.now();
  await page.goto(`${values.base}/?play=rome&draw=${values.draw}&pauses=off`);
  await page.getByTestId('top-bar').waitFor();
  const ready = performance.now() - start;
  if (values.profile) {
    const { profile } = await session.send('Profiler.stop');
    if (i === 0) writeFileSync(values.profile, JSON.stringify(profile));
  }
  results.push({
    ready,
    shaderLinks: await page.evaluate(
      () => (window as unknown as { __shaderLinks: number[] }).__shaderLinks,
    ),
    batchTextures: await page.locator('canvas[data-renderer]').getAttribute('data-batch-textures'),
    measures: await page.evaluate(() =>
      performance.getEntriesByType('measure').map(({ name, duration }) => ({ name, duration })),
    ),
  });
  await page.close();
}
console.log(
  JSON.stringify(
    { browser: browser.version(), args: SOFTWARE_GL, draw: values.draw, results },
    null,
    2,
  ),
);
await browser.close();
