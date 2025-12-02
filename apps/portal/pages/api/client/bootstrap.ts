import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import {
  fetchClientHistory,
  fetchClientPortfolio,
  fetchClientSnapshot,
  fetchMetrics,
  fetchPlans,
  fetchStrategies,
  initClient,
} from '../../../lib/adminClient';
import { getSessionClientId } from '../../../lib/sessionClient';

async function safeCall<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    console.warn('[portal] bootstrap call failed', err);
    return fallback;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    await initClient({
      id: clientId,
      name: session?.user?.name ?? clientId,
      owner: session?.user?.email ?? clientId,
      email: session?.user?.email ?? undefined,
    });
  } catch (err) {
    console.warn('[portal] init client failed', err);
  }
  try {
    const [plans, strategies, snapshot, portfolio, history, metrics] = await Promise.all([
      safeCall(fetchPlans(), []),
      safeCall(fetchStrategies(), []),
      safeCall<Awaited<ReturnType<typeof fetchClientSnapshot>> | null>(fetchClientSnapshot(clientId), null),
      safeCall<Awaited<ReturnType<typeof fetchClientPortfolio>> | null>(fetchClientPortfolio(clientId), null),
      safeCall<Awaited<ReturnType<typeof fetchClientHistory>> | null>(fetchClientHistory(clientId), null),
      safeCall<Awaited<ReturnType<typeof fetchMetrics>> | null>(fetchMetrics(clientId), null),
    ]);
    const credentialCount = snapshot?.credentials?.length ?? 0;
    const allocations = portfolio?.allocations ?? [];
    const hasActiveBots = allocations.some((allocation: any) => allocation.enabled);
    res.status(200).json({
      plans,
      strategies,
      snapshot,
      portfolio,
      history,
      metrics,
      needsOnboarding: credentialCount === 0,
      hasActiveBots,
    });
  } catch (err) {
    res.status(500).json({ error: 'bootstrap_failed', detail: err instanceof Error ? err.message : 'unknown_error' });
  }
}
