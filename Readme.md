# Friend Chat

Friend Chat is a friend-only messaging app built with React, Express, SQLite,
and CometChat. Users can discover other users, send friend requests, accept or
reject requests, and chat only after a friendship has been accepted.

The most important implementation rule is that chat access is not trusted to the
frontend alone. The backend stores friendships, checks whether users are allowed
to message, and syncs accepted friendships into CometChat.

## Project Structure

```text
chatapp/
├── backend/
│   ├── server.js              # Express routes, auth guard, webhook, API entry
│   ├── db.js                  # sql.js SQLite friend request/friendship storage
│   ├── cometchat.js           # CometChat REST API wrapper
│   ├── package.json           # Backend dependencies and scripts
│   ├── .env.example           # Backend environment variable template
│   └── railway.json           # Railway backend config kept for fallback deploys
│
├── frontend/
│   ├── src/
│   │   ├── App.tsx            # App shell, login state, tab navigation
│   │   ├── api.js             # Backend REST client
│   │   ├── cometchatInit.js   # CometChat UI Kit initialization/login/logout
│   │   ├── index.css          # App styling
│   │   └── components/
│   │       ├── Login.jsx
│   │       ├── UsersSection.jsx
│   │       ├── FriendRequestsSection.jsx
│   │       └── ConversationsSection.jsx
│   ├── package.json           # Frontend dependencies and scripts
│   ├── .env.example           # Frontend environment variable template
│   └── vercel.json            # Vercel frontend deployment config
│
├── Dockerfile                 # Root Dockerfile used by Render backend deploy
├── render.yaml                # Render blueprint/config
├── railway.json               # Railway fallback config
├── DEPLOYMENT.md              # Hosted deployment notes
└── Readme.md                  # Project documentation
```

## Technology Stack

Backend:

- Node.js
- Express
- sql.js SQLite
- CometChat REST API

Frontend:

- React
- Vite
- CometChat JavaScript SDK
- CometChat React UI Kit

Deployment:

- Render for backend
- Vercel for frontend
- CometChat for real-time messaging infrastructure

## Core Features

- Simple UID/display-name login for demo use.
- User creation/upsert in CometChat from the backend.
- Backend-issued CometChat auth tokens.
- Discover Users section with friend/request status.
- Incoming friend request list.
- Real-time friend request refresh using CometChat custom messages.
- Friend-only conversations.
- Old CometChat messages from before friendship acceptance are hidden.
- Per-tab demo sessions so two users can be tested in one browser profile.

## Backend API

The backend runs on port `4000` locally.

Main endpoints:

```text
GET  /health
POST /auth/login
GET  /users
POST /friend-requests
GET  /friend-requests/incoming
GET  /friend-requests/outgoing
POST /friend-requests/:id/accept
POST /friend-requests/:id/reject
GET  /friends
POST /messages/check
POST /webhook/before-message
```

For demo authentication, protected endpoints use the `X-User-UID` header. In a
production app this should be replaced with JWT/session authentication.

## Data Model

The backend stores two tables in SQLite:

```text
friend_requests
- id
- from_uid
- to_uid
- status: pending | accepted | rejected
- created_at
- updated_at

friendships
- user_a
- user_b
- created_at
```

Friendships are stored in both directions:

```text
alice -> bob
bob   -> alice
```

This keeps the `areFriends(userA, userB)` lookup simple and fast.

## Key Decisions

### Backend owns friendship enforcement

The frontend hides buttons and filters screens for a better user experience, but
the backend is the source of truth for whether two users are friends.

Before opening or sending in a chat, the frontend calls:

```text
POST /messages/check
```

CometChat can also call:

```text
POST /webhook/before-message
```

That webhook blocks non-friend messages before delivery when configured in the
CometChat dashboard.

### CometChat API keys stay server-side

The frontend does not use the CometChat REST API key. Login works like this:

1. Frontend sends UID/name to the backend.
2. Backend creates or updates the CometChat user.
3. Backend creates a CometChat auth token.
4. Frontend logs into the CometChat SDK with that auth token.

