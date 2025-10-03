import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { getPool } from '../../../../../src/db/pool';
import { PerformanceAnalyticsService } from '../../../../../src/services/analytics/performanceAnalytics';
import {
  analyticsSharpeGauge,
  analyticsMaxDrawdownGauge,
  analyticsWinRateGauge,
  analyticsSlippageGauge,
  analyticsFillRateGauge,
} from '../../../../../src/telemetry/analyticsMetrics';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const clientId = session.user.id;
    const pool = getPool();
    const analyticsService = new PerformanceAnalyticsService(pool, clientId);
    const snapshot = await analyticsService.fetchAnalytics({
      lookbackDays: Number(req.query.lookbackDays || 30),
    });

    analyticsSharpeGauge.labels(clientId).set(snapshot.performance.sharpeRatio ?? 0);
    analyticsMaxDrawdownGauge.labels(clientId).set(snapshot.performance.maxDrawdownUsd ?? 0);
    analyticsWinRateGauge.labels(clientId).set(snapshot.performance.winRate ?? 0);
    analyticsSlippageGauge.labels(clientId).set(snapshot.execution.avgSlippageBps ?? 0);
    analyticsFillRateGauge.labels(clientId).set(snapshot.execution.fillRatePct ?? 0);

    return res.status(200).json(snapshot);
  } catch (error) {
    console.error('[analytics] summary_error', error);
    return res.status(500).json({ error: 'failed_to_compute_analytics' });
  }
}
