/** Format play count: 0–999 as-is, then 1.2k, 7.7m, etc. */
export function formatPlayCount(count: number): string {
  const n = Math.max(0, Math.floor(count));
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}m`;
}
