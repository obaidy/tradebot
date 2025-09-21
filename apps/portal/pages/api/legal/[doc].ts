import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { fetchLegalDocument } from '../../../../lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const { doc } = req.query;
  if (!doc || typeof doc !== 'string') {
    res.status(400).json({ error: 'invalid_document' });
    return;
  }
  try {
    const data = await fetchLegalDocument(doc);
    res.status(200).json(data);
  } catch (err) {
    res.status(404).json({ error: err instanceof Error ? err.message : 'not_found' });
  }
}
