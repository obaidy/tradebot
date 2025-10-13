# TradeBot Mobile Architecture Blueprint

## Overview
- **Objective:** Deliver a secure, low-latency mobile companion app that surfaces trading telemetry, enables responsive controls, and reuses existing TradeBot services with minimal duplication.
- **Scope:** iOS/Android React Native client, dedicated mobile BFF (backend-for-frontend), mobile-friendly auth, realtime + offline data sync, push notification infrastructure, and supporting observability.
- **Assumptions:**
  - Existing services (`admin` @ 9300, `metrics` @ 9100, `dashboard` @ 9102, kill switch @ 9101) remain authoritative sources of truth.
  - NextAuth/Auth0 continues to manage identity; Slack webhook-based alerting already exists and can be extended.
  - Mobile users overlap with Portal users; RBAC and billing plans (Stripe) stay consistent across surfaces.

## Mobile Authentication & Session Model
### Flow Summary
1. **PKCE OAuth2** via Auth0/NextAuth public client:
   - Mobile app registers as a public client; uses authorization code with PKCE.
   - Auth completes in an in-app browser (ASWebAuthenticationSession/CustomTabs) or deep link from portal when SSO is established.
2. **Token Handling:**
   - Access token scoped for mobile BFF; refresh token stored using OS secure storage (`Keychain` / `EncryptedSharedPreferences`).
   - Rotation enforced via NextAuth refresh endpoint; BFF validates JWT via JWKS.
3. **2FA Support:**
   - Reuse existing MFA (TOTP/SMS/WebAuthn) flows; embed focused screens in RN using WebViews or API-driven prompts.
   - Require MFA re-challenge for destructive operations (`killSwitch`, `strategyPause`).
4. **Device Trust & Revocation:**
   - BFF maintains `device_sessions` table keyed by `userId + deviceId` with metadata (OS, push token, lastSeen).
   - Admin UI exposes device revocation; forced sign-out triggers push to invalidate local session.
5. **Biometric Lock:**
   - Local app layer gate using FaceID/TouchID; fallback to device passcode.
   - Optional policy flag from BFF (`requireBiometric`) to enforce on high-risk roles.
6. **Session Expiry:**
   - Short-lived access token (5-10 min) + silent refresh.
   - Background refresh disabled to limit attack surface; user reauth required after 12h inactivity or policy change.

### Auth Service Components
- **Mobile Auth Controller (BFF):** Handles login callbacks, token exchange, session hydration, device registration.
- **Policy Engine:** Reads plan (Starter/Pro) + compliance flags → returns feature toggles to the app.
- **Audit Logging:** Every auth event appended to existing `audit_log` using actor `mobile:{deviceId}`.

## Backend-for-Frontend (BFF) Service
### Purpose
- Provide a single origin (`mobile-api.tradebot.local:9400`) for the mobile client.
- Translate complex backend resources into mobile-optimized payloads.
- Enforce mobile-specific rate limits, caching, feature flags, and authorization.

### Responsibilities
- **API Aggregation:**
  - `GET /v1/dashboard/summary` → combines Admin snapshot, Metrics gauges, Dashboard guard state.
  - `GET /v1/strategies` → merges strategy definitions with per-client allocation/performance data.
  - `GET /v1/activity` → paginated trades + alerts feed (sourced from telemetry + alerts services).
- **Command Gateway:**
  - `POST /v1/controls/kill-switch`, `POST /v1/strategies/:id/pause`, etc.; proxies to Admin service with additional safeguards (two-step confirmation, policy checks).
- **Notification Hub:**
  - Stores push tokens, preference center; dispatches to FCM/APNs.
  - Mirrors Slack/webhook severity taxonomy.
- **Realtime Fan-Out:**
  - Maintains WebSocket endpoint (`/ws`) that subscribes to Dashboard server and Redis pub/sub; down-samples updates for mobile.
- **Offline Cache API:**
  - Exposes delta endpoints (`/v1/sync/changes?since=...`) for last 24h snapshots.

### Implementation Notes
- **Tech Stack:** Node.js (NestJS/Fastify) or existing TypeScript service scaffold (`src/services`); reuse shared DB pool + config.
- **Database:** Extend Postgres with `mobile_device_sessions`, `mobile_push_tokens`, `mobile_sync_cursors` tables.
- **Rate Limiting:** Redis-backed sliding window (30 req/min baseline, tighter for control endpoints).
- **Security:**
  - Validate tokens with Auth0 JWKS; enforce `audience=mobile-bff`.
  - Mutual TLS optional for future hardening (esp. if exposing over public internet).
- **Observability:** Ship logs via existing logger to structured log sink; add metrics (`mobile_request_duration`, `mobile_active_sessions`).

## Data Contracts
_All contracts live in `packages/mobile-contracts` (new) and are shared between app + BFF._

