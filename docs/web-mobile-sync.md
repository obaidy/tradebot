# Web & Mobile Integration Analysis

## Current Surfaces
- **Portal (`apps/portal`)** — Next.js 12 app with Auth0 via NextAuth. UI state lives on the client; mutations and reads proxy through API routes such as `pages/api/client/*.ts` which forward to the admin service using the `ADMIN_API_TOKEN`. The main dashboard page (`apps/portal/pages/app/index.tsx`) stitches together plan limits, strategy data, audit history, and guard state via bespoke fetch utilities.
- **Mobile (`apps/mobile`)** — Expo/React Native client with Redux Toolkit Query (`src/services/api.ts`) hitting a dedicated mobile BFF hosted by `src/mobile/server.ts`. Handles PKCE + refresh token management (`src/services/authClient.ts`), offline caches, biometric gating, and push token registration.
- **Shared Backend** — Core trading/bot services in `src/strategies`, `src/services`, etc. expose admin HTTP APIs via `src/admin/server.ts` (9300) and the mobile BFF via `src/mobile/server.ts` (9400). Both mount on the same Postgres schema and reuse repositories.

## Data & Auth Flows
- Portal sessions are managed by NextAuth (Auth0) with JWT strategy (`apps/portal/lib/authOptions.ts`). Data requests call admin endpoints with a service token, so the browser never receives privileged keys.
- Mobile follows an OAuth2 PKCE exchange through the BFF (`src/mobile/auth.ts`). The BFF issues short-lived access tokens scoped to mobile, persists refresh tokens/device metadata, and enforces additional confirmation for controls (biometric, MFA hooks).
- Admin APIs expose coarse-grained resources (plan, portfolio, auditors), while mobile APIs reshape the same records into trimmed DTOs (`src/mobile/dataService.ts`).

## Overlap & Divergence
- **DTO duplication:** Dashboard/strategy/activity types are declared separately in `apps/mobile/src/services/types.ts` and redefined in the BFF (`src/mobile/dataService.ts`). Portal implements its own result shaping inline (`apps/portal/pages/app/index.tsx`) instead of using a shared contract.
- **Feature parity:** Mobile surfaces quick controls (kill switch, pause/resume) with biometric confirmation (`apps/mobile/src/screens/Dashboard/DashboardScreen.tsx`), while Portal performs similar actions via admin API calls but without shared confirmation logic.
- **State sources:** Portal fetches directly from admin routes (e.g., `/api/client/snapshot`, `/api/client/metrics`), bypassing the mobile BFF. Mobile-only capabilities (device registration, push prefs, realtime) aren’t available to the portal.
- **Styling/theming:** Portal uses design primitives in `apps/portal/components/ui`, and mobile has a separate theme system (`apps/mobile/src/theme`). Tokens (e.g., `docs/mobile-theme-tokens.json`) aren’t consumed by the web app.
- **Realtime:** Mobile leverages WebSocket hooks in `src/mobile/server.ts` to fan out events, plus offline caches. Portal relies on polling within React components.

## Risks & Gaps
- Divergent DTOs risk regression when backend schemas change—clients aren’t type-checked together.
- Admin token exposure remains a concern in Portal server-side routes; routing both clients through a common BFF would let us apply uniform auth, rate limits, and audit trails.
- Lack of shared UI tokens causes inconsistent branding and forces duplicate design work.
- Portal lacks device/session awareness, so controls executed on web won’t notify mobile devices.

## Synchronisation Strategy
1. **Create shared contracts package.**
   - Carve out the DTOs (dashboard, activity, control payloads, markets, notifications) into `packages/shared-contracts`.
   - Re-export from the backend (`src/mobile/dataService.ts`) and consume in RN (`apps/mobile/src/services/types.ts`) and Portal API handlers.
2. **Unify data access via mobile BFF.**
   - Expose BFF endpoints for portal consumption (either mount mobile router inside admin server via `createMobileIntegration` or proxy `/app/api` calls to `http://localhost:9400/mobile`).
   - Replace portal fetch helpers with calls to the shared contracts, aligning caching headers and error handling.
3. **Harmonize auth & control policies.**
   - Share confirmation requirements (biometric, MFA, confirm tokens) for destructive actions. Portal UI should reuse the same policy resolver exported from the backend to guarantee parity.
4. **Consolidate design tokens.**
   - Move `docs/mobile-theme-tokens.json` into a consumable package (e.g., `packages/design-tokens`) referenced by both Next.js (via CSS variables) and RN (via TS export) to keep colors/typography aligned.
5. **Realtime + notifications parity.**
   - Surface the mobile WebSocket stream to Portal dashboards (read-only) to eliminate polling.
   - Connect portal settings to notification preferences managed in the BFF so web toggles update mobile push behavior.
6. **Testing & CI.**
   - Add contract tests ensuring backend responses conform to shared TypeScript interfaces.
   - Extend existing `vitest` suites with snapshots for BFF endpoints and portal API routes.

## Recommended Sequencing
1. Bootstrap shared contracts + design tokens packages, update tsconfig paths in both apps, and refactor imports.
2. Swap portal API handlers to consume the BFF (keeping admin token fallback during transition).
3. Introduce unified control policy helpers and update both clients to display consistent confirmation UX.
4. Wire realtime updates + notification preferences into portal.
5. Expand automated tests covering cross-surface flows (auth handshake, dashboard summary, kill switch).

Delivering these steps will keep the mobile and web clients aligned, reduce duplicated work, and centralize risk-sensitive logic inside the hardened backend-for-frontend layer.

