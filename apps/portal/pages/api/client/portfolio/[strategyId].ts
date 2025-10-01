import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { deleteClientPortfolioStrategy } from '../../../../lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (req.method !== 'DELETE') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const strategyId = Array.isArray(req.query.strategyId) ? req.query.strategyId[0] : req.query.strategyId;
  if (!strategyId) {
    res.status(400).json({ error: 'strategy_id_required' });
    return;
  }

  try {
    const actor = session.user.email ?? session.user.id;
    await deleteClientPortfolioStrategy(session.user.id, strategyId, actor);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'portfolio_delete_failed' });
  }
}
