/**
 * Proves the purity guard fires (.eslintrc.cjs header): writes a canary file full of
 * banned constructs into src/, lints it, and FAILS unless ESLint rejects every one.
 *
 * This is what turns "we have a lint rule" into "the lint rule is known to work" --
 * if a future config migration (e.g. ESLint 9 flat config) silently stops loading the
 * rc file, this script goes red even though `npm run lint` stays green.
 */
import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// One line per banned construct; every marker must appear in the lint output.
const CANARY = `import 'react-native';
import 'expo';
import '@solana/web3.js';
import '@op-engineering/op-sqlite';
import 'fs';
export const t = Date.now();
export const r = Math.random();
export const d = new Date();
export const p = setTimeout(() => {}, 0);
`;
const MUST_FLAG = [
  'react-native',
  'expo',
  '@solana/web3.js',
  '@op-engineering/op-sqlite',
  "'fs'",
  'Date.now',
  'Math.random',
  'new Date()',
  'setTimeout',
];

// The canary must live under src/ so the package's ESLint config governs it, but its
// name keeps it out of tsc/vitest globs and out of any accidental commit.
const canaryPath = join(packageRoot, 'src', '__purity-canary.eslint-must-reject.ts');

let output = '';
let exitCode = 0;
try {
  writeFileSync(canaryPath, CANARY);
  try {
    output = execFileSync('npx', ['eslint', canaryPath], {
      cwd: packageRoot,
      encoding: 'utf8',
    });
    console.error('FAIL: ESLint accepted the canary file -- the purity guard is not firing.');
    exitCode = 1;
  } catch (err) {
    output = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    const missed = MUST_FLAG.filter((marker) => !output.includes(marker));
    if (missed.length > 0) {
      console.error(`FAIL: guard fired but did not flag: ${missed.join(', ')}`);
      console.error(output);
      exitCode = 1;
    } else {
      console.log(`purity guard verified: ESLint rejected all ${MUST_FLAG.length} banned constructs.`);
    }
  }
} finally {
  rmSync(canaryPath, { force: true });
}
process.exit(exitCode);
