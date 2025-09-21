#!/usr/bin/env ts-node
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { spawnSync } from 'child_process';
import path from 'path';

interface Stage {
  name: string;
  command?: string;
  env?: Record<string, string>;
}

interface WalkConfig {
  stages: Stage[];
}

interface StageResult {
  name: string;
  command: string;
  startedAt: string;
  durationMs: number;
  env: Record<string, string>;
  status: 'passed';
}

interface StrategyReport {
  strategy: string;
  configPath: string;
  releaseId: string;
  startedAt: string;
  completedAt: string;
  status: 'passed' | 'failed';
  stages: StageResult[];
  failure?: {
    stage: string;
    message: string;
  };
}

function resolveReleaseId() {
  const explicit = process.env.RELEASE_ID || process.env.WALKFORWARD_RELEASE;
  if (explicit && explicit.trim()) return explicit.trim();
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  return `local-${Date.now()}`;
}

function discoverConfigs(): Array<{ strategy: string; configPath: string }> {
  const explicit = process.env.WALKFORWARD_CONFIG;
  if (explicit) {
    const resolved = path.resolve(explicit);
    if (!existsSync(resolved)) {
      throw new Error(`Walk-forward config not found: ${resolved}`);
    }
    return [
      {
        strategy: path.basename(resolved, path.extname(resolved)) || 'default',
        configPath: resolved,
      },
    ];
  }

  const dirCandidate = path.resolve('configs', 'walkforward');
  if (existsSync(dirCandidate) && statSync(dirCandidate).isDirectory()) {
    const entries = readdirSync(dirCandidate)
      .filter((file) => file.endsWith('.json'))
      .map((file) => ({
        strategy: path.basename(file, '.json'),
        configPath: path.join(dirCandidate, file),
      }));
    if (entries.length) {
      return entries;
    }
  }

  const fallback = path.resolve('configs', 'walkforward.json');
  if (existsSync(fallback)) {
    return [
      {
        strategy: 'default',
        configPath: fallback,
      },
    ];
  }

  throw new Error('No walk-forward configs found. Provide WALKFORWARD_CONFIG or add JSON files under configs/walkforward/.');
}

function runStage(strategy: string, stage: Stage): StageResult {
  const command = stage.command ?? 'npm run backtest';
  const [cmd, ...args] = command.split(' ');
  const env = { ...process.env, ...(stage.env || {}) };
  const started = Date.now();
  console.log(`\n[WalkForward][${strategy}] Stage: ${stage.name}`);
  console.log(`[WalkForward][${strategy}] Command: ${command}`);
  const result = spawnSync(cmd, args, {
    env,
    encoding: 'utf8',
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    const err = result.error ? String(result.error) : `exit code ${result.status}`;
    throw new Error(`Stage '${stage.name}' failed: ${err}`);
  }
  return {
    name: stage.name,
    command,
    startedAt: new Date(started).toISOString(),
    durationMs: Date.now() - started,
    env: stage.env || {},
    status: 'passed',
  };
}

function writeReport(report: StrategyReport) {
  const baseDir =
    process.env.WALKFORWARD_REPORT_DIR || path.resolve('reports', 'releases', report.releaseId, 'walkforward');
  mkdirSync(baseDir, { recursive: true });
  const filePath = path.join(
    baseDir,
    `${report.strategy}-${report.status}-${Date.now()}.json`
  );
  writeFileSync(filePath, JSON.stringify(report, null, 2));
  console.log(`[WalkForward] Report written -> ${filePath}`);
}

function runStrategy(strategy: string, configPath: string, releaseId: string) {
  const config: WalkConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!config.stages || !config.stages.length) {
    throw new Error(`No stages defined in walk-forward config: ${configPath}`);
  }

  const startedAt = new Date();
  const stages: StageResult[] = [];
  let failure: StrategyReport['failure'];

  for (const stage of config.stages) {
    try {
      const stageResult = runStage(strategy, stage);
      stages.push(stageResult);
    } catch (err) {
      failure = {
        stage: stage.name,
        message: err instanceof Error ? err.message : String(err),
      };
      const failedReport: StrategyReport = {
        strategy,
        configPath,
        releaseId,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        status: 'failed',
        stages,
        failure,
      };
      writeReport(failedReport);
      throw err;
    }
  }

  const report: StrategyReport = {
    strategy,
    configPath,
    releaseId,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    status: 'passed',
    stages,
  };
  writeReport(report);
}

function main() {
  const releaseId = resolveReleaseId();
  const configs = discoverConfigs();
  for (const { strategy, configPath } of configs) {
    console.log(`\n[WalkForward] Running strategy '${strategy}' with config ${configPath}`);
    runStrategy(strategy, configPath, releaseId);
  }
  console.log('\nWalk-forward workflow completed.');
}

main();
