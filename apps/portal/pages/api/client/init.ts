import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { initClient } from '../../../lib/adminClient';
import { getSessionClientId } from '../../../lib/sessionClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const plan = body?.plan;
    const name = body?.name ?? session.user.name ?? 'Unnamed Client';
    const owner = body?.owner ?? session.user?.email ?? clientId;
    const client = await initClient({ id: clientId, name, owner, plan, email: session.user?.email ?? undefined });
    res.status(200).json(client);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'init_failed' });
  }
}
