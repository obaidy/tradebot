import { AdvancedRegimeInsight } from './regimeDetector';

export interface GridParameterSet {
  gridSteps: number;
  gridSizePct: number;
  takeProfitPct: number;
  perTradeUsd: number;
}

export interface OptimizationConstraints {
  minGridSteps: number;
  maxGridSteps: number;
  minGridSizePct: number;
  maxGridSizePct: number;
  minTakeProfitPct: number;
  maxTakeProfitPct: number;
  minPerTradeUsd: number;
  maxPerTradeUsd: number;
}

export interface PredictiveSignals {
  priceDirection: number; // -1 .. 1
  volatilityForecast: number; // expressed as annualized stdev
  crashProbability: number; // 0..1
  fundingRateForecast: number; // estimated per period
}

export interface OptimizationResult {
  best: GridParameterSet;
  population: GridParameterSet[];
  score: number;
}

export class DynamicParameterOptimizer {
  constructor(private readonly constraints: OptimizationConstraints) {}

  evolveParameters(
    base: GridParameterSet,
    fitnessEvaluator: (candidate: GridParameterSet) => number,
    populationSize = 8,
    generations = 5
  ): OptimizationResult {
    let population = this.seedPopulation(base, populationSize);
    let bestCandidate = base;
    let bestScore = -Infinity;

    for (let gen = 0; gen < generations; gen += 1) {
      const scored = population.map((candidate) => ({
        candidate,
        score: fitnessEvaluator(candidate),
      }));
      scored.sort((a, b) => b.score - a.score);
      if (scored[0].score > bestScore) {
        bestScore = scored[0].score;
        bestCandidate = { ...scored[0].candidate };
      }
      const elites = scored.slice(0, Math.max(2, Math.floor(populationSize / 3))).map((s) => s.candidate);
      population = this.breedNewPopulation(elites, populationSize);
    }

    return { best: bestCandidate, population, score: bestScore };
  }

  optimizeRollingWindow(params: {
    base: GridParameterSet;
    windowResults: number[]; // PnL per period
    drawdowns: number[];
  }): GridParameterSet {
    const { base, windowResults, drawdowns } = params;
    const averageReturn = windowResults.length
      ? windowResults.reduce((s, r) => s + r, 0) / windowResults.length
      : 0;
    const avgDrawdown = drawdowns.length
      ? drawdowns.reduce((s, d) => s + Math.abs(d), 0) / drawdowns.length
      : 0;

    let gridSizeScalar = 1;
    if (avgDrawdown > Math.abs(averageReturn)) {
      gridSizeScalar = 0.85;
    } else if (averageReturn > 0 && avgDrawdown < Math.abs(averageReturn) * 0.5) {
      gridSizeScalar = 1.1;
    }

    const adjusted: GridParameterSet = {
      gridSteps: this.clamp(Math.round(base.gridSteps * gridSizeScalar), this.constraints.minGridSteps, this.constraints.maxGridSteps),
      gridSizePct: this.clamp(base.gridSizePct * gridSizeScalar, this.constraints.minGridSizePct, this.constraints.maxGridSizePct),
      takeProfitPct: this.clamp(
        base.takeProfitPct * (gridSizeScalar > 1 ? 1.05 : 0.95),
        this.constraints.minTakeProfitPct,
        this.constraints.maxTakeProfitPct
      ),
      perTradeUsd: this.clamp(
        base.perTradeUsd * (averageReturn > 0 ? 1.05 : 0.9),
        this.constraints.minPerTradeUsd,
        this.constraints.maxPerTradeUsd
      ),
    };
    return adjusted;
  }

