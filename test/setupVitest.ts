import { webcrypto } from "crypto";
import { vi } from "vitest";

process.env.DEFAULT_EXCHANGE = 'binance';

declare global {
  // eslint-disable-next-line no-var
  var crypto: Crypto;
  // eslint-disable-next-line no-var
  var jest: {
    fn: typeof vi.fn;
    spyOn: typeof vi.spyOn;
    clearAllMocks: typeof vi.clearAllMocks;
    resetAllMocks: typeof vi.resetAllMocks;
    mock: typeof vi.mock;
    unmock: typeof vi.unmock;
    doMock: typeof vi.doMock;
    doUnmock: typeof vi.doUnmock;
  };
}

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as unknown as Crypto;
}

if (!(globalThis as any).jest) {
  (globalThis as any).jest = {
    fn: vi.fn,
    spyOn: vi.spyOn,
    clearAllMocks: vi.clearAllMocks,
    resetAllMocks: vi.resetAllMocks,
    mock: vi.mock,
    unmock: vi.unmock,
    doMock: vi.doMock,
    doUnmock: vi.doUnmock,
  };
}
