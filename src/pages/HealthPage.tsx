import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import LineChart from '../components/charts/LineChart';
import { Check, ConfirmButton, Empty, Seg } from '../components/common';
import Icon from '../components/Icon';
import { getSetting, setSetting } from '../db/db';
import { syncGoogleHealth, signIn, storedToken, forgetToken, HealthApiError } from '../health/googleHealthApi';
import { importFiles } from '../health/importer';
import { METRICS, formatMetric, metricDef, summarize, type ImportResult } from '../health/metrics';
import { deleteSource, saveImport } from '../health/save';
import { useActivities, useMetrics } from '../hooks/useData';
import { DAY, addDays, dayKey, formatDateTime, formatShort, parseDayKey, startOfDay } from '../lib/dates';
import { useUI } from '../state/ui';

function ResultBox({ result, saved }: { result: ImportResult; saved?: { metrics: number; activities: number; notes: number } }) {
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="hint" style={{ color: 'var(--text)' }}>
        <strong>{result.source}</strong> — {summarize(result.metrics, result.activities)}
        {saved && (
          <div className="small dim" style={{ marginTop: 4 }}>
            Saved {saved.metrics} daily values and {saved.activities} workouts{saved.notes ? `, added ${saved.notes} journal entries` : ''}.
          </div>
        )}
      </div>
      {result.warnings.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 18, color: '#ffb3a3' }}>
          {result.warnings.slice(0, 8).map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      {result.log.length > 0 && (
        <details className="disclosure">
          <summary>Details</summary>
          <div className="small dim mono" style={{ whiteSpace: 'pre-wrap' }}>
            {result.log.slice(0, 80).join('\n')}
          </div>
        </details>
      )}
    </div>
  );
}

