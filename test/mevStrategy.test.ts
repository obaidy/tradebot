import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({
  spawn: () => {
    const emitter = new EventEmitter();
    process.nextTick(() => {
      emitter.emit('exit', 0);
    });
    return emitter;
  },
}));

vi.mock('../src/services/mev/config', () => {
  class MockMevConfigError extends Error {
    public code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    buildMevEnvironment: vi.fn(),
    MevConfigError: MockMevConfigError,
  };
});

vi.mock('../src/services/mev/probe', () => {
  class MockMevProbeError extends Error {
    public code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    probeMevRuntime: vi.fn(),
    MevProbeError: MockMevProbeError,
  };
});

import { runMevBot } from '../src/strategies/mevStrategy';
import type { StrategyRunContext } from '../src/strategies/types';
import { buildMevEnvironment } from '../src/services/mev/config';
import { MevProbeError, probeMevRuntime } from '../src/services/mev/probe';

const buildMevEnvironmentMock = vi.mocked(buildMevEnvironment);
const probeMevRuntimeMock = vi.mocked(probeMevRuntime);

function buildContext(overrides?: Partial<StrategyRunContext>): StrategyRunContext {
  return {
    clientId: 'client-x',
    planId: 'plan-x' as any,
    pair: 'ETH/USDC',
    runMode: 'live',
    config: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  buildMevEnvironmentMock.mockReturnValue({
    env: { RPC_URL: 'https://rpc.example', PRIVATE_KEY: '0x' + '1'.repeat(64), TOKEN_OUT: '0x' + '2'.repeat(40) },
    summary: { rpcUrl: 'https://rpc.example', tokenOut: '0x' + '2'.repeat(40) },
  });
  probeMevRuntimeMock.mockResolvedValue({
    rpcUrl: 'https://rpc.example',
    walletAddress: '0x' + 'a'.repeat(40),
    chainId: 1,
    networkName: 'mainnet',
    latestBlockNumber: 18_000_000,
    balanceWei: '100000000000000000',
    balanceEth: '0.1',
    gasPriceWei: '20000000000',
    gasPriceGwei: '20',
  });
});

describe('runMevBot metadata handling', () => {
  it('updates secret metadata with the preflight summary when successful', async () => {
    const updateMetadata = vi.fn();
    const ctx = buildContext({
      services: {
        updateStrategySecretMetadata: updateMetadata,
      },
    });

    await runMevBot(ctx);

    expect(updateMetadata).toHaveBeenCalledTimes(1);
    const payload = updateMetadata.mock.calls[0][0] as Record<string, any>;
    expect(payload.lastPreflightError).toBeNull();
    expect(typeof payload.lastPreflightAt).toBe('string');
    expect(payload.lastPreflight).toMatchObject({
      chainId: 1,
      fundingStatus: 'ok',
      gasPriceGwei: '20',
    });
  });

  it('persists preflight errors into metadata and rethrows', async () => {
    const updateMetadata = vi.fn();
    const failure = new MevProbeError('probe_failed', 'rpc unreachable');
    probeMevRuntimeMock.mockRejectedValue(failure);

    const ctx = buildContext({
      services: { updateStrategySecretMetadata: updateMetadata },
    });

    await expect(runMevBot(ctx)).rejects.toBe(failure);
    expect(updateMetadata).toHaveBeenCalledTimes(1);
    const payload = updateMetadata.mock.calls[0][0] as Record<string, any>;
    expect(payload.lastPreflightError).toMatchObject({
      code: 'probe_failed',
      message: 'rpc unreachable',
    });
  });
});
