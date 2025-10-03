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

export interface OptionsFlowSnapshot {
  callVolumeUsd: number;
  putVolumeUsd: number;
  sweepNotionalUsd?: number;
  unusualActivityScore?: number; // -1 bearish, +1 bullish
  timestamp: number;
}

export interface SocialSentimentSnapshot {
  sentimentScore: number; // -1 bearish, +1 bullish
  momentum?: number; // -1 fading, +1 accelerating
  mentionDeltaPct?: number; // change in mention volume
  timestamp: number;
}

export interface InstitutionalFlowSnapshot {
  netLongRatio: number; // -1 net short, +1 net long
  positionChangePct?: number; // day-over-day change
  openInterestSkew?: number; // -1 decreasing, +1 increasing
  timestamp: number;
}

export interface MacroSignalSnapshot {
  eventRiskLevel: number; // 0-1 risk of major event soon
  surpriseIndex?: number; // -1 dovish surprise, +1 hawkish surprise
  policyBias?: number; // -1 easing bias, +1 tightening bias
  timestamp: number;
}

export interface AlternativeDataSnapshot {
  supplyStress?: number; // -1 slack, +1 stressed
  demandPulse?: number; // -1 contracting, +1 expanding
  logisticsPressure?: number; // -1 easing, +1 congested
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
  optionsFlow: {
    skew: number;
    unusualActivity: number;
    sweepPressure: number;
  };
  social: {
    sentimentScore: number;
    momentum: number;
    mentionDelta: number;
  };
  institutional: {
    netPositioning: number;
    positionVelocity: number;
    openInterestPressure: number;
  };
  macro: {
    eventRisk: number;
    surpriseIndex: number;
    policyBias: number;
  };
  alternative: {
    supplyStress: number;
    demandPulse: number;
    logisticsPressure: number;
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

export interface OptionsFlowProvider {
  fetchOptionsFlow(pair: string): Promise<OptionsFlowSnapshot | null>;
}

export interface SocialSentimentProvider {
  fetchSocialSentiment(pair: string): Promise<SocialSentimentSnapshot | null>;
}

export interface InstitutionalFlowProvider {
  fetchInstitutionalFlow(pair: string): Promise<InstitutionalFlowSnapshot | null>;
}

export interface MacroEconomicProvider {
  fetchMacroSignals(pair: string): Promise<MacroSignalSnapshot | null>;
}

export interface AlternativeDataProvider {
  fetchAlternativeSnapshot(pair: string): Promise<AlternativeDataSnapshot | null>;
}

export interface AdvancedRegimeDetectorDeps {
  newsProvider?: NewsSentimentProvider;
  onChainProvider?: OnChainMetricsProvider;
  optionsFlowProvider?: OptionsFlowProvider;
  socialSentimentProvider?: SocialSentimentProvider;
  institutionalFlowProvider?: InstitutionalFlowProvider;
  macroEconomicProvider?: MacroEconomicProvider;
  alternativeDataProvider?: AlternativeDataProvider;
}

export class AdvancedRegimeDetector {
  private newsProvider?: NewsSentimentProvider;
  private onChainProvider?: OnChainMetricsProvider;
  private optionsFlowProvider?: OptionsFlowProvider;
  private socialSentimentProvider?: SocialSentimentProvider;
  private institutionalFlowProvider?: InstitutionalFlowProvider;
  private macroEconomicProvider?: MacroEconomicProvider;
  private alternativeDataProvider?: AlternativeDataProvider;

  constructor(deps: AdvancedRegimeDetectorDeps = {}) {
    this.newsProvider = deps.newsProvider;
    this.onChainProvider = deps.onChainProvider;
    this.optionsFlowProvider = deps.optionsFlowProvider;
    this.socialSentimentProvider = deps.socialSentimentProvider;
    this.institutionalFlowProvider = deps.institutionalFlowProvider;
    this.macroEconomicProvider = deps.macroEconomicProvider;
    this.alternativeDataProvider = deps.alternativeDataProvider;
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

    const [sentiment, onChain, optionsFlow, social, institutional, macro, alternative] = await Promise.all([
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
      this.fetchOptionsFlow(pair).catch((error) => {
        logger.warn('options_flow_fetch_failed', {
          event: 'options_flow_fetch_failed',
          pair,
          error: error instanceof Error ? error.message : String(error),
        });
        return this.defaultOptionsFlow();
      }),
      this.fetchSocialSentiment(pair).catch((error) => {
        logger.warn('social_sentiment_fetch_failed', {
          event: 'social_sentiment_fetch_failed',
          pair,
          error: error instanceof Error ? error.message : String(error),
        });
        return this.defaultSocialSentiment();
      }),
      this.fetchInstitutionalFlow(pair).catch((error) => {
        logger.warn('institutional_flow_fetch_failed', {
          event: 'institutional_flow_fetch_failed',
          pair,
          error: error instanceof Error ? error.message : String(error),
        });
        return this.defaultInstitutionalFlow();
      }),
      this.fetchMacroSignals(pair).catch((error) => {
        logger.warn('macro_signal_fetch_failed', {
          event: 'macro_signal_fetch_failed',
          pair,
          error: error instanceof Error ? error.message : String(error),
        });
        return this.defaultMacroSignals();
      }),
      this.fetchAlternativeData(pair).catch((error) => {
        logger.warn('alternative_data_fetch_failed', {
          event: 'alternative_data_fetch_failed',
          pair,
          error: error instanceof Error ? error.message : String(error),
        });
        return this.defaultAlternativeData();
      }),
    ]);

    const compositeScore = this.computeCompositeScore({
      garchVolatility,
      microstructure,
      sentiment,
      onChain,
      optionsFlow,
      social,
      institutional,
      macro,
      alternative,
      midPrice,
    });

    const suggestedRiskStance = compositeScore >= 0.25 ? 'increase' : compositeScore <= -0.25 ? 'decrease' : 'neutral';

    return {
      garchVolatility,
      volatilityLabel,
      microstructure,
      sentiment,
      onChain,
      optionsFlow,
      social,
      institutional,
      macro,
      alternative,
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

  private async fetchOptionsFlow(pair: string): Promise<AdvancedRegimeInsight['optionsFlow']> {
    if (!this.optionsFlowProvider) return this.defaultOptionsFlow();
    const snapshot = await this.optionsFlowProvider.fetchOptionsFlow(pair);
    if (!snapshot) return this.defaultOptionsFlow();
    const total = snapshot.callVolumeUsd + snapshot.putVolumeUsd;
    const skew = total > 0 ? (snapshot.callVolumeUsd - snapshot.putVolumeUsd) / total : 0;
    const unusual = Math.max(-1, Math.min(1, snapshot.unusualActivityScore ?? 0));
    const sweepPressure = snapshot.sweepNotionalUsd
      ? Math.max(-1, Math.min(1, Math.tanh(snapshot.sweepNotionalUsd / 1_000_000)))
      : 0;
    return {
      skew,
      unusualActivity: unusual,
      sweepPressure,
    };
  }

  private async fetchSocialSentiment(pair: string): Promise<AdvancedRegimeInsight['social']> {
    if (!this.socialSentimentProvider) return this.defaultSocialSentiment();
    const snapshot = await this.socialSentimentProvider.fetchSocialSentiment(pair);
    if (!snapshot) return this.defaultSocialSentiment();
    const sentimentScore = Math.max(-1, Math.min(1, snapshot.sentimentScore));
    const momentum = Math.max(-1, Math.min(1, snapshot.momentum ?? 0));
    const mentionDelta = Math.max(-1, Math.min(1, Math.tanh((snapshot.mentionDeltaPct ?? 0) / 100)));
    return {
      sentimentScore,
      momentum,
      mentionDelta,
    };
  }

  private async fetchInstitutionalFlow(pair: string): Promise<AdvancedRegimeInsight['institutional']> {
    if (!this.institutionalFlowProvider) return this.defaultInstitutionalFlow();
    const snapshot = await this.institutionalFlowProvider.fetchInstitutionalFlow(pair);
    if (!snapshot) return this.defaultInstitutionalFlow();
    const netPositioning = Math.max(-1, Math.min(1, snapshot.netLongRatio));
    const positionVelocity = Math.max(-1, Math.min(1, (snapshot.positionChangePct ?? 0) / 100));
    const openInterestPressure = Math.max(-1, Math.min(1, snapshot.openInterestSkew ?? 0));
    return {
      netPositioning,
      positionVelocity,
      openInterestPressure,
    };
  }

  private async fetchMacroSignals(pair: string): Promise<AdvancedRegimeInsight['macro']> {
    if (!this.macroEconomicProvider) return this.defaultMacroSignals();
    const snapshot = await this.macroEconomicProvider.fetchMacroSignals(pair);
    if (!snapshot) return this.defaultMacroSignals();
    const eventRisk = Math.max(0, Math.min(1, snapshot.eventRiskLevel));
    const surpriseIndex = Math.max(-1, Math.min(1, snapshot.surpriseIndex ?? 0));
    const policyBias = Math.max(-1, Math.min(1, snapshot.policyBias ?? 0));
    return {
      eventRisk,
      surpriseIndex,
      policyBias,
    };
  }

  private async fetchAlternativeData(pair: string): Promise<AdvancedRegimeInsight['alternative']> {
    if (!this.alternativeDataProvider) return this.defaultAlternativeData();
    const snapshot = await this.alternativeDataProvider.fetchAlternativeSnapshot(pair);
    if (!snapshot) return this.defaultAlternativeData();
    const supplyStress = Math.max(-1, Math.min(1, snapshot.supplyStress ?? 0));
    const demandPulse = Math.max(-1, Math.min(1, snapshot.demandPulse ?? 0));
    const logisticsPressure = Math.max(-1, Math.min(1, snapshot.logisticsPressure ?? 0));
    return {
      supplyStress,
      demandPulse,
      logisticsPressure,
    };
  }

  private defaultSentiment(): AdvancedRegimeInsight['sentiment'] {
    return { blendedScore: 0, confidence: 0.35 };
  }

  private defaultOnChain(): AdvancedRegimeInsight['onChain'] {
    return { whalePressure: 0, exchangePressure: 0, largeTxnMomentum: 0 };
  }

  private defaultOptionsFlow(): AdvancedRegimeInsight['optionsFlow'] {
    return { skew: 0, unusualActivity: 0, sweepPressure: 0 };
  }

  private defaultSocialSentiment(): AdvancedRegimeInsight['social'] {
    return { sentimentScore: 0, momentum: 0, mentionDelta: 0 };
  }

  private defaultInstitutionalFlow(): AdvancedRegimeInsight['institutional'] {
    return { netPositioning: 0, positionVelocity: 0, openInterestPressure: 0 };
  }

  private defaultMacroSignals(): AdvancedRegimeInsight['macro'] {
    return { eventRisk: 0.3, surpriseIndex: 0, policyBias: 0 };
  }

  private defaultAlternativeData(): AdvancedRegimeInsight['alternative'] {
    return { supplyStress: 0, demandPulse: 0, logisticsPressure: 0 };
  }

  private computeCompositeScore(input: {
    garchVolatility: number;
    microstructure: AdvancedRegimeInsight['microstructure'];
    sentiment: AdvancedRegimeInsight['sentiment'];
    onChain: AdvancedRegimeInsight['onChain'];
    optionsFlow: AdvancedRegimeInsight['optionsFlow'];
    social: AdvancedRegimeInsight['social'];
    institutional: AdvancedRegimeInsight['institutional'];
    macro: AdvancedRegimeInsight['macro'];
    alternative: AdvancedRegimeInsight['alternative'];
    midPrice: number;
  }): number {
    const volScore = this.scoreVolatility(input.garchVolatility);
    const spreadPenalty = Math.min(input.microstructure.averageSpreadBp / 15, 1);
    const liquidityBonus = input.microstructure.liquidityScore - 0.5;
    const flowBias = input.microstructure.orderFlowImbalance;
    const sentimentComponent = input.sentiment.blendedScore * input.sentiment.confidence;
    const onChainComponent = (input.onChain.whalePressure - input.onChain.exchangePressure) * 0.5 +
      input.onChain.largeTxnMomentum * 0.25;

    const optionsComponent =
      input.optionsFlow.skew * 0.35 + input.optionsFlow.unusualActivity * 0.4 + input.optionsFlow.sweepPressure * 0.25;
    const socialComponent =
      input.social.sentimentScore * 0.4 + input.social.momentum * 0.25 + input.social.mentionDelta * 0.15;
    const institutionalComponent =
      input.institutional.netPositioning * 0.35 +
      input.institutional.positionVelocity * 0.25 +
      input.institutional.openInterestPressure * 0.2;
    const macroComponent =
      -input.macro.eventRisk * 0.45 + input.macro.policyBias * 0.3 + input.macro.surpriseIndex * 0.25;
    const alternativeComponent =
      -input.alternative.supplyStress * 0.35 + input.alternative.demandPulse * 0.3 - input.alternative.logisticsPressure * 0.2;

    const raw =
      volScore -
      spreadPenalty +
      liquidityBonus +
      flowBias +
      sentimentComponent +
      onChainComponent +
      optionsComponent +
      socialComponent +
      institutionalComponent +
      macroComponent +
      alternativeComponent;
    return Math.max(Math.min(raw, 1), -1);
  }

  private scoreVolatility(vol: number): number {
    if (vol <= 0.01) return 0.4;
    if (vol <= 0.025) return 0.1;
    if (vol <= 0.04) return -0.15;
    return -0.4;
  }
}
