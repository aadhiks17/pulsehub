"""PulseHub billing module — Stripe Checkout (subscription) with a MOCK fallback path.

Mode detection
--------------
`live` mode requires all three env vars to look like real Stripe test/live keys:
    STRIPE_SECRET_KEY      matches  ^sk_(test|live)_[A-Za-z0-9]{20,}$
    STRIPE_WEBHOOK_SECRET  matches  ^whsec_[A-Za-z0-9]{20,}$
    STRIPE_PRICE_PREMIUM   matches  ^price_[A-Za-z0-9]{20,}$

Anything else (empty, placeholder like `sk_test_emergent`, etc) → MOCK_MODE.

In MOCK mode:
- POST /api/billing/checkout returns a backend-hosted mock-checkout URL.
- GET  /api/billing/mock-checkout renders a tiny HTML page with success/fail buttons.
- POST /api/billing/mock-confirm fires the SAME premium-toggle code path as a real
  Stripe `checkout.session.completed` event would.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel

logger = logging.getLogger("pulsehub.billing")


# --------------------------------------------------------------------
# Mode detection
# --------------------------------------------------------------------
_SK_RE    = re.compile(r"^sk_(test|live)_[A-Za-z0-9]{20,}$")
_WHSEC_RE = re.compile(r"^whsec_[A-Za-z0-9]{20,}$")
_PRICE_RE = re.compile(r"^price_[A-Za-z0-9]{20,}$")

STRIPE_SECRET_KEY     = os.environ.get("STRIPE_SECRET_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_PRICE_PREMIUM  = os.environ.get("STRIPE_PRICE_PREMIUM", "")
PREMIUM_TIER_PRICE_USD = float(os.environ.get("PREMIUM_TIER_PRICE_USD", "9.99"))

LIVE_MODE = bool(
    _SK_RE.match(STRIPE_SECRET_KEY)
    and _WHSEC_RE.match(STRIPE_WEBHOOK_SECRET)
    and _PRICE_RE.match(STRIPE_PRICE_PREMIUM)
)
MOCK_MODE = not LIVE_MODE

# Lazily import stripe SDK only when live (it's a heavy import + makes calls on first use)
_stripe = None
if LIVE_MODE:
    import stripe as _stripe  # type: ignore
    _stripe.api_key = STRIPE_SECRET_KEY
    logger.info("[STRIPE] LIVE MODE — real Stripe SDK calls enabled")
else:
    logger.info("[STRIPE] MOCK MODE — set real keys (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PREMIUM) in .env to enable live integration")


# --------------------------------------------------------------------
# Static tier catalog
# --------------------------------------------------------------------
TIERS = [
    {
        "id": "free", "name": "Free", "price_usd": 0.0,
        "features": [
            "Manual vitals logging",
            "View prescriptions",
            "Read-only data feed",
        ],
    },
    {
        "id": "premium", "name": "Premium", "price_usd": PREMIUM_TIER_PRICE_USD,
        "features": [
            "Continuous device streaming",
            "Real-time doctor chat",
            "Priority triage",
            "Full analytics",
        ],
    },
]


# --------------------------------------------------------------------
# Request models
# --------------------------------------------------------------------
class CheckoutBody(BaseModel):
    tier: str = "premium"
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


# --------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------
def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _set_premium(db, user_id: str, *, on: bool, session_id: Optional[str] = None,
                       subscription_id: Optional[str] = None, customer_id: Optional[str] = None,
                       mode: str = "mock") -> dict:
    """Idempotently toggle a user's premium state and write an audit entry."""
    user = await db.users.find_one({"_id": user_id})
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    update: dict = {"premium": on}
    if on:
        update["premium_since"] = _now()
        if subscription_id: update["stripe_subscription_id"] = subscription_id
        if customer_id:     update["stripe_customer_id"] = customer_id
        update.pop("premium_canceled_at", None)
    else:
        update["premium_canceled_at"] = _now()

    await db.users.update_one({"_id": user_id}, {"$set": update})

    await db.audit_log.insert_one({
        "_id": str(uuid.uuid4()),
        "actor_id": "stripe-webhook",
        "action": "premium_enabled" if on else "premium_disabled",
        "target": user_id,
        "timestamp": _now(),
        "ip": None,
        "metadata": {"session_id": session_id, "subscription_id": subscription_id, "mode": mode},
    })
    return {"user_id": user_id, "premium": on}


