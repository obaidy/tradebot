import { logger } from '../utils/logger';

export interface OrderRoutingLogEntry {
  adapterId: string;
  venue: string;
  symbol: string;
  side: string;
  quantity: number;
  metadata?: Record<string, unknown> | null;
}

export function logOrderRouting(entry: OrderRoutingLogEntry): void {
  logger.info('order_routing_log', {
    event: 'order_routing_log',
    adapterId: entry.adapterId,
    venue: entry.venue,
    symbol: entry.symbol,
    side: entry.side,
    quantity: entry.quantity,
    metadata: entry.metadata ?? null,
  });
}
