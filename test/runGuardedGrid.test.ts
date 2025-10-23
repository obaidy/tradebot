import { describe, expect, it, vi } from 'vitest';
import { printPlannedSummaryIfAvailable } from '../src/strategies/gridBot_live_guard';

describe('printPlannedSummaryIfAvailable', () => {
  it('invokes runGridOnce with summaryOnly in concurrent runs', async () => {
    const runner = vi.fn().mockResolvedValue(undefined);
    const params = {
      gridSteps: 8,
      k: 1,
      tp: 0.05,
      perTrade: 0.01,
      smaPeriodHours: 24,
      meanRevertPct: 0.01,
      minAtrPct: 0.006,
    };

    await Promise.all([
      printPlannedSummaryIfAvailable('BTC/USDT', params, undefined, undefined, { runGrid: runner }),
      printPlannedSummaryIfAvailable('BTC/USDT', params, undefined, undefined, { runGrid: runner }),
    ]);

    expect(runner).toHaveBeenCalledTimes(2);
    for (const call of runner.mock.calls) {
      const options = call[3];
      expect(options?.summaryOnly).toBe(true);
    }
    expect(process.env.SUMMARY_ONLY).toBeUndefined();
  });
});
