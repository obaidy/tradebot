import { fetchFundingOpportunities } from '../../exchanges/fundingHelper';
import { BotSignalsRepository } from '../../db/botSignalsRepo';
import { BotPositionsRepository } from '../../db/botPositionsRepo';
import { RunsRepository, OrdersRepository } from '../../db/repositories';
import { createExchangeAdapter } from '../../exchanges/adapterFactory';
import type { ExchangeAdapter } from '../../exchanges/adapters/types';
import { logger } from '../../utils/logger';
import { errorMessage } from '../../utils/formatError';

export interface PerpBasisOptions {
  clientId: string;
  runMode: 'summary' | 'paper' | 'live';
  bankrollUsd: number;
  sizePct: number;
  minAbsFundingRate?: number;
  maxResults?: number;
  spotExchangeId: string;
  perpExchangeId: string;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string;
  leverage?: number;
  enableNegativeFunding?: boolean;
  runsRepo: RunsRepository;
  ordersRepo: OrdersRepository;
}

type HedgeDirection = 'capture_positive' | 'capture_negative';

export class PerpBasisWorker {
  constructor(
    private readonly signalsRepo: BotSignalsRepository,
    private readonly positionsRepo: BotPositionsRepository,
    private readonly options: PerpBasisOptions
  ) {}

  private computeTradeSize(markPrice: number): { qty: number; notionalUsd: number } | null {
    if (!Number.isFinite(markPrice) || markPrice <= 0) return null;
    const notionalUsd = this.options.bankrollUsd * this.options.sizePct;
    if (!Number.isFinite(notionalUsd) || notionalUsd <= 0) return null;
    const qty = notionalUsd / markPrice;
    if (!Number.isFinite(qty) || qty <= 0) return null;
    return { qty: Number(qty.toFixed(4)), notionalUsd: Number(notionalUsd.toFixed(2)) };
  }

  private determineDirection(fundingRate: number): HedgeDirection | null {
    if (fundingRate >= 0) return 'capture_positive';
    if (!this.options.enableNegativeFunding) return null;
    return 'capture_negative';
  }

