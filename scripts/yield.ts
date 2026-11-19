import { spawnSync } from 'node:child_process';
import { yieldToTests } from './runs.ts';

const [command, ...args] = process.argv.slice(2);
if (!command) throw new Error('usage: node scripts/yield.ts <command> [args...]');
await yieldToTests();
const result = spawnSync(command, args, { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
