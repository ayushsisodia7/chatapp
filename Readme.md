# Friend-Only Messaging App

A social messaging application where users can only communicate with their friends. Users must send and accept friend requests before they can chat. All messaging is powered by [CometChat](https://www.cometchat.com/), with the frontend chat interface built using the CometChat React UI Kit.

---

## Table of Contents
- [Approach & Architecture](#approach--architecture)
- [Project Structure](#project-structure)
- [Key Implementation Decisions](#key-implementation-decisions)
- [Running the App](#running-the-app)
- [Testing the Flow](#testing-the-flow)
- [API Endpoints Reference](#api-endpoints-reference)

---

## Approach & Architecture

### The Core Problem
Build a messaging app where **non-friends cannot communicate**. This restriction must be enforced at the **backend level**, not just the frontend.

### My Approach: Defense in Depth
I implemented **4 layers of enforcement** so that even if one layer is bypassed, the others still protect:

| Layer | Where | How |
|-------|-------|-----|
| 1. Frontend UI | React components | "Message" button only shown for friends; conversation list only shows friend chats |
| 2. Pre-send API check | `POST /messages/check` | Frontend calls this before sending — returns 403 if not friends |
| 3. CometChat Webhook | `POST /webhook/before-message` | CometChat calls our backend before delivering ANY message — we block non-friends |
| 4. CometChat Platform | Dashboard setting | "Restrict messaging to friends" blocks at the platform level |

**Key point for the video:** Layers 1-2 are convenience (can be bypassed by a determined user). Layers 3-4 are the real security — they work even if someone bypasses the frontend entirely.

### Technology Choices

| Technology | Why |
|-----------|-----|
| React + Vite | Fast dev server, modern tooling, required for CometChat UI Kit |
| CometChat React UI Kit | Required by spec — provides `CometChatConversations`, `CometChatMessageList`, `CometChatMessageComposer` |
| Express.js | Lightweight Node.js backend, easy to understand |
| SQLite (sql.js) | Zero native dependencies, works everywhere, no database server needed |
| CometChat REST API | Server-side user management, auth tokens, friend registration |
| CometChat Custom Messages | Real-time friend request notifications without polling |

### How Real-Time Friend Requests Work

```
Alice sends request → Backend saves to DB
 → Backend sends CometChat custom message (type: "friend_request")
 → Bob's frontend has a MessageListener active
 → Listener fires, re-fetches pending requests
 → Bob sees the request instantly (no page refresh needed)
```

### How Friendship Registration Works

```
Bob accepts request → Backend updates DB (status: accepted, create friendship rows)
 → Backend calls CometChat REST API: POST /users/bob/friends (adds alice)
 → Backend calls CometChat REST API: POST /users/alice/friends (adds bob)
 → Backend sends custom message (type: "friend_request_accepted")
 → Alice's frontend refreshes, shows "Friends" status
 → Both can now chat (CometChat platform allows it)
```

### Why Backend Enforcement Matters

Without backend enforcement, a user could:
1. Open browser DevTools
2. Call `CometChat.sendMessage()` directly to any user
3. Bypass all frontend restrictions

With our backend enforcement:
- The webhook intercepts the message BEFORE delivery
- CometChat's "Restrict messaging to friends" blocks it at the platform level
- The message never reaches the recipient

---

## Project Structure

```
friend-chat-app/
├── backend/ # Express API server (Node.js)
│ ├── server.js # All routes + webhook + messaging guard
│ ├── db.js # SQLite database (friend_requests + friendships)
│ ├── cometchat.js # CometChat REST API wrapper
│ ├── .env # Credentials (never commit to git)
│ └── data.db # SQLite database file (auto-created)
│
└── frontend/ # React + Vite app
 ├── src/
 │ ├── App.jsx # Root: init, auth, tab navigation, session
 │ ├── api.js # Backend API client (all fetch calls)
 │ ├── cometchatInit.js # CometChat UI Kit initialization
 │ └── components/
 │ ├── Login.jsx # Simple UID + name login form
 │ ├── UsersSection.jsx # Discover users, send friend requests
 │ ├── FriendRequestsSection.jsx # Accept/reject incoming requests
 │ └── ConversationsSection.jsx # CometChat UI Kit chat interface
 └── .env # Frontend credentials (VITE_ prefixed)
```

---

## Key Implementation Decisions

### 1. Bidirectional Friendship Storage
When a request is accepted, we store the friendship in BOTH directions:
- `(alice, bob)` AND `(bob, alice)`

This makes the `areFriends(A, B)` check a simple single-row lookup instead of checking both directions every time. Trade-off: slightly more storage, much faster reads.

### 2. ON CONFLICT for Re-sendable Requests
The `friend_requests` table has a `UNIQUE(from_uid, to_uid)` constraint. When a request is rejected and the sender wants to try again, we use `ON CONFLICT DO UPDATE` to reset the row to "pending" instead of failing with a constraint error.

### 3. CometChat Custom Messages for Signaling
Instead of building a separate WebSocket server for real-time notifications, we piggyback on CometChat's existing real-time infrastructure. Custom messages of type `friend_request` and `friend_request_accepted` are delivered instantly via CometChat's message listeners.

### 4. Auth Tokens (Not API Keys)
The frontend never has the CometChat API key. Instead:
1. User logs in to our backend
2. Backend creates/updates user in CometChat
3. Backend generates an auth token (short-lived, user-specific)
4. Frontend uses this token to log in to CometChat SDK

### 5. No itemView Filtering on Conversations
The CometChat UI Kit's `CometChatConversations` component replaces its entire default renderer when you pass `itemView`. Returning null/undefined renders blank rows. Instead, we rely on the fact that non-friends can't message each other, so non-friend conversations simply don't exist in the list.

### 6. Session Per Tab (sessionStorage)
Using `sessionStorage` instead of `localStorage` means each browser tab has its own session. This makes testing easy — open two tabs, log in as different users, test the flow.

---

## Running the App

### Prerequisites
- Node.js 18+
- CometChat app credentials (App ID, Region, API Key, Auth Key)

### CometChat Dashboard Setup
1. Go to **Settings → Extensions** → Enable the **Friends** extension
2. Under **Settings → General** → Enable **"Restrict messaging to friends"**
3. (Optional) Configure **Before Message Sent** webhook:
 - URL: `https://<your-backend>/webhook/before-message`
 - Set `COMETCHAT_WEBHOOK_SECRET` in `backend/.env`

### 1. Configure environment variables

```bash
cp friend-chat-app/backend/.env.example friend-chat-app/backend/.env
cp friend-chat-app/frontend/.env.example friend-chat-app/frontend/.env
```

Fill in your CometChat credentials in both files.

### 2. Start the backend (port 4000)

```bash
cd friend-chat-app/backend
npm install
node server.js
```

### 3. Start the frontend (port 3000)

```bash
cd friend-chat-app/frontend
npm install
npx vite
```

Open **http://localhost:3000**

---

## Testing the Flow

1. Open two browser tabs (or one normal + one incognito)
2. Tab 1: Log in as `alice` / Alice
3. Tab 2: Log in as `bob` / Bob
4. Tab 1: **Discover Users** → Click **Add Friend** on Bob
5. Tab 2: **Friend Requests** → Request appears in real time → Click **Accept**
6. Both tabs: **Conversations** → Can now chat with each other
7. Verify: Try sending a message to a non-friend → Should be blocked

---

## API Endpoints Reference

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/auth/login` | Create/update user, return auth token |
| GET | `/users` | List all users with relationship status |
| POST | `/friend-requests` | Send a friend request |
| GET | `/friend-requests/incoming` | List pending incoming requests |
| GET | `/friend-requests/outgoing` | List pending outgoing requests |
| POST | `/friend-requests/:id/accept` | Accept + register friendship in CometChat |
| POST | `/friend-requests/:id/reject` | Reject (sender can re-send later) |
| GET | `/friends` | List confirmed friends |
| POST | `/messages/check` | Pre-send friendship verification |
| POST | `/webhook/before-message` | CometChat webhook — blocks non-friend messages |

---

## Future Improvements (Out of Scope)
- Replace `X-User-UID` header with JWT-based authentication
- Add "Unfriend" functionality (backend already has `removeFriends()`)
- Add typing indicators and read receipts
- Deploy webhook endpoint to a public URL (ngrok for dev, cloud for prod)
- Add pagination to user list for large-scale apps