# TradeBot — Starter Repo (Grid + Backtest)

This starter repo contains a minimal CEX grid bot + backtest script. It's **paper-first** and intended for rapid iteration.

## What is included
- Minimal Node.js + TypeScript starter for a grid trading strategy (`src/strategies/gridBot.ts`)
- Simple backtest data fetch (`src/backtest/backtest.ts`)
- Hardhat-sim placeholder for on-chain sell simulation (`src/hardhat-sim/checkSell.ts`)
- Docker + docker-compose for local dev
- .env.example for configuration

---

## Quick start (local)
1. Install deps: `npm install`
2. Copy `.env.example` -> `.env` and tweak (set PAPER_MODE=true for safe testing)
3. Run in dev: `npm run dev`
4. Backtest data fetch: `npm run backtest` (saves candles.json)

**DO NOT** run live without setting PAPER_MODE=false and verifying risk parameters, API keys, and small capital allocation.

---

## Configuration

Key environment variables and defaults are captured in `src/config.ts`. Frequently tuned values:

| Variable | Default | Notes |
| --- | --- | --- |
| `PAPER_MODE` | `false` | Enable paper execution + deterministic timestamps. |
| `BANKROLL_USD` | `200` | Base bankroll used when sizing by percentage. |
| `MAX_PER_TRADE_PCT` | `0.02` | Fallback per-trade risk when `PER_TRADE_USD` not provided. |
| `DEFAULT_EXCHANGE` | `binance` | Exchange id passed to `ccxt`. |
| `SUMMARY_JSON_PATH` / `PLAN_JSON_PATH` | _(unset)_ | If set, `runGridOnce` writes the planned grid to JSON. |
| `SUMMARY_JSON_EXPORT` | `false` | When `true`, writes the JSON plan to `planned_summary.json` even without an explicit path. |
| `PAPER_MODE_BASE_TS` | `2020-01-01T00:00:00.000Z` | Base timestamp used to keep paper CSV outputs deterministic. |
| `RUN_ID` | _(generated)_ | Override the auto run identifier (useful for reproducible dry-runs/tests). |
| `RUN_OWNER` | `local` | Identifier for who initiated the run (stored in DB). |
| `CLIENT_ID` | `default` | Worker scope. Each bot process is locked to a single client and only reads that client's configuration + keys. |
| `CLIENT_MASTER_KEY` | _(required)_ | 32-byte master secret (base64/hex/passphrase) used by the libsodium secret box to encrypt client API credentials. |
| `ORDER_CONCURRENCY` | `3` | Max number of grid legs placed in parallel. |
| `ORDER_RATE_INTERVAL_MS` | `250` | Minimum delay (ms) between order submissions. |
| `ORDER_POLL_INTERVAL_MS` | `5000` | Poll interval (ms) when monitoring open orders (override for testing). |
| `REPLACE_TIMEOUT_MS` | `600000` | Cancel/replace buy leg if still open after this duration (ms). |
| `REPLACE_SLIPPAGE_PCT` | `0.003` | Cancel/replace if price drifts beyond this fraction. |
| `REPLACE_MAX_RETRIES` | `3` | Maximum replacement attempts per grid level. |
| `MAX_GLOBAL_DRAWDOWN_USD` | `500` | Trips kill switch when realized drawdown exceeds this amount. |
| `MAX_RUN_LOSS_USD` | `200` | Stops the current run if losses exceed this amount. |
| `MAX_API_ERRORS_PER_MIN` | `10` | Kill switch threshold for API error bursts. |
| `STALE_TICKER_MS` | `300000` | Maximum age of market data before tripping kill switch. |
| `METRICS_PORT` | `9100` | Prometheus metrics HTTP port. |
| `KILL_SWITCH_PORT` | `9101` | Kill-switch control server port. |
| `DASHBOARD_PORT` | `9102` | HTML dashboard server port. |
| `LOG_INGEST_WEBHOOK` | _(unset)_ | Optional webhook that receives every JSON log entry. |
| `WALKFORWARD_CONFIG` | `configs/walkforward.json` | Alternate path for walk-forward automation config. |

All new logs are structured JSON (`timestamp`, `level`, `msg`, plus `runId`, `pair`, etc.) so you can stream them directly into log aggregation or alerting systems.

### Multi-tenant foundations

