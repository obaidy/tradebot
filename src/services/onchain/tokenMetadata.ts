import { Contract, getAddress, isAddress, JsonRpcProvider } from 'ethers';
import { getHttpProvider } from './provider';
import { logger } from '../../utils/logger';

const ERC20_META_ABI = [
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
];

type TokenMetadata = {
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number;
};

const metadataCache = new Map<string, TokenMetadata>();

const WELL_KNOWN: Record<string, TokenMetadata> = {
  // Ethereum mainnet staples
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': {
    address: '0xC02aaA39b223FE8D0A0E5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    name: 'Wrapped Ether',
    decimals: 18,
  },
  '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': {
    address: '0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    symbol: 'USDC',
    name: 'USD Coin',
    decimals: 6,
  },
  '0xdac17f958d2ee523a2206206994597c13d831ec7': {
    address: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
    symbol: 'USDT',
    name: 'Tether USD',
    decimals: 6,
  },
};

function fromCache(address: string): TokenMetadata | null {
  const key = address.toLowerCase();
  if (metadataCache.has(key)) {
    return metadataCache.get(key) ?? null;
  }
  if (WELL_KNOWN[key]) {
    metadataCache.set(key, WELL_KNOWN[key]);
    return WELL_KNOWN[key];
  }
  return null;
}

function cache(address: string, meta: TokenMetadata) {
  metadataCache.set(address.toLowerCase(), meta);
}

async function fetchMetadata(provider: JsonRpcProvider, address: string): Promise<TokenMetadata> {
  const contract = new Contract(address, ERC20_META_ABI, provider);
  const [symbolResult, nameResult, decimalsResult] = await Promise.allSettled([
    contract.symbol(),
    contract.name(),
    contract.decimals(),
  ]);

  const symbol =
    symbolResult.status === 'fulfilled' && typeof symbolResult.value === 'string'
      ? symbolResult.value
      : null;
  const name =
    nameResult.status === 'fulfilled' && typeof nameResult.value === 'string'
      ? nameResult.value
      : null;
  const decimals =
    decimalsResult.status === 'fulfilled' && Number.isInteger(Number(decimalsResult.value))
      ? Number(decimalsResult.value)
      : 18;

  return {
    address,
    symbol,
    name,
    decimals,
  };
}

export async function getTokenMetadata(address: string): Promise<TokenMetadata> {
  if (!isAddress(address)) {
    throw new Error(`invalid_token_address:${address}`);
  }
  const checksum = getAddress(address);
  const cached = fromCache(checksum);
  if (cached) return cached;
  const provider = getHttpProvider();
  try {
    const metadata = await fetchMetadata(provider, checksum);
    cache(checksum, metadata);
    return metadata;
  } catch (error) {
    logger.warn('token_metadata_fetch_failed', {
      event: 'token_metadata_fetch_failed',
      address: checksum,
      error: error instanceof Error ? error.message : String(error),
    });
    const fallback = {
      address: checksum,
      symbol: null,
      name: null,
      decimals: 18,
    };
    cache(checksum, fallback);
    return fallback;
  }
}
