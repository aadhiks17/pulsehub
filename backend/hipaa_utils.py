"""
HIPAA utility module — AES-GCM field-level encryption + role-based access control.

NOTE on the encryption trade-off:
We store sensitive vitals values both as `value` (encrypted, base64 of nonce+ciphertext+tag)
and `value_plain` (the numeric value in cleartext). Field-level encryption on numeric
columns prevents MongoDB from doing range queries, aggregations, or sorting. For Phase 0
we accept this trade-off so dashboards/analytics can function. In Phase 2+ we will move
historical analytics to a dedicated indexed store and drop `value_plain`.
"""

from __future__ import annotations

import base64
import functools
import os
from typing import Iterable

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi import HTTPException, status


def _get_key() -> bytes:
    raw = os.environ.get("FIELD_ENCRYPTION_KEY")
    if not raw:
        raise RuntimeError("FIELD_ENCRYPTION_KEY is not configured")
    key = base64.b64decode(raw)
    if len(key) != 32:
        raise RuntimeError("FIELD_ENCRYPTION_KEY must decode to 32 bytes (AES-256)")
    return key


def encrypt_field(plaintext: str) -> str:
    """Encrypt a string with AES-GCM. Returns base64(nonce || ciphertext || tag)."""
    if plaintext is None:
        return None
    aesgcm = AESGCM(_get_key())
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, str(plaintext).encode("utf-8"), None)
    return base64.b64encode(nonce + ct).decode("ascii")


def decrypt_field(ciphertext: str) -> str:
    """Decrypt a string previously produced by encrypt_field."""
    if ciphertext is None:
        return None
    blob = base64.b64decode(ciphertext)
    nonce, ct = blob[:12], blob[12:]
    aesgcm = AESGCM(_get_key())
    return aesgcm.decrypt(nonce, ct, None).decode("utf-8")


def require_role(*roles: str):
    """
    FastAPI dependency factory enforcing role claim on the JWT.
    Usage:
        @router.get("/admin-thing", dependencies=[Depends(require_role("admin"))])
    or as a sub-dependency that also returns the user:
        user = Depends(require_role("doctor", "admin"))
    """
    allowed = set(roles)

    # Lazy import to break the auth <-> hipaa_utils cycle
    from auth import get_current_user

    async def _checker(user: dict = None):
        # When used as Depends(require_role(...)), FastAPI will resolve get_current_user
        # via the wrapper below.
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
        if user.get("role") not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.get('role')}' not permitted (need one of: {sorted(allowed)})",
            )
        return user

    from fastapi import Depends

    async def _dep(user: dict = Depends(get_current_user)) -> dict:
        return await _checker(user)

    return _dep
