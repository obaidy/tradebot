// src/backtest/param_sweep.ts
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

type Candle = [number, number, number, number, number, number];

function loadOhlcv(): Candle[] {
  const p = path.resolve(process.cwd(), "ohlcv.json");
  if (!fs.existsSync(p)) throw new Error("ohlcv.json missing - run npm run backtest");
  return JSON.parse(fs.readFileSync(p, "utf8")) as Candle[];
}

const candles = loadOhlcv();
const results: string[] = [];
results.push("gridSteps,gridPct,tpPct,perTradePct,trades,NAV,realized,maxDrawdown");

function simulate(params: {gridSteps:number, gridPct:number, tpPct:number, perTradePct:number}) {
  const {gridSteps, gridPct, tpPct, perTradePct} = params;
  const STARTING_USD = 200;
  const MAX_PER_TRADE_USD = STARTING_USD * perTradePct;
  const TAKE_PROFIT_PCT = tpPct;
  const GRID_PCT = gridPct;
  const FEES_PCT = 0.00075;
  const SLIPPAGE = 0.0005;

  // anchor as 60-min average
  const mid = candles.slice(-60).reduce((s,c) => s + c[4], 0) / 60;
  const buyLevels = [];
  for (let i=1;i<=gridSteps;i++) buyLevels.push(mid * (1 - i * GRID_PCT));

  let cash = STARTING_USD, asset = 0, realized = 0, trades=0, peak=STARTING_USD, maxDD=0;

  const openBuys: {price:number, amount:number}[] = [];
  for(const c of candles) {
    const low = c[3], high = c[2], close = c[4];
    // buy fills
    for (const lvl of buyLevels) {
      if (low <= lvl && cash >= MAX_PER_TRADE_USD) {
        const amount = Number((MAX_PER_TRADE_USD / lvl).toFixed(8));
        const execPrice = lvl*(1+SLIPPAGE);
        const fee = MAX_PER_TRADE_USD * FEES_PCT;
        cash -= (MAX_PER_TRADE_USD + fee);
        asset += amount;
        trades++;
        openBuys.push({price: execPrice, amount});
        const tp = execPrice*(1+TAKE_PROFIT_PCT);
        if (high >= tp) {
          const sellPrice = tp*(1-SLIPPAGE);
          const proceeds = sellPrice*amount - (sellPrice*amount*FEES_PCT);
          realized += proceeds - MAX_PER_TRADE_USD;
          asset -= amount;
          trades++;
        }
      }
    }
    // check TPs
    const remaining = [];
    for (const b of openBuys) {
      const tp = b.price*(1+TAKE_PROFIT_PCT);
      if (high >= tp) {
        const sellPrice = tp*(1-SLIPPAGE);
        const proceeds = sellPrice*b.amount - (sellPrice*b.amount*FEES_PCT);
        realized += proceeds - (b.price*b.amount);
        asset -= b.amount;
        trades++;
      } else remaining.push(b);
    }
    openBuys.length=0;
    for(const r of remaining) openBuys.push(r);

    const nav = cash + asset*close;
    if (nav > peak) peak = nav;
    const dd = (peak - nav)/peak;
    if (dd > maxDD) maxDD = dd;
  }

  const lastClose = candles[candles.length-1][4];
  const nav = cash + asset*lastClose;
  return {trades, nav: Number(nav.toFixed(2)), realized: Number(realized.toFixed(2)), maxDD: Number(maxDD.toFixed(4))};
}

const gridStepsArr = [4,6,8,10];
const gridPctArr = [0.005,0.01,0.015,0.02,0.03,0.05];
const tpArr = [0.01,0.015,0.02,0.03];
const perTradeArr = [0.005,0.01,0.02,0.03];

for(const gs of gridStepsArr){
  for(const gp of gridPctArr){
    for(const tp of tpArr){
      for(const pt of perTradeArr){
        const r = simulate({gridSteps:gs, gridPct:gp, tpPct:tp, perTradePct:pt});
        results.push(`${gs},${gp},${tp},${pt},${r.trades},${r.nav},${r.realized},${r.maxDD}`);
      }
    }
  }
}

fs.writeFileSync(path.resolve(process.cwd(), "sweep_results.csv"), results.join("\\n"));
console.log("Sweep finished -> sweep_results.csv");
