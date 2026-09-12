/**
 * Player-data facade: routes to D1 or RTDB based on PLAYER_DATA_BACKEND.
 * Game gating flags + weekly activity follow the same switch.
 */

import { useD1PlayerData } from "@/lib/d1-client";
import * as d1 from "@/lib/d1-server";
import * as rtdb from "@/lib/rtdb-server";
import { scheduleWorkerWork } from "@/lib/worker-context";

export type { GameStateRecord, ShufflePendingRecord } from "@/lib/rtdb-server";

export {
  SparkSpendError,
  InfiniteSparkActivationError,
  SparkRefillActivationError,
  ScoreSubmitActivationError,
  StreakSyncError,
  StreakRewardError,
  GameStateConflictError,
  // Pure helpers (identical on both backends)
  readStoredScore,
  storedProgressToGameProgress,
  shuffleUtcDayKey,
  shuffleUsdtReservationKey,
  resolveActivityWeekId,
  findActivityRank,
  // Raw RTDB shallow read (admin tools that still need RTDB trees)
  readPathShallow,
} from "@/lib/rtdb-server";

async function withPlayerBackend<T>(
  d1Fn: () => Promise<T>,
  rtdbFn: () => Promise<T>
): Promise<T> {
  if (await useD1PlayerData()) return d1Fn();
  return rtdbFn();
}

// ─── Game gating flags ───────────────────────────────────────────────────────

export async function fetchGameGatingFlagsFromRtdb(
  ...args: Parameters<typeof rtdb.fetchGameGatingFlagsFromRtdb>
): ReturnType<typeof rtdb.fetchGameGatingFlagsFromRtdb> {
  return withPlayerBackend(
    () => d1.fetchGameGatingFlagsFromRtdb(...args),
    () => rtdb.fetchGameGatingFlagsFromRtdb(...args)
  );
}

export async function syncGameGatingFlagsToRtdb(
  ...args: Parameters<typeof rtdb.syncGameGatingFlagsToRtdb>
): ReturnType<typeof rtdb.syncGameGatingFlagsToRtdb> {
  return withPlayerBackend(
    () => d1.syncGameGatingFlagsToRtdb(...args),
    () => rtdb.syncGameGatingFlagsToRtdb(...args)
  );
}

export async function deleteGameGatingFlagsFromRtdb(
  ...args: Parameters<typeof rtdb.deleteGameGatingFlagsFromRtdb>
): ReturnType<typeof rtdb.deleteGameGatingFlagsFromRtdb> {
  return withPlayerBackend(
    () => d1.deleteGameGatingFlagsFromRtdb(...args),
    () => rtdb.deleteGameGatingFlagsFromRtdb(...args)
  );
}

export async function listGameGatingFlagIds(
  ...args: Parameters<typeof rtdb.listGameGatingFlagIds>
): ReturnType<typeof rtdb.listGameGatingFlagIds> {
  return withPlayerBackend(
    () => d1.listGameGatingFlagIds(...args),
    () => rtdb.listGameGatingFlagIds(...args)
  );
}

// ─── Weekly activity ─────────────────────────────────────────────────────────

export async function recordActivityEvent(
  ...args: Parameters<typeof rtdb.recordActivityEvent>
): ReturnType<typeof rtdb.recordActivityEvent> {
  return withPlayerBackend(
    () => d1.recordActivityEvent(...args),
    () => rtdb.recordActivityEvent(...args)
  );
}

export function recordActivityEventBestEffort(
  ...args: Parameters<typeof rtdb.recordActivityEventBestEffort>
): ReturnType<typeof rtdb.recordActivityEventBestEffort> {
  // waitUntil is primed by rate-limit KV / D1 earlier in the request.
  scheduleWorkerWork(
    (async () => {
      if (await useD1PlayerData()) {
        await d1.recordActivityEvent(...args);
      } else {
        await rtdb.recordActivityEvent(...args);
      }
    })()
  );
}

export async function fetchActivityLeaderboardFromServer(
  ...args: Parameters<typeof rtdb.fetchActivityLeaderboardFromServer>
): ReturnType<typeof rtdb.fetchActivityLeaderboardFromServer> {
  return withPlayerBackend(
    () => d1.fetchActivityLeaderboardFromServer(...args),
    () => rtdb.fetchActivityLeaderboardFromServer(...args)
  );
}

