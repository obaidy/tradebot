import type { NextApiRequest, NextApiResponse } from 'next';
import { withClientAuth } from '../../../../lib/withClientAuth';
import { listStrategiesForClient } from '../../../../lib/clientStrategies';

export default withClientAuth(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  try {
    const strategies = await listStrategiesForClient(req.session.user.id);
    res.status(200).json(strategies);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'strategy_fetch_failed' });
  }
});
