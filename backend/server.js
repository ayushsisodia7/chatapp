/**
 * ============================================================================
 * server.js — Express Backend for Friend-Only Messaging App
 * ============================================================================
 *
 * ARCHITECTURE DECISION: All friendship enforcement happens server-side.
 * The frontend UI restrictions (hiding buttons, filtering lists) are just
 * convenience — they can be bypassed. The REAL security is here.
 *
 * ENFORCEMENT LAYERS (defense in depth):
 *   1. This backend checks areFriends() before allowing any action
 *   2. /webhook/before-message — CometChat calls this before delivering messages
 *   3. CometChat Dashboard "Restrict messaging to friends" setting
 *   4. Frontend UI hides non-friend conversations (cosmetic only)
 *
 * ENDPOINTS:
 *   POST /auth/login              — Create/update user in CometChat, return auth token
 *   GET  /users                   — List all users with friendship status annotations
 *   POST /friend-requests         — Send a friend request (+ real-time notification)
 *   GET  /friend-requests/incoming — List pending incoming requests
 *   GET  /friend-requests/outgoing — List pending outgoing requests
 *   POST /friend-requests/:id/accept — Accept request, register friendship
 *   POST /friend-requests/:id/reject — Reject request
 *   GET  /friends                 — List confirmed friends
 *   POST /messages/check          — Pre-send check: are these users friends?
 *   POST /webhook/before-message  — CometChat webhook: block non-friend messages
 */

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const db = require("./db");
const cc = require("./cometchat");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────────────────────
// AUTH MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────
// ARCHITECTURE DECISION: For this demo, we use a simple X-User-UID header.
// In production, this would be replaced with JWT verification or session cookies.
// The key point: the backend MUST know who the user is to enforce friendship rules.

function requireAuth(req, res, next) {
  const uid = req.headers["x-user-uid"];
  if (!uid) return res.status(401).json({ error: "Missing X-User-UID header" });
  req.uid = uid;
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.json({ ok: true }));

// ─────────────────────────────────────────────────────────────────────────────
// AUTH — Login / User Registration
// ─────────────────────────────────────────────────────────────────────────────
// KEY DECISION: Auth tokens are issued by the backend, not the frontend.
// The frontend NEVER has access to the CometChat API key — only the auth token.
// This prevents users from making unauthorized API calls directly to CometChat.

