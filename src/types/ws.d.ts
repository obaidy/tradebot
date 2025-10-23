declare module 'ws' {
  import type { EventEmitter } from 'events';

  export type RawData = Buffer | ArrayBuffer | Buffer[] | string;

  export default class WebSocket extends EventEmitter {
    constructor(address: string, options?: Record<string, unknown>);
    readyState: number;
    send(data: RawData, cb?: (err?: Error) => void): void;
    close(code?: number, data?: RawData): void;
  }
}
