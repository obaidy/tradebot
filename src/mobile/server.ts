import http, { IncomingMessage, ServerResponse } from 'http';
import { URL } from 'url';
import { Socket } from 'net';
import { Pool } from 'pg';
import { WebSocketServer } from 'ws';
import { CONFIG } from '../config';
import { ClientsRepository } from '../db/clientsRepo';
import { ClientStrategyAllocationsRepository } from '../db/clientStrategyAllocationsRepo';
import { ClientAuditLogRepository } from '../db/auditLogRepo';
import { enqueueClientTask, isClientTaskQueueEnabled } from '../jobs/clientTaskQueue';
import { MobileAuthRepository } from '../db/mobileAuthRepo';
import { MobileControlNotificationsRepository } from '../db/mobileNotificationsRepo';
import { MobileAuthService } from './auth';
import { dispatchControlNotification } from './notifications';
import type { StrategyId } from '../strategies/types';
import type { MobileUserProfile } from './types';
import {
  fetchActivityFeed,
  fetchDashboardSummary,
  fetchStrategies,
} from './dataService';

interface JsonBodyResult {
  raw: string;
  parsed: any;
}

interface AuthenticatedRequest {
  sessionId: string;
  deviceId: string;
  clientIds: string[];
  roles: string[];
  user: MobileUserProfile;
  email?: string | null;
  name?: string | null;
}

let serverStarted = false;

const MOBILE_PREFIX = '/mobile';
const WEBSOCKET_OPEN = 1;

type MobileRequestHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>;
type MobileUpgradeHandler = (req: IncomingMessage, socket: Socket, head: Buffer) => boolean;

interface MobileContext {
  pool: Pool;
  mobileRepo: MobileAuthRepository;
  clientsRepo: ClientsRepository;
  strategyAllocationsRepo: ClientStrategyAllocationsRepository;
  auditRepo: ClientAuditLogRepository;
  controlNotificationsRepo: MobileControlNotificationsRepository;
  authService: MobileAuthService;
}

let contextCache: MobileContext | null = null;

function getMobileContext(pool: Pool): MobileContext {
  if (contextCache) {
    return contextCache;
  }
  const mobileRepo = new MobileAuthRepository(pool);
  const clientsRepo = new ClientsRepository(pool);
  const strategyAllocationsRepo = new ClientStrategyAllocationsRepository(pool);
  const auditRepo = new ClientAuditLogRepository(pool);
  const controlNotificationsRepo = new MobileControlNotificationsRepository(pool);
  const authService = new MobileAuthService(mobileRepo, clientsRepo);
  contextCache = {
    pool,
    mobileRepo,
    clientsRepo,
    strategyAllocationsRepo,
    auditRepo,
    controlNotificationsRepo,
    authService,
  };
  contextCache = {
    pool,
    mobileRepo,
    clientsRepo,
    strategyAllocationsRepo,
    auditRepo,
    controlNotificationsRepo,
    authService,
  };
  console.log('[mobile] context initialised (shared Auth0 + repository cache)');
  return contextCache;
}

function enableCors(res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function sendError(res: ServerResponse, status: number, error: string, details?: string) {
  sendJson(res, status, { error, details });
}

function mobileActor(auth: AuthenticatedRequest) {
  return `mobile:${auth.user.id}:${auth.deviceId}`;
}

function confirmMetadata(input: any) {
  return {
    confirmToken: typeof input?.confirmToken === 'string' ? input.confirmToken : null,
    mfaToken: typeof input?.mfaToken === 'string' ? input.mfaToken : null,
    biometricSignature:
      typeof input?.biometricSignature === 'string' ? input.biometricSignature : null,
  };
}

function requireConfirmation(input: any, requirements: { confirm?: boolean; mfa?: boolean; biometric?: boolean }) {
  const { confirmToken, mfaToken, biometricSignature } = confirmMetadata(input);
  if (requirements.confirm && !confirmToken) {
    throw new Error('confirm_token_required');
  }
  if (requirements.mfa && !mfaToken) {
    throw new Error('mfa_token_required');
  }
  if (requirements.biometric && !biometricSignature) {
    throw new Error('biometric_signature_required');
  }
  return { confirmToken, mfaToken, biometricSignature };
}

async function readJsonBody(req: IncomingMessage): Promise<JsonBodyResult | null> {
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
          const parsed = raw.length ? JSON.parse(raw) : undefined;
          resolve({ raw, parsed });
        } catch (err) {
          reject(err);
        }
      })
      .on('error', reject);
  });
}

