import {
  CorrelationLimitConfig,
  PortfolioExposureEntry,
  RiskEngineConfig,
  RiskEvaluationInput,
  RiskEvaluationResult,
  RiskPerformanceMetrics,
  SectorLimitConfig,
  StressScenarioConfig,
} from './types';

const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function defaultVolatility(vol?: number | null, fallback = 0.02) {
  if (vol === undefined || vol === null || !Number.isFinite(vol)) return fallback;
  return Math.max(0.0005, Math.min(0.5, vol));
}

function zScoreForConfidence(confidence: number) {
  const c = clamp(confidence, 0.5, 0.999);
  if (c === 0.95) return 1.645;
  if (c === 0.99) return 2.326;
  if (c === 0.9) return 1.282;
  // simple approximation for other confidence levels using inverse error function
  const p = c - 0.5;
  const t = Math.sqrt(-2 * Math.log(1 - 2 * Math.abs(p)));
  return t * (p >= 0 ? 1 : -1);
}

function sumExposureByGroup(
  exposures: PortfolioExposureEntry[],
  mapping: Record<string, string> | undefined,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const exposure of exposures) {
    const asset = exposure.baseAsset?.toUpperCase?.() ?? exposure.baseAsset;
    const group = mapping?.[asset] ?? 'general';
    if (!result[group]) result[group] = 0;
    result[group] += exposure.exposureUsd;
  }
  return result;
}

function addPlannedExposure(
  grouped: Record<string, number>,
  asset: string,
  amount: number,
  mapping: Record<string, string> | undefined,
) {
  const key = mapping?.[asset] ?? 'general';
  if (!grouped[key]) grouped[key] = 0;
  grouped[key] += amount;
}

function computeKellyFraction(performance?: RiskPerformanceMetrics | null, cap = 0.15): number {
  if (!performance || performance.pnlSeries.length < 3) {
    return cap * 0.5;
  }
  const positives = performance.pnlSeries.filter((p) => p > 0);
  const negatives = performance.pnlSeries.filter((p) => p < 0).map((p) => Math.abs(p));
  const total = positives.length + negatives.length;
  if (total < 3) return cap * 0.5;
  const winRate = positives.length / total;
  const avgWin = positives.length ? positives.reduce((s, v) => s + v, 0) / positives.length : 0;
  const avgLoss = negatives.length ? negatives.reduce((s, v) => s + v, 0) / negatives.length : 0;
  if (avgLoss === 0) return clamp(winRate * cap, 0.01, cap);
  const b = avgWin / avgLoss;
  if (b <= 0) return 0.01;
  const kelly = winRate - (1 - winRate) / b;
  if (!Number.isFinite(kelly)) return cap * 0.25;
  return clamp(kelly, 0.01, cap);
}

function computeCurrentDrawdown(performance?: RiskPerformanceMetrics | null): number {
  if (!performance || !performance.drawdowns.length) return 0;
  return Math.min(...performance.drawdowns);
}

function computeValueAtRisk(plannedExposureUsd: number, volatility: number, confidence: number): number {
  const z = zScoreForConfidence(confidence);
  return Math.abs(plannedExposureUsd) * Math.abs(z) * Math.abs(volatility);
}

function computeStressLoss(
  plannedExposureUsd: number,
  scenarios: StressScenarioConfig[],
  bankrollUsd: number,
  stressMaxFractionOfBankroll: number,
) {
  let maxLoss = 0;
  let triggeringScenario: string | null = null;
  for (const scenario of scenarios) {
    const loss = Math.abs(plannedExposureUsd) * Math.max(0, scenario.shockPct);
    const limit = (scenario.maxFractionOfBankroll ?? stressMaxFractionOfBankroll) * bankrollUsd;
    if (loss > maxLoss) {
      maxLoss = loss;
      triggeringScenario = scenario.name;
    }
    if (loss > limit) {
      return { loss, triggered: scenario.name, limitExceeded: true };
    }
  }
  return { loss: maxLoss, triggered: triggeringScenario, limitExceeded: false };
}