- **Schema:** migrations now create `clients`, `client_api_credentials`, and client-scoped FKs on every trading table (`bot_runs`, `bot_orders`, `bot_fills`, `bot_inventory_snapshots`, `bot_guard_state`). A default client (`id=default`) is seeded automatically.
- **Secrets:** set `CLIENT_MASTER_KEY` (base64/hex/or passphrase). A libsodium secret box encrypts API credentials before they land in Postgres. Rotate the master key by decrypting + re-encrypting rows.
- **Worker scoping:** every process runs with a single `CLIENT_ID`. Repositories, guard state, and the `ClientConfigService` enforce that scope, so a worker cannot read or write another client's data even if misconfigured.
- **Config loader:** `ClientConfigService` merges the client's limits/risk JSON with the runtime defaults, decrypts the requested exchange credentials, and hands `runGridOnce` a per-client config (risk sizing, exchange ID + keys, plan limits).
- **Guard limits:** provide a `guard` object inside `limits` (e.g. `{ "guard": { "maxGlobalDrawdownUsd": 250, "maxRunLossUsd": 120, "maxApiErrorsPerMin": 8, "staleTickerMs": 180000 } }`) to override circuit-breaker thresholds per client.
- **Telemetry:** Prometheus metrics and structured logs now include a `client_id` label for per-tenant dashboards and alerting.

#### Seeding a client

```bash
# 1. ensure migrations ran (npm run dev or ts-node scripts)
# 2. export secrets
export CLIENT_ID=my-client
export CLIENT_MASTER_KEY="base64-or-passphrase"

# 3. upsert the client record + encrypted keys
node -r ts-node/register <<'NODE'
const { getPool } = require('./src/db/pool');
const { runMigrations } = require('./src/db/migrations');
const { ClientsRepository } = require('./src/db/clientsRepo');
const { ClientConfigService } = require('./src/services/clientConfig');

(async () => {
  const pool = getPool();
  await runMigrations(pool);
  const clients = new ClientsRepository(pool);
  await clients.upsert({
    id: process.env.CLIENT_ID,
    name: 'Demo Client',
    owner: 'demo-owner',
    plan: 'starter',
    limits: { risk: { bankrollUsd: 500, maxPerTradePct: 0.02 } },
  });
  const service = new ClientConfigService(pool, { allowedClientId: process.env.CLIENT_ID });
  await service.storeExchangeCredentials({
    clientId: process.env.CLIENT_ID,
    exchangeName: 'binance',
    apiKey: process.env.EXCHANGE_API_KEY,
    apiSecret: process.env.EXCHANGE_API_SECRET,
    passphrase: process.env.EXCHANGE_API_PASSPHRASE || null,
  });
  console.log('client + secrets stored');
  process.exit(0);
})();
NODE
```

> For paper runs you can omit API keys; the worker will warn but continue with public market data. Live mode requires encrypted credentials.

#### Admin CLI helpers

```
# List all tenants (human readable)
npm run client-admin -- list-clients

# Show a single tenant as JSON (includes credential metadata)
npm run client-admin -- show-client --id my-client --json

# Upsert tenant metadata / limits
npm run client-admin -- upsert-client --id my-client --name "Demo" --owner "ops" \
  --plan starter --status active \
  --limits '{"risk":{"bankrollUsd":500},"guard":{"maxGlobalDrawdownUsd":200}}'

# Rotate encrypted API keys (CLIENT_MASTER_KEY must be set)
npm run client-admin -- store-credentials --id my-client --exchange binance \
  --api-key "$NEW_KEY" --api-secret "$NEW_SECRET"

# Target a remote (e.g. staging) Postgres + master key in one liner
PG_URL="postgres://user:pass@staging-host:5432/tradebot" \
CLIENT_MASTER_KEY="$STAGING_MASTER" \
npm run client-admin -- list-credentials --id my-client --json

# Validate rotation by listing before/after storing new secrets
PG_URL="..." CLIENT_MASTER_KEY="$STAGING_MASTER" npm run client-admin -- list-credentials --id my-client
PG_URL="..." CLIENT_MASTER_KEY="$STAGING_MASTER" npm run client-admin -- store-credentials --id my-client \
  --exchange binance --api-key "$ROTATED_KEY" --api-secret "$ROTATED_SECRET"
PG_URL="..." CLIENT_MASTER_KEY="$STAGING_MASTER" npm run client-admin -- list-credentials --id my-client
```

#### Admin HTTP service

When you need to delegate tenant management, run the lightweight HTTP bridge:

