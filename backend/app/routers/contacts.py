from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.auth import get_current_user
from app.database import get_session
from app.models import Contact, User
from app.schemas import ContactCreate, ContactRead, ContactUpdate, UserRead

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("", response_model=list[ContactRead])
def list_contacts(
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> list[ContactRead]:
    contacts = db.exec(select(Contact).where(Contact.owner_id == current_user.id)).all()
    result = []
    for contact in contacts:
        contact_user = db.get(User, contact.contact_user_id)
        if not contact_user:
            continue
        result.append(
            ContactRead(
                id=contact.id,
                owner_id=contact.owner_id,
                contact_user_id=contact.contact_user_id,
                nickname=contact.nickname,
                created_at=contact.created_at,
                contact_user=UserRead.model_validate(contact_user),
            )
        )
    return result


@router.post("", response_model=ContactRead, status_code=status.HTTP_201_CREATED)
def add_contact(
    payload: ContactCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> ContactRead:
    if payload.contact_user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot add yourself as a contact",
        )

    contact_user = db.get(User, payload.contact_user_id)
    if not contact_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    existing = db.exec(
        select(Contact).where(
            Contact.owner_id == current_user.id,
            Contact.contact_user_id == payload.contact_user_id,
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Contact already exists",
        )

    contact = Contact(
        owner_id=current_user.id,
        contact_user_id=payload.contact_user_id,
        nickname=payload.nickname,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)

    return ContactRead(
        id=contact.id,
        owner_id=contact.owner_id,
        contact_user_id=contact.contact_user_id,
        nickname=contact.nickname,
        created_at=contact.created_at,
        contact_user=UserRead.model_validate(contact_user),
    )


@router.patch("/{contact_id}", response_model=ContactRead)
def update_contact(
    contact_id: int,
    payload: ContactUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> ContactRead:
    contact = db.get(Contact, contact_id)
    if not contact or contact.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")

    if payload.nickname is not None:
        contact.nickname = payload.nickname
    db.add(contact)
    db.commit()
    db.refresh(contact)

    contact_user = db.get(User, contact.contact_user_id)
    return ContactRead(
        id=contact.id,
        owner_id=contact.owner_id,
        contact_user_id=contact.contact_user_id,
        nickname=contact.nickname,
        created_at=contact.created_at,
        contact_user=UserRead.model_validate(contact_user),
    )


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: int,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[Session, Depends(get_session)],
) -> None:
    contact = db.get(Contact, contact_id)
    if not contact or contact.owner_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    db.delete(contact)
    db.commit()
