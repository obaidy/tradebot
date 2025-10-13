import crypto from 'crypto';
import sodium from 'libsodium-wrappers';
import { KmsSecretManager, isKmsPayload, parseEncryptionContext } from './kmsProvider';

let sodiumReady: Promise<void> | null = null;
let secretKey: Uint8Array | null = null;
let keySourceFingerprint: string | null = null;
let kmsManager: KmsSecretManager | null = null;

function ensureSodium() {
  if (!sodiumReady) {
    sodiumReady = sodium.ready;
  }
  return sodiumReady;
}

function deriveKey(rawKey: string): Uint8Array {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    throw new Error('Secret manager master key is empty');
  }

  try {
    const asBase64 = Buffer.from(trimmed, 'base64');
    if (asBase64.length === sodium.crypto_secretbox_KEYBYTES) {
      return new Uint8Array(asBase64);
    }
  } catch {
    // ignore invalid base64
  }

  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === sodium.crypto_secretbox_KEYBYTES * 2) {
    return new Uint8Array(Buffer.from(trimmed, 'hex'));
  }

  const hash = crypto.createHash('sha256');
  hash.update(trimmed);
  return new Uint8Array(hash.digest().subarray(0, sodium.crypto_secretbox_KEYBYTES));
}

function getKeyFingerprint(rawKey: string) {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export async function initSecretManager(rawMasterKey?: string) {
  if (!kmsManager && process.env.KMS_KEY_ID) {
    kmsManager = new KmsSecretManager({
      keyId: process.env.KMS_KEY_ID,
      region: process.env.KMS_REGION,
      endpoint: process.env.KMS_ENDPOINT,
      encryptionContext: parseEncryptionContext(process.env.KMS_ENCRYPTION_CONTEXT),
    });
  }

  const providedKey = rawMasterKey ?? process.env.CLIENT_MASTER_KEY ?? process.env.MASTER_KEY;
  if (providedKey) {
    await ensureSodium();
    const fingerprint = getKeyFingerprint(providedKey);
    if (!secretKey || keySourceFingerprint !== fingerprint) {
      secretKey = deriveKey(providedKey);
      keySourceFingerprint = fingerprint;
    }
  } else if (!kmsManager) {
    throw new Error('CLIENT_MASTER_KEY or KMS_KEY_ID env var is required to load client secrets');
  }
}

function requireKey() {
  if (!secretKey) {
    throw new Error('Secret manager not initialized. Call initSecretManager() first.');
  }
  return secretKey;
}

export async function encryptSecret(plainText: string): Promise<string> {
  if (plainText === undefined || plainText === null) {
    throw new Error('Cannot encrypt empty secret');
  }
  if (kmsManager) {
    return kmsManager.encrypt(plainText);
  }
  await ensureSodium();
  const key = requireKey();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const message = Buffer.from(String(plainText), 'utf8');
  const cipher = sodium.crypto_secretbox_easy(message, nonce, key);
  const nonceB64 = Buffer.from(nonce).toString('base64');
  const cipherB64 = Buffer.from(cipher).toString('base64');
  return `${nonceB64}:${cipherB64}`;
}

export async function decryptSecret(payload: string | null | undefined): Promise<string> {
  if (!payload) {
    throw new Error('No secret payload provided');
  }
  if (isKmsPayload(payload)) {
    if (!kmsManager) {
      throw new Error('KMS payload encountered but KMS is not configured');
    }
    return kmsManager.decrypt(payload);
  }
  await ensureSodium();
  const key = requireKey();
  const rawPayload = payload as string;
  const parts = rawPayload.split(':');
  if (parts.length !== 2) {
    throw new Error('Malformed secret payload');
  }
  const nonce = Buffer.from(parts[0], 'base64');
  const cipher = Buffer.from(parts[1], 'base64');
  const result = sodium.crypto_secretbox_open_easy(cipher, nonce, key);
  if (!result) {
    throw new Error('Unable to decrypt payload with provided master key');
  }
  return Buffer.from(result).toString('utf8');
}

export function isSecretManagerReady() {
  return secretKey !== null;
}