function notFound(res: ServerResponse) {
  sendJson(res, 404, { error: 'not_found' });
}

function unauthorized(res: ServerResponse) {
  res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
}

async function ensureAuthenticated(
  req: IncomingMessage,
  res: ServerResponse,
  authService: MobileAuthService,
  repo: MobileAuthRepository
): Promise<{ auth: AuthenticatedRequest; session: any } | null> {
  const header = req.headers['authorization'];
  if (!header || Array.isArray(header)) {
    unauthorized(res);
    return null;
  }
  const match = header.match(/Bearer\s+(.*)/i);
  if (!match) {
    unauthorized(res);
    return null;
  }
  try {
    const authContext = authService.verifyAccessToken(match[1]);
    const session = await repo.getSession(authContext.sessionId);
    if (!session || session.deviceId !== authContext.deviceId) {
      unauthorized(res);
      return null;
    }
    await repo.updateSession({ sessionId: session.sessionId, lastSeenAt: new Date() });
    return {
      auth: {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        clientIds: session.clientIds,
        roles: session.roles,
        user: authContext.user,
        email: session.userEmail,
        name: session.userName,
      },
      session,
    };
  } catch (err) {
    unauthorized(res);
    return null;
  }
}

function resolveClientId(preferred: string | null, clientIds: string[]): string | null {
  if (preferred && clientIds.includes(preferred)) {
    return preferred;
  }
  return clientIds.length ? clientIds[0] : null;
}

