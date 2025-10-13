declare module '@aws-sdk/client-kms' {
  export interface EncryptCommandInput {
    KeyId: string;
    Plaintext: Uint8Array | Buffer | string;
    EncryptionContext?: Record<string, string>;
  }

  export interface DecryptCommandInput {
    CiphertextBlob: Uint8Array | Buffer | string;
    EncryptionContext?: Record<string, string>;
  }

  export interface EncryptCommandOutput {
    CiphertextBlob?: Uint8Array;
  }

  export interface DecryptCommandOutput {
    Plaintext?: Uint8Array;
  }

  export class EncryptCommand {
    constructor(input: EncryptCommandInput);
  }

  export class DecryptCommand {
    constructor(input: DecryptCommandInput);
  }

  export class KMSClient {
    constructor(config: { region?: string; endpoint?: string });
    send(command: EncryptCommand | DecryptCommand): Promise<any>;
  }
}
