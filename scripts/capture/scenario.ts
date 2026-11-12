import type { Page } from '@playwright/test';

export interface CaptureContext {
  page: Page;
  shot(name: string, title: string): Promise<void>;
}

export interface Scenario {
  name: string;
  title: string;
  viewport?: { width: number; height: number };
  run(ctx: CaptureContext): Promise<void>;
}

export function defineScenario(s: Scenario): Scenario {
  return s;
}
