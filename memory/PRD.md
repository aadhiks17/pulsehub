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

## Infra finding
The public host `health-portal-api.preview.emergentagent.com` 307-redirects WS upgrades
to the `.internal.preview.emergentagent.com` host (Cloudflare edge). Browser WS clients
cannot follow this redirect during handshake. **Workaround**: the React frontend already
uses `REACT_APP_BACKEND_URL` (which is the `.internal` host), so Phase 2 WS connections
will succeed. Documented for the platform team — not solvable from app code.

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
- **P0 (Phase 2)** – Full React doctor portal: triage dashboard, patient detail w/ live charts, chat UI, prescription writer.
- **P1** – Normalize API response keys (`id` instead of `_id` everywhere).
- **P1** – Replace `value_plain` with searchable index store, drop plaintext for full HIPAA mode.
- **P2** – Expo mobile (delegated to a specialist).
- **P2** – Audit log review UI, password reset flow, refresh tokens.
- **P2** – Twilio SMS critical alert (parked: post-MVP enhancement).
