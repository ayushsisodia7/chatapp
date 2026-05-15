/**
 * ConversationsSection — friend-scoped chat interface.
 *
 * CometChat's default conversation component returns every conversation for the
 * logged-in SDK user. This app has stricter rules, so we fetch conversations
 * ourselves and keep only conversations with backend-confirmed friends.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { CometChat } from "@cometchat/chat-sdk-javascript";
import { CometChatMessageHeader } from "@cometchat/chat-uikit-react";
import { checkCanMessage, getFriends } from "../api";

function userUid(user) {
  return user?.getUid?.() || user?.uid || "";
}

function userName(user) {
  return user?.getName?.() || user?.name || userUid(user);
}

function messageCategory(message) {
  return message?.getCategory?.() || message?.category;
}

function messageType(message) {
  return message?.getType?.() || message?.type;
}

function messageSentAt(message) {
  return message?.getSentAt?.() || message?.sentAt || 0;
}

function messageText(message) {
  if (typeof message?.getText === "function") return message.getText();
  return message?.text || message?.data?.text || "";
}

function messageSenderUid(message) {
  return message?.getSender?.()?.getUid?.() || message?.sender?.uid || "";
}

function messageReceiverUid(message) {
  return message?.getReceiverId?.() || message?.receiverId || "";
}

function isVisibleChatMessage(message, friendshipCreatedAt = 0) {
  if (!message) return false;
  if (messageCategory(message) !== "message") return false;
  return messageSentAt(message) >= Number(friendshipCreatedAt || 0);
}

function isMessageForUid(message, uid, loggedInUid) {
  const sender = messageSenderUid(message);
  const receiver = messageReceiverUid(message);
  return (
    (sender === uid && receiver === loggedInUid) ||
    (sender === loggedInUid && receiver === uid)
  );
}

function conversationUid(conversation) {
  return userUid(conversation?.getConversationWith?.());
}

function previewText(message) {
  if (!message) return "No messages yet";
  if (messageType(message) === "text") return messageText(message);
  return "Attachment";
}

function formatTime(unixSeconds) {
  if (!unixSeconds) return "";
  return new Date(unixSeconds * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ConversationsSection({ startChatWith, onChatOpened }) {
  const [activeUser, setActiveUser] = useState(null);
  const [activeFriendshipCreatedAt, setActiveFriendshipCreatedAt] = useState(0);
  const [friendsByUid, setFriendsByUid] = useState({});
  const [conversations, setConversations] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loggedInUid, setLoggedInUid] = useState("");
  const messagesEndRef = useRef(null);
  const activeUidRef = useRef("");
  const friendsRef = useRef({});
  const loggedInUidRef = useRef("");

  useEffect(() => {
    friendsRef.current = friendsByUid;
  }, [friendsByUid]);

  useEffect(() => {
    loggedInUidRef.current = loggedInUid;
  }, [loggedInUid]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ block: "end" });
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const loadMessages = useCallback(async (uid, friendshipCreatedAt) => {
    setLoadingMessages(true);
    try {
      const loggedIn = await CometChat.getLoggedinUser();
      const currentUid = loggedIn?.getUid?.() || loggedInUidRef.current;
      setLoggedInUid(currentUid);

      const request = new CometChat.MessagesRequestBuilder()
        .setUID(uid)
        .setLimit(100)
        .hideDeletedMessages(true)
        .build();
      const fetched = await request.fetchPrevious();
      const visible = fetched.filter(
        (message) =>
          isVisibleChatMessage(message, friendshipCreatedAt) &&
          isMessageForUid(message, uid, currentUid)
      );
      setMessages(visible);
      return visible;
    } catch (err) {
      console.error("Failed to load messages:", err);
      setError("Could not load messages. Please try again.");
      return [];
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  const markConversationAsRead = useCallback((uid, visibleMessages) => {
    const lastReceived = [...visibleMessages]
      .reverse()
      .find((message) => messageSenderUid(message) === uid);

    if (lastReceived) {
      CometChat.markAsRead(lastReceived).catch((err) =>
        console.warn("markAsRead failed:", err)
      );
    }

    setConversations((prev) =>
      prev.map((conversation) => {
        if (conversationUid(conversation) !== uid) return conversation;
        conversation.setUnreadMessageCount?.(0);
        return conversation;
      })
    );
  }, []);

  const syncFriends = useCallback(async () => {
    const friends = await getFriends();
    const friendMap = Object.fromEntries(
      friends.map((friend) => [friend.uid, friend])
    );
    friendsRef.current = friendMap;
    setFriendsByUid(friendMap);
    return friendMap;
  }, []);

  const loadConversations = useCallback(async () => {
    setLoadingConversations(true);
    setError("");

    try {
      const loggedIn = await CometChat.getLoggedinUser();
      const currentUid = loggedIn?.getUid?.() || "";
      loggedInUidRef.current = currentUid;
      setLoggedInUid(currentUid);

      const friendMap = await syncFriends();

      if (Object.keys(friendMap).length === 0) {
        setConversations([]);
        return;
      }

      const request = new CometChat.ConversationsRequestBuilder()
        .setLimit(50)
        .setConversationType("user")
        .build();
      const fetched = await request.fetchNext();

      setConversations(
        fetched.filter((conversation) => {
          const uid = conversationUid(conversation);
          const friend = friendMap[uid];
          if (!friend) return false;
          return isVisibleChatMessage(
            conversation.getLastMessage?.(),
            friend.friendshipCreatedAt
          );
        })
      );
    } catch (err) {
      console.error("Failed to load conversations:", err);
      setError("Could not load conversations. Please refresh.");
    } finally {
      setLoadingConversations(false);
    }
  }, [syncFriends]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const openChat = useCallback(
    async (uidOrUser) => {
      setError("");
      const uid = typeof uidOrUser === "string" ? uidOrUser : userUid(uidOrUser);
      let friend = friendsRef.current[uid];
      if (!friend) {
        const friendMap = await syncFriends();
        friend = friendMap[uid];
      }

      if (!friend) {
        setActiveUser(null);
        setMessages([]);
        activeUidRef.current = "";
        setError("You can only open conversations with friends.");
        onChatOpened?.();
        return;
      }

      try {
        await checkCanMessage(uid);
        const user =
          typeof uidOrUser === "string"
            ? await CometChat.getUser(uid).catch(() => {
                const fallback = new CometChat.User(uid);
                fallback.setName(uid);
                return fallback;
              })
            : uidOrUser;

        setActiveUser(user);
        setActiveFriendshipCreatedAt(friend.friendshipCreatedAt || 0);
        activeUidRef.current = uid;
        const visibleMessages = await loadMessages(
          uid,
          friend.friendshipCreatedAt || 0
        );
        markConversationAsRead(uid, visibleMessages);
        onChatOpened?.();
      } catch (err) {
        setActiveUser(null);
        setMessages([]);
        activeUidRef.current = "";
        setError(err.message || "You can only message friends.");
        onChatOpened?.();
      }
    },
    [loadMessages, markConversationAsRead, onChatOpened, syncFriends]
  );

  useEffect(() => {
    if (startChatWith) openChat(startChatWith);
  }, [startChatWith, openChat]);

  useEffect(() => {
    const listenerId = "conversations-section-listener";
    const refreshForMessage = (message) => {
      const activeUid = activeUidRef.current;
      const friend = friendsRef.current[messageSenderUid(message)];

      if (
        activeUid &&
        friend &&
        isMessageForUid(message, activeUid, loggedInUidRef.current) &&
        isVisibleChatMessage(message, activeFriendshipCreatedAt)
      ) {
        setMessages((prev) => [...prev, message]);
        markConversationAsRead(activeUid, [message]);
      }

      loadConversations();
    };

    CometChat.addMessageListener(
      listenerId,
      new CometChat.MessageListener({
        onTextMessageReceived: refreshForMessage,
        onMediaMessageReceived: refreshForMessage,
        onCustomMessageReceived: (message) => {
          if (
            message.type === "friend_request" ||
            message.type === "friend_request_accepted"
          ) {
            loadConversations();
          }
        },
      })
    );

    return () => CometChat.removeMessageListener(listenerId);
  }, [
    activeFriendshipCreatedAt,
    loadConversations,
    markConversationAsRead,
  ]);

  const handleSend = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    const uid = userUid(activeUser);
    if (!text || !uid || sending) return;

    setSending(true);
    setError("");

    try {
      await checkCanMessage(uid);
      const message = new CometChat.TextMessage(
        uid,
        text,
        CometChat.RECEIVER_TYPE?.USER || "user"
      );
      const sent = await CometChat.sendMessage(message);
      setDraft("");
      setMessages((prev) => [...prev, sent]);
      await loadConversations();
    } catch (err) {
      setError(err.message || "Message could not be sent.");
    } finally {
      setSending(false);
    }
  };

  const activeUid = userUid(activeUser);

  return (
    <div className="chat-layout">
      <aside className="conversation-panel">
        <div className="conversation-panel-header">
          <span>Conversations</span>
          <button type="button" onClick={loadConversations}>
            Refresh
          </button>
        </div>

        {loadingConversations ? (
          <div className="conversation-state">
            <div className="spinner" />
            Loading conversations...
          </div>
        ) : conversations.length === 0 ? (
          <div className="conversation-state">
            No friend conversations yet.
          </div>
        ) : (
          <div className="conversation-list">
            {conversations.map((conversation) => {
              const withUser = conversation.getConversationWith();
              const uid = userUid(withUser);
              const unread = conversation.getUnreadMessageCount?.() || 0;
              const lastMessage = conversation.getLastMessage?.();

              return (
                <button
                  key={conversation.getConversationId?.() || uid}
                  className={`conversation-row${
                    uid === activeUid ? " active" : ""
                  }`}
                  type="button"
                  onClick={() => openChat(withUser)}
                >
                  <span className="avatar" aria-hidden="true">
                    {(userName(withUser) || uid)[0]?.toUpperCase()}
                  </span>
                  <span className="conversation-row-body">
                    <span className="conversation-row-title">
                      {userName(withUser)}
                    </span>
                    <span className="conversation-row-preview">
                      {previewText(lastMessage)}
                    </span>
                  </span>
                  <span className="conversation-row-meta">
                    <span>{formatTime(messageSentAt(lastMessage))}</span>
                    {unread > 0 && <span className="unread-badge">{unread}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </aside>

      <section className="chat-panel">
        {error && (
          <div className="chat-error" role="alert">
            {error}
            <button type="button" onClick={() => setError("")}>
              x
            </button>
          </div>
        )}

        {activeUser ? (
          <>
            <div className="chat-header">
              <CometChatMessageHeader user={activeUser} />
            </div>

            <div className="message-list">
              {loadingMessages ? (
                <div className="conversation-state">
                  <div className="spinner" />
                  Loading messages...
                </div>
              ) : messages.length === 0 ? (
                <div className="conversation-state">
                  No messages since you became friends.
                </div>
              ) : (
                messages.map((message) => {
                  const mine = messageSenderUid(message) === loggedInUid;
                  return (
                    <div
                      key={message.getId?.() || message.getMuid?.()}
                      className={`message-row${mine ? " mine" : ""}`}
                    >
                      <div className="message-bubble">
                        <div>{previewText(message)}</div>
                        <time>{formatTime(messageSentAt(message))}</time>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            <form className="message-composer" onSubmit={handleSend}>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type a message"
                disabled={sending}
              />
              <button type="submit" disabled={sending || !draft.trim()}>
                {sending ? "Sending..." : "Send"}
              </button>
            </form>
          </>
        ) : (
          !error && (
            <div className="chat-empty">
              Select a friend conversation to start chatting.
            </div>
          )
        )}
      </section>
    </div>
  );
}