app.post("/auth/login", async (req, res) => {
  const { uid, name } = req.body;
  if (!uid || !name)
    return res.status(400).json({ error: "uid and name are required" });

  try {
    // Step 1: Create or update the user in CometChat
    await cc.upsertUser({ uid, name });

    // Step 2: Generate an auth token — this is what the frontend uses
    // to log in to CometChat SDK (not the API key)
    const authToken = await cc.createAuthToken(uid);

    res.json({ authToken, uid, name });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// USERS — Discovery Section
// ─────────────────────────────────────────────────────────────────────────────
// Returns all users EXCEPT the current user, annotated with relationship status.
// This powers the "Discover Users" section in the frontend.

app.get("/users", requireAuth, async (req, res) => {
  try {
    // Fetch all users from CometChat
    const users = await cc.listUsers();
    const others = users.filter((u) => u.uid !== req.uid);

    // Annotate each user with their relationship to the current user
    // This lets the frontend show the right button: "Add Friend" / "Pending" / "Message"
    const outgoing = db.getOutgoingRequests(req.uid).map((r) => r.to_uid);
    const incoming = db.getIncomingRequests(req.uid).map((r) => r.from_uid);
    const friends = db.getFriends(req.uid).map((f) => f.uid);

    const annotated = others.map((u) => ({
      ...u,
      isFriend: friends.includes(u.uid),
      requestSent: outgoing.includes(u.uid),
      requestReceived: incoming.includes(u.uid),
    }));

    res.json(annotated);
  } catch (err) {
    console.error("List users error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// FRIEND REQUESTS — The Core Workflow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /friend-requests — Send a friend request
 *
 * KEY IMPLEMENTATION DETAIL: After saving the request in our DB, we send a
 * CometChat "custom message" of type "friend_request" to the recipient.
 * This is how the recipient gets REAL-TIME notification — their frontend
 * has a CometChat MessageListener that picks up custom messages and
 * refreshes the Friend Requests section instantly. No polling needed.
 */
app.post("/friend-requests", requireAuth, async (req, res) => {
  const { toUid } = req.body;
  if (!toUid) return res.status(400).json({ error: "toUid is required" });
  if (toUid === req.uid)
    return res.status(400).json({ error: "Cannot send request to yourself" });

  // Prevent duplicate pending requests
  if (db.getPendingRequest(req.uid, toUid))
    return res.status(409).json({ error: "Friend request already sent" });

  // Prevent sending request to existing friends
  if (db.areFriends(req.uid, toUid))
    return res.status(409).json({ error: "Already friends" });

  try {
    // Save to our database (uses ON CONFLICT to allow re-sending after rejection)
    const request = db.createFriendRequest(req.uid, toUid);

    // REAL-TIME DELIVERY: Send a CometChat custom message to notify recipient
    // The frontend's MessageListener picks this up and refreshes the UI
    await cc.sendCustomMessage({
      senderUid: req.uid,
      receiverUid: toUid,
      type: "friend_request",
      data: { requestId: request.id, fromUid: req.uid },
    });

    res.status(201).json(request);
  } catch (err) {
    console.error("Send friend request error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /friend-requests/incoming — List pending requests for current user
 * Enriches each request with the sender's profile from CometChat.
 */
app.get("/friend-requests/incoming", requireAuth, async (req, res) => {
  try {
    const requests = db.getIncomingRequests(req.uid);

    // Enrich with sender profile (name, avatar) from CometChat
    const enriched = await Promise.all(
      requests.map(async (r) => {
        try {
          const user = await cc.getUser(r.from_uid);
          return { ...r, sender: user };
        } catch {
          return { ...r, sender: { uid: r.from_uid, name: r.from_uid } };
        }
      })
    );

    res.json(enriched);
  } catch (err) {
    console.error("Get incoming requests error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /friend-requests/outgoing — List pending requests sent by current user
 */
app.get("/friend-requests/outgoing", requireAuth, (req, res) => {
  res.json(db.getOutgoingRequests(req.uid));
});

/**
 * POST /friend-requests/:id/accept — Accept a friend request
 *
 * KEY IMPLEMENTATION DETAIL: When a request is accepted, we do THREE things:
 *   1. Update our DB (status → accepted, create friendship rows)
 *   2. Register the friendship in CometChat via REST API (addFriends)
 *      — This is what makes CometChat's "Restrict messaging to friends" work
 *   3. Send a custom message to notify the sender their request was accepted
 *      — This triggers the sender's UI to refresh and show the new friend
 */
app.post("/friend-requests/:id/accept", requireAuth, async (req, res) => {
  const requestId = parseInt(req.params.id, 10);

  try {
    const accepted = db.acceptRequest(requestId, req.uid);
    if (!accepted)
      return res.status(404).json({ error: "Request not found or already handled" });

    // CRITICAL: Register friendship in CometChat so platform-level
    // messaging restrictions work. Without this, CometChat won't know
    // these users are friends and will block their messages.
    await cc.addFriends(req.uid, accepted.from_uid);

    // Notify the original sender that their request was accepted (real-time)
    await cc.sendCustomMessage({
      senderUid: req.uid,
      receiverUid: accepted.from_uid,
      type: "friend_request_accepted",
      data: { requestId, byUid: req.uid },
    });

    res.json({ ok: true, friendship: { uidA: req.uid, uidB: accepted.from_uid } });
  } catch (err) {
    console.error("Accept request error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /friend-requests/:id/reject — Reject a friend request
 * Simply marks the request as rejected. The sender can re-send later.
 */
app.post("/friend-requests/:id/reject", requireAuth, (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const rejected = db.rejectRequest(requestId, req.uid);
  if (!rejected)
    return res.status(404).json({ error: "Request not found or already handled" });
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// FRIENDS — List confirmed friends
// ─────────────────────────────────────────────────────────────────────────────

app.get("/friends", requireAuth, async (req, res) => {
  try {
    const friendUids = db.getFriends(req.uid).map((f) => f.uid);

    // Enrich with full profiles from CometChat
    const profiles = await Promise.all(
      friendUids.map(async (uid) => {
        try {
          return await cc.getUser(uid);
        } catch {
          return { uid, name: uid };
        }
      })
    );

    res.json(profiles);
  } catch (err) {
    console.error("Get friends error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// MESSAGING GUARD — Backend enforcement of friend-only messaging
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /messages/check — Pre-send friendship verification
 *
 * The frontend calls this before allowing a message to be sent.
 * Returns 200 if allowed, 403 if not friends.
 *
 * NOTE: This is a convenience check. The REAL enforcement is:
 *   1. The webhook below (CometChat calls it before delivering any message)
 *   2. CometChat's "Restrict messaging to friends" Dashboard setting
 */
app.post("/messages/check", requireAuth, (req, res) => {
  const { toUid } = req.body;
  if (!toUid) return res.status(400).json({ error: "toUid is required" });

  if (!db.areFriends(req.uid, toUid)) {
    return res.status(403).json({ allowed: false, reason: "Users are not friends" });
  }

  res.json({ allowed: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMETCHAT WEBHOOK — Before-Message Interceptor
// ─────────────────────────────────────────────────────────────────────────────
/**
 * POST /webhook/before-message
 *
 * ARCHITECTURE DECISION: This is the strongest enforcement layer.
 * CometChat calls this endpoint BEFORE delivering any message.
 * If we return 403, the message is blocked at the platform level.
 *
 * SETUP (in CometChat Dashboard):
 *   Extensions → Webhooks → Before Message Sent
 *   URL: https://<your-backend>/webhook/before-message
 *
 * This means even if someone bypasses the frontend entirely and sends
 * messages directly via the CometChat SDK, they'll still be blocked.
 */
app.post("/webhook/before-message", (req, res) => {
  // Optional: verify webhook signature to prevent spoofing
  const secret = process.env.COMETCHAT_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers["x-cometchat-signature"];
    const expected = crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(req.body))
      .digest("hex");
    if (signature !== expected) {
      return res.status(401).json({ error: "Invalid webhook signature" });
    }
  }

  const { sender, receiver, receiverType, category, type } = req.body;

  // Only intercept user-to-user messages (not group messages)
  if (receiverType !== "user") return res.json({ allow: true });

  // Allow our own signaling messages (friend requests use custom messages)
  if (category === "custom" && (type === "friend_request" || type === "friend_request_accepted")) {
    return res.json({ allow: true });
  }

  const senderUid = sender?.uid;
  const receiverUid = receiver?.uid;

  if (!senderUid || !receiverUid) {
    return res.status(400).json({ error: "Missing sender or receiver" });
  }

  // THE CORE CHECK: Are these users friends?
  if (!db.areFriends(senderUid, receiverUid)) {
    console.log(`[webhook] BLOCKED message: ${senderUid} → ${receiverUid} (not friends)`);
    return res.status(403).json({ allow: false, reason: "Users are not friends" });
  }

  // Friends — allow the message through
  res.json({ allow: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────────────────────────────────────

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error("Failed to initialise database:", err);
  process.exit(1);
});