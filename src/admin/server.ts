import http, { IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { getPool, closePool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import { ClientsRepository, ClientApiCredentialsRepository } from '../db/clientsRepo';
import { ClientConfigService } from '../services/clientConfig';
import { initSecretManager } from '../secrets/secretManager';
import {
  deleteClientCredentials,
  fetchClientSnapshot,
  fetchClients,
  listClientCredentials,
  storeClientCredentials,
  upsertClientRecord,
} from './clientAdminActions';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: Method;
  pathname: string;
  body?: any;
  query: URLSearchParams;
}

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || '';

function unauthorized(res: ServerResponse) {
  res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

async function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req
      .on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      })
      .on('end', () => {
        if (!chunks.length) {
          resolve(undefined);
          return;
        }
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve(text ? JSON.parse(text) : undefined);
        } catch (err) {
          reject(err);
        }
      })
      .on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function notFound(res: ServerResponse) {
  sendJson(res, 404, { error: 'not_found' });
}

function methodNotAllowed(res: ServerResponse) {
  sendJson(res, 405, { error: 'method_not_allowed' });
}

async function createContext(req: IncomingMessage, res: ServerResponse): Promise<RequestContext> {
  const parsedUrl = parse(req.url ?? '/', false);
  const pathname = parsedUrl.pathname ?? '/';
  const searchParams = new URLSearchParams(parsedUrl.query ?? '');
  const methodRaw = (req.method ?? 'GET').toUpperCase();
  const allowedMethods: Method[] = ['GET', 'POST', 'PUT', 'DELETE'];
  const method = allowedMethods.includes(methodRaw as Method) ? (methodRaw as Method) : 'GET';
  const ctx: RequestContext = {
    req,
    res,
    method,
    pathname,
    query: searchParams,
  };
  if (['POST', 'PUT'].includes(method)) {
    ctx.body = await readBody(req).catch((err) => {
      sendJson(res, 400, { error: 'invalid_json', details: err instanceof Error ? err.message : String(err) });
      return undefined;
    });
  }
  return ctx;
}

async function withErrorHandling(handler: () => Promise<void>, res: ServerResponse) {
  try {
    await handler();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 400, { error: message });
  }
}

export async function startAdminServer(port = Number(process.env.ADMIN_PORT || 9300)) {
  const pool = getPool();
  await runMigrations(pool);
  const clientsRepo = new ClientsRepository(pool);
  const credsRepo = new ClientApiCredentialsRepository(pool);
  const configService = new ClientConfigService(pool);

  const server = http.createServer(async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!ADMIN_TOKEN || authHeader !== `Bearer ${ADMIN_TOKEN}`) {
      unauthorized(res);
      return;
    }

    const ctx = await createContext(req, res);
    if (res.writableEnded) return;

    await withErrorHandling(async () => {
      if (ctx.pathname === '/health' && ctx.method === 'GET') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      if (ctx.pathname === '/clients' && ctx.method === 'GET') {
        const clients = await fetchClients(clientsRepo);
        sendJson(res, 200, clients);
        return;
      }

      const clientMatch = ctx.pathname.match(/^\/clients\/([^/]+)$/);
      if (clientMatch) {
        const clientId = decodeURIComponent(clientMatch[1]);
        if (ctx.method === 'GET') {
          const snapshot = await fetchClientSnapshot(clientsRepo, credsRepo, clientId);
          sendJson(res, 200, snapshot);
          return;
        }
        if (ctx.method === 'PUT') {
          const body = ctx.body ?? {};
          const record = await upsertClientRecord(clientsRepo, {
            id: clientId,
            name: body.name,
            owner: body.owner,
            plan: body.plan,
            status: body.status,
            contactInfo: body.contact ?? null,
            limits: body.limits ?? null,
          });
          sendJson(res, 200, record);
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const credsListMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/credentials$/);
      if (credsListMatch) {
        const clientId = decodeURIComponent(credsListMatch[1]);
        if (ctx.method === 'GET') {
          const creds = await listClientCredentials(credsRepo, clientId);
          sendJson(res, 200, creds);
          return;
        }
        if (ctx.method === 'POST') {
          const body = ctx.body ?? {};
          await initSecretManager();
          const stored = await storeClientCredentials(configService, {
            clientId,
            exchangeName: body.exchangeName || body.exchange,
            apiKey: body.apiKey,
            apiSecret: body.apiSecret,
            passphrase: body.passphrase ?? null,
          });
          sendJson(res, 201, stored);
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const credsDeleteMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/credentials\/([^/]+)$/);
      if (credsDeleteMatch) {
        const clientId = decodeURIComponent(credsDeleteMatch[1]);
        const exchangeName = decodeURIComponent(credsDeleteMatch[2]);
        if (ctx.method === 'DELETE') {
          await deleteClientCredentials(credsRepo, clientId, exchangeName);
          sendJson(res, 204, {});
          return;
        }
        methodNotAllowed(res);
        return;
      }

      notFound(res);
    }, res);
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Admin server listening on :${port}`);
  });

  const shutdown = async () => {
    await closePool().catch(() => {});
    server.close();
  };

  return { server, shutdown };
}

if (require.main === module) {
  startAdminServer().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
