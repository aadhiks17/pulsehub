"""
Seed PulseHub Phase 0 with demo accounts and 30 days of vitals.

Can be run as:
    python -m seed
or imported and awaited from server startup as `await run_seed(db)`.
"""

from __future__ import annotations

import asyncio
import os
import random
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

# Imports below this line so .env is loaded first
from auth import hash_password  # noqa: E402
from hipaa_utils import encrypt_field  # noqa: E402
from risk import classify  # noqa: E402


ADMIN = {"email": "admin@pulsehub.test", "password": "Admin123!", "full_name": "Site Admin", "role": "admin"}
DOCTORS = [
    {"email": "dr.smith@pulsehub.test", "password": "Doctor123!", "full_name": "Dr. Alice Smith",
     "role": "doctor", "specialty": "Endocrinology"},
    {"email": "dr.jones@pulsehub.test", "password": "Doctor123!", "full_name": "Dr. Bob Jones",
     "role": "doctor", "specialty": "Cardiology"},
]
PATIENTS = [
    {"email": "patient1@pulsehub.test", "password": "Patient123!", "full_name": "Pat One",   "premium": False, "doctor_idx": 0},
    {"email": "patient2@pulsehub.test", "password": "Patient123!", "full_name": "Pat Two",   "premium": False, "doctor_idx": 0},
    {"email": "patient3@pulsehub.test", "password": "Patient123!", "full_name": "Pat Three", "premium": False, "doctor_idx": 0},
    {"email": "patient4@pulsehub.test", "password": "Patient123!", "full_name": "Pat Four",  "premium": True,  "doctor_idx": 1},
    {"email": "patient5@pulsehub.test", "password": "Patient123!", "full_name": "Pat Five",  "premium": True,  "doctor_idx": 1},
]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _make_vital(patient_id: str, device: str, metric: str, value: float, when: datetime) -> dict:
    sev = classify(metric, value)
    units = {"glucose": "mg/dL", "hr": "bpm", "spo2": "%"}
    return {
        "_id": str(uuid.uuid4()),
        "patient_id": patient_id,
        "device": device,
        "metric": metric,
        "value": encrypt_field(str(value)),
        "value_plain": float(value),
        "unit": units[metric],
        "recorded_at": when.isoformat(),
        "severity": sev,
    }


def _generate_vitals_for_patient(patient_id: str, premium: bool) -> list[dict]:
    """30 days of vitals ending at 'now':
       glucose every 2h (12/day = ~360), HR + SpO2 every 4h (6/day = ~180).
       All timestamps strictly in the past. Inject a few warning/critical events.
    """
    out: list[dict] = []
    now = _now().replace(microsecond=0)
    rng = random.Random(patient_id)  # deterministic per patient

    # Glucose: every 2h going back 30 days (~360 readings)
    baseline = 110 + (10 if premium else 0)
    for hours_ago in range(2, 30 * 24 + 1, 2):
        ts = now - timedelta(hours=hours_ago, minutes=rng.randint(0, 59))
        v = baseline + rng.randint(-30, 40)
        if rng.random() < 0.03:
            v = rng.choice([45, 65, 220, 270])
        v = max(40, min(320, v))
        out.append(_make_vital(patient_id, "cgm", "glucose", v, ts))

    # HR + SpO2: every 4h going back 30 days (~180 of each)
    for hours_ago in range(4, 30 * 24 + 1, 4):
        ts = now - timedelta(hours=hours_ago, minutes=rng.randint(0, 59))
        hr = 65 + rng.randint(-10, 25)
        if rng.random() < 0.02:
            hr = rng.choice([38, 48, 115, 130])
        hr = max(35, min(150, hr))
        out.append(_make_vital(patient_id, "pulseox", "hr", hr, ts))

        spo2 = 97 + rng.randint(-3, 2)
        if rng.random() < 0.02:
            spo2 = rng.choice([88, 92])
        spo2 = max(85, min(100, spo2))
        out.append(_make_vital(patient_id, "pulseox", "spo2", spo2, ts))

    return out


