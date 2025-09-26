#!/usr/bin/env ts-node

import { CONFIG } from '../config';
import { getPool, closePool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import { ClientApiCredentialsRepository, ClientsRepository } from '../db/clientsRepo';
import { ClientConfigService } from '../services/clientConfig';
import { initSecretManager } from '../secrets/secretManager';
import { logger } from '../utils/logger';
import {
  deleteClientCredentials,
  fetchClientSnapshot,
  fetchClients,
  listClientCredentials,
  mapCredentialRow,
  storeClientCredentials,
  upsertClientRecord,
} from './clientAdminActions';

type FlagMap = Record<string, string | boolean>;

function parseFlags(tokens: string[]): FlagMap {
  const flags: FlagMap = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith('--')) continue;
    const eqIdx = token.indexOf('=');
    if (eqIdx > -1) {
      const key = token.slice(2, eqIdx);
      const value = token.slice(eqIdx + 1);
      flags[key] = value;
    } else {
      const key = token.slice(2);
      const next = tokens[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function getOption(map: FlagMap, key: string) {
  const value = map[key];
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value;
}

function requireOption(map: FlagMap, key: string): string {
  const value = getOption(map, key);
  if (!value) {
    throw new Error(`Missing required option --${key}`);
  }
  return value;
}

function parseJsonOption(value: string | undefined, label: string) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (err) {
    throw new Error(`Failed to parse ${label} as JSON: ${(err as Error).message}`);
  }
}

function printUsage() {
  // eslint-disable-next-line no-console
  console.log(`Client Admin CLI

Usage: npm run client-admin -- <command> [options]

Commands:
  list-clients [--json]                       List all clients
  show-client --id <client_id> [--json]       Show a single client's details and credential summary
  upsert-client --id <client_id> --name <name> --owner <owner>
                [--plan <plan>] [--status <status>] [--contact '<json>'] [--limits '<json>']
                                              Create or update a client record
  list-credentials --id <client_id> [--json]  List credential metadata for a client (secrets are never printed)
  store-credentials --id <client_id> --exchange <exchange>
                    --api-key <key> --api-secret <secret> [--passphrase <pass>]
                                              Encrypt and store API credentials (also used for rotation)
  delete-credentials --id <client_id> --exchange <exchange>
                                              Remove stored credentials for the exchange

Environment:
  PG_URL, CLIENT_MASTER_KEY and other config values are read from .env / environment variables.
`);
}

async function listClients(flags: FlagMap, clientsRepo: ClientsRepository) {
  const clients = await fetchClients(clientsRepo);
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(clients, null, 2));
    return;
  }
  if (!clients.length) {
    // eslint-disable-next-line no-console
    console.log('No clients found.');
    return;
  }
  for (const client of clients) {
    // eslint-disable-next-line no-console
    console.log(
      `- ${client.id} | ${client.name} | owner=${client.owner} | plan=${client.plan} | status=${client.status} | created=${client.createdAt.toISOString()}`
    );
  }
}

async function showClient(flags: FlagMap, clientsRepo: ClientsRepository, credsRepo: ClientApiCredentialsRepository) {
  const clientId = requireOption(flags, 'id');
  const response = await fetchClientSnapshot(clientsRepo, credsRepo, clientId);
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(response, null, 2));
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`Client ${response.client.id}
  name:    ${response.client.name}
  owner:   ${response.client.owner}
  plan:    ${response.client.plan}
  status:  ${response.client.status}
  created: ${response.client.createdAt.toISOString()}
  contact: ${response.client.contactInfo ? JSON.stringify(response.client.contactInfo) : '(none)'}
  limits:  ${response.client.limits ? JSON.stringify(response.client.limits) : '(none)'}
`);
  if (!response.credentials.length) {
    // eslint-disable-next-line no-console
    console.log('Credentials: none stored');
  } else {
    // eslint-disable-next-line no-console
    console.log('Credentials:');
    for (const row of response.credentials) {
      // eslint-disable-next-line no-console
      console.log(
        `  - ${row.exchangeName} (stored ${row.createdAt.toISOString()}) passphrase=${row.hasPassphrase ? 'yes' : 'no'}`
      );
    }
  }
}

