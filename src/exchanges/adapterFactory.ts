import { ExchangeAdapter, ExchangeAdapterConfig } from './adapters/types';
import { CcxtExchangeAdapter } from './adapters/ccxtAdapter';
import { DexExchangeAdapter } from './adapters/dexAdapter';
import { DerivativesExchangeAdapter } from './adapters/derivativesAdapter';
import { FixExchangeAdapter } from './adapters/fixAdapter';
import { PrimeBrokerAdapter } from './adapters/primeBrokerAdapter';

export type AdapterKind = 'ccxt' | 'dex' | 'derivatives' | 'fix' | 'prime';

export interface AdapterFactoryConfig extends ExchangeAdapterConfig {
  kind: AdapterKind;
}

export function createExchangeAdapter(config: AdapterFactoryConfig): ExchangeAdapter {
  switch (config.kind) {
    case 'ccxt':
      return new CcxtExchangeAdapter(config);
    case 'dex':
      return new DexExchangeAdapter(config);
    case 'derivatives':
      return new DerivativesExchangeAdapter(config);
    case 'fix':
      return new FixExchangeAdapter(config);
    case 'prime':
      return new PrimeBrokerAdapter(config);
    default:
      throw new Error(`unknown_adapter_kind:${config.kind}`);
  }
}
