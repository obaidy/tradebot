// src/backtest/multi_sweep_v3.ts
// Smarter sweep: 1h candles, ATR anchoring, mean-reversion filter (price below long SMA), volatility gate.
import ccxt from "ccxt";
import fs from "fs";
import path from "path";

type Candle = [number, number, number, number, number, number];

async function fetchOHLCV(pair: string, timeframe = "1h", hours = 24*30) {
  const exchange = new ccxt.binance({ enableRateLimit: true, options: { adjustForTimeDifference: true }});
  const limit = 1000;
  const now = Date.now();
  const minutes = hours * 60;
  const since = now - minutes * 60 * 1000;
  const all: number[][] = [];
  let last = since;
  while (true) {
    const batchAny: any = await exchange.fetchOHLCV(pair, timeframe, last, limit);
    const batch = batchAny as number[][];
    if (!batch || batch.length === 0) break;
    all.push(...batch);
    const lastTs = batch[batch.length - 1][0];
    last = lastTs + (60 * 60 * 1000); // 1h
    console.log(`[fetch] ${pair} -> fetched ${all.length} candles, last ${new Date(lastTs).toISOString()}`);
    if (last >= now) break;
    if (all.length >= minutes / 60) break;
    await new Promise(res=>setTimeout(res, 250));
  }
  return all as Candle[];
}

// helpers: SMA and ATR
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

function simulate(candles: Candle[], params: {gridSteps:number,k:number,tp:number,perTrade:number, smaPeriod:number, meanRevertPct:number, minAtrPct:number}, starting=200) {
  const {gridSteps,k,tp,perTrade,smaPeriod,meanRevertPct,minAtrPct} = params;
  const START=starting;
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
    // mean-reversion gate: only consider buying if price <= mid*(1 - meanRevertPct)
    const price = candles[i][4];
    if (price > mid * (1 - meanRevertPct)) {
      // skip trading this candle: not a reversion setup
      continue;
    }
    // volatility gate: require atr/price >= minAtrPct
    if ((atrVal / price) < minAtrPct) continue;

    const gridPctPerLevel = k * (atrVal / mid);
    const buyLevels: number[] = [];
    for (let s=1;s<=gridSteps;s++) buyLevels.push(mid*(1 - s*gridPctPerLevel));

    const low = candles[i][3], high = candles[i][2], close = candles[i][4];

    for (const lvl of buyLevels){
      if (low <= lvl && cash >= MAX_PER_TRADE_USD){
        const amount = Number((MAX_PER_TRADE_USD / lvl).toFixed(8));
        const execPrice = lvl * (1 + SLIPPAGE);
        const fee = MAX_PER_TRADE_USD * FEES_PCT;
        cash -= (MAX_PER_TRADE_USD + fee);
        asset += amount;
        trades++;
        openBuys.push({price: execPrice, amount});
        const tpPrice = execPrice * (1 + tp);
        if (high >= tpPrice){
          const sellPrice = tpPrice * (1 - SLIPPAGE);
          const proceeds = sellPrice * amount - (sellPrice*amount*FEES_PCT);
          realized += proceeds - MAX_PER_TRADE_USD;
          asset -= amount;
          trades++;
        }
      }
    }

    // check TPs
    const remaining: typeof openBuys = [];
    for (const b of openBuys){
      const tpPrice = b.price * (1 + tp);
      if (high >= tpPrice){
        const sellPrice = tpPrice * (1 - SLIPPAGE);
        const proceeds = sellPrice * b.amount - (sellPrice*b.amount*FEES_PCT);
        realized += proceeds - (b.price*b.amount);
        asset -= b.amount;
        trades++;
      } else remaining.push(b);
    }
    openBuys.length = 0;
    for (const r of remaining) openBuys.push(r);

    const nav = cash + asset * close;
    if (nav > peak) peak = nav;
    const dd = (peak - nav)/peak;
    if (dd > maxDD) maxDD = dd;
  }

  const lastClose = candles[candles.length-1][4];
  const nav = cash + asset * lastClose;
  return {trades, nav: Number(nav.toFixed(2)), realized: Number(realized.toFixed(2)), maxDD: Number(maxDD.toFixed(4)), candles: candles.length};
}

async function main(){
  const pairs = ["BTC/USDT","ETH/USDT","SOL/USDT","ARB/USDT"];
  const gridStepsArr = [4,6,8];
  const kArr = [0.5,1,1.5];
  const tpArr = [0.03,0.04,0.05];
  const perTradeArr = [0.0025,0.005,0.01]; // 0.25%,0.5%,1%
  const smaPeriod = 24; // 24 hours SMA on 1h candles
  const meanRevertPctArr = [0.01,0.02,0.03]; // require price to be 1%/2%/3% below SMA
  const minAtrPctArr = [0.002,0.004,0.006]; // require ATR/price >= threshold

  const out = path.resolve(process.cwd(), "multi_sweep_v3.csv");
  const rows = ["pair,gridSteps,k,tp,perTrade,smaPeriod,meanRevertPct,minAtrPct,trades,NAV,realized,maxDD,candles"];

  for (const pair of pairs){
    console.log("=== Fetching", pair);
    const candles = await fetchOHLCV(pair, "1h", 24*30);
    for (const gs of gridStepsArr) for (const k of kArr) for (const tp of tpArr) for (const pt of perTradeArr)
      for (const mr of meanRevertPctArr) for (const minAtr of minAtrPctArr) {
        const r = simulate(candles, {gridSteps:gs,k, tp, perTrade:pt, smaPeriod, meanRevertPct:mr, minAtrPct:minAtr});
        rows.push(`${pair},${gs},${k},${tp},${pt},${smaPeriod},${mr},${minAtr},${r.trades},${r.nav},${r.realized},${r.maxDD},${r.candles}`);
      }
    await new Promise(res=>setTimeout(res,500));
  }

  fs.writeFileSync(out, rows.join("\n"));
  console.log("multi_sweep_v3 finished ->", out);
}

main().catch(e=>{ console.error(e); process.exit(1); });
