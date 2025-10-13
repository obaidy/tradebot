# Mobile Auth QA Checklist

Use this list once the Auth0 PKCE + MFA stack and mobile BFF endpoints are wired up. It covers happy paths, regression traps, and device-specific edge cases.

## Pre-flight
- Configure Auth0 application with redirect URIs: `tradebot://auth/callback`, development Expo tunnel URL, and production deep links.
- Seed a test user with TOTP + SMS MFA enabled, multiple client memberships, and at least one policy requiring biometric lock.
- Ensure mobile BFF is pointed at staging Admin APIs with feature flags for pause/resume/kill switch routed through the proxy.

## Core Sign-in Flow
- Launch Expo build (iOS + Android) → tap **Sign in** → confirm system browser opens Auth0 login.
- Complete username/password → verify code exchange returns session, dashboard hydrates, WebSocket connects.
- Background the app for 10 minutes → confirm refresh token rotation succeeds and access token updates without user prompt.
- Force sign-out from Admin console → ensure next API call sees 401, app clears session, and SignIn screen appears.

## MFA Coverage
- Turn on TOTP → after credentials, confirm 2FA screen appears, accepts 6-digit code, and surfaces errors for invalid/expired tokens.
- Toggle SMS MFA → verify fallback path prompts for OTP and respects resend throttling.
- Initiate kill switch → ensure backend requires and validates MFA re-challenge prior to acknowledging the mutation.

## Device Registration & Policies
- Accept push permissions → confirm `/v1/devices/register` captures token + platform and backend records the device.
- Revoke device in Admin UI → next API call should return 401 and app should purge secure storage.
- Flip `requireBiometric` flag true → app should request FaceID/TouchID before entering main navigation.

## Controls & Guardrails
- Call `/v1/controls/kill-switch` → verify optimistic UI toast, audit log entry, and push confirmation.
- Exercise `/v1/controls/pause-all` and `/resume-all` once backend ready → ensure Redux state, WebSocket feed, and dashboard tiles reflect updated run states.
- Pause/resume individual strategies via `/v1/controls/strategies/:id/{pause|resume}` and check activity feed records control events.

## Offline / Reconnect
- Sign in, then disable network → confirm cached dashboard + activity snapshots render.
- Re-enable network → ensure refresh + realtime sync rehydrate latest data without duplicate entries.
- Trigger token refresh while offline → confirm graceful failure messaging, then automatic recovery once network returns.

## Error Handling & Telemetry
- Simulate Auth0 denial (wrong password, blocked user) → app should show inline error and clear loading state.
- Expire refresh token manually on server → verify app surfaces reauth prompt and device registration resets.
- Validate analytics/logging: mobile BFF should emit structured events for login, MFA, device register, and control commands.

Capture findings in the staging QA report with device/OS details, repro steps, and backend log correlation IDs for any failures.

## Staging Run Log
| Date | Tester | Device / OS | Auth0 Tenant | Scenario | Result | Notes | Audit Correlation |
| --- | --- | --- | --- | --- | --- | --- | --- |
|  |  |  |  |  |  |  |  |