async function upsertClient(flags: FlagMap, clientsRepo: ClientsRepository) {
  const id = requireOption(flags, 'id');
  const name = requireOption(flags, 'name');
  const owner = requireOption(flags, 'owner');
  const plan = getOption(flags, 'plan') ?? undefined;
  const status = getOption(flags, 'status') ?? undefined;
  const contact = parseJsonOption(getOption(flags, 'contact'), 'contact');
  const limits = parseJsonOption(getOption(flags, 'limits'), 'limits');

  const record = await upsertClientRecord(clientsRepo, {
    id,
    name,
    owner,
    plan,
    status,
    contactInfo: contact ?? undefined,
    limits: limits ?? undefined,
  });
  // eslint-disable-next-line no-console
  console.log(
    `Client upserted: ${record.id} plan=${record.plan} status=${record.status} (created ${record.createdAt.toISOString()})`
  );
}

async function listCredentials(flags: FlagMap, credsRepo: ClientApiCredentialsRepository) {
  const id = requireOption(flags, 'id');
  const creds = await listClientCredentials(credsRepo, id);
  if (flags.json) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(creds, null, 2));
    return;
  }
  if (!creds.length) {
    // eslint-disable-next-line no-console
    console.log(`No credentials stored for client ${id}`);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`Credentials for ${id}:`);
  for (const row of creds) {
    // eslint-disable-next-line no-console
    console.log(`  - ${row.exchangeName} (stored ${row.createdAt.toISOString()}) passphrase=${row.hasPassphrase ? 'yes' : 'no'}`);
  }
}

async function storeCredentials(flags: FlagMap, service: ClientConfigService) {
  const clientId = requireOption(flags, 'id');
  const exchange = requireOption(flags, 'exchange');
  const apiKey = requireOption(flags, 'api-key');
  const apiSecret = requireOption(flags, 'api-secret');
  const passphrase = getOption(flags, 'passphrase') ?? null;

  await initSecretManager();
  const row = await storeClientCredentials(service, {
    clientId,
    exchangeName: exchange,
    apiKey,
    apiSecret,
    passphrase,
  });
  // eslint-disable-next-line no-console
  console.log(`Stored credentials for ${row.clientId} on ${row.exchangeName} (ts=${row.createdAt.toISOString()})`);
}

async function deleteCredentials(flags: FlagMap, credsRepo: ClientApiCredentialsRepository) {
  const clientId = requireOption(flags, 'id');
  const exchange = requireOption(flags, 'exchange');
  await deleteClientCredentials(credsRepo, clientId, exchange);
  // eslint-disable-next-line no-console
  console.log(`Deleted credentials for ${clientId} on ${exchange}`);
}

async function main() {
  const [, , rawCommand, ...rest] = process.argv;
  if (!rawCommand || rawCommand === '--help' || rawCommand === '-h') {
    printUsage();
    process.exit(0);
  }

  const command = rawCommand.trim();
  const flags = parseFlags(rest);

  const pool = getPool();
  try {
    await runMigrations(pool);
    const clientsRepo = new ClientsRepository(pool);
    const credsRepo = new ClientApiCredentialsRepository(pool);
    const clientService = new ClientConfigService(pool);

    switch (command) {
      case 'list-clients':
        await listClients(flags, clientsRepo);
        break;
      case 'show-client':
        await showClient(flags, clientsRepo, credsRepo);
        break;
      case 'upsert-client':
        await upsertClient(flags, clientsRepo);
        break;
      case 'list-credentials':
        await listCredentials(flags, credsRepo);
        break;
      case 'store-credentials':
        await storeCredentials(flags, clientService);
        break;
      case 'delete-credentials':
        await deleteCredentials(flags, credsRepo);
        break;
      default:
        printUsage();
        throw new Error(`Unknown command: ${command}`);
    }
  } finally {
    await closePool().catch((error) => {
      logger.warn('close_pool_failed', {
        event: 'close_pool_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
