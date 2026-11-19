import { beforeAll, describe, expect, test } from 'vitest';
import drawing from '../../data/map/drawing-coast.json' with { type: 'json' };
import { buildDrawingCoast } from './build-coast.ts';
import { DOWNLOAD_LIMIT_MS, loadDrawingLand, type LonLatPolygon } from './sources.ts';

/** A download that fails or hangs fails within DOWNLOAD_LIMIT_MS and names the file. */
const LOAD_TIMEOUT_MS = DOWNLOAD_LIMIT_MS + 30_000;
const BUILD_TIMEOUT_MS = 60_000;

let drawingLand: LonLatPolygon[];
beforeAll(async () => {
  drawingLand = await loadDrawingLand();
}, LOAD_TIMEOUT_MS);

describe('the drawing coast', () => {
  let rebuilt: ReturnType<typeof buildDrawingCoast>;
  beforeAll(() => {
    rebuilt = buildDrawingCoast(drawingLand);
  }, BUILD_TIMEOUT_MS);

  test('the drawing-only coast rebuilds identically from the checked, pinned finer source', () => {
    expect(rebuilt).toEqual(drawing);
  });
});
