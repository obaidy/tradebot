import { collectSentimentSignals, ingestSentimentSignals, SentimentSignal } from '../../services/signals/sentimentFeed';
import { SentimentSnapshotsRepository } from '../../db/sentimentSnapshotsRepo';
import { BotSignalsRepository } from '../../db/botSignalsRepo';
import { RunsRepository, OrdersRepository } from '../../db/repositories';
import { evaluateTokenSafety } from '../../services/onchain/tokenSafety';
import { executeBotSwap } from '../../services/onchain/swapExecutor';
import { getTokenMetadata } from '../../services/onchain/tokenMetadata';
import { logger } from '../../utils/logger';

export interface SentimentSniperOptions {
  clientId: string;
  runMode: 'summary' | 'paper' | 'live';
  minimumMentions?: number;
  maximumResults?: number;
  baseTokenAddress: string;
  baseTokenDecimals: number;
  baseTokenSymbol?: string | null;
  baseTradeBps: number;
  bankrollAtomic: bigint;
  slippageBps: number;
  walletPrivateKey?: string;
  runsRepo: RunsRepository;
  ordersRepo: OrdersRepository;
  normalizationScore: number;
}

interface ProcessedSignal {
  signal: SentimentSignal;
  safetyPassed: boolean;
  reasons: string[];
}

export class SentimentSniperWorker {
  constructor(
    private readonly snapshotsRepo: SentimentSnapshotsRepository,
    private readonly signalsRepo: BotSignalsRepository,
    private readonly options: SentimentSniperOptions
  ) {}

  async runOnce(): Promise<ProcessedSignal[]> {
    const options = {
      minimumMentions: this.options.minimumMentions,
      maximumResults: this.options.maximumResults,
    };

    const signals = this.options.runMode === 'summary'
      ? await collectSentimentSignals(options)
      : await ingestSentimentSignals(this.snapshotsRepo, options);

    const results: ProcessedSignal[] = [];
    for (const signal of signals) {
      const evaluation = await evaluateTokenSafety(signal.token, {
        requireMetadata: true,
        minCodeSize: 1200,
      }).catch((error: unknown) => {
        logger.warn('sentiment_sniper_safety_failed', {
          event: 'sentiment_sniper_safety_failed',
          token: signal.token,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      });
      if (!evaluation) continue;
      const safetyPassed = evaluation.passed;
      const reasons = evaluation.reasons;
      results.push({ signal, safetyPassed, reasons });

      if (!safetyPassed) {
        logger.debug('sentiment_sniper_skip_token', {
          event: 'sentiment_sniper_skip_token',
          token: signal.token,
          reasons,
        });
        continue;
      }

      await this.signalsRepo.insert({
        botName: 'sentiment-sniper',
        signalType: 'social_spike',
        strategyId: 'sentiment-sniper',
        symbol: signal.symbol ?? signal.token,
        chain: 'eth',
        strength: signal.trendingScore,
        meta: {
          mentions5m: signal.mentions5m,
          mentions30m: signal.mentions30m,
          liquidityUsd: signal.liquidityUsd,
          dexVolume5m: signal.dexVolume5m,
          source: signal.source,
          metrics: evaluation.metrics,
        },
      });

      if (this.options.runMode === 'summary') {
        continue;
      }

      try {
        const tokenOutMeta =
          evaluation.metrics.decimals !== null && evaluation.metrics.decimals !== undefined
            ? { decimals: evaluation.metrics.decimals, symbol: evaluation.metrics.symbol ?? signal.symbol ?? null }
            : await getTokenMetadata(signal.token);

        const strengthNormalized = Math.min(
          1,
          Math.max(0, signal.trendingScore / Math.max(1, this.options.normalizationScore))
        );
        const amountInAtomic = this.computeTradeSize(strengthNormalized);
        if (amountInAtomic <= 0n) {
          continue;
        }

        await executeBotSwap({
          botName: 'sentiment-sniper',
          clientId: this.options.clientId,
          runMode: this.options.runMode,
          tokenIn: this.options.baseTokenAddress,
          tokenOut: signal.token,
          tokenInSymbol: this.options.baseTokenSymbol ?? 'WETH',
          tokenOutSymbol: tokenOutMeta.symbol ?? signal.symbol ?? null,
          tokenInDecimals: this.options.baseTokenDecimals,
          tokenOutDecimals: tokenOutMeta.decimals,
          amountInAtomic,
          slippageBps: this.options.slippageBps,
          runsRepo: this.options.runsRepo,
          ordersRepo: this.options.ordersRepo,
          walletPrivateKey: this.options.walletPrivateKey,
          metadata: {
            mentions5m: signal.mentions5m,
            mentions30m: signal.mentions30m,
            trendingScore: signal.trendingScore,
            source: signal.source,
            liquidityUsd: signal.liquidityUsd,
            dexVolume5m: signal.dexVolume5m,
            strengthNormalized,
            safetyMetrics: evaluation.metrics,
          },
        });
      } catch (error) {
        logger.warn('sentiment_sniper_execution_failed', {
          event: 'sentiment_sniper_execution_failed',
          token: signal.token,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return results;
  }

  private computeTradeSize(strength: number): bigint {
    const baseBps = Math.max(1, Math.min(1000, Math.round(this.options.baseTradeBps)));
    const minBps = Math.max(1, Math.floor(baseBps * 0.4));
    const maxBps = Math.max(minBps + 1, Math.floor(baseBps * 1.4));
    const normalized = Math.max(0, Math.min(1, strength));
    const scaled = Math.round(baseBps * (0.4 + normalized));
    const chosen = Math.min(maxBps, Math.max(minBps, scaled));
    const amount = (this.options.bankrollAtomic * BigInt(chosen)) / 10_000n;
    return amount > 0n ? amount : (this.options.bankrollAtomic / 20_000n) || 1n;
  }
}
