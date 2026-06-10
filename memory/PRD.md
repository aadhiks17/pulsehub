# PulseHub — PRD

## Original problem statement
Build PulseHub, a hybrid healthcare platform. Phase 0 = backend foundation only
(FastAPI + MongoDB), JWT auth, AES-GCM field-level encryption, role-based access,
vitals ingest with severity classification, WebSocket gateways for live vitals
and chat, seed data, and a frontend placeholder. Mobile (Expo) is delegated.

## User personas
- **Admin** – manages users (creates doctors), full read access for audits.
- **Doctor** – views assigned patients, ingests/reads their vitals, issues prescriptions, chats.
- **Patient** – views own profile, vitals, prescriptions; can self-submit vitals.

## Core requirements (Phase 0)
- All API under `/api`. OpenAPI at `/api/openapi.json`.
- JWT (HS256) + bcrypt; `Authorization: Bearer <jwt>`.
- AES-GCM field-level encryption for vitals `value` (cleartext mirror in
  `value_plain` for query/aggregation — documented trade-off).
- Severity rules: glucose / HR / SpO2 thresholds per spec.
- WebSocket `WS /api/ws/vitals` (room per patient + triage firehose).
- WebSocket `WS /api/ws/chat/{thread_id}`.
- Seed: 1 admin, 2 doctors, 5 patients, ~30 days of vitals each.

## Implemented (2026-02)

### Phase 0
- `/app/backend/hipaa_utils.py` – AES-GCM encrypt/decrypt + `require_role`.
- `/app/backend/auth.py` – bcrypt + JWT + `get_current_user` / WS token resolver.
- `/app/backend/risk.py` – severity classifier.
- `/app/backend/models.py` – Pydantic models (Role now includes `system`).
- `/app/backend/seed.py` – seed runner; auto-runs on first boot.
- `/app/backend/server.py` – endpoints, WebSocket hubs, audit log, indexes.
- `/app/frontend/src/App.js` – minimal Phase 0 placeholder landing page.
- `/app/memory/test_credentials.md`, `/app/memory/auth_testing.md`.

### Phase 1 (vitals emulator + supporting endpoints)
- `/app/vitals-emulator/{index.js,package.json,.env}` – Node.js sidecar streaming CGM (5s) + PulseOx (10s) per patient.
- `/etc/supervisor/conf.d/supervisord_vitals_emulator.conf` – supervised, autorestart.
- `_ensure_emulator_account` on server startup – auto-creates `emulator@pulsehub.system` (role: `system`) and persists `EMULATOR_PASSWORD` to `/app/backend/.env`.
- `POST /api/admin/doctors` (admin-only) – create doctor users.
- `GET  /api/chat/threads` and `GET /api/chat/threads/{thread_id}/messages?limit=&before=` – decrypted history with participant RBAC.
- `POST /api/auth/login` – in-memory throttle, 5 fails / 15 min lockout, **respects `X-Forwarded-For`** to work behind K8s ingress.
- `POST /api/vitals` now accepts the `system` role.
- WS broadcast payload now includes `device`.
- `GET /api/vitals/{patient_id}` now sorts **descending by `recorded_at`** so `limit=N` returns the freshest N readings.
- `/app/memory/emulator_controls.md` documents the localhost:9001 control surface.

