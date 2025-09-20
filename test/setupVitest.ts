import { webcrypto } from "crypto";

declare global {
  // eslint-disable-next-line no-var
  var crypto: Crypto;
}

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto as unknown as Crypto;
}
