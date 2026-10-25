# Signal Clone

A functional clone of Signal Messenger — real-time one-on-one and group messaging, built as an SDE Fullstack assignment. Recreates Signal's core UX (conversation list, chat bubbles, delivery/read receipts, typing indicators) with a FastAPI backend and a Next.js frontend. End-to-end encryption is simulated/mocked per the assignment brief — message content is stored as plaintext for demo purposes.

**GitHub repo:** https://github.com/madhur0770/signal-clone
**Live demo (frontend):** https://signal-clone-liard.vercel.app
**Backend API:** https://signal-clone-api-17e2.onrender.com (interactive docs at `/docs`). It runs on a free plan and sleeps when idle, so the first request after a quiet period can take up to 30 seconds.

---

## Tech Stack

**Frontend**
- Next.js 16 (App Router), TypeScript
- Zustand (state management, with `persist` middleware for session/theme)
- Tailwind CSS v4
- Axios (HTTP client)
- Native WebSocket client for real-time events
- lucide-react (icons)
- Vitest + Testing Library for tests

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
│       ├── database.py       # DB engine/session setup + startup column migration
│       ├── services.py       # Membership/blocking rules, message creation, status + expiry logic
│       ├── uploads.py        # Attachment storage and validation
│       ├── timeutil.py       # Naive-UTC clock helper
│       ├── seed.py           # Seed script (users, contacts, conversations, messages)
│       └── routers/
│           ├── auth.py           # /api/auth — OTP login, session, logout
│           ├── contacts.py       # /api/contacts — CRUD, search, block/unblock
│           ├── conversations.py  # /api/conversations — create, list, members
│           ├── messages.py       # /api/... — send/list messages, status, read, reactions
│           ├── uploads.py        # /api/uploads — attachment upload/download
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
| disappear_after_seconds | int, nullable | disappearing-message timer; null = off |
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
| type | enum: `text` \| `image` \| `file` | |
| reply_to_message_id | int, FK → messages.id, nullable | self-referential, powers reply-to |
| attachment_url / attachment_name / attachment_mime / attachment_size | nullable | set for `image` and `file` messages |
| expires_at | datetime, nullable, indexed | set when the conversation has a disappearing-message timer |
| created_at | datetime | |

**message_status** — per-recipient delivery state
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| message_id | int, FK → messages.id | |
| user_id | int, FK → users.id | one row per conversation member per message |
| status | enum: `sent` \| `delivered` \| `read` | sender's own row is always `sent`; recipients start `sent`, become `delivered` when they are online or next connect, and `read` when they open the conversation. Status never moves backwards |
| updated_at | datetime | |

**message_reactions** — one reaction per user per message
| Column | Type | Notes |
|---|---|---|
| id | int, PK | |
| message_id | int, FK → messages.id | |
| user_id | int, FK → users.id | unique together with message_id |
| emoji | str | |
| created_at | datetime | |

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
- `PATCH /auth/me` — update display name / status message
- `POST /auth/logout` — invalidates the current session only

**Contacts**
- `GET /contacts` — list current user's contacts
- `GET /contacts/search?q=` — search users by username/display name/phone (excludes self and existing contacts)
- `POST /contacts` — add a contact
- `PATCH /contacts/{id}` — update nickname
- `DELETE /contacts/{id}` — remove contact
- `POST /contacts/{id}/block` / `POST /contacts/{id}/unblock` — toggle blocking; enforced server-side on direct-message sending (mutual — either party blocking stops both directions)

**Conversations**
- `GET /conversations` — list current user's conversations, each with `last_message` and `unread_count`
- `PATCH /conversations/{id}` — rename a group / set the disappearing-message timer (`30s, 5m, 1h, 8h, 24h, 1w` or off)
- `PATCH /conversations/{id}/members/{user_id}` — promote/demote an admin
- `DELETE /conversations/{id}` — delete a conversation once it has no members
- `POST /conversations` — create direct or group conversation
- `POST /conversations/{id}/members` — add member (group only)
- `DELETE /conversations/{id}/members/{user_id}` — remove member / leave group

**Messages**
- `GET /conversations/{id}/messages?limit=&before_id=` — message history, newest page first, paginated with `before_id`
- `POST /conversations/{id}/read` — mark everything in the conversation read in one request
- `PUT /messages/{id}/reaction` / `DELETE /messages/{id}/reaction` — set or clear your reaction
- `POST /conversations/{id}/messages` — send message; broadcasts via WebSocket to all members; blocked if either party has blocked the other (direct conversations only)
- `PATCH /messages/{id}/status` — update delivery/read status

**Uploads**
- `POST /uploads` — upload an attachment (multipart, 10 MB limit by default); returns the URL to attach to a message
- `GET /uploads/{filename}` — fetch it. Raster images are shown inline; everything else is download-only

**Health**
- `GET /health` and `GET /api/health`

**WebSocket**
- `GET /ws?token=<jwt>` — persistent connection; server pushes `message`, `message_status`, `messages_status`, `reaction`, `messages_expired`, `typing`, `presence`, `user_updated`, `conversation_created`, `conversation_updated`, `member_added` and `member_removed` events to the relevant connected clients. The client reconnects automatically with backoff and re-syncs on reconnect

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

