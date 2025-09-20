import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  ENV: process.env.NODE_ENV || 'development',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  PG_URL: process.env.PG_URL || 'postgresql://postgres:password@localhost:5432/tradebot',
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  PAPER_MODE: process.env.PAPER_MODE === 'true',
  DEFAULT_EXCHANGE: process.env.DEFAULT_EXCHANGE || 'binance',
  RISK: {
    BANKROLL_USD: Number(process.env.BANKROLL_USD || '200'),
    MAX_PER_TRADE_PCT: Number(process.env.MAX_PER_TRADE_PCT || '0.02'),
    DAILY_LOSS_STOP_PCT: Number(process.env.DAILY_LOSS_STOP_PCT || '0.05')
  },
  RUN: {
    OWNER: process.env.RUN_OWNER || 'local',
    CLIENT_ID: process.env.CLIENT_ID || 'default'
  }
};
