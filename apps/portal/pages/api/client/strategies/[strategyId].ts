import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import {
  fetchStrategySecret,
  storeStrategySecret,
  deleteStrategySecret,
} from '../../../../lib/adminClient';

function normalizeStrategyId(strategyId: string | string[] | undefined) {
  if (!strategyId) return null;
  const value = Array.isArray(strategyId) ? strategyId[0] : strategyId;
  return value?.toLowerCase() ?? null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const strategyId = normalizeStrategyId(req.query.strategyId);
  if (!strategyId) {
    res.status(400).json({ error: 'strategy_id_required' });
    return;
  }

  const clientId = session.user.id;

  if (req.method === 'GET') {
    try {
      const summary = await fetchStrategySecret(clientId, strategyId);
      res.status(200).json(summary ?? { hasSecret: false });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'strategy_secret_fetch_failed' });
    }
    return;
  }

  if (strategyId !== 'mev') {
    res.status(405).json({ error: 'not_supported_for_strategy' });
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
      const privateKey = typeof body.privateKey === 'string' ? body.privateKey.trim() : '';
      if (!privateKey) {
        res.status(400).json({ error: 'private_key_required' });
        return;
      }
      const response = await storeStrategySecret(clientId, strategyId, session.user.email ?? clientId, { privateKey });
      res.status(201).json(response ?? { hasSecret: true });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'strategy_secret_store_failed' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      await deleteStrategySecret(clientId, strategyId, session.user.email ?? clientId);
      res.status(200).json({ hasSecret: false });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'strategy_secret_delete_failed' });
    }
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
}
