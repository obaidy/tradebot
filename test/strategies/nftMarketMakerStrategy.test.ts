import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StrategyRunContext } from '../../src/strategies/types';

const scanCollection = vi.fn(async () => ({
  tokenId: '123',
  floorPriceUsd: 100,
  listingVenue: 'opensea',
  bestBidUsd: 120,
}));
const executeArbitrage = vi.fn(async () => {});

vi.mock('../../src/defi/nft/nftArbBot', () => ({
  NftArbBot: vi.fn(() => ({
    scanCollection,
    executeArbitrage,
  })),
}));

async function runStrategy(ctx: StrategyRunContext) {
  const module = await import('../../src/strategies/nftMarketMakerStrategy');
  return module.runNftMarketMakerStrategy(ctx);
}

describe('runNftMarketMakerStrategy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scanCollection.mockResolvedValue({
      tokenId: '123',
      floorPriceUsd: 100,
      listingVenue: 'opensea',
      bestBidUsd: 120,
    });
  });

  it('executes arbitrage in live mode', async () => {
    const ctx: StrategyRunContext = {
      clientId: 'client-nft',
      planId: 'pro',
      pair: 'NFT',
      runMode: 'live',
    } as any;

    await runStrategy(ctx);
    expect(executeArbitrage).toHaveBeenCalled();
  });

  it('skips execution when no candidate', async () => {
    scanCollection.mockResolvedValueOnce(null);
    const ctx: StrategyRunContext = {
      clientId: 'client-nft',
      planId: 'pro',
      pair: 'NFT',
      runMode: 'live',
    } as any;

    await runStrategy(ctx);
    expect(executeArbitrage).not.toHaveBeenCalled();
  });
});
