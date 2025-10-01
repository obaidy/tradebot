import WebSocket, { RawData } from 'ws';
import { logger } from '../../utils/logger';
import { CONFIG } from '../../config';
import { cacheService } from '../cacheService';

type BookTickerSnapshot = {
  symbol: string;
  bidPrice: number;
  askPrice: number;
  bidQty: number;
  askQty: number;
  eventTime: number;
  updateId: number;
  receivedAt: number;
  source: 'ws' | 'rest';
};

type SnapshotWaiter = {
  resolve: (snapshot: BookTickerSnapshot | null) => void;
  timeout: NodeJS.Timeout;
};

function now() {
  return Date.now();
}

function averagePrice(bid: number, ask: number) {
  if (Number.isFinite(bid) && Number.isFinite(ask)) {
    return (bid + ask) / 2;
  }
  if (Number.isFinite(bid)) return bid;
  if (Number.isFinite(ask)) return ask;
  return null;
}

export class BinanceStreamingGateway {
  private ws: WebSocket | null = null;
  private connecting = false;
  private reconnectDelay = CONFIG.STREAMING.RECONNECT_DELAY_MS;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private readonly watchers = new Map<string, number>();
  private readonly subscribed = new Set<string>();
  private readonly snapshots = new Map<string, BookTickerSnapshot>();
  private readonly waiters = new Map<string, Set<SnapshotWaiter>>();
  private requestId = 1;

  watchSymbol(rawSymbol: string) {
    const key = this.normalizeSymbol(rawSymbol);
    const nextCount = (this.watchers.get(key) ?? 0) + 1;
    this.watchers.set(key, nextCount);
    if (!CONFIG.STREAMING.ENABLED) return;
    this.ensureConnection();
    if (this.ws && this.ws.readyState === WebSocket.OPEN && !this.subscribed.has(key)) {
      this.sendSubscribe([key]);
    }
  }

