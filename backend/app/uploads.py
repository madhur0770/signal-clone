"""Attachment storage.

Files are written to ``UPLOAD_DIR`` under an unguessable random name and served back
through ``GET /api/uploads/{filename}``. The URL itself is the capability: only members
of the conversation it was sent to ever see it.

Note: on hosts with an ephemeral filesystem the directory is wiped on every deploy
(the same is true of the default SQLite database), so mount a persistent volume and
point ``UPLOAD_DIR`` / ``DATABASE_URL`` at it if attachments need to survive restarts.
"""

import os
import re
import secrets
from pathlib import Path

from fastapi import HTTPException, UploadFile, status

from app.models import MessageType
from app.schemas import AttachmentRead

UPLOAD_URL_PREFIX = "/api/uploads/"
CHUNK_SIZE = 1024 * 256

# Raster images only: SVG can carry script, so it is treated like any other file.
IMAGE_TYPES = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
}

_SAFE_NAME = re.compile(r"^[A-Za-z0-9_-]{16,64}(\.[A-Za-z0-9]{1,10})?$")
_SAFE_EXTENSION = re.compile(r"^\.[A-Za-z0-9]{1,10}$")


def upload_dir() -> Path:
    path = Path(os.getenv("UPLOAD_DIR", "./uploads")).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def max_upload_bytes() -> int:
    return int(float(os.getenv("MAX_UPLOAD_MB", "10")) * 1024 * 1024)


def resolve_upload(filename: str) -> Path | None:
    """Map a public filename to its path on disk, or None if invalid/missing."""
    if not _SAFE_NAME.match(filename):
        return None
    path = upload_dir() / filename
    return path if path.is_file() else None


def url_to_filename(url: str) -> str | None:
    if not url.startswith(UPLOAD_URL_PREFIX):
        return None
    filename = url[len(UPLOAD_URL_PREFIX) :]
    return filename if _SAFE_NAME.match(filename) else None


def validate_attachment_url(url: str) -> Path:
    """Only accept URLs that point at a file we stored (blocks arbitrary/javascript: URLs)."""
    filename = url_to_filename(url)
    path = resolve_upload(filename) if filename else None
    if path is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown attachment"
        )
    return path


def delete_upload(url: str | None) -> None:
    if not url:
        return
    filename = url_to_filename(url)
    path = resolve_upload(filename) if filename else None
    if path is not None:
        try:
            path.unlink()
        except OSError:
            pass


async def save_upload(file: UploadFile) -> AttachmentRead:
    original = Path(file.filename or "file").name or "file"
    extension = Path(original).suffix.lower()
    if not _SAFE_EXTENSION.match(extension):
        extension = ""

    limit = max_upload_bytes()
    stored_name = f"{secrets.token_urlsafe(18)}{extension}"
    destination = upload_dir() / stored_name
    size = 0
    try:
        with destination.open("wb") as out:
            while chunk := await file.read(CHUNK_SIZE):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large (max {limit // (1024 * 1024)} MB)",
                    )
                out.write(chunk)
        if size == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file"
            )
    except BaseException:
        destination.unlink(missing_ok=True)
        raise

    mime = IMAGE_TYPES.get(extension, "application/octet-stream")
    return AttachmentRead(
        url=f"{UPLOAD_URL_PREFIX}{stored_name}",
        name=original[:255],
        mime=mime,
        size=size,
        type=MessageType.IMAGE if extension in IMAGE_TYPES else MessageType.FILE,
    )
