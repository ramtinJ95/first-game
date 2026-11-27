import { expect } from '@playwright/test';
import { alertsOfDay, type Alert } from '../../../src/app/alerts.ts';
import { pageData } from '../../../src/app/page.ts';
import { threatFadedNewsOfDay, threatNewsOfDay } from '../../../src/app/threat-news.ts';
import { saveGame } from '../../../src/sim/save.ts';
import type { GameState } from '../../../src/sim/state/game-state.ts';
import {
  armyOf,
  carthage,
  carthageNearsWar,
  declareWar,
  dropSave,
  openGame,
  pause,
  resume,
  untilDrawn,
} from '../../../e2e/support.ts';
import { changeCityOwner } from '../../../src/sim/cities.ts';
import type { CityId, FactionId, FormationId } from '../../../src/sim/ids.ts';
import type { Day } from '../../../src/sim/state/day.ts';
import { playCautiousRome, world } from '../../cautious-rome.ts';
import { defineScenario } from '../scenario.ts';

const SEED = 5;
const DAYS = 3 * 365 + 180;

/**
 * The cautious Rome of `npm run sim -- threat -- --peaceful` on seed 5 to Year 4, day 180,
 * saved with a chronicle of every war warning the page's own rule told it, every line that a
 * warned threat has passed, and every declaration of war on it, newest first, as the page keeps them.
 */
function cautiousRomeWithItsWarnings(): { save: string; passed: number } {
  const told = new Set<string>();
  const chronicle: Alert[] = [];
  let state: GameState | undefined;
  playCautiousRome(
    SEED,
    4,
    ({ before, after, events }) => {
      if (before.day >= DAYS) return;
      chronicle.unshift(
        ...threatFadedNewsOfDay(before, after, world, told),
        ...threatNewsOfDay(before, after, world, told),
        ...alertsOfDay(before, after, events).filter((alert) => alert.kind === 'warDeclared'),
      );
      if (after.day === DAYS) state = after;
    },
    { peaceful: true },
  );
  if (!state) throw new Error(`Rome fell before day ${DAYS}`);
  const passed = chronicle.filter((alert) => /threat has passed for now/.test(alert.text)).length;
  if (passed === 0) throw new Error(`no warned threat passed by day ${DAYS}`);
  const save = saveGame(
    state,
    pageData({
      chronicle,
      camera: undefined,
      selection: undefined,
      panel: 'chronicle',
      occupied: new Map(),
      told,
      weakSieges: new Map(),
    }),
  );
  return { save, passed };
}

const egypt = 'egypt' as FactionId;

/**
 * Carthage on day 200 on the notice Rome was warned of on day 186, the day after it went to war
 * with an Egypt of 30,000 men that holds Lepcis Magna, in its reach, so the war holds back all
 * its armies, and a week on the line says why its threat passed.
 */
function carthageAtWarElsewhere(): string {
  const state = carthageNearsWar();
  state.day = 200 as Day;
  changeCityOwner(state, 'lepcis-magna' as CityId, egypt);
  const egyptians = state.formations[armyOf(state, egypt).formations[0] as FormationId];
  const punic = state.factions[carthage];
  if (!egyptians || !punic) throw new Error('no Egyptian army or Carthage');
  egyptians.men = 30_000;
  punic.noticeSince = 180 as Day;
  declareWar(state, carthage, egypt);
  return saveGame(
    state,
    pageData({
      chronicle: [],
      camera: undefined,
      selection: undefined,
      panel: undefined,
      occupied: new Map(),
      told: new Set(['threat:carthage:186']),
      weakSieges: new Map(),
    }),
  );
}

export default defineScenario({
  name: 'war-warning-years',
  title:
    'A cautious Rome that trades, hires no guards and declares no war, over its first four years: the war warnings and the lines that each passed, in its chronicle, and the line of a threat that passed because the power went to war elsewhere',
  async run({ page, shot }) {
    await openGame(page);
    await pause(page);
    const { save, passed } = cautiousRomeWithItsWarnings();
    await dropSave(page, save);
    const chronicle = page.getByTestId('chronicle');
    await expect(chronicle).toBeVisible();
    await expect(chronicle.getByText(/threat has passed for now/)).toHaveCount(passed);
    await untilDrawn(page);
    await shot(
      'war-warning-years-chronicle',
      'Every war warning a cautious Rome hears in its first four years on seed 5, and each line that the threat passed, newest first',
    );
    await page.getByRole('button', { name: 'Chronicle' }).click();
    await expect(chronicle).toBeHidden();
    await shot('war-warning-years-corner', 'The news corner on Year 4, day 180');
    await dropSave(page, carthageAtWarElsewhere());
    await resume(page);
    const faded = page
      .getByTestId('alerts')
      .getByText(
        /Carthage's threat has passed for now: it is at war with Egypt, which ties down all its armies/,
      );
    await faded.waitFor();
    await pause(page);
    await untilDrawn(page);
    await shot(
      'war-warning-years-war-elsewhere',
      'A warned Carthage that goes to war with Egypt: the line says its threat passed because that war ties down all its armies, not that it fell to 0%',
    );
  },
});
