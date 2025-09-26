/**
 * CCXT Exchange Connection Pool
 * Manages reusable exchange connections to avoid constant instance creation
 */

import * as ccxt from 'ccxt';
import { logger } from '../utils/logger';
import { TRADING_CONSTANTS } from '../config/tradingConstants';

interface PooledExchange {
  instance: ccxt.Exchange;
  lastUsed: number;
  inUse: boolean;
}

interface ExchangeConfig {
  apiKey?: string;
  secret?: string;
  passphrase?: string;
  sandbox?: boolean;
  enableRateLimit?: boolean;
  options?: Record<string, any>;
}

class ExchangeConnectionPool {
  private pools: Map<string, PooledExchange[]> = new Map();
  private readonly maxPoolSize = 5;
  private readonly maxIdleTime = 10 * 60 * 1000; // 10 minutes
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Cleanup idle connections every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupIdleConnections();
    }, 5 * 60 * 1000);
  }

  /**
   * Get a pooled exchange instance
   */
  async getExchange(
    exchangeName: string, 
    config: ExchangeConfig = {}
  ): Promise<ccxt.Exchange> {
    const poolKey = this.getPoolKey(exchangeName, config);
    const pool = this.pools.get(poolKey) || [];

    // Try to find an available instance
    const available = pool.find(p => !p.inUse);
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      logger.debug('exchange_pool_reuse', {
        event: 'exchange_pool_reuse',
        exchange: exchangeName,
        poolSize: pool.length,
      });
      return available.instance;
    }

    // Create new instance if pool not full
    if (pool.length < this.maxPoolSize) {
      const instance = this.createExchangeInstance(exchangeName, config);
      const pooledExchange: PooledExchange = {
        instance,
        lastUsed: Date.now(),
        inUse: true,
      };
      
      pool.push(pooledExchange);
      this.pools.set(poolKey, pool);
      
      logger.debug('exchange_pool_create', {
        event: 'exchange_pool_create',
        exchange: exchangeName,
        poolSize: pool.length,
      });
      
      return instance;
    }

    // Pool is full, wait for available instance or create temporary one
    logger.warn('exchange_pool_full', {
      event: 'exchange_pool_full',
      exchange: exchangeName,
      poolSize: pool.length,
    });
    
    return this.createExchangeInstance(exchangeName, config);
  }

  /**
   * Release an exchange back to the pool
   */
  releaseExchange(exchange: ccxt.Exchange): void {
    for (const [, pool] of this.pools) {
      const pooled = pool.find(p => p.instance === exchange);
      if (pooled) {
        pooled.inUse = false;
        pooled.lastUsed = Date.now();
        return;
      }
    }
    
    // Exchange not from pool, close it
    if (exchange.close) {
      exchange.close().catch((error: any) => {
        logger.warn('exchange_close_failed', {
          event: 'exchange_close_failed',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  /**
   * Execute a function with a pooled exchange
   */
  async withExchange<T>(
    exchangeName: string,
    config: ExchangeConfig,
    fn: (exchange: ccxt.Exchange) => Promise<T>
  ): Promise<T> {
    const exchange = await this.getExchange(exchangeName, config);
    try {
      return await fn(exchange);
    } finally {
      this.releaseExchange(exchange);
    }
  }

  /**
   * Create a new exchange instance with default config
   */
  private createExchangeInstance(exchangeName: string, config: ExchangeConfig): ccxt.Exchange {
    const ExchangeClass = ccxt[exchangeName as keyof typeof ccxt] as any;
    if (!ExchangeClass) {
      throw new Error(`Unsupported exchange: ${exchangeName}`);
    }

    const defaultConfig = {
      enableRateLimit: true,
      timeout: TRADING_CONSTANTS.TIMEOUTS.API_REQUEST_MS,
      options: { 
        adjustForTimeDifference: true,
        recvWindow: 10000,
        ...config.options,
      },
      ...config,
    };

    return new ExchangeClass(defaultConfig);
  }

  /**
   * Generate a unique pool key for exchange + config combination
   */
  private getPoolKey(exchangeName: string, config: ExchangeConfig): string {
    const keyParts = [
      exchangeName,
      config.apiKey ? 'auth' : 'public',
      config.sandbox ? 'sandbox' : 'live',
    ];
    return keyParts.join(':');
  }

  /**
   * Clean up idle connections
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [poolKey, pool] of this.pools) {
      const activeConnections = pool.filter(p => {
        if (!p.inUse && (now - p.lastUsed) > this.maxIdleTime) {
          // Close idle connection
          if (p.instance.close) {
            p.instance.close().catch((error: any) => {
              logger.warn('exchange_close_failed', {
                event: 'exchange_close_failed',
                error: error instanceof Error ? error.message : String(error),
              });
            });
          }
          cleaned++;
          return false;
        }
        return true;
      });

      if (activeConnections.length === 0) {
        this.pools.delete(poolKey);
      } else {
        this.pools.set(poolKey, activeConnections);
      }
    }

    if (cleaned > 0) {
      logger.info('exchange_pool_cleanup', {
        event: 'exchange_pool_cleanup',
        cleanedConnections: cleaned,
        remainingPools: this.pools.size,
      });
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): { totalPools: number; totalConnections: number; activeConnections: number } {
    let totalConnections = 0;
    let activeConnections = 0;

    for (const pool of this.pools.values()) {
      totalConnections += pool.length;
      activeConnections += pool.filter(p => p.inUse).length;
    }

    return {
      totalPools: this.pools.size,
      totalConnections,
      activeConnections,
    };
  }

  /**
   * Graceful shutdown - close all connections
   */
  async shutdown(): Promise<void> {
    clearInterval(this.cleanupInterval);
    
    const closePromises: Promise<void>[] = [];
    
    for (const pool of this.pools.values()) {
      for (const pooled of pool) {
        if (pooled.instance.close) {
          closePromises.push(
            pooled.instance.close().catch((error: any) => {
              logger.warn('exchange_shutdown_close_failed', {
                event: 'exchange_shutdown_close_failed',
                error: error instanceof Error ? error.message : String(error),
              });
            })
          );
        }
      }
    }

    await Promise.all(closePromises);
    this.pools.clear();
    
    logger.info('exchange_pool_shutdown', {
      event: 'exchange_pool_shutdown',
      closedConnections: closePromises.length,
    });
  }
}

// Global singleton instance
export const exchangePool = new ExchangeConnectionPool();

// Graceful shutdown handling
process.on('SIGINT', () => {
  exchangePool.shutdown().catch((error) => {
    logger.error('exchange_pool_shutdown_error', {
      event: 'exchange_pool_shutdown_error',
      error: error instanceof Error ? error.message : String(error),
    });
  });
});

process.on('SIGTERM', () => {
  exchangePool.shutdown().catch((error) => {
    logger.error('exchange_pool_shutdown_error', {
      event: 'exchange_pool_shutdown_error',
      error: error instanceof Error ? error.message : String(error),
    });
  });
});