export class RiskEngine {
  private readonly bankrollUsd: number;
  private readonly sectorLimits: SectorLimitConfig;
  private readonly correlationLimits: CorrelationLimitConfig;
  private readonly assetToSector: Record<string, string>;
  private readonly assetToCorrelationGroup: Record<string, string>;
  private readonly maxVarUsd: number;
  private readonly varConfidence: number;
  private readonly stressScenarios: StressScenarioConfig[];
  private readonly stressMaxFractionOfBankroll: number;
  private readonly drawdownFractionLimit: number;
  private readonly kellyCapFraction: number;
  private readonly minPerTradeUsd: number;
  private readonly maxPerTradeUsd: number;

  constructor(config: RiskEngineConfig) {
    this.bankrollUsd = config.bankrollUsd;
    this.sectorLimits = config.sectorLimits;
    this.correlationLimits = config.correlationLimits;
    this.assetToSector = Object.fromEntries(
      Object.entries(config.assetToSector ?? {}).map(([asset, sector]) => [asset.toUpperCase(), sector])
    );
    this.assetToCorrelationGroup = Object.fromEntries(
      Object.entries(config.assetToCorrelationGroup ?? {}).map(([asset, group]) => [asset.toUpperCase(), group])
    );
    this.maxVarUsd = config.maxVarUsd;
    this.varConfidence = config.varConfidence;
    this.stressScenarios = config.stressScenarios;
    this.stressMaxFractionOfBankroll = config.stressMaxFractionOfBankroll;
    this.drawdownFractionLimit = config.drawdownFractionLimit;
    this.kellyCapFraction = config.kellyCapFraction;
    this.minPerTradeUsd = config.minPerTradeUsd;
    this.maxPerTradeUsd = config.maxPerTradeUsd;
  }

