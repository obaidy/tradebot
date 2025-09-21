import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { updateClientPlan } from '../../../lib/adminClient';

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
    const plan = body?.plan;
    if (!plan) {
      res.status(400).json({ error: 'plan_required' });
      return;
    }
    const result = await updateClientPlan(session.user.id, plan, session.user.email ?? session.user.id);
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'plan_update_failed' });
  }
}
