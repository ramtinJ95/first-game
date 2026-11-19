import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { noteTestRun, yieldToTests } from './runs.ts';

/**
 * Stands in for the commands `runs.test.ts` watches. `heavy <file> [leave]` yields, then starts
 * a process in a session of its own, as Chromium does, and writes both pids to `file`; with
 * `leave` it ends at once and leaves that process running. `tests` notes a test run and ends
 * it on SIGTERM.
 */
const [role, file, leave] = process.argv.slice(2);
if (role === 'tests') {
  const end = noteTestRun();
  process.on('SIGTERM', () => {
    end();
    process.exit(0);
  });
  setInterval(() => {}, 1000);
} else {
  await yieldToTests();
  const busy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  writeFileSync(file ?? '', JSON.stringify({ copy: process.pid, busy: busy.pid }));
  if (leave) process.exit(0);
  setInterval(() => {}, 1000);
}
