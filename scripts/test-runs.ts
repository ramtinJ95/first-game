import { noteTestRun } from './runs.ts';

/** Vitest's global setup: says which heavy commands go beside this test run. */
export default function setup(): () => void {
  return noteTestRun();
}
