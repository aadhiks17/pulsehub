"""Pydantic models for PulseHub Phase 0."""

from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

# We intentionally use plain `str` for emails (with a light format check) so we can
# accept reserved test TLDs like `.test` for seeded accounts.
EmailStr = str


Role = Literal["patient", "doctor", "admin"]
Device = Literal["cgm", "pulseox"]
Metric = Literal["glucose", "hr", "spo2"]
Severity = Literal["normal", "warning", "critical"]


# ---------- Auth ----------

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str
    role: Role = "patient"
    specialty: Optional[str] = None  # required for doctors
    assigned_doctor_id: Optional[str] = None  # for patients
    premium: bool = False


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str = Field(alias="_id")
    email: EmailStr
    role: Role
    full_name: str
    premium: bool = False
    assigned_doctor_id: Optional[str] = None
    specialty: Optional[str] = None
    created_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


# ---------- Vitals ----------

class VitalCreate(BaseModel):
    patient_id: str
    device: Device
    metric: Metric
    value: float
    unit: Optional[str] = None
    recorded_at: Optional[datetime] = None  # if omitted, server uses now


class VitalRead(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str = Field(alias="_id")
    patient_id: str
    device: Device
    metric: Metric
    value: float  # decrypted value
    unit: Optional[str] = None
    recorded_at: datetime
    severity: Severity


# ---------- Patients ----------

class PatientSummary(BaseModel):
    id: str
    full_name: str
    email: EmailStr
    premium: bool
    assigned_doctor_id: Optional[str] = None
    latest: dict  # {metric: {value, unit, severity, recorded_at}}
    risk_level: Severity


# ---------- Prescriptions ----------

class PrescriptionCreate(BaseModel):
    patient_id: str
    drug: str
    dosage: str
    frequency: str
    notes: Optional[str] = None


class PrescriptionRead(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str = Field(alias="_id")
    patient_id: str
    doctor_id: str
    drug: str
    dosage: str
    frequency: str
    notes: Optional[str] = None
    issued_at: datetime
