from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.auth import (
    create_session,
    generate_username,
    get_current_user,
    validate_phone_number,
    verify_otp,
)
from app.database import get_session
from app.models import User
from app.schemas import OTPRequest, OTPVerify, TokenResponse, UserRead

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
        display_name = payload.display_name or f"User {payload.phone_number[-4:]}"
        user = User(
            phone_number=payload.phone_number,
            username=username,
            display_name=display_name,
            is_online=True,
        )
        db.add(user)
        db.commit()
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


@router.post("/logout")
def logout(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> dict[str, str]:
    from app.models import Session as UserSession

    sessions = db.exec(
        select(UserSession).where(UserSession.user_id == current_user.id)
    ).all()
    for session in sessions:
        db.delete(session)

    current_user.is_online = False
    db.add(current_user)
    db.commit()
    return {"message": "Logged out successfully"}