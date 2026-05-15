# Deployment Guide

This app deploys as two services:

- Backend: Render web service with a persistent disk
- Frontend: Vercel Vite static app

## 1. Push the latest code

```bash
git add .
git commit -m "Prepare app for deployment"
git push origin main
```

## 2. Deploy the backend on Render

1. In Render, create a new Blueprint from this GitHub repo.
2. Render will read `render.yaml` from the repo root.
3. Enter these secret values when prompted:

```bash
COMETCHAT_APP_ID=your_app_id
COMETCHAT_REGION=us
COMETCHAT_API_KEY=your_rest_api_key
COMETCHAT_WEBHOOK_SECRET=choose_a_random_secret_or_leave_blank
```

The blueprint also configures:

```bash
DB_PATH=/data/data.db
```

The `/data` mount is the persistent disk that keeps friend requests and
friendships across deploys/restarts.

After Render deploys, verify:

```text
https://your-render-service.onrender.com/health
```

It should return:

```json
{"ok":true}
```

## 3. Deploy the frontend on Vercel

1. Import the same GitHub repo into Vercel.
2. Set the project Root Directory to `frontend`.
3. Vercel will use `frontend/vercel.json`.
4. Add these environment variables:

```bash
VITE_COMETCHAT_APP_ID=your_app_id
VITE_COMETCHAT_REGION=us
VITE_COMETCHAT_AUTH_KEY=your_auth_key
VITE_API_BASE_URL=https://your-render-service.onrender.com
```

Deploy the Vercel project. The output URL is the shareable app link.

## 4. Update CometChat

In the CometChat Dashboard:

1. Enable the Friends feature/extension.
2. Enable "Restrict messaging to friends".
3. Configure the Before Message Sent webhook:

```text
https://your-render-service.onrender.com/webhook/before-message
```

If you set `COMETCHAT_WEBHOOK_SECRET` on Render, use the same secret in the
CometChat webhook configuration.

## 5. Smoke test

1. Open the Vercel link in two different browser profiles.
2. Log in as `alice` in one and `bob` in the other.
3. Send a friend request from Alice to Bob.
4. Accept it as Bob.
5. Confirm only Alice/Bob chats appear in their Conversations section.
6. Create a third user and confirm they cannot see Alice/Bob conversations.
