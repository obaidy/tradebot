import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../lib/authOptions';

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
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const action = (body?.action || 'checkout') as 'checkout' | 'portal';
    const adminUrl = process.env.ADMIN_API_URL || 'http://localhost:9300';
    const adminToken = process.env.ADMIN_API_TOKEN;
    if (!adminToken) {
      res.status(400).json({ error: 'admin_token_missing' });
      return;
    }
    const origin = req.headers.origin || process.env.PORTAL_BASE_URL || 'http://localhost:3000';

    if (action === 'portal') {
      const returnUrl = `${origin}/app?portal=done`;
      const resp = await fetch(`${adminUrl}/billing/portal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          clientId: session.user.id,
          returnUrl,
        }),
      });
      const payload = await resp.json();
      if (!resp.ok) {
        throw new Error(payload?.error || 'portal_session_failed');
      }
      res.status(200).json(payload);
      return;
    }

    // default: checkout for a given plan
    const planId = body?.planId || body?.plan_id;
    if (!planId) {
      res.status(400).json({ error: 'plan_required' });
      return;
    }
    const successUrl = `${origin}/app?checkout=success`;
    const cancelUrl = `${origin}/app?checkout=cancelled`;
    const resp = await fetch(`${adminUrl}/billing/session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        clientId: session.user.id,
        planId,
        successUrl,
        cancelUrl,
        trialDays: 3,
      }),
    });
    const payload = await resp.json();
    if (!resp.ok) {
      throw new Error(payload?.error || 'billing_session_failed');
    }
    res.status(200).json(payload);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'billing_session_failed' });
  }
}
