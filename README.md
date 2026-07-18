# Signal Clone

A functional clone of Signal Messenger — real-time one-on-one and group messaging, built as an SDE Fullstack assignment. Recreates Signal's core UX (conversation list, chat bubbles, delivery/read receipts, typing indicators) with a FastAPI backend and a Next.js frontend. End-to-end encryption is simulated/mocked per the assignment brief — message content is stored as plaintext for demo purposes.

**GitHub repo:** https://github.com/madhur0770/signal-clone
**Live demo (frontend):** https://signal-clone-liard.vercel.app
**Backend API:** https://signal-clone-production-df99.up.railway.app (interactive docs at `/docs`)

---

## Tech Stack

**Frontend**
- Next.js 16 (App Router), TypeScript
- Zustand (state management, with `persist` middleware for session/theme)
- Tailwind CSS v4
- Axios (HTTP client)
- Native WebSocket client for real-time events
- lucide-react (icons), date-fns (time formatting)

**Backend**
- FastAPI (Python)
- SQLModel (SQLAlchemy + Pydantic) as the ORM/schema layer
- SQLite (file-based database)
- JWT (`python-jose`) for auth tokens, backed by a `sessions` table for validation/revocation
- Native WebSockets for real-time messaging, typing indicators, and live conversation updates

---

## Architecture Overview

This is a monorepo with two independent apps:

```
signal-clone/
├── backend/
│   └── app/
│       ├── models.py         # SQLModel table definitions
│       ├── schemas.py        # Pydantic request/response schemas
│       ├── auth.py           # JWT + session helpers, phone validation
│       ├── database.py       # DB engine/session setup
│       ├── seed.py           # Seed script (users, contacts, conversations, messages)
│       └── routers/
│           ├── auth.py           # /api/auth — OTP login, session, logout
│           ├── contacts.py       # /api/contacts — CRUD, search, block/unblock
│           ├── conversations.py  # /api/conversations — create, list, members
│           ├── messages.py       # /api/... — send/list messages, status updates
│           └── websocket.py      # /api/ws — WebSocket connection manager
└── frontend/
    ├── app/                  # Next.js routes (login, chat, etc.)
    ├── components/           # UI components (ChatPane, MessageBubble, modals, etc.)
    ├── store/useStore.ts     # Single Zustand store — auth, conversations, messages, UI state
    └── lib/
        ├── api.ts            # Axios client + typed API functions
        ├── ws.ts             # WebSocket client wrapper
        └── utils.ts          # Formatting/helper functions
```

**Auth flow:** Phone number + mocked OTP (fixed code `123456`) → backend issues a JWT and creates a row in the `sessions` table → token stored client-side (Zustand `persist`, localStorage) and sent as a Bearer token on every request, and as a query param on the WebSocket handshake. The backend validates WebSocket connections against the same `sessions` table, so deleting/expiring a session invalidates both REST and WS access.

**Real-time flow:** A single WebSocket connection per client is managed server-side by a connection manager (`routers/websocket.py`). On message send, member-add/remove, group creation, etc., the backend broadcasts an event to all connected members of the affected conversation. The frontend's `WebSocketBridge` component listens for these events and updates the Zustand store directly, which re-renders the relevant UI (message list, unread badges, typing indicator, toast notifications).

**State management:** All client state lives in one Zustand store (`useStore.ts`). Only `token`, `user`, and `darkMode` are persisted to localStorage (`partialize`) — messages, conversations, and typing state are re-fetched/re-derived on load, since they're expected to change frequently and shouldn't go stale in storage.

---

## Database Schema

All tables are defined via SQLModel in `backend/app/models.py`.

**users**
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| phone_number | str, unique | |
| username | str, unique | |
| display_name | str | |
| avatar_url | str, nullable | falls back to auto-generated initials in the UI if null |
| status_message | str, nullable | |
| last_seen | datetime, nullable | |
| is_online | bool | |
| created_at | datetime | |

**contacts** — one-directional; each user has their own contact list
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| owner_id | int, FK → users.id | |
| contact_user_id | int, FK → users.id | |
| nickname | str, nullable | |
| is_blocked | bool | default false; enforced in direct-message sending |
| created_at | datetime | |

**conversations**
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| type | enum: `direct` \| `group` | |
| name | str, nullable | group name; null for direct chats |
| avatar_url | str, nullable | |
| created_by | int, FK → users.id | |
| created_at / updated_at | datetime | `updated_at` bumped on every new message, drives conversation-list sort order |

**conversation_members** — join table, conversation ↔ user
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| conversation_id | int, FK → conversations.id | |
| user_id | int, FK → users.id | |
| role | enum: `admin` \| `member` | admin controls (add/remove) gated on this |
| joined_at | datetime | |

