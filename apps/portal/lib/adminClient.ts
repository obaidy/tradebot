import type { ClientMetrics } from '../../../src/contracts/mobileApi';

const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://localhost:9300';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

if (!ADMIN_API_TOKEN) {
  // eslint-disable-next-line no-console
  console.warn('[portal] ADMIN_API_TOKEN is not set. API proxy calls will fail.');
}

export class AdminApiError extends Error {
  status: number;
  detail: any;

  constructor(message: string, status: number, detail?: any) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export interface TradeApproval {
  id: number;
  correlationId: string | null;
  clientId: string;
  strategyId: string | null;
  tradeType: string;
  thresholdReason: string | null;
  amountUsd: number | null;
  status: 'pending' | 'approved' | 'rejected';
  requestedBy: string;
  requestedAt: string;
  approvedBy: string[] | null;
  approvedAt: string | null;
  metadata: Record<string, unknown> | null;
}

async function adminRequest<T = unknown>(path: string, init: RequestInit & { actor?: string } = {}): Promise<T> {
  const url = `${ADMIN_API_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ADMIN_API_TOKEN}`,
  };
  if (init.actor) {
    headers['x-actor'] = init.actor;
  }
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers as Record<string, string>),
      },
    });
  } catch (error) {
    throw new AdminApiError(
      error instanceof Error ? error.message : 'Admin API network error',
      502,
      null
    );
  }
  if (!res.ok) {
    let detail: any = null;
    try {
      detail = await res.json();
    } catch {
      // ignore
    }
    throw new AdminApiError(detail?.error || `Admin API request failed: ${res.status}` , res.status, detail);
  }
  if (res.status === 204) {
    return null as T;
  }
  return (await res.json()) as T;
}

export async function fetchPlans() {
  return adminRequest('/plans');
}

export async function fetchStrategies() {
  return adminRequest('/strategies');
}

export async function fetchStrategyCatalog() {
  return adminRequest('/strategies');
}

export async function initClient(payload: {
  id: string;
  name: string;
  owner: string;
  plan?: string;
  email?: string;
}) {
  const body: Record<string, unknown> = {
    id: payload.id,
    name: payload.name,
    owner: payload.owner,
    contact: payload.email ? { email: payload.email } : undefined,
  };
  if (payload.plan) {
    body.plan = payload.plan;
  }
  return adminRequest('/clients', {
    method: 'POST',
    body: JSON.stringify(body),
    actor: payload.email ?? payload.id,
  });
}

export async function fetchClientSnapshot(clientId: string) {
  return adminRequest(`/clients/${clientId}`);
}

export async function updateClientPlan(clientId: string, plan: string, actor: string) {
  return adminRequest(`/clients/${clientId}`, {
    method: 'PUT',
    body: JSON.stringify({ plan }),
    actor,
  });
}

export async function listCredentials(clientId: string) {
  return adminRequest(`/clients/${clientId}/credentials`);
}

export async function storeCredentials(clientId: string, actor: string, payload: {
  exchangeName: string;
  apiKey: string;
  apiSecret: string;
  passphrase?: string | null;
}) {
  return adminRequest(`/clients/${clientId}/credentials`, {
    method: 'POST',
    body: JSON.stringify(payload),
    actor,
  });
}

export async function fetchStrategySecret(clientId: string, strategyId: string) {
  return adminRequest(`/clients/${clientId}/strategies/${strategyId}/secret`);
}

export async function storeStrategySecret(
  clientId: string,
  strategyId: string,
  actor: string,
  payload: { privateKey: string }
) {
  return adminRequest(`/clients/${clientId}/strategies/${strategyId}/secret`, {
    method: 'POST',
    body: JSON.stringify(payload),
    actor,
  });
}

export async function deleteStrategySecret(clientId: string, strategyId: string, actor: string) {
  return adminRequest(`/clients/${clientId}/strategies/${strategyId}/secret`, {
    method: 'DELETE',
    actor,
  });
}

export async function listAudit(clientId: string, limit = 20) {
  return adminRequest(`/clients/${clientId}/audit?limit=${limit}`);
}

export async function triggerPaperRun(clientId: string, actor: string) {
  return adminRequest(`/clients/${clientId}/paper-run`, {
    method: 'POST',
    body: JSON.stringify({}),
    actor,
  });
}

export async function listMarketplaceStrategies(params: { owner?: string; includeStats?: boolean } = {}) {
  const search = new URLSearchParams();
  if (params.owner) search.set('owner', params.owner);
  if (params.includeStats) search.set('includeStats', 'true');
  const query = search.toString();
  return adminRequest(`/social/strategies${query ? `?${query}` : ''}`);
}

export async function createMarketplaceStrategy(payload: {
  clientId: string;
  strategyId: string;
  title: string;
  description?: string;
  config?: Record<string, unknown> | null;
  visibility?: string;
  tags?: string[];
  pricing?: Record<string, unknown> | null;
  publish?: boolean;
}) {
  return adminRequest('/social/strategies', {
    method: 'POST',
    body: JSON.stringify(payload),
    actor: payload.clientId,
  });
}

