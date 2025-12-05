import http, { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { parse } from 'url';
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG as APP_CONFIG } from '../config';
import { getPool, closePool } from '../db/pool';
import { runMigrations } from '../db/migrations';
import {
  ClientsRepository,
  ClientApiCredentialsRepository,
  ClientStrategySecretsRepository,
} from '../db/clientsRepo';
import { ClientStrategyAllocationsRepository } from '../db/clientStrategyAllocationsRepo';
import { ClientBotsRepository, BotStatus } from '../db/clientBotsRepo';
import { ClientBotEventsRepository } from '../db/clientBotEventsRepo';
import { ClientConfigService } from '../services/clientConfig';
import { initSecretManager } from '../secrets/secretManager';
import { ClientAuditLogRepository } from '../db/auditLogRepo';
import { PLAN_DEFINITIONS, buildPlanLimits, getPlanById } from '../config/plans';
import {
  deleteClientCredentials,
  fetchClientSnapshot,
  fetchClients,
  listClientCredentials,
  fetchStrategySecretSummary,
  storeStrategySecretRecord,
  storeClientCredentials,
  upsertClientRecord,
  deleteStrategySecretRecord,
  listClientStrategyAllocations,
  replaceClientStrategyAllocations,
  deleteClientStrategyAllocation,
} from './clientAdminActions';
import { TradeApprovalRepository, TradeApprovalStatus } from '../db/tradeApprovalRepo';
import { ClientComplianceRepository } from '../db/complianceRepo';
import { ethers } from 'ethers';
import { enqueuePaperRun, isPaperRunQueueEnabled } from '../jobs/paperRunQueue';
import { enqueueClientTask, isClientTaskQueueEnabled } from '../jobs/clientTaskQueue';
import { ClientWorkersRepository } from '../db/clientWorkersRepo';
import {
  createCheckoutSession,
  createBillingPortalSession,
  handleStripeWebhook,
  syncCheckoutSession,
  verifyStripeSignature,
  cancelClientSubscription,
} from '../services/billing/stripeService';
import { logger } from '../utils/logger';
import { ClientAgreementsRepository } from '../db/clientAgreementsRepo';
import { listStrategies, getStrategyDefinition, ensureStrategySupportsRunMode, checkStrategyRequirements } from '../strategies/registry';
import { buildPortfolioExecutionPlan } from '../services/portfolio/portfolioManager';
import { getChatService } from '../chat/chatService';
import type { StrategyId, StrategyRunMode } from '../strategies/types';
import type { PlanId } from '../config/planTypes';
import {
  StrategyMarketplaceRepository,
  StrategyFollowersRepository,
  StrategyStatsRepository,
  TournamentsRepository,
} from '../db/socialTradingRepo';
import { createMobileIntegration } from '../mobile/server';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

interface AdminServerOptions {
  port?: number;
  enableMobileRouter?: boolean;
}

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
const CHAT_DEFAULT_RETENTION_DAYS = Number(process.env.CHAT_RETENTION_DAYS || 730);

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

