declare module 'ws' {
  export type RawData = string | Buffer | ArrayBuffer | Buffer[];

  export default class WebSocket {
    static readonly CONNECTING: number;
    static readonly OPEN: number;
    static readonly CLOSING: number;
    static readonly CLOSED: number;

    constructor(address: string, protocols?: string | string[], options?: Record<string, unknown>);
    readyState: number;

    send(data: string | Buffer): void;
    close(code?: number): void;
    ping(): void;

    on(event: 'open', listener: () => void): this;
    on(event: 'message', listener: (data: RawData) => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: 'close', listener: (code: number, reason: Buffer) => void): this;
    removeAllListeners(event?: string): this;
  }
}
