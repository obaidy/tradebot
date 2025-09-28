import type { StrategyRunContext } from '../../strategies/types';

export class MevConfigError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MevConfigError';
    this.code = code;
  }
}

type NormalizedConfig = Record<string, string>;

type MevConfigKeys =
  | 'rpcUrl'
  | 'alchemyKey'
  | 'privateKey'
  | 'tokenOut'
  | 'routerAddress'
  | 'amountIn'
  | 'amountOutMin'
  | 'wethAddress'
  | 'flashbotsRelay'
  | 'flashbotsAuthKey';

const CONFIG_KEY_MAP: Record<MevConfigKeys, string[]> = {
  rpcUrl: ['rpcUrl', 'rpc_url', 'rpcURL', 'RPC_URL'],
  alchemyKey: ['alchemyKey', 'alchemy_key', 'ALCHEMY_KEY'],
  privateKey: ['privateKey', 'private_key', 'PRIVATE_KEY'],
  tokenOut: ['tokenOut', 'token_out', 'TOKEN_OUT'],
  routerAddress: ['routerAddress', 'router_address', 'ROUTER_ADDRESS'],
  amountIn: ['amountIn', 'amount_in', 'AMOUNT_IN'],
  amountOutMin: ['amountOutMin', 'amount_out_min', 'AMOUNT_OUT_MIN'],
  wethAddress: ['wethAddress', 'weth_address', 'WETH_ADDRESS'],
  flashbotsRelay: ['flashbotsRelay', 'flashbots_relay', 'relayUrl', 'relay_url', 'FLASHBOTS_RELAY'],
  flashbotsAuthKey: ['flashbotsAuthKey', 'flashbots_auth_key', 'FLASHBOTS_AUTH_KEY', 'flashbotsSigner', 'flashbots_signer'],
};

const ENV_KEY_MAP: Record<MevConfigKeys, string[]> = {
  rpcUrl: ['MEV_RPC_URL', 'RPC_URL', 'ALCHEMY_HTTPS', 'MEV_ALCHEMY_HTTPS'],
  alchemyKey: ['MEV_ALCHEMY_KEY', 'ALCHEMY_KEY'],
  privateKey: ['MEV_PRIVATE_KEY', 'PRIVATE_KEY'],
  tokenOut: ['MEV_TOKEN_OUT', 'TOKEN_OUT'],
  routerAddress: ['MEV_ROUTER_ADDRESS', 'ROUTER_ADDRESS'],
  amountIn: ['MEV_AMOUNT_IN', 'AMOUNT_IN'],
  amountOutMin: ['MEV_AMOUNT_OUT_MIN', 'AMOUNT_OUT_MIN'],
  wethAddress: ['MEV_WETH_ADDRESS', 'WETH_ADDRESS'],
  flashbotsRelay: ['MEV_FLASHBOTS_RELAY', 'FLASHBOTS_RELAY_URL', 'FLASHBOTS_RELAY'],
  flashbotsAuthKey: ['MEV_FLASHBOTS_AUTH_KEY', 'FLASHBOTS_AUTH_KEY', 'FLASHBOTS_SIGNING_KEY'],
};

export interface MevRuntimeSummary {
  rpcUrl: string;
  hasAlchemyKey: boolean;
  tokenOut: string;
  routerAddress: string | null;
  amountIn: string | null;
  amountOutMin: string | null;
  flashbotsRelay: string | null;
  wethAddress: string | null;
  hasFlashbotsAuthKey: boolean;
}

export interface MevEnvironmentResult {
  env: NodeJS.ProcessEnv;
  summary: MevRuntimeSummary;
}

function normalizeValue(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = typeof value === 'string' ? value.trim() : String(value).trim();
  return str.length ? str : undefined;
}

function buildNormalizedConfig(rawConfig: StrategyRunContext['config']): NormalizedConfig {
  if (!rawConfig) return {};
  return Object.entries(rawConfig).reduce<NormalizedConfig>((acc, [key, value]) => {
    const normalizedKey = key.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    const normalizedValue = normalizeValue(value);
    if (normalizedValue) {
      acc[normalizedKey] = normalizedValue;
    }
    return acc;
  }, {} as NormalizedConfig);
}