### Dashboard Summary
```ts
export interface PortfolioSummary {
  clientId: string;
  totalPnlUsd: number;
  dayChangePct: number;
  bankRollUsd: number;
  activeStrategies: number;
  updatedAt: string; // ISO8601
}

export interface StrategyStatus {
  strategyId: string;
  name: string;
  runMode: 'live' | 'paper';
  status: 'running' | 'paused' | 'error';
  pnlPct: number;
  lastRunAt: string;
}

export interface DashboardSummaryResponse {
  portfolio: PortfolioSummary;
  strategies: StrategyStatus[];
  risk: {
    globalDrawdownUsd: number;
    exposurePct: number;
    guardState: 'nominal' | 'warning' | 'critical';
  };
  quickActions: {
    killSwitchAvailable: boolean;
    pauseAllAvailable: boolean;
  };
}
```

### Activity Feed
```ts
export interface ActivityEntry {
  id: string;
  type: 'trade' | 'alert' | 'system';
  severity?: 'info' | 'warn' | 'critical';
  title: string;
  description: string;
  asset?: string;
  pnlUsd?: number;
  createdAt: string;
}

export interface ActivityFeedResponse {
  entries: ActivityEntry[];
  nextCursor?: string;
}
```

### Control Commands
```ts
export interface ControlConfirmationPayload {
  confirmToken?: string;
  mfaToken?: string;
  biometricSignature?: string;
}

export interface KillSwitchRequest extends ControlConfirmationPayload {
  reason: string;
}

export interface PauseAllRequest extends ControlConfirmationPayload {}

export interface ResumeAllRequest extends ControlConfirmationPayload {}

export interface StrategyControlRequest extends ControlConfirmationPayload {
  strategyId: string;
  action: 'pause' | 'resume';
}
```

### Notification Preferences
```ts
export interface NotificationChannelConfig {
  channel: 'push' | 'email' | 'slack';
  enabled: boolean;
  quietHours?: { start: string; end: string; timezone: string };
  severityThreshold: 'info' | 'warn' | 'critical';
}

export interface NotificationPreferences {
  userId: string;
  channels: NotificationChannelConfig[];
  updatedAt: string;
}
```

## Notification Flow
1. **Event Sources:** Trade engine telemetry (`src/telemetry`), risk guard (`src/guard`), jobs (`src/jobs`), Slack webhook publisher (`src/alerts`).
2. **Event Bus:** Continue using Redis pub/sub + `alerts` queue; instrument to fan-out to new `mobile.push.dispatch` topic.
3. **Notification Orchestrator (BFF):**
   - Consumes events, enriches with client metadata, applies user preference rules.
   - Deduplicates alerts within suppression windows; respects quiet hours.
   - Logs every dispatch to `mobile_push_audit` table with payload hash + status.
4. **Push Providers:**
   - Firebase Cloud Messaging (FCM) primary; APNs handled via FCM tokens.
   - Implement failover to Slack/email when push delivery fails repeatedly.
5. **In-App Inbox:**
   - BFF persists notifications for 30 days; app fetches via `/v1/notifications` to show history + read state.
6. **Testing:**
   - Local dev uses Firebase sandbox + stub transport logging.
   - Synthetic monitors validate high-priority alerts (kill switch, large loss) reach device in <30s.

## Offline & Sync Strategy
- **Data Snapshots:** BFF exposes `/v1/sync/bootstrap` returning compressed JSON for portfolio, strategies, preferences.
- **Delta Sync:** Clients poll `/v1/sync/changes?cursor=` when reconnecting; cursor stored per device.
- **Conflict Resolution:** Commands always server-authoritative; local optimistic state rolled back on failure.
- **Caching:** Use `AsyncStorage` for cached widgets; expire after 24h or when policy revision changes.

## Security & Compliance
- Enforce device jailbreak/root detection with third-party lib; BFF rejects commands from flagged devices.
- Sensitive screens obfuscate previews (screenshot prevention) and require biometric unlock.
- All control actions double-logged: `audit_log` + `mobile_push_audit` for corresponding notifications.
- Data minimization: PII restricted; app only stores clientId + tokens.
- GDPR/CCPA support: BFF surfaces delete/export endpoints that orchestrate existing data erasure routines.

## Observability & SLOs
- **SLO Targets:**
  - Auth success rate ≥ 99%.
  - Dashboard summary latency p95 < 800ms.
  - Push delivery (critical severity) 95% < 30s.
  - App crash-free sessions ≥ 99%.
- **Instrumentation:**
  - Prometheus metrics for request latency, active sessions, push queue depth.
  - Distributed tracing via OpenTelemetry bridging mobile spans → BFF → downstream services.
  - Synthetic device monitoring using Firebase Test Lab nightly.

## Open Questions
- Does Auth0 tenant already support device grant? (Needed for passwordless push-based login.)
- Preferred infra target for BFF? (Docker service vs. serverless fronted by API Gateway.)
- Long-term plan for social trading feed parity on mobile? (Impacts data contract evolution.)
