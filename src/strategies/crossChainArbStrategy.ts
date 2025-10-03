import { CrossChainArbEngine } from '../defi/crossChain/crossChainArbEngine';
import { CrossExchangeArbitrageEngine } from '../arbitrage/arbitrageEngine';
import { createExchangeAdapter } from '../exchanges/adapterFactory';
import type { StrategyRunContext } from './types';
import { logger } from '../utils/logger';

interface CrossChainConfig {
  sourceChainId?: number;
  destinationChainId?: number;
  symbols?: string[];
  minSpreadPct?: number;
  minProfitUsd?: number;
}

function resolveBridges(): { sourceChainId: number; destinationChainId: number; bridge: string; estimatedFeeUsd: number; estimatedDurationSec: number }[] {
  const raw = process.env.CROSS_CHAIN_BRIDGES;
  if (!raw) {
    return [
      {
        sourceChainId: 1,
        destinationChainId: 137,
        bridge: 'stargate',
        estimatedFeeUsd: 15,
        estimatedDurationSec: 180,
      },
    ];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as any;
  } catch (error) {
    logger.warn('cross_chain_bridge_parse_failed', {
      event: 'cross_chain_bridge_parse_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return [];
}

function resolveConfig(ctx: StrategyRunContext): Required<CrossChainConfig> {
  const cfg = ctx.config ?? {};
  return {
    sourceChainId: Number(cfg.sourceChainId ?? process.env.CROSS_CHAIN_SOURCE_ID ?? 1),
    destinationChainId: Number(cfg.destinationChainId ?? process.env.CROSS_CHAIN_DEST_ID ?? 137),
    symbols: Array.isArray(cfg.symbols)
      ? (cfg.symbols as string[])
      : String(cfg.symbols ?? process.env.CROSS_CHAIN_SYMBOLS ?? 'ETH/USDC')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
    minSpreadPct: Number(cfg.minSpreadPct ?? process.env.CROSS_CHAIN_MIN_SPREAD_PCT ?? 0.3),
    minProfitUsd: Number(cfg.minProfitUsd ?? process.env.CROSS_CHAIN_MIN_PROFIT_USD ?? 50),
  };
}

export async function runCrossChainArbStrategy(ctx: StrategyRunContext) {
  const config = resolveConfig(ctx);
  const bridges = resolveBridges();
  const engine = new CrossChainArbEngine({ bridges, minProfitUsd: config.minProfitUsd });

  const fallbackVenues = String(process.env.CROSS_CHAIN_ADAPTERS ?? 'binance,kraken')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const adapters = config.symbols.map((_symbol, index) => {
    const venueId =
      process.env[`CROSS_CHAIN_ADAPTER_${index}_ID`]
        || fallbackVenues[index]
        || fallbackVenues[fallbackVenues.length - 1]
        || 'binance';
    return createExchangeAdapter({ kind: 'ccxt', id: venueId });
  });
  const arbEngine = new CrossExchangeArbitrageEngine(adapters, {
    symbols: config.symbols,
    minSpreadPct: config.minSpreadPct,
    pollIntervalMs: 0,
  });

  const opportunities = await arbEngine.scan();
  for (const opportunity of opportunities) {
    const result = await engine.evaluate(opportunity, config.sourceChainId, config.destinationChainId);
    if (!result) continue;
    if (ctx.runMode === 'live') {
      logger.info('cross_chain_arb_executed', {
        event: 'cross_chain_arb_executed',
        clientId: ctx.clientId,
        result,
      });
    } else {
      logger.info('cross_chain_arb_simulation', {
        event: 'cross_chain_arb_simulation',
        clientId: ctx.clientId,
        result,
      });
    }
  }
}
