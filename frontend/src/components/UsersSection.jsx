/**
 * ============================================================================
 * UsersSection.jsx — User Discovery & Friend Requests
 * ============================================================================
 *
 * PURPOSE: This is the "Discover Users" section where users can:
 *   - See all other registered users on the platform
 *   - See their relationship status with each user
 *   - Send friend requests to users they want to connect with
 *   - Click "Message" to open a chat with existing friends
 *
 * RELATIONSHIP STATES (per user card):
 *   - "Not friends" + "Add Friend" button → can send a request
 *   - "Request sent" + "Pending…" label → waiting for response
 *   - "Sent you a request" + "Incoming ↑" → they need to check Friend Requests
 *   - "Friends" + "Message" button → can open a chat directly
 *
 * REAL-TIME REFRESH:
 *   Uses CometChat MessageListener to detect when a friend_request_accepted
 *   or friend_request custom message arrives, then re-fetches the user list
 *   to update relationship statuses.
 */

import { useEffect, useState, useCallback } from "react";
import { listUsers, sendFriendRequest } from "../api";
import { CometChat } from "@cometchat/chat-sdk-javascript";

export default function UsersSection({ currentUid, onStartChat }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState({}); // uid -> busy boolean

  // Fetch all users with relationship annotations from the backend
  const fetchUsers = useCallback(async () => {
    try {
      const data = await listUsers();
      setUsers(data);
    } catch (err) {
      console.error("Failed to load users:", err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  // ── REAL-TIME REFRESH ─────────────────────────────────────────────────────
  // When a friend request is accepted or received, refresh the user list
  // so relationship statuses update without manual page reload.
  useEffect(() => {
    const listenerId = "users-section-listener";
    CometChat.addMessageListener(
      listenerId,
      new CometChat.MessageListener({
        onCustomMessageReceived: (msg) => {
          if (
            msg.type === "friend_request_accepted" ||
            msg.type === "friend_request"
          ) {
            fetchUsers(); // Re-fetch to update statuses
          }
        },
      })
    );
    return () => CometChat.removeMessageListener(listenerId);
  }, [fetchUsers]);

  // ── Send a friend request ─────────────────────────────────────────────────
  const handleSendRequest = async (toUid) => {
    setSending((prev) => ({ ...prev, [toUid]: true }));
    try {
      await sendFriendRequest(toUid);
      // Optimistically update the UI to show "Pending…"
      setUsers((prev) =>
        prev.map((u) => (u.uid === toUid ? { ...u, requestSent: true } : u))
      );
    } catch (err) {
      alert(err.message);
    } finally {
      setSending((prev) => ({ ...prev, [toUid]: false }));
    }
  };

  // ── Open chat with a friend ───────────────────────────────────────────────
  // Passes the UID to App.jsx which switches to Conversations tab
  const handleMessage = (uid) => {
    onStartChat(uid);
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading users…
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="section-container">
        <div className="empty-state">
          <p>No other users found. Register another account to get started.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="section-container">
      <p className="section-title">Discover Users ({users.length})</p>
      <div className="user-grid">
        {users.map((user) => (
          <UserCard
            key={user.uid}
            user={user}
            sending={!!sending[user.uid]}
            onSendRequest={handleSendRequest}
            onMessage={handleMessage}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * UserCard — displays a single user with their relationship status and action button.
 *
 * The action button changes based on relationship:
 *   - Not friends → "Add Friend" (sends request)
 *   - Request sent → "Pending…" (disabled)
 *   - Request received → "Incoming ↑" (go to Friend Requests)
 *   - Friends → "Message" (opens chat)
 */
function UserCard({ user, sending, onSendRequest, onMessage }) {
  const initial = (user.name || user.uid)[0].toUpperCase();

  let statusLabel = "Not friends";
  let statusClass = "";
  let actionBtn = null;

  if (user.isFriend) {
    statusLabel = "Friends";
    statusClass = "friend";
    actionBtn = (
      <button
        className="btn-sm btn-add"
        style={{ background: "#10b981" }}
        onClick={() => onMessage(user.uid)}
        aria-label={`Message ${user.name}`}
      >
        Message
      </button>
    );
  } else if (user.requestSent) {
    statusLabel = "Request sent";
    actionBtn = <span className="btn-sm btn-pending">Pending…</span>;
  } else if (user.requestReceived) {
    statusLabel = "Sent you a request";
    actionBtn = <span className="btn-sm btn-pending">Incoming ↑</span>;
  } else {
    actionBtn = (
      <button
        className="btn-sm btn-add"
        disabled={sending}
        onClick={() => onSendRequest(user.uid)}
        aria-label={`Send friend request to ${user.name}`}
      >
        {sending ? "Sending…" : "Add Friend"}
      </button>
    );
  }

  return (
    <div className="user-card">
      <div className="avatar" aria-hidden="true">
        {initial}
      </div>
      <div className="user-card-info">
        <div className="user-card-name">{user.name || user.uid}</div>
        <div className={`user-card-status ${statusClass}`}>{statusLabel}</div>
      </div>
      {actionBtn}
    </div>
  );
}