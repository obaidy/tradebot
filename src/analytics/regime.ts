export type Candle = [number, number, number, number, number, number];

export interface RegimeMetrics {
  atr: number;
  atrPct: number;
  volatility: number;
  fundingRate?: number | null;
}

export type RegimeLabel = 'high_vol' | 'low_vol' | 'normal';

export interface RegimeAnalysis {
  metrics: RegimeMetrics;
  regime: RegimeLabel;
  adjustments: {
    gridStepsMultiplier: number;
    gridSizeMultiplier: number;
    perTradeMultiplier: number;
  };
}

export function calculateATR(candles: Candle[], period = 14): number {
  if (!candles.length || period <= 0) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1][4];
    const high = candles[i][2];
    const low = candles[i][3];
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  if (!trs.length) return 0;
  const slice = trs.slice(-period);
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}

export function calculateVolatility(closes: number[], period = 30): number {
  if (closes.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    if (prev <= 0) continue;
    returns.push(Math.log(closes[i] / prev));
  }
  const slice = returns.slice(-period);
  if (!slice.length) return 0;
  const mean = slice.reduce((s, r) => s + r, 0) / slice.length;
  const variance = slice.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / slice.length;
  return Math.sqrt(variance);
}

export function classifyRegime(metrics: RegimeMetrics): RegimeAnalysis {
  const { atrPct, volatility, fundingRate } = metrics;
  let regime: RegimeLabel = 'normal';
  const adjustments = {
    gridStepsMultiplier: 1,
    gridSizeMultiplier: 1,
    perTradeMultiplier: 1,
  };

  if (atrPct >= 0.02 || volatility >= 0.018) {
    regime = 'high_vol';
    adjustments.gridStepsMultiplier = 1.2; // more levels to capture swings
    adjustments.gridSizeMultiplier = 1.4; // widen spacing
    adjustments.perTradeMultiplier = 0.8; // dial down risk per order
  } else if (atrPct <= 0.006 || volatility <= 0.006) {
    regime = 'low_vol';
    adjustments.gridStepsMultiplier = 0.8; // fewer levels
    adjustments.gridSizeMultiplier = 0.7; // tighter spacing
    adjustments.perTradeMultiplier = 1.1; // slightly larger orders to compensate
  }

  if (typeof fundingRate === 'number') {
    if (fundingRate < -0.0005) {
      // negative funding -> paid to be long, encourage exposure
      adjustments.perTradeMultiplier *= 1.1;
    } else if (fundingRate > 0.0007) {
      // paying funding -> throttle risk
      adjustments.perTradeMultiplier *= 0.9;
    }
  }

  return { metrics, regime, adjustments };
}

export function analyzeRegime(
  candles: Candle[],
  closes: number[],
  midPrice: number,
  fundingRate?: number | null
): RegimeAnalysis {
  const atr = calculateATR(candles);
  const atrPct = midPrice > 0 ? atr / midPrice : 0;
  const volatility = calculateVolatility(closes);
  return classifyRegime({ atr, atrPct, volatility, fundingRate });
}
