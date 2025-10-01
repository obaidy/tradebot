import Redis from 'ioredis';
import { CONFIG } from '../src/config';

function usage() {
  console.log('Usage: ts-node scripts/inspectTickerCache.ts <symbol>');
  console.log('Example: ts-node scripts/inspectTickerCache.ts BTCUSDT');
}

async function main() {
  const symbolArg = process.argv[2];
  if (!symbolArg) {
    usage();
    process.exit(1);
  }

  if (!CONFIG.REDIS_URL) {
    console.error('REDIS_URL is not configured.');
    process.exit(1);
  }

  const redis = new Redis(CONFIG.REDIS_URL, { lazyConnect: false });

  try {
    const key = `market:binance:${symbolArg.toLowerCase()}`;
    const raw = await redis.get(key);
    if (!raw) {
      console.log(`No cache entry found for ${key}`);
      return;
    }
    const parsed = JSON.parse(raw);
    console.log(JSON.stringify(parsed, null, 2));
  } finally {
    await redis.quit();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