export async function updateMarketplaceStrategy(listingId: string, patch: Record<string, unknown>) {
  return adminRequest(`/social/strategies/${listingId}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteMarketplaceStrategy(listingId: string) {
  return adminRequest(`/social/strategies/${listingId}`, {
    method: 'DELETE',
  });
}

export async function adminFetchCompliance(clientId: string) {
  return adminRequest(`/clients/${clientId}/compliance`);
}

export async function adminUpdateCompliance(
  clientId: string,
  payload: { status: string; provider?: string; riskScore?: number; referenceId?: string; metadata?: Record<string, unknown> }
) {
  return adminRequest(`/clients/${clientId}/compliance`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listTradeApprovals(params: { status?: string; clientId?: string } = {}) {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.clientId) search.set('clientId', params.clientId);
  const query = search.toString();
  return adminRequest(`/approvals${query ? `?${query}` : ''}`) as Promise<TradeApproval[]>;
}

export async function approveTradeApproval(
  approvalId: number,
  options: { note?: string; metadata?: Record<string, unknown>; actor?: string } = {}
) {
  const payload: Record<string, unknown> = {};
  if (options.metadata) payload.metadata = options.metadata;
  if (options.note) payload.note = options.note;
  return adminRequest(`/approvals/${approvalId}/approve`, {
    method: 'POST',
    body: JSON.stringify(payload),
    actor: options.actor,
  }) as Promise<TradeApproval>;
}

export async function rejectTradeApproval(
  approvalId: number,
  options: { reason?: string; metadata?: Record<string, unknown>; actor?: string } = {}
) {
  const payload: Record<string, unknown> = {};
  if (options.metadata) payload.metadata = options.metadata;
  if (options.reason) payload.reason = options.reason;
  return adminRequest(`/approvals/${approvalId}/reject`, {
    method: 'POST',
    body: JSON.stringify(payload),
    actor: options.actor,
  }) as Promise<TradeApproval>;
}

export async function followStrategy(listingId: string, payload: {
  followerClientId: string;
  allocationPct?: number | null;
  settings?: Record<string, unknown> | null;
  status?: string;
}) {
  return adminRequest(`/social/strategies/${listingId}/followers`, {
    method: 'POST',
    body: JSON.stringify(payload),
    actor: payload.followerClientId,
  });
}

export async function unfollowStrategy(listingId: string, followerClientId: string) {
  return adminRequest(`/social/strategies/${listingId}/followers/${followerClientId}`, {
    method: 'DELETE',
  });
}

export async function listStrategyFollowers(listingId: string) {
  return adminRequest(`/social/strategies/${listingId}/followers`);
}

export async function fetchStrategyLeaderboard(limit = 20) {
  return adminRequest(`/social/leaderboard?limit=${limit}`);
}

export async function listTournaments() {
  return adminRequest('/social/tournaments');
}

export async function createTournament(payload: {
  id?: string;
  name: string;
  description?: string;
  status?: string;
  startsAt?: string;
  endsAt?: string;
  prizePoolUsd?: number;
  metadata?: Record<string, unknown> | null;
}) {
  return adminRequest('/social/tournaments', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTournament(id: string, payload: Record<string, unknown>) {
  return adminRequest(`/social/tournaments/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export async function listTournamentEntries(tournamentId: string) {
  return adminRequest(`/social/tournaments/${tournamentId}/entries`);
}

export async function upsertTournamentEntry(tournamentId: string, payload: Record<string, unknown>) {
  return adminRequest(`/social/tournaments/${tournamentId}/entries`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function runClientStrategy(payload: {
  clientId: string;
  actor: string;
  strategyId: string;
  runMode?: string;
  pair?: string;
  config?: Record<string, unknown>;
}) {
  const body: Record<string, unknown> = {
    strategyId: payload.strategyId,
    runMode: payload.runMode,
    pair: payload.pair,
    config: payload.config,
  };
  return adminRequest(`/clients/${payload.clientId}/run`, {
    method: 'POST',
    body: JSON.stringify(body),
    actor: payload.actor,
  });
}

export async function fetchMetrics(clientId: string): Promise<ClientMetrics> {
  return adminRequest<ClientMetrics>(`/clients/${clientId}/metrics`);
}

export async function fetchWorkers(clientId: string) {
  return adminRequest(`/clients/${clientId}/workers`);
}

export async function fetchClientPortfolio(clientId: string) {
  return adminRequest(`/clients/${clientId}/portfolio`);
}

export async function updateClientPortfolio(
  clientId: string,
  payload: { allocations: Array<Record<string, unknown>> },
  actor: string
) {
  return adminRequest(`/clients/${clientId}/portfolio`, {
    method: 'PUT',
    body: JSON.stringify(payload),
    actor,
  });
}

export async function deleteClientPortfolioStrategy(clientId: string, strategyId: string, actor: string) {
  return adminRequest(`/clients/${clientId}/portfolio/${strategyId}`, {
    method: 'DELETE',
    actor,
  });
}

export async function pauseClient(clientId: string, actor: string) {
  return adminRequest(`/clients/${clientId}/pause`, {
    method: 'POST',
    actor,
  });
}

export async function resumeClient(clientId: string, actor: string) {
  return adminRequest(`/clients/${clientId}/resume`, {
    method: 'POST',
    actor,
  });
}

export async function killClient(clientId: string, actor: string) {
  return adminRequest(`/clients/${clientId}/kill`, {
    method: 'POST',
    actor,
  });
}

export async function createBillingSessionForClient(payload: {
  clientId: string;
  planId: string;
  actor: string;
  successUrl: string;
  cancelUrl: string;
  trialDays?: number;
}) {
  return adminRequest('/billing/session', {
    method: 'POST',
    body: JSON.stringify({
      clientId: payload.clientId,
      planId: payload.planId,
      successUrl: payload.successUrl,
      cancelUrl: payload.cancelUrl,
      trialDays: payload.trialDays,
    }),
    actor: payload.actor,
  });
}

export async function syncBillingSession(payload: { sessionId: string; actor: string }) {
  return adminRequest('/billing/session/sync', {
    method: 'POST',
    body: JSON.stringify({ sessionId: payload.sessionId }),
    actor: payload.actor,
  });
}

export async function createBillingPortalSessionForClient(payload: {
  clientId: string;
  actor: string;
  returnUrl: string;
}) {
  return adminRequest('/billing/portal', {
    method: 'POST',
    body: JSON.stringify({
      clientId: payload.clientId,
      returnUrl: payload.returnUrl,
    }),
    actor: payload.actor,
  });
}

export async function listBillingStatus() {
  return adminRequest('/billing/status');
}

export async function fetchAdminSummary() {
  return adminRequest('/metrics/summary');
}

export async function cancelSubscriptionForClient(payload: {
  clientId: string;
  actor: string;
  cancelAtPeriodEnd?: boolean;
}) {
  return adminRequest('/billing/cancel', {
    method: 'POST',
    body: JSON.stringify({
      clientId: payload.clientId,
      cancelAtPeriodEnd: payload.cancelAtPeriodEnd ?? false,
    }),
    actor: payload.actor,
  });
}

export async function fetchClientHistory(clientId: string) {
  return adminRequest(`/clients/${clientId}/history`);
}

export async function fetchClientAgreements(clientId: string) {
  return adminRequest(`/clients/${clientId}/agreements`);
}

export async function acceptClientAgreements(
  clientId: string,
  actor: string,
  documents: Array<{ documentType: string; version: string }>,
  ipAddress?: string
) {
  return adminRequest(`/clients/${clientId}/agreements`, {
    method: 'POST',
    body: JSON.stringify({ documents, ipAddress }),
    actor,
  });
}

export async function fetchLegalDocument(slug: string) {
  return adminRequest(`/legal/${slug}`);
}

export async function ensureChatConversation(payload: {
  clientId: string;
  subject?: string | null;
}) {
  return adminRequest('/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({ clientId: payload.clientId, subject: payload.subject ?? null }),
    actor: payload.clientId,
  });
}

export async function listChatConversations(payload: {
  status?: string;
  clientId?: string;
  orgId?: string;
  limit?: number;
}) {
  const params = new URLSearchParams();
  if (payload.status) params.append('status', payload.status);
  if (payload.clientId) params.append('clientId', payload.clientId);
  if (payload.orgId) params.append('orgId', payload.orgId);
  if (payload.limit) params.append('limit', String(payload.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return adminRequest(`/chat/conversations${suffix}`);
}

export async function fetchChatConversation(conversationId: string) {
  return adminRequest(`/chat/conversations/${conversationId}`);
}

export async function postChatMessage(payload: {
  conversationId: string;
  senderType: 'client' | 'agent' | 'bot' | 'system';
  senderId?: string;
  body: string;
}) {
  return adminRequest(`/chat/conversations/${payload.conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      senderType: payload.senderType,
      senderId: payload.senderId,
      body: payload.body,
    }),
    actor: payload.senderId ?? payload.senderType,
  });
}

export async function updateChatConversationStatus(payload: { conversationId: string; status: string }) {
  return adminRequest(`/chat/conversations/${payload.conversationId}/status`, {
    method: 'POST',
    body: JSON.stringify({ status: payload.status }),
    actor: payload.status,
  });
}

export async function claimChatConversation(payload: { conversationId: string; agentId: string; agentName?: string }) {
  return adminRequest(`/chat/conversations/${payload.conversationId}/claim`, {
    method: 'POST',
    body: JSON.stringify({ agentId: payload.agentId, agentName: payload.agentName }),
    actor: payload.agentId,
  });
}
