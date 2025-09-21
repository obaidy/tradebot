import type { NextApiRequest, NextApiResponse } from 'next';
import { fetchPlans } from '../../../lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  try {
    const plans = await fetchPlans();
    res.status(200).json(plans);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'plan_fetch_failed' });
  }
}
