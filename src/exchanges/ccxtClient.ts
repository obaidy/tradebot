import ccxt from 'ccxt';
import { CONFIG } from '../config';

export function getExchange(apiKey?: string, apiSecret?: string) {
  const id = CONFIG.DEFAULT_EXCHANGE as any;
  const ExchangeClass = (ccxt as any)[id];
  const exchange = new ExchangeClass({
    apiKey,
    secret: apiSecret,
    enableRateLimit: true,
    options: { adjustForTimeDifference: true }
  });
  return exchange;
}
