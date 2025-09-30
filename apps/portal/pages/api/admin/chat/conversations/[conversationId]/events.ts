import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';

const adminUrl = process.env.ADMIN_API_URL;
const adminToken = process.env.ADMIN_API_TOKEN;

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
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

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  const upstreamUrl = new URL(`/chat/conversations/${conversationId}/events`, adminUrl);
  const protocol = upstreamUrl.protocol === 'https:' ? require('https') : require('http');
  const upstreamReq = protocol.request(
    upstreamUrl,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'x-actor': session.user.email ?? session.user.id ?? 'admin-agent',
      },
    },
    (upstreamRes: any) => {
      upstreamRes.on('data', (chunk: Buffer) => {
        res.write(chunk);
      });
      upstreamRes.on('end', () => {
        res.end();
      });
    }
  );

  upstreamReq.on('error', (error: Error) => {
    res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
  });
  upstreamReq.end();

  const heartbeat = setInterval(() => {
    res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    upstreamReq.destroy();
    res.end();
  });
}
