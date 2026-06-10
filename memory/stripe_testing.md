# PulseHub — Stripe Billing Testing Guide

## Mode detection

The billing module engages **MOCK mode** unless ALL three env vars in
`/app/backend/.env` look like real Stripe test/live keys:

| Env var                  | Required format                              |
|--------------------------|----------------------------------------------|
| `STRIPE_SECRET_KEY`      | `^sk_(test|live)_[A-Za-z0-9]{20,}$`          |
| `STRIPE_WEBHOOK_SECRET`  | `^whsec_[A-Za-z0-9]{20,}$`                   |
| `STRIPE_PRICE_PREMIUM`   | `^price_[A-Za-z0-9]{20,}$` (recurring price) |

Anything else → MOCK mode. Boot log line tells you which mode is active:
```
[STRIPE] MOCK MODE — set real keys … to enable live integration
[STRIPE] LIVE MODE — real Stripe SDK calls enabled
```

## Endpoints

| Method | Path                                | Auth        | Mode-aware |
|--------|-------------------------------------|-------------|------------|
| GET    | `/api/billing/tiers`                | public      | both       |
| GET    | `/api/billing/me`                   | patient     | both       |
| POST   | `/api/billing/checkout`             | patient     | both       |
| GET    | `/api/billing/mock-checkout`        | public HTML | mock only  |
| POST   | `/api/billing/mock-confirm`         | public      | mock only  |
| GET    | `/api/billing/mock-result`          | public HTML | mock only  |
| POST   | `/api/billing/webhook`              | signature   | live only  |
| POST   | `/api/billing/cancel`               | patient     | both       |
| GET    | `/api/admin/billing`                | admin       | both       |

## Mock flow (current default)

1. Patient logs in → `POST /api/billing/checkout {tier:"premium"}`.
2. Backend returns `{checkout_url, session_id: "mock_<uuid>", mode: "mock"}`.
3. Patient (or test) opens `checkout_url` → a small HTML page renders the Premium card.
4. "Simulate Successful Payment" → `POST /api/billing/mock-confirm` →
   the same `_set_premium(on=True)` codepath a real `checkout.session.completed`
   webhook would run. `users.premium=true`, `audit_log` entry written.
5. Page redirects to the caller-supplied `success_url` (or
   `/api/billing/mock-result?status=success` by default).
6. `GET /api/billing/me` now reports `{premium:true, status:"active", since:<ts>, ...}`.
7. `POST /api/billing/cancel` flips premium back to false (audit log entry).

## Live flow (when real keys are added)

1. Same `POST /api/billing/checkout` — backend creates a Stripe Checkout Session
   in `mode=subscription` with `line_items=[{price: STRIPE_PRICE_PREMIUM, qty:1}]`
   and `client_reference_id=user._id`. Returns Stripe's hosted checkout URL.
2. Patient completes payment on Stripe's domain.
3. Stripe posts to `POST /api/billing/webhook`. The handler verifies the
   `Stripe-Signature` header against `STRIPE_WEBHOOK_SECRET`, then handles:
   - `checkout.session.completed`        → premium ON
   - `customer.subscription.deleted`     → premium OFF
   - `invoice.payment_failed`            → premium OFF (after Stripe retries)
   - `customer.subscription.updated`     → stores `stripe_subscription_status`
4. `POST /api/billing/cancel` calls `Subscription.delete(...)`. The premium flag
   then flips off when Stripe fires the deletion webhook.

## Audit log entries

Every premium toggle and checkout initiation writes to `audit_log`:
```
{ actor_id: "<user_id>" or "stripe-webhook",
  action: "checkout_initiated" | "premium_enabled" | "premium_disabled",
  target: "<user_id>",
  timestamp: "<iso>",
  metadata: { session_id, subscription_id, mode } }
```

## How to flip to LIVE mode

```
# /app/backend/.env
STRIPE_SECRET_KEY="sk_test_REAL..."
STRIPE_WEBHOOK_SECRET="whsec_REAL..."
STRIPE_PRICE_PREMIUM="price_REAL..."
```
Restart backend (`sudo supervisorctl restart backend`). Verify the boot log line.

Stripe webhook endpoint to register in the dashboard:
`https://<your-host>/api/billing/webhook`
Events to subscribe to: `checkout.session.completed`, `customer.subscription.deleted`,
`customer.subscription.updated`, `invoice.payment_failed`.
