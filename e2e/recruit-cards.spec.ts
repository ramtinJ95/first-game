import { expect, test } from '@playwright/test';
import { carthageNearsWar, openGame, rome } from './support.ts';
import { loadWarnings, showOwnCity } from './warnings-game.ts';
import type { Day } from '../src/sim/state/day.ts';
import { troopsFor } from '../src/sim/troops.ts';

test.use({ viewport: { width: 1280, height: 720 } });

test('with an order waiting that takes Carthage below 80%, each card Roma can raise says so once reckoned, and none is left silent', async ({
  page,
}) => {
  await openGame(page);
  const state = carthageNearsWar();
  const stores = state.factions[rome]?.stores;
  const carthage = state.factions['carthage' as never] as { noticeSince: Day | null } | undefined;
  if (!stores || !carthage) throw new Error('no Roman stores or Carthage');
  stores.manpower = 10_000;
  carthage.noticeSince = 1 as Day;
  await loadWarnings(page, state);
  await showOwnCity(page, 'Roma');
  const cards = page.getByTestId('recruit-cards');
  await expect(page.getByTestId('recruit-threat')).toHaveCount(troopsFor(rome).length);
  await cards.getByRole('button', { name: /^Swordsmen/ }).click();
  const raise = page.getByRole('button', { name: 'Raise anyway' });
  if (await raise.isVisible()) await raise.click();
  await expect(page.getByTestId('city-raising')).toContainText('Swordsmen');
  await expect(page.getByTestId('recruit-threat-reckoning')).toHaveCount(0);
  for (const card of await cards.getByRole('button').all()) {
    const text = await card.innerText();
    expect(text, text).toMatch(
      /Needs [\d,]+ more|Carthage \d+% now|Your orders waiting for tomorrow already take Carthage below 80%\./,
    );
  }
  await expect(page.getByTestId('recruit-threat-lowered').first()).toBeVisible();
});
