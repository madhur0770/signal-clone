from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.auth import get_current_user
from app.models import User
from app.schemas import AttachmentRead
from app.uploads import IMAGE_TYPES, resolve_upload, save_upload

router = APIRouter(prefix="/uploads", tags=["uploads"])


@router.post("", response_model=AttachmentRead, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    file: UploadFile,
    current_user: Annotated[User, Depends(get_current_user)],
) -> AttachmentRead:
    """Upload a file, then send a message of the returned ``type`` referencing its ``url``."""
    return await save_upload(file)


@router.get("/{filename}")
def download_attachment(filename: str) -> FileResponse:
    """Serve an uploaded file. The random filename is the access token."""
    path = resolve_upload(filename)
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    headers = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, max-age=3600",
    }
    media_type = IMAGE_TYPES.get(path.suffix.lower())
    if media_type is None:
        # Anything that isn't a plain raster image is only ever downloaded, never rendered.
        return FileResponse(
            path,
            media_type="application/octet-stream",
            filename=path.name,
            headers=headers,
            content_disposition_type="attachment",
        )
    return FileResponse(path, media_type=media_type, headers=headers)
