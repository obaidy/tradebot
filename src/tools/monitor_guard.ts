// src/tools/monitor_guard.ts
import ccxt from "ccxt";
import { Telegram } from "../alerts/telegram"; // from src/tools -> ../alerts/telegram

async function check() {
  try {
    const ex = new ccxt.binance({ enableRateLimit: true });
    const candles: any = await ex.fetchOHLCV("BTC/USDT", "1h", undefined, 50);
    if (!candles || candles.length === 0) {
      console.log("MONITOR: no candles fetched");
      return;
    }
    const closes = candles.map((c: any) => c[4]);
    const smaWindow = 24;
    if (closes.length < smaWindow) {
      console.log("MONITOR: not enough candles for SMA");
      return;
    }
    const sma = closes.slice(-smaWindow).reduce((s: number, n: number) => s + n, 0) / smaWindow;
    const price = closes[closes.length - 1];
    const msg = `MONITOR: price=${price.toFixed(2)}, sma${smaWindow}=${sma.toFixed(2)}, price<=sma? ${price <= sma}`;
    console.log(msg);
    if (price <= sma) {
      await Telegram.sendMessage(`GUARD TRIGGER: ${msg}`).catch(()=>{});
    }
  } catch (e) {
    console.error("MONITOR ERROR:", e);
    await Telegram.sendMessage(`MONITOR ERROR: ${String(e)}`).catch(()=>{});
  }
}

setInterval(check, 5 * 60 * 1000);
check();
