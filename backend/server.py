"""PulseHub Phase 0 — FastAPI backend."""

from __future__ import annotations

import asyncio
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import (  # noqa: E402
    APIRouter,
    Depends,
    FastAPI,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from auth import (  # noqa: E402
    create_access_token,
    get_current_user,
    get_user_from_token,
    hash_password,
    verify_password,
)
from hipaa_utils import decrypt_field, encrypt_field  # noqa: E402
from models import LoginRequest, PrescriptionCreate, RegisterRequest, VitalCreate  # noqa: E402
from risk import classify, risk_level_from_latest  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s :: %(message)s")
logger = logging.getLogger("pulsehub")

mongo_url = os.environ["MONGO_URL"]
mongo_client = AsyncIOMotorClient(mongo_url)
db = mongo_client[os.environ["DB_NAME"]]

app = FastAPI(
    title="PulseHub API",
    version="0.1.0",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url="/api/redoc",
)
api = APIRouter(prefix="/api")

# In-memory login throttling (per ip:email). Reset on backend restart.
_login_fails: dict[str, int] = {}
_login_lock: dict[str, float] = {}


# ------------------------------------------------------------------
async def audit(actor_id: Optional[str], action: str, target: Optional[str], ip: Optional[str]) -> None:
    await db.audit_log.insert_one({
        "_id": str(uuid.uuid4()),
        "actor_id": actor_id,
        "action": action,
        "target": target,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "ip": ip,
    })


def _user_public(u: dict) -> dict:
    if not u:
        return u
    return {
        "_id": u["_id"],
        "email": u["email"],
        "role": u["role"],
        "full_name": u["full_name"],
        "premium": u.get("premium", False),
        "assigned_doctor_id": u.get("assigned_doctor_id"),
        "specialty": u.get("specialty"),
        "created_at": u.get("created_at"),
    }


# ------------------------------------------------------------------
# Root
# ------------------------------------------------------------------
@api.get("/")
async def root():
    return {"name": "PulseHub API", "version": "0.1.0", "status": "ok"}


@api.get("/health")
async def health():
    try:
        await db.command("ping")
        return {"status": "ok", "db": "ok"}
    except Exception as exc:
        return {"status": "degraded", "db": str(exc)}


# ------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------
@api.post("/auth/register")
async def register(req: RegisterRequest, request: Request):
    email = req.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")

    if req.role in ("doctor", "admin"):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=403, detail="Admin token required to create doctor/admin")
        actor = await get_user_from_token(auth_header[7:])
        if not actor or actor.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin token required to create doctor/admin")

    user_doc = {
        "_id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(req.password),
        "role": req.role,
        "full_name": req.full_name,
        "premium": req.premium,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if req.role == "patient" and req.assigned_doctor_id:
        user_doc["assigned_doctor_id"] = req.assigned_doctor_id
    if req.role == "doctor" and req.specialty:
        user_doc["specialty"] = req.specialty

    await db.users.insert_one(user_doc)
    await audit(user_doc["_id"], "register", user_doc["_id"], request.client.host if request.client else None)

    token = create_access_token(user_doc["_id"], email, req.role)
    return {"access_token": token, "token_type": "bearer", "user": _user_public(user_doc)}


@api.post("/auth/login")
async def login(req: LoginRequest, request: Request):
    ip = request.client.host if request.client else "?"
    key = f"{ip}:{req.email.lower()}"
    locked_until = _login_lock.get(key, 0)
    now_ts = datetime.now(timezone.utc).timestamp()
    if locked_until > now_ts:
        raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {int(locked_until - now_ts)}s.")

    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not verify_password(req.password, user["password_hash"]):
        fails = _login_fails.get(key, 0) + 1
        _login_fails[key] = fails
        if fails >= 5:
            _login_lock[key] = now_ts + 15 * 60  # 15-minute lockout
            _login_fails[key] = 0
        raise HTTPException(status_code=401, detail="Invalid email or password")

    _login_fails.pop(key, None)
    _login_lock.pop(key, None)
    token = create_access_token(user["_id"], user["email"], user["role"])
    await audit(user["_id"], "login", user["_id"], ip)
    return {"access_token": token, "token_type": "bearer", "user": _user_public(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return _user_public(user)


# ------------------------------------------------------------------
# Admin
# ------------------------------------------------------------------
@api.post("/admin/doctors")
async def admin_create_doctor(req: RegisterRequest, user: dict = Depends(get_current_user)):
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if await db.users.find_one({"email": req.email.lower()}):
        raise HTTPException(status_code=400, detail="Email already registered")
    doc = {
        "_id": str(uuid.uuid4()),
        "email": req.email.lower(),
        "password_hash": hash_password(req.password),
        "role": "doctor",
        "full_name": req.full_name,
        "specialty": req.specialty or "General",
        "premium": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(doc)
    await audit(user["_id"], "admin.create_doctor", doc["_id"], None)
    return _user_public(doc)


# ------------------------------------------------------------------
# Chat history
# ------------------------------------------------------------------
@api.get("/chat/threads")
async def list_chat_threads(user: dict = Depends(get_current_user)):
    """List distinct thread_ids this user has participated in, with the latest message."""
    pipeline = [
        {"$match": {"$or": [{"sender_id": user["_id"]}, {"recipient_id": user["_id"]}]}},
        {"$sort": {"created_at": -1}},
        {"$group": {
            "_id": "$thread_id",
            "last_at": {"$first": "$created_at"},
            "last_sender_id": {"$first": "$sender_id"},
            "last_encrypted": {"$first": "$content_encrypted"},
            "unread": {"$sum": {"$cond": [{"$and": [{"$eq": ["$recipient_id", user["_id"]]}, {"$eq": ["$read", False]}]}, 1, 0]}},
        }},
        {"$sort": {"last_at": -1}},
    ]
    out = []
    async for row in db.chat_messages.aggregate(pipeline):
        try:
            preview = decrypt_field(row["last_encrypted"])
        except Exception:
            preview = ""
        out.append({
            "thread_id": row["_id"],
            "last_at": row["last_at"],
            "last_sender_id": row["last_sender_id"],
            "last_message_preview": preview[:140],
            "unread": row.get("unread", 0),
        })
    return out


@api.get("/chat/threads/{thread_id}/messages")
async def get_thread_messages(
    thread_id: str,
    user: dict = Depends(get_current_user),
    limit: int = Query(50, le=200),
    before: Optional[str] = Query(None),
):
    # ensure the caller is a participant in this thread (any message with their id)
    participates = await db.chat_messages.find_one({
        "thread_id": thread_id,
        "$or": [{"sender_id": user["_id"]}, {"recipient_id": user["_id"]}],
    })
    if not participates and user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Not a participant in this thread")

    q: dict = {"thread_id": thread_id}
    if before:
        q["created_at"] = {"$lt": before}
    cursor = db.chat_messages.find(q).sort("created_at", -1).limit(limit)
    msgs = []
    async for m in cursor:
        try:
            content = decrypt_field(m["content_encrypted"])
        except Exception:
            content = ""
        msgs.append({
            "id": m["_id"],
            "thread_id": m["thread_id"],
            "sender_id": m["sender_id"],
            "recipient_id": m.get("recipient_id"),
            "content": content,
            "created_at": m["created_at"],
            "read": m.get("read", False),
        })
    # return in ascending chronological order for UI convenience
    msgs.reverse()
    return msgs


# ------------------------------------------------------------------
# Patients
# ------------------------------------------------------------------
async def _latest_vitals_for(patient_id: str) -> dict:
    pipeline = [
        {"$match": {"patient_id": patient_id}},
        {"$sort": {"recorded_at": -1}},
        {"$group": {
            "_id": "$metric",
            "value_plain": {"$first": "$value_plain"},
            "unit": {"$first": "$unit"},
            "severity": {"$first": "$severity"},
            "recorded_at": {"$first": "$recorded_at"},
        }},
    ]
    latest: dict = {}
    async for row in db.vitals.aggregate(pipeline):
        latest[row["_id"]] = {
            "value": row["value_plain"],
            "unit": row.get("unit"),
            "severity": row.get("severity"),
            "recorded_at": row.get("recorded_at"),
        }
    return latest


@api.get("/patients")
async def list_patients(user: dict = Depends(get_current_user)):
    if user["role"] not in ("doctor", "admin", "system"):
        raise HTTPException(status_code=403, detail="Only doctors, admins, or system can list patients")

    query: dict = {"role": "patient"}
    if user["role"] == "doctor":
        query["assigned_doctor_id"] = user["_id"]

    patients = await db.users.find(query).to_list(1000)
    out = []
    for p in patients:
        latest = await _latest_vitals_for(p["_id"])
        risk = risk_level_from_latest(list(latest.values()))
        out.append({
            "id": p["_id"],
            "full_name": p["full_name"],
            "email": p["email"],
            "premium": p.get("premium", False),
            "assigned_doctor_id": p.get("assigned_doctor_id"),
            "latest": latest,
            "risk_level": risk,
        })

    order = {"critical": 0, "warning": 1, "normal": 2}
    out.sort(key=lambda x: order.get(x["risk_level"], 3))
    return out


@api.get("/patients/{patient_id}")
async def get_patient(patient_id: str, user: dict = Depends(get_current_user)):
    target = await db.users.find_one({"_id": patient_id, "role": "patient"})
    if not target:
        raise HTTPException(status_code=404, detail="Patient not found")

    if user["role"] == "patient" and user["_id"] != patient_id:
        raise HTTPException(status_code=403, detail="Patients can only view their own profile")
    if user["role"] == "doctor" and target.get("assigned_doctor_id") != user["_id"]:
        raise HTTPException(status_code=403, detail="Patient not assigned to this doctor")

    cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
    cursor = db.vitals.find({"patient_id": patient_id, "recorded_at": {"$gte": cutoff}}).sort("recorded_at", 1)
    vitals = []
    async for v in cursor:
        vitals.append({
            "id": v["_id"],
            "metric": v["metric"],
            "device": v["device"],
            "value": v["value_plain"],
            "unit": v.get("unit"),
            "recorded_at": v["recorded_at"],
            "severity": v["severity"],
        })

    latest = await _latest_vitals_for(patient_id)
    return {
        "profile": _user_public(target),
        "latest": latest,
        "risk_level": risk_level_from_latest(list(latest.values())),
        "vitals_30d": vitals,
    }


# ------------------------------------------------------------------
# Vitals
# ------------------------------------------------------------------
@api.post("/vitals")
async def ingest_vital(req: VitalCreate, user: dict = Depends(get_current_user)):
    if user["role"] not in ("patient", "doctor", "admin", "system"):
        raise HTTPException(status_code=403, detail="Role not permitted to ingest vitals")
    if user["role"] == "patient" and req.patient_id != user["_id"]:
        raise HTTPException(status_code=403, detail="Patients can only submit their own vitals")
    if user["role"] == "doctor":
        target = await db.users.find_one({"_id": req.patient_id})
        if not target or target.get("assigned_doctor_id") != user["_id"]:
            raise HTTPException(status_code=403, detail="Patient not assigned to this doctor")
    # admin & system can ingest for any patient

    severity = classify(req.metric, req.value)
    units = {"glucose": "mg/dL", "hr": "bpm", "spo2": "%"}
    recorded_at_dt = req.recorded_at or datetime.now(timezone.utc)
    recorded_at = recorded_at_dt.isoformat() if isinstance(recorded_at_dt, datetime) else str(recorded_at_dt)

    doc = {
        "_id": str(uuid.uuid4()),
        "patient_id": req.patient_id,
        "device": req.device,
        "metric": req.metric,
        "value": encrypt_field(str(req.value)),
        "value_plain": float(req.value),
        "unit": req.unit or units.get(req.metric),
        "recorded_at": recorded_at,
        "severity": severity,
    }
    await db.vitals.insert_one(doc)

    event = {
        "type": "vital",
        "id": doc["_id"],
        "patient_id": doc["patient_id"],
        "device": doc["device"],
        "metric": doc["metric"],
        "value": doc["value_plain"],
        "unit": doc["unit"],
        "severity": doc["severity"],
        "recorded_at": doc["recorded_at"],
    }
    await vitals_hub.broadcast(doc["patient_id"], event)

    return {"id": doc["_id"], "severity": severity, "recorded_at": recorded_at}


@api.get("/vitals/{patient_id}")
async def get_vitals(
    patient_id: str,
    user: dict = Depends(get_current_user),
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = Query(None),
    metric: Optional[str] = Query(None),
    limit: int = Query(1000, le=10000),
):
    if user["role"] == "patient" and user["_id"] != patient_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if user["role"] == "doctor":
        target = await db.users.find_one({"_id": patient_id})
        if not target or target.get("assigned_doctor_id") != user["_id"]:
            raise HTTPException(status_code=403, detail="Patient not assigned to this doctor")

    q: dict = {"patient_id": patient_id}
    if metric:
        q["metric"] = metric
    if from_ or to:
        rng: dict = {}
        if from_:
            rng["$gte"] = from_
        if to:
            rng["$lte"] = to
        q["recorded_at"] = rng

    cursor = db.vitals.find(q).sort("recorded_at", 1).limit(limit)
    out = []
    async for v in cursor:
        try:
            decrypted = float(decrypt_field(v["value"]))
        except Exception:
            decrypted = v.get("value_plain")
        out.append({
            "id": v["_id"],
            "patient_id": v["patient_id"],
            "device": v["device"],
            "metric": v["metric"],
            "value": decrypted,
            "unit": v.get("unit"),
            "recorded_at": v["recorded_at"],
            "severity": v["severity"],
        })
    return out


# ------------------------------------------------------------------
# Prescriptions
# ------------------------------------------------------------------
@api.post("/prescriptions")
async def create_prescription(req: PrescriptionCreate, user: dict = Depends(get_current_user)):
    if user["role"] != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can issue prescriptions")
    target = await db.users.find_one({"_id": req.patient_id})
    if not target or target.get("assigned_doctor_id") != user["_id"]:
        raise HTTPException(status_code=403, detail="Patient not assigned to this doctor")
    doc = {
        "_id": str(uuid.uuid4()),
        "patient_id": req.patient_id,
        "doctor_id": user["_id"],
        "drug": req.drug,
        "dosage": req.dosage,
        "frequency": req.frequency,
        "notes": req.notes,
        "issued_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.prescriptions.insert_one(doc)
    return doc


@api.get("/prescriptions/{patient_id}")
async def list_prescriptions(patient_id: str, user: dict = Depends(get_current_user)):
    if user["role"] == "patient" and user["_id"] != patient_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    if user["role"] == "doctor":
        target = await db.users.find_one({"_id": patient_id})
        if not target or target.get("assigned_doctor_id") != user["_id"]:
            raise HTTPException(status_code=403, detail="Patient not assigned to this doctor")
    cursor = db.prescriptions.find({"patient_id": patient_id}).sort("issued_at", -1)
    return [doc async for doc in cursor]


# ------------------------------------------------------------------
# WebSockets
# ------------------------------------------------------------------
class VitalsHub:
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = {}
        self.firehose: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def subscribe(self, ws: WebSocket, patient_id: Optional[str]):
        async with self._lock:
            if patient_id:
                self.rooms.setdefault(patient_id, set()).add(ws)
            else:
                self.firehose.add(ws)

    async def unsubscribe(self, ws: WebSocket):
        async with self._lock:
            for s in self.rooms.values():
                s.discard(ws)
            self.firehose.discard(ws)

    async def broadcast(self, patient_id: str, event: dict):
        targets = list(self.rooms.get(patient_id, set())) + list(self.firehose)
        for ws in targets:
            try:
                await ws.send_json(event)
            except Exception:
                pass


vitals_hub = VitalsHub()


class ChatHub:
    def __init__(self) -> None:
        self.threads: dict[str, set[WebSocket]] = {}
        self._lock = asyncio.Lock()

    async def join(self, thread_id: str, ws: WebSocket):
        async with self._lock:
            self.threads.setdefault(thread_id, set()).add(ws)

    async def leave(self, thread_id: str, ws: WebSocket):
        async with self._lock:
            self.threads.get(thread_id, set()).discard(ws)

    async def broadcast(self, thread_id: str, event: dict):
        for ws in list(self.threads.get(thread_id, set())):
            try:
                await ws.send_json(event)
            except Exception:
                pass


chat_hub = ChatHub()


@app.websocket("/api/ws/vitals")
async def ws_vitals(websocket: WebSocket, token: str = Query(...), patient_id: Optional[str] = Query(None)):
    user = await get_user_from_token(token)
    if not user or user["role"] not in ("doctor", "admin", "patient"):
        await websocket.close(code=1008)
        return
    if user["role"] == "patient":
        patient_id = user["_id"]

    await websocket.accept()
    await vitals_hub.subscribe(websocket, patient_id)
    try:
        await websocket.send_json({"type": "ready", "patient_id": patient_id, "user": user["email"]})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await vitals_hub.unsubscribe(websocket)


@app.websocket("/api/ws/chat/{thread_id}")
async def ws_chat(websocket: WebSocket, thread_id: str, token: str = Query(...)):
    user = await get_user_from_token(token)
    if not user:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    await chat_hub.join(thread_id, websocket)
    try:
        await websocket.send_json({"type": "joined", "thread_id": thread_id, "user": user["email"]})
        while True:
            data = await websocket.receive_json()
            recipient_id = data.get("recipient_id")
            content = data.get("content", "")
            msg = {
                "_id": str(uuid.uuid4()),
                "thread_id": thread_id,
                "sender_id": user["_id"],
                "recipient_id": recipient_id,
                "content_encrypted": encrypt_field(content),
                "created_at": datetime.now(timezone.utc).isoformat(),
                "read": False,
            }
            await db.chat_messages.insert_one(msg)
            await chat_hub.broadcast(thread_id, {
                "type": "message",
                "id": msg["_id"],
                "thread_id": thread_id,
                "sender_id": user["_id"],
                "sender_email": user["email"],
                "content": content,
                "created_at": msg["created_at"],
            })
    except WebSocketDisconnect:
        pass
    finally:
        await chat_hub.leave(thread_id, websocket)


# ------------------------------------------------------------------
# Include router, CORS, startup
# ------------------------------------------------------------------
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    try:
        await db.users.create_index("email", unique=True)
        await db.vitals.create_index([("patient_id", 1), ("recorded_at", -1)])
        await db.vitals.create_index([("patient_id", 1), ("metric", 1), ("recorded_at", -1)])
        await db.prescriptions.create_index([("patient_id", 1), ("issued_at", -1)])
        await db.chat_messages.create_index([("thread_id", 1), ("created_at", 1)])
        await db.audit_log.create_index([("timestamp", -1)])
    except Exception as exc:
        logger.warning("index creation: %s", exc)

    try:
        from seed import run_seed
        result = await run_seed(db, force=False)
        logger.info("seed: %s", result)
    except Exception as exc:
        logger.exception("seed failed: %s", exc)

    # Ensure the emulator service account exists
    try:
        await _ensure_emulator_account()
    except Exception as exc:
        logger.exception("emulator account seed failed: %s", exc)


async def _ensure_emulator_account():
    """Create/refresh the system-role 'emulator' service account.
    Password from env EMULATOR_PASSWORD; auto-generated & persisted to .env if missing."""
    email = "emulator@pulsehub.system"
    password = os.environ.get("EMULATOR_PASSWORD")
    env_path = ROOT_DIR / ".env"
    if not password:
        import secrets
        password = "Emu-" + secrets.token_urlsafe(18)
        # append to .env so it survives restarts
        with open(env_path, "a") as f:
            f.write(f'\nEMULATOR_PASSWORD="{password}"\n')
        os.environ["EMULATOR_PASSWORD"] = password
        logger.info("generated EMULATOR_PASSWORD and saved to %s", env_path)

    existing = await db.users.find_one({"email": email})
    if not existing:
        await db.users.insert_one({
            "_id": str(uuid.uuid4()),
            "email": email,
            "password_hash": hash_password(password),
            "role": "system",
            "full_name": "Vitals Emulator",
            "premium": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
        logger.info("created emulator service account: %s", email)
    elif not verify_password(password, existing["password_hash"]):
        await db.users.update_one({"_id": existing["_id"]}, {"$set": {"password_hash": hash_password(password)}})
        logger.info("rotated emulator service-account password")


@app.on_event("shutdown")
async def on_shutdown():
    mongo_client.close()
