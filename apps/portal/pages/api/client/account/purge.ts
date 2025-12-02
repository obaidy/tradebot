import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { listCredentials, deleteCredentials, pauseClient } from '../../../../lib/adminClient';
import { getSessionClientId } from '../../../../lib/sessionClient';

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
    const actor = session?.user?.email ?? clientId;
    const creds = await listCredentials(clientId);
    for (const cred of creds) {
      await deleteCredentials(clientId, cred.exchangeName, actor);
    }
    await pauseClient(clientId, actor);
    res.status(200).json({ status: 'purged' });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'account_purge_failed' });
  }
}

