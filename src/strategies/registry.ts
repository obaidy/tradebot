import { PLAN_DEFINITIONS } from '../config/plans';
import type { PlanId } from '../config/planTypes';
import { logger } from '../utils/logger';
import { runGridStrategy } from './gridStrategy';
import { runMevBot } from './mevStrategy';
import { runDexSwapStrategy } from './dexSwapStrategy';
import { runPerpGridStrategy } from './perpGridStrategy';
import { runDexAggregationStrategy } from './dexAggregationStrategy';
import { runYieldFarmingStrategy } from './yieldFarmingStrategy';
import { runFlashLoanArbStrategy } from './flashLoanArbStrategy';
import { runCrossChainArbStrategy } from './crossChainArbStrategy';
import { runNftMarketMakerStrategy } from './nftMarketMakerStrategy';
import type { StrategyId, StrategyRunContext, StrategyRunMode } from './types';

export type StrategyRequirementMode = 'all' | 'any';

export interface StrategyRequirement {
  type: 'env';
  keys: string[];
  message?: string;
  mode?: StrategyRequirementMode;
}

export interface StrategyDefinition {
  id: StrategyId;
  name: string;
  description: string;
  allowedPlans: PlanId[];
  defaultPair: string;
  supportsPaper: boolean;
  supportsLive: boolean;
  supportsSummary: boolean;
  status: 'active' | 'beta' | 'coming_soon';
  ctaLabel?: string;
  ctaDescription?: string;
  requirements?: StrategyRequirement[];
  run: (context: StrategyRunContext) => Promise<void>;
}

function deriveAllowedPlans(strategyId: StrategyId): PlanId[] {
  return PLAN_DEFINITIONS.filter((plan) => plan.strategies.includes(strategyId)).map((plan) => plan.id as PlanId);
}

