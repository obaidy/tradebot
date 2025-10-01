import WebSocket, { RawData } from 'ws';
import { logger } from '../../utils/logger';
import { CONFIG } from '../../config';
import { cacheService } from '../cacheService';

export type BookTickerSnapshot = {
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

type TickerListener = (snapshot: BookTickerSnapshot) => void;
type SymbolHealthListener = (health: StreamingSymbolHealth) => void;

export type StreamingSymbolHealthStatus = 'unknown' | 'healthy' | 'degraded' | 'stale' | 'disconnected';

export type StreamingSymbolHealth = {
  status: StreamingSymbolHealthStatus;
  lastHeartbeatAt: number | null;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
  lastSource: 'ws' | 'rest' | null;
  reconnectCount: number;
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
  private readonly tickerListeners = new Map<string, Set<TickerListener>>();
  private readonly symbolHealth = new Map<string, StreamingSymbolHealth>();
  private readonly symbolHealthListeners = new Map<string, Set<SymbolHealthListener>>();
  private readonly staleTimers = new Map<string, NodeJS.Timeout>();
  private totalReconnects = 0;
  private requestId = 1;

  watchSymbol(rawSymbol: string) {
    const key = this.normalizeSymbol(rawSymbol);
    const nextCount = (this.watchers.get(key) ?? 0) + 1;
    this.watchers.set(key, nextCount);
    this.ensureSymbolHealth(key);
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
      this.clearSymbolHealth(key);
    } else {
      this.watchers.set(key, current - 1);
    }
  }

  getLatestTicker(rawSymbol: string): BookTickerSnapshot | null {
    const key = this.normalizeSymbol(rawSymbol);
    return this.snapshots.get(key) ?? null;
  }

  getSymbolHealth(rawSymbol: string): StreamingSymbolHealth {
    const key = this.normalizeSymbol(rawSymbol);
    return { ...this.ensureSymbolHealth(key) };
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
    this.recordSymbolHeartbeat(key, snapshot);
    this.notifyTickerListeners(key, snapshot);
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
      reconnects: this.totalReconnects,
    });
    this.resubscribeAll();
    this.startPing();
    for (const symbol of this.watchers.keys()) {
      this.updateSymbolHealth(symbol, { status: 'healthy' });
    }
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
    this.recordSymbolHeartbeat(symbol, snapshot);
    this.notifyTickerListeners(symbol, snapshot);
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
    this.totalReconnects += 1;
    for (const symbol of this.watchers.keys()) {
      this.updateSymbolHealth(symbol, { status: 'disconnected' });
    }
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

  onTicker(rawSymbol: string, listener: TickerListener): () => void {
    const key = this.normalizeSymbol(rawSymbol);
    let listeners = this.tickerListeners.get(key);
    if (!listeners) {
      listeners = new Set<TickerListener>();
      this.tickerListeners.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      const current = this.tickerListeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.tickerListeners.delete(key);
      }
    };
  }

  onSymbolHealth(rawSymbol: string, listener: SymbolHealthListener): () => void {
    const key = this.normalizeSymbol(rawSymbol);
    let listeners = this.symbolHealthListeners.get(key);
    if (!listeners) {
      listeners = new Set<SymbolHealthListener>();
      this.symbolHealthListeners.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      const current = this.symbolHealthListeners.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) {
        this.symbolHealthListeners.delete(key);
      }
    };
  }

  private notifyTickerListeners(symbol: string, snapshot: BookTickerSnapshot) {
    const listeners = this.tickerListeners.get(symbol);
    if (!listeners || listeners.size === 0) return;
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        logger.warn('binance_stream_listener_error', {
          event: 'binance_stream_listener_error',
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private notifySymbolHealthListeners(symbol: string, health: StreamingSymbolHealth) {
    const listeners = this.symbolHealthListeners.get(symbol);
    if (!listeners || listeners.size === 0) return;
    for (const listener of listeners) {
      try {
        listener({ ...health });
      } catch (error) {
        logger.warn('binance_stream_health_listener_error', {
          event: 'binance_stream_health_listener_error',
          symbol,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private recordSymbolHeartbeat(symbol: string, snapshot: BookTickerSnapshot) {
    const latencyMs = snapshot.source === 'ws' ? now() - snapshot.receivedAt : null;
    this.updateSymbolHealth(symbol, {
      status: snapshot.source === 'ws' ? 'healthy' : 'degraded',
      lastHeartbeatAt: snapshot.eventTime,
      lastLatencyMs: latencyMs,
      lastSource: snapshot.source,
    });
  }

  private ensureSymbolHealth(symbol: string): StreamingSymbolHealth {
    const existing = this.symbolHealth.get(symbol);
    if (existing) {
      return existing;
    }
    const health: StreamingSymbolHealth = {
      status: 'unknown',
      lastHeartbeatAt: null,
      lastLatencyMs: null,
      avgLatencyMs: null,
      lastSource: null,
      reconnectCount: 0,
    };
    this.symbolHealth.set(symbol, health);
    return health;
  }

  private clearSymbolHealth(symbol: string) {
    const timer = this.staleTimers.get(symbol);
    if (timer) {
      clearTimeout(timer);
      this.staleTimers.delete(symbol);
    }
    this.symbolHealth.delete(symbol);
    this.symbolHealthListeners.delete(symbol);
  }

  private updateSymbolHealth(symbol: string, update: Partial<StreamingSymbolHealth>) {
    const health = this.ensureSymbolHealth(symbol);
    let changed = false;

    if (update.lastHeartbeatAt !== undefined) {
      const nextHeartbeat = update.lastHeartbeatAt ?? null;
      if (health.lastHeartbeatAt !== nextHeartbeat) {
        health.lastHeartbeatAt = nextHeartbeat;
        changed = true;
      }
    }

    if (update.lastLatencyMs !== undefined) {
      const nextLatency = update.lastLatencyMs ?? null;
      if (health.lastLatencyMs !== nextLatency) {
        health.lastLatencyMs = nextLatency;
        if (nextLatency !== null) {
          const avg = health.avgLatencyMs ?? nextLatency;
          health.avgLatencyMs = Math.round((avg * 0.7 + nextLatency * 0.3) * 100) / 100;
        }
        changed = true;
      }
    }

    if (update.lastSource !== undefined && health.lastSource !== update.lastSource) {
      health.lastSource = update.lastSource ?? null;
      changed = true;
    }

    if (update.status && health.status !== update.status) {
      if (update.status === 'disconnected') {
        health.reconnectCount += 1;
      }
      health.status = update.status;
      changed = true;
    }

    const staleAfter = Math.max(CONFIG.STREAMING.STALE_TICKER_MS * 2, 3000);
    const timer = this.staleTimers.get(symbol);
    if (timer) {
      clearTimeout(timer);
    }
    if (health.lastHeartbeatAt) {
      const staleTimer = setTimeout(() => {
        this.staleTimers.delete(symbol);
        const current = this.symbolHealth.get(symbol);
        if (!current || !current.lastHeartbeatAt) return;
        if (now() - current.lastHeartbeatAt >= staleAfter) {
          if (current.status !== 'stale') {
            current.status = 'stale';
            this.notifySymbolHealthListeners(symbol, current);
            logger.warn('binance_stream_symbol_stale', {
              event: 'binance_stream_symbol_stale',
              symbol,
              staleForMs: now() - current.lastHeartbeatAt,
              lastSource: current.lastSource ?? undefined,
            });
          }
        }
      }, staleAfter);
      this.staleTimers.set(symbol, staleTimer);
    }

    if (changed) {
      this.notifySymbolHealthListeners(symbol, health);
      logger.debug('binance_stream_symbol_health', {
        event: 'binance_stream_symbol_health',
        symbol,
        status: health.status,
        lastLatencyMs: health.lastLatencyMs ?? undefined,
        avgLatencyMs: health.avgLatencyMs ?? undefined,
        lastSource: health.lastSource ?? undefined,
        reconnectCount: health.reconnectCount,
      });
    }
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
