import { FlashLoanEngine } from '../defi/flashLoans/flashLoanEngine';
import { CrossExchangeArbitrageEngine } from '../arbitrage/arbitrageEngine';
import { createExchangeAdapter } from '../exchanges/adapterFactory';
import type { StrategyRunContext } from './types';
import { logger } from '../utils/logger';

interface FlashLoanStrategyConfig {
  provider?: 'aave' | 'balancer' | 'dydx';
  chainId?: number;
  maxBorrowUsd?: number;
  slippageBps?: number;
  symbols?: string[];
  minSpreadPct?: number;
}

function resolveConfig(ctx: StrategyRunContext): Required<FlashLoanStrategyConfig> {
  const cfg = ctx.config ?? {};
  return {
    provider: (cfg.provider as any) ?? (process.env.FLASH_LOAN_PROVIDER as any) ?? 'aave',
    chainId: Number(cfg.chainId ?? process.env.FLASH_LOAN_CHAIN_ID ?? 1),
    maxBorrowUsd: Number(cfg.maxBorrowUsd ?? process.env.FLASH_LOAN_MAX_BORROW_USD ?? 50000),
    slippageBps: Number(cfg.slippageBps ?? process.env.FLASH_LOAN_SLIPPAGE_BPS ?? 25),
    symbols: Array.isArray(cfg.symbols)
      ? (cfg.symbols as string[])
      : String(cfg.symbols ?? process.env.FLASH_LOAN_SYMBOLS ?? 'ETH/USDC,BTC/USDC')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
    minSpreadPct: Number(cfg.minSpreadPct ?? process.env.FLASH_LOAN_MIN_SPREAD_PCT ?? 0.25),
  };
}

export async function runFlashLoanArbStrategy(ctx: StrategyRunContext) {
  const config = resolveConfig(ctx);
  const flashEngine = new FlashLoanEngine({
    provider: config.provider,
    chainId: config.chainId,
    maxBorrowUsd: config.maxBorrowUsd,
    slippageBps: config.slippageBps,
  });

  const adapters = config.symbols.map((symbol, index) => {
    const fallbackVenues = String(process.env.FLASH_LOAN_ADAPTERS ?? 'binance,kraken')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const venueId =
      process.env[`FLASH_LOAN_ADAPTER_${index}_ID`]
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
  logger.info('flash_loan_opportunities', {
    event: 'flash_loan_opportunities',
    opportunitiesCount: opportunities.length,
  });
  for (const opportunity of opportunities) {
    const feasible = await flashEngine.evaluate(opportunity);
    if (!feasible) continue;
    if (ctx.runMode === 'live') {
      const result = await flashEngine.execute(opportunity);
      logger.info('flash_loan_arb_executed', {
        event: 'flash_loan_arb_executed',
        clientId: ctx.clientId,
        result,
      });
    } else {
      logger.info('flash_loan_arb_simulation', {
        event: 'flash_loan_arb_simulation',
        clientId: ctx.clientId,
        opportunity,
      });
    }
  }
}
