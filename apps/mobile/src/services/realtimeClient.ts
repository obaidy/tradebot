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

const MAX_RETRIES = 5;

export class RealtimeClient {
  private websocket: WebSocket | null = null;
  private accessToken: string | null = null;
  private reconnectAttempts = 0;
  private listeners: ListenerMap = {
    connected: new Set(),
    disconnected: new Set(),
    'dashboard.update': new Set(),
    'activity.append': new Set(),
  };

  connect(accessToken: string) {
    this.accessToken = accessToken;
    this.reconnectAttempts = 0;
    this.openSocket();
  }

  disconnect() {
    this.reconnectAttempts = 0;
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
  }

  on<T extends RealtimeEvent>(event: T['type'], listener: Listener<T>): () => void {
    const listeners = this.listeners[event] as Set<Listener<T>>;
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  private openSocket() {
    if (!this.accessToken) return;
    const url = `${WS_BASE_URL}?token=${encodeURIComponent(this.accessToken)}`;
    const ws = new WebSocket(url);
    this.websocket = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.emit({ type: 'connected' });
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as RealtimeEvent;
        this.emit(payload);
      } catch (err) {
        console.warn('realtime_parse_error', err);
      }
    };

    ws.onclose = (event) => {
      this.emit({ type: 'disconnected', reason: event.reason });
      if (this.reconnectAttempts >= MAX_RETRIES) {
        return;
      }
      const backoffMs = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
      this.reconnectAttempts += 1;
      setTimeout(() => this.openSocket(), backoffMs);
    };

    ws.onerror = () => {
      // errors handled by close handler
    };
  }

  private emit(event: RealtimeEvent) {
    const listeners = this.listeners[event.type] as Set<any>;
    listeners.forEach((listener) => listener(event));
  }
}

export const realtimeClient = new RealtimeClient();
