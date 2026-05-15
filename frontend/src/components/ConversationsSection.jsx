/**
 * ============================================================================
 * ConversationsSection.jsx — Chat Interface (CometChat UI Kit)
 * ============================================================================
 *
 * ARCHITECTURE DECISION: This section uses CometChat's React UI Kit components
 * (CometChatConversations, CometChatMessageHeader, CometChatMessageList,
 * CometChatMessageComposer) rather than building chat UI from scratch.
 *
 * LAYOUT:
 *   Left panel (320px): Conversation list — shows all user conversations
 *   Right panel (flex): Active chat — header + messages + composer
 *
 * FILTERING APPROACH:
 *   We do NOT use itemView/titleView to filter conversations because the SDK
 *   replaces the entire default renderer when any custom view function is passed.
 *   Returning null/undefined from itemView renders blank rows (no names).
 *
 *   Instead, we rely on the fact that conversations only appear in the list
 *   after messages have been exchanged. Since non-friends CANNOT send messages
 *   (enforced at the backend + CometChat platform level), non-friend
 *   conversations simply won't exist in the list.
 *
 *   The .setConversationType("user") on the builder excludes group conversations.
 *
 * MARK AS READ:
 *   When a user opens a conversation, we fetch the last message sent BY the
 *   other user and call CometChat.markAsRead() on it. This clears:
 *     - The unread count badge on the conversation list
 *     - The "new messages" banner inside the message list
 *   Key: markAsRead only works on messages RECEIVED (not sent by you).
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { CometChat } from "@cometchat/chat-sdk-javascript";
import {
  CometChatConversations,
  CometChatMessageHeader,
  CometChatMessageList,
  CometChatMessageComposer,
} from "@cometchat/chat-uikit-react";

export default function ConversationsSection({ startChatWith, onChatOpened }) {
  const [activeUser, setActiveUser] = useState(null);
  const [error, setError] = useState("");

  // ── Conversations request builder ─────────────────────────────────────────
  // Created once (useMemo), passed to CometChatConversations.
  // setConversationType("user") excludes group conversations.
  const conversationsBuilder = useMemo(
    () =>
      new CometChat.ConversationsRequestBuilder()
        .setLimit(50)
        .setConversationType("user"),
    []
  );

  // ── Mark conversation as read ─────────────────────────────────────────────
  // Fetches the last message sent BY the other user and marks it as read.
  // This clears the unread badge and "new messages" banner.
  const markConversationAsRead = useCallback((uid) => {
    CometChat.getLoggedinUser().then((loggedInUser) => {
      if (!loggedInUser) return;

      new CometChat.MessagesRequestBuilder()
        .setUID(uid)
        .setLimit(50)
        .build()
        .fetchPrevious()
        .then((messages) => {
          // Find the last message sent by the OTHER user (not by us)
          // markAsRead only works on received messages
          const lastReceived = [...messages]
            .reverse()
            .find((m) => m.getSender().getUid() !== loggedInUser.getUid());

          if (lastReceived) {
            CometChat.markAsRead(lastReceived).catch((err) =>
              console.warn("markAsRead failed:", err)
            );
          }
        })
        .catch((err) => console.warn("fetchPrevious failed:", err));
    });
  }, []);

  // ── Open a chat ───────────────────────────────────────────────────────────
  // Accepts a UID string, a CometChat User object, or a plain { uid, name } object.
  // Fetches the full user profile from CometChat so the header shows the real name.
  const openChatRef = useRef(null);

  const openChat = useCallback(
    (uidOrUser) => {
      setError("");
      try {
        let user;
        if (typeof uidOrUser === "string") {
          // Fetch full profile from CometChat so header shows real name/avatar
          CometChat.getUser(uidOrUser)
            .then((u) => {
              setActiveUser(u);
              setTimeout(() => markConversationAsRead(u.getUid()), 300);
            })
            .catch(() => {
              const u = new CometChat.User(uidOrUser);
              u.setName(uidOrUser);
              setActiveUser(u);
              setTimeout(() => markConversationAsRead(uidOrUser), 300);
            });
          onChatOpened?.();
          return;
        } else if (typeof uidOrUser?.getUid === "function") {
          user = uidOrUser;
        } else {
          user = new CometChat.User(uidOrUser.uid);
          user.setName(uidOrUser.name || uidOrUser.uid);
        }

        setActiveUser(user);
        setTimeout(() => markConversationAsRead(user.getUid()), 300);
        onChatOpened?.();
      } catch (err) {
        setError(`Could not open chat: ${err?.message ?? String(err)}`);
      }
    },
    [onChatOpened, markConversationAsRead]
  );

  openChatRef.current = openChat;

  // Triggered from UsersSection "Message" button (via startChatWith prop)
  useEffect(() => {
    if (startChatWith) openChatRef.current(startChatWith);
  }, [startChatWith]);

  // ── Conversation list click handler ───────────────────────────────────────
  const handleConversationClick = useCallback((conversation) => {
    setError("");
    try {
      if (conversation.getConversationType() === "user") {
        openChatRef.current(conversation.getConversationWith());
      }
    } catch (e) {
      console.error("Conversation click error:", e);
    }
  }, []);

  const activeUid = activeUser?.getUid?.() ?? null;

  // Build activeConversation for the SDK to highlight the selected row
  const activeConversation = useMemo(() => {
    if (!activeUser) return undefined;
    const c = new CometChat.Conversation();
    c.setConversationWith(activeUser);
    c.setConversationType("user");
    return c;
  }, [activeUser]);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* ── Left panel: Conversation list (SDK renders natively) ── */}
      <div
        style={{
          width: 320,
          flexShrink: 0,
          borderRight: "1px solid #e5e7eb",
          height: "100%",
          overflow: "hidden",
        }}
      >
        <CometChatConversations
          conversationsRequestBuilder={conversationsBuilder}
          onItemClick={handleConversationClick}
          activeConversation={activeConversation}
          onError={(err) => console.warn("Conversations error:", err)}
        />
      </div>

      {/* ── Right panel: Active chat ── */}
      <div
        style={{
          flex: 1,
          height: "100%",
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {error && (
          <div
            role="alert"
            style={{
              position: "absolute",
              top: 12,
              left: "50%",
              transform: "translateX(-50%)",
              background: "#fef2f2",
              border: "1px solid #fecaca",
              color: "#b91c1c",
              padding: "8px 16px",
              borderRadius: 8,
              fontSize: "0.85rem",
              zIndex: 10,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {error}
            <button
              onClick={() => setError("")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#b91c1c",
                fontWeight: 700,
                fontSize: "1rem",
                lineHeight: 1,
              }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {activeUser ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              overflow: "hidden",
            }}
          >
            {/* Message header — shows user name, avatar, online status */}
            <div style={{ flexShrink: 0 }}>
              <CometChatMessageHeader user={activeUser} />
            </div>
            {/* Message list — key={activeUid} forces remount on user change */}
            <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
              <CometChatMessageList key={activeUid} user={activeUser} />
            </div>
            {/* Message composer — text input + send button */}
            <div style={{ flexShrink: 0 }}>
              <CometChatMessageComposer user={activeUser} />
            </div>
          </div>
        ) : (
          !error && (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#9ca3af",
                fontSize: "0.95rem",
              }}
            >
              Select a conversation to start chatting.
            </div>
          )
        )}
      </div>
    </div>
  );
}
