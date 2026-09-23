"use client";

import { FormEvent, useEffect, useState } from "react";
import { Mission, MissionType } from "@/lib/achievements";
import {
  createAdminMission,
  deleteAdminMission,
  fetchAdminMissions,
  MissionDraft,
  updateAdminMission,
} from "@/lib/achievements-client";
import { Game } from "@/types";

const EMPTY: MissionDraft = {
  gameId: "",
  title: "",
  description: "",
  type: "score",
  threshold: 1,
  mode: "",
  xpReward: 10,
  active: true,
  sortOrder: 0,
};

export default function AdminMissionsPanel({ games }: { games: Game[] }) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [draft, setDraft] = useState<MissionDraft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setMissions(await fetchAdminMissions());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load missions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function startEdit(mission: Mission) {
    setEditingId(mission.id);
    setDraft({
      gameId: mission.gameId,
      title: mission.title,
      description: mission.description,
      type: mission.type,
      threshold: mission.threshold,
      mode: mission.mode,
      xpReward: mission.xpReward,
      active: mission.active,
      sortOrder: mission.sortOrder,
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editingId) {
        await updateAdminMission(editingId, draft);
      } else {
        await createAdminMission(draft);
      }
      setDraft(EMPTY);
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save mission.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this mission?")) return;
    setError("");
    try {
      await deleteAdminMission(id);
      if (editingId === id) {
        setEditingId(null);
        setDraft(EMPTY);
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete mission.");
    }
  }

  return (
    <div className="admin-missions">
      <h2 className="admin-section-title">
        {editingId ? "Edit mission" : "Add mission"}
      </h2>
      <form className="add-game-card" onSubmit={(event) => void handleSubmit(event)}>
        <div className="form-group">
          <label className="form-label">Game</label>
          <select
            className="form-input"
            value={draft.gameId}
            onChange={(event) => setDraft({ ...draft, gameId: event.target.value })}
            required
          >
            <option value="">Select a game</option>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Title</label>
          <input
            className="form-input"
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            maxLength={80}
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">Description</label>
          <input
            className="form-input"
            value={draft.description ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, description: event.target.value })
            }
            maxLength={240}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Type</label>
          <select
            className="form-input"
            value={draft.type}
            onChange={(event) =>
              setDraft({ ...draft, type: event.target.value as MissionType })
            }
          >
            <option value="score">Score</option>
            <option value="level">Level</option>
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Mode (optional, for level games)</label>
          <input
            className="form-input"
            placeholder="easy, medium, hard"
            value={draft.mode ?? ""}
            onChange={(event) => setDraft({ ...draft, mode: event.target.value })}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Threshold</label>
          <input
            className="form-input"
            type="number"
            min={1}
            value={draft.threshold}
            onChange={(event) =>
              setDraft({ ...draft, threshold: Number(event.target.value) })
            }
            required
          />
        </div>
        <div className="form-group">
          <label className="form-label">XP reward</label>
          <input
            className="form-input"
            type="number"
            min={1}
            value={draft.xpReward}
            onChange={(event) =>
              setDraft({ ...draft, xpReward: Number(event.target.value) })
            }
            required
          />
        </div>
        <label className="form-checkbox">
          <input
            type="checkbox"
            checked={draft.active !== false}
            onChange={(event) => setDraft({ ...draft, active: event.target.checked })}
          />
          Active
        </label>
        {error && <p className="error-msg">{error}</p>}
        <button className="add-submit-btn" type="submit" disabled={saving}>
          {saving ? "Saving..." : editingId ? "Save mission" : "Add mission"}
        </button>
        {editingId && (
          <button
            type="button"
            className="admin-back"
            onClick={() => {
              setEditingId(null);
              setDraft(EMPTY);
            }}
          >
            Cancel edit
          </button>
        )}
      </form>

      <h2 className="admin-section-title">Missions ({missions.length})</h2>
      {loading ? (
        <p className="admin-loading">Loading...</p>
      ) : (
        <div className="admin-game-list">
          {missions.map((mission) => (
            <div key={mission.id} className="admin-game-row">
              <div className="admin-game-info">
                <p className="admin-game-name">
                  {mission.title}
                  {!mission.active ? " · inactive" : ""}
                </p>
                <p className="admin-game-url">
                  {mission.gameId} · {mission.type}
                  {mission.mode ? `/${mission.mode}` : ""} ≥ {mission.threshold} ·{" "}
                  {mission.xpReward} XP
                </p>
              </div>
              <div className="admin-actions">
                <button type="button" className="admin-back" onClick={() => startEdit(mission)}>
                  Edit
                </button>
                <button type="button" className="admin-back" onClick={() => void handleDelete(mission.id)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
