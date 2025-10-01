export interface SectorLimitConfig {
  [sector: string]: number; // fraction of bankroll (0-1)
}

export interface CorrelationLimitConfig {
  [group: string]: number; // fraction of bankroll (0-1)
}

export interface StressScenarioConfig {
  name: string;
  shockPct: number; // percent loss assumption e.g. 0.2
  maxFractionOfBankroll?: number; // optional override
}

export interface RiskEngineConfig {
  bankrollUsd: number;
  sectorLimits: SectorLimitConfig;
  correlationLimits: CorrelationLimitConfig;
  assetToSector?: Record<string, string>;
  assetToCorrelationGroup?: Record<string, string>;
  maxVarUsd: number;
  varConfidence: number;
  stressScenarios: StressScenarioConfig[];
  stressMaxFractionOfBankroll: number;
  drawdownFractionLimit: number;
  kellyCapFraction: number;
  minPerTradeUsd: number;
  maxPerTradeUsd: number;
}

export interface PortfolioExposureEntry {
  baseAsset: string;
  quoteAsset: string;
  exposureUsd: number;
}

export interface RiskPerformanceMetrics {
  runIds: string[];
  pnlSeries: number[];
  drawdowns: number[];
}

export interface RiskEvaluationInput {
  pair: string;
  baseAsset: string;
  plannedExposureUsd: number;
  perTradeUsd: number;
  gridSizePct: number;
  takeProfitPct: number;
  recentPerformance?: RiskPerformanceMetrics | null;
  exposures: PortfolioExposureEntry[];
  volatility?: number | null;
  garchVolatility?: number | null;
  currentDrawdownUsd?: number | null;
  realizedPnlUsd?: number | null;
}

export interface RiskEvaluationResult {
  approved: boolean;
  adjustedPerTradeUsd: number;
  adjustedGridSizePct: number;
  adjustedTakeProfitPct: number;
  kellyFraction: number;
  valueAtRiskUsd: number;
  maxStressLossUsd: number;
  messages: string[];
  blockedReason?: string;
}
