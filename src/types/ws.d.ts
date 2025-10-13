declare module 'ws' {
  import { EventEmitter } from 'events';
  import { IncomingMessage } from 'http';
  import { Duplex } from 'stream';

  export type RawData = string | Buffer | ArrayBuffer | Buffer[];

  export default class WebSocket extends EventEmitter {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;

    constructor(address: string, protocols?: string | string[], options?: Record<string, unknown>);
    readyState: number;

    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;
    ping(): void;

    on(event: 'open', listener: () => void): this;
    on(event: 'message', listener: (data: RawData) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    removeAllListeners(event?: string): this;
  }

  export interface WebSocketServerOptions {
    noServer?: boolean;
    server?: import('http').Server;
    path?: string;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options?: WebSocketServerOptions);
    handleUpgrade(
      request: IncomingMessage,
      socket: Duplex,
      head: Buffer,
      callback: (socket: WebSocket, request: IncomingMessage) => void
    ): void;
    on(event: 'connection', listener: (socket: WebSocket, request: IncomingMessage) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
  }
}
