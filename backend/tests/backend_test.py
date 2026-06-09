"""PulseHub Phase 0 backend regression tests.

Covers: auth (login/me), patients (RBAC), vitals (RBAC + classify boundaries +
encryption), prescriptions (RBAC), OpenAPI, Mongo verification, and seed
verification. WebSocket tests run via localhost:8001.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import pytest
import requests
import websockets
from dotenv import load_dotenv

# Load backend .env so MONGO_URL / DB_NAME are available for Mongo checks
ROOT = Path("/app/backend")
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(ROOT))

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else None
if not BASE_URL:
    # Read from frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break

WS_BASE = "ws://localhost:8001"  # WebSockets via localhost as instructed

CREDS = {
    "admin":   ("admin@pulsehub.test",   "Admin123!"),
    "smith":   ("dr.smith@pulsehub.test", "Doctor123!"),
    "jones":   ("dr.jones@pulsehub.test", "Doctor123!"),
    "p1":      ("patient1@pulsehub.test", "Patient123!"),
    "p2":      ("patient2@pulsehub.test", "Patient123!"),
    "p3":      ("patient3@pulsehub.test", "Patient123!"),
    "p4":      ("patient4@pulsehub.test", "Patient123!"),
    "p5":      ("patient5@pulsehub.test", "Patient123!"),
}


# ============================================================
# Fixtures
# ============================================================
@pytest.fixture(scope="session")
def tokens():
    """Login all seed accounts once, return {key: (token, user_dict)}."""
    out = {}
    for key, (email, pw) in CREDS.items():
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": pw}, timeout=15)
        assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
        body = r.json()
        assert "access_token" in body and "user" in body
        out[key] = (body["access_token"], body["user"])
    return out


def H(token):
    return {"Authorization": f"Bearer {token}"}


# ============================================================
# Auth
# ============================================================
class TestAuth:
    def test_login_returns_token_and_role(self, tokens):
        # Spot-check three role types
        assert tokens["admin"][1]["role"] == "admin"
        assert tokens["smith"][1]["role"] == "doctor"
        assert tokens["p1"][1]["role"] == "patient"
        for key in CREDS:
            tok, user = tokens[key]
            assert isinstance(tok, str) and len(tok) > 20
            assert user["email"] == CREDS[key][0]

    def test_login_bad_password(self):
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": "admin@pulsehub.test", "password": "WRONG"})
        assert r.status_code == 401

    def test_me_with_token(self, tokens):
        tok, user = tokens["smith"]
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=H(tok))
        assert r.status_code == 200
        assert r.json()["email"] == "dr.smith@pulsehub.test"
        assert r.json()["role"] == "doctor"

    def test_me_without_token(self):
        r = requests.get(f"{BASE_URL}/api/auth/me")
        assert r.status_code == 401


# ============================================================
# OpenAPI
# ============================================================
class TestOpenAPI:
    def test_openapi_json(self):
        r = requests.get(f"{BASE_URL}/api/openapi.json")
        assert r.status_code == 200
        body = r.json()
        assert "paths" in body
        # Spot check some paths exist
        assert "/api/auth/login" in body["paths"]
        assert "/api/patients" in body["paths"]


# ============================================================
# Patients RBAC
# ============================================================
class TestPatients:
    def test_admin_sees_all_5(self, tokens):
        tok, _ = tokens["admin"]
        r = requests.get(f"{BASE_URL}/api/patients", headers=H(tok))
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 5
        emails = {p["email"] for p in data}
        assert emails == {f"patient{i}@pulsehub.test" for i in range(1, 6)}

    def test_smith_sees_3(self, tokens):
        tok, _ = tokens["smith"]
        r = requests.get(f"{BASE_URL}/api/patients", headers=H(tok))
        assert r.status_code == 200
        emails = {p["email"] for p in r.json()}
        assert emails == {f"patient{i}@pulsehub.test" for i in (1, 2, 3)}

    def test_jones_sees_2(self, tokens):
        tok, _ = tokens["jones"]
        r = requests.get(f"{BASE_URL}/api/patients", headers=H(tok))
        assert r.status_code == 200
        emails = {p["email"] for p in r.json()}
        assert emails == {"patient4@pulsehub.test", "patient5@pulsehub.test"}

    def test_patient_forbidden_list(self, tokens):
        tok, _ = tokens["p1"]
        r = requests.get(f"{BASE_URL}/api/patients", headers=H(tok))
        assert r.status_code == 403

    def test_get_patient_admin_can_fetch_any(self, tokens):
        admin_tok = tokens["admin"][0]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.get(f"{BASE_URL}/api/patients/{p1_id}", headers=H(admin_tok))
        assert r.status_code == 200
        body = r.json()
        assert "latest" in body and isinstance(body["latest"], dict)
        assert body["risk_level"] in ("normal", "warning", "critical")
        assert "vitals_30d" in body and isinstance(body["vitals_30d"], list)

    def test_doctor_assigned_patient_ok(self, tokens):
        smith_tok = tokens["smith"][0]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.get(f"{BASE_URL}/api/patients/{p1_id}", headers=H(smith_tok))
        assert r.status_code == 200

    def test_doctor_unassigned_patient_403(self, tokens):
        smith_tok = tokens["smith"][0]
        p4_id = tokens["p4"][1]["_id"]
        r = requests.get(f"{BASE_URL}/api/patients/{p4_id}", headers=H(smith_tok))
        assert r.status_code == 403

    def test_patient_own_ok(self, tokens):
        p1_tok = tokens["p1"][0]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.get(f"{BASE_URL}/api/patients/{p1_id}", headers=H(p1_tok))
        assert r.status_code == 200

    def test_patient_other_403(self, tokens):
        p1_tok = tokens["p1"][0]
        p2_id = tokens["p2"][1]["_id"]
        r = requests.get(f"{BASE_URL}/api/patients/{p2_id}", headers=H(p1_tok))
        assert r.status_code == 403


# ============================================================
# Vitals - severity classification + RBAC
# ============================================================
class TestVitals:
    @pytest.mark.parametrize("metric,value,expected", [
        ("glucose", 53, "critical"),
        ("glucose", 70, "warning"),
        ("glucose", 71, "normal"),
        ("glucose", 181, "warning"),
        ("glucose", 251, "critical"),
        ("hr", 39, "critical"),
        ("hr", 50, "warning"),
        ("hr", 100, "normal"),
        ("hr", 121, "critical"),
        ("spo2", 89, "critical"),
        ("spo2", 94, "warning"),
        ("spo2", 95, "normal"),
    ])
    def test_severity_boundaries(self, tokens, metric, value, expected):
        smith_tok = tokens["smith"][0]
        p1_id = tokens["p1"][1]["_id"]
        device = "cgm" if metric == "glucose" else "pulseox"
        r = requests.post(f"{BASE_URL}/api/vitals", headers=H(smith_tok),
                          json={"patient_id": p1_id, "device": device,
                                "metric": metric, "value": value})
        assert r.status_code == 200, r.text
        assert r.json()["severity"] == expected, f"{metric}={value} → {r.json()}"

    def test_doctor_unassigned_403(self, tokens):
        smith_tok = tokens["smith"][0]
        p4_id = tokens["p4"][1]["_id"]
        r = requests.post(f"{BASE_URL}/api/vitals", headers=H(smith_tok),
                          json={"patient_id": p4_id, "device": "cgm",
                                "metric": "glucose", "value": 100})
        assert r.status_code == 403

    def test_patient_post_other_403(self, tokens):
        p1_tok = tokens["p1"][0]
        p2_id = tokens["p2"][1]["_id"]
        r = requests.post(f"{BASE_URL}/api/vitals", headers=H(p1_tok),
                          json={"patient_id": p2_id, "device": "cgm",
                                "metric": "glucose", "value": 100})
        assert r.status_code == 403

    def test_patient_post_self_200(self, tokens):
        p1_tok = tokens["p1"][0]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.post(f"{BASE_URL}/api/vitals", headers=H(p1_tok),
                          json={"patient_id": p1_id, "device": "cgm",
                                "metric": "glucose", "value": 100})
        assert r.status_code == 200

    def test_get_vitals_decrypts_value(self, tokens):
        smith_tok = tokens["smith"][0]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.get(f"{BASE_URL}/api/vitals/{p1_id}?metric=glucose&limit=5",
                         headers=H(smith_tok))
        assert r.status_code == 200
        items = r.json()
        assert len(items) > 0
        for v in items:
            assert isinstance(v["value"], (int, float))
            assert v["metric"] == "glucose"

    def test_get_vitals_doctor_unassigned_403(self, tokens):
        smith_tok = tokens["smith"][0]
        p4_id = tokens["p4"][1]["_id"]
        r = requests.get(f"{BASE_URL}/api/vitals/{p4_id}", headers=H(smith_tok))
        assert r.status_code == 403


# ============================================================
# Mongo direct verification - encryption + seed counts
# ============================================================
class TestMongoVerify:
    def test_vitals_field_is_encrypted(self):
        from motor.motor_asyncio import AsyncIOMotorClient

        async def check():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            v = await db.vitals.find_one()
            client.close()
            return v
        v = asyncio.get_event_loop().run_until_complete(check()) if not asyncio.get_event_loop().is_running() else None
        if v is None:
            # fall back to a fresh loop
            v = asyncio.new_event_loop().run_until_complete(check())
        assert v is not None
        assert isinstance(v["value"], str), "value should be base64 string"
        # Ensure NOT a number
        try:
            float(v["value"])
            is_num = True
        except Exception:
            is_num = False
        # Could conceivably parse but value should NOT be a number type
        assert not isinstance(v["value"], (int, float))
        assert isinstance(v["value_plain"], (int, float))
        assert v["severity"] in ("normal", "warning", "critical")

    def test_seed_counts(self):
        from motor.motor_asyncio import AsyncIOMotorClient

        async def check():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            users = await db.users.count_documents({})
            admins = await db.users.count_documents({"role": "admin"})
            doctors = await db.users.count_documents({"role": "doctor"})
            patients = await db.users.count_documents({"role": "patient"})
            vitals = await db.vitals.count_documents({})
            client.close()
            return users, admins, doctors, patients, vitals
        users, admins, doctors, patients, vitals = asyncio.new_event_loop().run_until_complete(check())
        assert users == 8
        assert admins == 1
        assert doctors == 2
        assert patients == 5
        # Seed makes 30d * 5 patients * 24 readings ~ 3600. Tests can add more.
        assert vitals >= 3000, f"expected >=3000 vitals, got {vitals}"


# ============================================================
# Prescriptions RBAC
# ============================================================
class TestPrescriptions:
    def test_patient_read_own_ok(self, tokens):
        p1_tok = tokens["p1"][0]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.get(f"{BASE_URL}/api/prescriptions/{p1_id}", headers=H(p1_tok))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_doctor_read_assigned_ok(self, tokens):
        smith_tok = tokens["smith"][0]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.get(f"{BASE_URL}/api/prescriptions/{p1_id}", headers=H(smith_tok))
        assert r.status_code == 200

    def test_doctor_read_unassigned_403(self, tokens):
        smith_tok = tokens["smith"][0]
        p4_id = tokens["p4"][1]["_id"]
        r = requests.get(f"{BASE_URL}/api/prescriptions/{p4_id}", headers=H(smith_tok))
        assert r.status_code == 403

    def test_patient_read_other_403(self, tokens):
        p2_tok = tokens["p2"][0]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.get(f"{BASE_URL}/api/prescriptions/{p1_id}", headers=H(p2_tok))
        assert r.status_code == 403


# ============================================================
# WebSockets
# ============================================================
class TestWebSockets:
    def test_ws_vitals_missing_token_rejected(self):
        async def run():
            try:
                async with websockets.connect(f"{WS_BASE}/api/ws/vitals") as ws:
                    await ws.recv()
                    return "connected"
            except websockets.exceptions.InvalidStatus as e:
                return f"status_{e.response.status_code}"
            except Exception as e:
                return f"err_{type(e).__name__}"
        result = asyncio.new_event_loop().run_until_complete(run())
        # FastAPI returns 403 on missing required query param BEFORE upgrade.
        assert "status_403" in result or "status_400" in result, f"got {result}"

    def test_ws_vitals_ready_and_broadcast(self, tokens):
        smith_tok = tokens["smith"][0]
        p1_id = tokens["p1"][1]["_id"]

        async def run():
            url = f"{WS_BASE}/api/ws/vitals?token={smith_tok}&patient_id={p1_id}"
            async with websockets.connect(url) as ws:
                # First message: ready
                first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert first["type"] == "ready"
                # Post a vital → should broadcast
                r = requests.post(f"{BASE_URL}/api/vitals", headers=H(smith_tok),
                                  json={"patient_id": p1_id, "device": "cgm",
                                        "metric": "glucose", "value": 100})
                assert r.status_code == 200
                event = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert event["type"] == "vital"
                assert event["patient_id"] == p1_id
        asyncio.new_event_loop().run_until_complete(run())

    def test_ws_chat_echo(self, tokens):
        smith_tok = tokens["smith"][0]
        p1_id = tokens["p1"][1]["_id"]
        thread = "t-test-1"

        async def run():
            url = f"{WS_BASE}/api/ws/chat/{thread}?token={smith_tok}"
            async with websockets.connect(url) as ws:
                first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert first["type"] == "joined"
                await ws.send(json.dumps({"recipient_id": p1_id, "content": "hello"}))
                event = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert event["type"] == "message"
                assert event["content"] == "hello"
        asyncio.new_event_loop().run_until_complete(run())

    def test_ws_chat_missing_token_rejected(self):
        async def run():
            try:
                async with websockets.connect(f"{WS_BASE}/api/ws/chat/abc") as ws:
                    await ws.recv()
                    return "connected"
            except websockets.exceptions.InvalidStatus as e:
                return f"status_{e.response.status_code}"
            except Exception as e:
                return f"err_{type(e).__name__}"
        result = asyncio.new_event_loop().run_until_complete(run())
        assert "status_403" in result or "status_400" in result, f"got {result}"


# ============================================================
# Auto-seed idempotence
# ============================================================
class TestSeedIdempotence:
    def test_run_seed_skips_when_users_exist(self):
        from motor.motor_asyncio import AsyncIOMotorClient
        from seed import run_seed

        async def check():
            client = AsyncIOMotorClient(os.environ["MONGO_URL"])
            db = client[os.environ["DB_NAME"]]
            before_users = await db.users.count_documents({})
            result = await run_seed(db, force=False)
            after_users = await db.users.count_documents({})
            client.close()
            return before_users, after_users, result

        before, after, result = asyncio.new_event_loop().run_until_complete(check())
        assert before == after, "users count must not change on re-seed"
        assert result.get("skipped") is True, f"expected skipped, got {result}"
