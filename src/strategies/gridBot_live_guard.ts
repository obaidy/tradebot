// src/strategies/gridBot_live_guard.ts
import { getExchange } from "../exchanges/ccxtClient";
import { Telegram } from "../alerts/telegram";
import { logger, setLogContext } from "../utils/logger";
import { getPool } from "../db/pool";
import { runMigrations } from "../db/migrations";
import { CONFIG } from "../config";
import { ClientConfigService } from "../services/clientConfig";
import { circuitBreaker } from "../guard/circuitBreaker";

type Candle = [number, number, number, number, number, number];

function safeMean(vals: number[]) {
  if (!vals.length) return NaN;
  return vals.reduce((s: number, n: number) => s + n, 0) / vals.length;
}

/**
 * Helper: call runGridOnce in SUMMARY_ONLY mode so it prints PLANNED SUMMARY
 * without attempting any live orders. This uses the existing SUMMARY_ONLY
 * env-switch you previously added to gridBot.runGridOnce().
 */
async function printPlannedSummaryIfAvailable(pair: string, gridParams: any, apiKey?: string, apiSecret?: string) {
  try {
    // set env flag so runGridOnce returns after printing summary
    process.env.SUMMARY_ONLY = "true";
    const mod = await import("./gridBot");
    if (mod && typeof mod.runGridOnce === "function") {
      try {
        await mod.runGridOnce(pair, apiKey, apiSecret);
      } catch (e) {
        // if runGridOnce fails, log but don't rethrow (we don't want to bypass guard)
        logger.warn("guard_plan_print_failed", {
          event: "guard_plan_print_failed",
          pair,
          error: e,
        });
      }
    } else {
      logger.warn("guard_plan_runner_missing", {
        event: "guard_plan_runner_missing",
        pair,
      });
    }
  } finally {
    // clean up env
    delete process.env.SUMMARY_ONLY;
  }
}

/**
 * runGuardedGrid:
 * - fetches recent 1h candles
 * - computes SMA (last smaPeriodHours) and ATR (naive on last 30 candles)
 * - posts verbose guard check to console + Telegram
 * - skips or calls real grid runner
 */