export async function fetchUserActivityFromServer(
  ...args: Parameters<typeof rtdb.fetchUserActivityFromServer>
): ReturnType<typeof rtdb.fetchUserActivityFromServer> {
  return withPlayerBackend(
    () => d1.fetchUserActivityFromServer(...args),
    () => rtdb.fetchUserActivityFromServer(...args)
  );
}

// ─── Users ───────────────────────────────────────────────────────────────────

export async function fetchUserFromServer(
  ...args: Parameters<typeof rtdb.fetchUserFromServer>
): ReturnType<typeof rtdb.fetchUserFromServer> {
  return withPlayerBackend(
    () => d1.fetchUserFromServer(...args),
    () => rtdb.fetchUserFromServer(...args)
  );
}

export async function upsertUserOnServer(
  ...args: Parameters<typeof rtdb.upsertUserOnServer>
): ReturnType<typeof rtdb.upsertUserOnServer> {
  return withPlayerBackend(
    () => d1.upsertUserOnServer(...args),
    () => rtdb.upsertUserOnServer(...args)
  );
}

export async function bootstrapUserOnServer(
  ...args: Parameters<typeof rtdb.bootstrapUserOnServer>
): ReturnType<typeof rtdb.bootstrapUserOnServer> {
  return withPlayerBackend(
    () => d1.bootstrapUserOnServer(...args),
    () => rtdb.bootstrapUserOnServer(...args)
  );
}

// ─── Sparks ───────────────────────────────────────────────────────────────────

export async function readSparkStateFromServer(
  ...args: Parameters<typeof rtdb.readSparkStateFromServer>
): ReturnType<typeof rtdb.readSparkStateFromServer> {
  return withPlayerBackend(
    () => d1.readSparkStateFromServer(...args),
    () => rtdb.readSparkStateFromServer(...args)
  );
}

export async function fetchHomePlayerFromServer(
  ...args: Parameters<typeof rtdb.fetchHomePlayerFromServer>
): ReturnType<typeof rtdb.fetchHomePlayerFromServer> {
  return withPlayerBackend(
    () => d1.fetchHomePlayerFromServer(...args),
    () => rtdb.fetchHomePlayerFromServer(...args)
  );
}

export async function fetchSparkStateFromServer(
  ...args: Parameters<typeof rtdb.fetchSparkStateFromServer>
): ReturnType<typeof rtdb.fetchSparkStateFromServer> {
  return withPlayerBackend(
    () => d1.fetchSparkStateFromServer(...args),
    () => rtdb.fetchSparkStateFromServer(...args)
  );
}

export async function ensureSparkStateOnServer(
  ...args: Parameters<typeof rtdb.ensureSparkStateOnServer>
): ReturnType<typeof rtdb.ensureSparkStateOnServer> {
  return withPlayerBackend(
    () => d1.ensureSparkStateOnServer(...args),
    () => rtdb.ensureSparkStateOnServer(...args)
  );
}

export async function getSparkSnapshotFromServer(
  ...args: Parameters<typeof rtdb.getSparkSnapshotFromServer>
): ReturnType<typeof rtdb.getSparkSnapshotFromServer> {
  return withPlayerBackend(
    () => d1.getSparkSnapshotFromServer(...args),
    () => rtdb.getSparkSnapshotFromServer(...args)
  );
}

export async function spendSparkOnServer(
  ...args: Parameters<typeof rtdb.spendSparkOnServer>
): ReturnType<typeof rtdb.spendSparkOnServer> {
  return withPlayerBackend(
    () => d1.spendSparkOnServer(...args),
    () => rtdb.spendSparkOnServer(...args)
  );
}

export async function activateInfiniteSparkOnServer(
  ...args: Parameters<typeof rtdb.activateInfiniteSparkOnServer>
): ReturnType<typeof rtdb.activateInfiniteSparkOnServer> {
  return withPlayerBackend(
    () => d1.activateInfiniteSparkOnServer(...args),
    () => rtdb.activateInfiniteSparkOnServer(...args)
  );
}

