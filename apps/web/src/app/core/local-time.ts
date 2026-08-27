export function formatLocalTime(value: string | number | null | undefined, withDate = false): string {
  if (value == null || value === '') {
    return '—';
  }
  const raw = String(value);
  const numeric = Number(value);
  const date =
    Number.isFinite(numeric) && /^\d{12,}$/.test(raw) ? new Date(numeric) : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  return withDate
    ? date.toLocaleString(undefined, { hour12: false })
    : date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });
}
