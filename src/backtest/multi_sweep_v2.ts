import ccxt from "ccxt";
import fs from "fs";
import path from "path";

type Candle = [number, number, number, number, number, number];

async function fetchOHLCV(pair: string, timeframe = "5m", minutes = 60*24*30): Promise<Candle[]> {
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
    last = lastTs + (5 * 60 * 1000); // 5m step
    console.log(`[fetch] ${pair} -> fetched ${all.length} candles, last ${new Date(lastTs).toISOString()}`);
    if (last >= now) break;
    if (all.length >= minutes / 5) break;
    await new Promise(res=>setTimeout(res, 250));
  }
  return all as Candle[];
}

// helper: SMA and ATR(14)
function sma(values: number[], period: number) {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period-1) { out.push(NaN); continue; }
    const slice = values.slice(i-period+1, i+1);
    out.push(slice.reduce((s,x)=>s+x,0)/period);
  }
  return out;
}
function atr(candles: Candle[], period = 14) {
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { trs.push(candles[i][2] - candles[i][3]); continue; }
    const high = candles[i][2], low = candles[i][3], prevClose = candles[i-1][4];
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  const out: number[] = [];
  for (let i = 0; i < trs.length; i++) {
    if (i < period) { out.push(NaN); continue; }
    const slice = trs.slice(i-period+1, i+1);
    out.push(slice.reduce((s,x)=>s+x,0)/period);
  }
  return out;
}

function simulate(candles: Candle[], params: {gridSteps:number, k:number, tp:number, perTradePct:number}, startingUsd=200) {
  const { gridSteps, k, tp, perTradePct } = params;
  const STARTING_USD = startingUsd;
  const MAX_PER_TRADE_USD = STARTING_USD * perTradePct;
  const FEES_PCT = 0.00075;
  const SLIPPAGE = 0.0005;

  const closes = candles.map(c=>c[4]);
  const sma60 = sma(closes, 60); // 5h SMA on 5m is ~60
  const atr14 = atr(candles, 14);

  let cash = STARTING_USD, asset = 0, realized = 0, trades = 0, peak = STARTING_USD, maxDD = 0;
  const openBuys: {price:number, amount:number}[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (!isFinite(sma60[i]) || !isFinite(atr14[i])) continue;
    const mid = sma60[i];
    const atrVal = atr14[i];
    // dynamic grid spacing using ATR: gridPctPerLevel = k * (atr/price)
    const gridPctPerLevel = k * (atrVal / mid); 
    // generate buy levels below mid
    const buyLevels: number[] = [];
    for (let s = 1; s <= gridSteps; s++) buyLevels.push(mid * (1 - s * gridPctPerLevel));
    const low = candles[i][3], high = candles[i][2], close = candles[i][4];

    // fills
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

    // check TPs for openBuys
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
  const kArr = [0.5,1,1.5,2]; // multiplies ATR/price for grid spacing
  const tpArr = [0.03,0.04,0.05];
  const perTradeArr = [0.0025,0.005,0.01];

  const outPath = path.resolve(process.cwd(), "multi_sweep_v2.csv");
  const header = "pair,gridSteps,k,tp,perTradePct,trades,NAV,realized,maxDD,candles";
  const rows = [header];

  for (const pair of pairs) {
    console.log("=== Fetching", pair);
    const candles = await fetchOHLCV(pair, "5m", 60*24*30);
    for (const gs of gridStepsArr) for (const k of kArr) for (const tp of tpArr) for (const pt of perTradeArr) {
      const r = simulate(candles, {gridSteps:gs, k, tp, perTradePct:pt});
      rows.push(`${pair},${gs},${k},${tp},${pt},${r.trades},${r.nav},${r.realized},${r.maxDD},${r.candles}`);
    }
    await new Promise(res=>setTimeout(res,500));
  }

  fs.writeFileSync(outPath, rows.join("\n"));
  console.log("multi_sweep_v2 finished ->", outPath);
}

main().catch(err => { console.error(err); process.exit(1); });
