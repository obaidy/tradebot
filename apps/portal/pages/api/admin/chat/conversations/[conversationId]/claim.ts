import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { claimChatConversation, AdminApiError } from '@/lib/adminClient';

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
  try {
    await claimChatConversation({
      conversationId,
      agentId: session.user.id,
      agentName: session.user.name ?? session.user.email ?? session.user.id,
    });
    res.status(200).json({ ok: true });
  } catch (error) {
    if (error instanceof AdminApiError) {
      res.status(error.status || 502).json({ error: error.message });
      return;
    }
    res.status(502).json({ error: error instanceof Error ? error.message : 'admin_proxy_failed' });
  }
}