async def run_seed(db, force: bool = False) -> dict:
    """Seed the database. If force=False, skips when users already exist."""
    if not force:
        existing = await db.users.count_documents({})
        if existing > 0:
            return {"skipped": True, "reason": "users collection not empty", "users": existing}

    # Clean (only when forcing)
    if force:
        for coll in ["users", "vitals", "chat_messages", "prescriptions", "audit_log"]:
            await db[coll].delete_many({})

    # --- create admin ---
    admin_id = str(uuid.uuid4())
    await db.users.insert_one({
        "_id": admin_id,
        "email": ADMIN["email"],
        "password_hash": hash_password(ADMIN["password"]),
        "role": "admin",
        "full_name": ADMIN["full_name"],
        "premium": False,
        "created_at": _now().isoformat(),
    })

    # --- create doctors ---
    doctor_ids: list[str] = []
    for d in DOCTORS:
        did = str(uuid.uuid4())
        doctor_ids.append(did)
        await db.users.insert_one({
            "_id": did,
            "email": d["email"],
            "password_hash": hash_password(d["password"]),
            "role": "doctor",
            "full_name": d["full_name"],
            "specialty": d["specialty"],
            "premium": False,
            "created_at": _now().isoformat(),
        })

    # --- create patients + vitals ---
    patient_ids: list[str] = []
    vitals_total = 0
    for p in PATIENTS:
        pid = str(uuid.uuid4())
        patient_ids.append(pid)
        await db.users.insert_one({
            "_id": pid,
            "email": p["email"],
            "password_hash": hash_password(p["password"]),
            "role": "patient",
            "full_name": p["full_name"],
            "premium": p["premium"],
            "assigned_doctor_id": doctor_ids[p["doctor_idx"]],
            "created_at": _now().isoformat(),
        })
        vitals = _generate_vitals_for_patient(pid, p["premium"])
        if vitals:
            await db.vitals.insert_many(vitals)
            vitals_total += len(vitals)

    # --- prescriptions (each patient gets 1-3, assigned by their doctor) ---
    # Keyed by patient index (0..4) → list of (drug, dosage, frequency, notes, days_ago)
    rx_plans = {
        0: [  # patient1 — Dr Smith
            ("Metformin",  "500mg", "Twice daily",  "Take with meals.",            45),
            ("Lisinopril", "10mg",  "Once daily",   "Morning dose; monitor BP.",   20),
        ],
        1: [  # patient2 — Dr Smith
            ("Atorvastatin", "20mg", "Nightly",     "Lipid management.",           30),
        ],
        2: [  # patient3 — Dr Smith
            ("Insulin Glargine", "20u",  "Nightly",   "Subcutaneous; rotate sites.", 55),
            ("Aspirin",          "81mg", "Once daily","Cardio-protective.",          15),
        ],
        3: [  # patient4 — Dr Jones
            ("Albuterol Inhaler", "90mcg",  "PRN",         "Rescue inhaler; max 8 puffs/day.", 50),
            ("Fluticasone",       "250mcg", "Twice daily", "Maintenance ICS.",                 25),
            ("Montelukast",       "10mg",   "Once daily",  "Evening dose.",                    10),
        ],
        4: [  # patient5 — Dr Jones
            ("Levothyroxine", "50mcg", "Once daily", "Empty stomach, 30 min before food.", 35),
        ],
    }
    rx_rng = random.Random("pulsehub-prescriptions")
    for i, pid in enumerate(patient_ids):
        doctor_idx = PATIENTS[i]["doctor_idx"]
        for (drug, dosage, frequency, notes, days_ago) in rx_plans.get(i, []):
            issued = _now() - timedelta(days=days_ago, hours=rx_rng.randint(0, 23))
            await db.prescriptions.insert_one({
                "_id": str(uuid.uuid4()),
                "patient_id": pid,
                "doctor_id": doctor_ids[doctor_idx],
                "drug": drug,
                "dosage": dosage,
                "frequency": frequency,
                "notes": notes,
                "issued_at": issued.isoformat(),
            })

    return {
        "skipped": False,
        "admin": ADMIN["email"],
        "doctors": [d["email"] for d in DOCTORS],
        "patients": [p["email"] for p in PATIENTS],
        "vitals_inserted": vitals_total,
    }


async def _main():
    import sys
    force = "--reset" in sys.argv
    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]
    client = AsyncIOMotorClient(mongo_url)
    db = client[db_name]
    result = await run_seed(db, force=force)
    print("Seed result:", result)
    client.close()


if __name__ == "__main__":
    asyncio.run(_main())