```bash
export PG_URL="postgres://user:pass@staging-host:5432/tradebot"
export CLIENT_MASTER_KEY="$STAGING_MASTER"
export ADMIN_API_TOKEN="super-secret-token"
export ADMIN_PORT=9300

npm run admin:server
# -> Admin server listening on :9300
```

Every request must present the bearer token:

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" http://localhost:9300/clients

curl -X PUT -H "Authorization: Bearer $ADMIN_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"name":"Demo","owner":"ops","limits":{"guard":{"maxGlobalDrawdownUsd":200}}}' \
     http://localhost:9300/clients/my-client

curl -X POST -H "Authorization: Bearer $ADMIN_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"exchangeName":"binance","apiKey":"key","apiSecret":"secret"}' \
     http://localhost:9300/clients/my-client/credentials
```

> Tip: front the admin service with your API gateway / identity provider (e.g. Auth0, Cloudflare Access) to enforce SSO + audit logging before exposing it to operations teammates.

### Client portal (Milestone 2 groundwork)

- The Next.js portal lives in `apps/portal`. It uses NextAuth + Auth0 (bring your own Auth0 tenant) and talks to the admin API.
- Configure the following environment variables (add them to `.env` or `.env.local` in the portal workspace):
  - `AUTH0_ISSUER_BASE_URL`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET`
  - `NEXTAUTH_SECRET` (generate via `openssl rand -base64 32`)
  - `NEXTAUTH_URL` / `PORTAL_BASE_URL` (e.g. `http://localhost:3000`)
  - `ADMIN_API_URL` (e.g. `http://localhost:9300`)
- Development commands:
  ```bash
  npm run portal:dev      # starts Next.js on port 3000 by default
  npm run portal:build
  npm run portal:start
  ```
- The landing page provides Auth0 sign-in and routes authenticated users to `/app`, where plan selection, API key workflows, and metric dashboards will be layered in the next steps.

#### Supplying exchange API keys (customer-facing)

- Generate trade-only keys inside your exchange (no withdrawal, IP lock if available).
- Paste the key/secret into the encrypted form inside the portal. Secrets never touch the browser’s local storage and are encrypted server-side with the tenant master key defined by `CLIENT_MASTER_KEY`.
- Rotate keys from the same UI. Each rotation appears in the audit trail (`Action = credentials_rotated`) so operators can verify who changed what.
- After storing keys, trigger a paper run from the dashboard to validate connectivity before requesting live access.

---

## Live Verification Checklist

Before enabling live trading on a new exchange account:
- Configure `PG_URL` for your Supabase/Postgres instance and run migrations by launching the bot once with `SUMMARY_ONLY=true`.
- Keep `PAPER_MODE=true` and execute multiple runs to validate order placement, replacement, and TP monitoring telemetry (`execution_metrics` logs).
- Force a restart mid-run to confirm reconciliation restores state (inspect `bot_runs`, `bot_orders`, `bot_fills`).
- Tune `ORDER_CONCURRENCY` / `ORDER_RATE_INTERVAL_MS` to satisfy the exchange’s rate limits, then dry-run with small size.
- Flip `PAPER_MODE=false` only after observing healthy live metrics and verifying regime logs (`regime_analysis`, `regime_applied`).

---

## Process Automation

- `npm run walkforward` executes the staged backtest → walk-forward workflow described in `configs/walkforward.json`. Adjust the JSON to list successive regimes/windows you want to validate; each stage can override env vars (e.g., `GRID_STEPS`, `TP`).
- `npm run deploy:paper` builds the project and launches `node dist/index.js` with `PAPER_MODE=true` for canary validation. Logs/metrics go to the same dashboard/Prometheus endpoints.
- `npm run deploy:live` requires `PROMOTE_CONFIRM=I_ACKNOWLEDGE_RISK` and ensures `PAPER_MODE` is not true before launching live. This reuses the built artifact for reproducibility.
- Structured JSON logs can be ingested via `LOG_INGEST_WEBHOOK` (POST per log entry) for centralized pipelines.
- Dashboard: visit `http://localhost:${DASHBOARD_PORT}` for an HTML snapshot of the latest run, open orders, guard state, and realized P&L (JSON available at `/api/status`).

### Release cadence (suggested)

1. Run `npm run walkforward` for regression screening (commit artifacts/results as needed).
2. Execute `npm run test` and `npm run build` (CI already enforces this on push/PR via `.github/workflows/ci.yml`).
3. Launch `npm run deploy:paper`; monitor metrics/logs and the live verification checklist outputs.
4. If the canary passes and stakeholders approve, promote with `npm run deploy:live` using a fresh terminal and explicit confirmation variable.
5. Capture key telemetry snapshots (metrics scrape, dashboard `/api/status`) and record the run id in release notes.

