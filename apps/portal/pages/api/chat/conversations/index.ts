import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { ensureChatConversation, listChatConversations } from '@/lib/adminClient';
import { getSessionClientId } from '@/lib/sessionClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.method === 'POST') {
    const subject = typeof req.body?.subject === 'string' ? req.body.subject : null;
    const response = await ensureChatConversation({ clientId, subject });
    res.status(201).json(response);
    return;
  }
  if (req.method === 'GET') {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const response = await listChatConversations({ clientId, status, limit: 20 });
    res.status(200).json(response);
    return;
  }
  res.setHeader('Allow', 'GET,POST');
  res.status(405).json({ error: 'method_not_allowed' });
}
