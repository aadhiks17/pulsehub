"""PulseHub Phase 1 backend tests.

Covers:
  - Vitals emulator supervisor program + control surface (localhost:9001)
  - Steady streaming into POST /api/vitals
  - Anomaly triggers (hypo, hyper, hypoxia, bradycardia, tachycardia)
  - WebSocket firehose /api/ws/vitals (vital broadcasts include `device`)
  - System service account (emulator@pulsehub.system) can POST /api/vitals for any patient
  - POST /api/admin/doctors RBAC + creation
  - GET /api/chat/threads + thread messages (encrypted at rest, decrypted on read)
  - Chat thread RBAC (non-participant forbidden, admin allowed)
  - Login throttling (HTTP 429 after 5 fails)
  - Phase 0 sanity checks
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import time
import uuid
from pathlib import Path

import pytest
import requests
import websockets
from dotenv import load_dotenv

ROOT = Path("/app/backend")
load_dotenv(ROOT / ".env")

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"')
                break
BASE_URL = BASE_URL.rstrip("/")
WS_BASE = "ws://localhost:8001"
EMU_CTRL = "http://localhost:9001"
EMULATOR_PASSWORD = os.environ.get("EMULATOR_PASSWORD")

CREDS = {
    "admin": ("admin@pulsehub.test", "Admin123!"),
    "smith": ("dr.smith@pulsehub.test", "Doctor123!"),
    "jones": ("dr.jones@pulsehub.test", "Doctor123!"),
    "p1":    ("patient1@pulsehub.test", "Patient123!"),
}


def _login(email: str, password: str) -> dict:
    r = requests.post(f"{BASE_URL}/api/auth/login",
                      json={"email": email, "password": password}, timeout=15)
    assert r.status_code == 200, f"login {email}: {r.status_code} {r.text}"
    return r.json()


@pytest.fixture(scope="session")
def tokens():
    out = {}
    for k, (email, pw) in CREDS.items():
        body = _login(email, pw)
        out[k] = {"token": body["access_token"], "user": body["user"]}
    return out


@pytest.fixture(scope="session")
def smith_patients(tokens):
    r = requests.get(f"{BASE_URL}/api/patients",
                     headers={"Authorization": f"Bearer {tokens['smith']['token']}"}, timeout=15)
    assert r.status_code == 200
    pts = r.json()
    assert len(pts) >= 1
    return pts


# -----------------------------------------------------------------
# Supervisor + emulator control surface
# -----------------------------------------------------------------
class TestEmulatorProcess:
    def test_supervisor_program_running(self):
        out = subprocess.check_output(["supervisorctl", "status", "vitals-emulator"], text=True)
        assert "RUNNING" in out, f"vitals-emulator not running: {out}"

    def test_status_endpoint(self):
        r = requests.get(f"{EMU_CTRL}/status", timeout=5)
        assert r.status_code == 200
        body = r.json()
        assert body["patients"] >= 5, body
        last = body["last_reading"]
        assert isinstance(last, dict) and len(last) >= 1
        # at least one patient must have glucose/hr/spo2 entries
        any_patient = next(iter(last.values()))
        for m in ("glucose", "hr", "spo2"):
            assert m in any_patient, f"missing {m} in last_reading: {any_patient}"


# -----------------------------------------------------------------
# Steady stream into /api/vitals
# -----------------------------------------------------------------
def _recent_window():
    from datetime import datetime, timezone, timedelta
    return (datetime.now(timezone.utc) - timedelta(seconds=60)).isoformat()


class TestSteadyStream:
    def test_recent_glucose_within_30s(self, tokens, smith_patients):
        # wait two CGM cycles to ensure at least 2 readings are produced
        time.sleep(12)
        pid = smith_patients[0]["id"]
        # NOTE: backend sorts ascending — must use from_ window to get recent readings
        r = requests.get(f"{BASE_URL}/api/vitals/{pid}",
                         params={"metric": "glucose", "limit": 20, "from": _recent_window()},
                         headers={"Authorization": f"Bearer {tokens['smith']['token']}"},
                         timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert len(data) > 0, "no recent glucose readings returned"
        latest = data[-1]
        from datetime import datetime, timezone
        ts = datetime.fromisoformat(latest["recorded_at"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - ts).total_seconds()
        assert age < 30, f"latest glucose reading is {age:.1f}s old"
        assert latest.get("device"), f"missing device field: {latest}"


# -----------------------------------------------------------------
# Anomaly triggers (helper polls for the next anomalous reading)
# -----------------------------------------------------------------
def _trigger_and_wait(tokens, patient_id, kind, metric, value, timeout=14):
    headers = {"Authorization": f"Bearer {tokens['smith']['token']}"}
    params = {"metric": metric, "limit": 20, "from": _recent_window()}
    pre = requests.get(f"{BASE_URL}/api/vitals/{patient_id}",
                       params=params, headers=headers, timeout=15).json()
    pre_ids = {r["id"] for r in pre}

    tr = requests.post(f"{EMU_CTRL}/trigger/{patient_id}/{kind}", timeout=5)
    assert tr.status_code == 200, f"trigger {kind} failed: {tr.status_code} {tr.text}"

    deadline = time.time() + timeout
    found = None
    while time.time() < deadline:
        time.sleep(2)
        data = requests.get(f"{BASE_URL}/api/vitals/{patient_id}",
                            params=params, headers=headers, timeout=15).json()
        for v in reversed(data):
            if v["id"] in pre_ids:
                continue
            if v["value"] == value:
                found = v
                break
        if found:
            break
    assert found is not None, f"anomaly {kind} (value={value} metric={metric}) not observed within {timeout}s"
    assert found["severity"] == "critical", f"expected critical, got {found['severity']}: {found}"
    assert found["device"] in ("cgm", "pulseox"), f"missing/unknown device: {found}"
    return found


class TestAnomalies:
    """Each test picks a fresh patient from smith's roster to avoid trigger queue contention."""

    def test_hypo(self, tokens, smith_patients):
        pid = smith_patients[0]["id"]
        v = _trigger_and_wait(tokens, pid, "hypo", "glucose", 38)
        assert v["device"] == "cgm"

    def test_hyper(self, tokens, smith_patients):
        pid = smith_patients[min(1, len(smith_patients) - 1)]["id"]
        v = _trigger_and_wait(tokens, pid, "hyper", "glucose", 320)
        assert v["device"] == "cgm"

    def test_hypoxia(self, tokens, smith_patients):
        pid = smith_patients[min(2, len(smith_patients) - 1)]["id"]
        v = _trigger_and_wait(tokens, pid, "hypoxia", "spo2", 84, timeout=18)
        assert v["device"] == "pulseox"

    def test_bradycardia(self, tokens, smith_patients):
        pid = smith_patients[0]["id"]
        v = _trigger_and_wait(tokens, pid, "bradycardia", "hr", 32, timeout=18)
        assert v["device"] == "pulseox"

    def test_tachycardia(self, tokens, smith_patients):
        pid = smith_patients[min(1, len(smith_patients) - 1)]["id"]
        v = _trigger_and_wait(tokens, pid, "tachycardia", "hr", 145, timeout=18)
        assert v["device"] == "pulseox"


