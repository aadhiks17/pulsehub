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
    user = await db.users.find_one({"email": req.email.lower()})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["_id"], user["email"], user["role"])
    await audit(user["_id"], "login", user["_id"], request.client.host if request.client else None)
    return {"access_token": token, "token_type": "bearer", "user": _user_public(user)}


@api.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return _user_public(user)


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
    if user["role"] not in ("doctor", "admin"):
        raise HTTPException(status_code=403, detail="Only doctors or admins can list patients")

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
    if user["role"] == "patient" and req.patient_id != user["_id"]:
        raise HTTPException(status_code=403, detail="Patients can only submit their own vitals")
    if user["role"] == "doctor":
        target = await db.users.find_one({"_id": req.patient_id})
        if not target or target.get("assigned_doctor_id") != user["_id"]:
            raise HTTPException(status_code=403, detail="Patient not assigned to this doctor")

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


@app.on_event("shutdown")
async def on_shutdown():
    mongo_client.close()
