#!/usr/bin/env ts-node
import { readFileSync, existsSync } from 'fs';
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

function runStage(stage: Stage) {
  const command = stage.command ?? 'npm run backtest';
  const [cmd, ...args] = command.split(' ');
  const env = { ...process.env, ...(stage.env || {}) };
  console.log(`\n[WalkForward] Stage: ${stage.name}`);
  console.log(`Command: ${command}`);
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env,
  });
  if (result.status !== 0) {
    throw new Error(`Stage '${stage.name}' failed with exit code ${result.status}`);
  }
}

function main() {
  const configPath = process.env.WALKFORWARD_CONFIG || path.resolve('configs', 'walkforward.json');
  if (!existsSync(configPath)) {
    console.error(`Walk-forward config not found: ${configPath}`);
    process.exit(1);
  }
  const config: WalkConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!config.stages || !config.stages.length) {
    console.error('No stages defined in walk-forward config');
    process.exit(1);
  }
  for (const stage of config.stages) {
    runStage(stage);
  }
  console.log('\nWalk-forward workflow completed.');
}

main();
