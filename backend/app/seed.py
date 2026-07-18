"""
Seed script for the Signal Clone backend.

Creates mock users, contacts, conversations, and messages with varied timestamps
and read statuses. Message content is stored as plaintext (simulated encryption).

Run from the backend/ directory:
    python -m app.seed
"""

from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.database import create_db_and_tables, engine
from app.models import (
    Contact,
    Conversation,
    ConversationMember,
    ConversationType,
    DeliveryStatus,
    MemberRole,
    Message,
    MessageStatus,
    MessageType,
    User,
)


def seed() -> None:
    create_db_and_tables()

    with Session(engine) as db:
        existing = db.exec(select(User)).first()
        if existing:
            print("Database already seeded. Skipping.")
            return

        now = datetime.utcnow()

        users_data = [
            {
                "phone_number": "+15550010001",
                "username": "alice",
                "display_name": "Alice Chen",
                "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=alice",
                "status_message": "Available",
                "is_online": True,
            },
            {
                "phone_number": "+15550010002",
                "username": "bob",
                "display_name": "Bob Martinez",
                "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=bob",
                "status_message": "In a meeting",
                "is_online": False,
                "last_seen": now - timedelta(minutes=15),
            },
            {
                "phone_number": "+15550010003",
                "username": "carol",
                "display_name": "Carol Williams",
                "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=carol",
                "status_message": "On a hike",
                "is_online": True,
            },
            {
                "phone_number": "+15550010004",
                "username": "david",
                "display_name": "David Kim",
                "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=david",
                "status_message": "Busy",
                "is_online": False,
                "last_seen": now - timedelta(hours=2),
            },
            {
                "phone_number": "+15550010005",
                "username": "emma",
                "display_name": "Emma Johnson",
                "avatar_url": "https://api.dicebear.com/7.x/avataaars/svg?seed=emma",
                "status_message": "Hello!",
                "is_online": True,
            },
        ]

        users: list[User] = []
        for data in users_data:
            user = User(**data, created_at=now - timedelta(days=30))
            db.add(user)
            users.append(user)
        db.commit()
        for user in users:
            db.refresh(user)

        alice, bob, carol, david, emma = users

        contacts_data = [
            (alice.id, bob.id, "Bobby"),
            (alice.id, carol.id, None),
            (bob.id, alice.id, "Ali"),
            (bob.id, david.id, None),
            (carol.id, alice.id, None),
            (carol.id, emma.id, "Em"),
            (david.id, bob.id, None),
            (emma.id, carol.id, None),
        ]
        for owner_id, contact_user_id, nickname in contacts_data:
            db.add(
                Contact(
                    owner_id=owner_id,
                    contact_user_id=contact_user_id,
                    nickname=nickname,
                    created_at=now - timedelta(days=20),
                )
            )
        db.commit()

        # Direct conversation: Alice <-> Bob
        direct_ab = Conversation(
            type=ConversationType.DIRECT,
            created_by=alice.id,
            created_at=now - timedelta(days=14),
            updated_at=now - timedelta(minutes=5),
        )
        db.add(direct_ab)
        db.commit()
        db.refresh(direct_ab)

        for user_id in [alice.id, bob.id]:
            db.add(
                ConversationMember(
                    conversation_id=direct_ab.id,
                    user_id=user_id,
                    role=MemberRole.MEMBER,
                    joined_at=now - timedelta(days=14),
                )
            )

        # Direct conversation: Carol <-> Emma
        direct_ce = Conversation(
            type=ConversationType.DIRECT,
            created_by=carol.id,
            created_at=now - timedelta(days=10),
            updated_at=now - timedelta(hours=1),
        )
        db.add(direct_ce)
        db.commit()
        db.refresh(direct_ce)

        for user_id in [carol.id, emma.id]:
            db.add(
                ConversationMember(
                    conversation_id=direct_ce.id,
                    user_id=user_id,
                    role=MemberRole.MEMBER,
                    joined_at=now - timedelta(days=10),
                )
            )

        # Group conversation: Alice, Bob, Carol, David
        group = Conversation(
            type=ConversationType.GROUP,
            name="Weekend Plans",
            avatar_url="https://api.dicebear.com/7.x/identicon/svg?seed=weekend",
            created_by=alice.id,
            created_at=now - timedelta(days=7),
            updated_at=now - timedelta(minutes=30),
        )
        db.add(group)
        db.commit()
        db.refresh(group)

        for user_id, role in [
            (alice.id, MemberRole.ADMIN),
            (bob.id, MemberRole.MEMBER),
            (carol.id, MemberRole.MEMBER),
            (david.id, MemberRole.MEMBER),
        ]:
            db.add(
                ConversationMember(
                    conversation_id=group.id,
                    user_id=user_id,
                    role=role,
                    joined_at=now - timedelta(days=7),
                )
            )
        db.commit()

        # Simulated encryption: all message content is plaintext for demo purposes.
        messages_data = [
            # Alice-Bob direct (8 messages)
            (direct_ab.id, alice.id, "Hey Bob, are we still on for lunch?", MessageType.TEXT, None, now - timedelta(days=3, hours=2), DeliveryStatus.READ),
            (direct_ab.id, bob.id, "Yes! How about noon at the usual place?", MessageType.TEXT, None, now - timedelta(days=3, hours=1, minutes=55), DeliveryStatus.READ),
            (direct_ab.id, alice.id, "Perfect, see you there.", MessageType.TEXT, None, now - timedelta(days=3, hours=1, minutes=50), DeliveryStatus.READ),
            (direct_ab.id, bob.id, "Running 5 min late, sorry!", MessageType.TEXT, None, now - timedelta(days=2, hours=4), DeliveryStatus.READ),
            (direct_ab.id, alice.id, "No worries, I'll grab a table.", MessageType.TEXT, None, now - timedelta(days=2, hours=3, minutes=58), DeliveryStatus.READ),
            (direct_ab.id, bob.id, "Check out this photo from yesterday", MessageType.IMAGE, None, now - timedelta(days=1, hours=6), DeliveryStatus.DELIVERED),
            (direct_ab.id, alice.id, "Nice shot! Where was that?", MessageType.TEXT, 6, now - timedelta(days=1, hours=5, minutes=30), DeliveryStatus.READ),
            (direct_ab.id, bob.id, "Central Park, near the fountain.", MessageType.TEXT, None, now - timedelta(minutes=5), DeliveryStatus.SENT),

            # Carol-Emma direct (4 messages)
            (direct_ce.id, carol.id, "Emma, want to go hiking this weekend?", MessageType.TEXT, None, now - timedelta(days=2), DeliveryStatus.READ),
            (direct_ce.id, emma.id, "Absolutely! Which trail?", MessageType.TEXT, None, now - timedelta(days=2, minutes=-30), DeliveryStatus.READ),
            (direct_ce.id, carol.id, "Bear Mountain trail, moderate difficulty.", MessageType.TEXT, None, now - timedelta(days=1, hours=12), DeliveryStatus.DELIVERED),
            (direct_ce.id, emma.id, "I'll pack snacks!", MessageType.TEXT, None, now - timedelta(hours=1), DeliveryStatus.SENT),

            # Group (8 messages)
            (group.id, alice.id, "Who's free Saturday afternoon?", MessageType.TEXT, None, now - timedelta(days=5), DeliveryStatus.READ),
            (group.id, bob.id, "I'm in!", MessageType.TEXT, None, now - timedelta(days=5, minutes=-20), DeliveryStatus.READ),
            (group.id, carol.id, "Same here", MessageType.TEXT, None, now - timedelta(days=4, hours=18), DeliveryStatus.READ),
            (group.id, david.id, "Maybe — depends on work", MessageType.TEXT, None, now - timedelta(days=4, hours=12), DeliveryStatus.DELIVERED),
            (group.id, alice.id, "Let's plan a picnic in the park", MessageType.TEXT, None, now - timedelta(days=2, hours=8), DeliveryStatus.READ),
            (group.id, bob.id, "I'll bring drinks", MessageType.TEXT, None, now - timedelta(days=1, hours=20), DeliveryStatus.READ),
            (group.id, carol.id, "Here's the park map", MessageType.FILE, None, now - timedelta(hours=6), DeliveryStatus.DELIVERED),
            (group.id, david.id, "Count me in now!", MessageType.TEXT, None, now - timedelta(minutes=30), DeliveryStatus.SENT),
        ]

        reply_message_ids: dict[int, int] = {}

        for idx, (conv_id, sender_id, content, msg_type, reply_idx, created_at, _) in enumerate(messages_data):
            reply_to = reply_message_ids.get(reply_idx) if reply_idx else None
            msg = Message(
                conversation_id=conv_id,
                sender_id=sender_id,
                content=content,
                type=msg_type,
                reply_to_message_id=reply_to,
                created_at=created_at,
            )
            db.add(msg)
            db.commit()
            db.refresh(msg)
            reply_message_ids[idx + 1] = msg.id

        all_messages = db.exec(select(Message)).all()
        for msg in all_messages:
            members = db.exec(
                select(ConversationMember).where(
                    ConversationMember.conversation_id == msg.conversation_id
                )
            ).all()
            for member in members:
                if member.user_id == msg.sender_id:
                    status = DeliveryStatus.SENT
                elif msg.created_at < now - timedelta(hours=12):
                    status = DeliveryStatus.READ
                elif msg.created_at < now - timedelta(hours=2):
                    status = DeliveryStatus.DELIVERED
                else:
                    status = DeliveryStatus.SENT
                db.add(
                    MessageStatus(
                        message_id=msg.id,
                        user_id=member.user_id,
                        status=status,
                        updated_at=msg.created_at + timedelta(minutes=5),
                    )
                )
        db.commit()

        print("Seed complete!")
        print(f"  Users: {len(users)}")
        print(f"  Contacts: {len(contacts_data)}")
        print("  Conversations: 3 (2 direct, 1 group)")
        print(f"  Messages: {len(messages_data)}")
        print("\nTest login with any phone number and OTP: 123456")
        print("Example: POST /api/auth/verify-otp")
        print('  {"phone_number": "+15550010001", "otp": "123456"}')


if __name__ == "__main__":
    seed()
