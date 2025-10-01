import { Candle } from '../regime';
import { AdvancedRegimeDetector, AdvancedRegimeInsight, AdvancedRegimeDetectorDeps, MarketMicrostructureSnapshot } from './regimeDetector';
import { DynamicParameterOptimizer, GridParameterSet, OptimizationConstraints, PredictiveSignals } from './parameterOptimizer';
import { PredictiveAnalyticsEngine, PredictiveOutputs } from './predictiveAnalytics';

export interface IntelligenceEngineOptions extends AdvancedRegimeDetectorDeps {
  constraints: OptimizationConstraints;
}

export interface IntelligenceInputs {
  pair: string;
  candles: Candle[];
  midPrice: number;
  baseParameters: GridParameterSet;
  windowResults?: number[];
  drawdowns?: number[];
  microstructure?: MarketMicrostructureSnapshot[];
  fundingRates?: number[];
}

export interface IntelligenceSummary {
  regime: AdvancedRegimeInsight;
  predictive: PredictiveOutputs;
  optimized: GridParameterSet;
  evolved?: GridParameterSet;
  score: number;
}

export class MarketIntelligenceEngine {
  private readonly regimeDetector: AdvancedRegimeDetector;
  private readonly optimizer: DynamicParameterOptimizer;
  private readonly predictive: PredictiveAnalyticsEngine;

  constructor(options: IntelligenceEngineOptions) {
    this.regimeDetector = new AdvancedRegimeDetector(options);
    this.optimizer = new DynamicParameterOptimizer(options.constraints);
    this.predictive = new PredictiveAnalyticsEngine();
  }

  async generateInsights(inputs: IntelligenceInputs): Promise<IntelligenceSummary> {
    const { pair, candles, baseParameters, midPrice } = inputs;
    this.predictive.train({ candles, fundingRates: inputs.fundingRates });

    const [regime, predictiveSignals] = await Promise.all([
      this.regimeDetector.analyze({
        pair,
        candles,
        midPrice,
        microstructure: inputs.microstructure,
      }),
      Promise.resolve(this.predictive.generateSignals({ candles, recentFundingRates: inputs.fundingRates })),
    ]);

    const realtimeAdjusted = this.optimizer.applyRealtimeAdjustments({
      base: baseParameters,
      regime,
      predictive: predictiveSignals as PredictiveSignals,
    });

    let evolved: GridParameterSet | undefined;
    let bestScore = 0;
    if (inputs.windowResults && inputs.windowResults.length) {
      const result = this.optimizer.evolveParameters(realtimeAdjusted, (candidate) => {
        return this.scoreCandidate(candidate, {
          regime,
          predictive: predictiveSignals,
          windowResults: inputs.windowResults ?? [],
          drawdowns: inputs.drawdowns ?? [],
        });
      });
      evolved = result.best;
      bestScore = result.score;
    }

    const optimized = inputs.windowResults
      ? this.optimizer.optimizeRollingWindow({
          base: evolved ?? realtimeAdjusted,
          windowResults: inputs.windowResults,
          drawdowns: inputs.drawdowns ?? [],
        })
      : realtimeAdjusted;

    return {
      regime,
      predictive: predictiveSignals,
      optimized,
      evolved,
      score: bestScore,
    };
  }

  private scoreCandidate(
    candidate: GridParameterSet,
    context: {
      regime: AdvancedRegimeInsight;
      predictive: PredictiveOutputs;
      windowResults: number[];
      drawdowns: number[];
    }
  ): number {
    const pnl = context.windowResults.length
      ? context.windowResults.reduce((s, r) => s + r, 0) / context.windowResults.length
      : 0;
    const dd = context.drawdowns.length
      ? context.drawdowns.reduce((s, d) => s + Math.abs(d), 0) / context.drawdowns.length
      : 0;
    const pnlScore = pnl * 10;
    const ddPenalty = -Math.abs(dd) * 4;

    const riskAlignment = context.regime.suggestedRiskStance === 'increase'
      ? Math.min(candidate.perTradeUsd, candidate.gridSizePct * 10) * 0.01
      : context.regime.suggestedRiskStance === 'decrease'
      ? -candidate.perTradeUsd * 0.01
      : 0;

    const conviction = context.predictive.priceDirection - context.predictive.crashProbability;
    const tpScore = (candidate.takeProfitPct - candidate.gridSizePct) * 3 * conviction;

    return pnlScore + ddPenalty + riskAlignment + tpScore;
  }
}
