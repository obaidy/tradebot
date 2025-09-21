import http, { IncomingMessage, ServerResponse } from 'http';
import { parse } from 'url';
import { promises as fs } from 'fs';
import path from 'path';
import { CONFIG as APP_CONFIG } from '../config';
import { getPool, closePool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import { ClientsRepository, ClientApiCredentialsRepository } from '../db/clientsRepo';
import { ClientConfigService } from '../services/clientConfig';
import { initSecretManager } from '../secrets/secretManager';
import { ClientAuditLogRepository } from '../db/auditLogRepo';
import { PLAN_DEFINITIONS, buildPlanLimits, getPlanById } from '../config/plans';
import {
  deleteClientCredentials,
  fetchClientSnapshot,
  fetchClients,
  listClientCredentials,
  storeClientCredentials,
  upsertClientRecord,
} from './clientAdminActions';
import { enqueuePaperRun, isPaperRunQueueEnabled } from '../jobs/paperRunQueue';
import { enqueueClientTask, isClientTaskQueueEnabled } from '../jobs/clientTaskQueue';
import { ClientWorkersRepository } from '../db/clientWorkersRepo';
import {
  createCheckoutSession,
  handleStripeWebhook,
  verifyStripeSignature,
} from '../services/billing/stripeService';
import { logger } from '../utils/logger';
import { ClientAgreementsRepository } from '../db/clientAgreementsRepo';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  method: Method;
  pathname: string;
  body?: any;
  rawBody?: string | null;
  query: URLSearchParams;
}

const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN || '';

function unauthorized(res: ServerResponse) {
  res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

async function readBody(req: IncomingMessage): Promise<{ raw: string; parsed: any } | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req
      .on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      })
      .on('end', () => {
        if (!chunks.length) {
          resolve({ raw: '', parsed: undefined });
          return;
        }
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          const parsed = raw ? JSON.parse(raw) : undefined;
          resolve({ raw, parsed });
        } catch (err) {
          reject({ error: err, raw });
        }
      })
      .on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function getHeader(req: IncomingMessage, name: string) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value ?? null;
}

