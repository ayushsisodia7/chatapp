/**
 * ============================================================================
 * FriendRequestsSection.jsx — Manage Incoming Friend Requests
 * ============================================================================
 *
 * REAL-TIME UPDATES:
 *   This section uses CometChat's MessageListener to detect when a new
 *   friend_request custom message arrives. When detected, it re-fetches
 *   the pending requests from the backend. This means:
 *     - No polling needed
 *     - Requests appear instantly when sent by another user
 *     - The badge count in the nav tab updates in real time
 *
 * FLOW:
 *   1. Component mounts → fetches pending requests from backend
 *   2. CometChat listener fires on "friend_request" custom message
 *   3. Component re-fetches to get the new request
 *   4. User clicks Accept → backend accepts + registers friendship in CometChat
 *   5. User clicks Reject → backend marks as rejected (can re-send later)
 */

import { useEffect, useState, useCallback } from "react";
import { getIncomingRequests, acceptRequest, rejectRequest } from "../api";
import { CometChat } from "@cometchat/chat-sdk-javascript";

export default function FriendRequestsSection({ currentUid, onCountChange }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState({}); // requestId -> busy boolean

  // Fetch all pending incoming requests from the backend
  const fetchRequests = useCallback(async () => {
    try {
      const data = await getIncomingRequests();
      setRequests(data);
      onCountChange(data.length);
    } catch (err) {
      console.error("Failed to load requests:", err.message);
    } finally {
      setLoading(false);
    }
  }, [onCountChange]);

  // Initial fetch on mount
  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  // ── REAL-TIME LISTENER ────────────────────────────────────────────────────
  // When a "friend_request" custom message arrives via CometChat,
  // re-fetch the requests list to show the new one instantly.
  useEffect(() => {
    const listenerId = "friend-requests-section-listener";
    CometChat.addMessageListener(
      listenerId,
      new CometChat.MessageListener({
        onCustomMessageReceived: (msg) => {
          if (msg.type === "friend_request") {
            fetchRequests(); // Re-fetch to get the new request
          }
        },
      })
    );
    return () => CometChat.removeMessageListener(listenerId);
  }, [fetchRequests]);

  // ── Accept a friend request ───────────────────────────────────────────────
  // Backend will: update DB, register friendship in CometChat, notify sender
  const handleAccept = async (id) => {
    setActing((prev) => ({ ...prev, [id]: true }));
    try {
      await acceptRequest(id);
      setRequests((prev) => prev.filter((r) => r.id !== id));
      onCountChange((c) => Math.max(0, c - 1));
    } catch (err) {
      alert(err.message);
    } finally {
      setActing((prev) => ({ ...prev, [id]: false }));
    }
  };

  // ── Reject a friend request ───────────────────────────────────────────────
  // Backend marks as rejected. Sender can re-send later (ON CONFLICT handles it).
  const handleReject = async (id) => {
    setActing((prev) => ({ ...prev, [id]: true }));
    try {
      await rejectRequest(id);
      setRequests((prev) => prev.filter((r) => r.id !== id));
      onCountChange((c) => Math.max(0, c - 1));
    } catch (err) {
      alert(err.message);
    } finally {
      setActing((prev) => ({ ...prev, [id]: false }));
    }
  };

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading requests…
      </div>
    );
  }

  return (
    <div className="section-container">
      <p className="section-title">
        Friend Requests{requests.length > 0 ? ` (${requests.length})` : ""}
      </p>

      {requests.length === 0 ? (
        <div className="empty-state">
          <p>No pending friend requests.</p>
        </div>
      ) : (
        <div className="request-list">
          {requests.map((req) => (
            <RequestCard
              key={req.id}
              request={req}
              busy={!!acting[req.id]}
              onAccept={handleAccept}
              onReject={handleReject}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Individual request card with Accept/Reject buttons. */
function RequestCard({ request, busy, onAccept, onReject }) {
  const sender = request.sender || {};
  const name = sender.name || request.from_uid;
  const initial = name[0].toUpperCase();
  const timeAgo = formatTimeAgo(request.created_at);

  return (
    <div className="request-card">
      <div className="avatar" aria-hidden="true">
        {initial}
      </div>
      <div className="request-card-info">
        <div className="request-card-name">{name}</div>
        <div className="request-card-time">{timeAgo}</div>
      </div>
      <div className="request-actions">
        <button
          className="btn-sm btn-accept"
          disabled={busy}
          onClick={() => onAccept(request.id)}
          aria-label={`Accept friend request from ${name}`}
        >
          {busy ? "…" : "Accept"}
        </button>
        <button
          className="btn-sm btn-reject"
          disabled={busy}
          onClick={() => onReject(request.id)}
          aria-label={`Reject friend request from ${name}`}
        >
          Reject
        </button>
      </div>
    </div>
  );
}

/** Format a unix timestamp as a relative time string. */
function formatTimeAgo(unixSeconds) {
  if (!unixSeconds) return "";
  const diff = Math.floor(Date.now() / 1000) - unixSeconds;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}