import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { runClientStrategy } from '../../../lib/adminClient';

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
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
    const strategyId = body.strategyId ?? body.strategy_id;
    if (!strategyId) {
      res.status(400).json({ error: 'strategy_id_required' });
      return;
    }
    const payload = await runClientStrategy({
      clientId: session.user.id,
      actor: session.user.email ?? session.user.id,
      strategyId,
      runMode: body.runMode ?? body.run_mode,
      pair: body.pair,
      config: body.config,
    });
    res.status(202).json(payload ?? { status: 'queued' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'strategy_run_failed' });
  }
}
