import path from 'path';
import { spawn } from 'child_process';
import { logger } from '../utils/logger';
import type { StrategyRunContext } from './types';
import { buildMevEnvironment, MevConfigError } from '../services/mev/config';
import { probeMevRuntime, MevProbeError } from '../services/mev/probe';

export async function runMevBot(ctx: StrategyRunContext) {
  const updateSecretMetadata = async (patch: Record<string, unknown>) => {
    if (!ctx.services?.updateStrategySecretMetadata) return;
    try {
      await ctx.services.updateStrategySecretMetadata(patch);
    } catch (error) {
      logger.warn('mev_bot_metadata_update_failed', {
        event: 'mev_bot_metadata_update_failed',
        clientId: ctx.clientId,
        planId: ctx.planId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

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

  let preflight;
  try {
    preflight = await probeMevRuntime(envConfig.env);
  } catch (error) {
    if (error instanceof MevProbeError) {
      logger.error('mev_bot_preflight_failed', {
        event: 'mev_bot_preflight_failed',
        clientId: ctx.clientId,
        planId: ctx.planId,
        code: error.code,
        message: error.message,
      });
      const failedAt = new Date().toISOString();
      await updateSecretMetadata({
        lastPreflightError: {
          timestamp: failedAt,
          code: error.code,
          message: error.message,
        },
        lastPreflightAt: failedAt,
      });
    }
    throw error;
  }

  const MIN_BALANCE_WEI = 50_000_000_000_000_000n; // 0.05 ETH threshold to warn about funding
  const balanceWei = BigInt(preflight.balanceWei);
  const fundingStatus = balanceWei === 0n ? 'zero' : balanceWei < MIN_BALANCE_WEI ? 'low' : 'ok';

  const preflightTimestamp = new Date().toISOString();
  const preflightLog = {
    chainId: preflight.chainId,
    networkName: preflight.networkName,
    latestBlockNumber: preflight.latestBlockNumber,
    walletAddress: preflight.walletAddress,
    balanceWei: preflight.balanceWei,
    balanceEth: preflight.balanceEth,
    gasPriceGwei: preflight.gasPriceGwei,
    fundingStatus,
    timestamp: preflightTimestamp,
  };

  await updateSecretMetadata({
    lastPreflightAt: preflightTimestamp,
    lastPreflight: {
      timestamp: preflightTimestamp,
      chainId: preflight.chainId,
      networkName: preflight.networkName ?? null,
      latestBlockNumber: preflight.latestBlockNumber,
      walletAddress: preflight.walletAddress,
      balanceWei: preflight.balanceWei,
      balanceEth: preflight.balanceEth,
      gasPriceWei: preflight.gasPriceWei,
      gasPriceGwei: preflight.gasPriceGwei,
      fundingStatus,
    },
    lastPreflightError: null,
  });

  if (fundingStatus !== 'ok') {
    logger.warn('mev_bot_balance_warning', {
      event: 'mev_bot_balance_warning',
      clientId: ctx.clientId,
      planId: ctx.planId,
      fundingStatus,
      balanceEth: preflight.balanceEth,
      walletAddress: preflight.walletAddress,
      portfolioAllocationUsd: ctx.config?.portfolioAllocationUsd ?? null,
    });
  }

  if (ctx.runMode !== 'live') {
    logger.info('mev_bot_simulation', {
      event: 'mev_bot_simulation',
      clientId: ctx.clientId,
      planId: ctx.planId,
      pair: ctx.pair,
      runMode: ctx.runMode,
      note: 'MEV bot run skipped for non-live mode; preflight completed.',
      config: envConfig.summary,
      preflight: preflightLog,
      portfolioAllocationUsd: ctx.config?.portfolioAllocationUsd ?? null,
      portfolioWeightPct: ctx.config?.portfolioWeightPct ?? null,
    });
    return;
  }

  const scriptDir = path.resolve(__dirname, 'mev-bot');
  const scriptPath = path.join(scriptDir, 'mev-bot.js');
  logger.info('mev_bot_start', {
    event: 'mev_bot_start',
    clientId: ctx.clientId,
    planId: ctx.planId,
    pair: ctx.pair,
    config: envConfig.summary,
    preflight: preflightLog,
    portfolioAllocationUsd: ctx.config?.portfolioAllocationUsd ?? null,
    portfolioWeightPct: ctx.config?.portfolioWeightPct ?? null,
  });

  await new Promise<void>((resolve, reject) => {
    // 🔧 FIX: use the actual Node binary and preserve PATH + the rest of the env
    const child = spawn(process.execPath, [scriptPath], {
        env: { ...process.env, ...envConfig.env, MEV_RUN_MODE: ctx.runMode },
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