  unwatchSymbol(rawSymbol: string) {
    const key = this.normalizeSymbol(rawSymbol);
    const current = this.watchers.get(key) ?? 0;
    if (current <= 1) {
      this.watchers.delete(key);
      this.subscribed.delete(key);
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendUnsubscribe([key]);
      }
    } else {
      this.watchers.set(key, current - 1);
    }
  }

  getLatestTicker(rawSymbol: string): BookTickerSnapshot | null {
    const key = this.normalizeSymbol(rawSymbol);
    return this.snapshots.get(key) ?? null;
  }

  async waitForFreshTicker(rawSymbol: string, timeoutMs: number): Promise<BookTickerSnapshot | null> {
    const key = this.normalizeSymbol(rawSymbol);
    const latest = this.snapshots.get(key);
    if (latest && now() - latest.receivedAt <= timeoutMs) {
      return latest;
    }
    return new Promise<BookTickerSnapshot | null>((resolve) => {
      const timeout = setTimeout(() => {
        const fallback = this.snapshots.get(key) ?? null;
        resolve(fallback);
        const waiters = this.waiters.get(key);
        if (waiters) {
          for (const waiter of waiters) {
            if (waiter.timeout === timeout) {
              waiters.delete(waiter);
              break;
            }
          }
          if (waiters.size === 0) this.waiters.delete(key);
        }
      }, Math.max(50, timeoutMs));

      const waiter: SnapshotWaiter = {
        timeout,
        resolve: (snapshot) => {
          clearTimeout(timeout);
          resolve(snapshot);
        },
      };

      const set = this.waiters.get(key);
      if (set) {
        set.add(waiter);
      } else {
        this.waiters.set(key, new Set([waiter]));
      }
    });
  }

  recordRestFallback(pair: string, ticker: { bid?: number | null; ask?: number | null; last?: number | null; timestamp?: number }) {
    const key = this.normalizeSymbol(pair);
    const bidPrice = typeof ticker.bid === 'number' ? ticker.bid : ticker.last ?? NaN;
    const askPrice = typeof ticker.ask === 'number' ? ticker.ask : ticker.last ?? NaN;
    if (!Number.isFinite(bidPrice) && !Number.isFinite(askPrice)) {
      return;
    }
    const snapshot: BookTickerSnapshot = {
      symbol: key,
      bidPrice: Number.isFinite(bidPrice) ? Number(bidPrice) : Number(askPrice),
      askPrice: Number.isFinite(askPrice) ? Number(askPrice) : Number(bidPrice),
      bidQty: 0,
      askQty: 0,
      eventTime: ticker.timestamp ?? now(),
      updateId: 0,
      receivedAt: now(),
      source: 'rest',
    };
    this.snapshots.set(key, snapshot);
  }

  private ensureConnection() {
    if (this.connecting || this.ws) return;
    if (!CONFIG.STREAMING.ENABLED) return;
    if (!this.watchers.size) return;

    this.connecting = true;
    const url = CONFIG.STREAMING.BINANCE_WS_URL;
    try {
      this.ws = new WebSocket(url);
    } catch (error) {
      this.connecting = false;
      logger.warn('binance_stream_connect_failed', {
        event: 'binance_stream_connect_failed',
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => this.handleOpen());
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('error', (error) => this.handleError(error));
    this.ws.on('close', (code) => this.handleClose(code));
  }

  private handleOpen() {
    this.connecting = false;
    this.reconnectDelay = CONFIG.STREAMING.RECONNECT_DELAY_MS;
    logger.info('binance_stream_connected', {
      event: 'binance_stream_connected',
      url: CONFIG.STREAMING.BINANCE_WS_URL,
      subscriptions: this.watchers.size,
    });
    this.resubscribeAll();
    this.startPing();
  }

  private handleMessage(data: RawData) {
    let payload: any;
    try {
      const text = this.rawDataToString(data);
      payload = JSON.parse(text);
    } catch (error) {
      logger.warn('binance_stream_parse_error', {
        event: 'binance_stream_parse_error',
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (payload?.result !== undefined) {
      return; // subscription ack
    }

    const message = payload?.data ?? payload;
    if (!message || message.e !== 'bookTicker') {
      return;
    }

    const symbol = this.normalizeSymbol(message.s);
    const bidPrice = Number(message.b);
    const askPrice = Number(message.a);
    const bidQty = Number(message.B || 0);
    const askQty = Number(message.A || 0);
    const eventTime = Number(message.E || now());
    const updateId = Number(message.u || 0);

    if (!Number.isFinite(bidPrice) && !Number.isFinite(askPrice)) {
      return;
    }

    const snapshot: BookTickerSnapshot = {
      symbol,
      bidPrice: Number.isFinite(bidPrice) ? bidPrice : askPrice,
      askPrice: Number.isFinite(askPrice) ? askPrice : bidPrice,
      bidQty: Number.isFinite(bidQty) ? bidQty : 0,
      askQty: Number.isFinite(askQty) ? askQty : 0,
      eventTime,
      updateId,
      receivedAt: now(),
      source: 'ws',
    };

    this.snapshots.set(symbol, snapshot);
    this.resolveWaiters(symbol, snapshot);
    this.cacheSnapshot(snapshot).catch(() => {});
  }

  private rawDataToString(data: RawData): string {
    if (typeof data === 'string') return data;
    if (Array.isArray(data)) {
      return Buffer.concat(data).toString('utf8');
    }
    if (data instanceof ArrayBuffer) {
      return Buffer.from(data).toString('utf8');
    }
    return data.toString('utf8');
  }

  private handleError(error: unknown) {
    logger.warn('binance_stream_error', {
      event: 'binance_stream_error',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private handleClose(code: number) {
    logger.warn('binance_stream_disconnected', {
      event: 'binance_stream_disconnected',
      code,
    });
    this.cleanupSocket();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!CONFIG.STREAMING.ENABLED) return;
    if (this.reconnectTimer) return;
    const delay = Math.min(this.reconnectDelay, CONFIG.STREAMING.MAX_RECONNECT_DELAY_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ws = null;
      this.ensureConnection();
    }, delay);
    this.reconnectDelay = Math.min(delay * 2, CONFIG.STREAMING.MAX_RECONNECT_DELAY_MS);
  }

  private cleanupSocket() {
    this.connecting = false;
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {}
    }
    this.ws = null;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.subscribed.clear();
  }

  private startPing() {
    if (!this.ws) return;
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
    }
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.ping();
      } catch (error) {
        logger.warn('binance_stream_ping_failed', {
          event: 'binance_stream_ping_failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 25_000);
  }

  private resubscribeAll() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const symbols = Array.from(this.watchers.keys());
    if (!symbols.length) return;
    this.sendSubscribe(symbols);
  }

  private sendSubscribe(symbols: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!symbols.length) return;
    const params = symbols.map((symbol) => `${symbol}@bookTicker`);
    const payload = {
      method: 'SUBSCRIBE',
      params,
      id: this.requestId++,
    };
    try {
      this.ws.send(JSON.stringify(payload));
      symbols.forEach((symbol) => this.subscribed.add(symbol));
    } catch (error) {
      logger.warn('binance_stream_subscribe_failed', {
        event: 'binance_stream_subscribe_failed',
        symbols,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private sendUnsubscribe(symbols: string[]) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!symbols.length) return;
    const params = symbols.map((symbol) => `${symbol}@bookTicker`);
    const payload = {
      method: 'UNSUBSCRIBE',
      params,
      id: this.requestId++,
    };
    try {
      this.ws.send(JSON.stringify(payload));
      symbols.forEach((symbol) => this.subscribed.delete(symbol));
    } catch (error) {
      logger.warn('binance_stream_unsubscribe_failed', {
        event: 'binance_stream_unsubscribe_failed',
        symbols,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private resolveWaiters(symbol: string, snapshot: BookTickerSnapshot) {
    const waiters = this.waiters.get(symbol);
    if (!waiters) return;
    for (const waiter of waiters) {
      waiter.resolve(snapshot);
      clearTimeout(waiter.timeout);
    }
    this.waiters.delete(symbol);
  }

  private async cacheSnapshot(snapshot: BookTickerSnapshot) {
    const last = averagePrice(snapshot.bidPrice, snapshot.askPrice);
    await cacheService.cacheMarketData('binance', snapshot.symbol, {
      ticker: {
        bid: snapshot.bidPrice,
        ask: snapshot.askPrice,
        last,
      },
      orderbook: {
        bid: { price: snapshot.bidPrice, qty: snapshot.bidQty },
        ask: { price: snapshot.askPrice, qty: snapshot.askQty },
      },
    }, 10);
  }

  private normalizeSymbol(symbol: string) {
    return symbol.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  }
}

export const binanceStreamingGateway = new BinanceStreamingGateway();
