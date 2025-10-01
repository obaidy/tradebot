import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { cancelSubscriptionForClient } from '../../../../lib/adminClient';

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
    const body = typeof req.body === 'string' && req.body.length
      ? JSON.parse(req.body)
      : req.body ?? {};
    const actor = session.user.email ?? session.user.id;
    const result = await cancelSubscriptionForClient({
      clientId: session.user.id,
      actor,
      cancelAtPeriodEnd: Boolean(body.cancelAtPeriodEnd ?? body.cancel_at_period_end ?? false),
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'billing_cancel_failed' });
  }
}
