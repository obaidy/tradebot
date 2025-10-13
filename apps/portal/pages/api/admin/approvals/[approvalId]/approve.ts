import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/lib/authOptions';
import { approveTradeApproval } from '@/lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const approvalIdRaw = Array.isArray(req.query.approvalId) ? req.query.approvalId[0] : req.query.approvalId;
  const approvalId = Number(approvalIdRaw);
  if (!Number.isFinite(approvalId)) {
    res.status(400).json({ error: 'invalid_approval_id' });
    return;
  }

  const actor = session.user.email ?? session.user.id;
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body ?? {};
  const note = typeof body.note === 'string' ? body.note : undefined;
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined;

  try {
    const record = await approveTradeApproval(approvalId, { note, metadata, actor });
    res.status(200).json(record);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'approval_failed' });
  }
}
