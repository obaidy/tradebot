// src/backtest/momentum_backtest.ts
import ccxt from "ccxt";
import fs from "fs";
import path from "path";

type Candle = [number, number, number, number, number, number];

async function fetchOHLCV(pair: string, timeframe = "4h", hours = 24 * 180): Promise<Candle[]> {
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
    await new Promise((r) => setTimeout(r, 120));
  }
  return all as Candle[];
}

function sma(values: number[], period: number) {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push(NaN); continue; }
    const s = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    out.push(s / period);
  }
  return out;
}

function atr(candles: Candle[], period = 14) {
  const trs: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) { trs.push(candles[i][2] - candles[i][3]); continue; }
    const high = candles[i][2], low = candles[i][3], prevClose = candles[i - 1][4];
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const out: number[] = [];
  for (let i = 0; i < trs.length; i++) {
    if (i < period) { out.push(NaN); continue; }
    const s = trs.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    out.push(s);
  }
  return out;
}

/**
 * Simple momentum breakout simulation:
 * - Single position allowed at a time.
 * - Entry: price crosses above SMA * (1 + breakoutPct) AND ATR/price above minAtr.
 * - Exit: TP at entry*(1+tp) OR SL at entry*(1 - sl) OR time-based close after maxHold bars.
 */
function simulateMomentum(candles: Candle[], params: any, starting = 200, stepSize = 0.00001) {
  const {
    smaPeriod = 20,
    breakoutPct = 0.01,
    tp = 0.05,
    sl = 0.08,
    perTrade = 0.005,
    minAtrPct = 0.0015,
    maxHold = 12,
  } = params;

  const closes = candles.map((c) => c[4]);
  const smaVals = sma(closes, smaPeriod);
  const atrVals = atr(candles, 14);

  let cash = starting, asset = 0, trades = 0, realized = 0, peak = starting, maxDD = 0;
  let position: { entry: number; amount: number; entryIdx: number } | null = null;

  const FEES = 0.00075;
  const SLIP = 0.0005;

  for (let i = 1; i < candles.length; i++) {
    const price = closes[i];
    const high = candles[i][2], low = candles[i][3];

    // exit logic if position exists
    if (position) {
      const take = position.entry * (1 + tp);
      const stop = position.entry * (1 - sl);
      // TP within candle
      if (high >= take) {
        const sellPrice = take * (1 - SLIP);
        const proceeds = sellPrice * position.amount;
        const fee = proceeds * FEES;
        realized += proceeds - fee - position.entry * position.amount;
        asset -= position.amount;
        trades++;
        position = null;
      }
      // Stop within candle
      else if (low <= stop) {
        const sellPrice = stop * (1 - SLIP);
        const proceeds = sellPrice * position.amount;
        const fee = proceeds * FEES;
        realized += proceeds - fee - position.entry * position.amount;
        asset -= position.amount;
        trades++;
        position = null;
      }
      // time-based exit
      else if (i - position.entryIdx >= maxHold) {
        const sellPrice = price * (1 - SLIP);
        const proceeds = sellPrice * position.amount;
        const fee = proceeds * FEES;
        realized += proceeds - fee - position.entry * position.amount;
        asset -= position.amount;
        trades++;
        position = null;
      }
    }

    // entry logic (only if no position)
    if (!position && isFinite(smaVals[i]) && isFinite(atrVals[i])) {
      const smaV = smaVals[i];
      const atrV = atrVals[i];
      if (atrV / price >= minAtrPct) {
        const prevPrice = closes[i - 1];
        // breakout cross: prev <= sma*(1+breakoutPct) and now > sma*(1+breakoutPct)
        const gate = smaV * (1 + breakoutPct);
        if (prevPrice <= gate && price > gate) {
          const perTradeUSD = Math.max(starting * perTrade, stepSize * price);
          if (cash >= perTradeUSD) {
            const rawAmount = perTradeUSD / price;
            const amount = Math.floor(rawAmount / stepSize) * stepSize;
            if (amount >= stepSize) {
              const entryPrice = price * (1 + SLIP);
              const fee = perTradeUSD * FEES;
              cash -= perTradeUSD + fee;
              asset += amount;
              position = { entry: entryPrice, amount, entryIdx: i };
              trades++;
            }
          }
        }
      }
    }

    const nav = cash + asset * price;
    if (nav > peak) peak = nav;
    const dd = (peak - nav) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  const lastPrice = closes[closes.length - 1];
  const nav = Number((cash + asset * lastPrice).toFixed(2));
  return { trades, nav, realized: Number(realized.toFixed(2)), maxDD: Number(maxDD.toFixed(4)), candles: candles.length };
}

async function main() {
  const pairs = ["BTC/USDT"];
  const timeframe = "4h";
  const outPath = path.resolve(process.cwd(), "momentum_backtest_results.csv");
  const header = "pair,timeframe,sma,bPct,tp,sl,perTrade,minAtr,maxHold,trades,NAV,realized,maxDD,candles";
  const rows = [header];

  // robust step detection (simple)
  let stepSize = 0.00001;
  try {
    const ex: any = new ccxt.binance({ enableRateLimit: true });
    await ex.loadMarkets();
    const market = (ex.markets && (ex.markets["BTC/USDT"] || ex.markets["BTCUSDT"])) ||
      Object.values(ex.markets || {}).find((m: any) => m && (m.symbol === "BTC/USDT" || m.id === "BTCUSDT"));
    if (market) {
      if (market.precision && typeof market.precision.base === "number") stepSize = Math.pow(10, -market.precision.base);
      else if (market.limits && market.limits.amount && typeof market.limits.amount.min === "number") stepSize = market.limits.amount.min;
      else if (market.info && Array.isArray(market.info.filters)) {
        const lot = market.info.filters.find((f: any) => f.filterType === "LOT_SIZE");
        if (lot && lot.stepSize) stepSize = Number(lot.stepSize);
      }
    }
  } catch (err) {
    // safe logging under strict mode
    const msg = (err as any && (err as any).message) ? (err as any).message : err;
    console.warn("step detect fallback", msg);
  }

  console.log("Using stepSize =", stepSize);

    const smaArr = [32, 48];                  // longer smoothing -> fewer false signals
  const bPctArr = [0.02, 0.03, 0.04];       // require stronger breakout
  const tpArr = [0.08, 0.12, 0.15];         // capture bigger moves
  const slArr = [0.06, 0.08];               // keep stops tight but realistic
  const perTradeArr = [0.0025, 0.005];      // smaller stakes for stability
  const minAtrArr = [0.0015, 0.002, 0.0025]; // require honest vol (filter micro candles)
  const maxHoldArr = [12, 24, 36];          // longer max-hold to catch bigger moves


  for (const pair of pairs) {
    console.log("Fetching", pair, timeframe);
    const candles = await fetchOHLCV(pair, timeframe, 24 * 180);
    for (const smaPeriod of smaArr) {
      for (const bPct of bPctArr) {
        for (const tp of tpArr) {
          for (const sl of slArr) {
            for (const perTrade of perTradeArr) {
              for (const minAtr of minAtrArr) {
                for (const maxHold of maxHoldArr) {
                  const params = { smaPeriod, breakoutPct: bPct, tp, sl, perTrade, minAtrPct: minAtr, maxHold };
                  const r = simulateMomentum(candles, params, 200, stepSize);
                  rows.push(`${pair},${timeframe},${smaPeriod},${bPct},${tp},${sl},${perTrade},${minAtr},${maxHold},${r.trades},${r.nav},${r.realized},${r.maxDD},${r.candles}`);
                }
              }
            }
          }
        }
      }
    }
  }

  fs.writeFileSync(outPath, rows.join("\n"));
  console.log("done ->", outPath);
}

main().catch((e) => { console.error(e); process.exit(1); });
