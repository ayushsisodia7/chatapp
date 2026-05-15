/**
 * ============================================================================
 * App.jsx — Root Component & Navigation
 * ============================================================================
 *
 * ARCHITECTURE:
 *   This is the top-level component that manages:
 *     - CometChat initialization and login state
 *     - Tab navigation between the 3 main sections
 *     - Session persistence (survives page refresh within same tab)
 *     - Real-time badge updates for pending friend requests
 *
 * SESSION MANAGEMENT:
 *   Uses sessionStorage (not localStorage) so each browser tab can have
 *   a different user logged in. This makes testing easy — open two tabs,
 *   log in as different users, and test the friend request flow.
 *
 * NAVIGATION:
 *   Three tabs matching the product spec:
 *     1. "Discover Users" — find and add friends
 *     2. "Friend Requests" — accept/reject incoming requests (with badge)
 *     3. "Conversations" — chat with friends (CometChat UI Kit)
 *
 * REAL-TIME BADGE:
 *   A CometChat MessageListener watches for friend_request and
 *   friend_request_accepted custom messages. When received, it refreshes
 *   the pending request count shown on the "Friend Requests" tab badge.
 */

import { useState, useEffect, useCallback } from "react";
import Login from "./components/Login";
import UsersSection from "./components/UsersSection";
import FriendRequestsSection from "./components/FriendRequestsSection";
import ConversationsSection from "./components/ConversationsSection";
import { initCometChat, loginCometChat, logoutCometChat } from "./cometchatInit";
import { getIncomingRequests, login as apiLogin } from "./api";
import { CometChat } from "@cometchat/chat-sdk-javascript";

const TABS = [
  { id: "users", label: "Discover Users" },
  { id: "requests", label: "Friend Requests" },
  { id: "conversations", label: "Conversations" },
];

export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [activeTab, setActiveTab] = useState("users");
  const [pendingCount, setPendingCount] = useState(0);
  const [ccReady, setCcReady] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [startChatWithUid, setStartChatWithUid] = useState(null);

  // ── Initialize CometChat + restore session ────────────────────────────────
  // On mount: init the UI Kit, then check if there's a saved session in
  // sessionStorage (survives refresh within the same tab).
  useEffect(() => {
    initCometChat()
      .then(async () => {
        setCcReady(true);

        // Try to restore session from sessionStorage
        const uid = sessionStorage.getItem("uid");
        const name = sessionStorage.getItem("name");
        if (!uid || !name) return;

        try {
          setLoggingIn(true);
          const data = await apiLogin(uid, name);
          await loginCometChat(data.uid, data.authToken);
          setCurrentUser({ uid: data.uid, name: data.name, authToken: data.authToken });
        } catch {
          sessionStorage.removeItem("uid");
          sessionStorage.removeItem("name");
        } finally {
          setLoggingIn(false);
        }
      })
      .catch(console.error);
  }, []);

  // ── Pending request count ─────────────────────────────────────────────────
  const refreshPendingCount = useCallback(async () => {
    if (!currentUser) return;
    try {
      const reqs = await getIncomingRequests();
      setPendingCount(reqs.length);
    } catch {
      // ignore
    }
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    refreshPendingCount();
  }, [currentUser, refreshPendingCount]);

  // ── REAL-TIME BADGE UPDATES ───────────────────────────────────────────────
  // Listen for friend_request and friend_request_accepted custom messages
  // to keep the badge count accurate without polling.
  useEffect(() => {
    if (!currentUser || !ccReady) return;
    const listenerId = "app-friend-request-listener";
    CometChat.addMessageListener(
      listenerId,
      new CometChat.MessageListener({
        onCustomMessageReceived: (message) => {
          if (
            message.type === "friend_request" ||
            message.type === "friend_request_accepted"
          ) {
            refreshPendingCount();
          }
        },
      })
    );
    return () => CometChat.removeMessageListener(listenerId);
  }, [currentUser, ccReady, refreshPendingCount]);

  // ── Login handler ─────────────────────────────────────────────────────────
  const handleLogin = async (uid, name, authToken) => {
    setLoggingIn(true);
    try {
      // Save to sessionStorage for session persistence across refresh
      sessionStorage.setItem("uid", uid);
      sessionStorage.setItem("name", name);
      await loginCometChat(uid, authToken);
      setCurrentUser({ uid, name, authToken });
    } finally {
      setLoggingIn(false);
    }
  };

  // ── Logout handler ────────────────────────────────────────────────────────
  const handleLogout = async () => {
    await logoutCometChat();
    sessionStorage.removeItem("uid");
    sessionStorage.removeItem("name");
    setCurrentUser(null);
    setActiveTab("users");
    setPendingCount(0);
    setStartChatWithUid(null);
  };

  // ── Cross-section navigation ──────────────────────────────────────────────
  // Called from UsersSection "Message" button — switches to Conversations tab
  const handleStartChat = (uid) => {
    setStartChatWithUid(uid);
    setActiveTab("conversations");
  };

  // Called by ConversationsSection once it has consumed startChatWithUid
  const handleChatOpened = useCallback(() => {
    setStartChatWithUid(null);
  }, []);

  // ── Loading state ─────────────────────────────────────────────────────────
  if (!ccReady || loggingIn) {
    return (
      <div className="loading">
        <div className="spinner" />
        {loggingIn ? "Signing in…" : "Initialising…"}
      </div>
    );
  }

  // ── Not logged in → show login form ───────────────────────────────────────
  if (!currentUser) {
    return <Login onLogin={handleLogin} />;
  }

  // ── Main app shell ────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      {/* Header with app title and user info */}
      <header className="app-header">
        <h1>Friend Chat</h1>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="user-info">Logged in as {currentUser.name}</span>
          <button className="logout-btn" onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      {/* Tab navigation — 3 sections as required by the spec */}
      <nav className="app-nav">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`nav-tab${activeTab === tab.id ? " active" : ""}`}
            onClick={() => {
              setActiveTab(tab.id);
              if (tab.id === "requests") refreshPendingCount();
            }}
          >
            {tab.label}
            {/* Red badge showing pending request count */}
            {tab.id === "requests" && pendingCount > 0 && (
              <span className="badge">{pendingCount}</span>
            )}
          </button>
        ))}
      </nav>

      {/* Main content area — renders the active section */}
      <main className="app-content">
        {activeTab === "users" && (
          <UsersSection
            currentUid={currentUser.uid}
            onStartChat={handleStartChat}
          />
        )}
        {activeTab === "requests" && (
          <FriendRequestsSection
            currentUid={currentUser.uid}
            onCountChange={setPendingCount}
          />
        )}
        {activeTab === "conversations" && (
          <ConversationsSection
            startChatWith={startChatWithUid}
            onChatOpened={handleChatOpened}
          />
        )}
      </main>
    </div>
  );
}