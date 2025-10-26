import { formatUnits, JsonRpcProvider, Wallet, type TransactionRequest } from 'ethers';
import { DexAggregationService } from '../../defi/aggregators/dexAggregationService';
import type { DexQuoteResponse, DexSwapResponse } from '../../defi/aggregators/types';
import type { StrategyRunMode } from '../../strategies/types';
import { RunsRepository, OrdersRepository } from '../../db/repositories';
import { getHttpProvider } from './provider';
import { logger } from '../../utils/logger';
import { errorMessage } from '../../utils/formatError';

interface BotSwapExecutionConfig {
  botName: string;
  clientId: string;
  runMode: StrategyRunMode;
  tokenIn: string;
  tokenOut: string;
  tokenInSymbol?: string | null;
  tokenOutSymbol?: string | null;
  tokenInDecimals: number;
  tokenOutDecimals: number;
  amountInAtomic: bigint;
  slippageBps: number;
  runsRepo: RunsRepository;
  ordersRepo: OrdersRepository;
  walletPrivateKey?: string;
  recipient?: string;
  aggregatorId?: string;
  metadata?: Record<string, unknown>;
}

interface SwapExecutionResult {
  runId: string;
  status: 'summary' | 'paper' | 'filled' | 'failed';
  quote?: DexQuoteResponse;
  swap?: DexSwapResponse;
  txHash?: string;
  expectedAmountOut?: number;
  minAmountOut?: number;
  amountIn?: number;
}

function computeMinAmountOut(amountOut: bigint, slippageBps: number): bigint {
  if (amountOut <= 0n) return 0n;
  const basis = BigInt(10_000);
  const adjustment = basis - BigInt(Math.min(Math.max(slippageBps, 0), 5_000));
  return (amountOut * adjustment) / basis;
}

function buildTxRequest(raw: Record<string, any>): TransactionRequest {
  const payload = raw?.tx ?? raw;
  if (!payload || !payload.to || !payload.data) {
    throw new Error('aggregator_tx_payload_missing');
  }
  const tx: TransactionRequest = {
    to: payload.to,
    data: payload.data,
    value: payload.value ?? payload.valueHex ?? undefined,
    gasLimit: payload.gas ?? payload.gasLimit ?? undefined,
    gasPrice: payload.gasPrice ?? undefined,
    maxFeePerGas: payload.maxFeePerGas ?? undefined,
    maxPriorityFeePerGas: payload.maxPriorityFeePerGas ?? undefined,
  };
  if (payload.chainId) {
    tx.chainId = Number(payload.chainId);
  }
  if (payload.nonce !== undefined) {
    tx.nonce = Number(payload.nonce);
  }
  return tx;
}