function lookupValue(
  key: MevConfigKeys,
  normalizedConfig: NormalizedConfig,
  env: NodeJS.ProcessEnv
): string | undefined {
  for (const variant of CONFIG_KEY_MAP[key]) {
    const normalizedKey = variant.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
    if (normalizedConfig[normalizedKey]) {
      return normalizedConfig[normalizedKey];
    }
  }
  for (const envKey of ENV_KEY_MAP[key]) {
    const envValue = normalizeValue(env[envKey]);
    if (envValue) {
      return envValue;
    }
  }
  return undefined;
}

function buildAlchemyHttpsUrl(apiKey: string) {
  return `https://eth-mainnet.g.alchemy.com/v2/${apiKey}`;
}

function redactUrl(input: string) {
  try {
    const parsed = new URL(input);
    if (parsed.username) {
      parsed.username = '***';
    }
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return input.replace(/(https?:\/\/)([^@]+)@/i, '$1***@');
  }
}

export function buildMevEnvironment(ctx: StrategyRunContext): MevEnvironmentResult {
  const normalizedConfig = buildNormalizedConfig(ctx.config);
  const env = process.env;

  const rpcUrl = lookupValue('rpcUrl', normalizedConfig, env);
  const alchemyKey = lookupValue('alchemyKey', normalizedConfig, env);
  const privateKey = lookupValue('privateKey', normalizedConfig, env);
  const tokenOut = lookupValue('tokenOut', normalizedConfig, env);
  const routerAddress = lookupValue('routerAddress', normalizedConfig, env);
  const amountIn = lookupValue('amountIn', normalizedConfig, env);
  const amountOutMin = lookupValue('amountOutMin', normalizedConfig, env);
  const wethAddress = lookupValue('wethAddress', normalizedConfig, env);
  const flashbotsRelay = lookupValue('flashbotsRelay', normalizedConfig, env);
  const flashbotsAuthKey = lookupValue('flashbotsAuthKey', normalizedConfig, env);

  if (!rpcUrl && !alchemyKey) {
    throw new MevConfigError('mev_rpc_url_missing', 'Provide MEV_RPC_URL, RPC_URL, or an ALCHEMY_KEY override.');
  }
  if (!privateKey) {
    throw new MevConfigError('mev_private_key_missing', 'Provide MEV_PRIVATE_KEY or set privateKey in strategy config.');
  }
  if (!tokenOut) {
    throw new MevConfigError('mev_token_out_missing', 'Provide MEV_TOKEN_OUT or set tokenOut in strategy config.');
  }

  const effectiveRpcUrl = rpcUrl ?? buildAlchemyHttpsUrl(alchemyKey!);

  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    RPC_URL: effectiveRpcUrl,
    PRIVATE_KEY: privateKey,
    TOKEN_OUT: tokenOut,
  };

  if (alchemyKey) childEnv.ALCHEMY_KEY = alchemyKey;
  if (routerAddress) childEnv.ROUTER_ADDRESS = routerAddress;
  if (amountIn) childEnv.AMOUNT_IN = amountIn;
  if (amountOutMin) childEnv.AMOUNT_OUT_MIN = amountOutMin;
  if (wethAddress) childEnv.WETH_ADDRESS = wethAddress;
  if (flashbotsRelay) childEnv.FLASHBOTS_RELAY = flashbotsRelay;
  if (flashbotsAuthKey) childEnv.FLASHBOTS_AUTH_KEY = flashbotsAuthKey;

  return {
    env: childEnv,
    summary: {
      rpcUrl: redactUrl(effectiveRpcUrl),
      hasAlchemyKey: Boolean(alchemyKey),
      tokenOut,
      routerAddress: routerAddress ?? null,
      amountIn: amountIn ?? null,
      amountOutMin: amountOutMin ?? null,
      flashbotsRelay: flashbotsRelay ?? null,
      wethAddress: wethAddress ?? null,
      hasFlashbotsAuthKey: Boolean(flashbotsAuthKey),
    },
  };
}