  private async executeHedge(
    opportunity: Awaited<ReturnType<typeof fetchFundingOpportunities>>[number],
    adapters: { spot: ExchangeAdapter | null; perp: ExchangeAdapter | null }
  ) {
    const direction = this.determineDirection(opportunity.fundingRate);
    if (!direction) {
      logger.debug('perp_basis_skip_direction', {
        event: 'perp_basis_skip_direction',
        symbol: opportunity.symbol,
        fundingRate: opportunity.fundingRate,
      });
      return;
    }

    if (!adapters.spot || !adapters.perp) {
      logger.warn('perp_basis_adapters_unavailable', {
        event: 'perp_basis_adapters_unavailable',
        symbol: opportunity.symbol,
      });
      return;
    }

    const tradeSize = this.computeTradeSize(opportunity.markPrice ?? opportunity.indexPrice ?? 0);
    if (!tradeSize) {
      logger.warn('perp_basis_trade_size_invalid', {
        event: 'perp_basis_trade_size_invalid',
        symbol: opportunity.symbol,
        markPrice: opportunity.markPrice,
      });
      return;
    }

    const runId = `perp-basis-${opportunity.exchange}-${Date.now()}`;
    await this.options.runsRepo.createRun({
      runId,
      owner: 'perp-basis',
      exchange: opportunity.exchange,
      paramsJson: {
        symbol: opportunity.symbol,
        fundingRate: opportunity.fundingRate,
        basisBps: opportunity.basisBps,
        markPrice: opportunity.markPrice,
        sizePct: this.options.sizePct,
        notionalUsd: tradeSize.notionalUsd,
        direction,
      },
    });

    let spotOrderRecord: Awaited<ReturnType<OrdersRepository['insertOrder']>> | null = null;
    let perpOrderRecord: Awaited<ReturnType<OrdersRepository['insertOrder']>> | null = null;

    try {
      const spotSide = direction === 'capture_positive' ? 'buy' : 'sell';
      const perpSide = direction === 'capture_positive' ? 'sell' : 'buy';
      const leverage = this.options.leverage ?? Number(process.env.PERP_BASIS_LEVERAGE ?? 2);

      const spotOrder = this.options.runMode === 'live'
        ? await adapters.spot.placeOrder({
            symbol: opportunity.symbol,
            side: spotSide,
            amount: tradeSize.qty,
            type: 'market',
          })
        : null;

      spotOrderRecord = await this.options.ordersRepo.insertOrder({
        runId,
        pair: `${opportunity.symbol}-spot`,
        side: spotSide,
        price: opportunity.markPrice ?? 0,
        amount: tradeSize.qty,
        status: this.options.runMode === 'live' ? 'filled' : this.options.runMode,
        filledAmount: this.options.runMode === 'live' ? tradeSize.qty : 0,
        raw: {
          opportunity,
          order: spotOrder,
          direction,
        },
      });

      if (this.options.runMode === 'live' && spotOrder) {
        await this.options.ordersRepo.updateOrder({
          orderId: spotOrderRecord.id,
          status: 'filled',
          filledAmount: Number(spotOrder.filled ?? tradeSize.qty),
          remainingAmount: Number(spotOrder.remaining ?? 0),
          raw: {
            ...spotOrderRecord.raw,
            exchangeOrder: spotOrder.raw ?? {},
          },
        });
      }

      const perpOrder = this.options.runMode === 'live'
        ? await adapters.perp.placeOrder({
            symbol: opportunity.symbol,
            side: perpSide,
            amount: tradeSize.qty,
            type: 'market',
            leverage,
          })
        : null;

      perpOrderRecord = await this.options.ordersRepo.insertOrder({
        runId,
        pair: `${opportunity.symbol}-perp`,
        side: perpSide,
        price: opportunity.markPrice ?? opportunity.indexPrice ?? 0,
        amount: tradeSize.qty,
        status: this.options.runMode === 'live' ? 'filled' : this.options.runMode,
        filledAmount: this.options.runMode === 'live' ? tradeSize.qty : 0,
        raw: {
          opportunity,
          order: perpOrder,
          direction,
          leverage,
        },
      });

      if (this.options.runMode === 'live' && perpOrder) {
        await this.options.ordersRepo.updateOrder({
          orderId: perpOrderRecord.id,
          status: 'filled',
          filledAmount: Number(perpOrder.filled ?? tradeSize.qty),
          remainingAmount: Number(perpOrder.remaining ?? 0),
          raw: {
            ...perpOrderRecord.raw,
            exchangeOrder: perpOrder.raw ?? {},
          },
        });
      }

      await this.positionsRepo.upsertPosition({
        botName: 'perp-basis',
        venue: `${this.options.spotExchangeId}-spot`,
        symbol: opportunity.symbol,
        direction: 'spot',
        qty: tradeSize.qty,
        avgPrice: opportunity.markPrice ?? opportunity.indexPrice ?? 0,
        pnlRealized: 0,
        pnlUnrealized: 0,
        meta: {
          exchange: this.options.spotExchangeId,
          fundingRate: opportunity.fundingRate,
          basisBps: opportunity.basisBps,
          notionalUsd: tradeSize.notionalUsd,
          mode: direction,
        },
      });

      await this.positionsRepo.upsertPosition({
        botName: 'perp-basis',
        venue: `${this.options.perpExchangeId}-perp`,
        symbol: opportunity.symbol,
        direction: direction === 'capture_positive' ? 'short' : 'long',
        qty: tradeSize.qty,
        avgPrice: opportunity.markPrice ?? opportunity.indexPrice ?? 0,
        pnlRealized: 0,
        pnlUnrealized: 0,
        meta: {
          exchange: this.options.perpExchangeId,
          fundingRate: opportunity.fundingRate,
          basisBps: opportunity.basisBps,
          notionalUsd: tradeSize.notionalUsd,
          leverage,
          mode: direction,
        },
      });

      await this.options.runsRepo.updateStatus({ runId, status: 'completed' });
    } catch (error) {
      logger.error('perp_basis_hedge_failed', {
        event: 'perp_basis_hedge_failed',
        symbol: opportunity.symbol,
        exchange: opportunity.exchange,
        error: errorMessage(error),
      });
      if (spotOrderRecord) {
        await this.options.ordersRepo.updateOrder({
          orderId: spotOrderRecord.id,
          status: 'rejected',
          driftReason: error instanceof Error ? error.message : String(error),
        }).catch((updateError) => {
          logger.warn('perp_basis_spot_order_update_failed', {
            event: 'perp_basis_spot_order_update_failed',
            orderId: spotOrderRecord?.id,
            error: errorMessage(updateError),
          });
        });
      }
      if (perpOrderRecord) {
        await this.options.ordersRepo.updateOrder({
          orderId: perpOrderRecord.id,
          status: 'rejected',
          driftReason: error instanceof Error ? error.message : String(error),
        }).catch((updateError) => {
          logger.warn('perp_basis_perp_order_update_failed', {
            event: 'perp_basis_perp_order_update_failed',
            orderId: perpOrderRecord?.id,
            error: errorMessage(updateError),
          });
        });
      }
      await this.options.runsRepo.updateStatus({ runId, status: 'failed' }).catch((updateError) => {
        logger.warn('perp_basis_run_update_failed', {
          event: 'perp_basis_run_update_failed',
          runId,
          error: errorMessage(updateError),
        });
      });
    }
  }

