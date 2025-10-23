import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/authOptions';
import { createBillingSessionForClient } from '@/lib/adminClient';
import { getSessionClientId } from '@/lib/sessionClient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const session = await getServerSession(req, res, authOptions);
  const clientId = getSessionClientId(session);
  if (!clientId) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const planId = body?.planId || body?.plan_id;
    if (!planId) {
      res.status(400).json({ error: 'plan_required' });
      return;
    }
    const origin = req.headers.origin || process.env.PORTAL_BASE_URL || 'http://localhost:3000';
    const successUrl = `${origin}/app?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${origin}/app?checkout=cancelled&session_id={CHECKOUT_SESSION_ID}`;
    const checkout = await createBillingSessionForClient({
      clientId,
      planId,
      actor: session?.user?.email ?? clientId,
      successUrl,
      cancelUrl,
      trialDays: 3,
    });
    res.status(200).json(checkout);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'billing_session_failed' });
  }
}
