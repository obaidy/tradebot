import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { getSessionClientId } from '@/lib/sessionClient';

const adminUrl = process.env.ADMIN_API_URL;
const adminToken = process.env.ADMIN_API_TOKEN;

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).end();
    return;
  }
  if (!adminUrl || !adminToken) {
    res.status(500).json({ error: 'chat_backend_not_configured' });
    return;
  }
  const { conversationId } = req.query;
  if (typeof conversationId !== 'string') {
    res.status(400).json({ error: 'conversation_id_required' });
    return;
  }

  const upstreamUrl = new URL(`/chat/conversations/${conversationId}/transcript`, adminUrl);
  const protocol = upstreamUrl.protocol === 'https:' ? require('https') : require('http');
  const upstreamReq = protocol.request(
    upstreamUrl,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-actor': session?.user?.email ?? clientId ?? 'portal-client',
      },
    },
    (upstreamRes: any) => {
      res.writeHead(upstreamRes.statusCode ?? 500, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );
  upstreamReq.on('error', (error: Error) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  });
  upstreamReq.end();
}
