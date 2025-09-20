import { Pool } from 'pg';
import { logger } from '../utils/logger';
import { OrdersRepository, RunsRepository, FillsRepository } from '../db/repositories';
import { fillCounter } from '../telemetry/metrics';
import { circuitBreaker } from '../guard/circuitBreaker';

export interface ExchangeOrderLike {
  id: string;
  status: string;
  amount: number;
  filled: number;
  remaining?: number;
  average?: number;
  price?: number;
  side: 'buy' | 'sell';
  timestamp?: number;
  trades?: any[];
  fee?: { cost: number } | null;
}

export interface ExchangeLike {
  fetchOrder(id: string, symbol: string): Promise<ExchangeOrderLike>;
}

export async function reconcileOpenOrders(
  pool: Pool,
  repositories: {
    orders: OrdersRepository;
    runs: RunsRepository;
    fills: FillsRepository;
  },
  exchange: ExchangeLike,
  clientId: string
) {
  const openOrders = await repositories.orders.getOpenOrders();
  if (openOrders.length === 0) return { reconciled: 0, mismatches: 0 };

  let reconciled = 0;
  let mismatches = 0;

  for (const order of openOrders) {
    if (!order.exchange_order_id) {
      logger.warn('reconcile_skipped_missing_exchange_id', {
        event: 'reconcile_skipped_missing_exchange_id',
        orderId: order.id,
        runId: order.run_id,
      });
      continue;
    }
    try {
      const remote = await exchange.fetchOrder(order.exchange_order_id, order.pair);
      reconciled += 1;
      const filled = remote.filled ?? 0;
      const remaining = remote.remaining ?? Math.max(order.amount - filled, 0);
      const status = normalizeStatus(remote.status);
      const averagePrice = remote.average ?? remote.price ?? order.price;

      await repositories.orders.updateOrder({
        orderId: order.id,
        status,
        filledAmount: filled,
        remainingAmount: remaining,
        raw: remote as any,
        driftReason:
          status === order.status && Math.abs(filled - Number(order.filled_amount || 0)) < 1e-12
            ? null
            : deriveDriftReason(order.status, status, Number(order.filled_amount || 0), filled),
      });

      if (filled > Number(order.filled_amount || 0) && status === 'closed') {
        const fillAmount = filled - Number(order.filled_amount || 0);
        await repositories.fills.insertFill({
          orderId: order.id,
          runId: order.run_id,
          pair: order.pair,
          price: averagePrice,
          amount: fillAmount,
          fee: remote.fee?.cost ?? null,
          side: order.side,
          fillTimestamp: remote.timestamp ? new Date(remote.timestamp) : new Date(),
          raw: remote as any,
        });
        fillCounter.labels(clientId, order.side).inc(fillAmount);
        circuitBreaker.recordFill(order.side, averagePrice, fillAmount, remote.fee?.cost ?? 0);
      }
    } catch (err: any) {
      mismatches += 1;
      const reason = err?.message || String(err);
      await repositories.orders.updateOrder({
        orderId: order.id,
        status: order.status,
        driftReason: reason,
      });
      logger.warn('reconcile_fetch_failed', {
        event: 'reconcile_fetch_failed',
        orderId: order.id,
        runId: order.run_id,
        exchangeOrderId: order.exchange_order_id,
        clientId,
        error: reason,
      });
      circuitBreaker.recordApiError('reconcile_fetch');
    }
  }

  if (reconciled > 0 || mismatches > 0) {
    logger.info('reconcile_summary', {
      event: 'reconcile_summary',
      reconciled,
      mismatches,
      clientId,
    });
  }

  return { reconciled, mismatches };
}

function normalizeStatus(rawStatus: string) {
  const status = (rawStatus || '').toLowerCase();
  if (['closed', 'filled'].includes(status)) return 'closed';
  if (['canceled', 'cancelled'].includes(status)) return 'cancelled';
  if (['open', 'new'].includes(status)) return 'open';
  if (['partial', 'partially-filled'].includes(status)) return 'partial';
  return status || 'open';
}

function deriveDriftReason(prevStatus: string, newStatus: string, prevFilled: number, newFilled: number) {
  if (prevStatus !== newStatus) return `status ${prevStatus} -> ${newStatus}`;
  if (Math.abs((prevFilled || 0) - newFilled) > 1e-12) {
    return `filled ${prevFilled || 0} -> ${newFilled}`;
  }
  return null;
}
