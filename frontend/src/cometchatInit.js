/**
 * ============================================================================
 * cometchatInit.js — CometChat UI Kit Initialization
 * ============================================================================
 *
 * ARCHITECTURE DECISION: The UI Kit is initialized ONCE at app startup.
 * Login happens separately after the backend issues an auth token.
 *
 * KEY POINT: We use loginWithAuthToken (not loginWithUID) because:
 *   - Auth tokens are issued by our backend after identity verification
 *   - The frontend never has access to the CometChat Auth Key for login
 *   - This prevents unauthorized users from logging in as someone else
 *
 * subscribePresenceForFriends() — tells CometChat to only send presence
 * updates (online/offline) for friends, reducing unnecessary traffic.
 */

import { CometChatUIKit, UIKitSettingsBuilder } from "@cometchat/chat-uikit-react";
import { CometChat } from "@cometchat/chat-sdk-javascript";

const APP_ID = import.meta.env.VITE_COMETCHAT_APP_ID;
const REGION = import.meta.env.VITE_COMETCHAT_REGION || "us";
const AUTH_KEY = import.meta.env.VITE_COMETCHAT_AUTH_KEY;

let initialised = false;

/**
 * Initialize the CometChat UI Kit. Safe to call multiple times — subsequent
 * calls are no-ops. Must be called before rendering any UI Kit components.
 */
export async function initCometChat() {
  if (initialised) return;

  const settings = new UIKitSettingsBuilder()
    .setAppId(APP_ID)
    .setRegion(REGION)
    .setAuthKey(AUTH_KEY)
    .setStorageMode(CometChat.StorageMode.SESSION)
    .subscribePresenceForFriends()
    .build();

  await CometChatUIKit.init(settings);
  initialised = true;
}

/**
 * Log in to CometChat using the auth token issued by our backend.
 * Must be called after initCometChat().
 *
 * If already logged in as this user, returns the existing session.
 */
export async function loginCometChat(uid, authToken) {
  const existing = await CometChatUIKit.getLoggedinUser();
  if (existing && existing.getUid() === uid) return existing;
  if (existing) {
    await CometChatUIKit.logout();
  }

  return CometChatUIKit.loginWithAuthToken(authToken);
}

/**
 * Log out of CometChat. Clears the session and stops all listeners.
 */
export async function logoutCometChat() {
  return CometChatUIKit.logout();
}
