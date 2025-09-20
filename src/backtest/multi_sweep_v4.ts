// src/backtest/multi_sweep_v4.ts
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
    last = lastTs + (60 * 60 * 1000);
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
function rsi(values: number[], period = 14) {
  if (values.length < period + 1) return Array(values.length).fill(NaN);
  const out: number[] = [];
  let gains = 0, losses = 0;
  for (let i=1;i<=period;i++){
    const diff = values[i] - values[i-1];
    if (diff >= 0) gains += diff; else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out.push(NaN); // index 0
  for (let i = 1; i < values.length; i++) {
    if (i < period) { out.push(NaN); continue; }
    if (i === period) {
      out.push(100 - (100 / (1 + (avgGain / (avgLoss || 1e-9)))));
    } else {
      const diff = values[i] - values[i-1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgGain / (avgLoss || 1e-9);
      out.push(100 - (100 / (1 + rs)));
    }
  }
  return out;
}

function simulate(candles: Candle[], params: any, starting=200) {
  const { gridSteps, k, tp, perTrade, smaPeriod = 24, meanRevertPct = 0.01, minAtrPct = 0.002, rsiThresh = 45 } = params;
  const START = starting;
  const MAX_PER_TRADE_USD = START * perTrade;
  const FEES_PCT = 0.00075;
  const SLIPPAGE = 0.0005;

  const closes = candles.map(c=>c[4]);
  const smaVals = sma(closes, smaPeriod);
  const atrVals = atr(candles, 14);
  const rsiVals = rsi(closes, 14);

  let cash = START, asset=0, realized=0, trades=0, peak=START, maxDD=0;
  const openBuys: {price:number, amount:number}[] = [];

  for (let i=0;i<candles.length;i++){
    if (!isFinite(smaVals[i]) || !isFinite(atrVals[i]) || !isFinite(rsiVals[i])) continue;
    const mid = smaVals[i];
    const atrVal = atrVals[i];
    const price = closes[i];
    // mean reversion + RSI + volatility gate
    if (!(price <= mid * (1 - meanRevertPct))) continue;
    if ((atrVal / price) < minAtrPct) continue;
    if (rsiVals[i] > rsiThresh) continue;

    const gridPctPerLevel = k * (atrVal / mid);
    const buyLevels: number[] = [];
    for (let s = 1; s <= gridSteps; s++) buyLevels.push(mid * (1 - s * gridPctPerLevel));
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
          const proceeds = sellPrice * amount - (sellPrice * amount * FEES_PCT);
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
        const proceeds = sellPrice * b.amount - (sellPrice * b.amount * FEES_PCT);
        realized += proceeds - (b.price * b.amount);
        asset -= b.amount;
        trades++;
      } else remaining.push(b);
    }
    openBuys.length = 0;
    for (const r of remaining) openBuys.push(r);

    const nav = cash + asset * closes[i];
    if (nav > peak) peak = nav;
    const dd = (peak - nav) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const lastClose = closes[closes.length-1];
  const nav = cash + asset * lastClose;
  return {trades, nav: Number(nav.toFixed(2)), realized: Number(realized.toFixed(2)), maxDD: Number(maxDD.toFixed(4)), candles: candles.length};
}

async function main() {
  const pairs = ["BTC/USDT","ETH/USDT"];
  const gridStepsArr = [4,8];
  const kArr = [0.5,1];
  const tpArr = [0.05,0.07,0.10,0.12,0.15];
  const perTradeArr = [0.001,0.0025,0.005]; // 0.1% - 0.5%
  const meanRevertArr = [0.01,0.02];
  const minAtrArr = [0.0015,0.002,0.003];
  const rsiArr = [40,45,50];

  const outPath = path.resolve(process.cwd(), "multi_sweep_v4.csv");
  const header = "pair,gridSteps,k,tp,perTrade,meanRevert,minAtr,rsiThresh,trades,NAV,realized,maxDD,candles";
  const rows = [header];

  for (const pair of pairs) {
    console.log("=== Fetching", pair);
    const candles = await fetchOHLCV(pair, "1h", 24*90);
    for (const gs of gridStepsArr) for (const k of kArr) for (const tp of tpArr)
      for (const pt of perTradeArr) for (const mr of meanRevertArr) for (const minAtr of minAtrArr) for (const rsiT of rsiArr) {
        const r = simulate(candles, {gridSteps:gs, k, tp, perTrade:pt, meanRevertPct:mr, minAtrPct:minAtr, rsiThresh:rsiT});
        rows.push(`${pair},${gs},${k},${tp},${pt},${mr},${minAtr},${rsiT},${r.trades},${r.nav},${r.realized},${r.maxDD},${r.candles}`);
      }
    await new Promise(res=>setTimeout(res,500));
  }

  fs.writeFileSync(outPath, rows.join("\n"));
  console.log("multi_sweep_v4 finished ->", outPath);
}

main().catch(e=>{ console.error(e); process.exit(1); });
