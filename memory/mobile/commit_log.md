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

## Iteration 3 — Phase 4b: Tier Selection & Billing UI
- **Commit**: c13c18cde932489b45b198c0467c7f8311d2a55e
- **Date**: 2026-06-10
- **Changes**:
  - Replaced placeholder `/upgrade` screen with full tier-selection + checkout + cancel UI
  - Integrated backend billing API endpoints: `GET /billing/tiers`, `GET /billing/me`, `POST /billing/checkout`, `POST /billing/cancel`
  - Added `refreshUser()` to `AuthContext.tsx` for post-billing state sync
  - Updated `chat.tsx` to re-evaluate premium status when `user.premium` changes
  - Updated `app.json` scheme from `mobile` to `pulsehub` for deep link handling
  - Checkout flow uses `expo-web-browser.openAuthSessionAsync` with `expo-linking.createURL`
  - Cancel flow uses `Alert.alert` confirmation dialog + API call
  - Shows MOCK MODE badge on tier screen for environment visibility
  - Subscription info card shows "Premium since {date}" and active status
  - Full round-trip verified: Free → Upgrade → Premium (Chat works) → Cancel → Free (paywall returns)
- **Files modified**: `app/upgrade.tsx`, `src/AuthContext.tsx`, `app/(tabs)/chat.tsx`, `app.json`
- **Web files referenced**: None (backend API endpoints only)

## Iteration 4 — Bug Fix: Cancel Premium non-functional on Expo Web
- **Commit**: 0b6cb692bdb8b4f029cecb6e917c27c1d6973f6d
- **Date**: 2026-06-10
- **Changes**:
  - Root cause: `Alert.alert()` from react-native is a no-op on web — no confirmation dialog appears, so the cancel callback never fires
  - Fix: Platform.OS branching — on web uses `window.confirm()`, on native uses `ConfirmDialog` component (custom modal)
  - Applied same fix to Profile's "Sign Out" button (also a critical path using Alert.alert)
  - Created `src/components/ConfirmDialog.tsx` — reusable cross-platform confirmation dialog for native
  - Upgraded Cancel Premium button from `TouchableOpacity` to `Pressable` with `role="button"` for better web accessibility
  - Audited all `Alert.alert()` calls: only 3 found — cancel (fixed), logout (fixed), biometric prompt (safe — only fires on native with hardware)
  - Full cancel round-trip verified via API: Premium → Cancel → Free → Chat paywall returns → Profile badge reverts
- **Files modified**: `app/upgrade.tsx`, `app/(tabs)/profile.tsx`, `src/components/ConfirmDialog.tsx` (new)
- **Web files referenced**: None
