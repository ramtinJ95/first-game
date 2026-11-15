import { beforeAll, expect, test } from 'vitest';
import drawing from '../../data/map/drawing-coast.json' with { type: 'json' };
import { buildDrawingCoast } from './build-coast.ts';

let rebuilt: Awaited<ReturnType<typeof buildDrawingCoast>>;
beforeAll(async () => {
  rebuilt = await buildDrawingCoast();
}, 60_000);

test('the drawing-only coast rebuilds identically from the checked, pinned finer source', () => {
  expect(rebuilt).toEqual(drawing);
});
