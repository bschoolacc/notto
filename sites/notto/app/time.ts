export function formatTime(totalSeconds: number) {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return (hours ? `${String(hours).padStart(2, "0")}:` : "") + `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function rangeLabel(start: number, end: number) {
  return `${formatTime(start)}–${formatTime(end)}`;
}
