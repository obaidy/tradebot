# TradeBot Mobile

React Native (Expo) client providing real-time monitoring, emergency controls, and notification management for TradeBot.

## Getting Started
1. Install dependencies from the monorepo root:
   ```bash
   npm install
   ```
2. Launch the Expo dev server:
   ```bash
   npm run dev --workspace @tradebot/mobile
   ```
3. Configure environment variables in `app.config.ts` or by setting `MOBILE_API_BASE_URL` / `MOBILE_WS_URL`.

## Scripts
- `npm run dev --workspace @tradebot/mobile` – start Expo in development mode.
- `npm run android --workspace @tradebot/mobile` – run on Android emulator/device.
- `npm run ios --workspace @tradebot/mobile` – run on iOS simulator/device.
- `npm run lint --workspace @tradebot/mobile` – lint project with Expo ESLint config.
- `npm run typecheck --workspace @tradebot/mobile` – run `tsc --noEmit`.

## Structure
```
apps/mobile
├── App.tsx                 # Entry point with providers
├── app.config.ts           # Expo configuration & env wiring
├── src
│   ├── components          # Shared UI primitives (Surface, ThemedText, etc.)
│   ├── navigation          # React Navigation bottom tabs + stack shell
│   ├── screens             # Feature screens (Dashboard, Strategies, Alerts, ...)
│   ├── services            # RTK Query API client, auth helpers, storage
│   ├── state               # Redux store, slices, hooks
│   ├── theme               # Dark/light tokens + ThemeProvider
│   └── constants           # Runtime environment helpers
└── assets                  # Placeholder for icons/splash
```

## Next Steps
- Validate the PKCE + MFA sign-in flow on iOS/Android and add biometric gating before GA.
- Wire quick actions to real mutations (pause/resume, kill switch) and add confirmation dialogues.
- Implement offline sync cache and background refresh leveraging the `/v1/sync` endpoints.
- Hook WebSocket streaming data to power live tiles and notifications badge counts.
