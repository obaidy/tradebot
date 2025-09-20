// src/backtest/backtest.ts  (fixed types + paging)
// Fetches ~7 days of 1m OHLCV from Binance and writes ohlcv.json
import ccxt from "ccxt";
import fs from "fs";
import path from "path";

async function fetchOHLCVPaginated(pair: string, timeframe = "1m", minutes = 60 * 24 * 7): Promise<number[][]> {
  const exchange = new ccxt.binance({
    enableRateLimit: true,
    options: { adjustForTimeDifference: true },
  });

  const limit = 1000; // page size
  const now = Date.now();
  const since = now - minutes * 60 * 1000;
  const all: number[][] = [];
  let last = since;

  while (true) {
    // ccxt returns any; cast to number[][] for TS
    const batchAny: any = await exchange.fetchOHLCV(pair, timeframe, last, limit);
    const batch = batchAny as number[][];
    if (!batch || batch.length === 0) break;
    all.push(...batch);

    const lastTs = batch[batch.length - 1][0];
    // move pointer forward 1 minute after last fetched candle to avoid duplicates
    last = lastTs + 60 * 1000;

    console.log(`fetched ${all.length} candles, last ts ${new Date(lastTs).toISOString()}`);

    if (last >= now) break;
    if (all.length >= minutes) break;

    // friendly delay to honor rate limits
    await new Promise((res) => setTimeout(res, 250));
  }

  return all;
}

async function main() {
  const pair = "BTC/USDT";
  console.log("Fetching ~7 days OHLCV for", pair);
  const ohlcv = await fetchOHLCVPaginated(pair, "1m", 60 * 24 * 7);

  const ohlcvPath = path.resolve(process.cwd(), "ohlcv.json");
  fs.writeFileSync(ohlcvPath, JSON.stringify(ohlcv, null, 2));
  console.log("Saved OHLCV ->", ohlcvPath);

  const metaPath = path.resolve(process.cwd(), "candles.json");
  fs.writeFileSync(metaPath, JSON.stringify({ pair, count: ohlcv.length }, null, 2));
  console.log("Saved metadata ->", metaPath);
}

main().catch((err) => {
  console.error("backtest fetch failed:", err);
  process.exit(1);
});
