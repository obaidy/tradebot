import net from 'net';
import { BaseExchangeAdapter } from './baseAdapter';
import type { AdapterOrderRequest, AdapterOrderResponse, ExchangeAdapterConfig, QuoteTick } from './types';
import { logger } from '../../utils/logger';
import { logOrderRouting } from '../../telemetry/orderRoutingLogger';

type FixSessionConfig = {
  endpoint: string;
  senderCompId: string;
  targetCompId: string;
  username?: string;
  password?: string;
  heartbeatSeconds: number;
};

export class FixExchangeAdapter extends BaseExchangeAdapter {
  private socket: net.Socket | null = null;
  private readonly session: FixSessionConfig;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private loggedOn = false;
  private seqNum = 1;

  constructor(config: ExchangeAdapterConfig) {
    super('fix', config);
    const extra = (config.extra ?? {}) as Record<string, unknown>;
    const endpoint = typeof extra.endpoint === 'string' ? extra.endpoint : process.env.FIX_ENDPOINT;
    if (!endpoint) {
      throw new Error('fix_endpoint_missing');
    }
    const senderCompId = typeof extra.senderCompId === 'string' ? extra.senderCompId : process.env.FIX_SENDER_COMP_ID;
    const targetCompId = typeof extra.targetCompId === 'string' ? extra.targetCompId : process.env.FIX_TARGET_COMP_ID;
    if (!senderCompId || !targetCompId) {
      throw new Error('fix_session_ids_missing');
    }
    const username = typeof extra.username === 'string' ? extra.username : process.env.FIX_USERNAME;
    const password = typeof extra.password === 'string' ? extra.password : process.env.FIX_PASSWORD;
    const heartbeatRaw = extra.heartbeatSeconds ?? process.env.FIX_HEARTBEAT_SECONDS ?? 30;
    const heartbeatSeconds = Number.isFinite(Number(heartbeatRaw)) ? Number(heartbeatRaw) : 30;

    this.session = {
      endpoint,
      senderCompId,
      targetCompId,
      username,
      password,
      heartbeatSeconds,
    };

    this.supportsSpot = true;
    this.supportsFutures = true;
    this.supportsMargin = true;
  }

  override async connect(): Promise<void> {
    await super.connect();
    const { host, port } = this.parseEndpoint(this.session.endpoint);
    this.socket = net.createConnection({ host, port });
    this.socket.setKeepAlive(true, this.session.heartbeatSeconds * 1000);
    this.socket.on('connect', () => {
      logger.info('fix_connection_established', {
        event: 'fix_connection_established',
        host,
        port,
        senderCompId: this.session.senderCompId,
        targetCompId: this.session.targetCompId,
      });
      this.sendLogon();
      this.startHeartbeat();
    });
    this.socket.on('data', (buffer) => {
      logger.debug('fix_message_received', {
        event: 'fix_message_received',
        length: buffer.length,
      });
    });
    this.socket.on('error', (error) => {
      logger.error('fix_connection_error', {
        event: 'fix_connection_error',
        error: error instanceof Error ? error.message : String(error),
      });
    });
    this.socket.on('close', () => {
      this.loggedOn = false;
      this.stopHeartbeat();
      logger.info('fix_connection_closed', { event: 'fix_connection_closed' });
    });
  }

  override async disconnect(): Promise<void> {
    await super.disconnect();
    this.stopHeartbeat();
    this.loggedOn = false;
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }

  async fetchBalances(): Promise<Record<string, number>> {
    this.assertConnected();
    return {};
  }

  async fetchOpenOrders(): Promise<AdapterOrderResponse[]> {
    this.assertConnected();
    return [];
  }

  async fetchTicker(symbol: string): Promise<QuoteTick> {
    this.assertConnected();
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
    if (!this.loggedOn) {
      this.sendLogon();
    }
    const clientOrderId = request.clientOrderId ?? `fix-${Date.now()}`;
    this.sendWireMessage('newOrderSingle', {
      clientOrderId,
      symbol: request.symbol,
      side: request.side,
      amount: request.amount,
      price: request.price ?? null,
      type: request.type ?? 'limit',
      timeInForce: request.timeInForce ?? null,
      leverage: request.leverage ?? null,
    });

    logOrderRouting({
      adapterId: this.id,
      venue: 'fix',
      symbol: request.symbol,
      side: request.side,
      quantity: request.amount,
      metadata: {
        clientOrderId,
        type: request.type ?? 'limit',
        timeInForce: request.timeInForce ?? null,
      },
    });

    return {
      id: clientOrderId,
      status: 'accepted',
      filled: 0,
      remaining: request.amount,
      raw: {
        venue: 'fix',
        clientOrderId,
      },
    };
  }

  async cancelOrder(id: string, symbol?: string): Promise<void> {
    this.assertConnected();
    this.sendWireMessage('cancelOrder', {
      clientOrderId: id,
      symbol: symbol ?? null,
    });
    logger.info('fix_cancel_sent', {
      event: 'fix_cancel_sent',
      id,
      symbol: symbol ?? null,
    });
  }

  private parseEndpoint(endpoint: string) {
    const [host, portStr] = endpoint.split(':');
    const port = Number(portStr || '9898');
    return { host, port };
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.session.heartbeatSeconds * 1000);
  }

  private stopHeartbeat() {
    if (!this.heartbeatTimer) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private sendLogon() {
    if (!this.socket) return;
    this.sendWireMessage('logon', {
      username: this.session.username ?? null,
      password: this.session.password ?? null,
      heartbeat: this.session.heartbeatSeconds,
    });
    this.loggedOn = true;
    logger.info('fix_logon_dispatched', {
      event: 'fix_logon_dispatched',
      adapterId: this.id,
      senderCompId: this.session.senderCompId,
      targetCompId: this.session.targetCompId,
      heartbeatSeconds: this.session.heartbeatSeconds,
      hasUsername: Boolean(this.session.username),
    });
  }

  private sendHeartbeat() {
    if (!this.socket) return;
    this.sendWireMessage('heartbeat', {
      heartbeat: this.session.heartbeatSeconds,
    });
  }

  private sendWireMessage(kind: string, payload: Record<string, unknown>) {
    if (!this.socket) return;
    const message = {
      kind,
      seq: this.seqNum++,
      sender: this.session.senderCompId,
      target: this.session.targetCompId,
      timestamp: Date.now(),
      ...payload,
    };
    try {
      this.socket.write(`${JSON.stringify(message)}\n`);
    } catch (err) {
      logger.warn('fix_socket_write_failed', {
        event: 'fix_socket_write_failed',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
