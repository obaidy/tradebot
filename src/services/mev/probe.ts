import { JsonRpcProvider, Wallet, formatEther, formatUnits } from 'ethers';

export class MevProbeError extends Error {
  public readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'MevProbeError';
    this.code = code;
    if (options?.cause) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export interface MevProbeResult {
  rpcUrl: string;
  walletAddress: string;
  chainId: number;
  networkName?: string;
  latestBlockNumber: number;
  balanceWei: string;
  balanceEth: string;
  gasPriceWei: string | null;
  gasPriceGwei: string | null;
}

export async function probeMevRuntime(env: NodeJS.ProcessEnv): Promise<MevProbeResult> {
  const rpcUrl = env.RPC_URL;
  const privateKey = env.PRIVATE_KEY;

  if (!rpcUrl) {
    throw new MevProbeError('mev_probe_missing_rpc', 'RPC_URL missing from MEV child environment.');
  }
  if (!privateKey) {
    throw new MevProbeError('mev_probe_missing_private_key', 'PRIVATE_KEY missing from MEV child environment.');
  }

  try {
    const provider = new JsonRpcProvider(rpcUrl);
    const wallet = new Wallet(privateKey, provider);

    const [network, blockNumber, balance, feeData] = await Promise.all([
      provider.getNetwork(),
      provider.getBlockNumber(),
      provider.getBalance(wallet.address),
      provider.getFeeData().catch(() => null),
    ]);

    const gasPrice = feeData?.gasPrice ?? feeData?.maxFeePerGas ?? null;

    return {
      rpcUrl,
      walletAddress: wallet.address,
      chainId: Number(network.chainId),
      networkName: network.name,
      latestBlockNumber: Number(blockNumber),
      balanceWei: balance.toString(),
      balanceEth: formatEther(balance),
      gasPriceWei: gasPrice ? gasPrice.toString() : null,
      gasPriceGwei: gasPrice ? formatUnits(gasPrice, 'gwei') : null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new MevProbeError('mev_probe_failed', `Failed to probe MEV RPC URL: ${message}`, { cause: error });
  }
}
