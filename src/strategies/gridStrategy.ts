import { runGridOnce } from './gridBot';
import { StrategyRunContext } from './types';

export async function runGridStrategy(ctx: StrategyRunContext) {
  const summaryOnly = ctx.runMode === 'summary';
  const runMode = summaryOnly ? 'summary' : ctx.runMode;
  await runGridOnce(ctx.pair, undefined, undefined, {
    clientId: ctx.clientId,
    runMode,
    summaryOnly,
    actor: ctx.actor,
  });
}