  private buildAdapters(): { spot: ExchangeAdapter | null; perp: ExchangeAdapter | null } {
    if (this.options.runMode === 'summary') {
      return { spot: null, perp: null };
    }
    const credentials = {
      apiKey: this.options.apiKey ?? process.env.BINANCE_API_KEY ?? process.env.KUCOIN_API_KEY,
      apiSecret: this.options.apiSecret ?? process.env.BINANCE_API_SECRET ?? process.env.KUCOIN_API_SECRET,
      passphrase: this.options.passphrase ?? process.env.BINANCE_API_PASSPHRASE ?? process.env.KUCOIN_API_PASSPHRASE,
    };
    const spot = createExchangeAdapter({
      kind: 'ccxt',
      id: this.options.spotExchangeId,
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      passphrase: credentials.passphrase ?? undefined,
      extra: { exchangeId: this.options.spotExchangeId },
    });
    const perp = createExchangeAdapter({
      kind: 'derivatives',
      id: this.options.perpExchangeId,
      apiKey: credentials.apiKey,
      apiSecret: credentials.apiSecret,
      passphrase: credentials.passphrase ?? undefined,
      extra: { exchangeId: this.options.perpExchangeId },
    });
    return { spot, perp };
  }

  async runOnce(): Promise<number> {
    const opportunities = await fetchFundingOpportunities({
      minAbsFundingRate: this.options.minAbsFundingRate,
      limit: this.options.maxResults,
    });

    const adapters = this.buildAdapters();
    if (adapters.spot && adapters.perp) {
      await Promise.allSettled([adapters.spot.connect(), adapters.perp.connect()]);
    }

    try {
      let processed = 0;
      for (const opportunity of opportunities) {
        processed += 1;
        await this.signalsRepo.insert({
          botName: 'perp-basis',
          signalType: 'funding_edge',
          strategyId: 'perp-basis',
          symbol: opportunity.symbol,
          chain: 'cex',
          strength: opportunity.fundingRate,
          meta: {
            exchange: opportunity.exchange,
            fundingRate: opportunity.fundingRate,
            nextFundingTimestamp: opportunity.nextFundingTimestamp,
            markPrice: opportunity.markPrice,
            indexPrice: opportunity.indexPrice,
            basisBps: opportunity.basisBps,
          },
        });

        if (this.options.runMode === 'summary') {
          continue;
        }

        await this.executeHedge(opportunity, adapters);
      }
      return processed;
    } finally {
      if (adapters.spot) {
        await adapters.spot.disconnect().catch((error) => {
          logger.warn('perp_basis_spot_disconnect_failed', {
            event: 'perp_basis_spot_disconnect_failed',
            error: errorMessage(error),
          });
        });
      }
      if (adapters.perp) {
        await adapters.perp.disconnect().catch((error) => {
          logger.warn('perp_basis_perp_disconnect_failed', {
            event: 'perp_basis_perp_disconnect_failed',
            error: errorMessage(error),
          });
        });
      }
    }
  }
}
