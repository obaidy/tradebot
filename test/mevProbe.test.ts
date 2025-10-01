import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockProviderState = {
  getNetwork: vi.fn(),
  getBlockNumber: vi.fn(),
  getBalance: vi.fn(),
  getFeeData: vi.fn(),
  lastPrivateKey: '' as string | null,
  lastRpcUrl: '' as string | null,
};

function formatWithFactor(value: bigint | { toString(): string }, factor: bigint) {
  const wei = BigInt(value.toString());
  const integer = wei / factor;
  const remainder = wei % factor;
  if (remainder === 0n) {
    return integer.toString();
  }
  const remainderStr = (factor + remainder).toString().slice(1).replace(/0+$/, '');
  return `${integer.toString()}.${remainderStr}`;
}

vi.mock('ethers', () => {
  class MockJsonRpcProvider {
    constructor(public url: string) {
      mockProviderState.lastRpcUrl = url;
    }

    getNetwork() {
      return mockProviderState.getNetwork();
    }

    getBlockNumber() {
      return mockProviderState.getBlockNumber();
    }

    getBalance(address: string) {
      if (!address) {
        throw new Error('address missing');
      }
      return mockProviderState.getBalance(address);
    }

    getFeeData() {
      return mockProviderState.getFeeData();
    }
  }

  class MockWallet {
    public readonly address = '0xmockwallet000000000000000000000000000000';

    constructor(privateKey: string) {
      mockProviderState.lastPrivateKey = privateKey;
    }
  }

  return {
    JsonRpcProvider: MockJsonRpcProvider,
    Wallet: MockWallet,
    formatEther(value: bigint | { toString(): string }) {
      return formatWithFactor(value, 1_000_000_000_000_000_000n);
    },
    formatUnits(value: bigint | { toString(): string }, unit: string) {
      const factor = unit === 'gwei' ? 1_000_000_000n : 1_000_000_000_000_000_000n;
      return formatWithFactor(value, factor);
    },
  };
});

import { MevProbeError, probeMevRuntime } from '../src/services/mev/probe';

const VALID_PRIVATE_KEY = '0x' + '11'.repeat(32);

beforeEach(() => {
  mockProviderState.getNetwork.mockReset().mockResolvedValue({ chainId: 1n, name: 'mainnet' });
  mockProviderState.getBlockNumber.mockReset().mockResolvedValue(18_765_432n);
  mockProviderState.getBalance.mockReset().mockResolvedValue(1_000_000_000_000_000_000n);
  mockProviderState.getFeeData.mockReset().mockResolvedValue({ gasPrice: 20_000_000_000n });
  mockProviderState.lastPrivateKey = null;
  mockProviderState.lastRpcUrl = null;
});

describe('probeMevRuntime', () => {
  it('requires RPC_URL in the environment', async () => {
    await expect(probeMevRuntime({})).rejects.toMatchObject({ code: 'mev_probe_missing_rpc' });
  });

  it('requires PRIVATE_KEY in the environment', async () => {
    await expect(probeMevRuntime({ RPC_URL: 'https://rpc.local' })).rejects.toMatchObject({
      code: 'mev_probe_missing_private_key',
    });
  });

  it('returns network metadata and balance details', async () => {
    const result = await probeMevRuntime({ RPC_URL: 'https://rpc.local', PRIVATE_KEY: VALID_PRIVATE_KEY });

    expect(mockProviderState.lastRpcUrl).toBe('https://rpc.local');
    expect(mockProviderState.lastPrivateKey).toBe(VALID_PRIVATE_KEY);

    expect(result).toEqual({
      rpcUrl: 'https://rpc.local',
      walletAddress: '0xmockwallet000000000000000000000000000000',
      chainId: 1,
      networkName: 'mainnet',
      latestBlockNumber: 18_765_432,
      balanceWei: '1000000000000000000',
      balanceEth: '1',
      gasPriceWei: '20000000000',
      gasPriceGwei: '20',
    });
  });

  it('wraps provider failures with a probe error', async () => {
    mockProviderState.getNetwork.mockRejectedValue(new Error('unreachable'));

    await expect(
      probeMevRuntime({ RPC_URL: 'https://broken.rpc', PRIVATE_KEY: VALID_PRIVATE_KEY })
    ).rejects.toBeInstanceOf(MevProbeError);
  });
});
