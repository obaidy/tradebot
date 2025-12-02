import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../lib/authOptions';
import { fetchClientTrades } from '../../../lib/adminClient';
import { getSessionClientId } from '../../../lib/sessionClient';

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
  const { limit, cursor, bot, start, end } = req.query;
  try {
    const trades = await fetchClientTrades(clientId, {
      limit: limit ? Number(limit) : undefined,
      cursor: typeof cursor === 'string' ? cursor : null,
      bot: typeof bot === 'string' && bot.length ? bot : null,
      start: typeof start === 'string' && start.length ? start : null,
      end: typeof end === 'string' && end.length ? end : null,
    });
    res.status(200).json(trades);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'trades_fetch_failed' });
  }
}

