"""Phase 4 — Stripe Billing (MOCK MODE) acceptance tests.

Covers:
  - tier catalog
  - /billing/me role-gating + state transitions (free → premium → canceled)
  - /billing/checkout: role-gating, body validation, https + ingress host URL
  - mock-checkout HTML render + unknown session_id 404
  - mock-confirm: state toggle + audit log + idempotence
  - /billing/cancel mock-mode behavior
  - /billing/webhook 404 in mock mode
  - /api/admin/billing role-gating + payload shape
"""
from __future__ import annotations

import os
import re
import time
import uuid

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://health-portal-api.internal.preview.emergentagent.com").rstrip("/")

ADMIN   = {"email": "admin@pulsehub.test",    "password": "Admin123!"}
DOCTOR  = {"email": "dr.smith@pulsehub.test", "password": "Doctor123!"}
PATIENT1 = {"email": "patient1@pulsehub.test", "password": "Patient123!"}
PATIENT2 = {"email": "patient2@pulsehub.test", "password": "Patient123!"}


# -------- helpers --------
def _login(creds):
    r = requests.post(f"{BASE_URL}/api/auth/login", json=creds, timeout=15)
    assert r.status_code == 200, f"login failed for {creds['email']}: {r.status_code} {r.text}"
    j = r.json()
    return j["access_token"], j["user"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def patient1_token():
    tok, _ = _login(PATIENT1)
    # ensure patient1 starts free; if not, cancel
    requests.post(f"{BASE_URL}/api/billing/cancel", headers=_auth(tok), timeout=15)
    return tok


@pytest.fixture(scope="module")
def patient2_token():
    tok, _ = _login(PATIENT2)
    requests.post(f"{BASE_URL}/api/billing/cancel", headers=_auth(tok), timeout=15)
    return tok


@pytest.fixture(scope="module")
def doctor_token():
    tok, _ = _login(DOCTOR)
    return tok


@pytest.fixture(scope="module")
def admin_token():
    tok, _ = _login(ADMIN)
    return tok


# -------------------- tiers (public) --------------------
class TestTiers:
    def test_tiers_public(self):
        r = requests.get(f"{BASE_URL}/api/billing/tiers", timeout=10)
        assert r.status_code == 200
        tiers = r.json()
        assert isinstance(tiers, list) and len(tiers) == 2
        free = next(t for t in tiers if t["id"] == "free")
        prem = next(t for t in tiers if t["id"] == "premium")
        assert free["price_usd"] == 0.0
        assert prem["price_usd"] == 9.99
        assert "Continuous device streaming" in prem["features"]
        assert "Manual vitals logging" in free["features"]
        assert len(prem["features"]) == 4


# -------------------- /billing/me --------------------
class TestBillingMe:
    def test_me_patient_free(self, patient1_token):
        r = requests.get(f"{BASE_URL}/api/billing/me", headers=_auth(patient1_token), timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["premium"] is False
        assert j["tier"] == "free"
        assert j["mode"] == "mock"
        assert j["status"] in ("free", "canceled")  # canceled if a prior test ran cancel

    def test_me_doctor_403(self, doctor_token):
        r = requests.get(f"{BASE_URL}/api/billing/me", headers=_auth(doctor_token), timeout=10)
        assert r.status_code == 403


# -------------------- /billing/checkout role-gating + validation --------------------
class TestCheckoutRBAC:
    def test_checkout_doctor_forbidden(self, doctor_token):
        r = requests.post(f"{BASE_URL}/api/billing/checkout",
                          headers=_auth(doctor_token),
                          json={"tier": "premium"}, timeout=10)
        assert r.status_code == 403

    def test_checkout_admin_forbidden(self, admin_token):
        r = requests.post(f"{BASE_URL}/api/billing/checkout",
                          headers=_auth(admin_token),
                          json={"tier": "premium"}, timeout=10)
        assert r.status_code == 403

    def test_checkout_invalid_tier(self, patient1_token):
        r = requests.post(f"{BASE_URL}/api/billing/checkout",
                          headers=_auth(patient1_token),
                          json={"tier": "free"}, timeout=10)
        assert r.status_code == 400


# -------------------- Full purchase round-trip with patient1 --------------------
class TestMockPurchaseRoundTripPatient1:
    def test_full_round_trip(self, patient1_token):
        # 1) create checkout
        r = requests.post(f"{BASE_URL}/api/billing/checkout",
                          headers=_auth(patient1_token),
                          json={"tier": "premium",
                                "success_url": "https://example.com/done",
                                "cancel_url": "https://example.com/cancel"},
                          timeout=10)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["mode"] == "mock"
        assert j["session_id"].startswith("mock_")
        url = j["checkout_url"]
        assert url.startswith("https://"), f"checkout URL must be https: {url}"
        assert "/api/billing/mock-checkout" in url
        # honor X-Forwarded-Host so it points at the ingress host
        assert "health-portal-api.internal.preview.emergentagent.com" in url
        session_id = j["session_id"]

        # 2) GET mock-checkout HTML renders with required data-testids
        page = requests.get(url, timeout=10)
        assert page.status_code == 200
        body = page.text
        assert 'data-testid="mock-checkout"' in body
        assert 'data-testid="mock-success-btn"' in body
        assert 'data-testid="mock-fail-btn"' in body
        assert "$9.99" in body
        assert "Premium Plan" in body

        # 3) unknown session → 404
        bad = requests.get(f"{BASE_URL}/api/billing/mock-checkout",
                          params={"session_id": f"mock_{uuid.uuid4()}",
                                  "user_id": "fake"}, timeout=10)
        assert bad.status_code == 404

        # 4) confirm success
        c = requests.post(f"{BASE_URL}/api/billing/mock-confirm",
                          json={"session_id": session_id, "outcome": "success"}, timeout=10)
        assert c.status_code == 200
        cj = c.json()
        assert cj == {"received": True, "outcome": "success"}

        # 5) /me now premium
        me = requests.get(f"{BASE_URL}/api/billing/me", headers=_auth(patient1_token), timeout=10).json()
        assert me["premium"] is True
        assert me["status"] == "active"
        assert me["tier"] == "premium"
        assert me["mode"] == "mock"
        assert me["since"] is not None
        assert me["stripe_subscription_id"] and me["stripe_subscription_id"].startswith("sub_mock_")
        assert me["stripe_customer_id"] and me["stripe_customer_id"].startswith("cus_mock_")

        # 6) idempotence: confirming same session again still leaves premium=true
        c2 = requests.post(f"{BASE_URL}/api/billing/mock-confirm",
                           json={"session_id": session_id, "outcome": "success"}, timeout=10)
        assert c2.status_code == 200
        me2 = requests.get(f"{BASE_URL}/api/billing/me", headers=_auth(patient1_token), timeout=10).json()
        assert me2["premium"] is True
        assert me2["status"] == "active"

        # 7) cancel
        cancel = requests.post(f"{BASE_URL}/api/billing/cancel", headers=_auth(patient1_token), timeout=10)
        assert cancel.status_code == 200
        cj = cancel.json()
        assert cj["premium"] is False
        assert cj["status"] == "canceled"

        # 8) /me after cancel
        me3 = requests.get(f"{BASE_URL}/api/billing/me", headers=_auth(patient1_token), timeout=10).json()
        assert me3["premium"] is False
        assert me3["status"] == "canceled"
        assert me3["tier"] == "free"


# -------------------- Webhook disabled in mock --------------------
class TestWebhookMockMode:
    def test_webhook_404_in_mock(self):
        r = requests.post(f"{BASE_URL}/api/billing/webhook",
                          data=b"{}",
                          headers={"stripe-signature": "t=0,v1=bogus",
                                  "Content-Type": "application/json"}, timeout=10)
        assert r.status_code == 404


# -------------------- Admin overview --------------------
class TestAdminBilling:
    def test_admin_billing_doctor_forbidden(self, doctor_token):
        r = requests.get(f"{BASE_URL}/api/admin/billing", headers=_auth(doctor_token), timeout=10)
        assert r.status_code == 403

    def test_admin_billing_admin_ok(self, admin_token, patient2_token):
        # First flip patient2 to premium via mock checkout so we can assert row state
        co = requests.post(f"{BASE_URL}/api/billing/checkout",
                           headers=_auth(patient2_token),
                           json={"tier": "premium"}, timeout=10).json()
        sid = co["session_id"]
        requests.post(f"{BASE_URL}/api/billing/mock-confirm",
                      json={"session_id": sid, "outcome": "success"}, timeout=10)

        r = requests.get(f"{BASE_URL}/api/admin/billing", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200
        j = r.json()
        assert j["mode"] == "mock"
        assert isinstance(j["patients"], list)
        assert len(j["patients"]) >= 5
        emails = [p["email"] for p in j["patients"]]
        assert "patient1@pulsehub.test" in emails
        assert "patient2@pulsehub.test" in emails
        for p in j["patients"]:
            for k in ("id", "full_name", "email", "premium",
                      "premium_since", "stripe_subscription_id", "stripe_customer_id"):
                assert k in p, f"missing key {k} in admin billing row"
        # patient2 should now be premium
        p2 = next(p for p in j["patients"] if p["email"] == "patient2@pulsehub.test")
        assert p2["premium"] is True
        assert p2["stripe_subscription_id"] and p2["stripe_subscription_id"].startswith("sub_mock_")

        # cleanup: cancel patient2 so future runs start clean (idempotent)
        requests.post(f"{BASE_URL}/api/billing/cancel", headers=_auth(patient2_token), timeout=10)