async function handleMobileRequest(req: IncomingMessage, res: ServerResponse, context: MobileContext): Promise<boolean> {
  if (!req.url) {
    return false;
  }

  const parsedUrl = new URL(req.url, 'http://localhost');
  if (!parsedUrl.pathname.startsWith(MOBILE_PREFIX)) {
    return false;
  }

  const resourcePath = parsedUrl.pathname.substring(MOBILE_PREFIX.length) || '/';
  const method = (req.method || 'GET').toUpperCase();
  const logLabel = `[mobile] ${method} ${resourcePath}`;
  console.log(`${logLabel} received`);

  enableCors(res);
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    console.log(`${logLabel} -> 204 (CORS preflight)`);
    return true;
  }

  const {
    authService,
    mobileRepo,
    clientsRepo,
    strategyAllocationsRepo,
    auditRepo,
    controlNotificationsRepo,
    pool,
  } = context;

  try {
    if (method === 'POST' && resourcePath === '/v1/auth/pkce/start') {
      const bodyResult = await readJsonBody(req);
      const input = bodyResult?.parsed ?? {};
      const result = await authService.startPkce({
        codeChallenge: String(input.codeChallenge ?? input.code_challenge ?? ''),
        redirectUri: String(input.redirectUri ?? input.redirect_uri ?? ''),
        deviceId: typeof input.deviceId === 'string' ? input.deviceId : undefined,
        scope: typeof input.scope === 'string' ? input.scope : undefined,
      });
      sendJson(res, 200, result);
      return true;
    }

    if (method === 'POST' && resourcePath === '/v1/auth/exchange') {
      const bodyResult = await readJsonBody(req);
      const input = bodyResult?.parsed ?? {};
      const result = await authService.exchangeCode({
        state: String(input.state ?? ''),
        code: String(input.code ?? ''),
        codeVerifier: String(input.codeVerifier ?? input.code_verifier ?? ''),
        redirectUri: String(input.redirectUri ?? input.redirect_uri ?? ''),
        deviceId: typeof input.deviceId === 'string' ? input.deviceId : undefined,
      });
      sendJson(res, 200, result);
      return true;
    }

    if (method === 'POST' && resourcePath === '/v1/auth/mfa/verify') {
      const body = await readJsonBody(req);
      const input = body?.parsed ?? {};
      const result = await authService.verifyMfa({
        challengeId: String(input.challengeId ?? input.challenge_id ?? ''),
        otp: String(input.otp ?? ''),
        deviceId: typeof input.deviceId === 'string' ? input.deviceId : undefined,
      });
      sendJson(res, 200, result);
      return true;
    }

    if (method === 'POST' && resourcePath === '/v1/auth/refresh') {
      const body = await readJsonBody(req);
      const input = body?.parsed ?? {};
      const result = await authService.refreshSession({
        refreshToken: String(input.refreshToken ?? input.refresh_token ?? ''),
      });
      sendJson(res, 200, result);
      return true;
    }

    if (method === 'GET' && (resourcePath === '/health' || resourcePath === '/health/')) {
      sendJson(res, 200, { status: 'ok', service: 'mobile' });
      console.log(`${logLabel} -> 200 (health)`);
      return true;
    }

    if (method === 'GET' && (resourcePath === '/version' || resourcePath === '/version/')) {
      sendJson(res, 200, {
        service: 'mobile',
        build: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || 'local-dev',
        timestamp: new Date().toISOString(),
      });
      console.log(`${logLabel} -> 200 (version)`);
      return true;
    }

    // Authenticated routes below
    const authResult = await ensureAuthenticated(req, res, authService, mobileRepo);
    if (!authResult) {
      return true;
    }

    if (method === 'POST' && resourcePath === '/v1/controls/kill-switch') {
      const body = await readJsonBody(req);
      const input = body?.parsed ?? {};
      const clientId = resolveClientId(
        typeof input.clientId === 'string' ? input.clientId : null,
        authResult.auth.clientIds
      );
      if (!clientId) {
        sendError(res, 400, 'client_scope_missing');
        return true;
      }
      try {
        requireConfirmation(input, {
          confirm: true,
          mfa: CONFIG.MOBILE.FORCE_MFA,
          biometric: false,
        });
      } catch (err) {
        sendError(res, 400, err instanceof Error ? err.message : 'confirmation_required');
        return true;
      }
      await clientsRepo.setKillRequest(clientId, true);
      if (isClientTaskQueueEnabled) {
        await enqueueClientTask({ type: 'shutdown', clientId });
      }
      await auditRepo.addEntry({
        clientId,
        actor: mobileActor(authResult.auth),
        action: 'client_kill_requested',
        metadata: {
          source: 'mobile',
          deviceId: authResult.auth.deviceId,
          email: authResult.auth.email ?? null,
          confirmation: confirmMetadata(input),
        },
      });
      await dispatchControlNotification(controlNotificationsRepo, {
        clientId,
        action: 'kill-switch',
        actor: mobileActor(authResult.auth),
        deviceId: authResult.auth.deviceId,
        metadata: {
          email: authResult.auth.email ?? null,
        },
      });
      sendJson(res, 200, { status: 'kill_requested' });
      return true;
    }

    if (method === 'POST' && resourcePath === '/v1/controls/pause-all') {
      const body = await readJsonBody(req);
      const input = body?.parsed ?? {};
      const clientId = resolveClientId(null, authResult.auth.clientIds);
      if (!clientId) {
        sendError(res, 400, 'client_scope_missing');
        return true;
      }
      try {
        requireConfirmation(input, {
          confirm: false,
          mfa: CONFIG.MOBILE.FORCE_MFA,
          biometric: false,
        });
      } catch (err) {
        sendError(res, 400, err instanceof Error ? err.message : 'confirmation_required');
        return true;
      }
      await clientsRepo.setPauseState(clientId, true);
      if (isClientTaskQueueEnabled) {
        await enqueueClientTask({ type: 'pause', clientId });
      }
      await auditRepo.addEntry({
        clientId,
        actor: mobileActor(authResult.auth),
        action: 'client_paused',
        metadata: {
          source: 'mobile',
          deviceId: authResult.auth.deviceId,
          email: authResult.auth.email ?? null,
          confirmation: confirmMetadata(input),
        },
      });
      await dispatchControlNotification(controlNotificationsRepo, {
        clientId,
        action: 'pause-all',
        actor: mobileActor(authResult.auth),
        deviceId: authResult.auth.deviceId,
        metadata: {
          email: authResult.auth.email ?? null,
        },
      });
      sendJson(res, 200, { status: 'paused' });
      return true;
    }

    if (method === 'POST' && resourcePath === '/v1/controls/resume-all') {
      const bodyResult = await readJsonBody(req);
      const input = bodyResult?.parsed ?? {};
      const clientId = resolveClientId(null, authResult.auth.clientIds);
      if (!clientId) {
        sendError(res, 400, 'client_scope_missing');
        return true;
      }
      try {
        requireConfirmation(input, {
          confirm: false,
          mfa: CONFIG.MOBILE.FORCE_MFA,
          biometric: false,
        });
      } catch (err) {
        sendError(res, 400, err instanceof Error ? err.message : 'confirmation_required');
        return true;
      }
      await clientsRepo.setPauseState(clientId, false);
      if (isClientTaskQueueEnabled) {
        await enqueueClientTask({ type: 'resume', clientId });
      }
      await auditRepo.addEntry({
        clientId,
        actor: mobileActor(authResult.auth),
        action: 'client_resumed',
        metadata: {
          source: 'mobile',
          deviceId: authResult.auth.deviceId,
          email: authResult.auth.email ?? null,
          confirmation: confirmMetadata(input),
        },
      });
      await dispatchControlNotification(controlNotificationsRepo, {
        clientId,
        action: 'resume-all',
        actor: mobileActor(authResult.auth),
        deviceId: authResult.auth.deviceId,
        metadata: {
          email: authResult.auth.email ?? null,
        },
      });
      sendJson(res, 200, { status: 'running' });
      return true;
    }

    const strategyControlMatch = resourcePath.match(/^\/v1\/controls\/strategies\/([^/]+)\/(pause|resume)$/);
    if (method === 'POST' && strategyControlMatch) {
      const [, rawStrategyId, action] = strategyControlMatch;
      const strategyId = rawStrategyId as StrategyId;
      if (!strategyId) {
        sendError(res, 400, 'strategy_required');
        return true;
      }
      const clientId = resolveClientId(null, authResult.auth.clientIds);
      if (!clientId) {
        sendError(res, 400, 'client_scope_missing');
        return true;
      }
      const bodyResult = await readJsonBody(req);
      const input = bodyResult?.parsed ?? {};
      try {
        requireConfirmation(input, {
          confirm: false,
          mfa: CONFIG.MOBILE.FORCE_MFA,
          biometric: false,
        });
      } catch (err) {
        sendError(res, 400, err instanceof Error ? err.message : 'confirmation_required');
        return true;
      }
      const allocations = await strategyAllocationsRepo.listByClient(clientId);
      const current = allocations.find((row) => row.strategyId === strategyId);
      if (!current) {
        sendError(res, 404, 'strategy_allocation_not_found');
        return true;
      }
      await strategyAllocationsRepo.upsert({
        clientId,
        strategyId,
        weightPct: current.weightPct,
        maxRiskPct: current.maxRiskPct ?? undefined,
        runMode: current.runMode ?? undefined,
        enabled: action === 'resume',
        config: current.configJson ?? undefined,
      });
      await auditRepo.addEntry({
        clientId,
        actor: mobileActor(authResult.auth),
        action: action === 'resume' ? 'client_strategy_resumed' : 'client_strategy_paused',
        metadata: {
          source: 'mobile',
          deviceId: authResult.auth.deviceId,
          strategyId,
          email: authResult.auth.email ?? null,
          confirmation: confirmMetadata(input),
        },
      });
      await dispatchControlNotification(controlNotificationsRepo, {
        clientId,
        action: action === 'resume' ? 'strategy-resume' : 'strategy-pause',
        actor: mobileActor(authResult.auth),
        deviceId: authResult.auth.deviceId,
        strategyId,
        metadata: {
          email: authResult.auth.email ?? null,
        },
      });
      sendJson(res, 200, {
        status: action === 'resume' ? 'running' : 'paused',
        strategyId,
      });
      return true;
    }

    if (method === 'GET' && resourcePath === '/v1/dashboard/summary') {
      const clientId = resolveClientId(parsedUrl.searchParams.get('clientId'), authResult.auth.clientIds);
      if (!clientId) {
        sendError(res, 400, 'client_scope_missing');
        return true;
      }
      const summary = await fetchDashboardSummary(pool, clientId);
      sendJson(res, 200, summary);
      return true;
    }

    if (method === 'GET' && resourcePath === '/v1/strategies') {
      const clientId = resolveClientId(parsedUrl.searchParams.get('clientId'), authResult.auth.clientIds);
      if (!clientId) {
        sendError(res, 400, 'client_scope_missing');
        return true;
      }
      const strategies = await fetchStrategies(pool, clientId);
      sendJson(res, 200, strategies);
      return true;
    }

    if (method === 'GET' && resourcePath === '/v1/activity') {
      const clientId = resolveClientId(parsedUrl.searchParams.get('clientId'), authResult.auth.clientIds);
      if (!clientId) {
        sendError(res, 400, 'client_scope_missing');
        return true;
      }
      const limitParam = parsedUrl.searchParams.get('limit');
      const cursorParam = parsedUrl.searchParams.get('cursor');
      const limit = limitParam ? Number(limitParam) : undefined;
      const feed = await fetchActivityFeed(pool, clientId, {
        limit: Number.isFinite(limit) ? (limit as number) : undefined,
        cursor: cursorParam ?? undefined,
      });
      sendJson(res, 200, feed);
      return true;
    }

    if (method === 'POST' && resourcePath === '/v1/devices/register') {
      const body = await readJsonBody(req);
      const input = body?.parsed ?? {};
      const deviceId = String(input.deviceId ?? input.device_id ?? '');
      if (!deviceId || deviceId !== authResult.auth.deviceId) {
        sendError(res, 400, 'device_mismatch');
        return true;
      }
      const pushToken = typeof input.pushToken === 'string' ? input.pushToken : undefined;
      const platform = typeof input.platform === 'string' ? input.platform : undefined;
      const appVersion = typeof input.appVersion === 'string' ? input.appVersion : undefined;
      const metadata = {
        ...(authResult.session.metadata ?? {}),
        appVersion,
        registeredAt: new Date().toISOString(),
      } as Record<string, unknown>;
      await mobileRepo.updateSession({
        sessionId: authResult.session.sessionId,
        pushToken: pushToken ?? null,
        platform: platform ?? null,
        metadata,
        lastSeenAt: new Date(),
      });
      sendJson(res, 204, {});
      return true;
    }

    notFound(res);
    console.log(`${logLabel} -> 404 (unmatched)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendError(res, 400, message);
    console.warn(`${logLabel} -> 400`, message);
  }

  return true;
}

interface MobileIntegration {
  handleRequest: MobileRequestHandler;
  handleUpgrade: MobileUpgradeHandler;
  close: () => void;
}

export function createMobileIntegration(pool: Pool): MobileIntegration {
  const context = getMobileContext(pool);
  const wss = new WebSocketServer({ noServer: true });

  const handleRequest: MobileRequestHandler = (req, res) => handleMobileRequest(req, res, context);

  const handleUpgrade: MobileUpgradeHandler = (req, socket, head) => {
    if (!req.url) {
      return false;
    }
    const parsedUrl = new URL(req.url, 'http://localhost');
    if (parsedUrl.pathname !== `${MOBILE_PREFIX}/ws`) {
      return false;
    }
    wss.handleUpgrade(req, socket, head, (ws, request) => {
      wss.emit('connection', ws, request);
    });
    return true;
  };

  wss.on('connection', async (socket, request) => {
    try {
      const url = new URL(request.url ?? `${MOBILE_PREFIX}/ws`, 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        socket.close(1008, 'missing_token');
        return;
      }
      let authContext: AuthenticatedRequest;
      try {
        const verified = context.authService.verifyAccessToken(token);
        const sessionRow = await context.mobileRepo.getSession(verified.sessionId);
        if (!sessionRow || sessionRow.deviceId !== verified.deviceId) {
          socket.close(1008, 'session_revoked');
          return;
        }
        const profile: MobileUserProfile = {
          id: verified.user.id,
          email: verified.user.email ?? sessionRow.userEmail ?? undefined,
          name: verified.user.name ?? sessionRow.userName ?? undefined,
          roles: sessionRow.roles,
          clientIds: sessionRow.clientIds,
          plan: verified.user.plan ?? sessionRow.plan ?? undefined,
        };
        authContext = {
          sessionId: verified.sessionId,
          deviceId: verified.deviceId,
          clientIds: sessionRow.clientIds,
          roles: sessionRow.roles,
          user: profile,
          email: sessionRow.userEmail,
          name: sessionRow.userName,
        };
        await context.mobileRepo.updateSession({ sessionId: sessionRow.sessionId, lastSeenAt: new Date() });
      } catch (err) {
        socket.close(1008, 'invalid_token');
        return;
      }

      const clientId = authContext.clientIds[0];
      if (!clientId) {
        socket.close(1008, 'client_scope_missing');
        return;
      }

      try {
        const summary = await fetchDashboardSummary(context.pool, clientId);
        socket.send(JSON.stringify({ type: 'dashboard.update', payload: summary }));
        const activity = await fetchActivityFeed(context.pool, clientId, { limit: 20 });
        if (activity.entries.length) {
          socket.send(JSON.stringify({ type: 'activity.append', payload: activity.entries }));
        }
        let lastActivityTimestamp = activity.entries.length ? activity.entries[0].createdAt : null;

        const interval = setInterval(async () => {
          if (socket.readyState !== WEBSOCKET_OPEN) {
            clearInterval(interval);
            return;
          }
          try {
            const latestSummary = await fetchDashboardSummary(context.pool, clientId);
            socket.send(JSON.stringify({ type: 'dashboard.update', payload: latestSummary }));
            const latestActivity = await fetchActivityFeed(context.pool, clientId, { limit: 20 });
            if (latestActivity.entries.length) {
              const newEntries = lastActivityTimestamp
                ? latestActivity.entries.filter(
                    (entry) => new Date(entry.createdAt).getTime() > new Date(lastActivityTimestamp ?? 0).getTime()
                  )
                : latestActivity.entries;
              if (newEntries.length) {
                lastActivityTimestamp = newEntries[0].createdAt;
                socket.send(JSON.stringify({ type: 'activity.append', payload: newEntries }));
              }
            }
          } catch (err) {
            // Soft fail; keep connection alive
          }
        }, 10000);

        socket.on('close', () => clearInterval(interval));
        socket.on('error', () => clearInterval(interval));
      } catch (err) {
        socket.close(1011, 'bootstrap_failed');
      }
    } catch (err) {
      socket.close(1011, 'server_error');
    }
  });

  const close = () => {
    const serverLike = wss as unknown as {
      clients?: Set<{ terminate?: () => void }>;
      close?: () => void;
    };
    try {
      serverLike.clients?.forEach((client) => {
        try {
          client.terminate?.();
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
    try {
      serverLike.close?.();
    } catch {
      // ignore
    }
  };

  return { handleRequest, handleUpgrade, close };
}
export function startMobileServer(pool: Pool, portOverride?: number) {
  if (serverStarted) {
    return;
  }
  serverStarted = true;

  const integration = createMobileIntegration(pool);
  const requestedPort =
    typeof portOverride === 'number'
      ? portOverride
      : Number(process.env.MOBILE_API_PORT || process.env.PORT || CONFIG.MOBILE.PORT || '9400');

  const server = http.createServer((req, res) => {
    integration
      .handleRequest(req, res)
      .then((handled) => {
        if (!handled && !res.writableEnded) {
          console.log('[mobile] passthrough request', req.method, req.url);
          notFound(res);
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        if (!res.writableEnded) {
          sendError(res, 500, message);
        }
        console.warn('[mobile] request failed', req.method, req.url, message);
      });
  });

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (!integration.handleUpgrade(req, socket, head)) {
      socket.destroy();
    }
  });

  server.on('close', () => {
    integration.close();
  });

  server.listen(requestedPort, () => {
    // eslint-disable-next-line no-console
    console.log(`Mobile API available at http://0.0.0.0:${requestedPort}${MOBILE_PREFIX} (standalone server)`);
  });
}
