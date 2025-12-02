import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { deleteCredentials } from '../../../../lib/adminClient';
import { getSessionClientId } from '../../../../lib/sessionClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const exchangeParam = Array.isArray(req.query.exchange) ? req.query.exchange[0] : req.query.exchange;
  if (!exchangeParam) {
    res.status(400).json({ error: 'exchange_required' });
    return;
  }
  try {
    const actor = session?.user?.email ?? clientId;
    await deleteCredentials(clientId, exchangeParam, actor);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'credentials_delete_failed' });
  }
}

