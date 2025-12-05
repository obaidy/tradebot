import { setTimeout as sleep } from 'timers/promises';
import { ClientBotsRepository, ClientBotRow, BotMode } from './db/clientBotsRepo';
import { ClientBotEventsRepository } from './db/clientBotEventsRepo';
import { GuardStateRepository } from './db/guardStateRepo';
import { getPool } from './db/pool';
import { runGridOnce } from './strategies/gridBot';
import { ClientConfigService, GuardLimits } from './services/clientConfig';
import type { Pool } from 'pg';

const WORKER_INTERVAL_MS = Number(process.env.BOT_WORKER_INTERVAL_MS ?? '5000');
const ALLOW_LIVE = process.env.ALLOW_LIVE === 'true';

type StrategyRunner = (bot: ClientBotRow, mode: BotMode) => Promise<void>;

async function runGridStrategy(bot: ClientBotRow, effectiveMode: BotMode) {
  const config = bot.config ?? {};
  const pair = typeof config.pair === 'string' && config.pair.length > 0 ? (config.pair as string) : bot.symbol;
  const allocationRaw = config.allocationUsd;
  const allocationUsd = typeof allocationRaw === 'number' ? allocationRaw : Number(allocationRaw ?? 0);
  await runGridOnce(pair, undefined, undefined, {
    clientId: bot.clientId,
    runMode: effectiveMode === 'live' ? 'live' : 'paper',
    actor: 'bot-runner',
    clientBotId: bot.id,
    configOverrides: {
      portfolioAllocationUsd: Number.isFinite(allocationUsd) && allocationUsd > 0 ? allocationUsd : undefined,
    },
  });
}

const STRATEGY_RUNNERS: Record<string, StrategyRunner> = {
  grid: runGridStrategy,
};

function evaluateAllocationGuard(bot: ClientBotRow, profile: Awaited<ReturnType<ClientConfigService['getClientProfile']>>) {
  const allocation = Number(bot.config?.allocationUsd ?? 0);
  if (profile.operations.maxExposureUsd && Number.isFinite(profile.operations.maxExposureUsd)) {
    if (allocation > (profile.operations.maxExposureUsd as number)) {
      return {
        reason: 'allocation_exceeds_max_exposure',
        details: { allocationUsd: allocation, maxExposureUsd: profile.operations.maxExposureUsd },
      };
    }
  }
  if (profile.operations.maxPerTradeUsd && Number.isFinite(profile.operations.maxPerTradeUsd)) {
    if (allocation > (profile.operations.maxPerTradeUsd as number)) {
      return {
        reason: 'allocation_exceeds_max_per_trade',
        details: { allocationUsd: allocation, maxPerTradeUsd: profile.operations.maxPerTradeUsd },
      };
    }
  }
  return null;
}

function evaluateGuardState(guard: GuardLimits, state: Awaited<ReturnType<GuardStateRepository['load']>>) {
  if (guard.maxGlobalDrawdownUsd && state.globalPnl <= -Math.abs(guard.maxGlobalDrawdownUsd)) {
    return {
      reason: 'global_drawdown_limit',
      details: { globalPnl: state.globalPnl, limit: guard.maxGlobalDrawdownUsd },
    };
  }
  if (guard.maxRunLossUsd && state.runPnl <= -Math.abs(guard.maxRunLossUsd)) {
    return {
      reason: 'run_loss_limit',
      details: { runPnl: state.runPnl, limit: guard.maxRunLossUsd },
    };
  }
  if (guard.maxApiErrorsPerMin && guard.maxApiErrorsPerMin > 0) {
    const windowStart = Date.now() - 60_000;
    const recentErrors = (state.apiErrorTimestamps ?? []).filter((ts) => ts >= windowStart).length;
    if (recentErrors >= guard.maxApiErrorsPerMin) {
      return {
        reason: 'api_error_rate',
        details: { errorsLastMin: recentErrors, limit: guard.maxApiErrorsPerMin },
      };
    }
  }
  if (guard.staleTickerMs && guard.staleTickerMs > 0) {
    const lag = Date.now() - (state.lastTickerTs || Date.now());
    if (lag >= guard.staleTickerMs) {
      return {
        reason: 'stale_market_data',
        details: { lastTickerAgoMs: lag, limitMs: guard.staleTickerMs },
      };
    }
  }
  return null;
}

async function pauseBot(
  botsRepo: ClientBotsRepository,
  eventsRepo: ClientBotEventsRepository,
  bot: ClientBotRow,
  type: string,
  message: string,
  metadata?: Record<string, unknown>
) {
  await botsRepo.update(bot.id, { status: 'paused' });
  await eventsRepo.insert({
    clientBotId: bot.id,
    clientId: bot.clientId,
    eventType: type,
    message,
    metadata: metadata ?? null,
  });
}

async function runClientBot(
  bot: ClientBotRow,
  pool: Pool,
  botsRepo: ClientBotsRepository,
  eventsRepo: ClientBotEventsRepository,
  configService: ClientConfigService
) {
  if (bot.status !== 'active') {
    return;
  }
  const effectiveMode: BotMode = ALLOW_LIVE && bot.mode === 'live' ? 'live' : 'paper';
  const runner = STRATEGY_RUNNERS[bot.templateKey];
  if (!runner) {
    console.warn('[worker] unsupported_template', bot.templateKey, bot.id);
    return;
  }
  const profile = await configService.getClientProfile(bot.clientId);
  console.log(
    '[worker] executing_bot',
    JSON.stringify({ botId: bot.id, clientId: bot.clientId, template: bot.templateKey, mode: effectiveMode })
  );
  try {
    await runner(bot, effectiveMode);
  } catch (err) {
    console.error('[worker] bot_run_failed', { botId: bot.id, err });
    await pauseBot(botsRepo, eventsRepo, bot, 'execution_error', err instanceof Error ? err.message : String(err));
    return;
  }
  const allocationGuard = evaluateAllocationGuard(bot, profile);
  if (allocationGuard) {
    console.warn('[worker] guard_pausing_bot', { botId: bot.id, reason: allocationGuard.reason });
    await pauseBot(botsRepo, eventsRepo, bot, 'guard_tripped', allocationGuard.reason, allocationGuard.details);
    return;
  }
  const guardRepo = new GuardStateRepository(pool, bot.clientId);
  const guardState = await guardRepo.load();
  const guardHit = evaluateGuardState(profile.guard, guardState);
  if (guardHit) {
    console.warn('[worker] guard_pausing_bot', { botId: bot.id, reason: guardHit.reason });
    await pauseBot(botsRepo, eventsRepo, bot, 'guard_tripped', guardHit.reason, guardHit.details);
  }
}

async function main() {
  const pool = await getPool();
  const botsRepo = new ClientBotsRepository(pool);
  const eventsRepo = new ClientBotEventsRepository(pool);
  const configService = new ClientConfigService(pool);

  for (;;) {
    try {
      const activeBots = await botsRepo.listActiveBots();
      for (const bot of activeBots) {
        try {
          await runClientBot(bot, pool, botsRepo, eventsRepo, configService);
        } catch (err) {
          console.error('[worker] bot_execution_failed', { botId: bot.id, err });
        }
      }
    } catch (err) {
      console.error('[worker] loop_failure', err);
    }
    await sleep(WORKER_INTERVAL_MS);
  }
}

main().catch((err) => {
  console.error('[worker] crashed', err);
  process.exit(1);
});
