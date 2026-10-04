"use client";

/**
 * Host route for the native-shell daily play overlay (Daily Streak).
 * PlayerProfileProvider shows the streak modal here; game routes never do.
 * Path kept as /daily-shuffle for APK compatibility.
 */
export default function DailyShufflePage() {
  return (
    <main
      className="daily-shuffle-host"
      aria-label="Daily Streak"
      style={{
        minHeight: "100dvh",
        background: "#070a20",
      }}
    />
  );
}
