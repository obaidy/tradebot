import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { deleteClientBot, fetchClientBots, updateClientBot } from '../../../../lib/adminClient';
import { getSessionClientId } from '../../../../lib/sessionClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const botId = Array.isArray(req.query.botId) ? req.query.botId[0] : req.query.botId;
  if (!botId) {
    res.status(400).json({ error: 'bot_id_required' });
    return;
  }
  const actor = session?.user?.email ?? clientId;
  if (req.method === 'PATCH') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
      const patch: Record<string, unknown> = {};
      if (typeof body.status === 'string') {
        patch.status = body.status;
      }
      if (typeof body.mode === 'string') {
        patch.mode = body.mode;
      }
      if (body.config && typeof body.config === 'object') {
        patch.config = body.config;
      }
      await updateClientBot(clientId, botId, actor, patch);
      const bots = await fetchClientBots(clientId);
      res.status(200).json({ bots });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'bot_update_failed' });
    }
    return;
  }
  if (req.method === 'DELETE') {
    try {
      await deleteClientBot(clientId, botId, actor);
      const bots = await fetchClientBots(clientId);
      res.status(200).json({ bots });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'bot_delete_failed' });
    }
    return;
  }
  res.status(405).json({ error: 'method_not_allowed' });
}

