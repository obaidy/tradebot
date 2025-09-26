/**
 * Redis Caching Layer for Market Data and Application State
 * Provides high-performance caching for frequently accessed data
 */

import Redis from 'ioredis';
import { logger } from '../utils/logger';
import { CONFIG } from '../config';

interface CacheOptions {
  ttl?: number; // Time to live in seconds
  compression?: boolean; // Enable compression for large values
}

interface MarketDataCache {
  ticker?: any;
  orderbook?: any;
  ohlcv?: any[];
  timestamp: number;
}

class RedisCacheService {
  private redis: Redis | null = null;
  private isConnected = false;
  private readonly enabled: boolean;

  constructor() {
    this.enabled = CONFIG.ENABLE_REDIS_CACHE && Boolean(CONFIG.REDIS_URL);
    if (!this.enabled) {
      logger.info('redis_cache_disabled', { event: 'redis_cache_disabled' });
      return;
    }

    this.redis = new Redis(CONFIG.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    this.setupEventHandlers();
    this.redis.connect().catch((error) => {
      logger.warn('redis_cache_connect_failed', {
        event: 'redis_cache_connect_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private setupEventHandlers() {
    if (!this.redis) return;
    this.redis.on('connect', () => {
      this.isConnected = true;
      logger.info('redis_cache_connected', {
        event: 'redis_cache_connected',
        url: CONFIG.REDIS_URL.replace(/\/\/.*@/, '//***@'), // Hide credentials
      });
    });

    this.redis.on('error', (error) => {
      this.isConnected = false;
      logger.error('redis_cache_error', {
        event: 'redis_cache_error',
        error: error instanceof Error ? error.message : String(error),
      });
    });

    this.redis.on('close', () => {
      this.isConnected = false;
      logger.warn('redis_cache_disconnected', {
        event: 'redis_cache_disconnected',
      });
    });
  }

  /**
   * Check if cache is available
   */
  isAvailable(): boolean {
    return this.enabled && this.isConnected;
  }

  /**
   * Generic cache set method
   */
  async set(key: string, value: any, options: CacheOptions = {}): Promise<boolean> {
    if (!this.enabled || !this.redis || !this.isConnected) return false;

    try {
      const serialized = JSON.stringify(value);
      const compressed = options.compression ? this.compress(serialized) : serialized;
      
      if (options.ttl) {
        await this.redis.setex(key, options.ttl, compressed);
      } else {
        await this.redis.set(key, compressed);
      }

      return true;
    } catch (error) {
      logger.warn('cache_set_failed', {
        event: 'cache_set_failed',
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Generic cache get method
   */
  async get<T>(key: string, options: CacheOptions = {}): Promise<T | null> {
    if (!this.enabled || !this.redis || !this.isConnected) return null;

    try {
      const cached = await this.redis.get(key);
      if (!cached) return null;

      const decompressed = options.compression ? this.decompress(cached) : cached;
      return JSON.parse(decompressed) as T;
    } catch (error) {
      logger.warn('cache_get_failed', {
        event: 'cache_get_failed',
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Cache market data (ticker, orderbook, OHLCV)
   */
  async cacheMarketData(
    exchange: string,
    symbol: string,
    data: Partial<MarketDataCache>,
    ttlSeconds = 30
  ): Promise<void> {
    const key = `market:${exchange}:${symbol}`;
    const existing = await this.get<MarketDataCache>(key) || {};
    
    const merged: MarketDataCache = {
      ...existing,
      ...data,
      timestamp: Date.now(),
    };

    await this.set(key, merged, { ttl: ttlSeconds });
    
    logger.debug('market_data_cached', {
      event: 'market_data_cached',
      exchange,
      symbol,
      dataTypes: Object.keys(data),
    });
  }

  /**
   * Get cached market data
   */
  async getMarketData(
    exchange: string,
    symbol: string,
    maxAgeSeconds = 30
  ): Promise<MarketDataCache | null> {
    const key = `market:${exchange}:${symbol}`;
    const cached = await this.get<MarketDataCache>(key);
    
    if (!cached) return null;
    
    const ageSeconds = (Date.now() - cached.timestamp) / 1000;
    if (ageSeconds > maxAgeSeconds) {
      if (this.enabled && this.redis && this.isConnected) {
        await this.redis.del(key);
      }
      return null;
    }
    
    return cached;
  }

  /**
   * Cache OHLCV data for backtesting
   */
  async cacheOHLCV(
    exchange: string,
    symbol: string,
    timeframe: string,
    ohlcv: any[],
    ttlHours = 1
  ): Promise<void> {
    const key = `ohlcv:${exchange}:${symbol}:${timeframe}`;
    await this.set(key, ohlcv, { 
      ttl: ttlHours * 3600, 
      compression: true // OHLCV data can be large
    });
    
    logger.info('ohlcv_cached', {
      event: 'ohlcv_cached',
      exchange,
      symbol,
      timeframe,
      candles: ohlcv.length,
    });
  }

  /**
   * Get cached OHLCV data
   */
  async getOHLCV(
    exchange: string,
    symbol: string,
    timeframe: string
  ): Promise<any[] | null> {
    const key = `ohlcv:${exchange}:${symbol}:${timeframe}`;
    return this.get<any[]>(key, { compression: true });
  }

  /**
   * Cache trading plan/grid configuration
   */
  async cacheTradingPlan(
    clientId: string,
    runId: string,
    plan: any,
    ttlMinutes = 60
  ): Promise<void> {
    const key = `plan:${clientId}:${runId}`;
    await this.set(key, plan, { ttl: ttlMinutes * 60 });
  }

  /**
   * Get cached trading plan
   */
  async getTradingPlan(clientId: string, runId: string): Promise<any | null> {
    const key = `plan:${clientId}:${runId}`;
    return this.get(key);
  }

  /**
   * Cache client configuration
   */
  async cacheClientConfig(clientId: string, config: any, ttlMinutes = 30): Promise<void> {
    const key = `config:${clientId}`;
    await this.set(key, config, { ttl: ttlMinutes * 60 });
  }

  /**
   * Get cached client configuration
   */
  async getClientConfig(clientId: string): Promise<any | null> {
    const key = `config:${clientId}`;
    return this.get(key);
  }

  /**
   * Cache exchange rate limits status
   */
  async cacheRateLimit(
    exchange: string,
    endpoint: string,
    remaining: number,
    resetTime: number
  ): Promise<void> {
    const key = `ratelimit:${exchange}:${endpoint}`;
    const data = { remaining, resetTime, timestamp: Date.now() };
    await this.set(key, data, { ttl: Math.ceil((resetTime - Date.now()) / 1000) });
  }

  /**
   * Check rate limit status
   */
  async getRateLimit(exchange: string, endpoint: string): Promise<{
    remaining: number;
    resetTime: number;
    canProceed: boolean;
  } | null> {
    const key = `ratelimit:${exchange}:${endpoint}`;
    const cached = await this.get<{ remaining: number; resetTime: number; timestamp: number }>(key);
    
    if (!cached) return null;
    
    const now = Date.now();
    const canProceed = cached.remaining > 0 || now >= cached.resetTime;
    
    return {
      remaining: cached.remaining,
      resetTime: cached.resetTime,
      canProceed,
    };
  }

  /**
   * Increment counter with expiration
   */
  async incrementCounter(key: string, ttlSeconds: number = 3600): Promise<number> {
    if (!this.enabled || !this.redis || !this.isConnected) return 0;

    try {
      const multi = this.redis.multi();
      multi.incr(key);
      multi.expire(key, ttlSeconds);
      const results = await multi.exec();
      return results?.[0]?.[1] as number || 0;
    } catch (error) {
      logger.warn('counter_increment_failed', {
        event: 'counter_increment_failed',
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Store temporary session data
   */
  async setSession(sessionId: string, data: any, ttlMinutes = 60): Promise<void> {
    const key = `session:${sessionId}`;
    await this.set(key, data, { ttl: ttlMinutes * 60 });
  }

  /**
   * Get session data
   */
  async getSession(sessionId: string): Promise<any | null> {
    const key = `session:${sessionId}`;
    return this.get(key);
  }

  /**
   * Delete cache entry
   */
  async delete(key: string): Promise<boolean> {
    if (!this.enabled || !this.redis || !this.isConnected) return false;

    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      logger.warn('cache_delete_failed', {
        event: 'cache_delete_failed',
        key,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Clear all cache entries matching pattern
   */
  async clearPattern(pattern: string): Promise<number> {
    if (!this.enabled || !this.redis || !this.isConnected) return 0;

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) return 0;
      
      await this.redis.del(...keys);
      logger.info('cache_pattern_cleared', {
        event: 'cache_pattern_cleared',
        pattern,
        clearedKeys: keys.length,
      });
      
      return keys.length;
    } catch (error) {
      logger.warn('cache_clear_pattern_failed', {
        event: 'cache_clear_pattern_failed',
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ 
    connected: boolean; 
    keyCount: number; 
    memoryUsage?: string;
  }> {
    if (!this.enabled || !this.redis || !this.isConnected) {
      return { connected: false, keyCount: 0 };
    }

    try {
      const keyCount = await this.redis.dbsize();
      const info = await this.redis.info('memory');
      const memoryMatch = info.match(/used_memory_human:(.+)\r?\n/);
      const memoryUsage = memoryMatch ? memoryMatch[1] : undefined;

      return {
        connected: true,
        keyCount,
        memoryUsage,
      };
    } catch (error) {
      logger.warn('cache_stats_failed', {
        event: 'cache_stats_failed',
        error: error instanceof Error ? error.message : String(error),
      });
      return { connected: false, keyCount: 0 };
    }
  }

  /**
   * Simple compression for large values (placeholder - implement actual compression if needed)
   */
  private compress(data: string): string {
    // For now, just return as-is. Could implement gzip compression here
    return data;
  }

  /**
   * Simple decompression (placeholder)
   */
  private decompress(data: string): string {
    // For now, just return as-is. Could implement gzip decompression here
    return data;
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (!this.enabled || !this.redis) return;
    try {
      await this.redis.quit();
      logger.info('redis_cache_shutdown', {
        event: 'redis_cache_shutdown',
      });
    } catch (error) {
      logger.error('redis_cache_shutdown_failed', {
        event: 'redis_cache_shutdown_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

// Global singleton instance
export const cacheService = new RedisCacheService();

// Graceful shutdown handling
if (CONFIG.ENABLE_REDIS_CACHE) {
  process.on('SIGINT', () => {
    cacheService.shutdown().catch((error) => {
      logger.warn('redis_cache_shutdown_failed', {
        event: 'redis_cache_shutdown_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });

  process.on('SIGTERM', () => {
    cacheService.shutdown().catch((error) => {
      logger.warn('redis_cache_shutdown_failed', {
        event: 'redis_cache_shutdown_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  });
}
