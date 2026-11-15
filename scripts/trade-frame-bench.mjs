import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { tradingRome, tradeRoute } from '../e2e/trade-game.ts';
import { routePoint } from '../src/sim/trade/routes.ts';

// Build both checkouts first. Run only with exclusive access to the benchmark host.
const { values } = parseArgs({
  options: {
    rules: { type: 'string' },
    head: { type: 'string' },
    out: { type: 'string' },
    unselected: { type: 'boolean', default: false },
    steady: { type: 'boolean', default: false },
  },
});
if (!values.rules || (!values.head && !values.steady) || !values.out)
  throw new Error(
    'Usage: node scripts/trade-frame-bench.mjs --rules /abs/rules (--head /abs/look | --steady) --out /abs/evidence [--unselected]',
  );
// --steady measures the rules build against itself, to show the host's noise.
const dirs = {
  rules: resolve(values.rules),
  head: resolve(values.steady ? values.rules : (values.head ?? '')),
};
const output = resolve(values.out);
mkdirSync(output, { recursive: true });
const selected = !values.unselected;
const temp = mkdtempSync(join(tmpdir(), 'trade-frame-'));
const fixture = tradingRome();
const centre = routePoint(tradeRoute(fixture, 'land'));
const results = [];
const rounds = 3;
function replaced(source, pattern, replacement) {
  const result = source.replace(pattern, replacement);
  if (result === source) throw new Error(`frame-bench source did not match ${pattern}`);
  return result;
}
try {
  const scripts = {};
  for (const side of ['rules', 'head']) {
    const kind = side === 'head' && !values.steady ? 'head' : 'rules';
    const root = dirs[side],
      require = createRequire(`${root}/package.json`);
    const game = structuredClone(fixture);

    if (kind === 'rules') for (const route of Object.values(game.tradeRoutes)) delete route.raid;
    const stateFile = join(temp, `${side}.json`);
    writeFileSync(stateFile, JSON.stringify(game));
    const original = pathToFileURL(`${root}/e2e/frame-bench.ts`);
    let source = readFileSync(original, 'utf8');
    source = source.replace(/from ['"]([^'"]+)['"]/g, (match, id) => {
      if (id.startsWith('node:')) return match;
      let target;
      if (id.startsWith('.')) target = new URL(id, original).href;
      else {
        let file = require.resolve(id);
        if (id === '@playwright/test') file = join(dirname(file), 'index.mjs');
        if (!existsSync(file)) throw new Error(`missing import ${file}`);
        target = pathToFileURL(file).href;
      }
      return `from ${JSON.stringify(target)}`;
    });
    source = `import { readFileSync } from 'node:fs';\n${source}`;
    source = replaced(
      source,
      /const days = 1 \+ Number\(values.days\);[\s\S]*?const armies = Object.values\(game.armies\);/,
      `const game = JSON.parse(readFileSync(${JSON.stringify(stateFile)}, 'utf8'));\nconst days = game.day;\nconst save = saveGame(game);\nconst armies = Object.values(game.armies);`,
    );
    source = replaced(
      source,
      'middle: { at: { x: 2600, y: 2200 }, scale: 1 }',
      `middle: { at: ${JSON.stringify(centre)}, scale: 1 }`,
    );
    source = replaced(
      source,
      'closest: { at: { x: 2420, y: 1880 }, scale: 4.2 }',
      `closest: { at: ${JSON.stringify(centre)}, scale: 4.2 }`,
    );
    source = replaced(
      source,
      '  const gl = await page.evaluate(() => {',
      `
  console.error('paths', await page.locator('canvas').getAttribute('data-trade-paths'));
  console.error('subject', ${JSON.stringify(side)}, zoom, 'merchants at end', await page.locator('canvas').getAttribute('data-trade-figures'));
  if (${JSON.stringify(kind)} === 'head') {
    const paths = await page.locator('canvas').getAttribute('data-trade-paths');
    if (paths !== ${JSON.stringify(selected ? '2' : '0')}) throw new Error('Selected routes changed during sampling: ' + paths);
  }
  const gl = await page.evaluate(() => {`,
    );
    source = replaced(
      source,
      '  await delay(WARM_MS + WINDOW_MS);',
      `
  if (${JSON.stringify(kind)} === 'head') await page.locator('canvas[data-figure-sheets="ready"]').waitFor();
  const firstDay = Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
  // Merchants travel during the window, so the matched scene is checked where it starts.
  const merchants = Number(await page.locator('canvas').getAttribute('data-trade-figures'));
  if (${JSON.stringify(kind)} === 'head') {
    const expected = 4;
    if (merchants !== expected) throw new Error('Merchant scene differs: expected ' + expected + ', saw ' + merchants + ' on day ' + firstDay);
  }
  await delay(WARM_MS + WINDOW_MS);
  const lastDay = Number(await page.getByTestId('time-controls-day').getAttribute('data-day'));
  if (lastDay <= firstDay) throw new Error('the measured game did not advance');
  console.error('motion', ${JSON.stringify(side)}, zoom, firstDay, lastDay);`,
    );

    if (selected)
      source = replaced(
        source,
        '  const view = ZOOMS[zoom];',
        `
  const roma = map.provinces.find(p => p.id === 'roma');
  if (!roma) throw new Error('no Roma');
  const at = mapToScreen(fitCamera({width:1280,height:720}, map), {width:1280,height:720}, {x:roma.city[0],y:roma.city[1]+40});
  await page.mouse.click(at.x,at.y);
  await page.waitForFunction(() => document.querySelector('[data-testid="city-name"]')?.textContent === 'Roma');
  const view = ZOOMS[zoom];`,
      );

    if (!source.includes('const beforeLoad =')) {
      source = replaced(
        source,
        '{ map, openGame, startGame }',
        '{ map, openGame, pause, resume, startGame }',
      );
      const reference = readFileSync(new URL('../e2e/frame-bench.ts', import.meta.url), 'utf8');
      const receipt = reference.slice(
        reference.indexOf('  if (save) {'),
        reference.indexOf('  const view = ZOOMS[zoom];'),
      );
      source = replaced(source, / {2}if \(save\) \{[\s\S]*?\n {2}\}/, receipt.trimEnd());
    }
    if (!source.includes('const exactScale ='))
      source = replaced(
        source,
        '  const from = mapToScreen(camera, viewport, at);',
        `
  const exactScale = Math.min(scale, 4);
  const finalDelta = -Math.log(exactScale / camera.scale) / 0.002;
  await page.mouse.wheel(0, finalDelta);
  camera = zoomAt(camera, cursor, wheelFactor(finalDelta), viewport, map);
  const from = mapToScreen(camera, viewport, at);`,
      );
    source = source.replace('  await resume(page);', '');
    source = replaced(
      source,
      '  const firstDay =',
      `
  const terrain = await page.locator('canvas').getAttribute('data-terrain');
  if (terrain !== 'ready') throw new Error('Measured terrain is not ready: ' + terrain);
  const actualZoom = await page.locator('canvas').getAttribute('data-zoom');
  const expectedZoom = zoom === 'closest' ? '4.0000' : '1.0000';
  if (actualZoom !== expectedZoom) throw new Error('Measured zoom ' + actualZoom + ' is not exact target ' + expectedZoom);
  console.error('ready zoom', actualZoom);
  if (${JSON.stringify(selected)}) {
    if (await page.getByTestId('city-name').textContent() !== 'Roma') throw new Error('Selected city changed before warmup');
    const selectedPaths = await page.locator('canvas').getAttribute('data-trade-paths');
    if (selectedPaths !== null && selectedPaths !== '2') throw new Error('Expected two selected routes before warmup, saw ' + selectedPaths);
  }
  const firstDay =`,
    );
    source = replaced(
      source,
      '  await delay(WARM_MS + WINDOW_MS);',
      '  await resume(page);\n  await delay(WARM_MS + WINDOW_MS);',
    );
    source = replaced(
      source,
      '  await resume(page);',
      '  if (firstDay !== days) throw new Error("Measured fixture day drifted before warmup: " + firstDay + " vs " + days);\n  await resume(page);',
    );
    scripts[side] = join(temp, `${side}.ts`);
    writeFileSync(scripts[side], source);
  }
  console.log(
    'Matched six-day trade world; exact scales 1 and 4; paused setup; original 1500/5000 ms windows.',
  );
  console.log(
    'Sources',
    Object.fromEntries(
      Object.entries(dirs).map(([side, root]) => [
        side,
        spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim(),
      ]),
    ),
  );
  for (let round = 1; round <= rounds; round++) {
    for (const side of round % 2 ? ['rules', 'head'] : ['head', 'rules']) {
      console.log('running', round, side, new Date().toISOString());
      console.log(spawnSync('uptime', [], { encoding: 'utf8' }).stdout.trim());
      const result = spawnSync(
        process.execPath,
        [
          scripts[side],
          '--rounds',
          '1',
          '--only',
          'full',
          '--zooms',
          'middle,closest',
          '--root',
          dirs[side],
        ],
        {
          cwd: dirs[side],
          encoding: 'utf8',
          timeout: 180000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
      writeFileSync(join(output, `${round}-${side}.log`), `${result.stderr}\n${result.stdout}`);
      console.log(result.stderr, result.stdout);
      if (result.status !== 0)
        throw result.error ?? new Error(`frame bench ${side} exited ${result.status}`);
      const readings = result.stdout
        .split('\n')
        .filter((line) => /^\| full @ /.test(line))
        .map((line) => {
          const values = line.split('|').map((s) => s.trim());
          return {
            zoom: values[1],
            intervalMedian: Number(values[2]),
            intervalP95: Number(values[3]),
            drawMedian: Number(values[4]),
            drawP95: Number(values[5]),
          };
        });
      if (
        readings.length !== 2 ||
        readings.some(
          (r) =>
            ![r.intervalMedian, r.intervalP95, r.drawMedian, r.drawP95].every(
              (n) => Number.isFinite(n) && n > 0,
            ),
        )
      )
        throw new Error('Missing or invalid meter readings');
      results.push({ round, side, readings });
      writeFileSync(join(output, 'comparison.json'), JSON.stringify(results, null, 2));
    }
  }

  const keys = ['intervalMedian', 'intervalP95', 'drawMedian', 'drawP95'];
  const median = (xs) => [...xs].sort((a, b) => a - b)[1];
  const summary = ['middle', 'closest'].map((zoom) => {
    const pick = (side) => {
      const readings = results
        .filter((r) => r.side === side)
        .map((r) => r.readings.find((v) => v.zoom === 'full @ ' + zoom));
      if (readings.length !== 3 || readings.some((r) => !r))
        throw new Error('Incomplete paired comparison');
      return Object.fromEntries(keys.map((key) => [key, median(readings.map((r) => r[key]))]));
    };
    const rules = pick('rules'),
      head = pick('head');
    const changePercent = Object.fromEntries(
      keys.map((key) => [key, 100 * (head[key] / rules[key] - 1)]),
    );
    return {
      zoom,
      rules,
      head,
      changePercent,
      pass: keys.every((key) => changePercent[key] <= 10),
    };
  });
  writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.every((r) => r.pass)) process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
