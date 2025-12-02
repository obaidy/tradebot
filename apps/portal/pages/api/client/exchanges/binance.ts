import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import ccxt from 'ccxt';
import { authOptions } from '../../../../lib/authOptions';
import { storeCredentials } from '../../../../lib/adminClient';
import { getSessionClientId } from '../../../../lib/sessionClient';

async function verifyBinanceKeys(apiKey: string, apiSecret: string, allowFutures: boolean) {
  const client = new ccxt.binance({
    apiKey,
    secret: apiSecret,
    enableRateLimit: true,
    options: {
      defaultType: allowFutures ? 'future' : 'spot',
      adjustForTimeDifference: true,
    },
  });
  await client.checkRequiredCredentials();
  await client.fetchBalance({ recvWindow: 5000 });
}

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
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body ?? {};
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const apiSecret = typeof body.apiSecret === 'string' ? body.apiSecret.trim() : '';
  const passphrase = typeof body.passphrase === 'string' && body.passphrase.trim().length ? body.passphrase.trim() : null;
  const allowFutures = Boolean(body.allowFutures);
  if (!apiKey || !apiSecret) {
    res.status(400).json({ error: 'api_key_required' });
    return;
  }
  try {
    await verifyBinanceKeys(apiKey, apiSecret, allowFutures);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Invalid API key or permissions; enable Spot trading and disable withdrawals.';
    res.status(400).json({
      error: 'invalid_api_key',
      message: 'Invalid API key or permissions; enable Spot trading and disable withdrawals.',
      detail: message,
    });
    return;
  }
  try {
    const actor = session?.user?.email ?? clientId;
    const stored = await storeCredentials(clientId, actor, {
      exchangeName: 'binance',
      apiKey,
      apiSecret,
      passphrase,
    });
    res.status(200).json({ status: 'connected', credential: stored });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'credentials_store_failed' });
  }
}