pip install -r requirements-dev.txt   # or requirements.txt for runtime only
cp .env.example .env   # fill in any required values, e.g. JWT secret

python -m app.seed              # seeds sample users/contacts/conversations/messages
uvicorn app.main:app --reload --port 8000
```

Backend runs at `http://localhost:8000`. Interactive API docs at `http://localhost:8000/docs`.

```bash
ruff check .
pytest
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Checks (also run in CI): `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. Browser tests: `npx playwright install chromium` once, then `npm run e2e` (starts the API and the built frontend itself and signs in as two users to check live delivery and reactions).

Frontend runs at `http://localhost:3000`. Set `NEXT_PUBLIC_API_URL` in a `.env.local` if your backend isn't at `http://localhost:8000`.

### Test login

Any seeded phone number with OTP `123456`. See `backend/app/seed.py` for the full list of seeded users, or register a new account directly through the app (OTP is mocked and always accepts `123456`).

---

## Deployment

The frontend deploys to Vercel and the backend to Render, both from `main`. A scheduled workflow (`.github/workflows/keep-alive.yml`) pings the API every 10 minutes so it rarely sleeps.

- **Backend:** `render.yaml` at the repo root is a Render Blueprint (New > Blueprint). It runs `uvicorn app.main:app --host 0.0.0.0 --port $PORT` from `backend/`. Any host that can run that command works (Railway, Fly.io, a VPS).
- **Environment variables:** `SECRET_KEY` (a long random value), `ALLOWED_ORIGINS` (comma-separated frontend origins), optional `ALLOWED_ORIGIN_REGEX` for preview deployments, `DATABASE_URL`, `UPLOAD_DIR`, `MAX_UPLOAD_MB`, `SEED_ON_START`.
- **Persistence:** SQLite and uploaded files live on the instance's disk, which is temporary on free plans, so chats reset when it restarts. The demo users are re-created on boot (`SEED_ON_START=true`). For durable data, point `DATABASE_URL` at a hosted Postgres database and use a persistent disk or object storage for uploads.
- **Pinned dependencies:** `backend/requirements.txt` pins exact versions. A newer SQLModel release rejects the naive-UTC datetimes this app uses, so unpinned installs can break on a rebuild.
- **Frontend:** set `NEXT_PUBLIC_API_URL` to the backend URL in Vercel. The WebSocket address is derived from it, so no second variable is needed. Redeploy after changing it, since it is read at build time.
- Existing databases are upgraded automatically on startup (missing columns are added).

## Security notes

This is a demo, and some choices would change in production:

- **Mock login:** the OTP is a fixed code (`123456`) and nothing is sent. A real deployment needs an SMS/email provider, rate limiting, and expiring one-time codes.
- **Token storage:** the JWT is kept in `localStorage` so a page reload keeps you signed in. That is readable by any script on the page; httpOnly cookies are the safer option. Sessions are also tracked server-side, so logging out revokes the token.
- **No real encryption:** messages are stored as plaintext. "End-to-end encrypted" in the UI is part of the Signal look and is not implemented.
- **Uploads:** files get random names, are size-limited (10 MB), served with `nosniff`, and only raster images render inline; everything else downloads. There is no virus scanning.
- **CORS:** only the origins in `ALLOWED_ORIGINS` (plus the optional regex) can call the API from a browser.
- **Secrets:** the app logs a warning if `SECRET_KEY` is left at its default.

---

## Assumptions & Design Decisions

- **Encryption is simulated, not real** — message content is stored as plaintext, per the assignment's explicit allowance.
- **Avatars** are auto-generated from initials when no `avatar_url` is set, rather than requiring manual upload — a common, acceptable pattern and not required by the brief.
- **Search** (conversations/contacts) matches against names/username/phone, not full message content — treated as contact/conversation discovery, not a message search feature.
- **Blocking is mutual and direct-conversation-only** — if either party has blocked the other, sending fails in both directions; group messaging is unaffected by 1:1 blocks, matching Signal's real behavior.
- **"Sending" message status** is an optimistic client-side state (shown immediately, rolled back if the send fails) rather than a persisted database status.
- **Disappearing messages** are removed by a background task that runs every few seconds; the UI also hides expired messages immediately.
- **Attachments** are stored on disk under random names; only URLs returned by the upload endpoint are accepted on messages.
- **Presence (online/last-seen)** follows the WebSocket lifecycle: a user is online from their first connection until their last one closes.

## Feature Status

**Must-haves:** auth/OTP, contacts, 1:1 messaging (real-time, timestamps, receipts, typing, delivery states), group messaging (create/message/members/admin controls), toasts, settings.

**Also implemented:** reply-to, emoji reactions, image/file attachments, disappearing messages, editable profile, group rename and admin roles, blocked-contacts management, load-earlier pagination, automatic WebSocket reconnect, a responsive layout for phones, dark mode, and keyboard shortcuts (Enter to send, Esc to close).

**Tests and CI:** the backend has a pytest suite (REST, WebSocket, uploads, expiry, migrations), the frontend has Vitest tests, and Playwright drives the real app in a browser; GitHub Actions runs lint, tests and the production build on every push and pull request.
