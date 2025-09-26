import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';
import { createBillingPortalSessionForClient } from '../../../../lib/adminClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.id) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  try {
    const origin = req.headers.origin || process.env.PORTAL_BASE_URL || 'http://localhost:3000';
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const returnUrl = body?.returnUrl || `${origin}/app`;
    const portal = await createBillingPortalSessionForClient({
      clientId: session.user.id,
      actor: session.user.email ?? session.user.id,
      returnUrl,
    });
    res.status(200).json(portal);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'billing_portal_failed' });
  }
}
