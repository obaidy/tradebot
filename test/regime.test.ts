import { describe, expect, it } from 'vitest';
import { analyzeRegime, calculateATR, calculateVolatility, classifyRegime } from '../src/analytics/regime';

describe('regime analytics', () => {
  it('computes ATR and volatility', () => {
    const candles = Array.from({ length: 20 }, (_, i) => [i, 0, 110 + i, 90 - i, 100 + i, 0] as const);
    const atr = calculateATR(candles as any, 14);
    expect(atr).toBeGreaterThan(0);

    const closes = candles.map((c) => c[4]);
    const vol = calculateVolatility(closes, 14);
    expect(vol).toBeGreaterThan(0);
  });

  it('classifies high volatility regime', () => {
    const analysis = classifyRegime({ atr: 5, atrPct: 0.03, volatility: 0.02, fundingRate: 0 });
    expect(analysis.regime).toBe('high_vol');
    expect(analysis.adjustments.gridStepsMultiplier).toBeGreaterThan(1);
    expect(analysis.adjustments.gridSizeMultiplier).toBeGreaterThan(1);
    expect(analysis.adjustments.perTradeMultiplier).toBeLessThan(1);
  });

  it('classifies low volatility regime and adjusts per trade on funding', () => {
    const analysis = classifyRegime({ atr: 0.5, atrPct: 0.003, volatility: 0.003, fundingRate: -0.001 });
    expect(analysis.regime).toBe('low_vol');
    expect(analysis.adjustments.gridStepsMultiplier).toBeLessThan(1);
    expect(analysis.adjustments.perTradeMultiplier).toBeGreaterThan(1);
  });

  it('analyzes regime from candles and closes', () => {
    const candles = Array.from({ length: 60 }, (_, i) => [i, 0, 105, 95, 100 + Math.sin(i / 3), 0] as const);
    const closes = candles.map((c) => c[4]);
    const result = analyzeRegime(candles as any, closes, 100, null);
    expect(result.regime).toBeDefined();
    expect(result.adjustments.gridStepsMultiplier).toBeGreaterThan(0);
  });
});
