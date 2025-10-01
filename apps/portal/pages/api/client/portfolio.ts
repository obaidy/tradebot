import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { fetchClientPortfolio, updateClientPortfolio } from '../../../lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const clientId = session.user.id;

  if (req.method === 'GET') {
    try {
      const portfolio = await fetchClientPortfolio(clientId);
      res.status(200).json(portfolio);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'portfolio_fetch_failed' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
      if (!Array.isArray(body.allocations)) {
        res.status(400).json({ error: 'allocations_array_required' });
        return;
      }
      const actor = session.user.email ?? clientId;
      const updated = await updateClientPortfolio(clientId, { allocations: body.allocations }, actor);
      res.status(200).json(updated);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'portfolio_update_failed' });
    }
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
}
