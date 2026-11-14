import { expect } from '@playwright/test';
import { risingPeacePrice, winningSecondFront } from '../../../e2e/peace-support.ts';
import { dropSave, openGame, pause, siegeToEndInPeace, untilDrawn } from '../../../e2e/support.ts';
import type { FactionId } from '../../../src/sim/ids.ts';
import { saveGame } from '../../../src/sim/save.ts';
import type { Day } from '../../../src/sim/state/day.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import { newWar, warKey } from '../../../src/sim/state/war.ts';
import { defineScenario } from '../scenario.ts';

export default defineScenario({
  name: 'peace-followup',
  title:
    'A second front is a discount, not a free truce; suggested terms send, and incoming prices explain affordability and rises',
  viewport: { width: 1280, height: 900 },
  async run({ page, shot }) {
    await openGame(page);
    const panel = page.getByTestId('wars-panel');
    async function show(state: GameState, save?: string) {
      await pause(page);
      await dropSave(
        page,
        save ??
          saveGame(state, {
            paused: true,
            panel: 'wars',
            chronicle: [],
            occupied: [],
            told: [],
            weakSieges: [],
          }),
      );
      await expect(page.getByTestId('time-controls-day')).toHaveAttribute(
        'data-day',
        String(state.day),
      );
      await untilDrawn(page);
      await expect(panel).toBeVisible();
    }

    await show(winningSecondFront());
    await expect(panel.getByTestId('peace-verdict')).toContainText('100 gold more');
    await shot(
      'winning-second-front',
      '151 Roman casualties and a second war do not buy free early peace: Carthage names Egypt and still asks 100 gold',
    );

    await show(siegeToEndInPeace());
    const choice = panel.getByRole('button', { name: /Send offer — The most Carthage gives/ });
    await expect(choice).toBeEnabled();
    await shot(
      'quick-offer-ready',
      'Suggested terms explicitly say Send offer, not an ambiguous promise of payment',
    );
    await choice.click();
    await expect(panel.getByTestId('our-offer')).toContainText('Carthage gives you 2,800 gold');
    await shot(
      'quick-offer-sent',
      'One click really queues the payment offer, confirms it is sent, and disables duplicate sends',
    );

    const price = risingPeacePrice();
    await show(price.state, price.save);
    await expect(panel.getByTestId('peace-funds')).toContainText('You hold 8,940 gold');
    await expect(panel.getByTestId('peace-price-rise')).toContainText('it took Capua');
    await shot(
      'incoming-price-rise',
      'An incoming 5,100-gold demand against 8,940 held; the rise from 4,500 and the new conquest are explained',
    );
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Chronicle', exact: true }).click();
    await expect(page.getByTestId('chronicle')).toContainText('The price rose');
    await shot(
      'price-rise-news',
      'The same treasury, old and new prices, and changed war facts remain in the offer news',
    );

    const expensive = risingPeacePrice(8900);
    const treasury = expensive.state.factions[expensive.state.player];
    if (!treasury) throw new Error('no player');
    treasury.stores.gold = 8800;
    await show(expensive.state);
    await expect(panel.getByTestId('accept-peace')).toBeDisabled();
    await shot(
      'incoming-unaffordable',
      'After spending, 8,800 held cannot pay 8,900: the shortfall is explicit and Accept is disabled',
    );

    const calendar = winningSecondFront();
    const carthage = 'carthage' as FactionId;
    calendar.day = 900 as Day;
    calendar.wars = {
      [warKey(calendar.player, carthage)]: newWar(carthage, calendar.player, 885 as Day),
    };
    await show(calendar);
    await expect(panel.getByTestId('peace-verdict')).toContainText('before Year 3, day 215');
    await shot(
      'calendar-talks',
      'The existing shared year/day form covers both the war start and the first day of talks',
    );
    calendar.wars = {};
    calendar.truces[warKey(calendar.player, carthage)] = {
      since: 3549 as Day,
      endsOn: 3914 as Day,
    };
    calendar.day = 3900 as Day;
    await show(calendar);
    await expect(panel.getByTestId('truce-row')).toContainText('before Year 11, day 264');
    await shot(
      'calendar-truce',
      'A late-game truce keeps a duration in days and its deadline in calendar form, never raw day 3914',
    );
  },
});
