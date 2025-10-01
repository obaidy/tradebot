import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { deleteClientPortfolioStrategy } from '@/lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const clientId = Array.isArray(req.query.clientId) ? req.query.clientId[0] : req.query.clientId;
  const strategyId = Array.isArray(req.query.strategyId) ? req.query.strategyId[0] : req.query.strategyId;

  if (!clientId || !strategyId) {
    res.status(400).json({ error: 'client_and_strategy_required' });
    return;
  }

  try {
    const actor = session.user.email ?? session.user.id;
    await deleteClientPortfolioStrategy(clientId, strategyId, actor);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'portfolio_delete_failed' });
  }
}
