// src/backtest/deep_backtest.ts
// Deep backtest the shortlisted candidates over 90 days on 1h and 4h candles.
// Outputs CSV: deep_backtest_results.csv
import ccxt from "ccxt";
import fs from "fs";
import path from "path";

type Candle = [number, number, number, number, number, number];

async function fetchOHLCV(pair: string, timeframe = "1h", hours = 24*90): Promise<Candle[]> {
  const exchange = new ccxt.binance({ enableRateLimit: true, options: { adjustForTimeDifference: true }});
  const limit = 1000;
  const now = Date.now();
  const since = now - hours * 60 * 60 * 1000;
  const all: number[][] = [];
  let last = since;
  while (true) {
    const batchAny: any = await exchange.fetchOHLCV(pair, timeframe, last, limit);
    const batch = batchAny as number[][];
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    const lastTs = batch[batch.length - 1][0];
    last = lastTs + (timeframe === "1h" ? 3600000 : 4 * 3600000);
    if (last >= now) break;
    if (all.length >= hours) break;
    await new Promise(res => setTimeout(res, 250));
  }
  return all as Candle[];
}

function sma(values: number[], period: number) {
  const out: number[] = [];
  for (let i=0;i<values.length;i++){
    if (i < period-1) { out.push(NaN); continue; }
    const slice = values.slice(i-period+1, i+1);
    out.push(slice.reduce((s,x)=>s+x,0)/period);
  }
  return out;
}
function atr(candles: Candle[], period=14) {
  const trs: number[] = [];
  for (let i=0;i<candles.length;i++){
    if (i===0) { trs.push(candles[i][2]-candles[i][3]); continue; }
    const high=candles[i][2], low=candles[i][3], prev=candles[i-1][4];
    trs.push(Math.max(high-low, Math.abs(high-prev), Math.abs(low-prev)));
  }
  const out:number[]=[];
  for (let i=0;i<trs.length;i++){
    if (i < period) { out.push(NaN); continue; }
    const slice = trs.slice(i-period+1, i+1);
    out.push(slice.reduce((s,x)=>s+x,0)/period);
  }
  return out;
}

function simulate(candles: Candle[], params: any, starting=200) {
  const { gridSteps, k, tp, perTrade, smaPeriod = 24, meanRevertPct = 0.01, minAtrPct = 0.002 } = params;
  const START = starting;
  const MAX_PER_TRADE_USD = START * perTrade;
  const FEES_PCT = 0.00075;
  const SLIPPAGE = 0.0005;

  const closes = candles.map(c=>c[4]);
  const smaVals = sma(closes, smaPeriod);
  const atrVals = atr(candles, 14);

  let cash = START, asset=0, realized=0, trades=0, peak=START, maxDD=0;
  const openBuys: {price:number, amount:number}[] = [];

  for (let i=0;i<candles.length;i++){
    if (!isFinite(smaVals[i]) || !isFinite(atrVals[i])) continue;
    const mid = smaVals[i];
    const atrVal = atrVals[i];
    const price = candles[i][4];
    if (price > mid * (1 - meanRevertPct)) continue;
    if ((atrVal / price) < minAtrPct) continue;

    const gridPctPerLevel = k * (atrVal / mid);
    const buyLevels: number[] = [];
    for (let s=1; s<=gridSteps; s++) buyLevels.push(mid * (1 - s * gridPctPerLevel));
    const low = candles[i][3], high = candles[i][2];

    for (const lvl of buyLevels) {
      if (low <= lvl && cash >= MAX_PER_TRADE_USD) {
        const amount = Number((MAX_PER_TRADE_USD / lvl).toFixed(8));
        const execPrice = lvl * (1 + SLIPPAGE);
        const fee = MAX_PER_TRADE_USD * FEES_PCT;
        cash -= (MAX_PER_TRADE_USD + fee);
        asset += amount;
        trades++;
        openBuys.push({price: execPrice, amount});
        const tpPrice = execPrice * (1 + tp);
        if (high >= tpPrice) {
          const sellPrice = tpPrice * (1 - SLIPPAGE);
          const proceeds = sellPrice * amount - (sellPrice*amount*FEES_PCT);
          realized += proceeds - MAX_PER_TRADE_USD;
          asset -= amount;
          trades++;
        }
      }
    }

    // TPs
    const remaining: typeof openBuys = [];
    for (const b of openBuys) {
      const tpPrice = b.price * (1 + tp);
      if (high >= tpPrice) {
        const sellPrice = tpPrice * (1 - SLIPPAGE);
        const proceeds = sellPrice * b.amount - (sellPrice*b.amount*FEES_PCT);
        realized += proceeds - (b.price*b.amount);
        asset -= b.amount;
        trades++;
      } else remaining.push(b);
    }
    openBuys.length = 0;
    for (const r of remaining) openBuys.push(r);

    const nav = cash + asset * candles[i][4];
    if (nav > peak) peak = nav;
    const dd = (peak - nav) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const lastClose = candles[candles.length-1][4];
  const nav = cash + asset * lastClose;
  return {trades, nav: Number(nav.toFixed(2)), realized: Number(realized.toFixed(2)), maxDD: Number(maxDD.toFixed(4)), candles: candles.length};
}

async function main() {
  const candidates = [
    { pair: "BTC/USDT", gridSteps:8, k:0.5, tp:0.05, perTrade:0.005 },
    { pair: "BTC/USDT", gridSteps:8, k:1, tp:0.05, perTrade:0.01 },
    { pair: "BTC/USDT", gridSteps:4, k:0.5, tp:0.05, perTrade:0.01 }
  ];

  const outPath = path.resolve(process.cwd(), "deep_backtest_results.csv");
  const lines = ["pair,timeframe,gridSteps,k,tp,perTrade,trades,nav,realized,maxDD,candles"];
  for (const c of candidates) {
    for (const tf of ["1h","4h"]) {
      console.log("Fetching", c.pair, tf, "for 90d...");
      const candles = await fetchOHLCV(c.pair, tf, 24*90);
      console.log("Running sim", c.pair, tf, c);
      const res = simulate(candles, {...c, smaPeriod: (tf === "1h" ? 24 : 24), meanRevertPct:0.01, minAtrPct:0.002}, 200);
      lines.push(`${c.pair},${tf},${c.gridSteps},${c.k},${c.tp},${c.perTrade},${res.trades},${res.nav},${res.realized},${res.maxDD},${res.candles}`);
      console.log("->", res);
      await new Promise(resv => setTimeout(resv, 300));
    }
  }
  fs.writeFileSync(outPath, lines.join("\n"));
  console.log("Deep backtest finished ->", outPath);
}

main().catch(e=>{ console.error(e); process.exit(1); });
