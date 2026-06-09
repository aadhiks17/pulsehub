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
- `/app/backend/hipaa_utils.py` – AES-GCM encrypt/decrypt + `require_role`.
- `/app/backend/auth.py` – bcrypt + JWT + `get_current_user` / WS token resolver.
- `/app/backend/risk.py` – severity classifier.
- `/app/backend/models.py` – Pydantic models.
- `/app/backend/seed.py` – seed runner; auto-runs on first boot.
- `/app/backend/server.py` – endpoints, WebSocket hubs, audit log, indexes.
- `/app/frontend/src/App.js` – minimal Phase 0 placeholder landing page.
- `/app/memory/test_credentials.md`, `/app/memory/auth_testing.md`.

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
- **P0 (Phase 1)** – CGM/PulseOx emulator producing live vitals into WS; chat persistence read endpoint; admin doctor-creation UI.
- **P1 (Phase 2)** – Full React doctor portal: triage dashboard, patient detail w/ live charts, chat UI, prescription writer.
- **P1** – Replace `value_plain` with searchable index store, drop plaintext for full HIPAA mode.
- **P2** – Expo mobile (delegated to a specialist).
- **P2** – Audit log review UI, password reset flow, refresh tokens.
