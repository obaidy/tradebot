// src/tools/check_exchange_limits.ts
import ccxt from "ccxt";

async function main() {
  const exchange = new (ccxt as any).binance({ enableRateLimit: true });
  await exchange.loadMarkets();
  const symbol = "BTC/USDT";
  const market = exchange.markets[symbol];
  if (!market) {
    console.error("Market not found:", symbol);
    process.exit(1);
  }

  // Binance returns lotSize and minNotional in market.info.filters
  const info = market.info;
  let minNotional = null;
  let stepSize = null;
  if (info && info.filters) {
    for (const f of info.filters) {
      if (f.filterType === "MIN_NOTIONAL") minNotional = Number(f.minNotional || f.minNotional);
      if (f.filterType === "LOT_SIZE") stepSize = Number(f.stepSize || f.tickSize || f.stepSize);
    }
  }

  console.log("market.symbol:", market.symbol);
  console.log("precision:", market.precision);
  console.log("limits:", market.limits);
  console.log("minNotional (USD):", minNotional);
  console.log("stepSize (base asset unit):", stepSize);
  console.log("example minimal BTC qty for USD minNotional:", minNotional ? (minNotional / market.info.lastPrice || "n/a") : "n/a");
  console.log("\nIf minNotional is null, check market.info for exchange-specific fields:", Object.keys(info));
}

main().catch(e => { console.error(e); process.exit(1); });
