import { WS_BASE_URL } from '@/constants/env';
import type { ActivityEntry, DashboardSummaryResponse } from '@/services/types';

export type RealtimeEvent =
  | { type: 'connected' }
  | { type: 'disconnected'; reason?: string }
  | { type: 'dashboard.update'; payload: DashboardSummaryResponse }
  | { type: 'activity.append'; payload: ActivityEntry[] };

type EventType = RealtimeEvent['type'];

type Listener<T extends RealtimeEvent> = (event: T) => void;

type ListenerMap = {
  [K in EventType]: Set<Listener<Extract<RealtimeEvent, { type: K }>>>;
};

const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const HEARTBEAT_TIMEOUT_MULTIPLIER = 3;

export class RealtimeClient {
  private websocket: WebSocket | null = null;
  private accessToken: string | null = null;
  private reconnectAttempts = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS;
  private lastMessageAt = 0;
  private shouldReconnect = true;
  private tokenProvider: (() => string | null) | null = null;
  private listeners: ListenerMap = {
    connected: new Set(),
    disconnected: new Set(),
    'dashboard.update': new Set(),
    'activity.append': new Set(),
  };

  connect(
    accessToken: string,
    options?: {
      tokenProvider?: () => string | null;
      heartbeatMs?: number;
    }
  ) {
    this.tokenProvider = options?.tokenProvider ?? this.tokenProvider;
    this.heartbeatIntervalMs = options?.heartbeatMs ?? HEARTBEAT_INTERVAL_MS;
    const resolvedToken = accessToken ?? this.tokenProvider?.() ?? null;
    if (!resolvedToken) return;
    this.accessToken = resolvedToken;
    this.shouldReconnect = true;

    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      return;
    }

    this.reconnectAttempts = 0;
    this.openSocket();
  }

  updateAccessToken(token: string | null) {
    if (!token) return;
    this.accessToken = token;
  }

  pause() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.cleanupSocket(false);
  }

  resume() {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      return;
    }
    const token = this.tokenProvider?.() ?? this.accessToken;
    if (!token) return;
    this.shouldReconnect = true;
    this.accessToken = token;
    this.openSocket();
  }

  disconnect() {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    this.cleanupSocket(true);
    this.accessToken = null;
  }

  on<T extends RealtimeEvent>(event: T['type'], listener: Listener<T>): () => void {
    const listeners = this.listeners[event] as Set<Listener<T>>;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  private openSocket() {
    const token = this.tokenProvider?.() ?? this.accessToken;
    if (!token) return;
    this.accessToken = token;

    const url = `${WS_BASE_URL}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    this.websocket = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastMessageAt = Date.now();
      this.startHeartbeat();
      this.emit({ type: 'connected' });
    };

    ws.onmessage = (event) => {
      this.lastMessageAt = Date.now();
      this.resetInactivityTimer();
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === 'ping') {
          this.send({ type: 'pong', ts: Date.now() });
          return;
        }
        if (!payload?.type) {
          return;
        }
        this.emit(payload as RealtimeEvent);
      } catch (err) {
        console.warn('realtime_parse_error', err);
      }
    };

    ws.onclose = (event) => {
      this.cleanupSocket(false);
      this.emit({ type: 'disconnected', reason: event.reason });
      if (!this.shouldReconnect) return;
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // handled by close
    };
  }

  private scheduleReconnect() {
    this.clearReconnectTimer();
    const attempt = Math.min(this.reconnectAttempts, 10);
    const exponential = BASE_BACKOFF_MS * 2 ** attempt;
    const delay = Math.min(exponential, MAX_BACKOFF_MS);
    this.reconnectAttempts = attempt + 1;
    const jitter = Math.random() * 0.5 * delay;
    this.reconnectTimer = setTimeout(() => {
      if (!this.shouldReconnect) return;
      this.openSocket();
    }, delay + jitter);
  }

  private startHeartbeat() {
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;
      this.send({ type: 'ping', ts: Date.now() });
    }, this.heartbeatIntervalMs);
    this.resetInactivityTimer();
  }

  private resetInactivityTimer() {
    if (!this.heartbeatIntervalMs) return;
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
    }
    const timeoutMs = this.heartbeatIntervalMs * HEARTBEAT_TIMEOUT_MULTIPLIER;
    this.inactivityTimer = setTimeout(() => {
      if (!this.websocket) return;
      const idleFor = Date.now() - this.lastMessageAt;
      if (idleFor >= timeoutMs && this.websocket.readyState === WebSocket.OPEN) {
        try {
          this.websocket.close(4000, 'heartbeat_timeout');
        } catch {
          // ignore
        }
      } else {
        this.resetInactivityTimer();
      }
    }, timeoutMs);
  }

  private clearHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private cleanupSocket(hard: boolean) {
    this.clearHeartbeat();
    if (this.websocket) {
      if (hard) {
        try {
          this.websocket.close();
        } catch {
          // ignore
        }
      }
      this.websocket = null;
    }
  }

  private send(payload: Record<string, unknown>) {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) return;
    try {
      this.websocket.send(JSON.stringify(payload));
    } catch {
      // ignore send errors
    }
  }

  private emit(event: RealtimeEvent) {
    const listeners = this.listeners[event.type] as Set<any>;
    listeners.forEach((listener) => listener(event));
  }
}

export const realtimeClient = new RealtimeClient();
