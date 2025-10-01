import { Candle } from '../regime';
import { logger } from '../../utils/logger';

export interface MarketMicrostructureSnapshot {
  bid: number;
  ask: number;
  bidVolume: number;
  askVolume: number;
  tradesBuyVolume?: number;
  tradesSellVolume?: number;
  timestamp: number;
}

export interface NewsSentimentRecord {
  score: number; // -1 bearish, +1 bullish
  confidence: number; // 0-1
  headline?: string;
  source?: string;
  timestamp: number;
}

export interface OnChainMetricsSnapshot {
  whaleInflowUsd: number;
  whaleOutflowUsd: number;
  exchangeInflowUsd: number;
  exchangeOutflowUsd: number;
  largeTxnCount: number;
  timestamp: number;
}

export interface AdvancedRegimeInsight {
  garchVolatility: number;
  volatilityLabel: 'calm' | 'balanced' | 'turbulent';
  microstructure: {
    averageSpreadBp: number;
    orderFlowImbalance: number;
    liquidityScore: number;
  };
  sentiment: {
    blendedScore: number;
    confidence: number;
  };
  onChain: {
    whalePressure: number;
    exchangePressure: number;
    largeTxnMomentum: number;
  };
  compositeScore: number;
  suggestedRiskStance: 'increase' | 'neutral' | 'decrease';
}

export interface NewsSentimentProvider {
  fetchLatestSentiment(pair: string): Promise<NewsSentimentRecord | null>;
}

export interface OnChainMetricsProvider {
  fetchLatestMetrics(pair: string): Promise<OnChainMetricsSnapshot | null>;
}

export interface AdvancedRegimeDetectorDeps {
  newsProvider?: NewsSentimentProvider;
  onChainProvider?: OnChainMetricsProvider;
}

export class AdvancedRegimeDetector {
  private newsProvider?: NewsSentimentProvider;
  private onChainProvider?: OnChainMetricsProvider;

  constructor(deps: AdvancedRegimeDetectorDeps = {}) {
    this.newsProvider = deps.newsProvider;
    this.onChainProvider = deps.onChainProvider;
  }

  async analyze(params: {
    pair: string;
    candles: Candle[];
    midPrice: number;
    microstructure?: MarketMicrostructureSnapshot[];
  }): Promise<AdvancedRegimeInsight> {
    const { pair, candles, midPrice } = params;
    const returns = this.computeLogReturns(candles.map((c) => c[4]));
    const garchVolatility = this.estimateGarchVol(returns);
    const volatilityLabel = this.labelVolatility(garchVolatility);

    const microstructure = this.analyzeMicrostructure(params.microstructure ?? []);

    const [sentiment, onChain] = await Promise.all([
      this.fetchSentiment(pair).catch((error) => {
        logger.warn('sentiment_fetch_failed', {
          event: 'sentiment_fetch_failed',
          pair,
          error: error instanceof Error ? error.message : String(error),
        });
        return this.defaultSentiment();
      }),
      this.fetchOnChain(pair).catch((error) => {
        logger.warn('onchain_fetch_failed', {
          event: 'onchain_fetch_failed',
          pair,
          error: error instanceof Error ? error.message : String(error),
        });
        return this.defaultOnChain();
      }),
    ]);

    const compositeScore = this.computeCompositeScore({
      garchVolatility,
      microstructure,
      sentiment,
      onChain,
      midPrice,
    });

    const suggestedRiskStance = compositeScore >= 0.25 ? 'increase' : compositeScore <= -0.25 ? 'decrease' : 'neutral';

    return {
      garchVolatility,
      volatilityLabel,
      microstructure,
      sentiment,
      onChain,
      compositeScore,
      suggestedRiskStance,
    };
  }

