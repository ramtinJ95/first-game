import type { Page } from '@playwright/test';

export interface CaptureContext {
  page: Page;
  shot(name: string, title: string): Promise<void>;
}

export interface Scenario {
  name: string;
  title: string;
  viewport?: { width: number; height: number };
  /** Recording duration only, not a scenario/test timeout. Omitted keeps the short default clip. */
  clipSeconds?: number;
  run(ctx: CaptureContext): Promise<void>;
}

export function defineScenario(s: Scenario): Scenario {
  if (
    s.clipSeconds !== undefined &&
    (!Number.isInteger(s.clipSeconds) || s.clipSeconds < 1 || s.clipSeconds > 120)
  ) {
    throw new Error('clipSeconds must be an integer from 1 to 120');
  }
  return s;
}
