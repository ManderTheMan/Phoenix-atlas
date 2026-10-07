// Live sync with the Google Health API (v4) — Google's replacement for the
// Google Fit and Fitbit Web APIs. Runs entirely in the browser: you create an
// OAuth client ID in your own Google Cloud project, sign in with Google, and
// Phoenix Atlas reads your daily data directly. The access token is kept in
// memory/session only.
import type { Activity, MetricPoint } from '../db/db';
import { addDays, dayKey, parseDayKey } from '../lib/dates';
import { DailyAccumulator, type ImportResult } from './metrics';

export const HEALTH_API = 'https://health.googleapis.com/v4/users/me/dataTypes';

export const HEALTH_SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
];

// ------------------------------------------------------------------ OAuth (Google Identity Services)

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (o?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (r: TokenResponse) => void;
            error_callback?: (e: { type: string; message?: string }) => void;
          }) => GisTokenClient;
          revoke: (token: string, cb?: () => void) => void;
        };
      };
    };
  }
}

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google sign-in. Check your connection.'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

export interface HealthToken {
  token: string;
  expiresAt: number;
}

const TOKEN_KEY = 'phoenix-atlas-google-token';

export function storedToken(): HealthToken | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) ?? 'null') as HealthToken | null;
    return t && t.expiresAt > Date.now() + 60_000 ? t : null;
  } catch {
    return null;
  }
}

export function forgetToken(): void {
  const t = storedToken();
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
  if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t.token);
}

