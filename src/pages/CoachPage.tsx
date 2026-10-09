// Working with a coach: pair once with a QR code, send encrypted share files,
// and get feedback back. The same page is the coach's side: athletes who paired
// with you, their shared clips and notes, and the feedback you send.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ConfirmButton, Seg } from '../components/common';
import QrCode from '../components/coach/QrCode';
import Icon from '../components/Icon';
import MediaThumb from '../components/media/MediaThumb';
import { buildFeedback, buildShare, createPairing, feedbackItems, joinPairing, openPhx, pairingCode, pairingFingerprint, removePairing, sendFile, shareContents, useFeedback, usePairings, useShares, type ShareContents, type ShareOptions } from '../coach/coach';
import { parsePairCode, fingerprint } from '../coach/crypto';
import { pairingLink, usePendingPair } from '../coach/link';
import type { MediaItem, Pairing } from '../db/db';
import { DAY, formatDate } from '../lib/dates';
import { CATEGORIES } from '../lib/feeling';
import { formatBytes, formatDuration, useAllMedia } from '../media/media';
import { useMediaUI } from '../media/mediaUI';
import { PATTERN_BY_ID, type PatternId } from '../movement/patterns';
import { currentValues, formatMeasure, MEASURE_BY_KEY, measureLabel, useProfile, type MeasureKey } from '../profile/profile';
import { useUI } from '../state/ui';
import { JOINTS, type JointId } from '../vision/analysis';

function useFingerprint(p: Pairing | null): string {
  const [fp, setFp] = useState('');
  useEffect(() => {
    if (p) void pairingFingerprint(p).then(setFp);
  }, [p]);
  return fp;
}

