import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { syncBillingSession } from '@/lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const sessionId = body?.sessionId || body?.session_id;
    if (!sessionId) {
      res.status(400).json({ error: 'session_id_required' });
      return;
    }
    const actor = session.user.email ?? session.user.id;
    const result = await syncBillingSession({ sessionId, actor });
    res.status(200).json(result ?? { status: 'synced' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'billing_sync_failed' });
  }
}
