import { NftArbBot, type NftCollectionConfig, type NftMarketVenue } from '../defi/nft/nftArbBot';
import type { StrategyRunContext } from './types';
import { logger } from '../utils/logger';

function resolveVenues(): NftMarketVenue[] {
  const raw = process.env.NFT_MARKET_VENUES;
  if (!raw) {
    return [
      {
        name: 'opensea',
        feeBps: 250,
        apiBaseUrl: 'https://api.opensea.io',
      },
    ];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as NftMarketVenue[];
  } catch (error) {
    logger.warn('nft_venues_parse_failed', {
      event: 'nft_venues_parse_failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return [];
}

function resolveCollection(ctx: StrategyRunContext): NftCollectionConfig {
  const cfg = ctx.config ?? {};
  return {
    slug: String(cfg.slug ?? process.env.NFT_COLLECTION_SLUG ?? 'boredapeyachtclub'),
    tokenStandard: (cfg.tokenStandard as 'ERC721' | 'ERC1155') ?? 'ERC721',
    maxBidUsd: Number(cfg.maxBidUsd ?? process.env.NFT_MAX_BID_USD ?? 20000),
    desiredSpreadBps: Number(cfg.desiredSpreadBps ?? process.env.NFT_DESIRED_SPREAD_BPS ?? 500),
  };
}

export async function runNftMarketMakerStrategy(ctx: StrategyRunContext) {
  const venues = resolveVenues();
  const collection = resolveCollection(ctx);
  const bot = new NftArbBot(venues);

  const candidate = await bot.scanCollection(collection);
  if (!candidate) {
    logger.info('nft_no_opportunity', {
      event: 'nft_no_opportunity',
      clientId: ctx.clientId,
      collection: collection.slug,
    });
    return;
  }

  if (ctx.runMode !== 'live') {
    logger.info('nft_opportunity_simulation', {
      event: 'nft_opportunity_simulation',
      clientId: ctx.clientId,
      candidate,
    });
    return;
  }

  await bot.executeArbitrage(candidate, collection);
}
