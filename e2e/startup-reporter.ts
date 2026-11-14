import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { Reporter, TestCase, TestResult, TestStep } from '@playwright/test/reporter';

/** Observe the shared helper without modifying it alongside feature branches. */
export default class StartupReporter implements Reporter {
  private starts = 0;
  private startupMs = 0;
  private testMs = 0;
  private readonly lines = readFileSync(new URL('./support.ts', import.meta.url), 'utf8').split(
    '\n',
  );
  private readonly navigation =
    this.lines.findIndex((line) => line.includes('await page.goto(')) + 1;
  private readonly ready =
    this.lines.findIndex((line) => line.includes("await page.getByTestId('top-bar').waitFor(")) + 1;

  onBegin() {
    if (!this.navigation || !this.ready) throw new Error('Cannot locate openGame startup calls');
  }

  onStepEnd(_test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category !== 'pw:api' || !step.location?.file.endsWith('/e2e/support.ts')) return;
    if (step.location.line === this.navigation) {
      this.starts++;
      this.startupMs += step.duration;
    } else if (step.location.line === this.ready) this.startupMs += step.duration;
  }

  onTestEnd(_test: TestCase, result: TestResult) {
    this.testMs += result.duration;
  }

  onEnd() {
    mkdirSync('playwright-report', { recursive: true });
    writeFileSync(
      'playwright-report/game-starts.json',
      JSON.stringify(
        { starts: this.starts, startupMs: this.startupMs, testMs: this.testMs },
        null,
        2,
      ) + '\n',
    );
    console.log(`Game starts: ${this.starts}, ${this.startupMs}ms of ${this.testMs}ms test time`);
  }
}
