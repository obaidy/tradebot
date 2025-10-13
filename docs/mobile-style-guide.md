# Mobile Design System Snapshot

## Visual Foundation
- **Color Palette**
  - Primary `#3A7BFA`
  - Accent Soft `#274B8F`
  - Background Dark `#050710`
  - Surface `#0B1020`
  - Surface Alt `#131A2F`
  - Border `#1F2942`
  - Positive `#3BD39C`
  - Negative `#FF6B6B`
  - Warning `#F5A623`
  - Text Primary `#F4F7FF`
  - Text Secondary `#8F9BB3`
- **Typography**
  - Family: SF Pro / Inter fallback
  - Sizes: caption 12, label 14, body 16, title 24, hero 32
  - Weights: Regular 400, Medium 600, Bold 700
- **Spacing & Layout**
  - Base unit: 8px (mobile scale)
  - Corners: 8 / 12 / 16 / 24 for cards, sheets, modals
  - Shadows: soft (opacity 0.12, radius 6), medium (0.18, radius 12)

## Component Tokens
- **Navigation Tabs**: 56px height, active tint `primary`, inactive `textSecondary`, background `surface`.
- **Cards (Surface)**: Primary card uses `surface` background, 16px radius, 1px border. Secondary card uses `surfaceAlt` for nested lists.
- **Buttons**
  - Primary: filled `primary`, white text, 16px radius.
  - Secondary: outline (surfaceAlt) with textPrimary.
  - Destructive: filled `negative`.
- **Typography**
  - Headline (hero) reserved for top KPI (Total P&L).
  - Titles (24px) for section headers.
  - Body (16px) for content; captions for metadata.

## Interaction Patterns
- **Quick Actions** require confirmation sheet for destructive flows (Kill switch => biometric + double tap confirm).
- **Infinite Lists** use pull-to-refresh + lazy pagination (50 items per page).
- **Alerts** color-coded by severity: info (textSecondary), warn (`warning`), critical (`negative`).
- **Notifications** show badge counts sourced from realtime stream.

## Screen Wireframes

### Dashboard
```
┌────────────────────────────────────────────┐
│ TradeBot Mobile                  • • •     │
├────────────────────────────────────────────┤
│ Portfolio Overview                          │
│ ┌───── Card ────────────────────────────┐ │
│ │ Total P&L     +$2,840                  │ │
│ │ Today         +2.3%                    │ │
│ │ Active Strat  3                        │ │
│ └───────────────────────────────────────┘ │
│ Quick Actions                              │
│ [🛑 Kill Switch]  [⏸️ Pause All] [▶️ Resume]│
│ Risk Snapshot                              │
│ • Guard State: Nominal                     │
│ • Exposure: 38%                            │
│ Recent Activity                            │
│ ┌─────────────── Card ───────────────────┐ │
│ │ [Critical] Circuit breaker armed       │ │
│ │ 2 min ago • PnL -$350                  │ │
│ └────────────────────────────────────────┘ │
└────────────────────────────────────────────┘
```

### Strategies
```
┌────────────────────────────────────────────┐
│ Strategies                         Filters │
├────────────────────────────────────────────┤
│ BTC Grid • Running • +3.2%                 │
│ [ Pause ]   [ Tune ]                       │
│ ETH Grid • Paused • +1.8%                  │
│ [ Resume ] [ Tune ]                        │
│ SOL Trend • Error • -0.6%                  │
│ [ Retry ]  [ Logs ]                        │
└────────────────────────────────────────────┘
```

### Alerts & Notifications
```
┌────────────────────────────────────────────┐
│ Alerts                             Filter  │
├────────────────────────────────────────────┤
│ Notification Settings                      │
│ [Push  ON] [Email OFF] [Quiet Hours 22-6]  │
│ Critical                                   │
│ ┌────────────────────────────────────────┐ │
│ │ Kill switch armed by guard             │ │
│ │ 0:01 ago • Auto                         │ │
│ └────────────────────────────────────────┘ │
│ Warning                                   │
│ • Elevated API errors (6/min)             │
└────────────────────────────────────────────┘
```

### Settings
```
┌────────────────────────────────────────────┐
│ Settings                                   │
├────────────────────────────────────────────┤
│ Account                                    │
│ • Demo User (Pro)                          │
│ • demo@tradebot.app                        │
│ [ Sign Out ]                               │
│ Appearance                                 │
│ Dark Mode  [toggle]                        │
│ Biometrics [toggle]                        │
│ Diagnostics                                │
│ • WebSocket: Connected (12ms RTT)          │
│ • Last Sync: 2 min ago                     │
└────────────────────────────────────────────┘
```

## Collaboration Notes
- Deliver tokens + component specs to design team (Figma styles) matching the palette above.
- Motion: use 150ms ease-out for button presses, 200ms ease-in-out for card reveals.
- Accessibility: maintain 4.5:1 contrast for text; provide dynamic text sizing up to 120% without clipping.
- Handoff: attach this spec + Expo theme tokens to shared workspace; align on iconography (Ionicons weight 28 filled for active tabs). See `docs/mobile-design-handoff.md` for the exported tokens JSON and import checklist.
