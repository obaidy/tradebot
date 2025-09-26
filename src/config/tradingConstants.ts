/**
 * Trading Constants - Centralized configuration for all trading-related values
 * This replaces scattered magic numbers throughout the codebase
 */

export const TRADING_CONSTANTS = {
  // Fee structures (per exchange)
  FEES: {
    DEFAULT_TAKER_PCT: 0.00075, // 0.075% - Binance taker fee
    DEFAULT_MAKER_PCT: 0.0006,  // 0.06% - Binance maker fee
    BYBIT_TAKER_PCT: 0.0006,
    COINBASE_TAKER_PCT: 0.005,
  },

  // Slippage assumptions
  SLIPPAGE: {
    DEFAULT_PCT: 0.0005,        // 0.05% - conservative estimate
    HIGH_VOLATILITY_PCT: 0.001, // 0.1% - during volatile periods
    LOW_LIQUIDITY_PCT: 0.002,   // 0.2% - for low-liquidity pairs
  },

  // Risk management thresholds
  RISK: {
    DEFAULT_BANKROLL_USD: 200,
    MAX_PER_TRADE_PCT: 0.02,    // 2% of bankroll per trade
    DAILY_LOSS_STOP_PCT: 0.05,  // 5% daily loss limit
    
    // Circuit breaker defaults
    MAX_GLOBAL_DRAWDOWN_USD: 500,
    MAX_RUN_LOSS_USD: 200,
    MAX_API_ERRORS_PER_MIN: 10,
    STALE_TICKER_MS: 5 * 60 * 1000, // 5 minutes
  },

  // Grid trading parameters
  GRID: {
    DEFAULT_STEPS: 8,
    DEFAULT_SIZE_PCT: 0.02,     // 2% grid spacing
    DEFAULT_TAKE_PROFIT_PCT: 0.05, // 5% take profit
    MIN_STEPS: 3,
    MAX_STEPS: 20,
  },

  // Technical analysis periods
  TECHNICAL: {
    SMA_PERIOD_HOURS: 24,
    ATR_PERIOD: 14,
    RSI_PERIOD: 14,
    RSI_OVERSOLD: 30,
    RSI_OVERBOUGHT: 70,
  },

  // Regime analysis thresholds
  REGIME: {
    MEAN_REVERT_PCT: 0.01,      // 1% mean reversion threshold
    MIN_ATR_PCT: 0.002,         // 0.2% minimum ATR for trading
    FUNDING_NEGATIVE_THRESHOLD: -0.0005, // Negative funding threshold
    FUNDING_POSITIVE_THRESHOLD: 0.0007,  // High funding threshold
  },

  // Order management timeouts
  ORDERS: {
    REPLACE_TIMEOUT_MS: 30 * 1000,    // 30 seconds
    MONITOR_INTERVAL_MS: 5 * 1000,    // 5 seconds
    CANCEL_TIMEOUT_MS: 10 * 1000,     // 10 seconds
    MAX_REPLACE_RETRIES: 3,
  },

  // Precision and minimums
  PRECISION: {
    DEFAULT_BASE_PRECISION: 8,
    DEFAULT_QUOTE_PRECISION: 2,
    MIN_STEP_SIZE: 0.00001,
    MIN_NOTIONAL_USD: 1.0,
  },

  // Timeouts and intervals
  TIMEOUTS: {
    API_REQUEST_MS: 10 * 1000,        // 10 seconds
    HEALTH_CHECK_INTERVAL_MS: 60 * 1000, // 1 minute
    LOG_INGESTION_TIMEOUT_MS: 2 * 1000,  // 2 seconds
    SLEEP_BETWEEN_ORDERS_MS: 200,     // 200ms between order placements
  },

  // Queue settings
  QUEUE: {
    REMOVE_ON_COMPLETE: 100,
    REMOVE_ON_FAIL: 200,
    MAX_CONCURRENT_JOBS: 5,
  },

  // HTTP status codes
  HTTP: {
    OK: 200,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    METHOD_NOT_ALLOWED: 405,
    INTERNAL_ERROR: 500,
  },

  // Backtesting defaults
  BACKTEST: {
    STARTING_CAPITAL_USD: 200,
    HISTORICAL_DAYS: 90,
    MIN_CANDLES_REQUIRED: 100,
  },
} as const;

// Type exports for strong typing
export type FeeStructure = typeof TRADING_CONSTANTS.FEES;
export type RiskConfig = typeof TRADING_CONSTANTS.RISK;
export type GridConfig = typeof TRADING_CONSTANTS.GRID;

// Helper functions for accessing constants
export const getFeeForExchange = (exchange: string): number => {
  switch (exchange.toLowerCase()) {
    case 'bybit': return TRADING_CONSTANTS.FEES.BYBIT_TAKER_PCT;
    case 'coinbasepro': return TRADING_CONSTANTS.FEES.COINBASE_TAKER_PCT;
    default: return TRADING_CONSTANTS.FEES.DEFAULT_TAKER_PCT;
  }
};

export const getSlippageForVolatility = (isHighVolatility: boolean): number => {
  return isHighVolatility 
    ? TRADING_CONSTANTS.SLIPPAGE.HIGH_VOLATILITY_PCT 
    : TRADING_CONSTANTS.SLIPPAGE.DEFAULT_PCT;
};