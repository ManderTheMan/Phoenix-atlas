// The capture checklist for one photo or video: what computer vision needs,
// how this file measured up, and what to change next time.
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db, type MediaItem } from '../../db/db';
import type { PoseTrack } from '../../vision/analysis';
import { useVisionJobs } from '../../vision/jobs';
import { qualityChecks, qualitySummary, type CheckStatus } from '../../vision/quality';
import Icon from '../Icon';

export const STATUS_ICON: Record<CheckStatus, string> = { pass: 'check', warn: 'info', fail: 'x', info: 'info' };

export default function QualityPanel({ item, track }: { item: MediaItem; track: PoseTrack | null | undefined }) {
  const jobs = useVisionJobs();
  const [open, setOpen] = useState<string | null>(null);
  // the previous photo of the same pose, to check the setup was the same
  const previous = useLiveQuery(async () => {
    if (item.kind !== 'photo' || item.purpose !== 'progress') return null;
    const prev = (await db.media.where('pose').equals(item.pose ?? 'other').toArray()).filter((m) => m.kind === 'photo' && m.date < item.date && (m.owner ?? '') === (item.owner ?? '')).sort((a, b) => b.date - a.date)[0];
    return prev ? ((await db.poses.get(prev.id)) ?? null) : null;
  }, [item.id, item.date, item.pose, item.kind, item.purpose]);
  const checks = useMemo(() => qualityChecks(item, track ?? null, previous), [item, track, previous]);
  const verdict = qualitySummary(checks);
  const busy = !!jobs.jobs[item.id] || jobs.queue.includes(item.id);

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className={`verdict ${verdict.status}`}>
        <Icon name={STATUS_ICON[verdict.status]} size={16} />
        <span>{verdict.text}</span>
      </div>
      {!track && (
        <button className="btn small" disabled={busy || track === undefined} onClick={() => jobs.start([item])}>
          <Icon name="sparkle" /> {busy ? 'Finding joints…' : 'Find joints to run every check'}
        </button>
      )}
      <div className="checks">
        {checks.map((c) => (
          <div key={c.id} className={`check-row ${c.status}`}>
            <button className="check-head" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>
              <span className={`check-dot ${c.status}`}>
                <Icon name={STATUS_ICON[c.status]} size={12} />
              </span>
              <span className="grow">
                <span className="small">{c.label}</span>
                <span className="tiny dim block">{c.value}</span>
              </span>
              <Icon name={open === c.id ? 'chevronUp' : 'chevronDown'} size={14} />
            </button>
            {open === c.id && (
              <div className="check-body tiny">
                <p>
                  <strong>Why it matters.</strong> {c.why}
                </p>
                {c.fix && (
                  <p>
                    <strong>Next time.</strong> {c.fix}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="tiny muted">These checks come from the dataset guide: they’re what makes a photo or clip measurable, and worth sharing.</p>
    </div>
  );
}