export async function activateSparkRefillOnServer(
  ...args: Parameters<typeof rtdb.activateSparkRefillOnServer>
): ReturnType<typeof rtdb.activateSparkRefillOnServer> {
  return withPlayerBackend(
    () => d1.activateSparkRefillOnServer(...args),
    () => rtdb.activateSparkRefillOnServer(...args)
  );
}

// ─── Streak / shuffle grants ─────────────────────────────────────────────────

export async function recordCheckInTxOnServer(
  ...args: Parameters<typeof rtdb.recordCheckInTxOnServer>
): ReturnType<typeof rtdb.recordCheckInTxOnServer> {
  return withPlayerBackend(
    () => d1.recordCheckInTxOnServer(...args),
    () => rtdb.recordCheckInTxOnServer(...args)
  );
}

export async function grantStreakInfiniteSparkOnServer(
  ...args: Parameters<typeof rtdb.grantStreakInfiniteSparkOnServer>
): ReturnType<typeof rtdb.grantStreakInfiniteSparkOnServer> {
  return withPlayerBackend(
    () => d1.grantStreakInfiniteSparkOnServer(...args),
    () => rtdb.grantStreakInfiniteSparkOnServer(...args)
  );
}

export async function recordSpinTxOnServer(
  ...args: Parameters<typeof rtdb.recordSpinTxOnServer>
): ReturnType<typeof rtdb.recordSpinTxOnServer> {
  return withPlayerBackend(
    () => d1.recordSpinTxOnServer(...args),
    () => rtdb.recordSpinTxOnServer(...args)
  );
}

export async function grantShuffleInfiniteSparkOnServer(
  ...args: Parameters<typeof rtdb.grantShuffleInfiniteSparkOnServer>
): ReturnType<typeof rtdb.grantShuffleInfiniteSparkOnServer> {
  return withPlayerBackend(
    () => d1.grantShuffleInfiniteSparkOnServer(...args),
    () => rtdb.grantShuffleInfiniteSparkOnServer(...args)
  );
}

// ─── Play counts ─────────────────────────────────────────────────────────────

export async function fetchGamePlayCountsForIds(
  ...args: Parameters<typeof rtdb.fetchGamePlayCountsForIds>
): ReturnType<typeof rtdb.fetchGamePlayCountsForIds> {
  return withPlayerBackend(
    () => d1.fetchGamePlayCountsForIds(...args),
    () => rtdb.fetchGamePlayCountsForIds(...args)
  );
}

export async function fetchAllGamePlayCounts(
  ...args: Parameters<typeof rtdb.fetchAllGamePlayCounts>
): ReturnType<typeof rtdb.fetchAllGamePlayCounts> {
  return withPlayerBackend(
    () => d1.fetchAllGamePlayCounts(...args),
    () => rtdb.fetchAllGamePlayCounts(...args)
  );
}

export async function fetchGamePlayCount(
  ...args: Parameters<typeof rtdb.fetchGamePlayCount>
): ReturnType<typeof rtdb.fetchGamePlayCount> {
  return withPlayerBackend(
    () => d1.fetchGamePlayCount(...args),
    () => rtdb.fetchGamePlayCount(...args)
  );
}

export async function incrementGamePlayCount(
  ...args: Parameters<typeof rtdb.incrementGamePlayCount>
): ReturnType<typeof rtdb.incrementGamePlayCount> {
  return withPlayerBackend(
    () => d1.incrementGamePlayCount(...args),
    () => rtdb.incrementGamePlayCount(...args)
  );
}

// ─── Leaderboard / contest ───────────────────────────────────────────────────

export async function fetchLeaderboardFromServer(
  ...args: Parameters<typeof rtdb.fetchLeaderboardFromServer>
): ReturnType<typeof rtdb.fetchLeaderboardFromServer> {
  return withPlayerBackend(
    () => d1.fetchLeaderboardFromServer(...args),
    () => rtdb.fetchLeaderboardFromServer(...args)
  );
}