export async function signIn(clientId: string): Promise<HealthToken> {
  await loadGis();
  return new Promise<HealthToken>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: HEALTH_SCOPES.join(' '),
      callback: (r) => {
        if (r.error || !r.access_token) return reject(new Error(r.error_description || r.error || 'Sign-in was cancelled'));
        const t = { token: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 };
        try {
          sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
        } catch {
          /* storage unavailable: keep token in memory only */
        }
        resolve(t);
      },
      error_callback: (e) => reject(new Error(e.message || `Sign-in failed (${e.type})`)),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// ------------------------------------------------------------------ API calls

export class HealthApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

async function call<T>(f: Fetch, token: string, url: string, init?: RequestInit): Promise<T> {
  const res = await f(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      msg = j?.error?.message ?? msg;
    } catch {
      /* not JSON */
    }
    throw new HealthApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

interface GDate {
  year: number;
  month: number;
  day: number;
}

const toGDate = (k: string): GDate => {
  const [year, month, day] = k.split('-').map(Number);
  return { year, month, day };
};
const fromGDate = (d?: GDate): string | null =>
  d && d.year ? `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` : null;

const n = (v: unknown) => (typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN);

/** Split [from, to) into chunks of at most `maxDays` days. */
export function chunks(from: string, to: string, maxDays: number): [string, string][] {
  const out: [string, string][] = [];
  let s = parseDayKey(from);
  const end = parseDayKey(to);
  while (s < end) {
    const e = Math.min(addDays(s, maxDays), end);
    out.push([dayKey(s), dayKey(e)]);
    s = e;
  }
  return out;
}

interface RollupSpec {
  type: string;
  maxDays: number;
  extract: (p: Record<string, unknown>) => [string, number][];
}

const ROLLUPS: RollupSpec[] = [
  { type: 'steps', maxDays: 90, extract: (p) => [['steps', n((p.steps as { countSum?: string })?.countSum)]] },
  { type: 'distance', maxDays: 90, extract: (p) => [['distance_km', n((p.distance as { millimetersSum?: string })?.millimetersSum) / 1e6]] },
  { type: 'total-calories', maxDays: 14, extract: (p) => [['calories_kcal', n((p.totalCalories as { kcalSum?: number })?.kcalSum)]] },
  { type: 'heart-rate', maxDays: 14, extract: (p) => [['heart_rate_avg', n((p.heartRate as { beatsPerMinuteAvg?: number })?.beatsPerMinuteAvg)]] },
  {
    type: 'active-zone-minutes',
    maxDays: 90,
    extract: (p) => {
      const a = p.activeZoneMinutes as Record<string, string> | undefined;
      if (!a) return [];
      return [['active_zone_minutes', n(a.sumInFatBurnHeartZone ?? 0) + n(a.sumInCardioHeartZone ?? 0) + n(a.sumInPeakHeartZone ?? 0)]];
    },
  },
  {
    type: 'active-minutes',
    maxDays: 14,
    extract: (p) => {
      const a = (p.activeMinutes as { activeMinutesRollupByActivityLevel?: { activeMinutesSum?: string; activityLevel?: string }[] })?.activeMinutesRollupByActivityLevel;
      if (!a) return [];
      return [['active_minutes', a.filter((x) => x.activityLevel !== 'LIGHT').reduce((s, x) => s + n(x.activeMinutesSum ?? 0), 0)]];
    },
  },
  { type: 'weight', maxDays: 90, extract: (p) => [['weight_kg', n((p.weight as { weightGramsAvg?: number })?.weightGramsAvg) / 1000]] },
];

async function dailyRollUp(f: Fetch, token: string, spec: RollupSpec, from: string, to: string, acc: DailyAccumulator): Promise<number> {
  let count = 0;
  for (const [s, e] of chunks(from, to, spec.maxDays)) {
    let pageToken: string | undefined;
    do {
      const body: Record<string, unknown> = { range: { start: { date: toGDate(s) }, end: { date: toGDate(e) } }, windowSizeDays: 1, pageSize: 1000 };
      if (pageToken) body.pageToken = pageToken;
      const r = await call<{ rollupDataPoints?: Record<string, unknown>[]; nextPageToken?: string }>(
        f,
        token,
        `${HEALTH_API}/${spec.type}/dataPoints:dailyRollUp`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      for (const p of r.rollupDataPoints ?? []) {
        const day = fromGDate((p.civilStartTime as { date?: GDate })?.date);
        if (!day) continue;
        for (const [metric, v] of spec.extract(p)) {
          if (Number.isFinite(v) && (v > 0 || metric === 'steps')) {
            acc.set(metric, day, v);
            count++;
          }
        }
      }
      pageToken = r.nextPageToken || undefined;
    } while (pageToken);
  }
  return count;
}

async function listAll(f: Fetch, token: string, type: string, filter: string, pageSize: number): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  let guard = 0;
  do {
    // encodeURIComponent (not URLSearchParams) so spaces become %20 rather than '+'
    let q = `filter=${encodeURIComponent(filter)}&pageSize=${pageSize}`;
    if (pageToken) q += `&pageToken=${encodeURIComponent(pageToken)}`;
    const r = await call<{ dataPoints?: Record<string, unknown>[]; nextPageToken?: string }>(f, token, `${HEALTH_API}/${type}/dataPoints?${q}`);
    out.push(...(r.dataPoints ?? []));
    pageToken = r.nextPageToken || undefined;
  } while (pageToken && ++guard < 400);
  return out;
}

const durationMin = (d: unknown) => {
  const m = String(d ?? '').match(/^([\d.]+)s$/);
  return m ? Math.round(Number(m[1]) / 60) : undefined;
};

export function exerciseToActivity(p: Record<string, unknown>): Activity | null {
  const ex = p.exercise as Record<string, unknown> | undefined;
  if (!ex) return null;
  const iv = ex.interval as { startTime?: string; endTime?: string } | undefined;
  const start = Date.parse(iv?.startTime ?? '');
  const end = Date.parse(iv?.endTime ?? '');
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const ms = (ex.metricsSummary ?? {}) as Record<string, unknown>;
  const type = String(ex.exerciseType ?? 'WORKOUT');
  const id = typeof p.name === 'string' && p.name ? p.name.split('/').pop()! : `${start}`;
  return {
    id: `ghealth-${id}`,
    start,
    end,
    type,
    name: String(ex.displayName ?? type.replace(/_/g, ' ').toLowerCase()),
    durationMin: durationMin(ex.activeDuration) ?? Math.round((end - start) / 60000),
    calories: Number.isFinite(n(ms.caloriesKcal)) ? Math.round(n(ms.caloriesKcal)) : undefined,
    distanceKm: Number.isFinite(n(ms.distanceMillimeters)) ? Math.round(n(ms.distanceMillimeters) / 1e4) / 100 : undefined,
    avgHr: Number.isFinite(n(ms.averageHeartRateBeatsPerMinute)) ? Math.round(n(ms.averageHeartRateBeatsPerMinute)) : undefined,
    steps: Number.isFinite(n(ms.steps)) ? Math.round(n(ms.steps)) : undefined,
    source: 'Google Health',
  };
}

/**
 * Pull daily data for [from, to) (YYYY-MM-DD). Individual data types that fail
 * (not available for the account, missing scope…) are reported as warnings so
 * one missing type doesn't block the rest.
 */
export async function syncGoogleHealth(
  token: string,
  from: string,
  to: string,
  onStep?: (msg: string) => void,
  f: Fetch = fetch.bind(globalThis),
): Promise<ImportResult> {
  const acc = new DailyAccumulator();
  const log: string[] = [];
  const warnings: string[] = [];
  const activities: Activity[] = [];
  const guard = async (label: string, fn: () => Promise<number>) => {
    onStep?.(`Fetching ${label}…`);
    try {
      const c = await fn();
      log.push(`${label}: ${c}`);
    } catch (e) {
      const err = e as HealthApiError;
      if (err.status === 401) throw new HealthApiError('Your Google sign-in expired — connect again.', 401);
      warnings.push(`${label}: ${err.message}`);
    }
  };

  for (const spec of ROLLUPS) await guard(spec.type, () => dailyRollUp(f, token, spec, from, to, acc));

  await guard('daily-resting-heart-rate', async () => {
    const pts = await listAll(f, token, 'daily-resting-heart-rate', `daily_resting_heart_rate.date >= "${from}" AND daily_resting_heart_rate.date < "${to}"`, 1000);
    for (const p of pts) {
      const d = p.dailyRestingHeartRate as { date?: GDate; beatsPerMinute?: string } | undefined;
      const day = fromGDate(d?.date);
      if (day) acc.set('resting_hr', day, n(d?.beatsPerMinute));
    }
    return pts.length;
  });

  await guard('daily-heart-rate-variability', async () => {
    const pts = await listAll(f, token, 'daily-heart-rate-variability', `daily_heart_rate_variability.date >= "${from}" AND daily_heart_rate_variability.date < "${to}"`, 1000);
    for (const p of pts) {
      const d = p.dailyHeartRateVariability as { date?: GDate; averageHeartRateVariabilityMilliseconds?: number } | undefined;
      const day = fromGDate(d?.date);
      if (day) acc.set('hrv_ms', day, n(d?.averageHeartRateVariabilityMilliseconds));
    }
    return pts.length;
  });

  await guard('sleep', async () => {
    const fromTs = new Date(parseDayKey(from)).toISOString();
    const toTs = new Date(parseDayKey(to)).toISOString();
    const pts = await listAll(f, token, 'sleep', `sleep.interval.end_time >= "${fromTs}" AND sleep.interval.end_time < "${toTs}"`, 25);
    for (const p of pts) {
      const s = p.sleep as { summary?: { minutesAsleep?: string }; interval?: { civilEndTime?: { date?: GDate }; endTime?: string } } | undefined;
      const day = fromGDate(s?.interval?.civilEndTime?.date) ?? (s?.interval?.endTime ? dayKey(Date.parse(s.interval.endTime)) : null);
      const mins = n(s?.summary?.minutesAsleep);
      if (day && mins > 0) acc.add('sleep_hours', day, mins / 60, 'sum');
    }
    return pts.length;
  });

  await guard('exercise', async () => {
    const pts = await listAll(f, token, 'exercise', `exercise.interval.civil_start_time >= "${from}" AND exercise.interval.civil_start_time < "${to}"`, 25);
    for (const p of pts) {
      const a = exerciseToActivity(p);
      if (a) activities.push(a);
    }
    return pts.length;
  });

  const metrics: MetricPoint[] = acc.points('Google Health');
  return { source: 'Google Health', metrics, activities, log, warnings };
}