# -----------------------------------------------------------------
# WebSocket /api/ws/vitals (firehose)
# -----------------------------------------------------------------
class TestWebSocketVitals:
    def test_ws_firehose_receives_vital(self, tokens):
        async def run():
            url = f"{WS_BASE}/api/ws/vitals?token={tokens['smith']['token']}"
            async with websockets.connect(url, open_timeout=10) as ws:
                first = json.loads(await asyncio.wait_for(ws.recv(), timeout=8))
                assert first["type"] == "ready", first
                deadline = time.time() + 15
                got = None
                while time.time() < deadline:
                    msg = await asyncio.wait_for(ws.recv(), timeout=15)
                    ev = json.loads(msg)
                    if ev.get("type") == "vital":
                        got = ev
                        break
                assert got is not None, "no vital broadcast received within 15s"
                for k in ("device", "metric", "value", "unit", "severity", "recorded_at"):
                    assert k in got, f"missing key {k} in vital event: {got}"
        asyncio.run(run())


# -----------------------------------------------------------------
# Emulator system account can POST /api/vitals for any patient
# -----------------------------------------------------------------
class TestSystemAccount:
    def test_system_can_ingest_for_any_patient(self, tokens, smith_patients):
        assert EMULATOR_PASSWORD, "EMULATOR_PASSWORD must be present in /app/backend/.env"
        sys_body = _login("emulator@pulsehub.system", EMULATOR_PASSWORD)
        assert sys_body["user"]["role"] == "system"
        sys_token = sys_body["access_token"]
        # pick a patient assigned to jones (cross-doctor) to prove system bypass
        jones_token = _login(*CREDS["jones"])["access_token"]
        jones_pts = requests.get(f"{BASE_URL}/api/patients",
                                 headers={"Authorization": f"Bearer {jones_token}"}).json()
        target = jones_pts[0]["id"]
        r = requests.post(f"{BASE_URL}/api/vitals", json={
            "patient_id": target,
            "device": "cgm",
            "metric": "glucose",
            "value": 110,
        }, headers={"Authorization": f"Bearer {sys_token}"}, timeout=15)
        assert r.status_code == 200, f"system ingest failed: {r.status_code} {r.text}"
        body = r.json()
        assert "id" in body and "severity" in body