# --------------------------------------------------------------------
# Router factory — needs `db` injected via main app
# --------------------------------------------------------------------
def make_router(db, get_current_user) -> APIRouter:
    router = APIRouter(prefix="/api/billing", tags=["billing"])

    # -------- tiers (public) --------
    @router.get("/tiers")
    async def list_tiers():
        return TIERS

    # -------- /me --------
    @router.get("/me")
    async def billing_me(user: dict = Depends(get_current_user)):
        if user["role"] != "patient":
            raise HTTPException(status_code=403, detail="Patient only")
        u = await db.users.find_one({"_id": user["_id"]})
        return {
            "premium": bool(u.get("premium")),
            "since": u.get("premium_since"),
            "status": "active" if u.get("premium") else ("canceled" if u.get("premium_canceled_at") else "free"),
            "stripe_subscription_id": u.get("stripe_subscription_id"),
            "stripe_customer_id": u.get("stripe_customer_id"),
            "tier": "premium" if u.get("premium") else "free",
            "mode": "live" if LIVE_MODE else "mock",
        }

    # -------- create checkout session --------
    @router.post("/checkout")
    async def create_checkout(body: CheckoutBody, request: Request, user: dict = Depends(get_current_user)):
        if user["role"] != "patient":
            raise HTTPException(status_code=403, detail="Patient only")
        if body.tier != "premium":
            raise HTTPException(status_code=400, detail="Only 'premium' tier is purchasable")

        await db.audit_log.insert_one({
            "_id": str(uuid.uuid4()),
            "actor_id": user["_id"],
            "action": "checkout_initiated",
            "target": user["_id"],
            "timestamp": _now(),
            "ip": request.client.host if request.client else None,
            "metadata": {"tier": body.tier, "mode": "live" if LIVE_MODE else "mock"},
        })

        if LIVE_MODE:
            try:
                session = _stripe.checkout.Session.create(
                    mode="subscription",
                    line_items=[{"price": STRIPE_PRICE_PREMIUM, "quantity": 1}],
                    client_reference_id=user["_id"],
                    metadata={"user_id": user["_id"], "tier": "premium"},
                    success_url=body.success_url or "https://pulsehub.local/billing/success?session_id={CHECKOUT_SESSION_ID}",
                    cancel_url=body.cancel_url  or "https://pulsehub.local/billing/cancel",
                )
            except Exception as e:
                logger.exception("stripe checkout failed")
                raise HTTPException(status_code=502, detail=f"Stripe error: {e}")
            return {"checkout_url": session.url, "session_id": session.id, "mode": "live"}

        # ---- MOCK MODE ----
        session_id = f"mock_{uuid.uuid4()}"
        # Honor X-Forwarded-Proto so HTTPS is preserved through the K8s ingress
        # (FastAPI sees the internal cleartext scheme otherwise).
        proto = request.headers.get("x-forwarded-proto") or request.url.scheme
        host = request.headers.get("x-forwarded-host") or request.url.netloc
        base = f"{proto}://{host}"
        checkout_url = (
            f"{base}/api/billing/mock-checkout"
            f"?session_id={session_id}&user_id={user['_id']}"
        )
        if body.success_url: checkout_url += f"&success_url={body.success_url}"
        if body.cancel_url:  checkout_url += f"&cancel_url={body.cancel_url}"

        await db.billing_sessions.insert_one({
            "_id": session_id,
            "user_id": user["_id"],
            "tier": "premium",
            "status": "pending",
            "mode": "mock",
            "success_url": body.success_url,
            "cancel_url": body.cancel_url,
            "created_at": _now(),
        })
        return {"checkout_url": checkout_url, "session_id": session_id, "mode": "mock"}

    # -------- mock checkout HTML page (mock-mode only) --------
    @router.get("/mock-checkout", response_class=HTMLResponse)
    async def mock_checkout_page(session_id: str, user_id: str,
                                  success_url: Optional[str] = None,
                                  cancel_url: Optional[str] = None):
        if LIVE_MODE:
            raise HTTPException(status_code=404, detail="Not available in live mode")
        # confirm session exists
        sess = await db.billing_sessions.find_one({"_id": session_id})
        if not sess:
            raise HTTPException(status_code=404, detail="Unknown mock session")

        s_url = success_url or sess.get("success_url") or ""
        c_url = cancel_url  or sess.get("cancel_url")  or ""

        html = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>PulseHub Mock Checkout</title>
