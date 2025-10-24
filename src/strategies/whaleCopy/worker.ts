import { id, zeroPadValue, getAddress, formatUnits } from 'ethers';
import { BotSignalsRepository } from '../../db/botSignalsRepo';
import { WhaleWatchlistRepository } from '../../db/whaleWatchlistRepo';
import { RunsRepository, OrdersRepository } from '../../db/repositories';
import { evaluateTokenSafety } from '../../services/onchain/tokenSafety';
import { getHttpProvider } from '../../services/onchain/provider';
import { logger } from '../../utils/logger';
import { executeBotSwap } from '../../services/onchain/swapExecutor';
import { getTokenMetadata } from '../../services/onchain/tokenMetadata';

const TRANSFER_TOPIC = id('Transfer(address,address,uint256)');

export interface WhaleCopyWorkerOptions {
  clientId: string;
  runMode: 'summary' | 'paper' | 'live';
  baseTradeBps: number;
  bankrollAtomic: bigint;
  blockLookback: number;
  baseTokenAddress: string;
  baseTokenDecimals: number;
  baseTokenSymbol?: string | null;
  slippageBps: number;
  walletPrivateKey?: string;
  runsRepo: RunsRepository;
  ordersRepo: OrdersRepository;
}

interface WhaleEvent {
  wallet: string;
  token: string;
  amount: bigint;
  blockNumber: number;
}

function normalizeWalletTopic(wallet: string) {
  return zeroPadValue(getAddress(wallet), 32);
}

export class WhaleCopyWorker {
  private readonly lastBlock = new Map<string, number>();
  private readonly provider = getHttpProvider();
  private readonly baseTradeBps: number;

  constructor(
    private readonly watchlistRepo: WhaleWatchlistRepository,
    private readonly signalsRepo: BotSignalsRepository,
    private readonly options: WhaleCopyWorkerOptions
  ) {
    this.baseTradeBps = Math.max(1, Math.min(300, Math.round(options.baseTradeBps)));
  }