# -----------------------------------------------------------------
# Admin → create doctor
# -----------------------------------------------------------------
class TestAdminCreateDoctor:
    def test_admin_creates_doctor_and_doctor_can_login(self, tokens):
        admin_t = tokens["admin"]["token"]
        new_email = f"test_doc_{uuid.uuid4().hex[:8]}@pulsehub.test"
        new_pw = "NewDoc123!"
        r = requests.post(f"{BASE_URL}/api/admin/doctors", json={
            "email": new_email,
            "password": new_pw,
            "full_name": "Test Doctor",
            "role": "doctor",
            "specialty": "GP",
        }, headers={"Authorization": f"Bearer {admin_t}"}, timeout=15)
        assert r.status_code == 200, f"create doctor: {r.status_code} {r.text}"
        body = r.json()
        assert body["email"] == new_email
        assert body["role"] == "doctor"

        # login as new doctor
        login = _login(new_email, new_pw)
        assert login["user"]["role"] == "doctor"

    def test_non_admin_forbidden(self, tokens):
        r = requests.post(f"{BASE_URL}/api/admin/doctors", json={
            "email": f"TEST_blocked_{uuid.uuid4().hex[:6]}@pulsehub.test",
            "password": "Block123!",
            "full_name": "Blocked",
            "role": "doctor",
        }, headers={"Authorization": f"Bearer {tokens['smith']['token']}"}, timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"


# -----------------------------------------------------------------
# Chat threads + messages
# -----------------------------------------------------------------
class TestChat:
    def test_chat_send_list_and_read(self, tokens):
        smith_t = tokens["smith"]["token"]
        smith_id = tokens["smith"]["user"]["_id"]
        p1_id = tokens["p1"]["user"]["_id"]
        thread_id = f"TEST_thread_{uuid.uuid4().hex[:8]}"
        plaintext = "TEST hello phase1 chat"

        async def send():
            url = f"{WS_BASE}/api/ws/chat/{thread_id}?token={smith_t}"
            async with websockets.connect(url, open_timeout=10) as ws:
                joined = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert joined["type"] == "joined"
                await ws.send(json.dumps({"recipient_id": p1_id, "content": plaintext}))
                broadcast = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert broadcast["type"] == "message"
                assert broadcast["content"] == plaintext
        asyncio.run(send())
        time.sleep(0.5)

        r = requests.get(f"{BASE_URL}/api/chat/threads",
                         headers={"Authorization": f"Bearer {smith_t}"}, timeout=15)
        assert r.status_code == 200
        threads = r.json()
        thread_ids = [t["thread_id"] for t in threads]
        assert thread_id in thread_ids, f"new thread not listed: {thread_ids}"

        r2 = requests.get(f"{BASE_URL}/api/chat/threads/{thread_id}/messages",
                          headers={"Authorization": f"Bearer {smith_t}"}, timeout=15)
        assert r2.status_code == 200
        msgs = r2.json()
        assert len(msgs) >= 1
        assert any(m["content"] == plaintext for m in msgs)
        assert msgs[-1]["sender_id"] == smith_id

    def test_non_participant_forbidden_admin_allowed(self, tokens):
        smith_t = tokens["smith"]["token"]
        p1_id = tokens["p1"]["user"]["_id"]
        thread_id = f"TEST_thread_{uuid.uuid4().hex[:8]}"

        async def send():
            async with websockets.connect(f"{WS_BASE}/api/ws/chat/{thread_id}?token={smith_t}",
                                           open_timeout=10) as ws:
                await asyncio.wait_for(ws.recv(), timeout=5)
                await ws.send(json.dumps({"recipient_id": p1_id, "content": "private"}))
                await asyncio.wait_for(ws.recv(), timeout=5)
        asyncio.run(send())
        time.sleep(0.5)

        r = requests.get(f"{BASE_URL}/api/chat/threads/{thread_id}/messages",
                         headers={"Authorization": f"Bearer {_login(*CREDS['jones'])['access_token']}"},
                         timeout=15)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text}"

        r2 = requests.get(f"{BASE_URL}/api/chat/threads/{thread_id}/messages",
                          headers={"Authorization": f"Bearer {tokens['admin']['token']}"},
                          timeout=15)
        assert r2.status_code == 200, f"admin should be allowed; got {r2.status_code} {r2.text}"
        assert len(r2.json()) >= 1


