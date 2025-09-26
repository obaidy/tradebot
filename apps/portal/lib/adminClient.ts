const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://localhost:9300';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

if (!ADMIN_API_TOKEN) {
  // eslint-disable-next-line no-console
  console.warn('[portal] ADMIN_API_TOKEN is not set. API proxy calls will fail.');
}

async function adminRequest(path: string, init: RequestInit & { actor?: string } = {}) {
  const url = `${ADMIN_API_URL}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ADMIN_API_TOKEN}`,
  };
  if (init.actor) {
    headers['x-actor'] = init.actor;
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    let detail: any = null;
    try {
      detail = await res.json();
    } catch {
      // ignore
    }
    throw new Error(detail?.error || `Admin API request failed: ${res.status}`);
  }
  if (res.status === 204) {
    return null;
  }
  return res.json();
}

export async function fetchPlans() {
  return adminRequest('/plans');
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

export async function fetchMetrics(clientId: string) {
  return adminRequest(`/clients/${clientId}/metrics`);
}

export async function fetchWorkers(clientId: string) {
  return adminRequest(`/clients/${clientId}/workers`);
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