  private computeLogReturns(closes: number[]): number[] {
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i += 1) {
      const prev = closes[i - 1];
      const next = closes[i];
      if (prev > 0 && next > 0) {
        returns.push(Math.log(next / prev));
      }
    }
    return returns;
  }

  private estimateGarchVol(returns: number[], alpha = 0.08, beta = 0.9, omega = 0.000001): number {
    if (!returns.length) return 0;
    let variance = returns.reduce((sum, r) => sum + r * r, 0) / returns.length;
    for (const r of returns.slice(-200)) {
      variance = omega + alpha * r * r + beta * variance;
    }
    return Math.sqrt(Math.max(variance, 0));
  }

  private labelVolatility(vol: number): AdvancedRegimeInsight['volatilityLabel'] {
    if (vol >= 0.05) return 'turbulent';
    if (vol <= 0.015) return 'calm';
    return 'balanced';
  }

  private analyzeMicrostructure(snapshots: MarketMicrostructureSnapshot[]): AdvancedRegimeInsight['microstructure'] {
    if (!snapshots.length) {
      return { averageSpreadBp: 0, orderFlowImbalance: 0, liquidityScore: 0.5 };
    }
    let spreadSum = 0;
    let imbalanceSum = 0;
    let liquiditySum = 0;
    for (const snap of snapshots) {
      const mid = (snap.bid + snap.ask) / 2;
      if (mid <= 0) continue;
      const spreadBp = ((snap.ask - snap.bid) / mid) * 10_000;
      spreadSum += spreadBp;
      const volumeTotal = (snap.bidVolume || 0) + (snap.askVolume || 0);
      if (volumeTotal > 0) {
        imbalanceSum += ((snap.bidVolume || 0) - (snap.askVolume || 0)) / volumeTotal;
      }
      const tradeFlow = (snap.tradesBuyVolume ?? snap.bidVolume) - (snap.tradesSellVolume ?? snap.askVolume);
      const liquidity = volumeTotal > 0 ? Math.min(Math.abs(tradeFlow) / volumeTotal, 1) : 0;
      liquiditySum += 1 - liquidity;
    }
    const count = snapshots.length;
    return {
      averageSpreadBp: spreadSum / count,
      orderFlowImbalance: imbalanceSum / count,
      liquidityScore: Math.min(Math.max(liquiditySum / count, 0), 1),
    };
  }

  private async fetchSentiment(pair: string): Promise<AdvancedRegimeInsight['sentiment']> {
    if (!this.newsProvider) return this.defaultSentiment();
    const latest = await this.newsProvider.fetchLatestSentiment(pair);
    if (!latest) return this.defaultSentiment();
    return {
      blendedScore: Math.max(Math.min(latest.score, 1), -1),
      confidence: Math.max(Math.min(latest.confidence, 1), 0),
    };
  }

  private async fetchOnChain(pair: string): Promise<AdvancedRegimeInsight['onChain']> {
    if (!this.onChainProvider) return this.defaultOnChain();
    const latest = await this.onChainProvider.fetchLatestMetrics(pair);
    if (!latest) return this.defaultOnChain();
    const whaleNet = latest.whaleInflowUsd - latest.whaleOutflowUsd;
    const exchangeNet = latest.exchangeInflowUsd - latest.exchangeOutflowUsd;
    const whalePressure = Math.tanh(whaleNet / 5_000_000);
    const exchangePressure = Math.tanh(exchangeNet / 5_000_000);
    const txnMomentum = Math.tanh((latest.largeTxnCount - 50) / 50);
    return {
      whalePressure,
      exchangePressure,
      largeTxnMomentum: txnMomentum,
    };
  }

  private defaultSentiment(): AdvancedRegimeInsight['sentiment'] {
    return { blendedScore: 0, confidence: 0.35 };
  }

  private defaultOnChain(): AdvancedRegimeInsight['onChain'] {
    return { whalePressure: 0, exchangePressure: 0, largeTxnMomentum: 0 };
  }

  private computeCompositeScore(input: {
    garchVolatility: number;
    microstructure: AdvancedRegimeInsight['microstructure'];
    sentiment: AdvancedRegimeInsight['sentiment'];
    onChain: AdvancedRegimeInsight['onChain'];
    midPrice: number;
  }): number {
    const volScore = this.scoreVolatility(input.garchVolatility);
    const spreadPenalty = Math.min(input.microstructure.averageSpreadBp / 15, 1);
    const liquidityBonus = input.microstructure.liquidityScore - 0.5;
    const flowBias = input.microstructure.orderFlowImbalance;
    const sentimentComponent = input.sentiment.blendedScore * input.sentiment.confidence;
    const onChainComponent = (input.onChain.whalePressure - input.onChain.exchangePressure) * 0.5 +
      input.onChain.largeTxnMomentum * 0.25;

    const raw = volScore - spreadPenalty + liquidityBonus + flowBias + sentimentComponent + onChainComponent;
    return Math.max(Math.min(raw, 1), -1);
  }

  private scoreVolatility(vol: number): number {
    if (vol <= 0.01) return 0.4;
    if (vol <= 0.025) return 0.1;
    if (vol <= 0.04) return -0.15;
    return -0.4;
  }
}
