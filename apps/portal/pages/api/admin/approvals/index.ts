import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { listTradeApprovals } from '@/lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const clientId = typeof req.query.clientId === 'string' ? req.query.clientId : undefined;
      const approvals = await listTradeApprovals({ status, clientId });
      res.status(200).json(approvals);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'approvals_fetch_failed' });
    }
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
}
