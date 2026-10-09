// The coach's comment on a clip: written on the coach's phone (it goes back
// with their feedback), read on the athlete's.
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { db, type MediaItem } from '../../db/db';
import { formatDate } from '../../lib/dates';
import { updateMedia } from '../../media/media';

export default function CoachNote({ item }: { item: MediaItem }) {
  const pairing = useLiveQuery(async () => (item.owner ? db.pairings.get(item.owner) : undefined), [item.owner]);
  const [text, setText] = useState(item.coachComment?.text ?? '');
  useEffect(() => setText(item.coachComment?.text ?? ''), [item.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!item.owner || text === (item.coachComment?.text ?? '')) return;
    const t = setTimeout(() => void updateMedia(item.id, { coachComment: text.trim() ? { text, at: Date.now() } : undefined }), 400);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  if (item.owner)
    return (
      <div className="side-section coach-note">
        <h4>Comment for {pairing?.name ?? 'your athlete'}</h4>
        <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="What you see, and what to try next time" />
        <p className="tiny muted">Angles and lines you draw on this clip go back with your feedback too.</p>
      </div>
    );
  if (!item.coachComment?.text) return null;
  return (
    <div className="side-section coach-note">
      <h4>From {item.coachComment.by ?? 'your coach'}</h4>
      <p className="small">{item.coachComment.text}</p>
      <span className="tiny muted">{formatDate(item.coachComment.at)}</span>
    </div>
  );
}
