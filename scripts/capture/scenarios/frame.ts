import type { Page } from '@playwright/test';
import {
  dropSave,
  mediolanumFallsTomorrow,
  resume,
  romaFallsTomorrow,
  romeWinsTomorrow,
} from '../../../e2e/support.ts';
import { defineScenario } from '../scenario.ts';

const WIDTHS = [
  { width: 1600, height: 900 },
  { width: 1024, height: 768 },
] as const;

async function settle(page: Page, ms = 400) {
  await page.waitForTimeout(ms);
}

export default defineScenario({
  name: 'frame',
  title:
    'The frame round the game at 1600 and 1024 px: the start screen, the guide, the save menu, the fate prompt, the victory announcement, the defeat screen, and Continue',
  viewport: WIDTHS[0],
  async run({ page, shot }) {
    for (const size of WIDTHS) {
      const at = `${size.width}`;
      await page.setViewportSize(size);
      await page.goto('/');
      await page.getByTestId('start-screen').waitFor();
      await settle(page, 800);
      await shot(
        `start-${at}`,
        `${at} px. The start screen: the name, and the five powers with their colour, capital, cities, and position`,
      );

      await page.getByTestId('power-rome').click();
      await page.getByTestId('guide').waitFor();
      await settle(page, 800);
      await shot(
        `guide-${at}`,
        `${at} px. Rome chosen: the game is paused on Roma and the guide gives the goal and the five things to know`,
      );
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Game', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Save in this browser' }).click();
      await page.getByRole('button', { name: 'Game', exact: true }).click();
      await settle(page);
      await shot(
        `save-menu-${at}`,
        `${at} px. The Game menu after a save: save, load your save of day 1, the autosave, export, import, and the start screen`,
      );
      await page.keyboard.press('Escape');

      await dropSave(page, mediolanumFallsTomorrow());
      await resume(page);
      await page.getByTestId('fate-prompt').waitFor();
      await settle(page);
      await shot(
        `fate-${at}`,
        `${at} px. Mediolanum falls to Rome: the game pauses and asks its fate, with what occupying, sacking, and enslaving give and cost`,
      );
      await page.getByTestId('fate-sack').click();

      await dropSave(page, romeWinsTomorrow());
      await page.getByTestId('victory').waitFor();
      await settle(page);
      await shot(
        `victory-${at}`,
        `${at} px. Rome takes its 32nd province with three great capitals: the win is announced and the game waits`,
      );
      await page.getByRole('button', { name: 'Play on' }).click();
      await page.getByTestId('fate-occupy').click();

      await dropSave(page, romaFallsTomorrow());
      await page.getByTestId('defeat').waitFor();
      await settle(page);
      await shot(
        `defeat-${at}`,
        `${at} px. Roma, Rome's last city, falls to Carthage: the game stops on the defeat screen with the day and the choices`,
      );

      await page.getByRole('button', { name: 'Start again' }).click();
      await page.getByRole('button', { name: 'Continue' }).waitFor();
      await settle(page);
      await shot(
        `continue-${at}`,
        `${at} px. Back on the start screen, Continue offers the save written last`,
      );
    }
  },
});
