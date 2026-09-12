"use client";

import { useEffect, useState } from "react";
import {
  clearAdminSession,
  createAdminGame,
  deleteAdminGame,
  fetchAdminGames,
  hasAdminSession,
  loginAdmin,
  logoutAdmin,
  reorderAdminGames,
  saveAdminSession,
  updateAdminGame,
} from "@/lib/admin-api";
import { sortGames } from "@/lib/game-sort";
import { normalizeImageAssetUrl } from "@/lib/game-assets";
import { getContestStatus } from "@/lib/contest";
import {
  Game,
  gameHasLeaderboard,
  gameHasContestLive,
  gameIsLive,
} from "@/types";
import AdminContestModal from "@/components/AdminContestModal";
import Logo from "@/components/Logo";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "/";

export default function AdminPortal() {
  const [authed, setAuthed] = useState(() => hasAdminSession());
  const [pwInput, setPwInput] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwLoading, setPwLoading] = useState(false);
  const [showPw, setShowPw] = useState(false);

  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState("");

  const [name, setName] = useState("");
  const [thumbnail, setThumbnail] = useState("");
  const [url, setUrl] = useState("");
  const [plays, setPlays] = useState("");
  const [fallbackImage, setFallbackImage] = useState("");
  const [hasLeaderboard, setHasLeaderboard] = useState(true);
  const [live, setLive] = useState(true);

  const [contestModalGame, setContestModalGame] = useState<Game | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editThumbnail, setEditThumbnail] = useState("");
  const [editUrl, setEditUrl] = useState("");
  const [editPlays, setEditPlays] = useState("");
  const [editFallbackImage, setEditFallbackImage] = useState("");
  const [editHasLeaderboard, setEditHasLeaderboard] = useState(true);
  const [editLive, setEditLive] = useState(true);
  const [editSaving, setEditSaving] = useState(false);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  async function handleLogin() {
    setPwLoading(true);
    setPwError("");
    try {
      await loginAdmin(pwInput.trim());
      saveAdminSession();
      setAuthed(true);
    } catch (err) {
      setPwError(
        err instanceof Error ? err.message : "Wrong password. Try again."
      );
      setPwInput("");
    } finally {
      setPwLoading(false);
    }
  }

  function handleLogout() {
    logoutAdmin().finally(() => {
      clearAdminSession();
      setAuthed(false);
      setPwInput("");
    });
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  }

  async function refresh() {
    setLoading(true);
    try {
      const g = await fetchAdminGames();
      setGames(sortGames(g));
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Could not load games."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (authed) refresh();
  }, [authed]);

  async function handleAdd() {
    if (!name.trim() || !url.trim()) {
      showToast("Name and URL are required.");
      return;
    }
    setSaving(true);
    try {
      await createAdminGame({
        name: name.trim(),
        thumbnail: thumbnail.trim(),
        url: url.trim(),
        plays: plays.trim() || "0",
        fallbackImage: normalizeImageAssetUrl(fallbackImage),
        active: true,
        live,
        hasLeaderboard,
      });
      setName("");
      setThumbnail("");
      setUrl("");
      setPlays("");
      setFallbackImage("");
      setHasLeaderboard(true);
      setLive(true);
      await refresh();
      showToast("Game added! 🎮");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to add game. Try again."
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this game?")) return;
    try {
      await deleteAdminGame(id);
      await refresh();
      showToast("Game removed.");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to remove game."
      );
    }
  }

  async function handleToggle(game: Game) {
    const nextActive = !game.active;
    try {
      await updateAdminGame(game.id, { active: nextActive });
      await refresh();
      showToast(nextActive ? "Game is visible on the arcade." : "Game hidden from the arcade.");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update game."
      );
    }
  }

  async function handleToggleLive(game: Game) {
    const nextLive = !gameIsLive(game);
    try {
      await updateAdminGame(game.id, { live: nextLive });
      await refresh();
      showToast(nextLive ? "Game is live." : "Coming Soon overlay is on.");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to update game."
      );
    }
  }

  function openContestPanel(game: Game) {
    if (!gameHasLeaderboard(game)) {
      showToast("Enable Leaderboard for this game first.");
      return;
    }
    setContestModalGame(game);
  }

  function closeContestPanel() {
    setContestModalGame(null);
  }

  function startEdit(game: Game) {
    setEditingId(game.id);
    setEditName(game.name);
    setEditThumbnail(game.thumbnail);
    setEditUrl(game.url);
    setEditPlays(game.plays);
    setEditFallbackImage(normalizeImageAssetUrl(game.fallbackImage));
    setEditHasLeaderboard(gameHasLeaderboard(game));
    setEditLive(gameIsLive(game));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditSaving(false);
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    if (!editName.trim() || !editUrl.trim()) {
      showToast("Name and URL are required.");
      return;
    }

    setEditSaving(true);
    try {
      await updateAdminGame(editingId, {
        name: editName.trim(),
        thumbnail: editThumbnail.trim(),
        url: editUrl.trim(),
        plays: editPlays.trim() || "0",
        fallbackImage: normalizeImageAssetUrl(editFallbackImage),
        hasLeaderboard: editHasLeaderboard,
        live: editLive,
      });
      cancelEdit();
      await refresh();
      showToast("Game updated!");
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : "Failed to save changes."
      );
    } finally {
      setEditSaving(false);
    }
  }

  function reorderLocalGames(fromId: string, toId: string) {
    if (fromId === toId) return games;

    const fromIndex = games.findIndex((g) => g.id === fromId);
    const toIndex = games.findIndex((g) => g.id === toId);
    if (fromIndex < 0 || toIndex < 0) return games;

    const next = [...games];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    return next;
  }

  async function persistGameOrder(orderedGames: Game[]) {
    setReordering(true);
    try {
      await reorderAdminGames(orderedGames.map((g) => g.id));
      setGames(orderedGames);
      showToast("Game order saved!");
    } catch (err) {
      await refresh();
      showToast(
        err instanceof Error ? err.message : "Failed to save game order."
      );
    } finally {
      setReordering(false);
    }
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    if (editingId || reordering) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
    setDragId(id);
  }

  function handleDragOver(e: React.DragEvent, id: string) {
    if (!dragId || dragId === id || editingId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetId(id);
  }

  function handleDragLeave(id: string) {
    setDropTargetId((current) => (current === id ? null : current));
  }

  async function handleDrop(e: React.DragEvent, toId: string) {
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain") || dragId;
    setDropTargetId(null);
    setDragId(null);

    if (!fromId || fromId === toId || editingId || reordering) return;

    const next = reorderLocalGames(fromId, toId);
    if (next === games) return;

    setGames(next);
    await persistGameOrder(next);
  }

  function handleDragEnd() {
    setDragId(null);
    setDropTargetId(null);
  }

  if (!authed) {
    return (
      <div className="login-screen">
        {toast && <div className="toast show">{toast}</div>}
        <div className="login-card">
          <Logo variant="login" />
          <p className="login-subtitle">Admin Portal</p>

          <div className="form-group" style={{ marginTop: 24 }}>
            <label className="form-label">Password</label>
            <div className="pw-wrap">
              <input
                className={`form-input ${pwError ? "input-error" : ""}`}
                type={showPw ? "text" : "password"}
                placeholder="Enter admin password"
                value={pwInput}
                onChange={(e) => {
                  setPwInput(e.target.value);
                  setPwError("");
                }}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
              />
              <button
                className="pw-toggle"
                onClick={() => setShowPw((v) => !v)}
                type="button"
                tabIndex={-1}
              >
                {showPw ? "🙈" : "👁"}
              </button>
            </div>
            {pwError && <p className="error-msg">{pwError}</p>}
          </div>

          <button
            className="add-submit-btn"
            onClick={handleLogin}
            disabled={pwLoading}
          >
            {pwLoading ? "Checking..." : "Unlock Portal →"}
          </button>

          <a className="login-back" href={APP_URL}>
            ← Back to arcade
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      {toast && <div className="toast show">{toast}</div>}

      <header className="admin-topbar">
        <a className="admin-back" href={APP_URL}>
          ← Back
        </a>
        <h1 className="admin-heading">Admin Portal</h1>
        <button className="logout-btn" onClick={handleLogout}>
          Lock 🔒
        </button>
      </header>

      <div className="admin-content">
        <h2 className="admin-section-title">Add New Game</h2>
        <div className="add-game-card">
          <div className="form-group">
            <label className="form-label">Game Name</label>
            <input
              className="form-input"
              placeholder="e.g. Arrow Out"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Thumbnail URL</label>
            <input
              className="form-input"
              placeholder="/thumbnails/my-game.webp"
              value={thumbnail}
              onChange={(e) => setThumbnail(e.target.value)}
            />
            {thumbnail && (
              <div className="thumb-preview-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbnail} alt="preview" />
              </div>
            )}
          </div>
          <div className="form-group">
            <label className="form-label">Unity WebGL URL</label>
            <input
              className="form-input"
              placeholder="https://yourgame.com/index.html"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Plays (display label)</label>
            <input
              className="form-input"
              placeholder="e.g. 1.2m"
              value={plays}
              onChange={(e) => setPlays(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label">Fallback Image</label>
            <input
              className="form-input"
              placeholder="/games/my-game/fallback.png"
              value={fallbackImage}
              onChange={(e) => setFallbackImage(e.target.value)}
            />
            {normalizeImageAssetUrl(fallbackImage) ? (
              <div className="thumb-preview-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={normalizeImageAssetUrl(fallbackImage)}
                  alt="fallback preview"
                />
              </div>
            ) : null}
          </div>
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={live}
              onChange={(e) => setLive(e.target.checked)}
            />
            <span>App is live</span>
            <span className="form-checkbox-hint">
              Unchecked: the game appears on the home page with a &quot;Coming Soon&quot;
              overlay and cannot be opened.
            </span>
          </label>
          <label className="form-checkbox">
            <input
              type="checkbox"
              checked={hasLeaderboard}
              onChange={(e) => setHasLeaderboard(e.target.checked)}
            />
            <span>Leaderboard</span>
            <span className="form-checkbox-hint">
              Checked: score game — stores high score (s) and enables leaderboard.
              Unchecked: level-based — stores current level (l) only, no leaderboard.
            </span>
          </label>
          <button
            className="add-submit-btn"
            onClick={handleAdd}
            disabled={saving}
          >
            {saving ? "Adding..." : "+ Add Game"}
          </button>
        </div>

        <h2 className="admin-section-title">Manage Games ({games.length})</h2>
        {!loading && games.length > 1 && (
          <p className="admin-reorder-hint">
            Drag the handle on each row to change the order shown on the home page.
            {reordering ? " Saving…" : ""}
          </p>
        )}
        {loading ? (
          <p className="admin-loading">Loading...</p>
        ) : (
          <div className="admin-game-list">
            {games.map((g) =>
              editingId === g.id ? (
                <div key={g.id} className="edit-game-card">
                  <div className="edit-game-header">
                    <h3 className="edit-game-title">Edit Game</h3>
                    <button
                      className="edit-cancel-link"
                      type="button"
                      onClick={cancelEdit}
                      disabled={editSaving}
                    >
                      Cancel
                    </button>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Game Name</label>
                    <input
                      className="form-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Thumbnail URL</label>
                    <input
                      className="form-input"
                      placeholder="/thumbnails/my-game.webp"
                      value={editThumbnail}
                      onChange={(e) => setEditThumbnail(e.target.value)}
                    />
                    {editThumbnail && (
                      <div className="thumb-preview-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={editThumbnail} alt="preview" />
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Unity WebGL URL</label>
                    <input
                      className="form-input"
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Plays (display label)</label>
                    <input
                      className="form-input"
                      value={editPlays}
                      onChange={(e) => setEditPlays(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Fallback Image</label>
                    <input
                      className="form-input"
                      placeholder="/games/my-game/fallback.png"
                      value={editFallbackImage}
                      onChange={(e) => setEditFallbackImage(e.target.value)}
                    />
                    {normalizeImageAssetUrl(editFallbackImage) ? (
                      <div className="thumb-preview-wrap">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={normalizeImageAssetUrl(editFallbackImage)}
                          alt="fallback preview"
                        />
                      </div>
                    ) : null}
                  </div>
                  <label className="form-checkbox">
                    <input
                      type="checkbox"
                      checked={editLive}
                      onChange={(e) => setEditLive(e.target.checked)}
                    />
                    <span>App is live</span>
                    <span className="form-checkbox-hint">
                      Unchecked: the game appears on the home page with a &quot;Coming Soon&quot;
                      overlay and cannot be opened.
                    </span>
                  </label>
                  <label className="form-checkbox">
                    <input
                      type="checkbox"
                      checked={editHasLeaderboard}
                      onChange={(e) => setEditHasLeaderboard(e.target.checked)}
                    />
                    <span>Leaderboard</span>
                    <span className="form-checkbox-hint">
                      Checked: score game — stores high score (s) and enables leaderboard.
                      Unchecked: level-based — stores current level (l) only, no leaderboard.
                    </span>
                  </label>
                  <button
                    className="add-submit-btn edit-save-btn"
                    type="button"
                    onClick={handleSaveEdit}
                    disabled={editSaving}
                  >
                    {editSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              ) : (
                <div
                  key={g.id}
                  className={`admin-game-row ${!g.active ? "inactive" : ""} ${
                    dragId === g.id ? "dragging" : ""
                  } ${dropTargetId === g.id ? "drop-target" : ""}`}
                  onDragOver={(e) => handleDragOver(e, g.id)}
                  onDragLeave={() => handleDragLeave(g.id)}
                  onDrop={(e) => handleDrop(e, g.id)}
                >
                  <button
                    type="button"
                    className="drag-handle"
                    aria-label={`Drag to reorder ${g.name}`}
                    draggable={!editingId && !reordering}
                    disabled={!!editingId || reordering}
                    onDragStart={(e) => handleDragStart(e, g.id)}
                    onDragEnd={handleDragEnd}
                  >
                    ⠿
                  </button>
                  <div className="admin-thumb">
                    {normalizeImageAssetUrl(g.thumbnail) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={normalizeImageAssetUrl(g.thumbnail)} alt={g.name} />
                    ) : normalizeImageAssetUrl(g.fallbackImage) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={normalizeImageAssetUrl(g.fallbackImage)}
                        alt={g.name}
                      />
                    ) : null}
                  </div>
                  <div className="admin-game-info">
                    <p className="admin-game-name">{g.name}</p>
                    <p className="admin-game-url">{g.url}</p>
                    <p className="admin-game-plays">
                      {g.plays} plays · {g.active ? "🟢 Visible" : "⚫ Hidden"} ·{" "}
                      {gameIsLive(g) ? "✅ Live" : "🔜 Coming Soon"} ·{" "}
                      {gameHasLeaderboard(g) ? "🏆 Leaderboard" : "📊 Level-based"} ·{" "}
                      {gameHasContestLive(g)
                        ? "🔥 Contest Live"
                        : getContestStatus(g) === "ended"
                          ? "🏁 Contest Ended"
                          : "No contest"}
                    </p>
                  </div>
                  <div className="admin-actions">
                    <button
                      className="edit-btn"
                      type="button"
                      onClick={() => startEdit(g)}
                    >
                      Edit
                    </button>
                    {gameHasLeaderboard(g) && (
                      <button
                        className="toggle-btn"
                        type="button"
                        onClick={() => openContestPanel(g)}
                      >
                        {gameHasContestLive(g)
                          ? "Edit Contest"
                          : getContestStatus(g) === "ended"
                            ? "Contest Results"
                            : "Start Contest"}
                      </button>
                    )}
                    <button
                      className="toggle-btn"
                      type="button"
                      onClick={() => handleToggleLive(g)}
                    >
                      {gameIsLive(g) ? "Coming Soon" : "Go Live"}
                    </button>
                    <button
                      className="toggle-btn"
                      type="button"
                      onClick={() => handleToggle(g)}
                    >
                      {g.active ? "Hide" : "Show"}
                    </button>
                    <button
                      className="delete-btn"
                      type="button"
                      onClick={() => handleDelete(g.id)}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>

      <AdminContestModal
        game={contestModalGame}
        open={!!contestModalGame}
        onClose={closeContestPanel}
        onSaved={refresh}
        showToast={showToast}
      />
    </div>
  );
}
