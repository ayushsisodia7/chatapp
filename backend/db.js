/**
 * ============================================================================
 * db.js — SQLite Database Layer (using sql.js)
 * ============================================================================
 *
 * ARCHITECTURE DECISION: We use sql.js (pure JavaScript SQLite) instead of
 * better-sqlite3 or other native modules. This means:
 *   - Zero native build dependencies (no node-gyp, no Python needed)
 *   - Works on any platform without compilation
 *   - Trade-off: slightly slower than native, but fine for a demo
 *
 * DATA MODEL:
 *   friend_requests — Tracks all friend requests between users
 *     - from_uid: who sent the request
 *     - to_uid: who receives the request
 *     - status: 'pending' | 'accepted' | 'rejected'
 *     - UNIQUE(from_uid, to_uid): one request per direction per pair
 *
 *   friendships — Bidirectional friendship records
 *     - user_a, user_b: the two friends
 *     - Stored BOTH directions (A→B and B→A) for fast lookups
 *     - PRIMARY KEY (user_a, user_b)
 *
 * PERSISTENCE: The in-memory database is written to disk after every write
 * operation. Set DB_PATH in production to a persistent disk/volume path.
 */

const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "data.db");

let db; // sql.js Database instance

/**
 * Initialise the database. Must be awaited before any other call.
 * Loads existing data from disk if available, otherwise creates fresh tables.
 */
async function init() {
  const SQL = await initSqlJs();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables if they don't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      from_uid    TEXT NOT NULL,
      to_uid      TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(from_uid, to_uid)
    );

    CREATE TABLE IF NOT EXISTS friendships (
      user_a     TEXT NOT NULL,
      user_b     TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      PRIMARY KEY (user_a, user_b)
    );
  `);

  persist();
}

/** Write the in-memory DB to disk so data survives restarts. */
function persist() {
  const data = db.export();
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/** Run a write statement and persist to disk. */
function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

/** Return all rows from a SELECT query. */
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/** Return the first row from a SELECT, or undefined. */
function get(sql, params = []) {
  return all(sql, params)[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// FRIEND REQUEST OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a friend request (or re-activate a previously rejected one).
 *
 * KEY DECISION: Uses ON CONFLICT ... DO UPDATE so that if a request was
 * previously rejected, the same user can send a new request without hitting
 * the UNIQUE constraint. The row is simply reset to 'pending'.
 */
function createFriendRequest(fromUid, toUid) {
  run(
    `INSERT INTO friend_requests (from_uid, to_uid, status, created_at, updated_at)
     VALUES (?, ?, 'pending', strftime('%s','now'), strftime('%s','now'))
     ON CONFLICT(from_uid, to_uid) DO UPDATE SET
       status = 'pending',
       updated_at = strftime('%s','now')`,
    [fromUid, toUid]
  );
  return get(
    "SELECT * FROM friend_requests WHERE from_uid = ? AND to_uid = ? AND status = 'pending'",
    [fromUid, toUid]
  );
}

/** Check if there's already a pending request between these users. */
function getPendingRequest(fromUid, toUid) {
  return get(
    "SELECT * FROM friend_requests WHERE from_uid = ? AND to_uid = ? AND status = 'pending'",
    [fromUid, toUid]
  );
}

/** Get all pending requests sent TO this user (for the Friend Requests section). */
function getIncomingRequests(toUid) {
  return all(
    "SELECT * FROM friend_requests WHERE to_uid = ? AND status = 'pending' ORDER BY created_at DESC",
    [toUid]
  );
}

/** Get all pending requests sent BY this user. */
function getOutgoingRequests(fromUid) {
  return all(
    "SELECT * FROM friend_requests WHERE from_uid = ? AND status = 'pending' ORDER BY created_at DESC",
    [fromUid]
  );
}

/**
 * Accept a friend request.
 *
 * KEY IMPLEMENTATION: Creates friendship rows in BOTH directions (A→B and B→A).
 * This makes the areFriends() lookup O(1) — just check one direction.
 */
function acceptRequest(requestId, toUid) {
  const req = get(
    "SELECT * FROM friend_requests WHERE id = ? AND to_uid = ? AND status = 'pending'",
    [requestId, toUid]
  );
  if (!req) return null;

  // Mark request as accepted
  run(
    "UPDATE friend_requests SET status = 'accepted', updated_at = strftime('%s','now') WHERE id = ?",
    [requestId]
  );

  // Create bidirectional friendship (both directions for fast lookup)
  run(
    "INSERT OR IGNORE INTO friendships (user_a, user_b) VALUES (?, ?)",
    [req.from_uid, req.to_uid]
  );
  run(
    "INSERT OR IGNORE INTO friendships (user_a, user_b) VALUES (?, ?)",
    [req.to_uid, req.from_uid]
  );

  return req;
}

/** Reject a friend request. The sender can re-send later (ON CONFLICT handles it). */
function rejectRequest(requestId, toUid) {
  const req = get(
    "SELECT * FROM friend_requests WHERE id = ? AND to_uid = ? AND status = 'pending'",
    [requestId, toUid]
  );
  if (!req) return false;

  run(
    "UPDATE friend_requests SET status = 'rejected', updated_at = strftime('%s','now') WHERE id = ?",
    [requestId]
  );
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// FRIENDSHIP CHECKS — Used by the messaging guard
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if two users are friends.
 * This is the CORE function used by the messaging guard to enforce restrictions.
 * Because we store friendships bidirectionally, we only need to check one direction.
 */
function areFriends(uidA, uidB) {
  return !!get(
    "SELECT 1 FROM friendships WHERE user_a = ? AND user_b = ?",
    [uidA, uidB]
  );
}

/** Get all friends of a user (returns array of { uid } objects). */
function getFriends(uid) {
  return all(
    "SELECT user_b AS uid, created_at FROM friendships WHERE user_a = ? ORDER BY created_at DESC",
    [uid]
  );
}

module.exports = {
  init,
  createFriendRequest,
  getPendingRequest,
  getIncomingRequests,
  getOutgoingRequests,
  acceptRequest,
  rejectRequest,
  areFriends,
  getFriends,
};
