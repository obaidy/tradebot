import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { fetchClientAgreements, acceptClientAgreements } from '../../../lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (req.method === 'GET') {
    try {
      const data = await fetchClientAgreements(session.user.id);
      res.status(200).json(data);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'agreements_fetch_failed' });
    }
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {};
      const documents = Array.isArray(body.documents) ? body.documents : [];
      if (!documents.length) {
        res.status(400).json({ error: 'documents_required' });
        return;
      }
      const forwarded = req.headers['x-forwarded-for'];
      const ip = Array.isArray(forwarded)
        ? forwarded[0]
        : forwarded
        ? forwarded.split(',')[0].trim()
        : req.socket.remoteAddress ?? null;
      await acceptClientAgreements(session.user.id, session.user.email ?? session.user.id, documents, ip || undefined);
      res.status(200).json({ accepted: documents.length });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'agreements_accept_failed' });
    }
    return;
  }

  res.status(405).json({ error: 'method_not_allowed' });
}
