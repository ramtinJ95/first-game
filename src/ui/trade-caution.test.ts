import { expect, test } from 'vitest';
import { buildFixture, FIXTURE as f } from '../sim/fixture.ts';
import { limitsOf } from '../sim/systems/economy.ts';
import { tradeCaution } from './trade-caution.ts';

test('forecasts name full treasuries and distinguish opening space from wasted later receipts', () => {
  const game = buildFixture();
  const from = game.cities[f.roma];
  const to = game.cities[f.carthago];
  const rome = game.factions[f.rome];
  const carthage = game.factions[f.carthage];
  if (!from || !to || !rome || !carthage) throw new Error('missing fixture');
  expect(tradeCaution(game, from, to)).toBeUndefined();
  const limits = limitsOf(game);
  rome.stores.gold = limits.get(f.rome)?.gold ?? 0;
  expect(tradeCaution(game, from, to)).toContain('Your treasury is full now');
  expect(tradeCaution(game, from, to)).toContain('Opening spends gold and raises the limit');
  carthage.stores.gold = limits.get(f.carthage)?.gold ?? 0;
  expect(tradeCaution(game, from, to)).toContain("Carthage's treasury are full now");
  rome.stores.gold--;
  expect(tradeCaution(game, from, to)).toContain("Carthage's treasury is full now");
});