export async function fetchUserSubmittedScoreFromServer(
  ...args: Parameters<typeof rtdb.fetchUserSubmittedScoreFromServer>
): ReturnType<typeof rtdb.fetchUserSubmittedScoreFromServer> {
  return withPlayerBackend(
    () => d1.fetchUserSubmittedScoreFromServer(...args),
    () => rtdb.fetchUserSubmittedScoreFromServer(...args)
  );
}

export const fetchUserBestScoreFromServer = fetchUserSubmittedScoreFromServer;

export async function fetchPersonalBestFromServer(
  ...args: Parameters<typeof rtdb.fetchPersonalBestFromServer>
): ReturnType<typeof rtdb.fetchPersonalBestFromServer> {
  return withPlayerBackend(
    () => d1.fetchPersonalBestFromServer(...args),
    () => rtdb.fetchPersonalBestFromServer(...args)
  );
}

export async function submitLeaderboardEntryOnServer(
  ...args: Parameters<typeof rtdb.submitLeaderboardEntryOnServer>
): ReturnType<typeof rtdb.submitLeaderboardEntryOnServer> {
  return withPlayerBackend(
    () => d1.submitLeaderboardEntryOnServer(...args),
    () => rtdb.submitLeaderboardEntryOnServer(...args)
  );
}

export async function submitContestLeaderboardEntryOnServer(
  ...args: Parameters<typeof rtdb.submitContestLeaderboardEntryOnServer>
): ReturnType<typeof rtdb.submitContestLeaderboardEntryOnServer> {
  return withPlayerBackend(
    () => d1.submitContestLeaderboardEntryOnServer(...args),
    () => rtdb.submitContestLeaderboardEntryOnServer(...args)
  );
}

export async function fetchContestLeaderboardFromServer(
  ...args: Parameters<typeof rtdb.fetchContestLeaderboardFromServer>
): ReturnType<typeof rtdb.fetchContestLeaderboardFromServer> {
  return withPlayerBackend(
    () => d1.fetchContestLeaderboardFromServer(...args),
    () => rtdb.fetchContestLeaderboardFromServer(...args)
  );
}

// ─── Progress / state / score submit ─────────────────────────────────────────

export async function fetchGameProgressFromServer(
  ...args: Parameters<typeof rtdb.fetchGameProgressFromServer>
): ReturnType<typeof rtdb.fetchGameProgressFromServer> {
  return withPlayerBackend(
    () => d1.fetchGameProgressFromServer(...args),
    () => rtdb.fetchGameProgressFromServer(...args)
  );
}

export async function resolveGameProgressFromServer(
  ...args: Parameters<typeof rtdb.resolveGameProgressFromServer>
): ReturnType<typeof rtdb.resolveGameProgressFromServer> {
  return withPlayerBackend(
    () => d1.resolveGameProgressFromServer(...args),
    () => rtdb.resolveGameProgressFromServer(...args)
  );
}

export async function activateScoreSubmitOnServer(
  ...args: Parameters<typeof rtdb.activateScoreSubmitOnServer>
): ReturnType<typeof rtdb.activateScoreSubmitOnServer> {
  return withPlayerBackend(
    () => d1.activateScoreSubmitOnServer(...args),
    () => rtdb.activateScoreSubmitOnServer(...args)
  );
}

export async function saveGameProgressOnServer(
  ...args: Parameters<typeof rtdb.saveGameProgressOnServer>
): ReturnType<typeof rtdb.saveGameProgressOnServer> {
  return withPlayerBackend(
    () => d1.saveGameProgressOnServer(...args),
    () => rtdb.saveGameProgressOnServer(...args)
  );
}

export async function fetchGameStateFromServer(
  ...args: Parameters<typeof rtdb.fetchGameStateFromServer>
): ReturnType<typeof rtdb.fetchGameStateFromServer> {
  return withPlayerBackend(
    () => d1.fetchGameStateFromServer(...args),
    () => rtdb.fetchGameStateFromServer(...args)
  );
}

export async function saveGameStateOnServer(
  ...args: Parameters<typeof rtdb.saveGameStateOnServer>
): ReturnType<typeof rtdb.saveGameStateOnServer> {
  return withPlayerBackend(
    () => d1.saveGameStateOnServer(...args),
    () => rtdb.saveGameStateOnServer(...args)
  );
}