  evaluate(input: RiskEvaluationInput): RiskEvaluationResult {
    const messages: string[] = [];
    const asset = input.baseAsset?.toUpperCase?.() ?? input.baseAsset;
    const plannedExposureUsd = Math.max(input.plannedExposureUsd, input.perTradeUsd);
    let perTradeUsd = clamp(input.perTradeUsd, this.minPerTradeUsd, this.maxPerTradeUsd);
    let gridSizePct = input.gridSizePct;
    let takeProfitPct = input.takeProfitPct;

    // Portfolio sector checks
    const sectorGrouped = sumExposureByGroup(input.exposures, this.assetToSector);
    addPlannedExposure(sectorGrouped, asset, plannedExposureUsd, this.assetToSector);
    for (const [sector, exposure] of Object.entries(sectorGrouped)) {
      const limitFraction = this.sectorLimits[sector] ?? this.sectorLimits.general ?? 0.35;
      const limitUsd = this.bankrollUsd * limitFraction;
      if (exposure > limitUsd) {
        const allowable = Math.max(limitUsd - (exposure - plannedExposureUsd), 0);
        const scale = allowable > 0 ? allowable / plannedExposureUsd : 0;
        perTradeUsd *= clamp(scale, 0, 1);
        messages.push(`Sector ${sector} limit reached; scaling per-trade to ${perTradeUsd.toFixed(2)} USD`);
        if (perTradeUsd < this.minPerTradeUsd * 0.5) {
          return {
            approved: false,
            adjustedPerTradeUsd: perTradeUsd,
            adjustedGridSizePct: gridSizePct,
            adjustedTakeProfitPct: takeProfitPct,
            kellyFraction: 0,
            valueAtRiskUsd: 0,
            maxStressLossUsd: 0,
            messages,
            blockedReason: `Sector ${sector} exposure limit exceeded`,
          };
        }
      }
    }

    // Correlation group checks
    const correlationGrouped = sumExposureByGroup(input.exposures, this.assetToCorrelationGroup);
    addPlannedExposure(correlationGrouped, asset, plannedExposureUsd, this.assetToCorrelationGroup);
    for (const [group, exposure] of Object.entries(correlationGrouped)) {
      const limitFraction = this.correlationLimits[group] ?? this.correlationLimits.general ?? 0.5;
      const limitUsd = this.bankrollUsd * limitFraction;
      if (exposure > limitUsd) {
        const allowable = Math.max(limitUsd - (exposure - plannedExposureUsd), 0);
        const scale = allowable > 0 ? allowable / plannedExposureUsd : 0;
        perTradeUsd *= clamp(scale, 0, 1);
        messages.push(`Correlation group ${group} limit reached; per-trade scaled to ${perTradeUsd.toFixed(2)} USD`);
        if (perTradeUsd < this.minPerTradeUsd * 0.5) {
          return {
            approved: false,
            adjustedPerTradeUsd: perTradeUsd,
            adjustedGridSizePct: gridSizePct,
            adjustedTakeProfitPct: takeProfitPct,
            kellyFraction: 0,
            valueAtRiskUsd: 0,
            maxStressLossUsd: 0,
            messages,
            blockedReason: `Correlation group ${group} exposure limit exceeded`,
          };
        }
      }
    }

    // Volatility / VaR
    const volatility = defaultVolatility(input.garchVolatility ?? input.volatility);
    const varUsd = computeValueAtRisk(plannedExposureUsd, volatility, this.varConfidence);
    let varAdjustedPerTrade = perTradeUsd;
    if (varUsd > this.maxVarUsd) {
      const scale = clamp(this.maxVarUsd / varUsd, 0.2, 1);
      varAdjustedPerTrade = perTradeUsd * scale;
      messages.push(`VaR ${varUsd.toFixed(2)} exceeds limit ${this.maxVarUsd.toFixed(2)}; scaling per-trade by ${scale.toFixed(2)}`);
    }
    perTradeUsd = Math.min(perTradeUsd, varAdjustedPerTrade);

    // Stress scenarios
    const stress = computeStressLoss(plannedExposureUsd, this.stressScenarios, this.bankrollUsd, this.stressMaxFractionOfBankroll);
    if (stress.limitExceeded) {
      const scale = clamp((this.bankrollUsd * this.stressMaxFractionOfBankroll) / (stress.loss || 1), 0.15, 1);
      perTradeUsd *= scale;
      gridSizePct *= 1.1; // widen grid in stressful environments
      messages.push(`Stress scenario ${stress.triggered} loss ${stress.loss.toFixed(2)} > limit; scaling per-trade by ${scale.toFixed(2)} and widening grid`);
    }

    // Drawdown protection
    const currentDrawdown = computeCurrentDrawdown(input.recentPerformance);
    if (currentDrawdown < 0) {
      const drawdownFraction = Math.abs(currentDrawdown) / this.bankrollUsd;
      if (drawdownFraction >= this.drawdownFractionLimit) {
        perTradeUsd *= 0.5;
        gridSizePct *= 1.25;
        takeProfitPct *= 1.1;
        messages.push(`Drawdown ${currentDrawdown.toFixed(2)} exceeds ${(this.drawdownFractionLimit * 100).toFixed(1)}% of bankroll; applying defensive adjustments`);
      }
    }

    // Kelly sizing
    const kellyFraction = computeKellyFraction(input.recentPerformance, this.kellyCapFraction);
    const kellyPerTrade = clamp(this.bankrollUsd * kellyFraction, this.minPerTradeUsd, this.maxPerTradeUsd);
    if (kellyPerTrade < perTradeUsd) {
      messages.push(`Kelly sizing suggests ${kellyPerTrade.toFixed(2)} USD per trade; reducing from ${perTradeUsd.toFixed(2)} USD`);
      perTradeUsd = kellyPerTrade;
    }

    perTradeUsd = clamp(perTradeUsd, this.minPerTradeUsd * 0.25, this.maxPerTradeUsd);

    if (perTradeUsd < this.minPerTradeUsd * 0.4) {
      return {
        approved: false,
        adjustedPerTradeUsd: perTradeUsd,
        adjustedGridSizePct: gridSizePct,
        adjustedTakeProfitPct: takeProfitPct,
        kellyFraction,
        valueAtRiskUsd: varUsd,
        maxStressLossUsd: stress.loss,
        messages,
        blockedReason: 'Per-trade capital fell below minimum threshold after risk adjustments',
      };
    }

    return {
      approved: true,
      adjustedPerTradeUsd: perTradeUsd,
      adjustedGridSizePct: gridSizePct,
      adjustedTakeProfitPct: takeProfitPct,
      kellyFraction,
      valueAtRiskUsd: varUsd,
      maxStressLossUsd: stress.loss,
      messages,
    };
  }
}
