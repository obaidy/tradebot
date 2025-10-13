# Mobile Design Handoff

This package captures the artifacts needed for the design team to pull the current mobile UI direction into Figma.

## Token Export
- Canonical theme tokens live in `apps/mobile/src/theme/index.tsx` and are exported in machine-readable form at `docs/mobile-theme-tokens.json`.
- The JSON file follows a flat token schema compatible with the Figma Tokens plugin (aliases may be added later).
- Spacing is expressed as an 8pt grid. Radii and typography weights mirror the expo theme implementation.

## Wireframes & References
- Low-fidelity wireframes are documented in `docs/mobile-style-guide.md` (Dashboard, Strategies, Alerts, Settings).
- Realtime/offline data flow prototype notes are available in `docs/mobile-realtime-prototype.md` for context on dynamic widgets.

## Component Specs
- Button variants, card treatments, and text styles follow the theme tokens above.
- Quick action tiles (kill switch, pause/resume) use the accent palette with elevated shadow (`shadows.md`).
- Dashboard KPI cards reserve hero typography (32pt) for the top-line P&L metric, with caption text (12pt) for metadata.

## Next Steps For Design
1. Import `docs/mobile-theme-tokens.json` into the shared Figma library using the Tokens Studio plugin.
2. Align the color/typography tokens with existing design system naming conventions (map `accent` → `Primary/Blue-500`, etc.).
3. Recreate the low-fidelity layouts in Figma frames, applying the imported tokens to ensure parity with the implemented theme.
4. Iterate on component specs (button states, card padding, alert severity chroma) and feed updates back to engineering via PR on the token file.

Please flag any gaps in the wireframes or token coverage so we can iterate before moving into high-fidelity mocks.
