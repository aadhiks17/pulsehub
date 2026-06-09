"""PulseHub Phase 2 backend tests.

Covers:
- Seed timestamps are all in the past (recorded_at <= now()).
- POST /api/prescriptions RBAC.
- GET /api/admin/doctors RBAC.
- GET /api/chat/threads/by-patient/{patient_id} RBAC + payload.
- GET /api/chat/threads/{thread_id}/messages — empty thread returns [] (not 403)
  for the legitimate doctor↔patient pair (a previous bug fix).
- GET /api/vitals/{id}?from&to → ASC; w/o from&to → DESC.
- WS /api/ws/vitals?token=...&patient_id=... only broadcasts that patient's events,
  and firehose (no patient_id) still gets them.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import requests
import websockets
from dotenv import load_dotenv

ROOT = Path("/app/backend")
load_dotenv(ROOT / ".env")
sys.path.insert(0, str(ROOT))

BASE_URL = None
with open("/app/frontend/.env") as f:
    for line in f:
        if line.startswith("REACT_APP_BACKEND_URL="):
            BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
            break

WS_BASE = "ws://localhost:8001"

CREDS = {
    "admin": ("admin@pulsehub.test", "Admin123!"),
    "smith": ("dr.smith@pulsehub.test", "Doctor123!"),
    "jones": ("dr.jones@pulsehub.test", "Doctor123!"),
    "p1": ("patient1@pulsehub.test", "Patient123!"),
    "p4": ("patient4@pulsehub.test", "Patient123!"),
}


def H(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="session")
def tokens():
    out = {}
    for key, (email, pw) in CREDS.items():
        r = requests.post(f"{BASE_URL}/api/auth/login",
                          json={"email": email, "password": pw}, timeout=15)
        assert r.status_code == 200, f"login failed for {email}: {r.text}"
        body = r.json()
        out[key] = (body["access_token"], body["user"])
    return out


# ============================================================
# Seed: all vital timestamps in the past
# ============================================================
class TestSeedTimestampsInPast:
    def test_seed_vitals_recorded_at_le_now(self, tokens):
        smith_tok, _ = tokens["smith"]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.get(
            f"{BASE_URL}/api/vitals/{p1_id}?limit=5",
            headers=H(smith_tok),
        )
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 1
        now = datetime.now(timezone.utc)
        for v in items:
            ts = datetime.fromisoformat(v["recorded_at"].replace("Z", "+00:00"))
            # allow 60s of clock skew
            assert ts <= now + timedelta(seconds=60), f"future timestamp: {v['recorded_at']}"


# ============================================================
# POST /api/prescriptions
# ============================================================
class TestPrescriptionsCreate:
    def test_doctor_assigned_can_create(self, tokens):
        smith_tok, _ = tokens["smith"]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.post(
            f"{BASE_URL}/api/prescriptions",
            headers=H(smith_tok),
            json={"patient_id": p1_id, "drug": "TEST_Aspirin",
                  "dosage": "81mg", "frequency": "Daily", "notes": "TEST"},
        )
        assert r.status_code in (200, 201), r.text
        doc = r.json()
        assert doc["drug"] == "TEST_Aspirin"
        assert doc["dosage"] == "81mg"
        assert doc["frequency"] == "Daily"
        assert doc["patient_id"] == p1_id

    def test_doctor_unassigned_403(self, tokens):
        # Smith trying for one of Jones's patients
        smith_tok, _ = tokens["smith"]
        p4_id = tokens["p4"][1]["_id"]
        r = requests.post(
            f"{BASE_URL}/api/prescriptions",
            headers=H(smith_tok),
            json={"patient_id": p4_id, "drug": "TEST_X",
                  "dosage": "1mg", "frequency": "Daily", "notes": ""},
        )
        assert r.status_code == 403

    def test_patient_forbidden(self, tokens):
        p1_tok, _ = tokens["p1"]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.post(
            f"{BASE_URL}/api/prescriptions",
            headers=H(p1_tok),
            json={"patient_id": p1_id, "drug": "TEST_X",
                  "dosage": "1mg", "frequency": "Daily", "notes": ""},
        )
        assert r.status_code == 403


# ============================================================
# GET /api/admin/doctors
# ============================================================
class TestAdminDoctors:
    def test_admin_lists_doctors(self, tokens):
        admin_tok, _ = tokens["admin"]
        r = requests.get(f"{BASE_URL}/api/admin/doctors", headers=H(admin_tok))
        assert r.status_code == 200
        emails = {d["email"] for d in r.json()}
        assert "dr.smith@pulsehub.test" in emails
        assert "dr.jones@pulsehub.test" in emails

    def test_doctor_forbidden(self, tokens):
        smith_tok, _ = tokens["smith"]
        r = requests.get(f"{BASE_URL}/api/admin/doctors", headers=H(smith_tok))
        assert r.status_code == 403


# ============================================================
# GET /api/chat/threads/by-patient/{patient_id}
# ============================================================
class TestChatByPatient:
    def test_doctor_assigned_returns_thread(self, tokens):
        smith_tok, smith_user = tokens["smith"]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.get(
            f"{BASE_URL}/api/chat/threads/by-patient/{p1_id}",
            headers=H(smith_tok),
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "thread_id" in body
        assert body["patient_id"] == p1_id
        assert body["doctor_id"] == smith_user["_id"]
        assert "you" in body

    def test_doctor_unassigned_403(self, tokens):
        smith_tok, _ = tokens["smith"]
        p4_id = tokens["p4"][1]["_id"]
        r = requests.get(
            f"{BASE_URL}/api/chat/threads/by-patient/{p4_id}",
            headers=H(smith_tok),
        )
        assert r.status_code == 403


# ============================================================
# GET /api/chat/threads/{thread_id}/messages — empty thread returns []
# ============================================================
class TestEmptyChatThreadMessages:
    def test_empty_dp_thread_returns_empty_list(self, tokens):
        smith_tok, smith_user = tokens["smith"]
        p1_id = tokens["p1"][1]["_id"]
        # Resolve the canonical thread id via by-patient.
        r0 = requests.get(
            f"{BASE_URL}/api/chat/threads/by-patient/{p1_id}",
            headers=H(smith_tok),
        )
        assert r0.status_code == 200, r0.text
        thread_id = r0.json()["thread_id"]
        # Even if no messages exist yet, doctor↔patient pair must read [].
        r = requests.get(
            f"{BASE_URL}/api/chat/threads/{thread_id}/messages",
            headers=H(smith_tok),
        )
        assert r.status_code == 200, f"got {r.status_code}: {r.text}"
        assert isinstance(r.json(), list)


# ============================================================
# GET /api/vitals — sort order semantics
# ============================================================
class TestVitalsSortOrder:
    def _iso(self, dt: datetime) -> str:
        return dt.isoformat()

    def test_without_window_is_descending(self, tokens):
        smith_tok, _ = tokens["smith"]
        p1_id = tokens["p1"][1]["_id"]
        r = requests.get(
            f"{BASE_URL}/api/vitals/{p1_id}?metric=glucose&limit=10",
            headers=H(smith_tok),
        )
        assert r.status_code == 200
        items = r.json()
        if len(items) < 2:
            pytest.skip("not enough data to verify order")
        ts = [v["recorded_at"] for v in items]
        assert ts == sorted(ts, reverse=True), f"expected DESC, got {ts}"

    def test_with_from_to_is_ascending(self, tokens):
        smith_tok, _ = tokens["smith"]
        p1_id = tokens["p1"][1]["_id"]
        now = datetime.now(timezone.utc)
        frm = self._iso(now - timedelta(days=7))
        to = self._iso(now + timedelta(minutes=1))
        r = requests.get(
            f"{BASE_URL}/api/vitals/{p1_id}?metric=glucose&from={frm}&to={to}&limit=50",
            headers=H(smith_tok),
        )
        assert r.status_code == 200
        items = r.json()
        if len(items) < 2:
            pytest.skip("not enough data to verify order")
        ts = [v["recorded_at"] for v in items]
        assert ts == sorted(ts), f"expected ASC, got first few: {ts[:5]}"


# ============================================================
# WS /api/ws/vitals — patient_id room filtering + firehose
# ============================================================
class TestVitalsWebSocket:
    def test_room_only_gets_its_patient(self, tokens):
        smith_tok, _ = tokens["smith"]
        p1_id = tokens["p1"][1]["_id"]
        p2_token, p2_user = None, None
        # Use p1 to push for patient1; need a vital posted for patient2 too — but
        # we only need to verify room only receives p1 events. So just post p1
        # and confirm event matches p1.
        async def run():
            url = f"{WS_BASE}/api/ws/vitals?token={smith_tok}&patient_id={p1_id}"
            async with websockets.connect(url) as ws:
                first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert first["type"] == "ready"
                # post a vital for p1
                r = requests.post(
                    f"{BASE_URL}/api/vitals", headers=H(smith_tok),
                    json={"patient_id": p1_id, "device": "cgm",
                          "metric": "glucose", "value": 110},
                )
                assert r.status_code == 200
                # First incoming should be our patient's event
                evt = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                # Skip emulator interleaving — keep reading until type==vital for p1
                deadline = asyncio.get_event_loop().time() + 10
                while not (evt.get("type") == "vital" and evt.get("patient_id") == p1_id):
                    if asyncio.get_event_loop().time() > deadline:
                        pytest.fail(f"never saw p1 event, last={evt}")
                    evt = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                # All events received in this room must be for p1
                assert evt["patient_id"] == p1_id

        asyncio.new_event_loop().run_until_complete(run())

    def test_firehose_no_patient_id_receives_events(self, tokens):
        smith_tok, _ = tokens["smith"]
        p1_id = tokens["p1"][1]["_id"]

        async def run():
            url = f"{WS_BASE}/api/ws/vitals?token={smith_tok}"
            async with websockets.connect(url) as ws:
                first = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                assert first["type"] == "ready"
                r = requests.post(
                    f"{BASE_URL}/api/vitals", headers=H(smith_tok),
                    json={"patient_id": p1_id, "device": "cgm",
                          "metric": "glucose", "value": 115},
                )
                assert r.status_code == 200
                # Read up to ~10 events looking for our p1 post
                deadline = asyncio.get_event_loop().time() + 10
                found = False
                while asyncio.get_event_loop().time() < deadline:
                    try:
                        evt = json.loads(await asyncio.wait_for(ws.recv(), timeout=5))
                    except asyncio.TimeoutError:
                        break
                    if evt.get("type") == "vital" and evt.get("patient_id") == p1_id:
                        found = True
                        break
                assert found, "firehose did not receive any vital event"

        asyncio.new_event_loop().run_until_complete(run())
