import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { adminRequestRaw } from '@/lib/adminClientRaw';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const params = new URLSearchParams();
  if (typeof req.query.format === 'string') params.set('format', req.query.format);
  if (typeof req.query.clientId === 'string') params.set('clientId', req.query.clientId);
  if (typeof req.query.start === 'string') params.set('start', req.query.start);
  if (typeof req.query.end === 'string') params.set('end', req.query.end);

  try {
    const response = await adminRequestRaw(`/exports/accounting${params.toString() ? `?${params.toString()}` : ''}`);
    res.status(response.status);
    response.headers.forEach((value: string, key: string) => {
      if (key.toLowerCase() === 'transfer-encoding') return;
      res.setHeader(key, value);
    });
    const buffer = await response.arrayBuffer();
    res.end(Buffer.from(buffer));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'export_failed' });
  }
}
