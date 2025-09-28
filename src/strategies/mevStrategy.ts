import path from 'path';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';
import type { StrategyRunContext } from './types';
import { buildMevEnvironment, MevConfigError } from '../services/mev/config';

export async function runMevBot(ctx: StrategyRunContext) {
  if (ctx.runMode !== 'live') {
    logger.info('mev_bot_simulation', {
      event: 'mev_bot_simulation',
      clientId: ctx.clientId,
      planId: ctx.planId,
      pair: ctx.pair,
      runMode: ctx.runMode,
      note: 'MEV bot only supports live execution; simulation skipped',
    });
    return;
  }

  let envConfig;
  try {
    envConfig = buildMevEnvironment(ctx);
  } catch (error) {
    if (error instanceof MevConfigError) {
      logger.error('mev_bot_config_error', {
        event: 'mev_bot_config_error',
        clientId: ctx.clientId,
        planId: ctx.planId,
        code: error.code,
        message: error.message,
      });
    }
    throw error;
  }

  const scriptDir = path.resolve(__dirname, 'mev-bot');
  const scriptPath = path.join(scriptDir, 'mev-bot.js');
  logger.info('mev_bot_start', {
    event: 'mev_bot_start',
    clientId: ctx.clientId,
    planId: ctx.planId,
    pair: ctx.pair,
    config: envConfig.summary,
  });

  await new Promise<void>((resolve, reject) => {
    // 🔧 FIX: use the actual Node binary and preserve PATH + the rest of the env
    const child = spawn(process.execPath, [scriptPath], {
        env: { ...process.env, ...envConfig.env },
      cwd: scriptDir,
      stdio: 'inherit',
    });

    child.on('error', (error) => {
      logger.error('mev_bot_spawn_failed', {
        event: 'mev_bot_spawn_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      reject(error);
    });

    child.on('exit', (code) => {
      if (code === 0) {
        logger.info('mev_bot_complete', {
          event: 'mev_bot_complete',
          clientId: ctx.clientId,
          planId: ctx.planId,
        });
        resolve();
      } else {
        const error = new Error(`mev_bot_exit_code:${code}`);
        logger.error('mev_bot_failed', {
          event: 'mev_bot_failed',
          clientId: ctx.clientId,
          planId: ctx.planId,
          code,
        });
        reject(error);
      }
    });
  });
}