function GoogleConnect() {
  const ui = useUI();
  const clientId = useLiveQuery(() => getSetting<string>('googleClientId', ''), [], '');
  const lastSync = useLiveQuery(() => getSetting<number | null>('googleLastSync', null), [], null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [days, setDays] = useState(90);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ r: ImportResult; saved: { metrics: number; activities: number; notes: number } } | null>(null);
  const [connected, setConnected] = useState(() => !!storedToken());
  const [activityNotes, setActivityNotes] = useState(false);
  const idValue = draftId ?? clientId ?? '';
  const origin = typeof location !== 'undefined' ? location.origin : '';

  const sync = async () => {
    const id = idValue.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(id)) {
      setStatus('Paste the OAuth client ID from Google Cloud (it ends with .apps.googleusercontent.com).');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      await setSetting('googleClientId', id);
      setDraftId(null);
      setStatus('Signing in with Google…');
      const tok = storedToken() ?? (await signIn(id));
      setConnected(true);
      const to = dayKey(addDays(startOfDay(Date.now()), 1));
      const from = dayKey(addDays(startOfDay(Date.now()), -days));
      const r = await syncGoogleHealth(tok.token, from, to, setStatus);
      const saved = await saveImport(r, { activityNotes });
      await setSetting('googleLastSync', Date.now());
      setResult({ r, saved });
      setStatus(null);
      ui.showToast(`Synced ${saved.metrics} daily values from Google Health`);
    } catch (e) {
      if (e instanceof HealthApiError && e.status === 401) {
        forgetToken();
        setConnected(false);
      }
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card col">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div className="row">
          <Icon name="cloud" />
          <h3>Connect Google Health</h3>
        </div>
        {connected ? <span className="chip on">Connected</span> : <span className="chip">Not connected</span>}
      </div>
      <p className="dim small">
        Live sync from the <strong>Google Health API</strong> — Google’s replacement for the Google Fit and Fitbit Web APIs (Google Fit’s APIs
        shut down in 2026). Data from Fitbit, Pixel Watch and apps that write to your Google Health account comes straight into Phoenix
        Atlas. Your sign-in token stays in this browser tab.
      </p>
      <div className="field">
        <label htmlFor="gclient">OAuth client ID</label>
        <input
          id="gclient"
          className="input mono"
          placeholder="1234567890-abc123.apps.googleusercontent.com"
          value={idValue}
          onChange={(e) => setDraftId(e.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <div className="row wrap">
        <Seg
          value={days}
          onChange={setDays}
          label="How far back"
          options={[
            { value: 30, label: '30 days' },
            { value: 90, label: '90 days' },
            { value: 180, label: '6 months' },
            { value: 365, label: '1 year' },
          ]}
        />
        <div className="row small">
          <Check on={activityNotes} onChange={setActivityNotes} label="Add workouts to journal" />
          <span className="dim">Add workouts to journal</span>
        </div>
      </div>
      <div className="row wrap">
        <button className="btn primary" onClick={sync} disabled={busy}>
          <Icon name="refresh" /> {busy ? 'Syncing…' : connected ? 'Sync now' : 'Connect & sync'}
        </button>
        {connected && (
          <button
            className="btn ghost"
            onClick={() => {
              forgetToken();
              setConnected(false);
            }}
          >
            Disconnect
          </button>
        )}
        {lastSync && <span className="small muted">Last synced {formatDateTime(lastSync)}</span>}
      </div>
      {status && <div className="small" style={{ color: busy ? 'var(--text-2)' : '#ffb3a3' }}>{status}</div>}
      {result && <ResultBox result={result.r} saved={result.saved} />}
      <details className="disclosure">
        <summary>One-time setup (about 5 minutes)</summary>
        <div>
          <ol className="steps small">
            <li>
              Open <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer">Google Cloud Console</a> and create a project
              (e.g. “Phoenix Atlas”).
            </li>
            <li>
              In <em>APIs &amp; Services → Library</em>, search for <strong>Google Health API</strong> and enable it.
            </li>
            <li>
              In <em>OAuth consent screen</em>, choose <em>External</em>, keep it in <em>Testing</em>, add your own Google account as a test
              user, and add the scopes <code>googlehealth.activity_and_fitness.readonly</code>,{' '}
              <code>googlehealth.health_metrics_and_measurements.readonly</code> and <code>googlehealth.sleep.readonly</code>.
            </li>
            <li>
              In <em>Credentials → Create credentials → OAuth client ID</em>, pick <em>Web application</em> and add this site as an
              authorised JavaScript origin: <code>{origin}</code>
            </li>
            <li>Copy the client ID, paste it above and press <em>Connect &amp; sync</em>.</li>
          </ol>
          <p className="small muted" style={{ marginTop: 8 }}>
            If Google blocks sign-in (unverified app or API access not yet granted to your account), use the file upload below — a Google
            Takeout export contains the same data.
          </p>
        </div>
      </details>
    </div>
  );
}

function FileImport() {
  const ui = useUI();
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ file: string; fraction: number } | null>(null);
  const [result, setResult] = useState<{ r: ImportResult; saved?: { metrics: number; activities: number; notes: number } } | null>(null);
  const [activityNotes, setActivityNotes] = useState(false);

  const run = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await importFiles(files, (p) => setProgress({ file: p.file, fraction: p.fraction }));
      const saved = r.metrics.length || r.activities.length ? await saveImport(r, { activityNotes }) : undefined;
      setResult({ r, saved });
      if (saved) ui.showToast(`Imported ${saved.metrics} daily values`);
    } catch (e) {
      setResult({ r: { source: 'Import', metrics: [], activities: [], log: [], warnings: [(e as Error).message] } });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <div className="card col">
      <div className="card-head" style={{ marginBottom: 0 }}>
        <div className="row">
          <Icon name="upload" />
          <h3>Upload health data</h3>
        </div>
      </div>
      <div
        className={`dropzone ${drag ? 'drag' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          run([...e.dataTransfer.files]);
        }}
      >
        {busy ? (
          <div className="col" style={{ gap: 8 }}>
            <span>Importing {progress?.file ?? ''}…</span>
            <div className="progress">
              <div style={{ width: `${Math.round((progress?.fraction ?? 0) * 100)}%` }} />
            </div>
          </div>
        ) : (
          <>
            <strong>Drop files here or tap to choose</strong>
            <div className="small" style={{ marginTop: 4 }}>
              Google Takeout .zip (Fit or Fitbit) · Health Connect export .zip · CSV · JSON
            </div>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        accept=".zip,.csv,.json,.db,application/zip,text/csv,application/json"
        onChange={(e) => {
          const f = [...(e.target.files ?? [])];
          e.target.value = '';
          run(f);
        }}
      />
      <div className="row small">
        <Check on={activityNotes} onChange={setActivityNotes} label="Add imported workouts to journal" />
        <span className="dim">Add imported workouts to the journal</span>
      </div>
      {result && <ResultBox result={result.r} saved={result.saved} />}
      <details className="disclosure">
        <summary>Where do I get these files?</summary>
        <div className="col small dim" style={{ gap: 10 }}>
          <div>
            <strong className="dim">Google Takeout (Google Fit or Fitbit)</strong>
            <ol className="steps">
              <li>
                Go to <a href="https://takeout.google.com" target="_blank" rel="noreferrer">takeout.google.com</a>, click <em>Deselect all</em>,
                then tick <em>Fit</em> and/or <em>Fitbit</em>.
              </li>
              <li>Export once as a .zip and download it when the email arrives.</li>
              <li>Drop the .zip here — no need to unzip. Big exports are streamed, only health files are read.</li>
            </ol>
          </div>
          <div>
            <strong className="dim">Health Connect (Android)</strong>
            <ol className="steps">
              <li>
                Settings → <em>Health Connect</em> → <em>Manage data</em> → <em>Backup and restore</em> (or <em>Export data</em>).
              </li>
              <li>Export to a file (“Health Connect.zip”) and drop it here.</li>
            </ol>
          </div>
          <div>
            <strong className="dim">Any CSV</strong>
            <p>
              A file with a <code>date</code> column and numeric columns (steps, resting heart rate, sleep, weight, HRV…). Unknown columns
              are kept as custom metrics.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}

function MetricTile({ metric, values, onClick, active }: { metric: string; values: { date: string; value: number }[]; onClick: () => void; active: boolean }) {
  const def = metricDef(metric);
  const today = startOfDay(Date.now());
  const inRange = (from: number, to: number) => values.filter((v) => { const t = parseDayKey(v.date); return t > today - to * DAY && t <= today - from * DAY; });
  const avg = (vs: { value: number }[]) => (vs.length ? vs.reduce((s, v) => s + v.value, 0) / vs.length : null);
  const cur = avg(inRange(0, 7));
  const prev = avg(inRange(7, 14));
  const delta = cur !== null && prev !== null && prev !== 0 ? (cur - prev) / Math.abs(prev) : null;
  const good = delta === null || !def.better ? null : (delta > 0) === (def.better === 'higher');
  const last = values[values.length - 1];
  return (
    <button className={`card stat ${active ? 'on' : ''}`} onClick={onClick} style={{ textAlign: 'left', cursor: 'pointer', borderColor: active ? 'rgba(255,122,61,.55)' : undefined }}>
      <div className="k">{def.label}</div>
      <div className="v">{cur !== null ? formatMetric(metric, cur) : last ? formatMetric(metric, last.value) : '—'}</div>
      <div className="d muted">
        {cur !== null ? '7-day avg' : last ? `last ${formatShort(parseDayKey(last.date))}` : ''}
        {delta !== null && Math.abs(delta) >= 0.005 && (
          <span className={good === null ? '' : good ? 'trend-up' : 'trend-down'} style={{ marginLeft: 6 }}>
            {delta > 0 ? '▲' : '▼'} {Math.abs(delta * 100).toFixed(0)}% vs prior week
          </span>
        )}
      </div>
    </button>
  );
}

export default function HealthPage() {
  const metrics = useMetrics();
  const activities = useActivities();
  const [selected, setSelected] = useState<string | null>(null);
  const [range, setRange] = useState(90);

  const byMetric = useMemo(() => {
    const m = new Map<string, { date: string; value: number }[]>();
    for (const p of metrics) {
      const arr = m.get(p.metric) ?? [];
      arr.push({ date: p.date, value: p.value });
      m.set(p.metric, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
    return m;
  }, [metrics]);
  const keys = [...byMetric.keys()].sort((a, b) => {
    const ia = METRICS.findIndex((m) => m.key === a), ib = METRICS.findIndex((m) => m.key === b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const sel = selected && byMetric.has(selected) ? selected : keys[0];
  const sources = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of metrics) m.set(p.source, (m.get(p.source) ?? 0) + 1);
    for (const a of activities) m.set(a.source, (m.get(a.source) ?? 0) + 1);
    return [...m.entries()];
  }, [metrics, activities]);
  const from = range ? startOfDay(Date.now()) - range * DAY : -Infinity;
  const series = sel ? (byMetric.get(sel) ?? []).filter((v) => parseDayKey(v.date) >= from) : [];

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Health data</h1>
            <p>Bring in steps, sleep, heart rate, HRV and workouts to see how they relate to how your body feels.</p>
          </div>
        </div>

        <div className="grid two">
          <GoogleConnect />
          <FileImport />
        </div>

        <div className="page-head" style={{ marginTop: 8 }}>
          <h2>Your health metrics</h2>
          {keys.length > 0 && (
            <Seg
              value={range}
              onChange={setRange}
              label="Range"
              options={[
                { value: 30, label: '30d' },
                { value: 90, label: '90d' },
                { value: 365, label: '1y' },
                { value: 0, label: 'All' },
              ]}
            />
          )}
        </div>
        {keys.length === 0 ? (
          <Empty title="No health data yet">Connect Google Health or upload an export above. (Settings → demo data includes sample metrics.)</Empty>
        ) : (
          <>
            <div className="grid four">
              {keys.map((k) => (
                <MetricTile key={k} metric={k} values={byMetric.get(k)!} onClick={() => setSelected(k)} active={k === sel} />
              ))}
            </div>
            {sel && (
              <div className="card">
                <div className="card-head">
                  <h3>
                    {metricDef(sel).label} <span className="muted small">({metricDef(sel).unit})</span>
                  </h3>
                  <span className="muted small">{series.length} days</span>
                </div>
                <LineChart
                  ariaLabel={`${metricDef(sel).label} per day`}
                  height={240}
                  formatY={(y) => y.toLocaleString(undefined, { maximumFractionDigits: metricDef(sel).decimals })}
                  series={[{ id: sel, label: metricDef(sel).label, color: '#5a9fd8', area: true, dots: series.length < 45, points: series.map((v) => ({ x: parseDayKey(v.date), y: v.value })) }]}
                />
              </div>
            )}
          </>
        )}

        {activities.length > 0 && (
          <div className="card">
            <div className="card-head">
              <h3>Imported workouts</h3>
              <span className="muted small">{activities.length} total</span>
            </div>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Workout</th>
                    <th className="num">Duration</th>
                    <th className="num">Distance</th>
                    <th className="num">Calories</th>
                    <th className="num">Avg HR</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {activities.slice(0, 25).map((a) => (
                    <tr key={a.id}>
                      <td className="nowrap">{formatShort(a.start)}</td>
                      <td>{a.name}</td>
                      <td className="num">{a.durationMin} min</td>
                      <td className="num">{a.distanceKm ? `${a.distanceKm} km` : '—'}</td>
                      <td className="num">{a.calories ?? '—'}</td>
                      <td className="num">{a.avgHr ?? '—'}</td>
                      <td className="muted">{a.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {sources.length > 0 && (
          <div className="card col">
            <h3>Sources</h3>
            {sources.map(([s, n]) => (
              <div key={s} className="row between">
                <span>
                  {s} <span className="muted small">· {n} items</span>
                </span>
                <ConfirmButton className="btn small danger" onConfirm={() => deleteSource(s)}>
                  Remove
                </ConfirmButton>
              </div>
            ))}
          </div>
        )}
        <p className="tiny muted">Dates are shown in your local time zone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). Last 7 days end today, {dayKey(Date.now())}.</p>
      </div>
    </div>
  );
}
