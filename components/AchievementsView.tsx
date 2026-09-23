"use client";

import { useCallback, useEffect, useState } from "react";
import { usePlayerProfile } from "@/components/PlayerProfileProvider";
import {
  claimAchievement,
  fetchAchievements,
} from "@/lib/achievements-client";
import { MissionProgressView } from "@/lib/achievements";

export default function AchievementsView() {
  const { walletAddress, isGuest } = usePlayerProfile();
  const [xp, setXp] = useState(0);
  const [missions, setMissions] = useState<MissionProgressView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [claimingId, setClaimingId] = useState("");

  const load = useCallback(async () => {
    if (!walletAddress || isGuest) {
      setLoading(false);
      setMissions([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await fetchAchievements();
      setXp(data.xp);
      setMissions(data.missions);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load achievements.");
    } finally {
      setLoading(false);
    }
  }, [walletAddress, isGuest]);

  useEffect(() => {
    void load();
  }, [load]);

  async function claim(mission: MissionProgressView) {
    setClaimingId(mission.id);
    setError("");
    try {
      const result = await claimAchievement(mission.id);
      setXp(result.xp);
      setMissions((prev) =>
        prev.map((item) => (item.id === mission.id ? result.mission : item))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not claim XP.");
    } finally {
      setClaimingId("");
    }
  }

  return (
    <section className="achievements">
      <header className="achievements__head">
        <h2 className="home-section__title">Achievements</h2>
        <p className="achievements__xp">{xp.toLocaleString()} XP</p>
      </header>

      {(!walletAddress || isGuest) && (
        <p className="no-games">Sign in with your wallet to track missions and claim XP.</p>
      )}

      {error && <p className="achievements__error">{error}</p>}
      {loading && walletAddress && !isGuest && (
        <p className="no-games">Loading missions…</p>
      )}

      {!loading && walletAddress && !isGuest && missions.length === 0 && !error && (
        <p className="no-games">No missions yet.</p>
      )}

      <ul className="achievements__list">
        {missions.map((mission) => {
          const pct = Math.min(100, Math.round((mission.current / mission.threshold) * 100));
          return (
            <li key={mission.id} className="achievement-card">
              <div className="achievement-card__top">
                <p className="achievement-card__title">{mission.title}</p>
                <p className="achievement-card__reward">+{mission.xpReward} XP</p>
              </div>
              {mission.description && (
                <p className="achievement-card__desc">{mission.description}</p>
              )}
              <p className="achievement-card__progress">
                {Math.min(mission.current, mission.threshold).toLocaleString()} /{" "}
                {mission.threshold.toLocaleString()}
                {mission.mode ? ` · ${mission.mode}` : ""}
              </p>
              <div className="achievement-card__bar" aria-hidden>
                <span style={{ width: `${pct}%` }} />
              </div>
              {mission.claimed ? (
                <p className="achievement-card__claimed">Claimed</p>
              ) : (
                <button
                  type="button"
                  className="achievement-card__claim"
                  disabled={!mission.claimable || claimingId === mission.id}
                  onClick={() => void claim(mission)}
                >
                  {claimingId === mission.id ? "Claiming…" : "Claim XP"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