  async runOnce(): Promise<number> {
    const watchlist = await this.watchlistRepo.list();
    if (!watchlist.length) {
      logger.info('whale_copy_watchlist_empty', {
        event: 'whale_copy_watchlist_empty',
        clientId: this.options.clientId,
      });
      return 0;
    }
    const toBlock = await this.provider.getBlockNumber();
    let processed = 0;
    for (const whale of watchlist) {
      const key = `${whale.chain}:${whale.wallet}`;
      const fallbackFrom = Math.max(0, toBlock - this.options.blockLookback);
      const fromBlock = this.lastBlock.get(key) ?? fallbackFrom;
      const events = await this.fetchRecentEvents(whale.wallet, fromBlock, toBlock);
      this.lastBlock.set(key, toBlock);
      if (!events.length) continue;
      for (const event of events) {
        processed += 1;
        await this.handleEvent(event, whale.minLiquidityUsd, whale.maxMcapUsd).catch((error) => {
          logger.warn('whale_copy_event_failed', {
            event: 'whale_copy_event_failed',
            wallet: whale.wallet,
            token: event.token,
            blockNumber: event.blockNumber,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      }
    }
    return processed;
  }

  private async fetchRecentEvents(wallet: string, fromBlock: number, toBlock: number): Promise<WhaleEvent[]> {
    const topic = normalizeWalletTopic(wallet);
    try {
      const logs = await this.provider.getLogs({
        fromBlock,
        toBlock,
        topics: [TRANSFER_TOPIC, null, topic],
      });
      return logs.map((log) => ({
        wallet,
        token: getAddress(log.address),
        amount: BigInt(log.data),
        blockNumber: Number(log.blockNumber),
      }));
    } catch (error) {
      logger.warn('whale_copy_fetch_logs_failed', {
        event: 'whale_copy_fetch_logs_failed',
        wallet,
        fromBlock,
        toBlock,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  private async handleEvent(event: WhaleEvent, minLiquidityUsd: number, maxMcapUsd: number) {
    const safety = await evaluateTokenSafety(event.token, {
      requireMetadata: true,
      minCodeSize: 1200,
    });
    if (!safety.passed) {
      logger.debug('whale_copy_token_rejected', {
        event: 'whale_copy_token_rejected',
        token: event.token,
        reasons: safety.reasons,
      });
      return;
    }

    const decimals = safety.metrics.decimals ?? 18;
    const amountHuman = Number(formatUnits(event.amount, decimals));
    const strength = Math.min(1, amountHuman / this.estimateClipSize(decimals));

    await this.signalsRepo.insert({
      botName: 'whale-copy',
      signalType: 'whale_buy',
      strategyId: 'whale-copy',
      symbol: safety.metrics.symbol ?? event.token,
      chain: 'eth',
      strength,
      meta: {
        wallet: event.wallet,
        amountRaw: event.amount.toString(),
        amountHuman,
        blockNumber: event.blockNumber,
        minLiquidityUsd,
        maxMcapUsd,
        metrics: safety.metrics,
      },
    });

    logger.info('whale_copy_signal_recorded', {
      event: 'whale_copy_signal_recorded',
      wallet: event.wallet,
      token: event.token,
      amountHuman,
      strength,
    });

    if (this.options.runMode === 'summary') {
      return;
    }

    try {
      const tokenOutDecimals =
        typeof safety.metrics.decimals === 'number' && safety.metrics.decimals >= 0
          ? safety.metrics.decimals
          : (await getTokenMetadata(event.token)).decimals;

      const amountInAtomic = this.computeTradeSize(strength);
      if (amountInAtomic <= 0n) {
        logger.warn('whale_copy_trade_skipped_zero_size', {
          event: 'whale_copy_trade_skipped_zero_size',
          wallet: event.wallet,
          token: event.token,
        });
        return;
      }

      await executeBotSwap({
        botName: 'whale-copy',
        clientId: this.options.clientId,
        runMode: this.options.runMode,
        tokenIn: this.options.baseTokenAddress,
        tokenOut: event.token,
        tokenInSymbol: this.options.baseTokenSymbol ?? 'WETH',
        tokenOutSymbol: safety.metrics.symbol ?? null,
        tokenInDecimals: this.options.baseTokenDecimals,
        tokenOutDecimals,
        amountInAtomic,
        slippageBps: this.options.slippageBps,
        runsRepo: this.options.runsRepo,
        ordersRepo: this.options.ordersRepo,
        walletPrivateKey: this.options.walletPrivateKey,
        metadata: {
          whaleWallet: event.wallet,
          blockNumber: event.blockNumber,
          signalStrength: strength,
          safetyMetrics: safety.metrics,
          minLiquidityUsd,
          maxMcapUsd,
        },
      });
    } catch (error) {
      logger.warn('whale_copy_execution_failed', {
        event: 'whale_copy_execution_failed',
        wallet: event.wallet,
        token: event.token,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private estimateClipSize(decimals: number): number {
    const bankrollTokens = Number(formatUnits(this.options.bankrollAtomic, this.options.baseTokenDecimals));
    const basePct = this.baseTradeBps / 10_000;
    const notional = bankrollTokens * basePct;
    const assumedPrice = Number(process.env.WHALE_COPY_REFERENCE_PRICE ?? '1');
    if (!Number.isFinite(notional) || notional <= 0 || !Number.isFinite(assumedPrice) || assumedPrice <= 0) {
      return Math.max(1, Number(formatUnits(this.options.bankrollAtomic, decimals)) / 100);
    }
    const qty = notional / assumedPrice;
    return Math.max(qty, 0.0001);
  }

  private computeTradeSize(strength: number): bigint {
    const baseBps = this.baseTradeBps;
    const minBps = Math.max(1, Math.floor(baseBps * 0.5));
    const maxBps = Math.max(minBps + 1, Math.floor(baseBps * 1.5));
    const normalizedStrength = Math.max(0, Math.min(1, strength));
    const scaled = Math.round(baseBps * (0.5 + normalizedStrength));
    const chosenBps = Math.min(maxBps, Math.max(minBps, scaled));
    const amount = (this.options.bankrollAtomic * BigInt(chosenBps)) / 10_000n;
    return amount > 0n ? amount : (this.options.bankrollAtomic / 10_000n) || 1n;
  }
}
