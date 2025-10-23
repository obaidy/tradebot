import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { getSessionClientId } from '../../../lib/sessionClient';

type PerformanceSummary = {
  runCount: number;
  totalNetPnlUsd: number;
  avgNetPnlUsd: number;
  sharpeRatio: number | null;
  maxDrawdownUsd: number | null;
  winRate: number | null;
  avgHoldingHours: number | null;
};

type TradeExecutionStats = {
  avgSlippageBps: number | null;
  medianSlippageBps: number | null;
  fillRatePct: number | null;
  avgFillDurationSec: number | null;
};

type AnalyticsSnapshot = {
  performance: PerformanceSummary;
  execution: TradeExecutionStats;
  correlations: Array<{ assetA: string; assetB: string; correlation: number }>;
};

const EMPTY_SNAPSHOT: AnalyticsSnapshot = {
  performance: {
    runCount: 0,
    totalNetPnlUsd: 0,
    avgNetPnlUsd: 0,
    sharpeRatio: null,
    maxDrawdownUsd: null,
    winRate: null,
    avgHoldingHours: null,
  },
  execution: {
    avgSlippageBps: null,
    medianSlippageBps: null,
    fillRatePct: null,
    avgFillDurationSec: null,
  },
  correlations: [],
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const lookbackDays = Number(req.query.lookbackDays || 30);
    const baseUrl = process.env.ADMIN_API_URL;
    const adminToken = process.env.ADMIN_API_TOKEN;

    if (baseUrl && adminToken) {
      const response = await fetch(`${baseUrl.replace(/\/$/, '')}/analytics/summary`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ clientId, lookbackDays }),
      });

      if (response.ok) {
        const payload = (await response.json()) as AnalyticsSnapshot;
        return res.status(200).json(payload);
      }
    }

    return res.status(200).json(EMPTY_SNAPSHOT);
  } catch (error) {
    console.error('[analytics] summary_error', error);
    return res.status(500).json({ error: 'failed_to_compute_analytics' });
  }
}
