// src/backtest/multi_sweep_v6.ts
import ccxt from "ccxt";
import fs from "fs";
import path from "path";

type Candle = [number, number, number, number, number, number];

async function fetchOHLCV(pair: string, timeframe = "1h", hours = 24 * 90): Promise<Candle[]> {
  const exchange = new ccxt.binance({ enableRateLimit: true, options: { adjustForTimeDifference: true } });
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
    await new Promise((res) => setTimeout(res, 150));
  }
  return all as Candle[];
}

function sma(values: number[], period: number) {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(NaN);
      continue;
    }
    const slice = values.slice(i - period + 1, i + 1);
    out.push(slice.reduce((s, x) => s + x, 0) / period);
  }
  return out;
}

function atr(candles: Candle[], period = 14) {
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      trs.push(candles[i][2] - candles[i][3]);
      continue;
    }
    const high = candles[i][2],
      low = candles[i][3],
      prev = candles[i - 1][4];
    trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
  }
  const out: number[] = [];
  for (let i = 0; i < trs.length; i++) {
    if (i < period) {
      out.push(NaN);
      continue;
    }
    const slice = trs.slice(i - period + 1, i + 1);
    out.push(slice.reduce((s, x) => s + x, 0) / period);
  }
  return out;
}

function rsi(values: number[], period = 14) {
  if (values.length < period + 1) return Array(values.length).fill(NaN);
  const out: number[] = [];
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out.push(NaN);
  for (let i = 1; i < values.length; i++) {
    if (i < period) {
      out.push(NaN);
      continue;
    }
    if (i === period) {
      out.push(100 - 100 / (1 + avgGain / (avgLoss || 1e-9)));
    } else {
      const diff = values[i] - values[i - 1];
      const gain = diff > 0 ? diff : 0;
      const loss = diff < 0 ? Math.abs(diff) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgGain / (avgLoss || 1e-9);
      out.push(100 - 100 / (1 + rs));
    }
  }
  return out;
}

