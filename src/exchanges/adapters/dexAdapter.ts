import { JsonRpcProvider, Wallet, ZeroAddress, formatEther, type BigNumberish } from 'ethers';
import { BaseExchangeAdapter } from './baseAdapter';
import { AdapterOrderRequest, AdapterOrderResponse, ExchangeAdapterConfig, QuoteTick } from './types';
import { logger } from '../../utils/logger';

const DEFAULT_DEX_ROUTER_ADDRESS = process.env.DEX_ROUTER_ADDRESS || ZeroAddress;

export class DexExchangeAdapter extends BaseExchangeAdapter {
  private provider: JsonRpcProvider;
  private wallet: Wallet | null = null;
  private routerAddress: string;

  constructor(config: ExchangeAdapterConfig) {
    super('dex', config);
    const rpcUrl = config.rpcUrl || process.env.DEX_RPC_URL;
    if (!rpcUrl) {
      throw new Error('dex_rpc_url_missing');
    }
    this.provider = (config.walletProvider as JsonRpcProvider) ?? new JsonRpcProvider(rpcUrl);
    this.routerAddress = String(config.extra?.routerAddress ?? DEFAULT_DEX_ROUTER_ADDRESS);
    if (config.privateKey || process.env.DEX_PRIVATE_KEY) {
      this.wallet = new Wallet(config.privateKey ?? process.env.DEX_PRIVATE_KEY!, this.provider);
    }
    this.supportsSpot = true;
    this.supportsFutures = false;
    this.supportsMargin = false;
  }

  override async connect(): Promise<void> {
    await super.connect();
    if (this.wallet) {
      const network = await this.provider.getNetwork();
      logger.info('dex_adapter_connected', {
        event: 'dex_adapter_connected',
        network: network.chainId,
        address: this.wallet.address,
      });
    }
  }

  async fetchBalances(): Promise<Record<string, number>> {
    this.assertConnected();
    if (!this.wallet) return {};
    const balance = await this.provider.getBalance(this.wallet.address);
    return { ETH: Number(formatEther(balance)) };
  }

  async fetchOpenOrders(): Promise<AdapterOrderResponse[]> {
    this.assertConnected();
    // DEX swaps are typically immediate; return empty list for now
    return [];
  }

  async fetchTicker(symbol: string): Promise<QuoteTick> {
    this.assertConnected();
    // Placeholder: In production integrate with on-chain price oracles or DEX aggregators
    return {
      symbol,
      bid: null,
      ask: null,
      last: null,
      timestamp: Date.now(),
    };
  }

  async placeOrder(request: AdapterOrderRequest): Promise<AdapterOrderResponse> {
    this.assertConnected();
    if (!this.wallet) throw new Error('dex_wallet_missing');
    if (!request.type || request.type === 'limit') {
      // DEX swaps are inherently market orders; emulate by ignoring limit price
      logger.warn('dex_limit_order_warning', {
        event: 'dex_limit_order_warning',
        symbol: request.symbol,
      });
    }
    // Implementation placeholder: integrate with Uniswap/Pancake router
    // For now we simulate success and return synthetic order response
    const orderId = `dex-swap-${Date.now()}`;
    return {
      id: orderId,
      status: 'filled',
      filled: request.amount,
      remaining: 0,
      raw: {
        symbol: request.symbol,
        side: request.side,
        router: this.routerAddress,
      },
    };
  }

  async cancelOrder(): Promise<void> {
    throw new Error('dex_cancel_not_supported');
  }

  async estimateSwap(params: { tokenIn: string; tokenOut: string; amountIn: BigNumberish }): Promise<number> {
    this.assertConnected();
    // Placeholder: hook into on-chain quoting (e.g., call getAmountsOut)
    logger.debug('dex_estimate_swap', {
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
    });
    return 0;
  }

  async executeSwap(params: {
    tokenIn: string;
    tokenOut: string;
    amountIn: BigNumberish;
    minAmountOut: BigNumberish;
    recipient: string;
  }): Promise<string> {
    this.assertConnected();
    if (!this.wallet) throw new Error('dex_wallet_missing');
    // Placeholder for actual router interaction. In production you'd instantiate contract and call swap.
    logger.info('dex_swap_executed', {
      event: 'dex_swap_executed',
      router: this.routerAddress,
      tokenIn: params.tokenIn,
      tokenOut: params.tokenOut,
    });
    return `tx-${Date.now()}`;
  }
}
