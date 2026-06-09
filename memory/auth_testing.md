# PulseHub – Auth Testing Guide

This document tells the **testing agent** how to authenticate against the PulseHub API and UI.

## API authentication

The API uses **JWT Bearer tokens** (HS256). There are **no httpOnly cookies** required.

### Step 1 — Login
```
POST {BASE}/api/auth/login
Content-Type: application/json

{ "email": "<email>", "password": "<password>" }
```
Response:
```json
{ "access_token": "<jwt>", "token_type": "bearer", "user": { ... } }
```

### Step 2 — Authenticated request
Add the header:
```
Authorization: Bearer <jwt>
```

### Step 3 — Confirm user
```
GET {BASE}/api/auth/me
```
should return the user object whose role drives access control.

## Roles & access matrix

| Endpoint                              | patient | doctor                                 | admin |
|---------------------------------------|---------|----------------------------------------|-------|
| GET  /api/patients                    | 403     | 200 (only assigned patients)           | 200   |
| GET  /api/patients/{id}               | self    | only assigned                          | any   |
| POST /api/vitals                      | self    | only assigned                          | any   |
| GET  /api/vitals/{patient_id}         | self    | only assigned                          | any   |
| POST /api/prescriptions               | 403     | only assigned                          | 403   |
| GET  /api/prescriptions/{patient_id}  | self    | only assigned                          | n/a*  |
| POST /api/auth/register role=doctor   | 403     | 403                                    | 200   |

*Admin is not explicitly required for read; doctors can read prescriptions for assigned patients.

## WebSocket auth

Pass the JWT as a **query parameter** at handshake time:

```
ws://<host>/api/ws/vitals?token=<jwt>[&patient_id=<id>]
ws://<host>/api/ws/chat/<thread_id>?token=<jwt>
```

A missing / invalid token closes the connection with code `1008`.

## Credentials to use during tests
See `/app/memory/test_credentials.md` — pick any of the seeded accounts.

## Common boundary cases to test severity classification

| metric  | value | expected severity |
|---------|-------|-------------------|
| glucose | 53    | critical          |
| glucose | 70    | warning           |
| glucose | 71    | normal            |
| glucose | 180   | normal            |
| glucose | 181   | warning           |
| glucose | 251   | critical          |
| hr      | 39    | critical          |
| hr      | 50    | warning           |
| hr      | 100   | normal            |
| hr      | 121   | critical          |
| spo2    | 89    | critical          |
| spo2    | 94    | warning           |
| spo2    | 95    | normal            |
