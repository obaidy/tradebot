import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { updateChatConversationStatus } from '@/lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
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
  const status = typeof req.body?.status === 'string' ? req.body.status : '';
  if (!status) {
    res.status(400).json({ error: 'status_required' });
    return;
  }
  const response = await updateChatConversationStatus({ conversationId, status });
  res.status(200).json(response);
}
