/**
 * ============================================================================
 * api.js — Backend REST API Client
 * ============================================================================
 *
 * ARCHITECTURE DECISION: Every API call includes the X-User-UID header.
 * This tells the backend WHO is making the request so it can enforce
 * ownership rules (e.g., you can only accept requests sent TO you).
 *
 * In production, this would be a JWT or session cookie instead.
 * The UID is stored in sessionStorage (per-tab, survives refresh).
 */

const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";

/** Get the current user's UID from session storage. */
function getUid() {
  return sessionStorage.getItem("uid") || "";
}

/**
 * Generic request helper. Attaches auth header and handles errors.
 */
async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-User-UID": getUid(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Log in (or register) a user. Returns { uid, name, authToken }. */
export async function login(uid, name) {
  return request("POST", "/auth/login", { uid, name });
}

// ── Users (Discovery Section) ─────────────────────────────────────────────────

/** List all users with friendship status annotations. */
export async function listUsers() {
  return request("GET", "/users");
}

// ── Friend Requests ───────────────────────────────────────────────────────────

/** Send a friend request to another user. */
export async function sendFriendRequest(toUid) {
  return request("POST", "/friend-requests", { toUid });
}

/** Get all pending incoming friend requests. */
export async function getIncomingRequests() {
  return request("GET", "/friend-requests/incoming");
}

/** Accept a friend request by ID. */
export async function acceptRequest(id) {
  return request("POST", `/friend-requests/${id}/accept`);
}

/** Reject a friend request by ID. */
export async function rejectRequest(id) {
  return request("POST", `/friend-requests/${id}/reject`);
}

// ── Friends ───────────────────────────────────────────────────────────────────

/** Get the list of confirmed friends. */
export async function getFriends() {
  return request("GET", "/friends");
}

// ── Messaging Guard ───────────────────────────────────────────────────────────

/** Check if the current user can message another user (are they friends?). */
export async function checkCanMessage(toUid) {
  return request("POST", "/messages/check", { toUid });
}
