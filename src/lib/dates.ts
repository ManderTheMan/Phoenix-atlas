export const DAY = 86_400_000;

export function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Local calendar date key YYYY-MM-DD. */
export function dayKey(t: number | Date): string {
  const d = typeof t === 'number' ? new Date(t) : t;
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${d.getFullYear()}-${m < 10 ? '0' : ''}${m}-${day < 10 ? '0' : ''}${day}`;
}

export function parseDayKey(k: string): number {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function addDays(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function formatDate(t: number, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }): string {
  return new Date(t).toLocaleDateString(undefined, opts);
}

export function formatDateTime(t: number): string {
  return new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatShort(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function relativeDay(t: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  return formatDate(t);
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(s: string): number {
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

export function eachDay(from: number, to: number): string[] {
  const out: string[] = [];
  for (let t = startOfDay(from); t <= to; t = addDays(t, 1)) out.push(dayKey(t));
  return out;
}
