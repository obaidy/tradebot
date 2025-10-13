const ADMIN_API_URL = process.env.ADMIN_API_URL || 'http://localhost:9300';
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN;

if (!ADMIN_API_TOKEN) {
  // eslint-disable-next-line no-console
  console.warn('[portal] ADMIN_API_TOKEN is not set. Raw admin API calls may fail.');
}

export async function adminRequestRaw(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${ADMIN_API_TOKEN}`,
  };
  return fetch(`${ADMIN_API_URL}${path}`, {
    ...init,
    headers: {
      ...headers,
      ...(init.headers as Record<string, string>),
    },
  });
}
