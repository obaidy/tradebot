import { JsonRpcProvider, WebSocketProvider } from 'ethers';
import { logger } from '../../utils/logger';

let httpProvider: JsonRpcProvider | null = null;
let wsProvider: WebSocketProvider | null = null;

function buildHttpProvider(): JsonRpcProvider {
  const rpcUrl = process.env.ETH_RPC_HTTP ?? process.env.RPC_URL ?? process.env.MEV_RPC_URL;
  if (!rpcUrl) {
    throw new Error('missing_eth_rpc_http');
  }
  const provider = new JsonRpcProvider(rpcUrl);
  provider.on('error', (error) => {
    logger.warn('onchain_http_provider_error', {
      event: 'onchain_http_provider_error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return provider;
}

function buildWsProvider(): WebSocketProvider {
  const rpcUrl = process.env.ETH_RPC_WSS ?? process.env.ETH_RPC_WS ?? process.env.MEV_RPC_WSS ?? null;
  if (!rpcUrl) {
    throw new Error('missing_eth_rpc_wss');
  }
  const provider = new WebSocketProvider(rpcUrl);
  const socket = (provider as unknown as { _websocket?: { on?: (event: string, handler: (error: unknown) => void) => void } })._websocket;
  socket?.on?.('error', (error: unknown) => {
    logger.warn('onchain_ws_provider_error', {
      event: 'onchain_ws_provider_error',
      message: error instanceof Error ? error.message : String(error),
    });
  });
  return provider;
}

export function getHttpProvider(): JsonRpcProvider {
  if (!httpProvider) {
    httpProvider = buildHttpProvider();
  }
  return httpProvider;
}

export function getWsProvider(): WebSocketProvider | null {
  if (wsProvider) return wsProvider;
  try {
    wsProvider = buildWsProvider();
  } catch (error) {
    logger.warn('onchain_ws_provider_unavailable', {
      event: 'onchain_ws_provider_unavailable',
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  return wsProvider;
}
