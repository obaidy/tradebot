# Mobile Realtime + Offline Sync Prototype

## Goals
- Establish a reusable realtime client that can consume the dashboard WebSocket stream once the mobile BFF exposes it.
- Stitch WebSocket push updates into the RTK Query cache so UI components stay reactive without bespoke state plumbing.
- Persist the latest dashboard snapshot and recent activity feed locally for 24h offline access.

## Components
### `realtimeClient`
- Wraps the native `WebSocket` object and exposes typed events (`dashboard.update`, `activity.append`, `connected`, `disconnected`).
- Implements exponential backoff reconnects (2^n up to 15s) with a retry ceiling of 5 attempts.
- Authenticates via Bearer token query param (`?token=`) – swap for header-based auth if backend requires.

### `useRealtimeSync`
- Hook invoked from `AppNavigator` so the connection is global after authentication.
- On `dashboard.update`:
  - Injects payload into RTK Query cache via `upsertQueryData('getDashboardSummary')`.
  - Persists snapshot to `AsyncStorage` (`saveDashboardSnapshot`).
  - Updates `app` slice telemetry (`lastSyncedAt`, `websocketConnected`).
- On `activity.append`:
  - Prepends entries to cached activity feed and trims to 50 records.
  - Stores the latest batch in `AsyncStorage` for offline rendering.
- Disconnects gracefully when the access token is cleared.

### `offlineCache`
- Thin wrapper around `AsyncStorage` with JSON payloads and timestamp metadata.
- `DashboardScreen` hydrates from cache on mount so users see recent data while the network request resolves.

## Usage Flow
1. `AuthGate` rehydrates stored session and renders the app shell.
2. `useRealtimeSync` connects to `WS_BASE_URL` with the current token.
3. REST queries (`getDashboardSummary`, `getActivityFeed`) populate initial state; WebSocket delta events keep stores fresh.
4. When offline, cached summaries/activity are shown until connectivity resumes.

## Next Steps
- Backfill staged WebSocket endpoint to emit compact `dashboard.update` deltas instead of full payloads.
- Add integrity checks (sequence numbers, heartbeats) so the client can resync via REST if a frame is dropped.
- Expand offline cache to include strategy list + notification preferences, respecting 24h retention policy.
- Instrument latency (time from socket payload to UI render) and queue length for telemetry.
