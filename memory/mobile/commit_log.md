# PulseHub Mobile — Commit Log

## Iteration 1 — MVP Scaffold
- **Commit**: (pre-fork initial build)
- **Changes**: Initial Expo Router setup, auth flow with expo-secure-store, biometric integration, tab structure, api client, WebSocket vitals hook.
- **Files modified**: All mobile files created from scratch.

## Iteration 2 — Phase 3 Corrections: 4-Tab Refactor & Verification
- **Commit**: 157b0475d31417b71ce0135acfbacf85d52b3327
- **Date**: 2026-06-10
- **Changes**:
  - Fixed Metro cache error referencing deleted `vitals.tsx` (cleared `.metro-cache`, `.expo/web/cache`, `node_modules/.cache`)
  - Verified all 4 tab screens compile and render correctly
  - Tested login flow with both free (`patient1@pulsehub.test`) and premium (`patient4@pulsehub.test`) users
  - Confirmed chat paywall for free users, full chat for premium users
  - Confirmed WS "Live" connection indicator in Home header
  - Confirmed premium badge on Profile (green for premium, gray for free)
  - Confirmed biometric toggle code present (hidden on web since no hardware — correct behavior)
  - Confirmed prescriptions tab standalone with data rendering
  - External preview URL (`expo-health-portal-api.preview.emergentagent.com`) shows CDN "Preview Unavailable" — known infra issue
  - All lint checks pass clean
- **Files modified**: None (verification only + cache clear)
- **Web files referenced**: `/app/backend/seed.py` (credential verification)
