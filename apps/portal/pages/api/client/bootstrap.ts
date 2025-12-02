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
import type { ClientSnapshot, PortfolioAllocation } from '../../../types/portal';
import { getSessionClientId } from '../../../lib/sessionClient';

async function safeCall<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    console.warn('[portal] bootstrap call failed', err);
    return fallback;
  }
}

function isSnapshotPayload(payload: unknown): payload is ClientSnapshot {
  return Boolean(
    payload &&
      typeof payload === 'object' &&
      Array.isArray((payload as ClientSnapshot).credentials)
  );
}

function getAllocations(payload: unknown): PortfolioAllocation[] {
  if (payload && typeof payload === 'object' && Array.isArray((payload as any).allocations)) {
    return (payload as { allocations: PortfolioAllocation[] }).allocations;
  }
  return [];
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
      safeCall(fetchClientSnapshot(clientId), null),
      safeCall(fetchClientPortfolio(clientId), null),
      safeCall(fetchClientHistory(clientId), null),
      safeCall(fetchMetrics(clientId), null),
    ]);
    const snapshotData = isSnapshotPayload(snapshot) ? snapshot : null;
    const credentialCount = snapshotData?.credentials?.length ?? 0;
    const portfolioData = (portfolio && typeof portfolio === 'object' ? (portfolio as Record<string, unknown>) : null) || null;
    const allocations = getAllocations(portfolioData ?? undefined);
    const hasActiveBots = allocations.some((allocation) => allocation.enabled);
    res.status(200).json({
      plans,
      strategies,
      snapshot: snapshotData,
      portfolio: portfolioData ? { ...portfolioData, allocations } : { allocations },
      history,
      metrics,
      needsOnboarding: credentialCount === 0,
      hasActiveBots,
    });
  } catch (err) {
    res.status(500).json({ error: 'bootstrap_failed', detail: err instanceof Error ? err.message : 'unknown_error' });
  }
}
