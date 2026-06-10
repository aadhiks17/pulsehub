"""Shared MongoDB handle.

Lives in its own module so that `auth.py` and `billing.py` can reach the same
`db` instance without importing `server.py` (which would create a cycle).
"""

from __future__ import annotations

import os

from motor.motor_asyncio import AsyncIOMotorClient

mongo_client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = mongo_client[os.environ["DB_NAME"]]
