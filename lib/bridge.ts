import type { RefObject } from "react";
import { storeLeaderboardSubmitResult } from "@/lib/leaderboard-submit-result";

/**
 * bridge.ts
 * Sends messages from the Next.js shell into the Unity WebGL iframe.
 */

const UNITY_CALLBACK_RETRIES_MS = [
  0, 100, 300, 800, 1500, 3000, 5000, 8000, 12000, 20000, 30000, 45000, 60000,
] as const;

export function sendToUnity(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  method: string,
  payload: unknown = ""
): void {
  const value =
    typeof payload === "string" ? payload : JSON.stringify(payload);

  const message = { type: "UNITY_CALLBACK", method, value };

  for (const delay of UNITY_CALLBACK_RETRIES_MS) {
    if (delay === 0) {
      postUnityCallback(iframeRef, message);
      continue;
    }
    setTimeout(() => postUnityCallback(iframeRef, message), delay);
  }
}

function postUnityCallback(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  message: { type: string; method: string; value: string }
): void {
  const target = iframeRef.current?.contentWindow;
  if (target) {
    target.postMessage(message, "*");
    tryDeliverDirectBridgeCallback(target, message.method, message.value);
    return;
  }

  const unityInstance = (
    window as Window & {
      unityInstance?: {
        SendMessage: (obj: string, method: string, value: string) => void;
      };
    }
  ).unityInstance;
  if (unityInstance?.SendMessage) {
    unityInstance.SendMessage("ArcadeXBridge", message.method, message.value);
  }
}

function tryDeliverDirectBridgeCallback(
  target: Window,
  method: string,
  value: string
): void {
  try {
    const deliver = (
      target as Window & {
        __arcadeXDeliverCallback?: (method: string, value: string) => void;
      }
    ).__arcadeXDeliverCallback;
    deliver?.(method, value);
  } catch {
    // Cross-origin or unavailable — postMessage path still used.
  }
}

/** Re-send the last stored submit result (e.g. after iframe reload or bootstrap). */
export function replayLeaderboardSubmitToUnity(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  gameId: string,
  result: LeaderboardSubmitUnityResult
): void {
  notifyUnityLeaderboardSubmit(iframeRef, result, { persist: false });
}

/** Notify Unity of paid leaderboard submit — primary + legacy callbacks. */
export function notifyUnityLeaderboardSubmit(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  result: LeaderboardSubmitUnityResult,
  opts?: { gameId?: string; persist?: boolean }
): void {
  const payload = {
    success: result.success,
    highScore: result.highScore ?? 0,
    leaderboardScore: result.leaderboardScore ?? 0,
    error: result.error ?? "",
  };

  if (opts?.persist !== false && opts?.gameId) {
    storeLeaderboardSubmitResult(opts.gameId, result);
  }

  sendToUnity(iframeRef, "OnLeaderboardSubmitComplete", payload);

  // Legacy games may still listen on OnScoreSubmitted (not OnProgressSaved).
  sendToUnity(iframeRef, "OnScoreSubmitted", payload);
}

export interface LeaderboardSubmitUnityResult {
  success: boolean;
  highScore?: number;
  leaderboardScore?: number;
  error?: string;
}

/** Unity → shell message types (wallet-agnostic naming). */
export type GameBridgeMessageType =
  | "GAME_BOOTSTRAP"
  | "GAME_PROGRESS_SAVE"
  | "GAME_PROGRESS_GET"
  | "GAME_LEADERBOARD_GET"
  | "GAME_LEADERBOARD_SUBMIT"
  | "GAME_LEADERBOARD_SUBMIT_POLL"
  | "GAME_STATE_GET"
  | "GAME_STATE_SAVE";

/** @deprecated Legacy MiniPay-prefixed aliases — still accepted inbound. */
export type LegacyUnityMessageType =
  | "MINIPAY_BOOTSTRAP"
  | "MINIPAY_SYNC_USER_STATE"
  | "MINIPAY_COMPLETE_TUTORIAL"
  | "MINIPAY_REQUEST_STATUS"
  | "MINIPAY_PURCHASE_GAME"
  | "MINIPAY_BUY_HINTS"
  | "MINIPAY_BUY_REVIVE"
  | "MINIPAY_BUY_LIVES"
  | "MINIPAY_SUBMIT_SCORE"
  | "MINIPAY_GET_LEADERBOARD"
  | "MINIPAY_GET_PROGRESS"
  | "MINIPAY_SAVE_PROGRESS";

export type UnityMessageType = GameBridgeMessageType | LegacyUnityMessageType;

export interface UnityMessage {
  type: UnityMessageType;
  payload?: unknown;
  requestId?: string;
}

const LEGACY_MESSAGE_ALIASES: Record<string, GameBridgeMessageType> = {
  MINIPAY_BOOTSTRAP: "GAME_BOOTSTRAP",
  MINIPAY_SAVE_PROGRESS: "GAME_PROGRESS_SAVE",
  MINIPAY_SUBMIT_SCORE: "GAME_PROGRESS_SAVE",
  MINIPAY_GET_PROGRESS: "GAME_PROGRESS_GET",
  MINIPAY_GET_LEADERBOARD: "GAME_LEADERBOARD_GET",
};

const HANDLED_GAME_MESSAGES = new Set<GameBridgeMessageType>([
  "GAME_BOOTSTRAP",
  "GAME_PROGRESS_SAVE",
  "GAME_PROGRESS_GET",
  "GAME_LEADERBOARD_GET",
  "GAME_LEADERBOARD_SUBMIT",
  "GAME_LEADERBOARD_SUBMIT_POLL",
  "GAME_STATE_GET",
  "GAME_STATE_SAVE",
]);

export function normalizeUnityMessageType(
  type: string | undefined
): GameBridgeMessageType | null {
  if (!type) return null;
  const aliased = LEGACY_MESSAGE_ALIASES[type] ?? type;
  if (HANDLED_GAME_MESSAGES.has(aliased as GameBridgeMessageType)) {
    return aliased as GameBridgeMessageType;
  }
  return null;
}

export function isUnityBridgeMessage(type: string | undefined): boolean {
  if (!type) return false;
  if (normalizeUnityMessageType(type)) return true;
  return type.startsWith("MINIPAY_");
}
