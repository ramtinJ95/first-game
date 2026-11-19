import { spawn } from 'node:child_process';
import { noteTestRun, writeWhole, yieldToTests } from './runs.ts';

/**
 * Stands in for the commands `runs.test.ts` watches. `heavy <file> [leave]` yields, then starts
 * a process in a session of its own, as Chromium does, and writes both pids to `file`; with
 * `leave` it ends at once and leaves that process running. `tests` notes a test run and ends
 * it on SIGTERM.
 */
const [role, file, leave] = process.argv.slice(2);
if (role === 'tests') {
  // The handler comes first: the note is out before noteTestRun returns, and a SIGTERM a test
  // sends on seeing it waits for the handler instead of ending the run before its end is noted.
  let end = () => {};
  process.on('SIGTERM', () => {
    end();
    // Output to a pipe is written later, so the process ends once it is out, or its last line is lost.
    process.stdout.write('', () => process.exit(0));
  });
  end = noteTestRun();
  setInterval(() => {}, 1000);
} else {
  await yieldToTests();
  const busy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  writeWhole(file ?? '', JSON.stringify({ copy: process.pid, busy: busy.pid }));
  if (leave) process.exit(0);
  setInterval(() => {}, 1000);
}
