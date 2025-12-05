import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import {
  fetchClientBots,
  fetchClientHistory,
  fetchClientPortfolio,
  fetchClientSnapshot,
  fetchMetrics,
  fetchPlans,
  fetchStrategies,
  initClient,
} from '../../../lib/adminClient';
import type { ClientSnapshot, PortfolioAllocation, ClientBot } from '../../../types/portal';
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
    const snapshotPromise = safeCall<ClientSnapshot | null>(
      fetchClientSnapshot(clientId) as Promise<ClientSnapshot>,
      null
    );
    const [plans, strategies, snapshot, portfolio, history, metrics, bots] = await Promise.all([
      safeCall(fetchPlans(), []),
      safeCall(fetchStrategies(), []),
      snapshotPromise,
      safeCall(fetchClientPortfolio(clientId), null),
      safeCall(fetchClientHistory(clientId), null),
      safeCall(fetchMetrics(clientId), null),
      safeCall<ClientBot[]>(fetchClientBots(clientId), []),
    ]);
    const credentialCount = snapshot?.credentials?.length ?? 0;
    const portfolioData = portfolio && typeof portfolio === 'object' ? (portfolio as Record<string, unknown>) : null;
    const allocations: PortfolioAllocation[] = Array.isArray((portfolioData as any)?.allocations)
      ? ((portfolioData as any).allocations as PortfolioAllocation[])
      : [];
    const hasActiveBots = bots.some((bot) => bot.status === 'active');
    res.status(200).json({
      plans,
      strategies,
      snapshot,
      portfolio: portfolioData ? { ...portfolioData, allocations } : { allocations },
      history,
      metrics,
      bots,
      bots,
      needsOnboarding: credentialCount === 0,
      hasActiveBots,
    });
  } catch (err) {
    res.status(500).json({ error: 'bootstrap_failed', detail: err instanceof Error ? err.message : 'unknown_error' });
  }
}