function resolveActor(req: IncomingMessage) {
  return getHeader(req, 'x-actor') || 'unknown-actor';
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
    const result = await readBody(req).catch((rawErr) => {
      const err = rawErr?.error ?? rawErr;
      sendJson(res, 400, {
        error: 'invalid_json',
        details: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
    if (result === null) {
      return ctx;
    }
    ctx.body = result?.parsed;
    ctx.rawBody = result?.raw ?? null;
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
  const auditRepo = new ClientAuditLogRepository(pool);
  const workersRepo = new ClientWorkersRepository(pool);
  const agreementsRepo = new ClientAgreementsRepository(pool);

  const REQUIRED_DOCUMENTS = [
    { documentType: 'tos', name: 'Terms of Service', version: APP_CONFIG.LEGAL.TOS_VERSION, file: 'terms' },
    { documentType: 'privacy', name: 'Privacy Policy', version: APP_CONFIG.LEGAL.PRIVACY_VERSION, file: 'privacy' },
    { documentType: 'risk', name: 'Risk Disclosure', version: APP_CONFIG.LEGAL.RISK_VERSION, file: 'risk' },
  ];

  async function readLegalDocument(slug: string) {
    const candidates = [
      path.resolve(process.cwd(), 'legal', `${slug}.md`),
      path.resolve(process.cwd(), '..', 'legal', `${slug}.md`),
      path.resolve(process.cwd(), '..', '..', 'legal', `${slug}.md`),
    ];
    for (const candidate of candidates) {
      try {
        return await fs.readFile(candidate, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }
    throw new Error('legal_document_not_found');
  }

  const server = http.createServer(async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!ADMIN_TOKEN || authHeader !== `Bearer ${ADMIN_TOKEN}`) {
      unauthorized(res);
      return;
    }

    const ctx = await createContext(req, res);
    if (res.writableEnded) return;

    await withErrorHandling(async () => {
      const legalMatch = ctx.pathname.match(/^\/legal\/([^/]+)$/);
      if (legalMatch && ctx.method === 'GET') {
        const slug = decodeURIComponent(legalMatch[1]);
        const docDef = REQUIRED_DOCUMENTS.find((doc) => doc.file === slug);
        try {
          const content = await readLegalDocument(slug);
          sendJson(res, 200, {
            document: slug,
            name: docDef?.name ?? slug,
            version: docDef?.version ?? null,
            content,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 404, { error: message });
        }
        return;
      }

      if (ctx.pathname === '/health' && ctx.method === 'GET') {
        sendJson(res, 200, { status: 'ok' });
        return;
      }

      if (ctx.pathname === '/plans' && ctx.method === 'GET') {
        sendJson(res, 200, PLAN_DEFINITIONS);
        return;
      }

      if (ctx.pathname === '/billing/session' && ctx.method === 'POST') {
        if (!process.env.STRIPE_SECRET_KEY) {
          throw new Error('stripe_not_configured');
        }
        const body = ctx.body ?? {};
        const clientId = body.clientId ?? body.client_id;
        const planId = body.planId ?? body.plan_id;
        const successUrl = body.successUrl ?? body.success_url;
        const cancelUrl = body.cancelUrl ?? body.cancel_url;
        const trialDays = body.trialDays ?? body.trial_days;
        if (!clientId || !planId || !successUrl || !cancelUrl) {
          throw new Error('missing_parameters');
        }
        const session = await createCheckoutSession({
          clientId,
          planId,
          successUrl,
          cancelUrl,
          trialDays: typeof trialDays === 'number' ? trialDays : undefined,
        });
        sendJson(res, 200, { id: session.id, url: session.url });
        return;
      }

      if (ctx.pathname === '/billing/status' && ctx.method === 'GET') {
        const clients = await clientsRepo.listAll();
        const payload = clients.map((client) => ({
          id: client.id,
          plan: client.plan,
          status: client.billingStatus,
          trialEndsAt: client.trialEndsAt,
          autoPaused: client.billingAutoPaused,
          isPaused: client.isPaused,
          killRequested: client.killRequested,
        }));
        sendJson(res, 200, payload);
        return;
      }

      if (ctx.pathname === '/metrics/summary' && ctx.method === 'GET') {
        const clients = await clientsRepo.listAll();
        const guardRes = await pool.query(
          'SELECT client_id, global_pnl, run_pnl FROM bot_guard_state'
        );
        const workers = await pool.query(
          `SELECT client_id, status, COUNT(*)::int AS count
           FROM client_workers
           GROUP BY client_id, status`
        );
        const runs = await pool.query(
          `SELECT client_id, COUNT(*)::int AS runs, MAX(started_at) AS last_started
           FROM bot_runs
           GROUP BY client_id`
        );
        const guardMap = new Map<string, { global_pnl: number; run_pnl: number }>();
        guardRes.rows.forEach((row) => {
          guardMap.set(row.client_id, {
            global_pnl: Number(row.global_pnl || 0),
            run_pnl: Number(row.run_pnl || 0),
          });
        });
        const workerMap = new Map<string, Record<string, number>>();
        workers.rows.forEach((row) => {
          const map = workerMap.get(row.client_id) ?? {};
          map[row.status] = Number(row.count || 0);
          workerMap.set(row.client_id, map);
        });
        const runMap = new Map<string, { runs: number; last_started: string | null }>();
        runs.rows.forEach((row) => {
          runMap.set(row.client_id, {
            runs: Number(row.runs || 0),
            last_started: row.last_started ? new Date(row.last_started).toISOString() : null,
          });
        });
        const summary = clients.map((client) => ({
          id: client.id,
          plan: client.plan,
          billingStatus: client.billingStatus,
          autoPaused: client.billingAutoPaused,
          isPaused: client.isPaused,
          guard: guardMap.get(client.id) ?? { global_pnl: 0, run_pnl: 0 },
          workers: workerMap.get(client.id) ?? {},
          runs: runMap.get(client.id) ?? { runs: 0, last_started: null },
        }));
        sendJson(res, 200, {
          totalClients: clients.length,
          pausedClients: summary.filter((c) => c.isPaused).length,
          billingIssues: summary.filter((c) => c.billingStatus !== 'active').length,
          data: summary,
        });
        return;
      }

      if (ctx.pathname === '/billing/webhook' && ctx.method === 'POST') {
        try {
          const signature = getHeader(ctx.req, 'stripe-signature');
          if (!signature) {
            throw new Error('missing_signature');
          }
          if (!ctx.rawBody) {
            throw new Error('missing_raw_body');
          }
          const event = verifyStripeSignature(ctx.rawBody, signature);
          await handleStripeWebhook(event, clientsRepo);
          sendJson(res, 200, { received: true });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error('stripe_webhook_error', { event: 'stripe_webhook_error', error: message });
          sendJson(res, 400, { error: message });
        }
        return;
      }

      if (ctx.pathname === '/clients' && ctx.method === 'POST') {
        const body = ctx.body ?? {};
        const plan = body.plan ?? 'starter';
        const planDef = getPlanById(plan);
        if (!planDef) {
          throw new Error(`Unknown plan: ${plan}`);
        }
        const existing = body.id ? await clientsRepo.findById(body.id) : null;
        const defaultTrialEnds = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        const defaultLimits = buildPlanLimits(planDef);
        const record = await upsertClientRecord(clientsRepo, {
          id: body.id,
          name: body.name ?? body.id,
          owner: body.owner ?? body.id ?? 'unknown-owner',
          plan,
          status: body.status ?? 'active',
          contactInfo: body.contact ?? null,
          limits: body.limits ?? defaultLimits,
          billingStatus: existing?.billingStatus ?? 'trialing',
          trialEndsAt: existing?.trialEndsAt ?? defaultTrialEnds,
        });
        await auditRepo.addEntry({
          clientId: record.id,
          actor: resolveActor(ctx.req),
          action: 'client_upsert',
          metadata: {
            plan,
            status: record.status,
          },
        });
        sendJson(res, 200, record);
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
          const planDef = body.plan ? getPlanById(body.plan) : null;
          const defaultLimits = planDef ? buildPlanLimits(planDef) : null;
          const record = await upsertClientRecord(clientsRepo, {
            id: clientId,
            name: body.name ?? clientId,
            owner: body.owner ?? clientId,
            plan: body.plan,
            status: body.status,
            contactInfo: body.contact ?? null,
            limits:
              body.limits ??
              defaultLimits,
          });
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'client_update',
            metadata: {
              plan: body.plan,
              status: body.status,
            },
          });
          sendJson(res, 200, record);
          return;
      }
      methodNotAllowed(res);
      return;
    }

      const agreementsMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/agreements$/);
      if (agreementsMatch) {
        const clientId = decodeURIComponent(agreementsMatch[1]);
        if (ctx.method === 'GET') {
          const agreements = await agreementsRepo.listByClient(clientId);
          const requirements = REQUIRED_DOCUMENTS.map((doc) => {
            const match = agreements.find(
              (ack) => ack.documentType === doc.documentType && ack.version === doc.version
            );
            return {
              documentType: doc.documentType,
              version: doc.version,
              name: doc.name,
              accepted: Boolean(match),
              acceptedAt: match ? match.acceptedAt.toISOString() : null,
            };
          });
          sendJson(res, 200, { agreements, requirements });
          return;
        }
        if (ctx.method === 'POST') {
          const documents: Array<{ documentType: string; version: string }> = Array.isArray(ctx.body?.documents)
            ? ctx.body.documents
            : [];
          if (!documents.length) {
            throw new Error('documents_required');
          }
          const ipHeader = getHeader(ctx.req, 'x-forwarded-for');
          const bodyIp = typeof ctx.body?.ipAddress === 'string' ? ctx.body.ipAddress : null;
          const ipAddress = bodyIp || (ipHeader ? ipHeader.split(',')[0].trim() : ctx.req.socket.remoteAddress ?? null);
          const acknowledgements = [];
          for (const doc of documents) {
            const required = REQUIRED_DOCUMENTS.find((d) => d.documentType === doc.documentType);
            if (!required) {
              throw new Error(`unknown_document:${doc.documentType}`);
            }
            if (doc.version !== required.version) {
              throw new Error(`invalid_version:${doc.documentType}`);
            }
            const record = await agreementsRepo.recordAcceptance({
              clientId,
              documentType: doc.documentType,
              version: doc.version,
              ipAddress,
            });
            acknowledgements.push(record);
            await auditRepo.addEntry({
              clientId,
              actor: resolveActor(ctx.req),
              action: `agreement_${doc.documentType}_accepted`,
              metadata: {
                version: doc.version,
                ipAddress,
              },
            });
          }
          sendJson(res, 200, {
            acknowledgements: acknowledgements.map((ack) => ({
              documentType: ack.documentType,
              version: ack.version,
              acceptedAt: ack.acceptedAt.toISOString(),
            })),
          });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const historyMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/history$/);
      if (historyMatch) {
        const clientId = decodeURIComponent(historyMatch[1]);
        if (ctx.method === 'GET') {
          const runs = await pool.query(
            `SELECT run_id, status, params_json, started_at, ended_at
             FROM bot_runs
             WHERE client_id = $1
             ORDER BY started_at DESC
             LIMIT 50`,
            [clientId]
          );
          const guard = await pool.query(
            'SELECT global_pnl, run_pnl, inventory_base, inventory_cost, last_ticker_ts, api_error_timestamps FROM bot_guard_state WHERE client_id = $1',
            [clientId]
          );
          const snapshots = await pool.query(
            `SELECT snapshot_time, base_asset, quote_asset, base_balance, quote_balance, exposure_usd, metadata
             FROM bot_inventory_snapshots
             WHERE client_id = $1
             ORDER BY snapshot_time DESC
             LIMIT 50`,
            [clientId]
          );
          const runSeries = runs.rows.map((row) => {
            const params = (row.params_json ?? {}) as Record<string, any>;
            const summary = params.summary ?? params.plan?.summary ?? null;
            const estNetProfitRaw =
              summary?.estNetProfit ?? summary?.raw?.estNetProfit ?? params.summary?.raw?.estNetProfit ?? null;
            return {
              runId: row.run_id,
              status: row.status,
              startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
              endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
              runMode: params.runMode ?? params.run_mode ?? params.metadata?.runMode ?? 'unknown',
              estNetProfit: estNetProfitRaw !== null ? Number(estNetProfitRaw) : null,
              perTradeUsd: params.perTradeUsd ?? params.summary?.perTradeUsd ?? null,
            };
          });
          const guardState = guard.rows[0]
            ? {
                globalPnl: Number(guard.rows[0].global_pnl || 0),
                runPnl: Number(guard.rows[0].run_pnl || 0),
                inventoryBase: Number(guard.rows[0].inventory_base || 0),
                inventoryCost: Number(guard.rows[0].inventory_cost || 0),
                lastTickerTs: guard.rows[0].last_ticker_ts ? Number(guard.rows[0].last_ticker_ts) : null,
                apiErrorsLastMinute: Array.isArray(guard.rows[0].api_error_timestamps)
                  ? guard.rows[0].api_error_timestamps.length
                  : 0,
              }
            : null;
          const inventorySeries = snapshots.rows.map((row) => ({
            snapshotTime: row.snapshot_time ? new Date(row.snapshot_time).toISOString() : null,
            baseAsset: row.base_asset,
            quoteAsset: row.quote_asset,
            baseBalance: Number(row.base_balance || 0),
            quoteBalance: Number(row.quote_balance || 0),
            exposureUsd: row.exposure_usd !== null ? Number(row.exposure_usd) : null,
            metadata: row.metadata ?? null,
          }));
          sendJson(res, 200, {
            clientId,
            runs: runSeries,
            guard: guardState,
            inventory: inventorySeries,
          });
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
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'credentials_rotated',
            metadata: {
              exchange: stored.exchangeName,
              hasPassphrase: stored.hasPassphrase,
            },
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
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'credentials_deleted',
            metadata: {
              exchange: exchangeName,
            },
          });
          sendJson(res, 204, {});
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const auditMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/audit$/);
      if (auditMatch) {
        const clientId = decodeURIComponent(auditMatch[1]);
        if (ctx.method === 'GET') {
          const entries = await auditRepo.getRecent(clientId, Number(ctx.query.get('limit') ?? '20'));
          sendJson(res, 200, entries);
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const paperRunMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/paper-run$/);
      if (paperRunMatch) {
        const clientId = decodeURIComponent(paperRunMatch[1]);
        if (ctx.method === 'POST') {
          const actor = resolveActor(ctx.req);
          await auditRepo.addEntry({
            clientId,
            actor,
            action: 'paper_run_requested',
            metadata: ctx.body ?? null,
          });
          if (!isPaperRunQueueEnabled) {
            throw new Error('paper_run_queue_disabled');
          }
          const body = ctx.body ?? {};
          await enqueuePaperRun({
            clientId,
            pair: body.pair,
            actor,
          });
          sendJson(res, 202, { status: 'queued' });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const pauseMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/pause$/);
      if (pauseMatch) {
        const clientId = decodeURIComponent(pauseMatch[1]);
        if (ctx.method === 'POST') {
          await clientsRepo.setPauseState(clientId, true);
          if (isClientTaskQueueEnabled) {
            await enqueueClientTask({ type: 'pause', clientId });
          }
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'client_paused',
            metadata: null,
          });
          sendJson(res, 200, { status: 'paused' });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const resumeMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/resume$/);
      if (resumeMatch) {
        const clientId = decodeURIComponent(resumeMatch[1]);
        if (ctx.method === 'POST') {
          await clientsRepo.setPauseState(clientId, false);
          if (isClientTaskQueueEnabled) {
            await enqueueClientTask({ type: 'resume', clientId });
          }
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'client_resumed',
            metadata: null,
          });
          sendJson(res, 200, { status: 'running' });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const killMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/kill$/);
      if (killMatch) {
        const clientId = decodeURIComponent(killMatch[1]);
        if (ctx.method === 'POST') {
          await clientsRepo.setKillRequest(clientId, true);
          if (isClientTaskQueueEnabled) {
            await enqueueClientTask({ type: 'shutdown', clientId });
          }
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'client_kill_requested',
            metadata: null,
          });
          sendJson(res, 200, { status: 'kill_requested' });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const workersMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/workers$/);
      if (workersMatch) {
        const clientId = decodeURIComponent(workersMatch[1]);
        if (ctx.method === 'GET') {
          const workers = await workersRepo.findByClient(clientId);
          sendJson(res, 200, workers);
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const runMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/run$/);
      if (runMatch) {
        const clientId = decodeURIComponent(runMatch[1]);
        if (ctx.method === 'POST') {
          if (!isClientTaskQueueEnabled) {
            throw new Error('client_task_queue_disabled');
          }
          const body = ctx.body ?? {};
          await enqueueClientTask({
            type: 'run_grid',
            clientId,
            data: {
              pair: body.pair,
              runMode: body.runMode,
              actor: resolveActor(ctx.req),
            },
          });
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'client_run_requested',
            metadata: body ?? null,
          });
          sendJson(res, 202, { status: 'queued' });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const metricsMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/metrics$/);
      if (metricsMatch) {
        const clientId = decodeURIComponent(metricsMatch[1]);
        if (ctx.method === 'GET') {
          const guardRes = await pool.query(
            'SELECT global_pnl, run_pnl, inventory_base, inventory_cost, last_ticker_ts FROM bot_guard_state WHERE client_id = $1',
            [clientId]
          );
          if (!guardRes.rows.length) {
            sendJson(res, 404, { error: 'client_metrics_not_found' });
            return;
          }
          const row = guardRes.rows[0];
          sendJson(res, 200, {
            clientId,
            pnl: {
              global: Number(row.global_pnl || 0),
              run: Number(row.run_pnl || 0),
            },
            inventory: {
              base: Number(row.inventory_base || 0),
              cost: Number(row.inventory_cost || 0),
            },
            lastTickerTs: row.last_ticker_ts ? Number(row.last_ticker_ts) : null,
          });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const metricsStreamMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/metrics\/stream$/);
      if (metricsStreamMatch) {
        const clientId = decodeURIComponent(metricsStreamMatch[1]);
        if (ctx.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          });
          res.write('\n');

          const sendSnapshot = async () => {
            const guardRes = await pool.query(
              'SELECT global_pnl, run_pnl, inventory_base, inventory_cost, last_ticker_ts FROM bot_guard_state WHERE client_id = $1',
              [clientId]
            );
            if (!guardRes.rows.length) {
              res.write(`event: error\ndata: ${JSON.stringify({ error: 'client_metrics_not_found' })}\n\n`);
              return;
            }
            const row = guardRes.rows[0];
            const payload = {
              clientId,
              pnl: {
                global: Number(row.global_pnl || 0),
                run: Number(row.run_pnl || 0),
              },
              inventory: {
                base: Number(row.inventory_base || 0),
                cost: Number(row.inventory_cost || 0),
              },
              lastTickerTs: row.last_ticker_ts ? Number(row.last_ticker_ts) : null,
              timestamp: Date.now(),
            };
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
          };

          const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
          }, 15000);

          const interval = setInterval(() => {
            sendSnapshot().catch((err) => {
              res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
            });
          }, 5000);

          req.on('close', () => {
            clearInterval(interval);
            clearInterval(heartbeat);
            res.end();
          });

          await sendSnapshot();
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
