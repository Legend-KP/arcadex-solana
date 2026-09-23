import { extractModeLevels, normalizeProgressMode } from "@/lib/progress-value";
import { StoredGameProgress } from "@/types";

export type MissionType = "score" | "level";

export interface Mission {
  id: string;
  gameId: string;
  title: string;
  description: string;
  type: MissionType;
  threshold: number;
  /** Empty uses the game's overall score or level. */
  mode: string;
  xpReward: number;
  active: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

export interface MissionProgressView extends Mission {
  current: number;
  claimable: boolean;
  claimed: boolean;
}

export function isMissionType(value: unknown): value is MissionType {
  return value === "score" || value === "level";
}

export interface MissionWriteInput {
  gameId: string;
  title: string;
  description: string;
  type: MissionType;
  threshold: number;
  mode: string;
  xpReward: number;
  active: boolean;
  sortOrder: number;
}

function readInt(value: unknown, label: string, min: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`${label} must be an integer of at least ${min}.`);
  }
  return n;
}

export function parseMissionWrite(body: unknown): MissionWriteInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid mission.");
  }
  const raw = body as Record<string, unknown>;
  const gameId = typeof raw.gameId === "string" ? raw.gameId.trim() : "";
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const description =
    typeof raw.description === "string" ? raw.description.trim() : "";
  const mode = typeof raw.mode === "string" ? raw.mode.trim() : "";

  if (!gameId || gameId.length > 80) throw new Error("Game id is required.");
  if (!title || title.length > 80) {
    throw new Error("Title must be 1–80 characters.");
  }
  if (description.length > 240) {
    throw new Error("Description must be 240 characters or fewer.");
  }
  if (mode.length > 32) throw new Error("Mode must be 32 characters or fewer.");
  if (!isMissionType(raw.type)) {
    throw new Error("Type must be score or level.");
  }

  return {
    gameId,
    title,
    description,
    type: raw.type,
    threshold: readInt(raw.threshold, "Threshold", 1),
    mode,
    xpReward: readInt(raw.xpReward, "XP reward", 1),
    active: raw.active !== false,
    sortOrder: raw.sortOrder === undefined ? 0 : readInt(raw.sortOrder, "Sort order", 0),
  };
}

/** Current progress for a mission from stored game progress. Read-only. */
export function missionCurrentValue(
  mission: Pick<Mission, "type" | "mode">,
  progress: StoredGameProgress | null | undefined
): number {
  if (!progress) return 0;

  if (mission.type === "score") {
    const score = progress.s ?? progress.score ?? progress.highScore;
    return typeof score === "number" && Number.isFinite(score)
      ? Math.max(0, Math.floor(score))
      : 0;
  }

  const mode = mission.mode.trim();
  if (mode) {
    const key = normalizeProgressMode(mode) ?? mode;
    const modes = extractModeLevels(progress.st ?? null);
    const level = modes?.[key];
    return typeof level === "number" && Number.isFinite(level)
      ? Math.max(0, Math.floor(level))
      : 0;
  }

  const level = progress.l;
  return typeof level === "number" && Number.isFinite(level)
    ? Math.max(0, Math.floor(level))
    : 0;
}

export function toMissionProgress(
  mission: Mission,
  progress: StoredGameProgress | null | undefined,
  claimed: boolean
): MissionProgressView {
  const current = missionCurrentValue(mission, progress);
  return {
    ...mission,
    current,
    claimed,
    claimable: !claimed && current >= mission.threshold,
  };
}
