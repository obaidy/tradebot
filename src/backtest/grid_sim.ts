import fs from "fs";
import path from "path";

type Candle = [number, number, number, number, number, number]; // ts, open, high, low, close, vol

const TAKE_PROFIT_PCT = 0.02;
const GRID_STEPS = 6;
const GRID_PCT = 0.02;
const STARTING_USD = 200;
const MAX_PER_TRADE_USD = STARTING_USD * 0.02; // 2%
const FEES_PCT = 0.00075; // 0.075% per side (example)
const SLIPPAGE_PCT = 0.0005; // 0.05% slippage assumption

function loadOhlcv(): Candle[] {
  const ohlcvPath = path.resolve(process.cwd(), "ohlcv.json");
  if (!fs.existsSync(ohlcvPath)) throw new Error("ohlcv.json missing - run npm run backtest first.");
  return JSON.parse(fs.readFileSync(ohlcvPath, "utf8")) as Candle[];
}

function avgClose(candles: Candle[], lastN = 60) {
  const slice = candles.slice(-lastN);
  const sum = slice.reduce((s, c) => s + c[4], 0);
  return sum / slice.length;
}

export function runSim() {
  const candles = loadOhlcv();
  const mid = avgClose(candles, 60); // anchor on 60-min recent average (tweakable)
  const buyLevels: number[] = [];
  for (let i = 1; i <= GRID_STEPS; i++) buyLevels.push(mid * (1 - i * GRID_PCT));

  let cash = STARTING_USD;
  let asset = 0;
  let realized = 0;
  let peakNav = STARTING_USD;
  let maxDrawdown = 0;
  const openBuys: { price: number; amount: number }[] = [];
  let trades = 0;

  for (const c of candles) {
    const high = c[2], low = c[3], close = c[4];

    // fills for buy levels
    for (let i = 0; i < buyLevels.length; i++) {
      const lvl = buyLevels[i];
      if (low <= lvl) {
        const amount = Number((MAX_PER_TRADE_USD / lvl).toFixed(8));
        if (cash >= MAX_PER_TRADE_USD) {
          // simulate buy with slippage + fee
          const executedPrice = lvl * (1 + SLIPPAGE_PCT);
          const fee = MAX_PER_TRADE_USD * FEES_PCT;
          cash -= (MAX_PER_TRADE_USD + fee);
          asset += amount;
          openBuys.push({ price: executedPrice, amount });
          trades++;
          // immediate TP if same-candle high >= TP
          const tp = executedPrice * (1 + TAKE_PROFIT_PCT);
          if (high >= tp) {
            const sellPrice = tp * (1 - SLIPPAGE_PCT); // slippage on sell
            const sellProceeds = amount * sellPrice - (amount * sellPrice * FEES_PCT);
            realized += sellProceeds - MAX_PER_TRADE_USD;
            asset -= amount;
            trades++;
          }
        }
      }
    }

    // check TPs for open buys
    const remaining: typeof openBuys = [];
    for (const b of openBuys) {
      const tp = b.price * (1 + TAKE_PROFIT_PCT);
      if (high >= tp) {
        const sellPrice = tp * (1 - SLIPPAGE_PCT);
        const sellProceeds = b.amount * sellPrice - (b.amount * sellPrice * FEES_PCT);
        realized += sellProceeds - (b.price * b.amount);
        asset -= b.amount;
        trades++;
      } else {
        remaining.push(b);
      }
    }
    openBuys.length = 0;
    for (const r of remaining) openBuys.push(r);

    const nav = cash + asset * close;
    if (nav > peakNav) peakNav = nav;
    const dd = (peakNav - nav) / peakNav;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  const lastClose = candles[candles.length - 1][4];
  const nav = cash + asset * lastClose;
  console.log("SIM RESULT:");
  console.log("  START =", STARTING_USD.toFixed(2));
  console.log("  NAV   =", nav.toFixed(2));
  console.log("  REALIZED P&L =", realized.toFixed(2));
  console.log("  UNREALIZED (asset * lastClose) =", (asset * lastClose).toFixed(2), "asset:", asset.toFixed(8));
  console.log("  TRADES executed:", trades);
  console.log("  MAX DRAWDOWN (fraction):", maxDrawdown.toFixed(4));
  console.log("  candles used:", candles.length);
}

runSim();