## Selling & GTM strategy (how to sell this bot as a product / membership)
Below is a concise, ruthless go-to-market plan so you can turn this bot into recurring revenue.

### Productization model (start simple)
1. **Hosted SaaS (Recommended)** — You run the bot on your infra. Customers create accounts, connect API keys (trade-only, no withdraw), and subscribe monthly. Pros: recurring revenue, less piracy. Cons: you run infra & compliance.
2. **Self-hosted License** — One-time fee + annual maintenance. Provide a Docker image + license key + docs. Higher upfront, but harder to scale.
3. **Managed Service** — You run & manage funds for clients for a fee + performance share. Highest margin, regulatory baggage.

### Pricing (starter suggestion)
- **Trial (paper-only):** 14 days free.
- **Starter:** $49/month — single exchange, single strategy, email support.
- **Pro:** $199/month — multi-exchange, backtest UI, Telegram alerts, priority support.
- **Managed:** $1,000+/month or 0.5% performance fee — white-glove onboarding + custom strategies.

### Packaging & Tiers
- Tier 1 (Starter): Basic grid parameters, preset risk config, daily P&L email.
- Tier 2 (Pro): Custom grids, funding-rate capture addon, backtest exports, 24/7 alerts.
- Tier 3 (Enterprise/Managed): Dedicated instance, premium support, SLAs.

### Onboarding & Trust (critical)
- **Paper-first onboarding:** new users must run 7 days in paper mode before live.
- **KYC-lite for payments:** require identity verification for Pro/Managed tiers (use third-party KYC if needed).
- **API keys policy:** require trade-only keys; never ask for withdraw permission. Provide step-by-step guide for creating restricted keys (Binance/Bybit).
- **Proof & transparency:** show backtest reports, live anonymized screenshots, and a third-party audit of execution logic (later).

### Marketing channels & sales funnel
- **YouTube technical demos:** show backtests, explain risk controls, record live small-run case studies.
- **Twitter/X & Threads:** short trade recaps, performance screenshots, community replies.
- **Discord community:** gated access for paid members; run free weekly AMAs and strategy clinics.
- **Partnerships & affiliates:** crypto trading influencers, Telegram channel owners (affiliate revenue split).
- **Product Hunt / Indie Hackers launch:** get early adopters and press.
- **Paid ads & retargeting:** after initial traction, run targeted ads to crypto traders.

### Support & Ops playbook
- **Docs & FAQ:** detailed guides for API keys, risk params, and refunds.
- **Email + Telegram support:** fast response for fills, failures, and suspicious behavior.
- **Incident response:** have a process for outages, stopped trades, and refunds.

### Legal & compliance (don’t ignore)
- **TOS & disclaimers:** explicit risk notices, no financial advice clauses, limit of liability.
- **Require trade-only API keys:** show instructions and warn users in onboarding.
- **Consider local regulations:** if you offer managed services, consult a lawyer re: custody, licensing, and tax.
- **Refund policy:** transparent and limited — e.g., 30-day money-back on Starter to build trust.

### Metrics to measure (business KPIs)
- MRR, churn rate, LTV:CAC ratio
- Activation rate (paper -> live)
- Average P&L per user (realized)
- Support tickets per active user
- Uptime & execution latency metrics

### Quick sales funnel (first 90 days)
1. Launch MVP with 10 beta users (offer lifetime discount for feedback).
2. Create 3 YouTube videos: walkthrough, backtest, live 1-week run.
3. Build Discord & invite early testers; gather testimonials.
4. Use testimonials to create a landing page and enable Stripe/PayPal (once fixed).
5. Run paid trial promos via affiliates and reinvest revenue into product + support.

---

## Security & ethics (non-negotiable)
- Never store withdraw-enabled API keys.
- Paper-first and kill-switches mandatory.
- Audit code paths for order placement and ensure idempotency.

---

## Next steps I will generate for you if you want:
- A more advanced Hardhat fork simulation script to test DEX sells. (ask if needed)
- Deployment script for DigitalOcean (ask and I will create).

Good. Run the starter locally, paper-mode, fetch backtest candles, and report the first week of paper P&L. I’ll help tighten the strategy and prepare the SaaS packaging next.