**messages**
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| conversation_id | int, FK → conversations.id | |
| sender_id | int, FK → users.id | |
| content | str | plaintext (encryption simulated, not real, per assignment spec) |
| type | enum: `text` \| `image` \| `file` | image/file types defined for future use; only `text` is implemented |
| reply_to_message_id | int, FK → messages.id, nullable | self-referential, supports reply-to (backend-ready; UI not yet built) |
| created_at | datetime | |

**message_status** — per-recipient delivery state
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| message_id | int, FK → messages.id | |
| user_id | int, FK → users.id | one row per conversation member per message |
| status | enum: `sent` \| `delivered` \| `read` | sender's own row is always `sent`; recipients start `delivered`, flip to `read` when they open the conversation |
| updated_at | datetime | |

**sessions**
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| user_id | int, FK → users.id | |
| token | str, unique | the JWT string itself |
| created_at / expires_at | datetime | |

**Relationships summary:** one user → many contacts, many memberships, many sent messages, many sessions. One conversation → many members, many messages. One message → many statuses (one per conversation member) and optionally one reply-to reference to another message.

---

## API Overview

All routes are prefixed with `/api`. Auth via `Authorization: Bearer <token>` header (except the OTP request/verify endpoints themselves).

**Auth**
- `POST /auth/request-otp` — mocked, always "sends" OTP `123456`
- `POST /auth/verify-otp` — verifies OTP, creates user on first login (registration), returns JWT + user
- `GET /auth/me` — current user
- `POST /auth/logout` — invalidates session

**Contacts**
- `GET /contacts` — list current user's contacts
- `GET /contacts/search?q=` — search users by username/display name/phone (excludes self and existing contacts)
- `POST /contacts` — add a contact
- `PATCH /contacts/{id}` — update nickname
- `DELETE /contacts/{id}` — remove contact
- `POST /contacts/{id}/block` / `POST /contacts/{id}/unblock` — toggle blocking; enforced server-side on direct-message sending (mutual — either party blocking stops both directions)

**Conversations**
- `GET /conversations` — list current user's conversations
- `POST /conversations` — create direct or group conversation
- `POST /conversations/{id}/members` — add member (group only)
- `DELETE /conversations/{id}/members/{user_id}` — remove member / leave group

**Messages**
- `GET /conversations/{id}/messages` — paginated message history
- `POST /conversations/{id}/messages` — send message; broadcasts via WebSocket to all members; blocked if either party has blocked the other (direct conversations only)
- `PATCH /messages/{id}/status` — update delivery/read status

**WebSocket**
- `GET /ws?token=<jwt>` — persistent connection; server pushes `message`, `typing`, and `conversation_created` events to relevant connected clients

---

## Setup Instructions

The app is already deployed and live (see links above) — the steps below are only needed for running it locally.

### Backend

```bash
cd backend
python -m venv venv
# Windows:
.\venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # fill in any required values, e.g. JWT secret

python -m app.seed              # seeds sample users/contacts/conversations/messages
uvicorn app.main:app --reload --port 8000
```

Backend runs at `http://localhost:8000`. Interactive API docs at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:3000`. Set `NEXT_PUBLIC_API_URL` in a `.env.local` if your backend isn't at `http://localhost:8000`.

### Test login

Any seeded phone number with OTP `123456`. See `backend/app/seed.py` for the full list of seeded users, or register a new account directly through the app (OTP is mocked and always accepts `123456`).

---

## Assumptions & Design Decisions

- **Encryption is simulated, not real** — message content is stored as plaintext, per the assignment's explicit allowance.
- **Avatars** are auto-generated from initials when no `avatar_url` is set, rather than requiring manual upload — a common, acceptable pattern and not required by the brief.
- **Search** (conversations/contacts) matches against names/username/phone, not full message content — treated as contact/conversation discovery, not a message search feature.
- **Blocking is mutual and direct-conversation-only** — if either party has blocked the other, sending fails in both directions; group messaging is unaffected by 1:1 blocks, matching Signal's real behavior.
- **"Sending" message status** is implemented as an optimistic client-side UI state (shown immediately on send, before server confirmation) rather than a persisted database status, since a message that fails to send is never actually written to the database.
- **Presence (online/last-seen)** is mocked/best-effort, not derived from real connection heartbeats beyond what the WebSocket connection lifecycle naturally provides.

## Feature Status

**Must-haves:** all implemented — auth/OTP, contacts, 1:1 messaging (real-time, timestamps, receipts, typing, all four message statuses), group messaging (create/message/members/admin controls), toasts, settings placeholders.

**Bonus:** dark mode ✅, keyboard shortcuts (Enter to send, Esc to close modals) ✅, profile viewer + block/unblock ✅ (not required by brief, added for completeness). Reply-to, reactions, attachments, disappearing messages, and a full responsive-design pass are not implemented in this submission.