export async function executeBotSwap(config: BotSwapExecutionConfig): Promise<SwapExecutionResult> {
  const provider: JsonRpcProvider = getHttpProvider();
  const network = await provider.getNetwork();
  const service = new DexAggregationService();

  const amountInHuman = Number(formatUnits(config.amountInAtomic, config.tokenInDecimals));
  const runId = `${config.botName}-${Date.now()}-${Math.floor(Math.random() * 10_000)}`;

  await config.runsRepo.createRun({
    runId,
    owner: config.botName,
    exchange: 'onchain',
    paramsJson: {
      botName: config.botName,
      tokenIn: config.tokenIn,
      tokenOut: config.tokenOut,
      amountInAtomic: config.amountInAtomic.toString(),
      slippageBps: config.slippageBps,
      runMode: config.runMode,
      metadata: config.metadata ?? {},
    },
  });

  const enabledAggregators = service.listEnabledAggregators();
  let orderRecord: Awaited<ReturnType<OrdersRepository['insertOrder']>> | null = null;

  if (!enabledAggregators.length) {
    if (config.runMode === 'live') {
      throw new Error('dex_aggregator_unavailable');
    }
    logger.warn('bot_swap_aggregator_missing', {
      event: 'bot_swap_aggregator_missing',
      botName: config.botName,
      runMode: config.runMode,
    });
    orderRecord = await config.ordersRepo.insertOrder({
      runId,
      pair: `${config.tokenInSymbol ?? config.tokenIn}/${config.tokenOutSymbol ?? config.tokenOut}`,
      side: 'buy',
      price: 0,
      amount: amountInHuman,
      status: config.runMode,
      filledAmount: config.runMode === 'summary' ? 0 : amountInHuman,
      remainingAmount: 0,
      raw: {
        reason: 'aggregator_unavailable',
      },
    });
    await config.runsRepo.updateStatus({ runId, status: 'completed' });
    return {
      runId,
      status: config.runMode,
      amountIn: amountInHuman,
    };
  }

  try {
    const recipient =
      config.recipient ??
      (config.walletPrivateKey ? new Wallet(config.walletPrivateKey).address : undefined) ??
      config.clientId;

    const quote = await service.quoteBestRoute({
      chainId: Number(network.chainId),
      tokenIn: config.tokenIn,
      tokenOut: config.tokenOut,
      amountIn: config.amountInAtomic.toString(),
      slippageBps: config.slippageBps,
      userAddress: recipient,
    });

    const expectedOut = BigInt(quote.amountOut ?? '0');
    if (expectedOut <= 0n) {
      throw new Error('aggregator_quote_zero');
    }
    const minAmountOut = computeMinAmountOut(expectedOut, config.slippageBps);
    if (minAmountOut <= 0n) {
      throw new Error('aggregator_min_amount_zero');
    }

    orderRecord = await config.ordersRepo.insertOrder({
      runId,
      pair: `${config.tokenInSymbol ?? config.tokenIn}/${config.tokenOutSymbol ?? config.tokenOut}`,
      side: 'buy',
      price: 0,
      amount: amountInHuman,
      status: 'pending',
      filledAmount: 0,
      raw: {
        quote,
        minAmountOut: minAmountOut.toString(),
      },
    });

    if (config.runMode === 'summary' || config.runMode === 'paper') {
      const status = config.runMode === 'summary' ? 'summary' : 'paper';
      await config.ordersRepo.updateOrder({
        orderId: orderRecord.id,
        status,
        filledAmount: amountInHuman,
        remainingAmount: 0,
        raw: {
          quote,
          minAmountOut: minAmountOut.toString(),
          runMode: config.runMode,
        },
      });
      await config.runsRepo.updateStatus({ runId, status: 'completed' });
      return {
        runId,
        status,
        quote,
        expectedAmountOut: Number(formatUnits(expectedOut, config.tokenOutDecimals)),
        minAmountOut: Number(formatUnits(minAmountOut, config.tokenOutDecimals)),
        amountIn: amountInHuman,
      };
    }

    if (!config.walletPrivateKey) {
      throw new Error('wallet_private_key_missing');
    }

    const wallet = new Wallet(config.walletPrivateKey, provider);
    const swap = await service.executeSwap({
      chainId: Number(network.chainId),
      tokenIn: config.tokenIn,
      tokenOut: config.tokenOut,
      amountIn: config.amountInAtomic.toString(),
      minAmountOut: minAmountOut.toString(),
      recipient: recipient ?? wallet.address,
      slippageBps: config.slippageBps,
      aggregator: config.aggregatorId ?? quote.aggregator,
    });

    const txRequest = buildTxRequest(swap.rawTx ?? {});
    const response = await wallet.sendTransaction(txRequest);
    const confirmations = Number(process.env.SWAP_CONFIRMATIONS ?? 1);
    const receipt = await response.wait(confirmations);
    if (!receipt) {
      throw new Error('swap_transaction_receipt_missing');
    }

    await config.ordersRepo.updateOrder({
      orderId: orderRecord.id,
      status: 'filled',
      filledAmount: amountInHuman,
      remainingAmount: 0,
      raw: {
        quote,
        swap,
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed?.toString(),
      },
    });
    await config.runsRepo.updateStatus({ runId, status: 'completed' });

    return {
      runId,
      status: 'filled',
      quote,
      swap,
      txHash: receipt.hash,
      expectedAmountOut: Number(formatUnits(expectedOut, config.tokenOutDecimals)),
      minAmountOut: Number(formatUnits(minAmountOut, config.tokenOutDecimals)),
      amountIn: amountInHuman,
    };
  } catch (error) {
    logger.error('bot_swap_execution_failed', {
      event: 'bot_swap_execution_failed',
      botName: config.botName,
      clientId: config.clientId,
      tokenIn: config.tokenIn,
      tokenOut: config.tokenOut,
      error: errorMessage(error),
    });
    if (orderRecord) {
      await config.ordersRepo.updateOrder({
        orderId: orderRecord.id,
        status: 'rejected',
        driftReason: error instanceof Error ? error.message : String(error),
        raw: {
          ...(orderRecord.raw ?? {}),
          error: errorMessage(error),
        },
      }).catch((updateError) => {
        logger.warn('bot_swap_order_update_failed', {
          event: 'bot_swap_order_update_failed',
          orderId: orderRecord?.id,
          error: errorMessage(updateError),
        });
      });
    }
    await config.runsRepo.updateStatus({ runId, status: 'failed' }).catch((updateError) => {
      logger.warn('bot_swap_run_state_failed', {
        event: 'bot_swap_run_state_failed',
        runId,
        error: errorMessage(updateError),
      });
    });
    throw error;
  }
}
