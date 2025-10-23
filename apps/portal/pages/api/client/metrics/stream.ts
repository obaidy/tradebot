import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { fetchMetrics } from '@/lib/adminClient';
import { getSessionClientId } from '@/lib/sessionClient';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n');

  const send = async () => {
    try {
      const metrics = await fetchMetrics(clientId);
      res.write(`data: ${JSON.stringify({ ...metrics, timestamp: Date.now() })}\n\n`);
    } catch (err) {
      res.write(`event: error\ndata: ${JSON.stringify({ error: err instanceof Error ? err.message : 'metrics_failed' })}\n\n`);
    }
  };

  const interval = setInterval(() => {
    send();
  }, 5000);

  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });

  await send();
}
