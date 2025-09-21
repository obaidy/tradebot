import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { listAudit } from '../../../lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const limit = parseInt((req.query.limit as string) ?? '20', 10);
    const entries = await listAudit(session.user.id, Number.isNaN(limit) ? 20 : limit);
    res.status(200).json(entries);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'audit_fetch_failed' });
  }
}
