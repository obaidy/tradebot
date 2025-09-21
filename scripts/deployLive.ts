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

async function ensureCanaryPassed(releaseId: string, summaryDir: string) {
  const summaryPath = path.join(summaryDir, 'paper-canary.json');
  if (!fs.existsSync(summaryPath)) {
    throw new Error(`Paper canary summary not found for release ${releaseId} at ${summaryPath}`);
  }
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  if (summary.status !== 'passed') {
    throw new Error(`Paper canary status is '${summary.status}'. Aborting live deployment.`);
  }
}

async function main() {
  if ((process.env.PAPER_MODE ?? '').toLowerCase() === 'true') {
    console.error('[Deploy] PAPER_MODE must be false/blank to promote live.');
    process.exit(1);
  }
  if (process.env.PROMOTE_CONFIRM !== 'I_ACKNOWLEDGE_RISK') {
    console.error('[Deploy] Set PROMOTE_CONFIRM=I_ACKNOWLEDGE_RISK to run live promotion.');
    process.exit(1);
  }

  const releaseId = resolveReleaseId();
  const summaryDir = process.env.RELEASE_REPORT_DIR || path.resolve('reports', 'releases', releaseId);
  await ensureCanaryPassed(releaseId, summaryDir);

  console.log('[Deploy] Promoting to live...');
  const env = { ...process.env, PAPER_MODE: 'false', SUMMARY_ONLY: 'false', CANARY_MODE: 'live' };
  const startedAt = new Date();

  try {
    const buildResult = await spawnWithPromise('npm', ['run', 'build'], env);
    const timeoutMs = Number(process.env.LIVE_DEPLOY_TIMEOUT_MS || '600000');
    const runResult = await spawnWithPromise('node', ['dist/index.js'], env, timeoutMs);

    const summary = {
      releaseId,
      mode: 'live',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      status: 'passed',
      steps: [buildResult, runResult],
    };
    fs.mkdirSync(summaryDir, { recursive: true });
    const summaryPath = path.join(summaryDir, 'live-deploy.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log('[Deploy] Live deployment finished. Summary ->', summaryPath);
  } catch (err) {
    const summaryPath = path.join(summaryDir, 'live-deploy.json');
    const failed = {
      releaseId,
      mode: 'live',
      startedAt: startedAt.toISOString(),
      completedAt: new Date().toISOString(),
      status: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
    fs.writeFileSync(summaryPath, JSON.stringify(failed, null, 2));
    throw err;
  }
}

main().catch((err) => {
  console.error('[Deploy] Failed:', err);
  process.exit(1);
});
