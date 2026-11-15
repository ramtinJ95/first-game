import { expect, test } from 'vitest';
import { buildFixture, FIXTURE as f } from '../sim/fixture.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import { tradeCaution } from './trade-caution.ts';

test('a full treasury names whose it is and who loses by it', () => {
  const game = buildFixture();
  const from = game.cities[f.roma];
  const to = game.cities[f.carthago];
  const rome = game.factions[f.rome];
  const carthage = game.factions[f.carthage];
  if (!from || !to || !rome || !carthage) throw new Error('missing fixture');
  expect(tradeCaution(game, from, to)).toBeUndefined();
  const limits = limitsOf(game);
  carthage.stores.gold = limits.get(f.carthage)?.gold ?? 0;
  expect(tradeCaution(game, from, to)).toBe(
    "Carthage's treasury is full now, so Carthage loses its own receipts above its limit. That costs Carthage, not you: your share of each arrival is paid in full.",
  );
  rome.stores.gold = limits.get(f.rome)?.gold ?? 0;
  expect(tradeCaution(game, from, to)).toMatch(
    /^Your treasury is full now\. Opening spends gold and raises your limit, but your later receipts above the limit are lost, so spend gold to keep earning\. Carthage's treasury is full now/,
  );
});