function simulate(candles: Candle[], params: any, starting = 200, stepSizeBase = 0.00001) {
  const {
    gridSteps,
    k,
    tp,
    perTrade,
    smaPeriod = 24,
    meanRevertPct = 0.01,
    minAtrPct = 0.002,
    rsiThresh = 50,
    stopLossPct = 0.15,
    maxConcurrent = 1,
  } = params;

  const START = starting;
  const closes = candles.map((c) => c[4]);
  const lastPrice = closes[closes.length - 1] || 1;
  const minNotionalUSD = Math.max(stepSizeBase * lastPrice, 1.0);
  const perTradeUSD = Math.max(START * perTrade, minNotionalUSD);

  const FEES = 0.00075;
  const SLIP = 0.0005;

  const smaVals = sma(closes, smaPeriod);
  const atrVals = atr(candles, 14);
  const rsiVals = rsi(closes, 14);

  let cash = START,
    asset = 0,
    realized = 0,
    trades = 0,
    peak = START,
    maxDD = 0;

  type OpenPos = { entry: number; amount: number; stop: number };
  const openPositions: OpenPos[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (!isFinite(smaVals[i]) || !isFinite(atrVals[i]) || !isFinite(rsiVals[i])) continue;
    const mid = smaVals[i],
      atrVal = atrVals[i],
      price = closes[i];
    // mean-reversion guard - only buy when price is sufficiently below SMA
    if (!(price <= mid * (1 - meanRevertPct))) continue;
    if (atrVal / price < minAtrPct) continue;
    if (rsiVals[i] > rsiThresh) continue;

    // open new positions only if concurrency allows
    if (openPositions.length < maxConcurrent) {
      const gridPctPerLevel = k * (atrVal / mid);
      const buyLevels: number[] = [];
      for (let s = 1; s <= gridSteps; s++) buyLevels.push(mid * (1 - s * gridPctPerLevel));
      const low = candles[i][3],
        high = candles[i][2];

      for (const lvl of buyLevels) {
        if (low <= lvl && cash >= perTradeUSD) {
          const rawAmount = perTradeUSD / lvl;
          const amount = Math.floor(rawAmount / stepSizeBase) * stepSizeBase;
          if (amount < stepSizeBase) continue;
          const execPrice = lvl * (1 + SLIP);
          const fee = perTradeUSD * FEES;
          cash -= perTradeUSD + fee;
          asset += amount;
          openPositions.push({ entry: execPrice, amount, stop: execPrice * (1 - stopLossPct) });
          trades++;
          // immediate TP check inside candle
          const tpPrice = execPrice * (1 + tp);
          if (high >= tpPrice) {
            const sellPrice = tpPrice * (1 - SLIP);
            const proceeds = sellPrice * amount - sellPrice * amount * FEES;
            realized += proceeds - perTradeUSD;
            asset -= amount;
            trades++;
            openPositions.pop();
          }
        }
      }
    }

    // evaluate open positions for TP or stop
    const remaining: OpenPos[] = [];
    const low = candles[i][3];
    const high = candles[i][2];

    for (const p of openPositions) {
      const tpPrice = p.entry * (1 + tp);
      const stopPrice = p.stop;
      if (high >= tpPrice) {
        const sellPrice = tpPrice * (1 - SLIP);
        const proceeds = sellPrice * p.amount - sellPrice * p.amount * FEES;
        realized += proceeds - p.entry * p.amount;
        asset -= p.amount;
        trades++;
      } else if (low <= stopPrice) {
        const sellPrice = stopPrice * (1 - SLIP);
        const proceeds = sellPrice * p.amount - sellPrice * p.amount * FEES;
        realized += proceeds - p.entry * p.amount;
        asset -= p.amount;
        trades++;
      } else remaining.push(p);
    }
    openPositions.length = 0;
    for (const r of remaining) openPositions.push(r);

    const nav = cash + asset * closes[i];
    if (nav > peak) peak = nav;
    const dd = (peak - nav) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const lastClose = closes[closes.length - 1];
  const nav = cash + asset * lastClose;
  return {
    trades,
    nav: Number(nav.toFixed(2)),
    realized: Number(realized.toFixed(2)),
    maxDD: Number(maxDD.toFixed(4)),
    candles: candles.length,
  };
}

async function main() {
  const pairs = ["BTC/USDT"];
  const timeframes = ["1h", "4h"];
  const gridStepsArr = [4, 8, 12];
  const kArr = [0.25, 0.5, 0.75];
  const tpArr = [0.15, 0.2, 0.25, 0.3, 0.4];
  const perTradeArr = [0.005, 0.01]; // keep feasible
  const meanRevertArr = [0.01, 0.015];
  const minAtrArr = [0.002, 0.003];
  const rsiArr = [45, 50];
  const stopLossArr = [0.08, 0.12, 0.15];
  const maxConcurrentArr = [1];

  const outPath = path.resolve(process.cwd(), "multi_sweep_v6.csv");
  const header =
    "pair,timeframe,gridSteps,k,tp,perTrade,meanRevert,minAtr,rsi,stopLoss,maxConcurrent,trades,NAV,realized,maxDD,candles";
  const rows: string[] = [header];

  // robust step size detection
  let stepSize = 0.00001;
  try {
    const ex: any = new ccxt.binance({ enableRateLimit: true });
    await ex.loadMarkets();
    const market =
      (ex.markets && (ex.markets["BTC/USDT"] || ex.markets["BTCUSDT"])) ||
      Object.values(ex.markets || {}).find(
        (m: any) => m && (m.symbol === "BTC/USDT" || m.id === "BTCUSDT")
      );
    if (market) {
      if (market.precision && typeof market.precision.base === "number") stepSize = Math.pow(10, -market.precision.base);
      else if (market.limits && market.limits.amount && typeof market.limits.amount.min === "number")
        stepSize = market.limits.amount.min;
      else if (market.info && Array.isArray(market.info.filters)) {
        const lot = market.info.filters.find((f: any) => f.filterType === "LOT_SIZE");
        if (lot && lot.stepSize) stepSize = Number(lot.stepSize);
      }
    }
  } catch (err: any) {
    console.warn("stepSize detect failed; fallback used", stepSize, err && err.message ? err.message : err);
  }

  console.log("Using stepSizeBase =", stepSize);

  for (const pair of pairs) {
    console.log("=== Fetching", pair);
    for (const tf of timeframes) {
      const candles = await fetchOHLCV(pair, tf, 24 * 90);
      for (const gs of gridStepsArr)
        for (const k of kArr)
          for (const tp of tpArr)
            for (const pt of perTradeArr)
              for (const mr of meanRevertArr)
                for (const minAtr of minAtrArr)
                  for (const rsi of rsiArr)
                    for (const sl of stopLossArr)
                      for (const mc of maxConcurrentArr) {
                        const params = {
                          gridSteps: gs,
                          k,
                          tp,
                          perTrade: pt,
                          meanRevertPct: mr,
                          minAtrPct: minAtr,
                          rsiThresh: rsi,
                          stopLossPct: sl,
                          maxConcurrent: mc,
                        };
                        const r = simulate(candles, params, 200, stepSize);
                        rows.push(
                          `${pair},${tf},${gs},${k},${tp},${pt},${mr},${minAtr},${rsi},${sl},${mc},${r.trades},${r.nav},${r.realized},${r.maxDD},${r.candles}`
                        );
                      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  fs.writeFileSync(outPath, rows.join("\n"));
  console.log("multi_sweep_v6 finished ->", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
