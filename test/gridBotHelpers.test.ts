import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  adjustPerTradeToExchange,
  summarizePlanned,
  getMarketStepAndMinNotional,
} from "../src/strategies/gridBot";

describe("adjustPerTradeToExchange", () => {
  it("bumps to meet min notional", () => {
    const result = adjustPerTradeToExchange(1, 115000, 1e-8, 8, 5);
    expect(result.perTradeUsd).toBeGreaterThanOrEqual(5);
    expect(result.adjusted).toBe(true);
    expect(result.reason).toContain("minNotional");
  });

  it("rounds down to valid step size when already above minimum", () => {
    const price = 100;
    const stepSize = 0.001;
    const res = adjustPerTradeToExchange(25, price, stepSize, 3, null);
    expect(res.amount % stepSize).toBeCloseTo(0);
    expect(res.adjusted).toBe(false);
  });
});

describe("summarizePlanned", () => {
  const originalTp = process.env.TP;

  beforeEach(() => {
    process.env.TP = "0.05"; // 5%
  });

  afterEach(() => {
    process.env.TP = originalTp;
  });

  it("computes aggregate totals and raw values", () => {
    const summary = summarizePlanned(
      "BTC/USDT",
      [
        { price: 10000, amount: 0.001 },
        { price: 9500, amount: 0.0012 },
      ],
      10,
      0.001
    );

    expect(summary.numBuys).toBe(2);
    expect(summary.raw.totalBtc).toBeCloseTo(0.0022, 10);
    expect(Number(summary.entryUsd)).toBeGreaterThan(0);
    expect(summary.raw.estNetReturnPct).toBeGreaterThan(0);
  });
});

describe("getMarketStepAndMinNotional", () => {
  it("derives precision and minNotional from market metadata", () => {
    const ex = {
      markets: {
        "BTC/USDT": {
          precision: { base: 5 },
          limits: { cost: { min: 12 } },
        },
      },
    } as any;

    const result = getMarketStepAndMinNotional(ex, "BTC/USDT");
    expect(result.stepSize).toBeCloseTo(1e-5);
    expect(result.basePrecision).toBe(5);
    expect(result.minNotional).toBe(12);
  });

  it("falls back to defaults when market metadata missing", () => {
    const result = getMarketStepAndMinNotional({}, "ETH/USDT");
    expect(result.stepSize).toBeCloseTo(1e-8);
    expect(result.basePrecision).toBe(8);
    expect(result.minNotional).toBeNull();
  });
});
