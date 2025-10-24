import { Contract, JsonRpcProvider, ZeroAddress, formatUnits, getAddress, isAddress } from 'ethers';
import { logger } from '../../utils/logger';
import { getHttpProvider } from './provider';

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function name() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export interface TokenSafetyMetrics {
  symbol?: string | null;
  name?: string | null;
  decimals?: number | null;
  totalSupply?: string | null;
  proxyDetected: boolean;
  blacklistSuspected: boolean;
  tradingTaxSuspected: boolean;
  codeSize: number;
  anomalyNotes: string[];
}

export interface TokenSafetyReport {
  address: string;
  passed: boolean;
  reasons: string[];
  metrics: TokenSafetyMetrics;
}

export interface TokenSafetyOptions {
  minCodeSize?: number;
  requireMetadata?: boolean;
  simulationTarget?: string;
  simulationAmount?: bigint;
}

function isProxyBytecode(bytecode: string): boolean {
  const normalized = bytecode.toLowerCase();
  return normalized.includes('363d3d373d3d3d363d73') || normalized.includes('5af43d82803e903d91602b57fd5bf3');
}

function looksBlacklisted(bytecode: string): boolean {
  const normalized = bytecode.toLowerCase();
  return normalized.includes('8f32d59b') || normalized.includes('f2fde38b') || normalized.includes('d5a06d1e');
}

function looksTaxed(bytecode: string): boolean {
  const normalized = bytecode.toLowerCase();
  return normalized.includes('0e7995c0') || normalized.includes('fc0c546a') || normalized.includes('d0def521');
}

async function fetchErc20Metadata(contract: Contract) {
  const results = await Promise.allSettled([
    contract.symbol(),
    contract.name(),
    contract.decimals(),
    contract.totalSupply(),
  ]);
  const [symbol, name, decimals, totalSupply] = results;
  const decimalsValue = decimals.status === 'fulfilled' ? Number(decimals.value) : 18;
  return {
    symbol: symbol.status === 'fulfilled' ? (symbol.value as string) : null,
    name: name.status === 'fulfilled' ? (name.value as string) : null,
    decimals: decimals.status === 'fulfilled' ? decimalsValue : null,
    totalSupply: totalSupply.status === 'fulfilled' ? formatUnits(totalSupply.value, decimalsValue) : null,
  };
}

async function performDryRun(
  provider: JsonRpcProvider,
  contract: Contract,
  options: TokenSafetyOptions,
  anomalyNotes: string[]
) {
  try {
    const to = options.simulationTarget ?? ZeroAddress;
    const decimals = (await contract.decimals().catch(() => 18)) ?? 18;
    const amountRaw = options.simulationAmount ?? BigInt(10) ** BigInt(decimals);
    await provider.call({
      to: contract.target,
      data: contract.interface.encodeFunctionData('transfer', [to, amountRaw]),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    anomalyNotes.push(`dry_run_failed:${message}`);
    throw new Error(`token_transfer_simulation_failed:${message}`);
  }
}

export async function evaluateTokenSafety(address: string, options: TokenSafetyOptions = {}): Promise<TokenSafetyReport> {
  if (!isAddress(address)) {
    throw new Error(`invalid_token_address:${address}`);
  }

  const provider = getHttpProvider();
  const checksumAddress = getAddress(address);
  const bytecode = await provider.getCode(checksumAddress);
  const reasons: string[] = [];
  const anomalyNotes: string[] = [];

  if (!bytecode || bytecode === '0x') {
    reasons.push('token_bytecode_missing');
    return {
      address: checksumAddress,
      passed: false,
      reasons,
      metrics: {
        proxyDetected: false,
        blacklistSuspected: false,
        tradingTaxSuspected: false,
        codeSize: 0,
        anomalyNotes,
      },
    };
  }

  const proxyDetected = isProxyBytecode(bytecode);
  const blacklistSuspected = looksBlacklisted(bytecode);
  const tradingTaxSuspected = looksTaxed(bytecode);

  const codeSize = Math.ceil((bytecode.length - 2) / 2);
  const minCodeSize = options.minCodeSize ?? 1500;
  if (codeSize < minCodeSize) {
    reasons.push(`code_size_too_small:${codeSize}`);
  }
  if (proxyDetected) {
    reasons.push('proxy_detected');
  }
  if (blacklistSuspected) {
    anomalyNotes.push('blacklist_pattern_detected');
  }
  if (tradingTaxSuspected) {
    anomalyNotes.push('tax_pattern_detected');
  }

  const contract = new Contract(checksumAddress, ERC20_ABI, provider);
  const metadata = await fetchErc20Metadata(contract);
  if (options.requireMetadata && !metadata.symbol) {
    reasons.push('symbol_missing');
  }
  if (options.requireMetadata && !metadata.decimals && metadata.decimals !== 0) {
    reasons.push('decimals_missing');
  }

  if (options.simulationTarget || options.simulationAmount) {
    try {
      await performDryRun(provider, contract, options, anomalyNotes);
    } catch (error) {
      reasons.push(error instanceof Error ? error.message : String(error));
    }
  }

  const passed = reasons.length === 0;
  if (!passed) {
    logger.warn('token_safety_failed', {
      event: 'token_safety_failed',
      address: checksumAddress,
      reasons,
      proxyDetected,
      blacklistSuspected,
      tradingTaxSuspected,
    });
  }

  return {
    address: checksumAddress,
    passed,
    reasons,
    metrics: {
      symbol: metadata.symbol,
      name: metadata.name,
      decimals: metadata.decimals,
      totalSupply: metadata.totalSupply,
      proxyDetected,
      blacklistSuspected,
      tradingTaxSuspected,
      codeSize,
      anomalyNotes,
    },
  };
}