export default function CoachPage() {
  const ui = useUI();
  const pairings = usePairings();
  const coaches = pairings.filter((p) => p.role === 'athlete');
  const athletes = pairings.filter((p) => p.role === 'coach');
  const pending = usePendingPair();
  const fileInput = useRef<HTMLInputElement>(null);
  const [opening, setOpening] = useState<number | null>(null);
  const mui = useMediaUI();

  const open = async (file?: File) => {
    if (!file) return;
    setOpening(0);
    try {
      const r = await openPhx(file, setOpening);
      if (r.kind === 'share') ui.showToast(`Opened ${r.share.from}’s share: ${r.share.itemIds.length} clip${r.share.itemIds.length === 1 ? '' : 's'} and ${r.share.notes.length} notes.`);
      else {
        ui.showToast(`Feedback from ${r.feedback.from} on ${r.feedback.itemIds.length} clip${r.feedback.itemIds.length === 1 ? '' : 's'}.`);
        if (r.feedback.itemIds.length) mui.openViewer(r.feedback.itemIds[0], r.feedback.itemIds);
      }
    } catch (e) {
      ui.showToast((e as Error).message);
    } finally {
      setOpening(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Coach</h1>
            <p>Share your clips, photos and notes with your coach and get feedback on them. Files are encrypted on this device and only your paired coach can open them.</p>
          </div>
          <div className="row wrap">
            <button className="btn" disabled={opening !== null} onClick={() => fileInput.current?.click()}>
              <Icon name="upload" /> {opening !== null ? `Opening… ${Math.round(opening * 100)}%` : 'Open a share or feedback file'}
            </button>
            <input ref={fileInput} type="file" accept=".phx,application/octet-stream" hidden onChange={(e) => void open(e.target.files?.[0])} />
          </div>
        </div>

        {pending.code && <JoinCard code={pending.code} onDone={pending.clear} />}
        <YourCoach pairings={coaches} />
        {athletes.map((p) => (
          <AthleteCard key={p.id} pairing={p} />
        ))}
        <CoachingSomeone hasAthletes={athletes.length > 0} />
        <HowItWorks />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- athlete side

function YourCoach({ pairings }: { pairings: Pairing[] }) {
  const profile = useProfile();
  const [showing, setShowing] = useState<{ pairing: Pairing; code: string } | null>(null);
  const start = async () => setShowing(await createPairing(profile.name ?? ''));

  return (
    <div className="card col">
      <h3>Your coach</h3>
      {showing ? (
        <PairingQr pairing={showing.pairing} code={showing.code} onDone={() => setShowing(null)} />
      ) : pairings.length === 0 ? (
        <>
          <p className="small dim">
            Pair once, ideally together in person: your coach scans a QR code from this screen with their phone’s camera. After that you can send
            them share files any way you like, and only their phone can open them.
          </p>
          <div>
            <button className="btn primary" onClick={() => void start()}>
              <Icon name="link" /> Pair with your coach
            </button>
          </div>
        </>
      ) : (
        pairings.map((p) => <CoachPairing key={p.id} pairing={p} onShowCode={() => setShowing({ pairing: p, code: pairingCode(p, profile.name ?? '') })} />)
      )}
    </div>
  );
}

function PairingQr({ pairing, code, onDone }: { pairing: Pairing; code: string; onDone: () => void }) {
  const ui = useUI();
  const fp = useFingerprint(pairing);
  const link = pairingLink(code);
  const [reveal, setReveal] = useState(false);
  return (
    <div className="pair-qr col">
      <div className="row wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
        <QrCode text={link} label="Pairing code for your coach to scan" />
        <div className="col grow" style={{ gap: 8, minWidth: 220 }}>
          <strong>Ask your coach to scan this with their phone’s camera.</strong>
          <span className="small dim">It opens Phoenix Atlas on their phone and asks them to join. Then check their screen shows the same check code:</span>
          <span className="fingerprint">{fp}</span>
          <span className="tiny muted">
            The code holds the key to your shares. Don’t post it or send it in a group chat. Can’t meet? Send the link in a private message you trust,
            and check the code together on a call.
          </span>
          <div className="row wrap">
            <button className="btn small" onClick={() => setReveal((r) => !r)}>
              <Icon name="link" /> {reveal ? 'Hide link' : 'Show link'}
            </button>
            {reveal && (
              <button
                className="btn small ghost"
                onClick={() =>
                  void navigator.clipboard?.writeText(link).then(
                    () => ui.showToast('Link copied. Send it only to your coach.'),
                    () => ui.showToast('Couldn’t copy; select the link and copy it.'),
                  )
                }
              >
                Copy
              </button>
            )}
            <button className="btn small primary" onClick={onDone}>
              <Icon name="check" /> Done
            </button>
          </div>
          {reveal && <code className="pair-link">{link}</code>}
        </div>
      </div>
    </div>
  );
}

function CoachPairing({ pairing, onShowCode }: { pairing: Pairing; onShowCode: () => void }) {
  const fp = useFingerprint(pairing);
  const [sharing, setSharing] = useState(false);
  const feedback = useFeedback().filter((f) => f.pairId === pairing.id);
  const mui = useMediaUI();
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row between wrap">
        <div className="col" style={{ gap: 2 }}>
          {pairing.name !== 'Your coach' && <strong>{pairing.name}</strong>}
          <span className="tiny muted">
            Check code {fp} · paired {formatDate(pairing.created)}
            {pairing.lastSent ? ` · last share ${formatDate(pairing.lastSent)}` : ''}
          </span>
        </div>
        <div className="row wrap">
          <button className="btn primary small" onClick={() => setSharing((s) => !s)}>
            <Icon name="share" /> Share with {pairing.name === 'Your coach' ? 'your coach' : pairing.name}
          </button>
          <button className="btn small ghost" onClick={onShowCode}>
            Show pairing code
          </button>
          <ConfirmButton className="btn small ghost" onConfirm={() => void removePairing(pairing.id)}>
            Unpair
          </ConfirmButton>
        </div>
      </div>
      {sharing && <ShareForm pairing={pairing} onDone={() => setSharing(false)} />}
      {feedback.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <h4>Feedback</h4>
          {feedback.map((f) => (
            <button key={f.id} className="feedback-row" onClick={() => f.itemIds.length && mui.openViewer(f.itemIds[0], f.itemIds)}>
              <Icon name="info" size={16} />
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <span className="small">
                  {formatDate(f.created)} · {f.itemIds.length} clip{f.itemIds.length === 1 ? '' : 's'} commented
                </span>
                {f.message && <span className="small dim">“{f.message}”</span>}
              </span>
              {f.itemIds.length > 0 && <Icon name="chevronRight" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PERIODS: { value: string; label: string; days: number | null }[] = [
  { value: '4w', label: '4 weeks', days: 28 },
  { value: '3m', label: '3 months', days: 91 },
  { value: '1y', label: 'Year', days: 365 },
  { value: 'all', label: 'Everything', days: null },
];

function ShareForm({ pairing, onDone }: { pairing: Pairing; onDone: () => void }) {
  const ui = useUI();
  const profile = useProfile();
  const [period, setPeriod] = useState('4w');
  const [o, setO] = useState<Omit<ShareOptions, 'since'>>({ form: true, progress: false, notes: true, measurements: true, message: '' });
  const since = useMemo(() => {
    const d = PERIODS.find((p) => p.value === period)!.days;
    return d === null ? null : Date.now() - d * DAY;
  }, [period]);
  const [contents, setContents] = useState<ShareContents | null>(null);
  useEffect(() => {
    let live = true;
    void shareContents({ ...o, since }).then((c) => live && setContents(c));
    return () => {
      live = false;
    };
  }, [o, since]);
  const [progress, setProgress] = useState<{ text: string; p: number } | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const make = async () => {
    setProgress({ text: 'Starting', p: 0 });
    try {
      const r = await buildShare(pairing, { ...o, since }, profile.name || 'Your athlete', (text, p) => setProgress({ text, p }));
      setProgress(null);
      const how = await sendFile(r.file, r.name);
      setDone(
        how === 'shared'
          ? `Shared ${r.name}.`
          : `Saved ${r.name} (${formatBytes(r.file.size)}). Send it to ${pairing.name === 'Your coach' ? 'your coach' : pairing.name} however you like: email, Drive, a messaging app. Only their paired phone can open it.`,
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') ui.showToast((e as Error).message);
    } finally {
      setProgress(null);
    }
  };

  const set = (patch: Partial<typeof o>) => setO((x) => ({ ...x, ...patch }));
  return (
    <div className="share-form col">
      <Seg value={period} onChange={setPeriod} label="Period" options={PERIODS.map((p) => ({ value: p.value, label: p.label }))} />
      <div className="export-opts">
        {(
          [
            ['form', 'Form clips (with their joint tracking)'],
            ['progress', 'Progress photos'],
            ['notes', 'Notes and workouts'],
            ['measurements', 'Body measurements'],
          ] as const
        ).map(([k, label]) => (
          <label key={k} className="row" style={{ gap: 8 }}>
            <Check on={o[k]} onChange={(v) => set({ [k]: v })} label={label} />
            <span className="small">{label}</span>
          </label>
        ))}
      </div>
      <label className="field">
        <span className="label">Message</span>
        <textarea className="input" rows={2} value={o.message} onChange={(e) => set({ message: e.target.value })} placeholder="What would you like feedback on?" />
      </label>
      {contents && (
        <p className="tiny dim">
          {contents.items.length} file{contents.items.length === 1 ? '' : 's'} ({formatBytes(contents.bytes)}), {contents.notes.length} note{contents.notes.length === 1 ? '' : 's'},{' '}
          {contents.measurements.length} measurement entr{contents.measurements.length === 1 ? 'y' : 'ies'}. Anything marked private stays on this device.
        </p>
      )}
      {progress ? (
        <div className="col" style={{ gap: 6 }}>
          <div className="progress">
            <span style={{ width: `${Math.round(progress.p * 100)}%` }} />
          </div>
          <span className="tiny dim">{progress.text}…</span>
        </div>
      ) : (
        <div className="row wrap">
          <button className="btn primary" disabled={!contents || (!contents.items.length && !contents.notes.length && !contents.measurements.length)} onClick={() => void make()}>
            <Icon name="lock" /> Create encrypted share
          </button>
          <button className="btn ghost" onClick={onDone}>
            Close
          </button>
        </div>
      )}
      {done && (
        <p className="small">
          <Icon name="check" size={14} /> {done}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- coach side

function JoinCard({ code, onDone }: { code: string; onDone: () => void }) {
  const ui = useUI();
  const parsed = useMemo(() => parsePairCode(code), [code]);
  const [fp, setFp] = useState('');
  useEffect(() => {
    if (parsed) void fingerprint(parsed.secret).then(setFp);
  }, [parsed]);
  if (!parsed)
    return (
      <div className="card col">
        <h3>Pairing link</h3>
        <p className="small warn-text">That pairing link is incomplete or damaged. Ask for the QR code again.</p>
        <div>
          <button className="btn" onClick={onDone}>
            Close
          </button>
        </div>
      </div>
    );
  const join = async () => {
    try {
      const p = await joinPairing(parsed);
      ui.showToast(`Paired with ${p.name}.`);
      onDone();
    } catch (e) {
      ui.showToast((e as Error).message);
    }
  };
  return (
    <div className="card col join-card">
      <h3>Coach {parsed.name || 'this athlete'}?</h3>
      <p className="small">
        Check {parsed.name || 'their'} screen shows this code: <span className="fingerprint">{fp}</span>
      </p>
      <p className="tiny muted">Joining keeps the pairing on this device only. You’ll be able to open the share files they send you, and send feedback back.</p>
      <div className="row wrap">
        <button className="btn primary" onClick={() => void join()}>
          <Icon name="check" /> The codes match: join
        </button>
        <button className="btn ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function CoachingSomeone({ hasAthletes }: { hasAthletes: boolean }) {
  const [text, setText] = useState('');
  const pending = usePendingPair();
  const valid = parsePairCode(text);
  return (
    <div className="card col">
      <h3>{hasAthletes ? 'Add another athlete' : 'Coaching someone?'}</h3>
      <p className="small dim">Scan their pairing QR code with your phone’s camera. Or, if they sent you the link, paste it here:</p>
      <div className="row wrap" style={{ gap: 8 }}>
        <input className="input grow" value={text} onChange={(e) => setText(e.target.value)} placeholder="Pairing link" aria-label="Pairing link" style={{ minWidth: 200 }} />
        <button className="btn" disabled={!valid} onClick={() => (usePendingPair.setState({ code: text.trim() }), setText(''))}>
          Next
        </button>
      </div>
      {text && !valid && !pending.code && <span className="tiny warn-text">That doesn’t look like a pairing link.</span>}
    </div>
  );
}

function AthleteCard({ pairing }: { pairing: Pairing }) {
  const ui = useUI();
  const mui = useMediaUI();
  const profile = useProfile();
  const fp = useFingerprint(pairing);
  const shares = useShares(pairing.id);
  const latest = shares[0];
  const all = useAllMedia();
  const items = useMemo(() => all.filter((m) => m.owner === pairing.id), [all, pairing.id]);
  const patterns = useMemo(() => [...new Set(items.map((m) => m.pattern ?? ''))], [items]);
  const [pattern, setPattern] = useState<string | null>(null);
  const shown = items.filter((m) => pattern === null || (m.pattern ?? '') === pattern);
  const [message, setMessage] = useState('');
  const [commented, setCommented] = useState(0);
  useEffect(() => {
    void feedbackItems(pairing.id).then((f) => setCommented(f.length));
  }, [pairing.id, items]);
  const notes = useMemo(() => shares.flatMap((s) => s.notes).filter((n, i, a) => a.findIndex((x) => x.id === n.id) === i).sort((a, b) => b.date - a.date), [shares]);
  const values = useMemo(() => currentValues(shares.flatMap((s) => s.measurements)), [shares]);
  const [showNotes, setShowNotes] = useState(5);

  const send = async () => {
    try {
      const r = await buildFeedback(pairing, message, profile.name || 'Your coach');
      const how = await sendFile(r.file, r.name);
      ui.showToast(how === 'shared' ? 'Feedback shared.' : `Saved ${r.name}. Send it to ${pairing.name}; only their phone can open it.`);
      setMessage('');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') ui.showToast((e as Error).message);
    }
  };

  return (
    <div className="card col">
      <div className="row between wrap">
        <div className="col" style={{ gap: 2 }}>
          <h3>{pairing.name}</h3>
          <span className="tiny muted">
            You coach them · check code {fp}
            {latest ? ` · last share ${formatDate(latest.received)}` : ' · no share yet'}
          </span>
        </div>
        <ConfirmButton className="btn small ghost" onConfirm={() => void removePairing(pairing.id)}>
          Remove
        </ConfirmButton>
      </div>
      {!latest && <p className="small dim">When {pairing.name} sends you a share file, open it with the button at the top of this page.</p>}
      {latest?.message && (
        <p className="small">
          <strong>{latest.from}:</strong> “{latest.message}”
        </p>
      )}

      {items.length > 0 && (
        <>
          <div className="chips">
            <button className={`chip ${pattern === null ? 'on' : ''}`} onClick={() => setPattern(null)}>
              All <span className="dim">{items.length}</span>
            </button>
            {patterns.map((p) => (
              <button key={p} className={`chip ${pattern === p ? 'on' : ''}`} onClick={() => setPattern(p)}>
                {p ? PATTERN_BY_ID.get(p as PatternId)?.short ?? p : 'Other'} <span className="dim">{items.filter((m) => (m.pattern ?? '') === p).length}</span>
              </button>
            ))}
          </div>
          <div className="athlete-clips">
            {shown.slice(0, 60).map((m) => (
              <AthleteClip key={m.id} m={m} onOpen={() => mui.openViewer(m.id, shown.map((x) => x.id))} />
            ))}
          </div>
        </>
      )}

      {Object.keys(values).length > 0 && (
        <details>
          <summary className="small">Latest measurements</summary>
          <div className="chips" style={{ marginTop: 6 }}>
            {(Object.keys(values) as MeasureKey[]).map((k) => (
              <span key={k} className="chip mini">
                {measureLabel(k)} {formatMeasure(values[k], MEASURE_BY_KEY.get(k)?.unit ?? 'cm', profile.units)}
              </span>
            ))}
          </div>
        </details>
      )}

      {notes.length > 0 && (
        <details>
          <summary className="small">Notes ({notes.length})</summary>
          <div className="col" style={{ gap: 6, marginTop: 6 }}>
            {notes.slice(0, showNotes).map((n) => (
              <div key={n.id} className="athlete-note">
                <span className="tiny muted">
                  {formatDate(n.date)} · {CATEGORIES.find((c) => c.id === n.category)?.label ?? n.category} · feeling {n.feeling > 0 ? `+${n.feeling}` : n.feeling}
                </span>
                <strong className="small">{n.title}</strong>
                {n.body && <span className="small dim">{n.body}</span>}
                {n.workout?.exercises?.length ? (
                  <span className="tiny dim">
                    {n.workout.exercises.map((e) => [e.name, e.sets && e.reps ? `${e.sets}×${e.reps}` : '', e.load ? `${e.load} ${e.unit ?? 'kg'}` : ''].filter(Boolean).join(' ')).join(' · ')}
                  </span>
                ) : null}
              </div>
            ))}
            {notes.length > showNotes && (
              <button className="btn ghost small" onClick={() => setShowNotes((n) => n + 10)}>
                Show more
              </button>
            )}
          </div>
        </details>
      )}

      <div className="col feedback-box" style={{ gap: 8 }}>
        <h4>Feedback</h4>
        <p className="tiny dim">
          Open a clip to comment on it and draw angles; they go back with your feedback. {commented} clip{commented === 1 ? '' : 's'} with comments or drawings so far.
        </p>
        <textarea className="input" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={`A message for ${pairing.name}`} />
        <div>
          <button className="btn primary" disabled={!commented && !message.trim()} onClick={() => void send()}>
            <Icon name="lock" /> Create encrypted feedback
          </button>
        </div>
      </div>
    </div>
  );
}

function AthleteClip({ m, onOpen }: { m: MediaItem; onOpen: () => void }) {
  const tr = m.tracked?.pattern === m.pattern ? m.tracked : undefined;
  return (
    <button className="athlete-clip" onClick={onOpen}>
      <MediaThumb item={m} />
      <span className="col" style={{ gap: 1, minWidth: 0 }}>
        <span className="tiny">{formatDate(m.date)}</span>
        <span className="tiny dim ellipsis">
          {m.kind === 'video' ? formatDuration(m.duration) : 'Photo'}
          {tr?.reps ? ` · ${JOINTS[tr.joint as JointId]?.label.toLowerCase() ?? ''} ${Math.round(tr.deepest ?? 0)}°` : ''}
        </span>
        {m.coachComment?.text && (
          <span className="tiny ok-text">
            <Icon name="edit" size={10} /> commented
          </span>
        )}
      </span>
    </button>
  );
}

function HowItWorks() {
  return (
    <div className="card col">
      <details>
        <summary className="small">How the sharing works</summary>
        <ul className="small dim how-list">
          <li>Pairing gives your phone and your coach’s the same secret key. It never leaves the two devices, and it isn’t included in backups.</li>
          <li>Each share or feedback file is encrypted on the sending phone (AES-256-GCM, with a fresh key for every file), so it can travel by email, Drive or any messaging app. Anyone else who gets the file sees only scrambled data.</li>
          <li>Files are checked when opened: a changed, incomplete or wrongly addressed file won’t open.</li>
          <li>What you share is a copy. On your coach’s phone it’s kept apart from their own photos and videos, and removing you as an athlete deletes it.</li>
          <li>Private photos, videos and notes are never shared. File names and folder names of archive clips stay on your device.</li>
          <li>Keep your phone locked: anyone using your unlocked phone can open the app.</li>
        </ul>
      </details>
    </div>
  );
}
