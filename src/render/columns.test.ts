import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE } from '../sim/fixture.ts';
import type { RefugeeColumnId } from '../sim/ids.ts';
import type { Sight } from '../sim/sight.ts';
import type { GameState } from '../sim/state/game-state.ts';
import { drawnColumns } from './columns.ts';

const id = 'column-1' as RefugeeColumnId;

function sight(state: GameState, columns: readonly RefugeeColumnId[]): Sight {
  return {
    faction: state.player,
    provinces: new Set(),
    circles: [],
    armies: new Set(),
    convoys: new Set(),
    refugeeColumns: new Set(columns),
    battles: new Set(),
    sees: () => true,
  };
}

function walking(): [GameState, GameState] {
  const previous = buildFixture();
  previous.refugeeColumns[id] = {
    id,
    owner: FIXTURE.rome,
    people: 4000,
    from: FIXTURE.roma,
    to: FIXTURE.capua,
    position: { x: 2511, y: 2336 },
    waypoints: [{ x: 2640, y: 2448 }],
  };
  const current = structuredClone(previous);
  const column = current.refugeeColumns[id];
  if (column) column.position = { x: 2531, y: 2356 };
  return [previous, current];
}

describe('drawnColumns', () => {
  it('places a column in sight between where it stood yesterday and where it stands today', () => {
    const [previous, current] = walking();
    const [drawn] = drawnColumns(previous, current, 0.25, sight(current, [id]));
    expect(drawn?.owner).toBe(FIXTURE.rome);
    expect(drawn?.position.x).toBeCloseTo(2516);
    expect(drawn?.position.y).toBeCloseTo(2341);
  });

  it('draws no mark for a column out of sight', () => {
    const [previous, current] = walking();
    expect(drawnColumns(previous, current, 0.5, sight(current, []))).toEqual([]);
  });
});
