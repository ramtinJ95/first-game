import { describe, expect, it } from 'vitest';
import { buildFixture, FIXTURE as f } from '../sim/fixture.ts';
import type { BattleId } from '../sim/ids.ts';
import type { Day } from '../sim/state/day.ts';
import { shownBattles } from './describe.ts';

function withBattle() {
  const state = buildFixture();
  const id = 'battle-9' as BattleId;
  state.battles[id] = {
    id,
    position: { x: 2516, y: 2340 },
    attackers: [f.punicArmy],
    defenders: [f.romanArmy],
    startedOn: 1 as Day,
  };
  return { state, id };
}

describe('shownBattles', () => {
  it('shows the selected battle while it lasts', () => {
    const { state, id } = withBattle();
    expect(shownBattles(state, { kind: 'battle', battle: id }).map((b) => b.id)).toEqual([id]);
  });

  it("falls back to the player's battles once the selected one has ended", () => {
    const { state, id } = withBattle();
    const ended = 'battle-1' as BattleId;
    expect(shownBattles(state, { kind: 'battle', battle: ended }).map((b) => b.id)).toEqual([id]);
    expect(shownBattles(state, { kind: 'army', army: f.punicArmy }).map((b) => b.id)).toEqual([id]);
  });

  it('shows no battle when none of the player is fought and none is selected', () => {
    expect(shownBattles(buildFixture(), undefined)).toEqual([]);
  });
});
