/**
 * ============================================================================
 * cometchat.js — CometChat REST API Wrapper
 * ============================================================================
 *
 * ARCHITECTURE DECISION: All CometChat API calls go through the backend.
 * The frontend NEVER calls CometChat's REST API directly. This ensures:
 *   - The API key stays secret (only the backend has it)
 *   - All actions are validated server-side before reaching CometChat
 *   - We can add friendship checks before any CometChat operation
 *
 * This module wraps the CometChat REST API v3 endpoints we need:
 *   - User management (create, update, list, get)
 *   - Auth token generation (for frontend SDK login)
 *   - Friends management (add/remove friends in CometChat)
 *   - Custom messages (for real-time friend request notifications)
 */

const fetch = require("node-fetch");

const APP_ID = process.env.COMETCHAT_APP_ID;
const REGION = process.env.COMETCHAT_REGION || "us";
const API_KEY = process.env.COMETCHAT_API_KEY;

// CometChat REST API base URL — region-specific
const BASE_URL = `https://${APP_ID}.api-${REGION}.cometchat.io/v3`;

// All requests use the server-side API key for full access
const headers = {
  "Content-Type": "application/json",
  apikey: API_KEY,
};

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List all users in the CometChat app.
 * Used by the "Discover Users" section to show all registered users.
 */
async function listUsers({ limit = 100, offset = 0 } = {}) {
  const res = await fetch(
    `${BASE_URL}/users?limit=${limit}&offset=${offset}&status=all`,
    { headers }
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || "Failed to list users");
  return json.data;
}

/**
 * Get a single user's profile by UID.
 * Used to enrich friend request data with sender names/avatars.
 */
async function getUser(uid) {
  const res = await fetch(`${BASE_URL}/users/${uid}`, { headers });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || "User not found");
  return json.data;
}

/**
 * Create or update a user in CometChat.
 *
 * KEY DECISION: We try POST first (create). If the user already exists (409),
 * we fall back to PUT (update). This makes login idempotent — users can
 * log in multiple times without errors.
 */
async function upsertUser({ uid, name, avatar }) {
  const body = JSON.stringify({ uid, name, ...(avatar ? { avatar } : {}) });

  let res = await fetch(`${BASE_URL}/users`, {
    method: "POST",
    headers,
    body,
  });

  // User already exists — update their profile instead
  if (res.status === 409 || res.status === 400) {
    res = await fetch(`${BASE_URL}/users/${uid}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ name, ...(avatar ? { avatar } : {}) }),
    });
  }

  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || "Failed to upsert user");
  return json.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH TOKEN GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate an auth token for a user.
 *
 * KEY DECISION: The frontend uses this token to log in to CometChat SDK.
 * It NEVER sees the API key. Auth tokens are short-lived and user-specific,
 * so even if intercepted, damage is limited to that one user's session.
 */
async function createAuthToken(uid) {
  const res = await fetch(`${BASE_URL}/users/${uid}/auth_tokens`, {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const json = await res.json();
  if (!res.ok)
    throw new Error(json.error?.message || "Failed to create auth token");
  return json.data.authToken;
}

// ─────────────────────────────────────────────────────────────────────────────
// FRIENDS MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a bidirectional friendship in CometChat.
 *
 * CRITICAL: This is what makes CometChat's platform-level "Restrict messaging
 * to friends" setting work. Without calling this, CometChat doesn't know
 * these users are friends and will block their messages even though our
 * database says they're friends.
 *
 * We call it in BOTH directions because CometChat's Friends API is
 * unidirectional per call.
 */
async function addFriends(uidA, uidB) {
  await Promise.all([
    fetch(`${BASE_URL}/users/${uidA}/friends`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accepted: [uidB] }),
    }),
    fetch(`${BASE_URL}/users/${uidB}/friends`, {
      method: "POST",
      headers,
      body: JSON.stringify({ accepted: [uidA] }),
    }),
  ]);
}

/**
 * Remove a friendship in CometChat (both directions).
 * Used if we ever implement "unfriend" functionality.
 */
async function removeFriends(uidA, uidB) {
  await Promise.all([
    fetch(`${BASE_URL}/users/${uidA}/friends`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ uids: [uidB] }),
    }),
    fetch(`${BASE_URL}/users/${uidB}/friends`, {
      method: "DELETE",
      headers,
      body: JSON.stringify({ uids: [uidA] }),
    }),
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM MESSAGES — Real-time Friend Request Notifications
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a custom message from one user to another via the REST API.
 *
 * KEY DECISION: We use CometChat custom messages as a real-time signaling
 * mechanism for friend requests. This avoids the need for WebSockets or
 * polling — the frontend already has CometChat's MessageListener active,
 * so custom messages arrive instantly.
 *
 * Custom message types we use:
 *   - "friend_request" — sent when someone sends a friend request
 *   - "friend_request_accepted" — sent when someone accepts a request
 *
 * IMPLEMENTATION: We try sending "on behalf of" the sender first (shows
 * correct sender in the message). If that fails (feature not enabled in
 * Dashboard), we fall back to sending as the app itself with senderUid
 * in the custom data.
 */
async function sendCustomMessage({ senderUid, receiverUid, type, data }) {
  // First attempt: send on behalf of the sender (ideal — shows correct sender)
  const res = await fetch(`${BASE_URL}/messages`, {
    method: "POST",
    headers: { ...headers, onBehalfOf: senderUid },
    body: JSON.stringify({
      category: "custom",
      type,
      data: { customData: data },
      receiver: receiverUid,
      receiverType: "user",
    }),
  });

  if (res.ok) return (await res.json()).data;

  // Fallback: send as app-level message (no onBehalfOf needed)
  // The customData includes senderUid so the frontend can identify the sender
  const fallback = await fetch(`${BASE_URL}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      category: "custom",
      type,
      data: { customData: { ...data, senderUid } },
      receiver: receiverUid,
      receiverType: "user",
    }),
  });

  if (!fallback.ok) {
    // Non-fatal — friend request is saved in DB, just no real-time ping
    const errBody = await fallback.json().catch(() => ({}));
    console.warn(`Custom message delivery failed for type=${type}:`, errBody?.error?.message || fallback.status);
    return null;
  }

  return (await fallback.json()).data;
}

module.exports = {
  listUsers,
  getUser,
  upsertUser,
  createAuthToken,
  addFriends,
  removeFriends,
  sendCustomMessage,
};