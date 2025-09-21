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
  plan: string;
  email?: string;
}) {
  return adminRequest('/clients', {
    method: 'POST',
    body: JSON.stringify({
      id: payload.id,
      name: payload.name,
      owner: payload.owner,
      plan: payload.plan,
      contact: payload.email ? { email: payload.email } : undefined,
    }),
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
