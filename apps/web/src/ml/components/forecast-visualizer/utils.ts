export function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    const mo = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const day = d.getUTCDate().toString().padStart(2, "0");
    const hr = d.getUTCHours().toString().padStart(2, "0");
    const mn = d.getUTCMinutes().toString().padStart(2, "0");
    return `${mo}/${day} ${hr}:${mn}`;
  } catch {
    return ts.slice(0, 16);
  }
}
