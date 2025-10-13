import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { adminFetchCompliance } from '@/lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  const clientId = Array.isArray(req.query.clientId) ? req.query.clientId[0] : req.query.clientId;
  if (!clientId) {
    res.status(400).json({ error: 'client_id_required' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const record = await adminFetchCompliance(clientId);
      res.status(200).json(record ?? {});
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'compliance_fetch_failed' });
    }
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
}
