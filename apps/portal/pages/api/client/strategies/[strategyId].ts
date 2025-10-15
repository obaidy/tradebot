import type { NextApiRequest, NextApiResponse } from 'next';
import { withClientAuth } from '../../../../lib/withClientAuth';
import {
  updateClientStrategyAllocation,
  deleteClientStrategyAllocationById,
} from '../../../../lib/clientStrategies';

export default withClientAuth(async (req: NextApiRequest, res: NextApiResponse) => {
  const { strategyId } = req.query;
  if (typeof strategyId !== 'string' || !strategyId.length) {
    res.status(400).json({ error: 'strategy_id_required' });
    return;
  }

  if (req.method === 'PUT') {
    try {
      const allocation = await updateClientStrategyAllocation(req.session.user.id, strategyId, req.body ?? {});
      res.status(200).json(allocation);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'strategy_update_failed' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    try {
      await deleteClientStrategyAllocationById(req.session.user.id, strategyId);
      res.status(204).end();
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'strategy_delete_failed' });
    }
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
});
