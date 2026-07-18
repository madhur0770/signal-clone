import os
import re
import secrets
from datetime import datetime, timedelta
from typing import Annotated

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlmodel import Session, select

from app.database import get_session
from app.models import Session as UserSession
from app.models import User

load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "10080"))
MOCK_OTP_CODE = "123456"

security = HTTPBearer()


def validate_phone_number(phone_number: str) -> None:
    if not re.match(r"^\+[1-9]\d{9,14}$", phone_number):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid phone number format. Use format: +[country code][number], e.g. +15550010001",
        )


def create_access_token(user_id: int) -> tuple[str, datetime]:
    expires_at = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expires_at}
    token = jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
    return token, expires_at


def create_session(session: Session, user_id: int) -> tuple[str, UserSession]:
    token, expires_at = create_access_token(user_id)
    db_session = UserSession(user_id=user_id, token=token, expires_at=expires_at)
    session.add(db_session)
    session.commit()
    session.refresh(db_session)
    return token, db_session


def verify_otp(otp: str) -> bool:
    return otp == MOCK_OTP_CODE


def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(security)],
    db: Annotated[Session, Depends(get_session)],
) -> User:
    token = credentials.credentials
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError as exc:
        raise credentials_exception from exc

    db_session = db.exec(
        select(UserSession).where(
            UserSession.token == token,
            UserSession.expires_at > datetime.utcnow(),
        )
    ).first()
    if not db_session:
        raise credentials_exception

    user = db.get(User, int(user_id))
    if not user:
        raise credentials_exception
    return user


def get_current_user_from_token(token: str, db: Session) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError as exc:
        raise credentials_exception from exc

    db_session = db.exec(
        select(UserSession).where(
            UserSession.token == token,
            UserSession.expires_at > datetime.utcnow(),
        )
    ).first()
    if not db_session:
        raise credentials_exception

    user = db.get(User, int(user_id))
    if not user:
        raise credentials_exception
    return user


def generate_username(phone_number: str) -> str:
    suffix = phone_number.replace("+", "").replace("-", "")[-4:]
    return f"user_{suffix}_{secrets.token_hex(3)}"