import type { Note } from '../../db/db';
import { formatDateTime, formatShort } from '../../lib/dates';
import { SENSATION_BY_ID, feelingColor } from '../../lib/feeling';
import { CategoryLabel, FeelBadge } from '../common';
import Icon from '../Icon';
import { locationSummary } from './NoteEditor';

export default function NoteCard({ note, onOpen, compact, showDate = 'time' }: { note: Note; onOpen: (id: string) => void; compact?: boolean; showDate?: 'time' | 'date' }) {
  return (
    <button
      className={`note-card ${compact ? 'compact' : ''}`}
      style={{ ['--feel' as string]: feelingColor(note.feeling) }}
      onClick={() => onOpen(note.id)}
    >
      <div className="meta">
        <CategoryLabel id={note.category} />
        <span>·</span>
        <span>{showDate === 'date' ? formatShort(note.date) : formatDateTime(note.date)}</span>
        <div className="grow" />
        {note.private && <Icon name="lock" size={13} />}
        {note.links.length > 0 && (
          <span className="row" style={{ gap: 3 }} title={`${note.links.length} linked`}>
            <Icon name="link" size={13} /> {note.links.length}
          </span>
        )}
        <FeelBadge value={note.feeling} label={false} />
      </div>
      <div className="title ellipsis">{note.title || locationSummary(note)}</div>
      {!compact && (
        <div className="meta">
          <Icon name="pin" size={12} />
          <span className="ellipsis">{locationSummary(note)}</span>
          {note.sensations.slice(0, 3).map((s) => (
            <span key={s} className="chip" style={{ padding: '0 7px', fontSize: 11.5 }}>
              {SENSATION_BY_ID.get(s)?.label ?? s}
            </span>
          ))}
        </div>
      )}
      {!compact && note.body && <div className="body">{note.body}</div>}
      {note.tags.length > 0 && (
        <div className="chips">
          {note.tags.slice(0, compact ? 3 : 6).map((t) => (
            <span key={t} className="chip tag" style={{ padding: '0 7px', fontSize: 11.5 }}>
              {t}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}
