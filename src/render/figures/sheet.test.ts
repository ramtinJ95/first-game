import { describe, expect, it } from 'vitest';
import { TROOPS, type Troop } from '../../sim/troops.ts';
import { SHEET_OWNERS } from '../armies/scene.ts';
import { figureKey, layoutSheet, sheetArt } from './sheet.ts';

describe('the figure sheets', () => {
  it("hold in each colour the shared troops and that power's own, and no other power's", () => {
    const art = sheetArt();
    for (const owner of SHEET_OWNERS) {
      const layout = layoutSheet(art, owner, 14);
      for (const troop of Object.keys(TROOPS) as Troop[]) {
        const power = TROOPS[troop].signature?.power;
        expect(layout.cells.has(figureKey(troop, 'march', 0)), `${troop} in ${owner}`).toBe(
          !power || power === owner,
        );
      }
    }
  });
});