### Friend requests use CometChat custom messages

Friend requests are stored in the local backend database, then the backend sends
a CometChat custom message to notify the recipient in real time.

Used custom message types:

```text
friend_request
friend_request_accepted
```

The frontend listens for these and refreshes request/user state.

### Conversations are filtered manually

The app does not rely on CometChat's default conversation list directly because
it can include conversations outside this app's friendship rules.

`ConversationsSection.jsx` fetches CometChat conversations, then keeps only
conversations where:

- the other user is a backend-confirmed friend
- the last visible message happened after the friendship was accepted

When a chat opens, messages are filtered again so only messages between the
logged-in user and selected friend are shown.

### Per-tab sessions

The app uses `sessionStorage` so each tab can be logged in as a different demo
user. CometChat is also initialized with session storage:

```js
.setStorageMode(CometChat.StorageMode.SESSION)
```

This avoids two test users in two tabs fighting over one shared CometChat SDK
login.

### Persistent backend database

Locally, SQLite is written to:

```text
backend/data.db
```

In production, set:

```bash
DB_PATH=/data/data.db
```

and mount persistent storage at `/data`.

## Local Setup

### Prerequisites

- Node.js 18+
- npm
- A CometChat app
- CometChat App ID, Region, Auth Key, and REST API Key

### 1. Backend environment

```bash
cd backend
cp .env.example .env
```

Fill in:

```bash
COMETCHAT_APP_ID=your_app_id
COMETCHAT_REGION=us
COMETCHAT_API_KEY=your_rest_api_key
COMETCHAT_WEBHOOK_SECRET=
PORT=4000
DB_PATH=./data.db
```

### 2. Frontend environment

```bash
cd frontend
cp .env.example .env
```

Fill in:

```bash
VITE_COMETCHAT_APP_ID=your_app_id
VITE_COMETCHAT_REGION=us
VITE_COMETCHAT_AUTH_KEY=your_auth_key
VITE_API_BASE_URL=http://localhost:4000
```

### 3. Install dependencies

Backend:

```bash
cd backend
npm install
```

Frontend:

```bash
cd frontend
npm install
```

### 4. Run locally

Start backend:

```bash
cd backend
npm start
```

Start frontend:

```bash
cd frontend
npm run dev
```

Open:

```text
http://localhost:3000
```

Health check:

```text
http://localhost:4000/health
```

Expected response:

```json
{"ok":true}
```

## CometChat Dashboard Setup

In CometChat:

1. Enable the Friends feature/extension.
2. Enable "Restrict messaging to friends".
3. For deployed environments, configure the Before Message Sent webhook:

```text
https://your-backend-url/webhook/before-message
```

If you set `COMETCHAT_WEBHOOK_SECRET`, use the same secret in the CometChat
webhook settings.

## Testing the App

1. Open the app in two tabs.
2. Log in as `alice` in tab one.
3. Log in as `bob` in tab two.
4. Alice sends Bob a friend request.
5. Bob accepts the request.
6. Alice and Bob can now chat.
7. Log in as a third user and confirm they cannot see Alice/Bob conversations.

If testing behaves strangely, log out in both tabs and hard-refresh. The app is
designed for per-tab sessions, but stale browser state from older builds can
still confuse a session until it is cleared.

## Deployment Summary

The current hosted setup uses:

```text
Backend:  Render
Frontend: Vercel
```

Current backend URL:

```text
https://chatapp-fdpm.onrender.com
```

Vercel frontend must use:

```bash
VITE_API_BASE_URL=https://chatapp-fdpm.onrender.com
```

After changing any `VITE_*` environment variable in Vercel, redeploy the
frontend because Vite embeds those values at build time.

See `DEPLOYMENT.md` for deployment-specific details.

## Known Limitations

- Authentication is demo-only and trusts `X-User-UID`.
- The local database is a file, not a managed database.
- Existing CometChat messages are not deleted; this app filters/hides messages
  that are outside the current friendship rules.
- The CometChat UI Kit bundle is large, so Vite may warn about chunk size during
  production builds.