### Phase 4 (Stripe Billing — backend + admin view)
- New module `/app/backend/billing.py` mounted under `/api/billing/*` + `/api/admin/billing`.
- **Mode detection**: `LIVE_MODE` only when all of `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_PREMIUM` match strict regexes (≥20 chars after the type prefix). Anything else → `MOCK_MODE` with boot log line.
- Endpoints: `GET /api/billing/tiers` (public), `GET /api/billing/me` (patient), `POST /api/billing/checkout` (patient), `POST /api/billing/cancel` (patient), `POST /api/billing/webhook` (live-only, signature verified), `GET /api/admin/billing` (admin).
- Mock-only HTML flow: `GET /api/billing/mock-checkout` (branded $9.99 card with simulate-success/cancel buttons) → `POST /api/billing/mock-confirm` → same `_set_premium` code path as the real `checkout.session.completed` webhook. Result page at `/api/billing/mock-result`.
- Mongo: `billing_sessions` collection + new user fields (`premium_since`, `premium_canceled_at`, `stripe_subscription_id`, `stripe_customer_id`, `stripe_subscription_status`). `audit_log` rows for `checkout_initiated`, `premium_enabled`, `premium_disabled`.
- Resubscribe correctly `$unset`s `premium_canceled_at` (verified round-trip).
- **Doctor portal**: Billing Overview section appended to `/admin/doctors` (admin only): mode chip + 5-column patient billing table.
- Docs: `/app/memory/stripe_testing.md`.
- **Seed fix**: `_generate_vitals_for_patient` now anchors all timestamps strictly in the past (≤ now). Added `python -m seed --reset` CLI flag.
- **Backend**: `POST /api/prescriptions` (doctor-only RBAC), `GET /api/admin/doctors` (admin-only), `GET /api/chat/threads/by-patient/{patient_id}` (canonical `dp-…` thread id), `GET /api/vitals` now sorts ASC when both `from` and `to` are supplied (chart-friendly) and DESC otherwise. Empty-chat 403 fix: returns `[]` for legitimate doctor↔patient pair when the thread has no messages yet.
- **Frontend** (`/app/frontend`): React Router setup with protected routes.
  - `/login` — clinical login page; patients are redirected with "use mobile app" message.
  - `/triage` — live triage dashboard. WS firehose with exponential-backoff reconnect; rows update in place; critical anomalies flash red and jump to top; risk-filter chips + name search.
  - `/patients/:id` — patient deep-dive: three live recharts (Glucose 7d / HR 7d / SpO₂ 7d with threshold reference lines + severity-colored points), Prescription panel (read + create), Secure Chat panel (history + live WS), Video Consult placeholder (disabled, WebRTC pending).
  - `/admin/doctors` — admin-only roster + create-doctor form.
- All interactive elements carry `data-testid` attributes for testability.

## Infra finding (Phase 1)
The public host `health-portal-api.preview.emergentagent.com` 307-redirects WS upgrades
to the `.internal.preview.emergentagent.com` host (Cloudflare edge). Browser WS clients
cannot follow this redirect during handshake. **Workaround**: the React frontend uses
`REACT_APP_BACKEND_URL` (which points at the `.internal` host), so WS connections succeed.
Documented for the platform team — not solvable from app code.

## Endpoints
- `POST /api/auth/register` (admin-only for doctor/admin role; patient self-register OK)
- `POST /api/auth/login` → `{access_token, user}`
- `GET  /api/auth/me`
- `GET  /api/patients` (doctor: assigned only, admin: all)
- `GET  /api/patients/{id}`
- `POST /api/vitals`
- `GET  /api/vitals/{patient_id}?from=&to=&metric=`
- `POST /api/prescriptions`
- `GET  /api/prescriptions/{patient_id}`
- `WS   /api/ws/vitals?token=&patient_id=`
- `WS   /api/ws/chat/{thread_id}?token=`

## Backlog (prioritized)
- **P0 (Phase 3 — delegated)** — Expo mobile patient app.
- **P1 (Phase 4)** — Stripe billing for premium-tier patient subscription + per-seat doctor licensing.
- **P1** — Real WebRTC video consult (replace placeholder).
- **P1** — Normalize all responses to use `id` (drop `_id`); migrate `value_plain` to a dedicated indexed store and drop it for full HIPAA mode.
- **P2** — Audit log review UI, password reset flow, refresh tokens.
- **P2** — Migrate JWT from localStorage to httpOnly cookies for XSS hardening.
- **Parked** — Twilio SMS critical alert; per-patient snooze toggle (post-MVP).