const STRATEGY_REGISTRY: Record<StrategyId, StrategyDefinition> = {
  grid: {
    id: 'grid',
    name: 'Grid Bot',
    description: 'Mean-reversion grid that buys dips and sells rips within a bounded range.',
    allowedPlans: deriveAllowedPlans('grid'),
    defaultPair: 'BTC/USDT',
    supportsPaper: true,
    supportsLive: true,
    supportsSummary: true,
    status: 'active',
    ctaLabel: 'Launch adaptive grid',
    ctaDescription: 'Mean-reversion engine with guard rails for paper and live tiers.',
    run: runGridStrategy,
  },
  mev: {
    id: 'mev',
    name: 'MEV Arb Bot',
    description: 'Flashbots-enabled MEV runner for Ethereum mainnet sandwich/arb opportunities.',
    allowedPlans: deriveAllowedPlans('mev'),
    defaultPair: 'ETH/WETH',
    supportsPaper: false,
    supportsLive: true,
    supportsSummary: false,
    status: 'beta',
    ctaLabel: 'Dispatch MEV engine',
    ctaDescription: 'Bundles Ethereum mainnet opportunities into Flashbots private relay flow.',
    requirements: [
      {
        type: 'env',
        mode: 'any',
        keys: ['MEV_RPC_URL', 'RPC_URL', 'MEV_ALCHEMY_KEY', 'ALCHEMY_KEY', 'MEV_ALCHEMY_HTTPS', 'ALCHEMY_HTTPS'],
        message: 'Provide MEV_RPC_URL, RPC_URL, or an Alchemy key.',
      },
      {
        type: 'env',
        mode: 'any',
        keys: ['MEV_PRIVATE_KEY', 'PRIVATE_KEY'],
        message: 'Set MEV_PRIVATE_KEY or PRIVATE_KEY.',
      },
      {
        type: 'env',
        mode: 'any',
        keys: ['MEV_TOKEN_OUT', 'TOKEN_OUT'],
        message: 'Set MEV_TOKEN_OUT or TOKEN_OUT.',
      },
    ],
    run: runMevBot,
  },
  'dex-swap': {
    id: 'dex-swap',
    name: 'DEX Swap',
    description: 'Execute on-chain swaps via configured DEX routers with slippage controls.',
    allowedPlans: deriveAllowedPlans('dex-swap'),
    defaultPair: 'WETH/USDC',
    supportsPaper: false,
    supportsLive: false,
    supportsSummary: false,
    status: 'coming_soon',
    ctaLabel: 'Coming soon',
    ctaDescription: 'On-chain swap automation is being prepared for release.',
    requirements: [
      {
        type: 'env',
        keys: ['DEX_RPC_URL'],
        message: 'Configure DEX_RPC_URL to point at your node provider.',
      },
    ],
    run: runDexSwapStrategy,
  },
  'perp-grid': {
    id: 'perp-grid',
    name: 'Perpetual Grid',
    description: 'Leverage-enabled grid strategy for perpetual futures markets.',
    allowedPlans: deriveAllowedPlans('perp-grid'),
    defaultPair: 'BTC/USDT',
    supportsPaper: true,
    supportsLive: true,
    supportsSummary: true,
    status: 'beta',
    ctaLabel: 'Launch perp grid',
    ctaDescription: 'Deploy grid orders on futures exchanges with adjustable leverage.',
    requirements: [
      {
        type: 'env',
        keys: ['EXCHANGE_API_KEY', 'EXCHANGE_API_SECRET'],
        message: 'Provide API credentials for derivatives venue.',
      },
    ],
    run: runPerpGridStrategy,
  },
  'dex-aggregation': {
    id: 'dex-aggregation',
    name: 'DEX Aggregation',
    description: 'Route swaps through 1inch or ParaSwap to secure best on-chain execution.',
    allowedPlans: deriveAllowedPlans('dex-aggregation'),
    defaultPair: 'ETH/USDC',
    supportsPaper: false,
    supportsLive: false,
    supportsSummary: false,
    status: 'coming_soon',
    requirements: [
      {
        type: 'env',
        mode: 'any',
        keys: ['ONEINCH_API_KEY', 'PARASWAP_API_KEY'],
        message: 'Provide at least one DEX aggregator API key (1inch or ParaSwap).',
      },
    ],
    run: runDexAggregationStrategy,
  },
  'yield-farming': {
    id: 'yield-farming',
    name: 'Yield Farming',
    description: 'Deploys liquidity into configured pools and harvests rewards with optional compounding.',
    allowedPlans: deriveAllowedPlans('yield-farming'),
    defaultPair: 'USDC/ETH',
    supportsPaper: false,
    supportsLive: false,
    supportsSummary: false,
    status: 'coming_soon',
    requirements: [
      {
        type: 'env',
        mode: 'any',
        keys: ['YIELD_PROTOCOL', 'YIELD_POOL_ADDRESS'],
        message: 'Set YIELD_PROTOCOL and YIELD_POOL_ADDRESS for the target farm.',
      },
    ],
    run: runYieldFarmingStrategy,
  },
  'flash-loan-arb': {
    id: 'flash-loan-arb',
    name: 'Flash Loan Arbitrage',
    description: 'Evaluates cross-venue spreads and executes with flash loan liquidity.',
    allowedPlans: deriveAllowedPlans('flash-loan-arb'),
    defaultPair: 'ETH/USDC',
    supportsPaper: false,
    supportsLive: false,
    supportsSummary: false,
    status: 'coming_soon',
    requirements: [
      {
        type: 'env',
        keys: ['FLASH_LOAN_PROVIDER'],
        message: 'Specify a flash loan provider (e.g., aave, balancer).',
      },
    ],
    run: runFlashLoanArbStrategy,
  },
  'cross-chain-arb': {
    id: 'cross-chain-arb',
    name: 'Cross-Chain Arbitrage',
    description: 'Scans for spreads across chains and evaluates bridge routes.',
    allowedPlans: deriveAllowedPlans('cross-chain-arb'),
    defaultPair: 'ETH/USDC',
    supportsPaper: false,
    supportsLive: false,
    supportsSummary: false,
    status: 'coming_soon',
    requirements: [
      {
        type: 'env',
        keys: ['CROSS_CHAIN_BRIDGES'],
        message: 'Provide bridge metadata via CROSS_CHAIN_BRIDGES JSON.',
      },
    ],
    run: runCrossChainArbStrategy,
  },
  'nft-market-maker': {
    id: 'nft-market-maker',
    name: 'NFT Market Maker',
    description: 'Monitors high-volume collections for spread capture opportunities.',
    allowedPlans: deriveAllowedPlans('nft-market-maker'),
    defaultPair: 'NFT',
    supportsPaper: false,
    supportsLive: false,
    supportsSummary: false,
    status: 'coming_soon',
    requirements: [
      {
        type: 'env',
        keys: ['NFT_COLLECTION_SLUG'],
        message: 'Configure NFT_COLLECTION_SLUG to target a collection.',
      },
    ],
    run: runNftMarketMakerStrategy,
  },
};

