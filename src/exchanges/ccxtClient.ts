import ccxt from 'ccxt';
import { CONFIG } from '../config';

export interface ExchangeConnectionOptions {
  exchangeId?: string;
  apiKey?: string;
  apiSecret?: string;
  passphrase?: string | null;
}

export function getExchange(options: ExchangeConnectionOptions = {}) {
  const id = (options.exchangeId || CONFIG.DEFAULT_EXCHANGE) as keyof typeof ccxt;
  const ExchangeClass = (ccxt as any)[id];
  if (!ExchangeClass) {
    throw new Error(`Exchange ${String(id)} is not supported by ccxt`);
  }
  const exchange = new ExchangeClass({
    apiKey: options.apiKey,
    secret: options.apiSecret,
    password: options.passphrase ?? undefined,
    enableRateLimit: true,
    options: { adjustForTimeDifference: true },
  });
  return exchange;
}
