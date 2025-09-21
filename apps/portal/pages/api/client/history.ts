import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { fetchClientHistory } from '../../../lib/adminClient';

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
    const history = await fetchClientHistory(session.user.id);
    res.status(200).json(history);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'history_fetch_failed' });
  }
}
