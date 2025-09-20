#!/usr/bin/env ts-node
import { spawn } from 'child_process';

async function main() {
  console.log('[Deploy] Starting paper canary...');
  const env = { ...process.env, PAPER_MODE: 'true', SUMMARY_ONLY: process.env.SUMMARY_ONLY ?? 'false' };
  const build = spawn('npm', ['run', 'build'], { stdio: 'inherit', env });
  await new Promise((resolve, reject) => {
    build.on('exit', (code) => (code === 0 ? resolve(null) : reject(new Error(`build exited ${code}`))));
  });

  const run = spawn('node', ['dist/index.js'], { stdio: 'inherit', env });
  run.on('exit', (code) => {
    if (code === 0) {
      console.log('[Deploy] Paper canary completed.');
    } else {
      console.error('[Deploy] Paper canary exited with code', code);
    }
  });
}

main().catch((err) => {
  console.error('[Deploy] Failed:', err);
  process.exit(1);
});
