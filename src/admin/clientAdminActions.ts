import {
  ClientsRepository,
  ClientApiCredentialsRepository,
  ClientRow,
  ClientApiCredentialRow,
  ClientUpsertInput,
} from '../db/clientsRepo';
import { ClientConfigService } from '../services/clientConfig';

export type UpsertClientInput = ClientUpsertInput;

export interface StoredCredentialSummary {
  clientId: string;
  exchangeName: string;
  createdAt: Date;
  hasPassphrase: boolean;
}

export function mapCredentialRow(row: ClientApiCredentialRow): StoredCredentialSummary {
  return {
    clientId: row.clientId,
    exchangeName: row.exchangeName,
    createdAt: row.createdAt,
    hasPassphrase: Boolean(row.passphraseEnc),
  };
}

export async function fetchClients(clientsRepo: ClientsRepository): Promise<ClientRow[]> {
  return clientsRepo.listAll();
}

export async function fetchClientSnapshot(
  clientsRepo: ClientsRepository,
  credsRepo: ClientApiCredentialsRepository,
  clientId: string
) {
  const client = await clientsRepo.findById(clientId);
  if (!client) {
    throw new Error(`Client ${clientId} not found`);
  }
  const credentials = await credsRepo.listByClient(clientId);
  return {
    client,
    credentials: credentials.map(mapCredentialRow),
  };
}

export async function upsertClientRecord(
  clientsRepo: ClientsRepository,
  input: UpsertClientInput
): Promise<ClientRow> {
  return clientsRepo.upsert(input);
}

export async function listClientCredentials(
  credsRepo: ClientApiCredentialsRepository,
  clientId: string
): Promise<StoredCredentialSummary[]> {
  const rows = await credsRepo.listByClient(clientId);
  return rows.map(mapCredentialRow);
}

export async function storeClientCredentials(
  configService: ClientConfigService,
  input: {
    clientId: string;
    exchangeName: string;
    apiKey: string;
    apiSecret: string;
    passphrase?: string | null;
  }
): Promise<StoredCredentialSummary> {
  const row = await configService.storeExchangeCredentials({
    clientId: input.clientId,
    exchangeName: input.exchangeName,
    apiKey: input.apiKey,
    apiSecret: input.apiSecret,
    passphrase: input.passphrase ?? null,
  });
  return mapCredentialRow(row);
}

export async function deleteClientCredentials(
  credsRepo: ClientApiCredentialsRepository,
  clientId: string,
  exchangeName: string
) {
  await credsRepo.delete(clientId, exchangeName);
}