export async function runGuardedGrid(
  pair: string,
  gridParams: {
    gridSteps: number;
    k: number;
    tp: number;
    perTrade: number;
    smaPeriodHours: number;
    meanRevertPct: number;
    minAtrPct: number;
  },
  apiKey?: string,
  apiSecret?: string
) {
  const pool = getPool();
  await runMigrations(pool);
  const clientId = CONFIG.RUN.CLIENT_ID;
  const clientConfigService = new ClientConfigService(pool, {
    allowedClientId: clientId,
    defaultExchange: CONFIG.DEFAULT_EXCHANGE,
  });
  setLogContext({ clientId });
  const clientProfile = await clientConfigService.getClientProfile(clientId);
  circuitBreaker.configureForClient(clientProfile.guard, clientId);
  let effectiveApiKey = apiKey;
  let effectiveApiSecret = apiSecret;
  let effectivePassphrase: string | null | undefined = undefined;

  if (!effectiveApiKey || !effectiveApiSecret) {
    try {
      const fullConfig = await clientConfigService.getClientConfig(clientId, clientProfile.exchangeId);
      effectiveApiKey = fullConfig.exchange.apiKey;
      effectiveApiSecret = fullConfig.exchange.apiSecret;
      effectivePassphrase = fullConfig.exchange.passphrase;
    } catch (err) {
      if (!CONFIG.PAPER_MODE && (process.env.SUMMARY_ONLY || '').toLowerCase() !== 'true') {
        throw err;
      }
      logger.warn("client_credentials_missing", {
        event: "client_credentials_missing",
        clientId,
        exchangeId: clientProfile.exchangeId,
        location: "guard",
        mode: CONFIG.PAPER_MODE ? "paper" : "live",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ex = getExchange({
    exchangeId: clientProfile.exchangeId,
    apiKey: effectiveApiKey,
    apiSecret: effectiveApiSecret,
    passphrase: effectivePassphrase,
  });
  // fetch enough candles (smaPeriodHours + buffer)
  const limit = Math.max(100, gridParams.smaPeriodHours + 50);
  const raw: any = await ex.fetchOHLCV(pair, "1h", undefined, limit);
  const candles = raw as Candle[];

  if (!candles || candles.length === 0) {
    const msg = `GUARD ERROR: no candles for ${pair}`;
    logger.error("guard_no_candles", {
      event: "guard_no_candles",
      pair,
      limit,
    });
    await Telegram.sendMessage(msg).catch(() => {});
    // Print planned summary for inspection if possible, then return
    await printPlannedSummaryIfAvailable(pair, gridParams, apiKey, apiSecret);
    return;
  }

  const closes = candles.map((c) => c[4]);
  const recentForSma = closes.slice(-gridParams.smaPeriodHours);
  const mid = safeMean(recentForSma);

  // naive ATR calc over last 30 candles (or as many as available)
  const startIdx = Math.max(1, candles.length - 30);
  const trs: number[] = [];
  for (let i = startIdx; i < candles.length; i++) {
    const high = candles[i][2];
    const low = candles[i][3];
    const prev = candles[i - 1][4];
    trs.push(Math.max(high - low, Math.abs(high - prev), Math.abs(low - prev)));
  }
  const atr = safeMean(trs);

  const price = closes[closes.length - 1];
  // compute a symmetric allowed band around mid (makes guard less brittle)
  const allowedLow = mid * (1 - gridParams.meanRevertPct);
  const allowedHigh = mid * (1 + gridParams.meanRevertPct);
  const atrPct = atr && price ? atr / price : 0;

  const msg = `GUARD CHECK: pair=${pair} price=${price.toFixed(2)} mid=${Number(mid).toFixed(
    2
  )} allowedLow=${Number(allowedLow).toFixed(2)} allowedHigh=${Number(allowedHigh).toFixed(2)} atr=${Number(atr).toFixed(
    4
  )} atr/price=${atrPct.toFixed(5)} meanRevertPct=${gridParams.meanRevertPct} minAtrPct=${gridParams.minAtrPct}`;
  logger.info("guard_check", {
    event: "guard_check",
    pair,
    price,
    mid,
    allowedLow,
    allowedHigh,
    atr,
    atrPct,
    meanRevertPct: gridParams.meanRevertPct,
    minAtrPct: gridParams.minAtrPct,
  });
  await Telegram.sendMessage(msg).catch(() => {});

  if (!isFinite(mid) || !isFinite(atr) || !isFinite(price)) {
    const skipMsg = `GUARD: insufficient data (mid=${mid}, atr=${atr}, price=${price}). Skipping.`;
    logger.warn("guard_skip_insufficient_data", {
      event: "guard_skip_insufficient_data",
      pair,
      mid,
      atr,
      price,
    });
    await Telegram.sendMessage(skipMsg).catch(() => {});
    // still print planned summary for inspection
    await printPlannedSummaryIfAvailable(pair, gridParams, apiKey, apiSecret);
    return;
  }

  // allow grid when price is inside the mean-revert band; otherwise skip
  if (price < allowedLow || price > allowedHigh) {
    const skipMsg = `GUARD: price ${price.toFixed(2)} is outside band [${allowedLow.toFixed(
      2
    )} - ${allowedHigh.toFixed(2)}]. Skipping grid placement.`;
    logger.warn("guard_skip_price_band", {
      event: "guard_skip_price_band",
      pair,
      price,
      allowedLow,
      allowedHigh,
    });
    await Telegram.sendMessage(skipMsg).catch(() => {});
    // print planned summary for inspection
    await printPlannedSummaryIfAvailable(pair, gridParams, apiKey, apiSecret);
    return;
  }

  if (atrPct < gridParams.minAtrPct) {
    const skipMsg = `GUARD: low volatility (ATR/price=${atrPct.toFixed(6)} < minAtrPct=${gridParams.minAtrPct}). Skipping grid placement.`;
    logger.warn("guard_skip_low_vol", {
      event: "guard_skip_low_vol",
      pair,
      atrPct,
      minAtrPct: gridParams.minAtrPct,
    });
    await Telegram.sendMessage(skipMsg).catch(() => {});
    // print planned summary for inspection
    await printPlannedSummaryIfAvailable(pair, gridParams, apiKey, apiSecret);
    return;
  }

  logger.info("guard_passed", {
    event: "guard_passed",
    pair,
    mid,
    atr,
  });
  // dynamic import so we only load gridBot when the guard passes
  const mod = await import("./gridBot");
  if (mod && typeof mod.runGridOnce === "function") {
    await mod.runGridOnce(pair, apiKey, apiSecret);
  } else {
    const err = "GUARD ERROR: gridBot.runGridOnce not found";
    logger.error("guard_runner_missing", {
      event: "guard_runner_missing",
      pair,
    });
    await Telegram.sendMessage(err).catch(() => {});
  }
}