<style>
  body {{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
          background:#f8fafc; color:#0f172a; margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; }}
  .card {{ background:white; border:1px solid #e2e8f0; border-radius:12px; padding:28px; max-width:480px; width:100%; box-shadow:0 1px 2px rgba(0,0,0,.04); }}
  .brand {{ display:flex; align-items:center; gap:8px; margin-bottom:18px; }}
  .logo {{ width:28px; height:28px; background:#0f172a; color:white; border-radius:6px; display:grid; place-items:center; font-weight:700; }}
  h1 {{ font-size:22px; margin:0 0 4px; letter-spacing:-0.01em; }}
  .sub {{ color:#64748b; font-size:13px; margin-bottom:24px; }}
  .price {{ display:flex; align-items:baseline; gap:6px; margin:16px 0 22px; }}
  .price .amt {{ font-size:34px; font-weight:600; }}
  .price .unit {{ color:#64748b; font-size:14px; }}
  ul {{ padding-left:18px; color:#334155; font-size:14px; line-height:1.7; }}
  .row {{ display:flex; gap:10px; margin-top:22px; }}
  button {{ flex:1; padding:11px 14px; border-radius:8px; font-size:14px; font-weight:600; cursor:pointer; border:none; }}
  .ok {{ background:#0f172a; color:white; }}
  .ok:hover {{ background:#1e293b; }}
  .no {{ background:transparent; color:#475569; border:1px solid #cbd5e1; }}
  .badge {{ display:inline-block; background:#fef3c7; color:#92400e; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; }}
  .status {{ margin-top:14px; font-size:13px; color:#0f766e; min-height:18px; }}
  .err {{ color:#b91c1c; }}
</style></head>
<body>
  <div class="card" data-testid="mock-checkout">
    <div class="brand"><div class="logo">P</div><strong>PulseHub</strong> <span class="badge">Mock Checkout</span></div>
    <h1>Premium Plan</h1>
    <div class="sub">SIMULATED Stripe checkout — set real Stripe keys to use the real flow.</div>

    <div class="price"><span class="amt">${PREMIUM_TIER_PRICE_USD:.2f}</span><span class="unit">/mo · USD</span></div>

    <ul>
      <li>Continuous device streaming</li>
      <li>Real-time doctor chat</li>
      <li>Priority triage</li>
      <li>Full analytics</li>
    </ul>

    <div class="row">
      <button class="ok" id="ok" data-testid="mock-success-btn">Simulate Successful Payment</button>
      <button class="no" id="no" data-testid="mock-fail-btn">Cancel</button>
    </div>
    <div class="status" id="status"></div>
  </div>
<script>
  const SESSION_ID = {session_id!r};
  const USER_ID    = {user_id!r};
  const SUCCESS_URL = {s_url!r};
  const CANCEL_URL  = {c_url!r};
  const status = document.getElementById("status");

  document.getElementById("ok").addEventListener("click", async () => {{
    status.textContent = "Processing payment…";
    try {{
      const res = await fetch("/api/billing/mock-confirm", {{
        method: "POST",
        headers: {{ "Content-Type": "application/json" }},
        body: JSON.stringify({{ session_id: SESSION_ID, outcome: "success" }})
      }});
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "failed");
      status.textContent = "Payment successful. Redirecting…";
      setTimeout(() => {{
        window.location.href = SUCCESS_URL || "/api/billing/mock-result?status=success";
      }}, 600);
    }} catch (e) {{
      status.className = "status err";
      status.textContent = "Error: " + e.message;
    }}
  }});

  document.getElementById("no").addEventListener("click", async () => {{
    await fetch("/api/billing/mock-confirm", {{
      method: "POST",
      headers: {{ "Content-Type": "application/json" }},
      body: JSON.stringify({{ session_id: SESSION_ID, outcome: "cancel" }})
    }});
    window.location.href = CANCEL_URL || "/api/billing/mock-result?status=cancel";
  }});
</script>
</body></html>"""
        return HTMLResponse(content=html)

    # -------- mock confirm: same code path as real webhook --------
    @router.post("/mock-confirm")
    async def mock_confirm(request: Request):
        if LIVE_MODE:
            raise HTTPException(status_code=404, detail="Not available in live mode")
        body = await request.json()
        session_id = body.get("session_id")
        outcome = body.get("outcome", "success")
        sess = await db.billing_sessions.find_one({"_id": session_id})
        if not sess:
            raise HTTPException(status_code=404, detail="Unknown mock session")
        await db.billing_sessions.update_one({"_id": session_id},
            {"$set": {"status": "completed" if outcome == "success" else "canceled",
                      "completed_at": _now()}})
        if outcome == "success":
            await _set_premium(db, sess["user_id"], on=True,
                               session_id=session_id,
                               subscription_id=f"sub_{session_id}",
                               customer_id=f"cus_mock_{sess['user_id']}",
                               mode="mock")
        return {"received": True, "outcome": outcome}

    # -------- mock result landing (when no success_url is provided) --------
    @router.get("/mock-result", response_class=HTMLResponse)
    async def mock_result(status: str = "success"):
        ok = status == "success"
        msg = "Payment successful — you can return to the app." if ok else "Payment cancelled."
        accent = "#0f766e" if ok else "#b91c1c"
        return HTMLResponse(f"""<!doctype html><meta charset="utf-8"/><title>{msg}</title>
<body style="font-family:ui-sans-serif,system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;background:#f8fafc;margin:0;color:#0f172a">
<div data-testid="mock-result-{status}" style="background:white;border:1px solid #e2e8f0;border-radius:12px;padding:32px;max-width:420px;text-align:center">
<div style="font-size:20px;font-weight:600;color:{accent};margin-bottom:8px">{'✓' if ok else '×'} {msg}</div>
<div style="font-size:13px;color:#64748b">You may close this window.</div>
</div></body>""")

    # -------- Stripe webhook (live mode) --------
    @router.post("/webhook")
    async def stripe_webhook(request: Request):
        if not LIVE_MODE:
            # In mock mode we don't accept external webhook traffic — clients use /mock-confirm.
            raise HTTPException(status_code=404, detail="Webhook disabled in mock mode")

        body = await request.body()
        sig = request.headers.get("stripe-signature", "")
        try:
            event = _stripe.Webhook.construct_event(body, sig, STRIPE_WEBHOOK_SECRET)
        except Exception as e:
            logger.warning("invalid stripe webhook signature: %s", e)
            raise HTTPException(status_code=400, detail="Invalid signature")

        et = event["type"]
        obj = event["data"]["object"]

        if et == "checkout.session.completed":
            uid = obj.get("client_reference_id") or (obj.get("metadata") or {}).get("user_id")
            if uid:
                await _set_premium(db, uid, on=True,
                                   session_id=obj.get("id"),
                                   subscription_id=obj.get("subscription"),
                                   customer_id=obj.get("customer"),
                                   mode="live")
        elif et in ("customer.subscription.deleted", "invoice.payment_failed"):
            sub_id = obj.get("id") if et == "customer.subscription.deleted" else (obj.get("subscription") or None)
            if sub_id:
                u = await db.users.find_one({"stripe_subscription_id": sub_id})
                if u:
                    await _set_premium(db, u["_id"], on=False, subscription_id=sub_id, mode="live")
        elif et == "customer.subscription.updated":
            sub_id = obj.get("id")
            status_str = obj.get("status")
            u = await db.users.find_one({"stripe_subscription_id": sub_id})
            if u:
                await db.users.update_one({"_id": u["_id"]}, {"$set": {"stripe_subscription_status": status_str}})

        return {"received": True}

    # -------- cancel --------
    @router.post("/cancel")
    async def cancel_subscription(user: dict = Depends(get_current_user)):
        if user["role"] != "patient":
            raise HTTPException(status_code=403, detail="Patient only")
        u = await db.users.find_one({"_id": user["_id"]})
        if not u.get("premium"):
            return {"premium": False, "status": "free"}

        if LIVE_MODE and u.get("stripe_subscription_id"):
            try:
                _stripe.Subscription.delete(u["stripe_subscription_id"])
            except Exception as e:
                logger.exception("stripe subscription cancel failed")
                raise HTTPException(status_code=502, detail=f"Stripe error: {e}")
            return {"premium": True, "status": "canceling", "stripe_subscription_id": u.get("stripe_subscription_id")}

        # mock: fire the deletion path inline
        await _set_premium(db, user["_id"], on=False,
                           subscription_id=u.get("stripe_subscription_id"),
                           mode="mock")
        return {"premium": False, "status": "canceled"}

    # -------- admin overview --------
    @router.get("/admin/billing", include_in_schema=True)
    async def admin_billing(user: dict = Depends(get_current_user)):
        # Mounted under /api/billing/admin/billing — but spec asks for /api/admin/billing.
        # We expose both for convenience; the router prefix limits this one to /api/billing/admin/billing.
        raise HTTPException(status_code=404, detail="Use /api/admin/billing instead")

    return router


def make_admin_router(db, get_current_user) -> APIRouter:
    """Separate small router for /api/admin/billing because the billing router is
    scoped to /api/billing/* by prefix."""
    r = APIRouter(prefix="/api/admin", tags=["admin-billing"])

    @r.get("/billing")
    async def admin_billing_overview(user: dict = Depends(get_current_user)):
        if user["role"] != "admin":
            raise HTTPException(status_code=403, detail="Admin only")
        cursor = db.users.find({"role": "patient"}).sort("created_at", 1)
        out = []
        async for p in cursor:
            out.append({
                "id": p["_id"],
                "full_name": p["full_name"],
                "email": p["email"],
                "premium": bool(p.get("premium")),
                "premium_since": p.get("premium_since"),
                "premium_canceled_at": p.get("premium_canceled_at"),
                "stripe_subscription_id": p.get("stripe_subscription_id"),
                "stripe_customer_id": p.get("stripe_customer_id"),
                "stripe_subscription_status": p.get("stripe_subscription_status"),
            })
        return {"mode": "live" if LIVE_MODE else "mock", "patients": out}

    return r