  applyRealtimeAdjustments(params: {
    base: GridParameterSet;
    regime: AdvancedRegimeInsight;
    predictive: PredictiveSignals;
  }): GridParameterSet {
    const { base, regime, predictive } = params;
    let gridSteps = base.gridSteps;
    let gridSizePct = base.gridSizePct;
    let takeProfitPct = base.takeProfitPct;
    let perTradeUsd = base.perTradeUsd;

    if (regime.volatilityLabel === 'turbulent' || predictive.crashProbability > 0.4) {
      gridSteps *= 1.25;
      gridSizePct *= 1.4;
      takeProfitPct *= 1.1;
      perTradeUsd *= 0.7;
    } else if (regime.volatilityLabel === 'calm' && predictive.priceDirection > 0.25) {
      gridSteps *= 0.9;
      gridSizePct *= 0.85;
      takeProfitPct *= 0.9;
      perTradeUsd *= 1.1;
    }

    const fundingBias = Math.tanh(predictive.fundingRateForecast * 1000);
    perTradeUsd *= 1 + fundingBias * 0.1;

    gridSteps = this.clamp(Math.round(gridSteps), this.constraints.minGridSteps, this.constraints.maxGridSteps);
    gridSizePct = this.clamp(gridSizePct, this.constraints.minGridSizePct, this.constraints.maxGridSizePct);
    takeProfitPct = this.clamp(takeProfitPct, this.constraints.minTakeProfitPct, this.constraints.maxTakeProfitPct);
    perTradeUsd = this.clamp(perTradeUsd, this.constraints.minPerTradeUsd, this.constraints.maxPerTradeUsd);

    return { gridSteps, gridSizePct, takeProfitPct, perTradeUsd };
  }

  private seedPopulation(base: GridParameterSet, populationSize: number): GridParameterSet[] {
    const population: GridParameterSet[] = [base];
    while (population.length < populationSize) {
      population.push({
        gridSteps: this.mutateInt(base.gridSteps, 1, 2, this.constraints.minGridSteps, this.constraints.maxGridSteps),
        gridSizePct: this.mutateFloat(base.gridSizePct, 0.1, this.constraints.minGridSizePct, this.constraints.maxGridSizePct),
        takeProfitPct: this.mutateFloat(base.takeProfitPct, 0.08, this.constraints.minTakeProfitPct, this.constraints.maxTakeProfitPct),
        perTradeUsd: this.mutateFloat(base.perTradeUsd, 0.2, this.constraints.minPerTradeUsd, this.constraints.maxPerTradeUsd),
      });
    }
    return population;
  }

  private breedNewPopulation(elites: GridParameterSet[], size: number): GridParameterSet[] {
    const next: GridParameterSet[] = [...elites];
    while (next.length < size) {
      const parentA = elites[Math.floor(Math.random() * elites.length)];
      const parentB = elites[Math.floor(Math.random() * elites.length)];
      next.push({
        gridSteps: this.mixInt(parentA.gridSteps, parentB.gridSteps, this.constraints.minGridSteps, this.constraints.maxGridSteps),
        gridSizePct: this.mixFloat(parentA.gridSizePct, parentB.gridSizePct, this.constraints.minGridSizePct, this.constraints.maxGridSizePct),
        takeProfitPct: this.mixFloat(parentA.takeProfitPct, parentB.takeProfitPct, this.constraints.minTakeProfitPct, this.constraints.maxTakeProfitPct),
        perTradeUsd: this.mixFloat(parentA.perTradeUsd, parentB.perTradeUsd, this.constraints.minPerTradeUsd, this.constraints.maxPerTradeUsd),
      });
    }
    return next;
  }

  private mutateInt(value: number, minDelta: number, maxDelta: number, min: number, max: number) {
    const delta = Math.round((Math.random() * (maxDelta - minDelta) + minDelta) * (Math.random() < 0.5 ? -1 : 1));
    return this.clamp(value + delta, min, max);
  }

  private mutateFloat(value: number, rangePct: number, min: number, max: number) {
    const delta = value * rangePct * (Math.random() < 0.5 ? -1 : 1);
    return this.clamp(value + delta, min, max);
  }

  private mixInt(a: number, b: number, min: number, max: number) {
    return this.clamp(Math.round((a + b) / 2 + (Math.random() - 0.5)), min, max);
  }

  private mixFloat(a: number, b: number, min: number, max: number) {
    const average = (a + b) / 2;
    const delta = (Math.random() - 0.5) * average * 0.15;
    return this.clamp(average + delta, min, max);
  }

  private clamp<T extends number>(value: T, min: number, max: number): T {
    return Math.max(min, Math.min(max, value)) as T;
  }
}
