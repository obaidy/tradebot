import { Candle } from '../regime';

export interface PredictiveTrainingSnapshot {
  timestamp: number;
  price: number;
  volume?: number;
  fundingRate?: number;
}

export interface PredictiveOutputs {
  priceDirection: number;
  volatilityForecast: number;
  crashProbability: number;
  fundingRateForecast: number;
}

export class PredictiveAnalyticsEngine {
  private momentumLookback = 12;
  private volatilityLookback = 48;

  train({
    candles,
    fundingRates,
  }: {
    candles: Candle[];
    fundingRates?: number[];
  }) {
    if (fundingRates && fundingRates.length) {
      this.momentumLookback = Math.min(24, Math.max(6, Math.round(fundingRates.length / 3)));
      this.volatilityLookback = Math.min(96, Math.max(24, fundingRates.length));
    } else if (candles.length) {
      this.volatilityLookback = Math.min(96, Math.max(24, Math.round(candles.length / 2)));
    }
  }

  generateSignals({
    candles,
    recentFundingRates,
  }: {
    candles: Candle[];
    recentFundingRates?: number[];
  }): PredictiveOutputs {
    const closes = candles.map((c) => c[4]);
    const priceDirection = this.computePriceDirection(closes);
    const volatilityForecast = this.computeVolatilityForecast(closes);
    const crashProbability = this.estimateCrashProbability(closes);
    const fundingRateForecast = this.estimateFundingRate(recentFundingRates ?? []);
    return {
      priceDirection,
      volatilityForecast,
      crashProbability,
      fundingRateForecast,
    };
  }

  private computePriceDirection(closes: number[]): number {
    if (closes.length < this.momentumLookback + 2) return 0;
    const recent = closes.slice(-this.momentumLookback);
    const older = closes.slice(-this.momentumLookback - 5, -this.momentumLookback);
    if (!older.length) return 0;
    const recentReturn = (recent[recent.length - 1] - recent[0]) / recent[0];
    const olderReturn = (older[older.length - 1] - older[0]) / older[0];
    const direction = recentReturn - olderReturn;
    return Math.max(-1, Math.min(1, direction * 5));
  }

  private computeVolatilityForecast(closes: number[]): number {
    if (closes.length < 2) return 0;
    const lookback = Math.min(this.volatilityLookback, closes.length - 1);
    const returns: number[] = [];
    for (let i = closes.length - lookback; i < closes.length - 1; i += 1) {
      const prev = closes[i];
      const next = closes[i + 1];
      if (prev > 0 && next > 0) {
        returns.push(Math.log(next / prev));
      }
    }
    if (!returns.length) return 0;
    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(Math.max(variance, 0)) * Math.sqrt(365 * 24);
  }

  private estimateCrashProbability(closes: number[]): number {
    if (closes.length < 10) return 0.1;
    const lookback = Math.min(72, closes.length - 1);
    let tailEvents = 0;
    let total = 0;
    for (let i = closes.length - lookback; i < closes.length - 1; i += 1) {
      const prev = closes[i];
      const next = closes[i + 1];
      if (prev <= 0 || next <= 0) continue;
      const change = (next - prev) / prev;
      if (change <= -0.035) tailEvents += 1;
      total += 1;
    }
    if (!total) return 0.1;
    const frequency = tailEvents / total;
    const probability = Math.min(0.95, Math.max(0.01, frequency * 3));
    return probability;
  }

  private estimateFundingRate(fundingRates: number[]): number {
    if (!fundingRates.length) return 0;
    const weighted = fundingRates.reduce((sum, rate, idx) => {
      const weight = idx + 1;
      return sum + rate * weight;
    }, 0);
    const totalWeight = (fundingRates.length * (fundingRates.length + 1)) / 2;
    return weighted / totalWeight;
  }
}
