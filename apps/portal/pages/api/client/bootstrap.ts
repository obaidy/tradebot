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
    type SnapshotPayload = Awaited<ReturnType<typeof fetchClientSnapshot>>;
    type PortfolioPayload = Awaited<ReturnType<typeof fetchClientPortfolio>>;
    type HistoryPayload = Awaited<ReturnType<typeof fetchClientHistory>>;
    type MetricsPayload = Awaited<ReturnType<typeof fetchMetrics>>;

    const [plans, strategies, snapshot, portfolio, history, metrics] = await Promise.all([
      safeCall(fetchPlans(), []),
      safeCall(fetchStrategies(), []),
      safeCall<SnapshotPayload | null>(fetchClientSnapshot(clientId), null),
      safeCall<PortfolioPayload | null>(fetchClientPortfolio(clientId), null),
      safeCall<HistoryPayload | null>(fetchClientHistory(clientId), null),
      safeCall<MetricsPayload | null>(fetchMetrics(clientId), null),
    ]);
    const snapshotData = snapshot as SnapshotPayload | null;
    const portfolioData = portfolio as PortfolioPayload | null;
    const credentialCount = snapshotData?.credentials?.length ?? 0;
    const allocations = (portfolioData?.allocations ?? []) as Array<{ enabled?: boolean }>;
    const hasActiveBots = allocations.some((allocation) => allocation.enabled);
    res.status(200).json({
      plans,
      strategies,
      snapshot: snapshotData,
      portfolio: portfolioData,
      history,
      metrics,
      needsOnboarding: credentialCount === 0,
      hasActiveBots,
    });
  } catch (err) {
    res.status(500).json({ error: 'bootstrap_failed', detail: err instanceof Error ? err.message : 'unknown_error' });
  }
}
