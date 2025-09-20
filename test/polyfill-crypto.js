const nodeCrypto = require('crypto');
const { webcrypto, randomFillSync } = nodeCrypto;

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto || {};
}

if (!globalThis.crypto.getRandomValues) {
  if (webcrypto && typeof webcrypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues = webcrypto.getRandomValues.bind(webcrypto);
  } else {
    globalThis.crypto.getRandomValues = (array) => randomFillSync(array);
  }
}

global.crypto = globalThis.crypto;

if (typeof nodeCrypto.getRandomValues !== 'function') {
  nodeCrypto.getRandomValues = (array) => globalThis.crypto.getRandomValues(array);
}
