import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { createClientBot, fetchClientBots, fetchClientSnapshot } from '../../../../lib/adminClient';
import { getSessionClientId } from '../../../../lib/sessionClient';
import type { ClientSnapshot } from '../../../../types/portal';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.method === 'GET') {
    try {
      const bots = await fetchClientBots(clientId);
      res.status(200).json({ bots });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'bots_fetch_failed' });
    }
    return;
  }
  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
      const strategyId = typeof body.strategyId === 'string' ? body.strategyId : '';
      const pair = typeof body.pair === 'string' ? body.pair : '';
      const allocationUsd = Number(body.allocationUsd);
      const mode = 'paper';
      const riskPreset = typeof body.riskPreset === 'string' ? body.riskPreset : 'balanced';
      const exchangeId = typeof body.exchangeId === 'string' ? body.exchangeId : 'binance';
      if (!strategyId) {
        res.status(400).json({ error: 'strategy_id_required' });
        return;
      }
      if (!pair) {
        res.status(400).json({ error: 'pair_required' });
        return;
      }
      if (!Number.isFinite(allocationUsd) || allocationUsd <= 0) {
        res.status(400).json({ error: 'allocation_invalid' });
        return;
      }
      const snapshot = (await fetchClientSnapshot(clientId)) as ClientSnapshot | null;
      const bankrollUsd =
        Number(((snapshot?.client?.limits ?? {}) as any)?.risk?.bankrollUsd) ||
        Number((snapshot?.client as any)?.bankrollUsd) ||
        1000;
      const actor = session?.user?.email ?? clientId;
      await createClientBot(clientId, actor, {
        templateKey: strategyId,
        symbol: pair,
        mode,
        exchangeName: exchangeId,
        config: {
          pair,
          allocationUsd,
          riskPreset,
          bankrollUsd,
        },
      });
      const bots = await fetchClientBots(clientId);
      res.status(201).json({ bots });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'bot_create_failed' });
    }
    return;
  }
  res.status(405).json({ error: 'method_not_allowed' });
}
