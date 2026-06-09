# PulseHub Mobile — Iteration 1

## What Was Implemented

### Screens
1. **Login** (`app/login.tsx`) — Patient-only login, blocks non-patient roles
2. **Dashboard** (`app/(tabs)/index.tsx`) — Greeting, risk level card, 3 metric cards with live WS updates
3. **Vitals** (`app/(tabs)/vitals.tsx`) — 7-day SVG line charts for Glucose/HR/SpO₂, self-submit form
4. **Chat** (`app/(tabs)/chat.tsx`) — Secure messaging with assigned doctor via WebSocket
5. **Profile** (`app/(tabs)/profile.tsx`) — Patient info, prescriptions list, logout

### Components/Utilities
- `src/api.ts` — Axios client with token interceptor, AsyncStorage persistence
- `src/AuthContext.tsx` — Auth provider with login/logout/bootstrap
- `src/theme.ts` — Color system, severity helpers, metric config
- `src/hooks/useVitalsWS.ts` — WebSocket hook with reconnection logic

### Navigation
- Tab-based: Home, Vitals, Chat, Profile (using expo-router Tabs)
- Stack: index → login → (tabs)

## Web-to-Mobile Mapping
| Web Feature | Mobile Feature | Notes |
|---|---|---|
| Login (doctor portal) | Login (patient portal) | Reversed role check |
| PatientDetail vitals | Dashboard + Vitals tab | Patient sees own data |
| PatientDetail chat | Chat tab | Same WS/API endpoints |
| PatientDetail prescriptions | Profile tab | Embedded in profile |
| Triage list | N/A | Doctor-only feature |
| AdminDoctors | N/A | Admin-only feature |

## API Endpoints Used (same as web)
- POST /api/auth/login
- GET /api/auth/me
- GET /api/patients/{id}
- GET /api/vitals/{patient_id}?metric=&from=&to=&limit=
- POST /api/vitals
- GET /api/prescriptions/{patient_id}
- GET /api/chat/threads/by-patient/{patient_id}
- GET /api/chat/threads/{thread_id}/messages?limit=
- WS /api/ws/vitals?token=&patient_id=
- WS /api/ws/chat/{thread_id}?token=

## Dependencies Installed
- axios
- @react-native-async-storage/async-storage
- react-native-svg

## Known Issues
- expo- preview URL (CDN) was not routing to mobile app (platform infra issue). App works correctly via localhost:3001.
- Scroll-to-bottom in Vitals page submit section may need manual scroll on web preview.

## Verification
- ✅ Login screen renders with proper form
- ✅ Login flow works (patient1@pulsehub.test / Patient123!)
- ✅ Dashboard shows live vitals with WebSocket
- ✅ Vitals tab shows 7-day SVG charts for all 3 metrics
- ✅ Chat tab loads messages and has send functionality
- ✅ Profile tab shows patient info, 4 prescriptions, logout button
- ✅ All lint checks pass (0 issues)