export type StrategySummary = Omit<StrategyDefinition, 'run'>;

export function listStrategies(): StrategySummary[] {
  return Object.values(STRATEGY_REGISTRY)
    .filter((definition) => definition.status !== 'coming_soon' && definition.allowedPlans.length > 0)
    .map(({ run, ...summary }) => summary);
}

export function getStrategyDefinition(id: StrategyId): StrategyDefinition | null {
  return STRATEGY_REGISTRY[id] ?? null;
}

export function ensureStrategySupportsRunMode(strategy: StrategyDefinition, runMode: StrategyRunMode): boolean {
  if (runMode === 'live' && !strategy.supportsLive) {
    logger.warn('strategy_live_not_supported', {
      event: 'strategy_live_not_supported',
      strategyId: strategy.id,
    });
    return false;
  }
  if (runMode === 'paper' && !strategy.supportsPaper) {
    logger.warn('strategy_paper_not_supported', {
      event: 'strategy_paper_not_supported',
      strategyId: strategy.id,
    });
    return false;
  }
  if (runMode === 'summary' && !strategy.supportsSummary) {
    logger.warn('strategy_summary_not_supported', {
      event: 'strategy_summary_not_supported',
      strategyId: strategy.id,
    });
    return false;
  }
  return true;
}

type StrategyRequirementContext = Pick<StrategyRunContext, 'config'> | { config?: Record<string, unknown> } | undefined;

export function checkStrategyRequirements(strategy: StrategyDefinition, context?: StrategyRequirementContext): boolean {
  if (!strategy.requirements?.length) return true;
  const overrides = buildRequirementOverrideMap(context?.config);
  return strategy.requirements.every((req) => {
    if (req.type !== 'env') return true;
    const availability = req.keys.map((key) => ({ key, present: requirementHasValue(key, overrides) }));
    const mode: StrategyRequirementMode = req.mode ?? 'all';
    const satisfied = mode === 'any'
      ? availability.some((entry) => entry.present)
      : availability.every((entry) => entry.present);
    if (!satisfied) {
      const missing = availability.filter((entry) => !entry.present).map((entry) => entry.key);
      logger.warn('strategy_requirements_missing', {
        event: 'strategy_requirements_missing',
        strategyId: strategy.id,
        missing,
        message: req.message,
      });
    }
    return satisfied;
  });
}

function normalizeRequirementKey(key: string) {
  return key.replace(/^MEV_/i, '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
}

function normalizeRequirementValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = typeof value === 'string' ? value.trim() : String(value).trim();
  return str.length ? str : undefined;
}

function buildRequirementOverrideMap(config?: Record<string, unknown>): Record<string, string> {
  if (!config) return {};
  return Object.entries(config).reduce<Record<string, string>>((acc, [rawKey, rawValue]) => {
    const normalizedKey = normalizeRequirementKey(rawKey);
    const normalizedValue = normalizeRequirementValue(rawValue);
    if (normalizedKey && normalizedValue) {
      acc[normalizedKey] = normalizedValue;
    }
    return acc;
  }, {});
}

function envHasRequirementValue(key: string): boolean {
  const candidates = new Set<string>([key]);
  if (/^MEV_/i.test(key)) {
    candidates.add(key.replace(/^MEV_/i, ''));
  } else {
    candidates.add(`MEV_${key}`);
  }
  for (const candidate of candidates) {
    const value = normalizeRequirementValue(process.env[candidate]);
    if (value) {
      return true;
    }
  }
  return false;
}

function requirementHasValue(key: string, overrides: Record<string, string>): boolean {
  if (envHasRequirementValue(key)) return true;
  const normalizedKey = normalizeRequirementKey(key);
  return Boolean(overrides[normalizedKey]);
}
