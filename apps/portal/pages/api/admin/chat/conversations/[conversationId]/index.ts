import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { fetchChatConversation, AdminApiError } from '@/lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const { conversationId } = req.query;
  if (typeof conversationId !== 'string') {
    res.status(400).json({ error: 'conversation_id_required' });
    return;
  }
  try {
    const data = await fetchChatConversation(conversationId);
    res.status(200).json(data);
  } catch (error) {
    if (error instanceof AdminApiError) {
      res.status(error.status || 502).json({ error: error.message });
      return;
    }
    res.status(502).json({ error: error instanceof Error ? error.message : 'admin_proxy_failed' });
  }
}
