#!/usr/bin/env ts-node
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

interface StepResult {
  command: string;
  durationMs: number;
}

function resolveReleaseId() {
  const explicit = process.env.RELEASE_ID;
  if (explicit && explicit.trim()) return explicit.trim();
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return `local-${Date.now()}`;
}

function spawnWithPromise(command: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs?: number): Promise<StepResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const child = spawn(command, args, { stdio: 'inherit', env });
    const timer = timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command ${command} timed out after ${timeoutMs}ms`));
        }, timeoutMs)
      : null;

    child.on('exit', (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) {
        resolve({ command: `${command} ${args.join(' ')}`.trim(), durationMs: Date.now() - started });
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

async function main() {
  console.log('[Deploy] Starting paper canary...');
  const releaseId = resolveReleaseId();
  const summaryDir = process.env.RELEASE_REPORT_DIR || path.resolve('reports', 'releases', releaseId);
  fs.mkdirSync(summaryDir, { recursive: true });
  const summaryPath = path.join(summaryDir, 'paper-canary.json');
  const startedAt = new Date();

  const env = {
    ...process.env,
    PAPER_MODE: 'true',
    SUMMARY_ONLY: process.env.SUMMARY_ONLY ?? 'true',
    CANARY_MODE: 'paper',
  };

  try {
    const buildResult = await spawnWithPromise('npm', ['run', 'build'], env);
    const canaryTimeout = Number(process.env.CANARY_TIMEOUT_MS || '600000');
    const runResult = await spawnWithPromise('node', ['dist/index.js'], env, canaryTimeout);

    const summary = {
      releaseId,
      mode: 'paper',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      status: 'passed',
      steps: [buildResult, runResult],
    };
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log('[Deploy] Paper canary completed. Summary ->', summaryPath);
  } catch (err) {
    const errorSummary = {
      releaseId,
      mode: 'paper',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
    fs.writeFileSync(summaryPath, JSON.stringify(errorSummary, null, 2));
    throw err;
  }
}

main().catch((err) => {
  console.error('[Deploy] Failed:', err);
  process.exit(1);
});
