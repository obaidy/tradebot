# Mobile API Readiness Audit

## Auth & Identity
- **Current implementation:** `apps/portal` uses NextAuth with Auth0 (JWT sessions, scopes `openid email profile`). No PKCE enforcement or rotation policies exposed; relies on browser session cookies.
- **Mobile impact:** Public native apps require PKCE + token rotation + refresh token binding to device. Existing NextAuth route does not expose a mobile-friendly token endpoint or device metadata.
- **Required extensions:**
  - Configure Auth0 application with `Token Endpoint Auth Method = None` and enable Refresh Token rotation.
  - Add `/api/mobile/auth/callback` (Next.js or BFF) to exchange code for JWT, store device info, and emit short-lived access token scoped to `mobile-bff` audience.
  - Expand session callback to include billing plan, roles, and client associations for downstream authorization.

## Admin API (port 9300)
| Endpoint | Response Summary | Gaps for Mobile | Suggested Enhancements |
| --- | --- | --- | --- |
| `GET /clients` | Returns full list of clients (no filters). | Lacks pagination, filtering by actor; exposes admin-only fields. | Add `?owner=` filter, pagination (`limit`, `cursor`), and projection controls. Restrict via BFF to the caller's client scope. |
| `GET /clients/:id` | Snapshot with credentials summary. | Contains exchange credential metadata unsuitable for mobile; requires admin token. | Create BFF endpoint that redacts secrets and limits metadata to status only. |
| `GET /clients/:id/portfolio` | Strategy allocation list + execution plan. | Heavy payload, schema uses mixed casing, no ETag. | Introduce normalized DTO (see `DashboardSummaryResponse`), add caching headers/`updatedAt`. |
| `GET /clients/:id/history` | Latest 50 runs + guard + inventory. | No pagination beyond 50; nested summary fields inconsistent. | Add cursor-based pagination, surface derived metrics (pnl deltas) separately. |
| `GET /clients/:id/metrics` | Static guard metrics + 40-run history. | Requires repeated heavy queries; SSE stream `/metrics/stream` sends raw events every 5s. | BFF should poll at lower cadence, aggregate, and push via WebSocket with throttling. Cache history separately. |
| `POST /clients/:id/kill` | Trigger kill switch via admin token. | No secondary confirmation or device checks. | BFF wrapper to require MFA, audit `deviceId`, and send confirmation push before executing. |
| `POST /clients/:id/pause` / `resume` | Pause/resume strategies. | No per-strategy context; works on entire client. | Extend Admin API or add BFF route to support per-strategy operations (leveraging existing `clientStrategyAllocations`). |
| `GET /clients/:id/agreements` | Legal acceptance state. | Response fine but seldom needed on mobile. | Expose read-only subset via BFF when compliance gating required. |
| Social endpoints (`/social/**`) | Manage strategy listings, followers. | Suitable for future social features but responses include full descriptions. | BFF to sanitize content and enforce plan-based feature flags. |

**General observations:**
- All Admin endpoints require `ADMIN_API_TOKEN`. Native apps cannot ship this secret; BFF must proxy and enforce per-user auth.
- Responses are large JSON blocks without compression hints; enable gzip/deflate on BFF.
- No rate limiting or abuse protections present; implement Redis-based throttles in BFF.

## Dashboard Service (port 9102)
- **Endpoints:** `GET /` (HTML), `GET /api/status` (raw JSON run, orders, guard), redirects `/metrics` → Prometheus.
- **Data quality:** `run` payload includes raw `params_json`; `orders` unpaginated; guard values coarse.
- **Mobile suitability:** Not directly consumable; lacks authentication (relies on network ACL). For mobile, mount WebSocket/REST endpoints behind BFF that reuse the underlying SQL queries but translate to trimmed DTOs (`StrategyStatus`, `ActivityEntry`).
- **Extensions:**
  - Materialize reusable SQL views for `orders` and `runs` to avoid duplication.
  - Add `since` parameter for incremental fetches.
  - Implement `WSS` support (currently HTTP-only) for secure mobile channels.

## Metrics Server (port 9100)
- **Capabilities:** Prometheus metrics via `/metrics`; includes PnL gauges, risk metrics, inventory, queue depth.
- **Mobile usage:** Too granular; best consumed server-side. BFF should query Prometheus or maintain read-model tables, then expose summarized snapshots (p95 latencies, risk flags).
- **Action:** Create scheduled job that samples key metrics and stores to `mobile_metrics_cache` table for quick retrieval.

## Alerts & Notifications
- **Current flow:** Slack webhook (`SLACK_WEBHOOK_URL`) with severity mapping in `src/alerts`; Twilio/email optional via env.
- **Gaps:** No structured event bus or user-level preferences. Alerts fire per client without dedupe.
- **Extension plan:**
  - Emit alert events to Redis/BullMQ with metadata (`severity`, `clientId`, `category`).
  - BFF consumes queue, applies preference rules, records deliveries, and routes to FCM.
  - Provide `/v1/notifications/preferences` and `/v1/notifications` endpoints for mobile CRUD + history.

## Rate Limiting, Pagination & Filtering Summary
- **Missing across board:** Admin and Dashboard services execute unrestricted queries. Introduce middleware (in BFF) providing:
  - Sliding-window limit (e.g., 60 read/min, 10 write/min per user + device).
  - Query parameters `?limit`, `?cursor`, `?since` for feed endpoints.
  - Server-side filtering for strategies (`status`, `runMode`) and activity feed (`type`, `severity`).

## Proposed API Extensions for Mobile
1. **`GET /v1/dashboard/summary` (BFF):** Aggregates Admin portfolio + Metrics guard; returns `DashboardSummaryResponse` with ETag.
2. **`GET /v1/activity?cursor=`:** Combines recent trades (`bot_runs`/`orders`) + alerts queue; cursor = ISO timestamp + seq.
3. **`GET /v1/strategies/:id` & `PATCH /v1/strategies/:id`:** Provides per-strategy controls with validation (ensures compatibility with `ensureStrategySupportsRunMode`).
4. **`POST /v1/controls/kill-switch`:** Requires MFA token, emits audit + push confirmation, proxies to Admin `/clients/:id/kill`.
5. **`GET /v1/notifications/preferences` / `PUT` update:** Persists to new `mobile_notification_preferences` table.
6. **`GET /v1/sync/bootstrap`:** Returns compressed snapshot for offline cache including user preferences + latest metrics.

## Outstanding Questions
- Should we deprecate direct Admin access from portal in favor of BFF for parity?
- Are there existing API consumers relying on raw `params_json` structure (risk of regression)?
- Do we need multi-client support per user in mobile, or single primary client?
