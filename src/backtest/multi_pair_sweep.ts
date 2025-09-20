import ccxt from "ccxt";
import fs from "fs";
import path from "path";

type Candle = [number, number, number, number, number, number];

async function fetchOHLCV(pair: string, timeframe = "1m", minutes = 60*24*30): Promise<Candle[]> {
  const exchange = new ccxt.binance({ enableRateLimit: true, options: { adjustForTimeDifference: true }});
  const limit = 1000;
  const now = Date.now();
  const since = now - minutes * 60 * 1000;
  const all: number[][] = [];
  let last = since;
  while (true) {
    const batchAny: any = await exchange.fetchOHLCV(pair, timeframe, last, limit);
    const batch = batchAny as number[][];
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    const lastTs = batch[batch.length - 1][0];
    last = lastTs + 60*1000;
    console.log(`[fetch] ${pair} -> fetched ${all.length} candles, last ${new Date(lastTs).toISOString()}`);
    if (last >= now) break;
    if (all.length >= minutes) break;
    await new Promise(res => setTimeout(res, 250));
  }
  return all as Candle[];
}

// Simulation function (same engine as param_sweep)
function simulateOnCandles(candles: Candle[], params: {gridSteps:number, gridPct:number, tpPct:number, perTradePct:number}, startingUsd = 200) {
  const { gridSteps, gridPct, tpPct, perTradePct } = params;
  const STARTING_USD = startingUsd;
  const MAX_PER_TRADE_USD = STARTING_USD * perTradePct;
  const TAKE_PROFIT_PCT = tpPct;
  const GRID_PCT = gridPct;
  const FEES_PCT = 0.00075;
  const SLIPPAGE = 0.0005;

  // anchor on recent 60-min average inside the candles array
  const mid = candles.slice(-60).reduce((s,c) => s + c[4], 0) / 60;
  const buyLevels: number[] = [];
  for (let i=1;i<=gridSteps;i++) buyLevels.push(mid * (1 - i * GRID_PCT));

  let cash = STARTING_USD, asset = 0, realized = 0, trades = 0, peak = STARTING_USD, maxDD = 0;
  const openBuys: {price:number, amount:number}[] = [];

  for (const c of candles) {
    const low = c[3], high = c[2], close = c[4];

    // fills
    for (const lvl of buyLevels) {
      if (low <= lvl && cash >= MAX_PER_TRADE_USD) {
        const amount = Number((MAX_PER_TRADE_USD / lvl).toFixed(8));
        const execPrice = lvl * (1 + SLIPPAGE);
        const fee = MAX_PER_TRADE_USD * FEES_PCT;
        cash -= (MAX_PER_TRADE_USD + fee);
        asset += amount;
        trades++;
        openBuys.push({ price: execPrice, amount });
        const tp = execPrice * (1 + TAKE_PROFIT_PCT);
        if (high >= tp) {
          const sellPrice = tp * (1 - SLIPPAGE);
          const proceeds = sellPrice * amount - (sellPrice * amount * FEES_PCT);
          realized += proceeds - MAX_PER_TRADE_USD;
          asset -= amount;
          trades++;
        }
      }
    }

    // check TPs
    const remaining: typeof openBuys = [];
    for (const b of openBuys) {
      const tp = b.price * (1 + TAKE_PROFIT_PCT);
      if (high >= tp) {
        const sellPrice = tp * (1 - SLIPPAGE);
        const proceeds = sellPrice * b.amount - (sellPrice * b.amount * FEES_PCT);
        realized += proceeds - (b.price * b.amount);
        asset -= b.amount;
        trades++;
      } else remaining.push(b);
    }
    openBuys.length = 0;
    for (const r of remaining) openBuys.push(r);

    const nav = cash + asset * close;
    if (nav > peak) peak = nav;
    const dd = (peak - nav) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const lastClose = candles[candles.length - 1][4];
  const nav = cash + asset * lastClose;
  return { trades, nav: Number(nav.toFixed(2)), realized: Number(realized.toFixed(2)), maxDD: Number(maxDD.toFixed(4)), candles: candles.length };
}

async function main() {
  const pairs = ["BTC/USDT","ETH/USDT","SOL/USDT","ARB/USDT"];
  const gridStepsArr = [4,6,8];
  const gridPctArr = [0.005,0.01,0.015,0.02,0.03];
  const tpArr = [0.01,0.015,0.02,0.03];
  const perTradeArr = [0.005,0.01,0.02];

  const outPath = path.resolve(process.cwd(), "multi_sweep_results.csv");
  const header = "pair,gridSteps,gridPct,tpPct,perTradePct,trades,NAV,realized,maxDrawdown,candles";
  const rows: string[] = [header];

  for (const pair of pairs) {
    console.log("=== Processing", pair);
    const candles = await fetchOHLCV(pair, "1m", 60*24*30); // 30 days 1m
    for (const gs of gridStepsArr) for (const gp of gridPctArr) for (const tp of tpArr) for (const pt of perTradeArr) {
      const r = simulateOnCandles(candles, {gridSteps:gs, gridPct:gp, tpPct:tp, perTradePct:pt});
      rows.push(`${pair},${gs},${gp},${tp},${pt},${r.trades},${r.nav},${r.realized},${r.maxDD},${r.candles}`);
    }
    // small pause to avoid rate limits
    await new Promise(res=>setTimeout(res,500));
  }

  fs.writeFileSync(outPath, rows.join("\n"));
  console.log("Multi-pair sweep finished ->", outPath);
}

main().catch(err => { console.error(err); process.exit(1); });
