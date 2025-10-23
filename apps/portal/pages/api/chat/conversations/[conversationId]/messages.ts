import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { postChatMessage } from '@/lib/adminClient';
import { getSessionClientId } from '@/lib/sessionClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const { conversationId } = req.query;
  if (typeof conversationId !== 'string') {
    res.status(400).json({ error: 'conversation_id_required' });
    return;
  }
  const body = typeof req.body?.body === 'string' ? req.body.body : '';
  if (!body.trim()) {
    res.status(400).json({ error: 'message_body_required' });
    return;
  }
  const data = await postChatMessage({
    conversationId,
    senderType: 'client',
    senderId: clientId,
    body,
  });
  res.status(201).json(data);
}
