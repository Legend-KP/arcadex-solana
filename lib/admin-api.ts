"use client";

import { Game } from "@/types";

const SESSION_KEY = "arcadex_admin_authed";
const LEGACY_SESSION_KEY = SESSION_KEY;
const LEGACY_PASSWORD_KEY = "arcadex_admin_password";

function migrateLegacySession(): void {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(SESSION_KEY) === "1") return;

  const legacyAuthed = sessionStorage.getItem(LEGACY_SESSION_KEY) === "1";
  const legacyPassword = sessionStorage.getItem(LEGACY_PASSWORD_KEY);
  if (!legacyAuthed || !legacyPassword) return;

  localStorage.setItem(SESSION_KEY, "1");
  sessionStorage.removeItem(LEGACY_SESSION_KEY);
  sessionStorage.removeItem(LEGACY_PASSWORD_KEY);
}

function adminHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
  };
}

const fetchOptions: RequestInit = {
  credentials: "include",
  cache: "no-store",
};

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text) {
    throw new Error(
      res.ok
        ? "Server returned an empty response."
        : `Request failed (${res.status}).`
    );
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.replace(/\s+/g, " ").slice(0, 80);
    throw new Error(
      res.ok
        ? "Server returned an invalid response."
        : `Request failed (${res.status}): ${preview}`
    );
  }
}

export function saveAdminSession() {
  localStorage.setItem(SESSION_KEY, "1");
  sessionStorage.removeItem(LEGACY_SESSION_KEY);
  sessionStorage.removeItem(LEGACY_PASSWORD_KEY);
  localStorage.removeItem(LEGACY_PASSWORD_KEY);
}

export function clearAdminSession() {
  localStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(LEGACY_SESSION_KEY);
  sessionStorage.removeItem(LEGACY_PASSWORD_KEY);
  localStorage.removeItem(LEGACY_PASSWORD_KEY);
}

export function hasAdminSession(): boolean {
  migrateLegacySession();
  return localStorage.getItem(SESSION_KEY) === "1";
}

export async function loginAdmin(password: string): Promise<void> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
    credentials: "include",
  });
  const data = await parseJson<{ ok?: boolean; error?: string }>(res);
  if (!res.ok) throw new Error(data.error ?? "Wrong password.");
}

export async function logoutAdmin(): Promise<void> {
  await fetch("/api/login", {
    method: "DELETE",
    credentials: "include",
  }).catch(() => {
    // Best-effort cookie clear
  });
  clearAdminSession();
}

export async function fetchAdminGames(): Promise<Game[]> {
  const res = await fetch("/api/games", {
    headers: adminHeaders(),
    ...fetchOptions,
  });
  const data = await parseJson<{ games?: Game[]; error?: string }>(res);
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "Session expired. Lock and sign in again." : (data.error ?? "Could not load games.")
    );
  }
  return data.games ?? [];
}

export async function createAdminGame(
  game: Omit<Game, "id" | "createdAt">
): Promise<string> {
  const res = await fetch("/api/games", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(game),
    credentials: "include",
  });
  const data = await parseJson<{ id?: string; error?: string }>(res);
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "Session expired. Lock and sign in again." : (data.error ?? "Failed to add game.")
    );
  }
  return data.id ?? "";
}

export async function updateAdminGame(
  id: string,
  patch: Partial<Omit<Game, "id">>
): Promise<void> {
  const res = await fetch(`/api/games/${id}`, {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify(patch),
    credentials: "include",
  });
  const data = await parseJson<{ error?: string }>(res);
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "Session expired. Lock and sign in again." : (data.error ?? "Failed to update game.")
    );
  }
}

export async function deleteAdminGame(id: string): Promise<void> {
  const res = await fetch(`/api/games/${id}`, {
    method: "DELETE",
    headers: adminHeaders(),
    credentials: "include",
  });
  const data = await parseJson<{ error?: string }>(res);
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "Session expired. Lock and sign in again." : (data.error ?? "Failed to delete game.")
    );
  }
}

export async function reorderAdminGames(orderedIds: string[]): Promise<void> {
  const res = await fetch("/api/games/reorder", {
    method: "PATCH",
    headers: adminHeaders(),
    body: JSON.stringify({ order: orderedIds }),
    credentials: "include",
  });
  const data = await parseJson<{ error?: string }>(res);
  if (!res.ok) {
    throw new Error(
      res.status === 401
        ? "Session expired. Lock and sign in again."
        : (data.error ?? "Failed to save game order.")
    );
  }
}
