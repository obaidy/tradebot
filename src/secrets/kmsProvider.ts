import { KMSClient, EncryptCommand, DecryptCommand, EncryptCommandInput, DecryptCommandInput } from '@aws-sdk/client-kms';
import { logger } from '../utils/logger';

const KMS_PAYLOAD_PREFIX = 'kms:v1:';

type KmsConfig = {
  keyId: string;
  region?: string;
  endpoint?: string;
  encryptionContext?: Record<string, string>;
};

export class KmsSecretManager {
  private readonly client: KMSClient;
  private readonly keyId: string;
  private readonly encryptionContext?: Record<string, string>;

  constructor(config: KmsConfig) {
    this.keyId = config.keyId;
    this.encryptionContext = config.encryptionContext;
    this.client = new KMSClient({
      region: config.region,
      endpoint: config.endpoint,
    });
  }

  async encrypt(plainText: string): Promise<string> {
    if (plainText === undefined || plainText === null) {
      throw new Error('KMS cannot encrypt empty payload');
    }
    const input: EncryptCommandInput = {
      KeyId: this.keyId,
      Plaintext: Buffer.from(String(plainText), 'utf8'),
      EncryptionContext: this.encryptionContext,
    };
    const response = await this.client.send(new EncryptCommand(input));
    if (!response.CiphertextBlob) {
      throw new Error('KMS encryption did not return ciphertext');
    }
    const cipherB64 = Buffer.from(response.CiphertextBlob).toString('base64');
    return `${KMS_PAYLOAD_PREFIX}${cipherB64}`;
  }

  async decrypt(payload: string): Promise<string> {
    const payloadB64 = payload.slice(KMS_PAYLOAD_PREFIX.length);
    const cipher = Buffer.from(payloadB64, 'base64');
    const input: DecryptCommandInput = {
      CiphertextBlob: cipher,
      EncryptionContext: this.encryptionContext,
    };
    const response = await this.client.send(new DecryptCommand(input));
    if (!response.Plaintext) {
      throw new Error('KMS decryption returned empty plaintext');
    }
    return Buffer.from(response.Plaintext).toString('utf8');
  }
}

export function isKmsPayload(payload: string | null | undefined): payload is string {
  if (!payload) return false;
  return payload.startsWith(KMS_PAYLOAD_PREFIX);
}

export function parseEncryptionContext(raw?: string): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).reduce<Record<string, string>>((acc, [key, value]) => {
        if (value !== undefined && value !== null) {
          acc[String(key)] = String(value);
        }
        return acc;
      }, {});
    }
    logger.warn('kms_context_invalid', {
      event: 'kms_context_invalid',
      raw,
    });
  } catch (error) {
    logger.warn('kms_context_parse_failed', {
      event: 'kms_context_parse_failed',
      raw,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return undefined;
}

export const KMS_PREFIX = KMS_PAYLOAD_PREFIX;