# -----------------------------------------------------------------
# Login throttling (5 fails → 429 on 6th)
# -----------------------------------------------------------------
class TestLoginThrottle:
    def test_throttle_after_5_fails(self):
        """Test login throttling. Uses localhost:8001 directly because the public
        URL routes through ingress which rotates source IPs across requests,
        defeating the (ip,email) throttle key. See action_items in report."""
        local_base = "http://localhost:8001"
        email = f"TEST_throttle_{uuid.uuid4().hex[:6]}@pulsehub.test"
        for i in range(5):
            r = requests.post(f"{local_base}/api/auth/login",
                              json={"email": email, "password": "wrong"}, timeout=10)
            assert r.status_code == 401, f"attempt {i+1}: {r.status_code} {r.text}"
        r = requests.post(f"{local_base}/api/auth/login",
                          json={"email": email, "password": "wrong"}, timeout=10)
        assert r.status_code == 429, f"expected 429 on 6th attempt, got {r.status_code} {r.text}"


# -----------------------------------------------------------------
# Phase 0 sanity
# -----------------------------------------------------------------
class TestPhase0Sanity:
    def test_patient_me(self, tokens):
        r = requests.get(f"{BASE_URL}/api/auth/me",
                         headers={"Authorization": f"Bearer {tokens['p1']['token']}"}, timeout=10)
        assert r.status_code == 200
        assert r.json()["email"] == CREDS["p1"][0]

    def test_smith_lists_3_patients(self, tokens):
        r = requests.get(f"{BASE_URL}/api/patients",
                         headers={"Authorization": f"Bearer {tokens['smith']['token']}"}, timeout=10)
        assert r.status_code == 200
        assert len(r.json()) == 3
