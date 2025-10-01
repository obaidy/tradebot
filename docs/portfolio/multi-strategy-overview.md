# Multi-Strategy Portfolio Overview

This document outlines how the platform now models and schedules multiple trading strategies for a single client.

## Data model

| Table | Purpose |
| --- | --- |
| `client_strategy_allocations` | Stores the desired portfolio weights and overrides for each client/strategy pairing. |

Columns of note:

- `weight_pct` – Desired portfolio share (in percent).
- `max_risk_pct` – Optional cap for bankroll-at-risk for the strategy.
- `run_mode` – Per-strategy preference (`live`, `paper`, or `summary`).
- `enabled` – Allows toggling strategies on/off without deleting configuration.
- `config_json` – Reserved for strategy-specific overrides (e.g., market pairs).

## Config service

`ClientConfigService` now returns a `portfolio` object alongside risk, guard, and exchange config. The portfolio report is a simple `{ allocations, totalWeightPct }` tuple that downstream services can consume.

Example allocation:

```json
{
  "strategyId": "grid",
  "weightPct": 60,
  "runMode": "live",
  "enabled": true,
  "config": { "pair": "ETH/USDT" }
}
```

## Portfolio execution plan

Use `buildPortfolioExecutionPlan(clientConfig)` to translate allocations into an actionable plan:

- Normalises weights (with equal weighting fallback).
- Computes per-strategy bankroll allocation and optional risk caps.
- Resolves a viable run mode (e.g., downgrades to `paper` if live is disallowed).
- Flags unsupported/unknown strategies so orchestrators can skip them gracefully.

Sample output:

```json
{
  "strategyId": "mev",
  "requestedRunMode": "live",
  "finalRunMode": "paper",
  "weightPct": 40,
  "normalizedWeightPct": 40,
  "allocationUsd": 4000,
  "enabled": true
}
```

## Next steps

- Build admin tooling to CRUD `client_strategy_allocations` via the API.
- Teach the client worker to request a fresh execution plan before scheduling work.
- Surface portfolio allocation and live status in the portal UI.
