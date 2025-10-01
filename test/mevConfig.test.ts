import { describe, it, expect } from 'vitest';
import type { StrategyRunContext } from '../src/strategies/types';
import { buildMevEnvironment, MevConfigError } from '../src/services/mev/config';

const VALID_PRIVATE_KEY = '0x' + '11'.repeat(32);
const VALID_ADDRESS = '0x' + '22'.repeat(20);

function createCtx(overrides?: Partial<StrategyRunContext['config']>): StrategyRunContext {
  return {
    clientId: 'test-client',
    planId: 'plan-1',
    pair: 'ETH/USDC',
    runMode: 'live',
    config: {
      rpcUrl: 'https://example-rpc.local',
      privateKey: VALID_PRIVATE_KEY,
      tokenOut: VALID_ADDRESS,
      ...overrides,
    },
  };
}

describe('buildMevEnvironment validations', () => {
  it('rejects non-hex private keys', () => {
    const ctx = createCtx({ privateKey: 'not-a-key' });

    try {
      buildMevEnvironment(ctx);
      expect.fail('Expected buildMevEnvironment to throw for invalid private key');
    } catch (error) {
      expect(error).toBeInstanceOf(MevConfigError);
      expect((error as MevConfigError).code).toBe('mev_private_key_invalid');
    }
  });

  it('rejects invalid tokenOut addresses', () => {
    const ctx = createCtx({ tokenOut: '0x1234' });

    try {
      buildMevEnvironment(ctx);
      expect.fail('Expected buildMevEnvironment to throw for invalid tokenOut');
    } catch (error) {
      expect(error).toBeInstanceOf(MevConfigError);
      expect((error as MevConfigError).code).toBe('mev_token_out_invalid');
    }
  });

  it('rejects invalid router address overrides', () => {
    const ctx = createCtx({ routerAddress: 'router' });

    try {
      buildMevEnvironment(ctx);
      expect.fail('Expected buildMevEnvironment to throw for invalid routerAddress');
    } catch (error) {
      expect(error).toBeInstanceOf(MevConfigError);
      expect((error as MevConfigError).code).toBe('mev_router_address_invalid');
    }
  });

  it('rejects invalid flashbots signing keys', () => {
    const ctx = createCtx({ flashbotsAuthKey: 'bad-signing-key' });

    try {
      buildMevEnvironment(ctx);
      expect.fail('Expected buildMevEnvironment to throw for invalid flashbots auth key');
    } catch (error) {
      expect(error).toBeInstanceOf(MevConfigError);
      expect((error as MevConfigError).code).toBe('mev_flashbots_key_invalid');
    }
  });
});
