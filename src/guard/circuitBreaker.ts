import { killSwitch } from './killSwitch';
import { apiErrorCounter, pnlGauge } from '../telemetry/metrics';
import { GuardStateRepository, GuardState } from '../db/guardStateRepo';

interface CircuitConfig {
  maxGlobalDrawdownUsd: number;
  maxRunLossUsd: number;
  maxApiErrorsPerMin: number;
  staleTickerMs: number;
}

const DEFAULT_STATE: GuardState = {
  globalPnl: 0,
  runPnl: 0,
  inventoryBase: 0,
  inventoryCost: 0,
  lastTickerTs: Date.now(),
  apiErrorTimestamps: [],
};

export class CircuitBreaker {
  private state: GuardState = { ...DEFAULT_STATE };
  private repo: GuardStateRepository | null = null;
  private initialized = false;

  constructor(private config: CircuitConfig) {}

  async initialize(repo: GuardStateRepository) {
    if (this.initialized && this.repo === repo) return;
    this.repo = repo;
    this.state = await repo.load();
    this.initialized = true;
    pnlGauge.set(this.state.globalPnl);
  }

  async resetRun() {
    if (!this.initialized || !this.repo) return;
    this.state.runPnl = 0;
    await this.persist();
  }

  recordTicker(timestamp: number) {
    if (!this.initialized) return;
    this.state.lastTickerTs = timestamp;
    this.persist().catch(() => {});
  }

  recordApiError(type: string) {
    if (!this.initialized) return;
    const now = Date.now();
    this.state.apiErrorTimestamps.push(now);
    this.state.apiErrorTimestamps = this.state.apiErrorTimestamps.filter((ts) => now - ts <= 60 * 1000);
    apiErrorCounter.labels(type).inc();
    this.persist().catch(() => {});
    if (this.state.apiErrorTimestamps.length >= this.config.maxApiErrorsPerMin) {
      killSwitch.activate(`API error rate exceeded (${this.state.apiErrorTimestamps.length}/min)`).catch(() => {});
    }
  }

  recordFill(side: 'buy' | 'sell', price: number, amount: number, fee = 0) {
    if (!this.initialized) return;
    const value = price * amount;
    if (side === 'buy') {
      this.state.inventoryBase += amount;
      this.state.inventoryCost += value + fee;
    } else {
      if (this.state.inventoryBase <= 0) return;
      const avgCost = this.state.inventoryCost / this.state.inventoryBase;
      const realized = (price - avgCost) * amount - fee;
      this.state.globalPnl += realized;
      this.state.runPnl += realized;
      this.state.inventoryBase -= amount;
      this.state.inventoryCost -= avgCost * amount;
      pnlGauge.set(this.state.globalPnl);
      if (this.state.globalPnl <= -this.config.maxGlobalDrawdownUsd) {
        killSwitch.activate(`Global drawdown exceeded ${this.config.maxGlobalDrawdownUsd}`).catch(() => {});
      }
      if (this.state.runPnl <= -this.config.maxRunLossUsd) {
        killSwitch.activate(`Run loss exceeded ${this.config.maxRunLossUsd}`).catch(() => {});
      }
    }
    this.persist().catch(() => {});
  }

  checkStaleData() {
    if (!this.initialized) return;
    const now = Date.now();
    if (now - this.state.lastTickerTs > this.config.staleTickerMs) {
      killSwitch.activate('Market data stale').catch(() => {});
    }
  }

  private async persist() {
    if (!this.repo) return;
    await this.repo.save(this.state);
  }
}

export const circuitBreaker = new CircuitBreaker({
  maxGlobalDrawdownUsd: Number(process.env.MAX_GLOBAL_DRAWDOWN_USD || '500'),
  maxRunLossUsd: Number(process.env.MAX_RUN_LOSS_USD || '200'),
  maxApiErrorsPerMin: Number(process.env.MAX_API_ERRORS_PER_MIN || '10'),
  staleTickerMs: Number(process.env.STALE_TICKER_MS || (5 * 60 * 1000).toString()),
});
