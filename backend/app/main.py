import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session

from app import database
from app.database import create_db_and_tables
from app.routers import auth, contacts, conversations, messages, uploads, websocket
from app.services import purge_expired

logger = logging.getLogger(__name__)

PURGE_INTERVAL_SECONDS = float(os.getenv("PURGE_INTERVAL_SECONDS", "5"))


async def purge_loop() -> None:
    """Delete disappearing messages once their timer runs out and tell the clients."""
    while True:
        await asyncio.sleep(PURGE_INTERVAL_SECONDS)
        try:
            with Session(database.engine) as db:
                removed = purge_expired(db)
                for conversation_id, message_ids in removed.items():
                    await websocket.manager.broadcast_to_conversation(
                        conversation_id,
                        {
                            "type": "messages_expired",
                            "conversation_id": conversation_id,
                            "message_ids": message_ids,
                        },
                        db,
                    )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("failed to purge expired messages")


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_db_and_tables()
    if os.getenv("SEED_ON_START", "").lower() in {"1", "true", "yes"}:
        from app.seed import seed

        seed()
    task = asyncio.create_task(purge_loop())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Signal Clone API",
    description="Mock messaging backend with simulated OTP and encryption.",
    version="1.1.0",
    lifespan=lifespan,
)

_allowed_origins = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    # Optional regex, e.g. https://signal-clone-.*\.vercel\.app for Vercel preview URLs.
    allow_origin_regex=os.getenv("ALLOWED_ORIGIN_REGEX") or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(contacts.router, prefix="/api")
app.include_router(conversations.router, prefix="/api")
app.include_router(messages.router, prefix="/api")
app.include_router(uploads.router, prefix="/api")
app.include_router(websocket.router, prefix="/api")


@app.get("/")
def root() -> dict[str, str]:
    return {"message": "Signal Clone API", "docs": "/docs"}


@app.get("/health")
@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