function toCsv(rows: Record<string, unknown>[], columns: { key: string; header: string }[]): string {
  const header = columns.map((col) => col.header).join(',');
  const lines = rows.map((row) =>
    columns
      .map((col) => {
        const value = row[col.key];
        if (value === null || value === undefined) return '';
        const str = String(value);
        return str.includes(',') || str.includes('"')
          ? `"${str.replace(/"/g, '""')}"`
          : str;
      })
      .join(',')
  );
  return [header, ...lines].join('\n');
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

export async function startAdminServer(options: AdminServerOptions = {}) {
  const requestedPort =
    options.port ?? Number(process.env.ADMIN_PORT || process.env.PORT || 9300);
  const enableMobileRouter =
    options.enableMobileRouter ??
    (process.env.ENABLE_MOBILE_ROUTER || 'true').toLowerCase() !== 'false';
  const pool = getPool();
  await runMigrations(pool);
  const clientsRepo = new ClientsRepository(pool);
  const credsRepo = new ClientApiCredentialsRepository(pool);
  const strategySecretsRepo = new ClientStrategySecretsRepository(pool);
  const strategyAllocationsRepo = new ClientStrategyAllocationsRepository(pool);
  const clientBotsRepo = new ClientBotsRepository(pool);
  const clientBotEventsRepo = new ClientBotEventsRepository(pool);
  const configService = new ClientConfigService(pool);
  const auditRepo = new ClientAuditLogRepository(pool);
  const workersRepo = new ClientWorkersRepository(pool);
  const agreementsRepo = new ClientAgreementsRepository(pool);
  const chatService = getChatService(pool);
  const marketplaceRepo = new StrategyMarketplaceRepository(pool);
  const followersRepo = new StrategyFollowersRepository(pool);
  const statsRepo = new StrategyStatsRepository(pool);
  const tournamentsRepo = new TournamentsRepository(pool);
  const tradeApprovalRepo = new TradeApprovalRepository(pool);
  const complianceRepo = new ClientComplianceRepository(pool);
  const mobileIntegration = enableMobileRouter ? createMobileIntegration(pool) : null;
  console.log(
    `[admin] mobile router enabled=${enableMobileRouter} port=${requestedPort} commit=${
      process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'local-dev'
    }`
  );

  const REQUIRED_DOCUMENTS = [
    { documentType: 'tos', name: 'Terms of Service', version: APP_CONFIG.LEGAL.TOS_VERSION, file: 'terms' },
    { documentType: 'privacy', name: 'Privacy Policy', version: APP_CONFIG.LEGAL.PRIVACY_VERSION, file: 'privacy' },
    { documentType: 'risk', name: 'Risk Disclosure', version: APP_CONFIG.LEGAL.RISK_VERSION, file: 'risk' },
  ];

  const resolveMevRpcUrl = () => {
    return (
      process.env.MEV_RPC_URL ||
      process.env.MEV_ALCHEMY_HTTPS ||
      (process.env.MEV_ALCHEMY_KEY ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.MEV_ALCHEMY_KEY}` : undefined) ||
      process.env.ALCHEMY_HTTPS ||
      (process.env.ALCHEMY_KEY ? `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}` : undefined) ||
      process.env.RPC_URL ||
      null
    );
  };

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
    if (mobileIntegration) {
      try {
        const handled = await mobileIntegration.handleRequest(req, res);
        if (handled) {
          return;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!res.writableEnded) {
          sendJson(res, 500, { error: message });
        }
        return;
      }
    }

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

      if (ctx.pathname === '/strategies' && ctx.method === 'GET') {
        const strategies = listStrategies();
        sendJson(res, 200, strategies);
        return;
      }

      if (ctx.pathname === '/compliance/kyc' && ctx.method === 'POST') {
        await withErrorHandling(async () => {
          const expectedToken = process.env.COMPLIANCE_WEBHOOK_TOKEN || ADMIN_TOKEN;
          if (expectedToken) {
            const provided = getHeader(ctx.req, 'x-webhook-token');
            if (provided !== expectedToken) {
              sendJson(res, 401, { error: 'invalid_webhook_token' });
              return;
            }
          }
          const body = ctx.body ?? {};
          const clientId = body.clientId ?? body.client_id;
          if (typeof clientId !== 'string' || !clientId) {
            throw new Error('client_id_required');
          }
          const status = body.status;
          if (typeof status !== 'string' || !status) {
            throw new Error('status_required');
          }
          const record = await complianceRepo.upsert({
            clientId,
            provider: body.provider ?? 'webhook',
            status,
            riskScore: typeof body.riskScore === 'number' ? body.riskScore : null,
            referenceId: body.referenceId ?? body.caseId ?? null,
            payload: body,
          });
          await auditRepo.addEntry({
            clientId,
            actor: 'compliance-webhook',
            action: 'compliance_status_updated',
            metadata: {
              provider: record.provider,
              status: record.status,
              riskScore: record.riskScore,
              referenceId: record.referenceId,
            },
          });
          sendJson(res, 200, { ok: true });
        }, res);
        return;
      }

      if (ctx.pathname === '/approvals' && ctx.method === 'GET') {
        await withErrorHandling(async () => {
          const statusRaw = (ctx.query.get('status') || 'pending').toLowerCase();
          const validStatuses: TradeApprovalStatus[] = ['pending', 'approved', 'rejected'];
          const status = validStatuses.includes(statusRaw as TradeApprovalStatus)
            ? (statusRaw as TradeApprovalStatus)
            : 'pending';
          const clientFilter = ctx.query.get('clientId') || ctx.query.get('client') || undefined;
          const approvals = await tradeApprovalRepo.listByStatus(status, clientFilter ?? undefined);
          sendJson(res, 200, approvals);
        }, res);
        return;
      }

      const approvalActionMatch = ctx.pathname.match(/^\/approvals\/(\d+)\/(approve|reject)$/);
      if (approvalActionMatch) {
        if (ctx.method !== 'POST') {
          methodNotAllowed(res);
          return;
        }
        const approvalId = Number(approvalActionMatch[1]);
        if (!Number.isFinite(approvalId)) {
          throw new Error('invalid_approval_id');
        }
        const action = approvalActionMatch[2];
        const actor = resolveActor(ctx.req);
        await withErrorHandling(async () => {
          const bodyMetadata = ctx.body && typeof ctx.body.metadata === 'object' ? ctx.body.metadata : undefined;
          if (action === 'approve') {
            const note = typeof ctx.body?.note === 'string' ? ctx.body.note : undefined;
            const metadataPatch = (bodyMetadata as Record<string, unknown> | undefined) ?? (note ? { approval_note: note } : undefined);
            const record = await tradeApprovalRepo.markApproved(approvalId, actor, metadataPatch ?? undefined);
            await auditRepo.addEntry({
              clientId: record.clientId,
              actor,
              action: 'trade_approval_approved',
              metadata: {
                approvalId: record.id,
                amountUsd: record.amountUsd,
                correlationId: record.correlationId,
              },
            });
            sendJson(res, 200, record);
            return;
          }
          const reason = typeof ctx.body?.reason === 'string' ? ctx.body.reason : undefined;
          const metadataPatch = (bodyMetadata as Record<string, unknown> | undefined) ?? (reason ? { rejection_reason: reason } : undefined);
          const record = await tradeApprovalRepo.markRejected(approvalId, actor, metadataPatch ?? undefined);
          const rejectionReason =
            metadataPatch && typeof metadataPatch === 'object' && 'rejection_reason' in metadataPatch
              ? (metadataPatch as Record<string, unknown>).rejection_reason
              : null;
          await auditRepo.addEntry({
            clientId: record.clientId,
            actor,
            action: 'trade_approval_rejected',
            metadata: {
              approvalId: record.id,
              amountUsd: record.amountUsd,
              correlationId: record.correlationId,
              reason: rejectionReason,
            },
          });
          sendJson(res, 200, record);
        }, res);
        return;
      }

      if (ctx.pathname === '/exports/accounting' && ctx.method === 'GET') {
        await withErrorHandling(async () => {
          const format = (ctx.query.get('format') || 'csv').toLowerCase();
          const clientIdFilter = ctx.query.get('clientId') || ctx.query.get('client') || null;
          const start = ctx.query.get('start');
          const end = ctx.query.get('end');
          const params: any[] = [];
          const conditions: string[] = [];
          if (clientIdFilter) {
            params.push(clientIdFilter);
            conditions.push(`f.client_id = $${params.length}`);
          }
          if (start) {
            params.push(start);
            conditions.push(`f.fill_timestamp >= $${params.length}`);
          }
          if (end) {
            params.push(end);
            conditions.push(`f.fill_timestamp <= $${params.length}`);
          }
          const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
          const query = `
            SELECT f.client_id, f.run_id, r.exchange, f.pair, f.side, f.price, f.amount, f.fee,
                   f.fill_timestamp
            FROM bot_fills f
            JOIN bot_runs r ON r.run_id = f.run_id
            ${whereClause}
            ORDER BY f.fill_timestamp ASC
          `;
          const result = await pool.query(query, params);
          const rows = result.rows.map((row) => {
            const [base, quote] = typeof row.pair === 'string' ? row.pair.split('/') : ['UNKNOWN', 'UNKNOWN'];
            const quoteAmount = Number(row.amount) * Number(row.price);
            return {
              date: new Date(row.fill_timestamp).toISOString(),
              type: row.side === 'buy' ? 'Buy' : 'Sell',
              baseAmount: Number(row.amount),
              baseCurrency: base,
              quoteAmount: quoteAmount,
              quoteCurrency: quote,
              price: Number(row.price),
              feeAmount: row.fee !== null ? Number(row.fee) : 0,
              feeCurrency: quote,
              clientId: row.client_id,
              runId: row.run_id,
              exchange: row.exchange,
            };
          });

          if (format === 'json') {
            sendJson(res, 200, rows);
          } else {
            const csv = toCsv(rows, [
              { key: 'date', header: 'Date' },
              { key: 'type', header: 'Type' },
              { key: 'baseAmount', header: 'Base Amount' },
              { key: 'baseCurrency', header: 'Base Currency' },
              { key: 'quoteAmount', header: 'Quote Amount' },
              { key: 'quoteCurrency', header: 'Quote Currency' },
              { key: 'price', header: 'Price' },
              { key: 'feeAmount', header: 'Fee Amount' },
              { key: 'feeCurrency', header: 'Fee Currency' },
              { key: 'clientId', header: 'Client ID' },
              { key: 'runId', header: 'Run ID' },
              { key: 'exchange', header: 'Exchange' },
            ]);
            res.writeHead(200, {
              'Content-Type': 'text/csv',
              'Content-Disposition': `attachment; filename="accounting_${Date.now()}.csv"`,
            });
            res.end(csv);
          }
        }, res);
        return;
      }

      const complianceMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/compliance$/);
      if (complianceMatch) {
        const clientId = decodeURIComponent(complianceMatch[1]);
        if (ctx.method === 'GET') {
          await withErrorHandling(async () => {
            const record = await complianceRepo.getByClient(clientId);
            sendJson(res, 200, record ?? {});
          }, res);
          return;
        }
        if (ctx.method === 'POST') {
          await withErrorHandling(async () => {
            const body = ctx.body ?? {};
            const status = body.status;
            if (typeof status !== 'string' || !status) {
              throw new Error('status_required');
            }
            const record = await complianceRepo.upsert({
              clientId,
              provider: body.provider ?? null,
              status,
              riskScore: typeof body.riskScore === 'number' ? body.riskScore : null,
              referenceId: body.referenceId ?? null,
              payload: body.payload && typeof body.payload === 'object' ? body.payload : null,
            });
            await auditRepo.addEntry({
              clientId,
              actor: resolveActor(ctx.req),
              action: 'compliance_status_updated',
              metadata: {
                provider: record.provider,
                status: record.status,
                riskScore: record.riskScore,
                referenceId: record.referenceId,
              },
            });
            sendJson(res, 200, record);
          }, res);
          return;
        }
        methodNotAllowed(res);
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
        const existingClient = await clientsRepo.findById(clientId).catch((error) => {
          logger.warn('client_lookup_failed', {
            event: 'client_lookup_failed',
            clientId,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
        const contactInfo = existingClient?.contactInfo ?? null;
        const contactEmail =
          typeof body.email === 'string'
            ? body.email
            : typeof (contactInfo as any)?.email === 'string'
              ? (contactInfo as any).email
              : null;
        const session = await createCheckoutSession({
          clientId,
          planId,
          successUrl,
          cancelUrl,
          trialDays: typeof trialDays === 'number' ? trialDays : undefined,
          stripeCustomerId: existingClient?.stripeCustomerId ?? null,
          customerEmail: contactEmail,
        });
        sendJson(res, 200, { id: session.id, url: session.url });
        return;
      }

      if (ctx.pathname === '/billing/session/sync' && ctx.method === 'POST') {
        if (!process.env.STRIPE_SECRET_KEY) {
          throw new Error('stripe_not_configured');
        }
        const body = ctx.body ?? {};
        const sessionId = body.sessionId ?? body.session_id;
        if (!sessionId) {
          throw new Error('session_id_required');
        }
        const client = await syncCheckoutSession(String(sessionId), clientsRepo);
        sendJson(res, 200, { client });
        return;
      }

      if (ctx.pathname === '/billing/portal' && ctx.method === 'POST') {
        if (!process.env.STRIPE_SECRET_KEY) {
          throw new Error('stripe_not_configured');
        }
        const body = ctx.body ?? {};
        const clientId = body.clientId ?? body.client_id;
        const returnUrl = body.returnUrl ?? body.return_url;
        if (!clientId || !returnUrl) {
          throw new Error('missing_parameters');
        }
        const client = await clientsRepo.findById(clientId);
        if (!client || !client.stripeCustomerId) {
          throw new Error('stripe_customer_missing');
        }
        const portal = await createBillingPortalSession({
          customerId: client.stripeCustomerId,
          returnUrl,
        });
        sendJson(res, 200, { url: portal.url });
        return;
      }

      if (ctx.pathname === '/billing/cancel' && ctx.method === 'POST') {
        const body = ctx.body ?? {};
        const clientId = body.clientId ?? body.client_id;
        if (!clientId) {
          throw new Error('client_id_required');
        }
        const cancelAtPeriodEnd = Boolean(body.cancelAtPeriodEnd ?? body.cancel_at_period_end ?? false);
        const result = await cancelClientSubscription({ clientId, cancelAtPeriodEnd }, clientsRepo);
        await auditRepo.addEntry({
          clientId,
          actor: resolveActor(ctx.req),
          action: cancelAtPeriodEnd ? 'billing_cancel_queued' : 'billing_cancelled',
          metadata: {
            cancelAtPeriodEnd: result.cancelAtPeriodEnd,
            subscriptionId: result.subscriptionId,
          },
        });
        sendJson(res, 200, result);
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

      if (ctx.pathname === '/chat/conversations' && ctx.method === 'POST') {
        const body = ctx.body ?? {};
        const clientId = body.clientId ?? body.client_id;
        if (!clientId) {
          throw new Error('client_id_required');
        }
        const subject = body.subject ?? null;
        const retentionDays = body.retentionDays ?? body.retention_days ?? CHAT_DEFAULT_RETENTION_DAYS;
        const orgId = body.orgId ?? body.org_id ?? null;
        const conversation = await chatService.ensureConversation({
          clientId,
          subject,
          orgId,
          retentionDays,
          metadata: body.metadata ?? null,
        });
        const clientRecord = await clientsRepo.findById(clientId).catch(() => null);
        const messages = await chatService.getMessages(conversation.id, { limit: 100 });
        const participants = await chatService.listParticipants(conversation.id);
        sendJson(res, 201, {
          conversation: { ...conversation, client_name: clientRecord?.name ?? conversation.client_id },
          messages,
          participants,
        });
        return;
      }

      if (ctx.pathname === '/chat/conversations' && ctx.method === 'GET') {
        const status = ctx.query.get('status') ?? undefined;
        const clientId = ctx.query.get('clientId') ?? ctx.query.get('client_id') ?? undefined;
        const orgId = ctx.query.get('orgId') ?? ctx.query.get('org_id') ?? undefined;
        const limit = ctx.query.get('limit') ? Number(ctx.query.get('limit')) : undefined;
        const conversations = await chatService.listConversations({ status, clientId, orgId, limit });
        sendJson(res, 200, { conversations });
        return;
      }

      const chatMessageMatch = ctx.pathname.match(/^\/chat\/conversations\/([^/]+)\/messages$/);
      if (chatMessageMatch && ctx.method === 'POST') {
        const conversationId = chatMessageMatch[1];
        const body = ctx.body ?? {};
        const senderType = (body.senderType ?? body.sender_type ?? 'client') as 'client' | 'agent' | 'bot' | 'system';
        const senderId = body.senderId ?? body.sender_id ?? null;
        const messageBody = body.body;
        if (!messageBody) throw new Error('message_body_required');
        const metadata = body.metadata ?? null;
        const message = await chatService.sendMessage({
          conversationId,
          senderType,
          senderId,
          body: messageBody,
          metadata,
        });
        const participants = await chatService.listParticipants(conversationId);
        sendJson(res, 201, { message, participants });
        return;
      }

      const chatConversationMatch = ctx.pathname.match(/^\/chat\/conversations\/([^/]+)$/);
      if (chatConversationMatch && ctx.method === 'GET') {
        const conversationId = chatConversationMatch[1];
        const conversation = await chatService.getConversation(conversationId);
        if (!conversation) {
          sendJson(res, 404, { error: 'not_found' });
          return;
        }
        const clientRecord = await clientsRepo
          .findById(conversation.client_id)
          .catch(() => null);
        const messages = await chatService.getMessages(conversationId, { limit: 200 });
        const participants = await chatService.listParticipants(conversationId);
        sendJson(res, 200, {
          conversation: {
            ...conversation,
            client_name: conversation.client_name ?? clientRecord?.name ?? conversation.client_id,
          },
          messages,
          participants,
        });
        return;
      }

      const chatStatusMatch = ctx.pathname.match(/^\/chat\/conversations\/([^/]+)\/status$/);
      if (chatStatusMatch && ctx.method === 'POST') {
        const conversationId = chatStatusMatch[1];
        const body = ctx.body ?? {};
        const status = body.status;
        if (!status) throw new Error('status_required');
        const updated = await chatService.updateStatus(conversationId, status, body.metadata ?? null);
        if (!updated) {
          sendJson(res, 404, { error: 'not_found' });
          return;
        }
        sendJson(res, 200, { conversation: updated });
        return;
      }

      const chatClaimMatch = ctx.pathname.match(/^\/chat\/conversations\/([^/]+)\/claim$/);
      if (chatClaimMatch && ctx.method === 'POST') {
        const conversationId = chatClaimMatch[1];
        const body = ctx.body ?? {};
        const agentId = body.agentId ?? body.agent_id;
        if (!agentId) throw new Error('agent_id_required');
        const agentName = body.agentName ?? body.agent_name ?? getHeader(ctx.req, 'x-actor') ?? agentId;
        const assigned = await chatService.assignAgent(conversationId, agentId, agentName);
        const conversation = assigned ?? (await chatService.getConversation(conversationId));
        sendJson(res, 200, { ok: true, conversation });
        return;
      }

      const transcriptMatch = ctx.pathname.match(/^\/chat\/conversations\/([^/]+)\/transcript$/);
      if (transcriptMatch && ctx.method === 'GET') {
        const conversationId = transcriptMatch[1];
        try {
          const transcript = await chatService.generateTranscript(conversationId);
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Disposition': `attachment; filename="octobot-transcript-${conversationId}.txt"`,
            'Cache-Control': 'no-cache',
          });
          res.end(transcript);
        } catch (err) {
          sendJson(res, 404, { error: err instanceof Error ? err.message : 'transcript_error' });
        }
        return;
      }

      const chatEventsMatch = ctx.pathname.match(/^\/chat\/conversations\/([^/]+)\/events$/);
      if (chatEventsMatch && ctx.method === 'GET') {
        const conversationId = chatEventsMatch[1];
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('\n');
        const listener = (event: any) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        chatService.on(conversationId, listener);
        const pingInterval = setInterval(() => {
          res.write(': ping\n\n');
        }, 15000);
        ctx.req.on('close', () => {
          clearInterval(pingInterval);
          chatService.off(conversationId, listener);
        });
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
        const existing = body.id ? await clientsRepo.findById(body.id) : null;
        const plan = body.plan ?? existing?.plan ?? 'starter';
        const planDef = getPlanById(plan);
        if (!planDef) {
          throw new Error(`Unknown plan: ${plan}`);
        }
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
            const exchange = typeof row.exchange === 'string' ? row.exchange : params.exchange ?? null;
            const estNetProfitRaw =
              summary?.estNetProfit ?? summary?.raw?.estNetProfit ?? params.summary?.raw?.estNetProfit ?? null;
            const strategyId =
              (typeof params.strategyId === 'string' && params.strategyId) ||
              (typeof params.strategy_id === 'string' && params.strategy_id) ||
              (typeof summary?.strategyId === 'string' && summary?.strategyId) ||
              null;
            return {
              runId: row.run_id,
              status: row.status,
              startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
              endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
              runMode: params.runMode ?? params.run_mode ?? params.metadata?.runMode ?? 'unknown',
              estNetProfit: estNetProfitRaw !== null ? Number(estNetProfitRaw) : null,
              perTradeUsd: params.perTradeUsd ?? params.summary?.perTradeUsd ?? null,
              exchange,
              strategyId,
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

      const tradesMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/trades$/);
      if (tradesMatch) {
        const clientId = decodeURIComponent(tradesMatch[1]);
        if (ctx.method === 'GET') {
          const limitRaw = Number(ctx.query.get('limit') || '50');
          const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 10), 200);
          const start = ctx.query.get('start');
          const end = ctx.query.get('end');
          const botFilter = ctx.query.get('bot');
          const cursorParam = ctx.query.get('cursor');
          const params: any[] = [clientId];
          const where: string[] = ['f.client_id = $1'];
          if (start) {
            params.push(new Date(start).toISOString());
            where.push(`f.fill_timestamp >= $${params.length}`);
          }
          if (end) {
            params.push(new Date(end).toISOString());
            where.push(`f.fill_timestamp <= $${params.length}`);
          }
          if (botFilter) {
            params.push(botFilter);
            const lastIndex = params.length;
            where.push(
              `(COALESCE(r.params_json->>'strategyId', r.params_json->>'strategy_id') = $${lastIndex} OR f.client_bot_id = $${lastIndex})`
            );
          }
          if (cursorParam) {
            const [tsPart, idPart] = cursorParam.split('_');
            const cursorTs = tsPart ? new Date(tsPart) : null;
            const cursorId = idPart ? Number(idPart) : null;
            if (cursorTs && Number.isFinite(cursorTs.getTime()) && Number.isFinite(cursorId)) {
              params.push(cursorTs.toISOString());
              params.push(Number(cursorId));
              where.push(`(f.fill_timestamp, f.id) < ($${params.length - 1}, $${params.length})`);
            }
          }
          params.push(limit + 1);
          const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
          const tradesQuery = `
            SELECT
              f.id,
              f.run_id,
              f.pair,
              f.price::float AS price,
              f.amount::float AS amount,
              f.fee::float AS fee,
              f.side,
              f.fill_timestamp,
              f.client_bot_id,
              r.exchange,
              r.params_json,
              (r.params_json->>'runMode') AS db_run_mode
            FROM bot_fills f
            LEFT JOIN bot_runs r ON r.run_id = f.run_id
            ${whereClause}
            ORDER BY f.fill_timestamp DESC, f.id DESC
            LIMIT $${params.length}
          `;
          const result = await pool.query(tradesQuery, params);
          const hasMore = result.rows.length > limit;
          const items = hasMore ? result.rows.slice(0, -1) : result.rows.slice();
          const ascending = items
            .slice()
            .sort((a, b) => {
              const aTs = new Date(a.fill_timestamp).getTime();
              const bTs = new Date(b.fill_timestamp).getTime();
              if (aTs === bTs) {
                return a.id - b.id;
              }
              return aTs - bTs;
            });
          const positions = new Map<
            string,
            {
              qty: number;
              avgPrice: number;
            }
          >();
          const pnlMap = new Map<
            number,
            {
              pnl: number;
              cumulative: number;
            }
          >();
          let cumulative = 0;
          for (const row of ascending) {
            const key = row.pair || 'UNKNOWN';
            const side = typeof row.side === 'string' && row.side.toLowerCase() === 'sell' ? 'sell' : 'buy';
            const amount = Number(row.amount) || 0;
            const price = Number(row.price) || 0;
            const pos = positions.get(key) ?? { qty: 0, avgPrice: 0 };
            let pnl = 0;
            if (side === 'buy') {
              const totalCost = pos.avgPrice * pos.qty + price * amount;
              const nextQty = pos.qty + amount;
              pos.qty = nextQty;
              pos.avgPrice = nextQty > 0 ? totalCost / nextQty : 0;
            } else if (amount > 0) {
              const sellQty = Math.min(amount, pos.qty || 0);
              if (sellQty > 0) {
                pnl = (price - pos.avgPrice) * sellQty;
                pos.qty = Math.max(pos.qty - sellQty, 0);
                if (pos.qty === 0) {
                  pos.avgPrice = 0;
                }
              }
            }
            cumulative += pnl;
            pnlMap.set(row.id, { pnl, cumulative });
            positions.set(key, pos);
          }
          const trades = items.map((row) => {
            const paramsJson = (row.params_json ?? {}) as Record<string, any>;
            const strategyId =
              (typeof paramsJson.strategyId === 'string' && paramsJson.strategyId) ||
              (typeof paramsJson.strategy_id === 'string' && paramsJson.strategy_id) ||
              null;
            const clientBotId = typeof row.client_bot_id === 'string' ? row.client_bot_id : null;
            const botLabel =
              clientBotId ||
              (typeof paramsJson.strategyName === 'string' && paramsJson.strategyName) ||
              (typeof paramsJson.summary?.strategyName === 'string' && paramsJson.summary.strategyName) ||
              strategyId;
            const runMode =
              paramsJson.runMode ??
              paramsJson.run_mode ??
              paramsJson.metadata?.runMode ??
              row.db_run_mode ??
              'unknown';
            const pnlEntry = pnlMap.get(row.id) ?? { pnl: 0, cumulative: cumulative };
            return {
              id: row.id,
              runId: row.run_id,
              bot: botLabel ?? 'Bot',
              strategyId,
              clientBotId,
              pair: row.pair,
              side: String(row.side || '').toUpperCase(),
              price: Number(row.price) || 0,
              amount: Number(row.amount) || 0,
              fee: row.fee !== null ? Number(row.fee) : null,
              timestamp: new Date(row.fill_timestamp).toISOString(),
              exchange: row.exchange ?? null,
              mode: runMode,
              pnlUsd: pnlEntry.pnl,
              cumulativePnlUsd: pnlEntry.cumulative,
            };
          });
          const lastItem = hasMore ? trades[trades.length - 1] : null;
          sendJson(res, 200, {
            items: trades,
            nextCursor:
              hasMore && lastItem
                ? `${lastItem.timestamp}_${lastItem.id}`
                : null,
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

      const portfolioMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/portfolio$/);
      if (portfolioMatch) {
        const clientId = decodeURIComponent(portfolioMatch[1]);
        if (ctx.method === 'GET' || ctx.method === 'PUT') {
          const allocationsPayload = ctx.method === 'PUT' ? (ctx.body?.allocations ?? ctx.body ?? []) : [];
          let allocations;
          if (ctx.method === 'PUT') {
            allocations = await replaceClientStrategyAllocations(strategyAllocationsRepo, clientId, allocationsPayload);
            await auditRepo.addEntry({
              clientId,
              actor: resolveActor(ctx.req),
              action: 'portfolio_updated',
              metadata: { allocationCount: allocations.length },
            });
          } else {
            allocations = await listClientStrategyAllocations(strategyAllocationsRepo, clientId);
          }

          let plan: any = null;
          try {
            const clientConfig = await configService.getClientConfig(clientId);
            plan = buildPortfolioExecutionPlan(clientConfig);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            logger.warn('portfolio_plan_build_failed', {
              event: 'portfolio_plan_build_failed',
              clientId,
              error: message,
            });
          }

          const totalWeightPct = allocations
            .filter((allocation) => allocation.enabled !== false)
            .reduce((sum, allocation) => sum + allocation.weightPct, 0);

          sendJson(res, 200, {
            allocations,
            totalWeightPct,
            plan,
          });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const clientBotsMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/bots$/);
      if (clientBotsMatch) {
        const clientId = decodeURIComponent(clientBotsMatch[1]);
        if (ctx.method === 'GET') {
          const bots = await clientBotsRepo.listByClient(clientId);
          sendJson(res, 200, { bots });
          return;
        }
        if (ctx.method === 'POST') {
          const body = ctx.body ?? {};
          const templateKey = String(body.templateKey ?? body.template_key ?? 'grid').toLowerCase();
          const exchangeName = String(body.exchangeName ?? body.exchange_name ?? 'binance');
          const symbol = String(body.symbol ?? body.pair ?? 'BTCUSDT');
          const mode = body.mode === 'live' ? 'live' : 'paper';
          const status: BotStatus = (body.status ?? 'active') as BotStatus;
          const config = body.config && typeof body.config === 'object' ? body.config : null;
          const bot = await clientBotsRepo.create({
            clientId,
            templateKey,
            exchangeName,
            symbol,
            mode,
            status,
            config,
          });
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'client_bot_created',
            metadata: { botId: bot.id, templateKey: bot.templateKey },
          });
          sendJson(res, 201, bot);
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const clientBotDetailMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/bots\/([^/]+)$/);
      if (clientBotDetailMatch) {
        const clientId = decodeURIComponent(clientBotDetailMatch[1]);
        const botId = decodeURIComponent(clientBotDetailMatch[2]);
        const bot = await clientBotsRepo.findById(botId);
        if (!bot || bot.clientId !== clientId) {
          notFound(res);
          return;
        }
        if (ctx.method === 'PATCH') {
          const body = ctx.body ?? {};
          const patch: Record<string, unknown> = {};
          if (body.status) {
            patch.status = body.status as BotStatus;
          }
          if (body.mode) {
            patch.mode = body.mode === 'live' ? 'live' : 'paper';
          }
          if (body.config !== undefined) {
            patch.config = body.config && typeof body.config === 'object' ? body.config : null;
          }
          if (body.symbol) patch.symbol = body.symbol;
          if (body.exchangeName || body.exchange_name) patch.exchangeName = body.exchangeName ?? body.exchange_name;
          const updated = await clientBotsRepo.update(botId, patch);
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'client_bot_updated',
            metadata: { botId, changes: Object.keys(patch) },
          });
          sendJson(res, 200, updated);
          return;
        }
        if (ctx.method === 'DELETE') {
          await clientBotsRepo.update(botId, { status: 'stopped' });
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'client_bot_deleted',
            metadata: { botId },
          });
          sendJson(res, 204, {});
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const botEventsMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/bots\/([^/]+)\/events$/);
      if (botEventsMatch) {
        const clientId = decodeURIComponent(botEventsMatch[1]);
        const botId = decodeURIComponent(botEventsMatch[2]);
        const bot = await clientBotsRepo.findById(botId);
        if (!bot || bot.clientId !== clientId) {
          notFound(res);
          return;
        }
        if (ctx.method === 'GET') {
          const events = await clientBotEventsRepo.listByBot(botId, Number(ctx.query.get('limit') || '50'));
          sendJson(res, 200, { events });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const portfolioDeleteMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/portfolio\/([^/]+)$/);
      if (portfolioDeleteMatch) {
        const clientId = decodeURIComponent(portfolioDeleteMatch[1]);
        const strategyId = decodeURIComponent(portfolioDeleteMatch[2]);
        if (ctx.method === 'DELETE') {
          await deleteClientStrategyAllocation(strategyAllocationsRepo, clientId, strategyId as any);
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'portfolio_strategy_removed',
            metadata: { strategyId },
          });
          sendJson(res, 204, {});
          return;
      }
      methodNotAllowed(res);
      return;
    }

      const socialStrategiesMatch = ctx.pathname.match(/^\/social\/strategies(?:\/([^/]+))?$/);
      if (socialStrategiesMatch) {
        const listingId = socialStrategiesMatch[1] ? decodeURIComponent(socialStrategiesMatch[1]) : null;
        if (!listingId) {
          if (ctx.method === 'GET') {
            const ownerId = ctx.query.get('owner');
            const includeStats = ctx.query.get('includeStats') === 'true';
            const listings = ownerId
              ? await marketplaceRepo.listByOwner(ownerId)
              : await marketplaceRepo.listPublic();
            if (!includeStats) {
              sendJson(res, 200, listings);
              return;
            }
            const enriched = await Promise.all(
              listings.map(async (listing) => ({
                ...listing,
                stats: await statsRepo.get(listing.id),
              }))
            );
            sendJson(res, 200, enriched);
            return;
          }
          if (ctx.method === 'POST') {
            const body = ctx.body ?? {};
            const ownerClientId = body.clientId ?? body.client_id;
            if (!ownerClientId) throw new Error('clientId required');
            if (!body.strategyId) throw new Error('strategyId required');
            if (!body.title) throw new Error('title required');
            const id = body.id ?? crypto.randomUUID();
            const listing = await marketplaceRepo.create({
              id,
              clientId: ownerClientId,
              strategyId: body.strategyId,
              title: body.title,
              description: body.description ?? null,
              config: body.config ?? null,
              visibility: body.visibility ?? 'public',
              tags: body.tags ?? [],
              pricing: body.pricing ?? null,
            });
            if (body.publish === true) {
              await marketplaceRepo.publish(id);
            }
            await statsRepo.upsert({ listingId: id, totalFollowers: 0, totalPnlUsd: 0 });
            await auditRepo.addEntry({
              clientId: ownerClientId,
              actor: resolveActor(ctx.req),
              action: 'social_strategy_created',
              metadata: { listingId: id, strategyId: body.strategyId },
            });
            sendJson(res, 201, await marketplaceRepo.get(id));
            return;
          }
          methodNotAllowed(res);
          return;
        }

        if (ctx.method === 'GET') {
          const listing = await marketplaceRepo.get(listingId);
          if (!listing) {
            sendJson(res, 404, { error: 'not_found' });
            return;
          }
          const stats = await statsRepo.get(listingId);
          sendJson(res, 200, { listing, stats });
          return;
        }

        if (ctx.method === 'PUT') {
          const body = ctx.body ?? {};
          const listing = await marketplaceRepo.update(listingId, {
            title: body.title ?? undefined,
            description: body.description ?? undefined,
            config: body.config ?? undefined,
            visibility: body.visibility ?? undefined,
            status: body.status ?? undefined,
            tags: body.tags ?? undefined,
            pricing: body.pricing ?? undefined,
            performance: body.performance ?? undefined,
            publishedAt: body.publishedAt ? new Date(body.publishedAt) : undefined,
          });
          if (!listing) {
            sendJson(res, 404, { error: 'not_found' });
            return;
          }
          if (body.action === 'publish') {
            await marketplaceRepo.publish(listingId);
          }
          sendJson(res, 200, await marketplaceRepo.get(listingId));
          return;
        }

        if (ctx.method === 'DELETE') {
          await marketplaceRepo.remove(listingId);
          sendJson(res, 204, {});
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const socialFollowersMatch = ctx.pathname.match(/^\/social\/strategies\/([^/]+)\/followers(?:\/([^/]+))?$/);
      if (socialFollowersMatch) {
        const listingId = decodeURIComponent(socialFollowersMatch[1]);
        const followerId = socialFollowersMatch[2] ? decodeURIComponent(socialFollowersMatch[2]) : null;
        if (!followerId) {
          if (ctx.method === 'GET') {
            const followers = await followersRepo.listFollowers(listingId);
            sendJson(res, 200, followers);
            return;
          }
          if (ctx.method === 'POST') {
            const body = ctx.body ?? {};
            if (!body.followerClientId) throw new Error('followerClientId required');
            const follower = await followersRepo.upsert({
              id: body.id ?? crypto.randomUUID(),
              listingId,
              followerClientId: body.followerClientId,
              allocationPct: body.allocationPct ?? null,
              settings: body.settings ?? null,
              status: body.status ?? 'active',
            });
            const followerCount = (await followersRepo.listFollowers(listingId)).length;
            await statsRepo.upsert({ listingId, totalFollowers: followerCount });
            sendJson(res, 201, follower);
            return;
          }
          methodNotAllowed(res);
          return;
        }

        if (ctx.method === 'DELETE') {
          await followersRepo.delete(listingId, followerId);
          const followerCount = (await followersRepo.listFollowers(listingId)).length;
          await statsRepo.upsert({ listingId, totalFollowers: followerCount });
          sendJson(res, 204, {});
          return;
        }
        methodNotAllowed(res);
        return;
      }

      if (ctx.pathname === '/social/leaderboard' && ctx.method === 'GET') {
        const limit = Number(ctx.query.get('limit') || 20);
        const leaderboard = await statsRepo.leaderboard(limit);
        sendJson(res, 200, leaderboard);
        return;
      }

      const tournamentsMatch = ctx.pathname.match(/^\/social\/tournaments(?:\/([^/]+))?$/);
      if (tournamentsMatch) {
        const tournamentId = tournamentsMatch[1] ? decodeURIComponent(tournamentsMatch[1]) : null;
        if (!tournamentId) {
          if (ctx.method === 'GET') {
            const tournaments = await tournamentsRepo.listTournaments();
            sendJson(res, 200, tournaments);
            return;
          }
          if (ctx.method === 'POST') {
            const body = ctx.body ?? {};
            const id = body.id ?? crypto.randomUUID();
            if (!body.name) throw new Error('name required');
            const tournament = await tournamentsRepo.createTournament({
              id,
              name: body.name,
              description: body.description ?? null,
              status: body.status ?? 'upcoming',
              startsAt: body.startsAt ? new Date(body.startsAt) : null,
              endsAt: body.endsAt ? new Date(body.endsAt) : null,
              prizePoolUsd: body.prizePoolUsd ?? null,
              metadata: body.metadata ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
            sendJson(res, 201, tournament);
            return;
          }
          methodNotAllowed(res);
          return;
        }

        if (ctx.method === 'GET') {
          const tournament = await tournamentsRepo.getTournament(tournamentId);
          if (!tournament) {
            sendJson(res, 404, { error: 'not_found' });
            return;
          }
          const entries = await tournamentsRepo.listEntries(tournamentId);
          sendJson(res, 200, { tournament, entries });
          return;
        }

        if (ctx.method === 'PUT') {
          const body = ctx.body ?? {};
          const tournament = await tournamentsRepo.updateTournament(tournamentId, {
            name: body.name,
            description: body.description,
            status: body.status,
            startsAt: body.startsAt ? new Date(body.startsAt) : undefined,
            endsAt: body.endsAt ? new Date(body.endsAt) : undefined,
            prizePoolUsd: body.prizePoolUsd,
            metadata: body.metadata,
          });
          if (!tournament) {
            sendJson(res, 404, { error: 'not_found' });
            return;
          }
          sendJson(res, 200, tournament);
          return;
        }

        methodNotAllowed(res);
        return;
      }

      const tournamentEntriesMatch = ctx.pathname.match(/^\/social\/tournaments\/([^/]+)\/entries$/);
      if (tournamentEntriesMatch) {
        const tournamentId = decodeURIComponent(tournamentEntriesMatch[1]);
        if (ctx.method === 'GET') {
          const entries = await tournamentsRepo.listEntries(tournamentId);
          sendJson(res, 200, entries);
          return;
        }
        if (ctx.method === 'POST') {
          const body = ctx.body ?? {};
          if (!body.clientId) throw new Error('clientId required');
          const entry = await tournamentsRepo.upsertEntry({
            id: body.id ?? crypto.randomUUID(),
            tournamentId,
            listingId: body.listingId ?? null,
            clientId: body.clientId,
            status: body.status ?? 'registered',
            pnlUsd: body.pnlUsd ?? null,
            sharpeRatio: body.sharpeRatio ?? null,
            rank: body.rank ?? null,
            metadata: body.metadata ?? null,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          sendJson(res, 201, entry);
          return;
        }
        methodNotAllowed(res);
        return;
      }

      const strategySecretMatch = ctx.pathname.match(/^\/clients\/([^/]+)\/strategies\/([^/]+)\/secret$/);
      if (strategySecretMatch) {
        const clientId = decodeURIComponent(strategySecretMatch[1]);
        const strategyId = decodeURIComponent(strategySecretMatch[2]);
        if (ctx.method === 'GET') {
          const summary = await fetchStrategySecretSummary(strategySecretsRepo, clientId, strategyId);
          if (!summary.hasSecret) {
            sendJson(res, 200, { hasSecret: false });
            return;
          }
          const rpcUrl = resolveMevRpcUrl();
          let balanceWei: string | null = null;
          let balanceEth: string | null = null;
          let balanceError: string | null = null;
          const metadata = (summary.metadata ?? {}) as Record<string, any>;
          const lastPreflightRaw = metadata.lastPreflight ?? null;
          const lastPreflightError = metadata.lastPreflightError ?? null;
          const lastPreflightAt = metadata.lastPreflightAt ?? lastPreflightRaw?.timestamp ?? null;
          if (summary.address && rpcUrl) {
            try {
              const provider = new ethers.JsonRpcProvider(rpcUrl);
              const bal = await provider.getBalance(summary.address);
              balanceWei = bal.toString();
              balanceEth = ethers.formatEther(bal);
            } catch (err) {
              balanceError = err instanceof Error ? err.message : String(err);
            }
          }
          sendJson(res, 200, {
            hasSecret: true,
            address: summary.address ?? null,
            updatedAt: summary.updatedAt ?? null,
            balanceWei,
            balanceEth,
            balanceError,
            lastPreflight: lastPreflightRaw,
            lastPreflightError,
            lastPreflightAt,
          });
          return;
        }
        if (ctx.method === 'POST') {
          const body = ctx.body ?? {};
          const privateKey = typeof body.privateKey === 'string' ? body.privateKey.trim() : '';
          if (!privateKey) {
            throw new Error('private_key_required');
          }
          let wallet: ethers.Wallet;
          try {
            wallet = new ethers.Wallet(privateKey);
          } catch (err) {
            throw new Error('invalid_private_key');
          }
          const stored = await storeStrategySecretRecord(configService, {
            clientId,
            strategyId,
            secret: privateKey,
            metadata: { address: wallet.address },
          });
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'strategy_secret_rotated',
            metadata: {
              strategyId,
              address: wallet.address,
            },
          });
          sendJson(res, 201, {
            hasSecret: true,
            address: stored.address ?? wallet.address,
            updatedAt: stored.updatedAt ?? new Date(),
          });
          return;
        }
        if (ctx.method === 'DELETE') {
          await deleteStrategySecretRecord(configService, clientId, strategyId);
          await auditRepo.addEntry({
            clientId,
            actor: resolveActor(ctx.req),
            action: 'strategy_secret_deleted',
            metadata: { strategyId },
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
          const client = await clientsRepo.findById(clientId);
          if (!client) {
            throw new Error('client_not_found');
          }
          const planId = (client.plan ?? 'starter') as PlanId;
          const requestedStrategy = (body.strategyId ?? body.strategy_id ?? 'grid') as StrategyId;
          const strategy = getStrategyDefinition(requestedStrategy);
          if (!strategy) {
            throw new Error(`unknown_strategy:${requestedStrategy}`);
          }
          if (!strategy.allowedPlans.includes(planId)) {
            throw new Error(`strategy_not_permitted:${requestedStrategy}`);
          }
          const runMode = (body.runMode ?? body.run_mode ?? (strategy.supportsPaper ? 'paper' : 'live')) as StrategyRunMode;
          if (!ensureStrategySupportsRunMode(strategy, runMode)) {
            throw new Error(`strategy_run_mode_not_supported:${requestedStrategy}:${runMode}`);
          }
          const strategyConfig = (body.config ?? body.strategyConfig ?? undefined) as Record<string, unknown> | undefined;
          if (!checkStrategyRequirements(strategy, { config: strategyConfig })) {
            throw new Error('strategy_requirements_missing');
          }
          const actor = resolveActor(ctx.req);
          const pair = typeof body.pair === 'string' && body.pair ? body.pair : strategy.defaultPair;
          await enqueueClientTask({
            type: 'run_strategy',
            clientId,
            data: {
              strategyId: requestedStrategy,
              pair,
              runMode,
              actor,
              config: strategyConfig,
            },
          });
          await auditRepo.addEntry({
            clientId,
            actor,
            action: 'client_run_requested',
            metadata: {
              strategyId: requestedStrategy,
              pair,
              runMode,
            },
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
          const runRows = await pool.query(
            `SELECT params_json
             FROM bot_runs
             WHERE client_id = $1
             ORDER BY started_at DESC
             LIMIT 40`,
            [clientId]
          );
          const pnlHistory = runRows.rows
            .map((runRow) => {
              const params = (runRow.params_json ?? {}) as Record<string, any>;
              const summary = params.summary ?? params.plan?.summary ?? params.metadata?.summary ?? null;
              const candidate =
                summary?.estNetProfit ??
                summary?.raw?.estNetProfit ??
                params.summary?.raw?.estNetProfit ??
                params?.metrics?.estNetProfit ??
                null;
              return candidate !== null && candidate !== undefined ? Number(candidate) : null;
            })
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
          sendJson(res, 200, {
            clientId,
            pnl: {
              global: Number(row.global_pnl || 0),
              run: Number(row.run_pnl || 0),
              history: pnlHistory,
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
            const runRows = await pool.query(
              `SELECT params_json
               FROM bot_runs
               WHERE client_id = $1
               ORDER BY started_at DESC
               LIMIT 40`,
              [clientId]
            );
            const pnlHistory = runRows.rows
              .map((runRow) => {
                const params = (runRow.params_json ?? {}) as Record<string, any>;
                const summary = params.summary ?? params.plan?.summary ?? params.metadata?.summary ?? null;
                const candidate =
                  summary?.estNetProfit ??
                  summary?.raw?.estNetProfit ??
                  params.summary?.raw?.estNetProfit ??
                  params?.metrics?.estNetProfit ??
                  null;
                return candidate !== null && candidate !== undefined ? Number(candidate) : null;
              })
              .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
            const payload = {
              clientId,
              pnl: {
                global: Number(row.global_pnl || 0),
                run: Number(row.run_pnl || 0),
                history: pnlHistory,
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

  if (mobileIntegration) {
    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      if (!mobileIntegration.handleUpgrade(req, socket, head)) {
        socket.destroy();
      }
    });
  }

  const maxPortRetries = Number(process.env.ADMIN_PORT_RETRY_LIMIT || '5');
  let currentPort = requestedPort;
  let retriesLeft = maxPortRetries;

  await new Promise<void>((resolve, reject) => {
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };

    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      if (err && err.code === 'EADDRINUSE' && retriesLeft > 0) {
        logger.warn('admin_port_in_use', {
          event: 'admin_port_in_use',
          requestedPort: currentPort,
          nextPort: currentPort + 1,
        });
        retriesLeft -= 1;
        currentPort += 1;
        attemptListen();
        return;
      }
      reject(err);
    };

    const attemptListen = () => {
      server.once('listening', onListening);
      server.once('error', onError);
      server.listen(currentPort);
    };

    attemptListen();
  });

  // eslint-disable-next-line no-console
  console.log(`Admin server listening on :${currentPort}`);

  const shutdown = async () => {
    await closePool().catch((error) => {
      logger.warn('close_pool_failed', {
        event: 'close_pool_failed',
        error: error instanceof Error ? error.message : String(error),
      });
    });
    mobileIntegration?.close();
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
