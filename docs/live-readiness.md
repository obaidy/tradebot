# Live Readiness Checklist

Before turning on live trading for a client, confirm the following controls are in place. The defaults below come from plan limits (`src/config/plans.ts`) and the trade-approval policy (`src/guard/tradeApprovalPolicy.ts`).

## 1. Tenant configuration

- **Plan** – Only `pro` and `override` plans allow live runs. Starter remains paper-only.
- **Allowed exchanges** – Verify the client’s target venue is listed in `plan.limits.allowedExchanges`.
- **API credentials** – `ClientConfigService` must be able to decrypt a live key (portal → Stored credentials). Missing keys are a hard failure in live mode.

## 2. Risk limits

| Limit | Default (Pro) | Source |
| --- | --- | --- |
| Max per-trade USD | 2,000 | `plan.limits.maxPerTradeUsd` |
| Max exposure USD | 15,000 | `plan.limits.maxExposureUsd` |
| Max daily volume USD | 50,000 | `plan.limits.maxDailyVolumeUsd` |
| Max symbols | 10 | `plan.limits.maxSymbols` |
| Guard drawdown USD | 1,000 | `plan.limits.guard.maxGlobalDrawdownUsd` |
| Guard run loss USD | 400 | `plan.limits.guard.maxRunLossUsd` |
| API error burst | 12/minute | `plan.limits.guard.maxApiErrorsPerMin` |

Adjustments:
- Set client-specific overrides via `ClientConfigService` (portfolio allocations) or by editing the plan definition.
- For ad-hoc exceptions, add the client id to `ADMIN_LIVE_OVERRIDE_IDS` so run-time checks allow higher exposure temporarily.

## 3. Trade approvals

- Threshold: `TRADE_APPROVAL_THRESHOLD_USD` (defaults to **50,000 USD**). Any planned exposure at or above the threshold creates a pending approval via `TradeApprovalPolicy`.
- Operators approve/reject via the admin portal (`/admin/approvals`) or the CLI `npm run admin:approvals`.
- Ensure the approval queue is staffed before scheduling the first live run.

## 4. Kill switches & monitoring

- Confirm the kill switch service is reachable (`/kill-switch` port 9101). Operations should know how to trigger it.
- Metrics: Prometheus endpoint exposes run metrics and guard state—scrape before enabling live trading.
- Alerts: Wire Telegram/Email/SMS tokens if operations needs real-time notifications.

## 5. Dry run validation

1. **Paper run** – Run a paper session (`Request paper run`) and export the CSV for audit.
2. **Telemetry snapshot** – `npm run report:telemetry -- --client <id>` prints guard and inventory samples. Archive the output.
3. **Approval workflow** – Manually trigger a run above the threshold to test the approval queue.

## 6. Enabling live mode

1. Update the client plan/portfolio so at least one strategy has `runMode: "live"`.
2. Remove `PAPER_MODE=true` when launching the worker or set `SUMMARY_ONLY=false`.
3. Monitor the worker logs closely for the first week; keep kill switch instructions in the on-call runbook.

Document all deviations from the defaults above and secure sign-off from operations and compliance before flipping the switch.
