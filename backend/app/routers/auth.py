from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.auth import (
    create_session,
    generate_username,
    get_current_user,
    security,
    validate_phone_number,
    verify_otp,
)
from app.database import get_session
from app.models import Session as UserSession
from app.models import User
from app.routers.websocket import manager, publish_presence
from app.schemas import OTPRequest, OTPVerify, TokenResponse, UserRead, UserUpdate
from app.services import co_member_ids
from app.timeutil import utcnow

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/request-otp")
def request_otp(payload: OTPRequest) -> dict[str, str]:
    validate_phone_number(payload.phone_number)
    # Mock OTP: always succeeds; use code 123456 to verify.
    return {
        "message": "OTP sent (mock). Use code 123456 to verify.",
        "phone_number": payload.phone_number,
    }


@router.post("/verify-otp", response_model=TokenResponse)
def verify_otp_and_login(
    payload: OTPVerify,
    db: Annotated[Session, Depends(get_session)],
) -> TokenResponse:
    validate_phone_number(payload.phone_number)
    if not verify_otp(payload.otp):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid OTP. Mock code is 123456.",
        )

    user = db.exec(select(User).where(User.phone_number == payload.phone_number)).first()
    if not user:
        username = payload.username or generate_username(payload.phone_number)
        display_name = (payload.display_name or "").strip() or f"User {payload.phone_number[-4:]}"
        user = User(
            phone_number=payload.phone_number,
            username=username,
            display_name=display_name,
            is_online=True,
        )
        db.add(user)
        try:
            db.commit()
        except IntegrityError as exc:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="That username is already taken",
            ) from exc
        db.refresh(user)
    else:
        user.is_online = True
        db.add(user)
        db.commit()
        db.refresh(user)

    token, _ = create_session(db, user.id)
    return TokenResponse(access_token=token, user=UserRead.model_validate(user))


@router.get("/me", response_model=UserRead)
def get_me(current_user: Annotated[User, Depends(get_current_user)]) -> UserRead:
    return UserRead.model_validate(current_user)


@router.patch("/me", response_model=UserRead)
async def update_me(
    payload: UserUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> UserRead:
    """Edit your own profile; only the fields sent in the body are changed."""
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        if field in {"avatar_url", "status_message"} and isinstance(value, str):
            value = value.strip() or None
        setattr(current_user, field, value)
    db.add(current_user)
    db.commit()
    db.refresh(current_user)

    # Let people who share a conversation see the new name/avatar/about text right away.
    audience = co_member_ids(db, current_user.id) | {current_user.id}
    await manager.broadcast_to_users(
        audience,
        {"type": "user_updated", "user": UserRead.model_validate(current_user).model_dump(mode="json")},
    )
    return UserRead.model_validate(current_user)


@router.post("/logout")
async def logout(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    """Revoke the session this request was made with (other devices stay signed in)."""
    session = db.exec(
        select(UserSession).where(
            UserSession.user_id == current_user.id,
            UserSession.token == credentials.credentials,
        )
    ).first()
    if session:
        db.delete(session)

    # A live socket marks the user offline itself when it closes; otherwise do it here.
    went_offline = not manager.is_connected(current_user.id)
    if went_offline:
        current_user.is_online = False
        current_user.last_seen = utcnow()
        db.add(current_user)
    db.commit()
    if went_offline:
        await publish_presence(current_user.id)
    return {"message": "Logged out successfully"}
