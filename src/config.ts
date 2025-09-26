import dotenv from 'dotenv';
dotenv.config();

export const CONFIG = {
  ENV: process.env.NODE_ENV || 'development',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379',
  ENABLE_REDIS_CACHE: process.env.ENABLE_REDIS_CACHE === 'true',
  PG_URL: process.env.PG_URL || 'postgresql://postgres:password@localhost:5432/tradebot',
  TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || '',
  ALERT_EMAIL_FROM: process.env.ALERT_EMAIL_FROM || '',
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  ALERT_SMS_FROM: process.env.ALERT_SMS_FROM || '',
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
  },
  LEGAL: {
    TOS_VERSION: process.env.TOS_VERSION || '2025-01-01',
    PRIVACY_VERSION: process.env.PRIVACY_VERSION || '2025-01-01',
    RISK_VERSION: process.env.RISK_VERSION || '2025-01-01'
  },
  EXCHANGE_RETRY: {
    ATTEMPTS: Number(process.env.EXCHANGE_RETRY_ATTEMPTS || '5'),
    DELAY_MS: Number(process.env.EXCHANGE_RETRY_DELAY_MS || '500'),
    BACKOFF: Number(process.env.EXCHANGE_RETRY_BACKOFF || '2'),
  }
};