// ─── Shuffle budget / pending ────────────────────────────────────────────────

export async function getShuffleUsdtBudgetRemainingMicro(
  ...args: Parameters<typeof rtdb.getShuffleUsdtBudgetRemainingMicro>
): ReturnType<typeof rtdb.getShuffleUsdtBudgetRemainingMicro> {
  return withPlayerBackend(
    () => d1.getShuffleUsdtBudgetRemainingMicro(...args),
    () => rtdb.getShuffleUsdtBudgetRemainingMicro(...args)
  );
}

export async function reserveShuffleUsdtBudget(
  ...args: Parameters<typeof rtdb.reserveShuffleUsdtBudget>
): ReturnType<typeof rtdb.reserveShuffleUsdtBudget> {
  return withPlayerBackend(
    () => d1.reserveShuffleUsdtBudget(...args),
    () => rtdb.reserveShuffleUsdtBudget(...args)
  );
}

export async function confirmShuffleUsdtBudget(
  ...args: Parameters<typeof rtdb.confirmShuffleUsdtBudget>
): ReturnType<typeof rtdb.confirmShuffleUsdtBudget> {
  return withPlayerBackend(
    () => d1.confirmShuffleUsdtBudget(...args),
    () => rtdb.confirmShuffleUsdtBudget(...args)
  );
}

export async function saveShufflePending(
  ...args: Parameters<typeof rtdb.saveShufflePending>
): ReturnType<typeof rtdb.saveShufflePending> {
  return withPlayerBackend(
    () => d1.saveShufflePending(...args),
    () => rtdb.saveShufflePending(...args)
  );
}

export async function getShufflePending(
  ...args: Parameters<typeof rtdb.getShufflePending>
): ReturnType<typeof rtdb.getShufflePending> {
  return withPlayerBackend(
    () => d1.getShufflePending(...args),
    () => rtdb.getShufflePending(...args)
  );
}

export async function bindShufflePendingDevice(
  ...args: Parameters<typeof rtdb.bindShufflePendingDevice>
): ReturnType<typeof rtdb.bindShufflePendingDevice> {
  return withPlayerBackend(
    () => d1.bindShufflePendingDevice(...args),
    () => rtdb.bindShufflePendingDevice(...args)
  );
}

export async function markShufflePendingConsumed(
  ...args: Parameters<typeof rtdb.markShufflePendingConsumed>
): ReturnType<typeof rtdb.markShufflePendingConsumed> {
  return withPlayerBackend(
    () => d1.markShufflePendingConsumed(...args),
    () => rtdb.markShufflePendingConsumed(...args)
  );
}

// ─── Device binding ──────────────────────────────────────────────────────────

export async function recordDeviceSeenIfAbsent(
  ...args: Parameters<typeof rtdb.recordDeviceSeenIfAbsent>
): ReturnType<typeof rtdb.recordDeviceSeenIfAbsent> {
  return withPlayerBackend(
    () => d1.recordDeviceSeenIfAbsent(...args),
    () => rtdb.recordDeviceSeenIfAbsent(...args)
  );
}

export async function getDeviceSeenAt(
  ...args: Parameters<typeof rtdb.getDeviceSeenAt>
): ReturnType<typeof rtdb.getDeviceSeenAt> {
  return withPlayerBackend(
    () => d1.getDeviceSeenAt(...args),
    () => rtdb.getDeviceSeenAt(...args)
  );
}

export async function bindWalletSessionDevice(
  ...args: Parameters<typeof rtdb.bindWalletSessionDevice>
): ReturnType<typeof rtdb.bindWalletSessionDevice> {
  return withPlayerBackend(
    () => d1.bindWalletSessionDevice(...args),
    () => rtdb.bindWalletSessionDevice(...args)
  );
}

export async function getWalletSessionDeviceHash(
  ...args: Parameters<typeof rtdb.getWalletSessionDeviceHash>
): ReturnType<typeof rtdb.getWalletSessionDeviceHash> {
  return withPlayerBackend(
    () => d1.getWalletSessionDeviceHash(...args),
    () => rtdb.getWalletSessionDeviceHash(...args)
  );
}
