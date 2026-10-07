import { useMemo } from 'react';
import { STRUCTURE_BY_ID } from '../../anatomy/catalog';
import { LAYER_BY_ID } from '../../anatomy/types';
import type { StructureStatus } from '../../analysis/status';
import type { Note } from '../../db/db';
import { emptyDraft } from '../../db/notes';
import { relativeDay } from '../../lib/dates';
import { feelingColor, formatFeeling } from '../../lib/feeling';
import { useUI, type Selection } from '../../state/ui';
import LineChart from '../charts/LineChart';
import { FeelBadge } from '../common';
import Icon from '../Icon';
import NoteCard from '../notes/NoteCard';

export function TrendText({ slope }: { slope: number | null }) {
  if (slope === null) return <span className="muted">Not enough data for a trend</span>;
  if (Math.abs(slope) < 0.15) return <span className="dim">Stable</span>;
  return slope > 0 ? (
    <span className="trend-up">Improving {formatFeeling(slope)}/wk</span>
  ) : (
    <span className="trend-down">Worsening {formatFeeling(slope)}/wk</span>
  );
}

export default function StructurePanel({
  selection,
  notes,
  status,
}: {
  selection: Selection;
  notes: Note[];
  status?: StructureStatus;
}) {
  const ui = useUI();
  const def = STRUCTURE_BY_ID.get(selection.structureId);
  const mine = useMemo(() => notes.filter((n) => n.structureIds.includes(selection.structureId)), [notes, selection.structureId]);
  if (!def) return null;
  const layer = LAYER_BY_ID[def.layer];

  const addNote = () =>
    ui.setDraft(
      emptyDraft({
        locations: [{ structureId: def.id, point: selection.point, normal: selection.normal }],
        category: def.layer === 'organs' ? 'health' : 'symptom',
      }),
    );

  return (
    <>
      <div className="side-section">
        <div className="side-head">
          <div className="side-title">
            <span className="crumb">
              <span className="feel-dot" style={{ background: layer.anatomyColor, width: 8, height: 8, marginRight: 6 }} />
              {layer.name} · {def.group}
              {def.deep ? ' · deep' : ''}
            </span>
            <h2>{def.name}</h2>
          </div>
          <button className="btn ghost icon" onClick={() => ui.set({ selection: null })} aria-label="Clear selection">
            <Icon name="x" />
          </button>
        </div>
        {def.info && <p className="dim small">{def.info}</p>}
        <button className="btn primary block" onClick={addNote}>
          <Icon name="plus" /> Log how it feels here
        </button>
      </div>

      <div className="side-section">
        <div className="row between">
          <h4>Status</h4>
          <span className="tiny muted">{ui.windowDays ? `last ${ui.windowDays} days` : 'all time'}</span>
        </div>
        {status ? (
          <div className="grid two" style={{ gap: 10 }}>
            <div className="stat">
              <div className="k">Feeling</div>
              <div className="row" style={{ gap: 6, marginTop: 2 }}>
                <FeelBadge value={status.score} />
              </div>
            </div>
            <div className="stat">
              <div className="k">Trend</div>
              <div className="small" style={{ marginTop: 4 }}>
                <TrendText slope={status.slopePerWeek} />
              </div>
            </div>
            <div className="stat">
              <div className="k">Notes</div>
              <div className="small" style={{ marginTop: 4 }}>{status.count} in window</div>
            </div>
            <div className="stat">
              <div className="k">Last logged</div>
              <div className="small" style={{ marginTop: 4 }}>{relativeDay(status.lastDate)}</div>
            </div>
          </div>
        ) : (
          <p className="dim small">{mine.length ? 'No notes in this time window.' : 'Nothing logged here yet.'}</p>
        )}
        {mine.length > 1 && (
          <LineChart
            ariaLabel={`Feeling over time for ${def.name}`}
            height={120}
            yDomain={[-5, 5]}
            yTicks={[-5, 0, 5]}
            zeroLine
            formatY={(y) => formatFeeling(y)}
            series={[
              {
                id: 'f',
                label: 'Feeling',
                color: '#8a94a8',
                points: mine.map((n) => ({ x: n.date, y: n.feeling, color: feelingColor(n.feeling), id: n.id })),
              },
            ]}
            onPointClick={(p) => p.id && ui.openNote(p.id)}
          />
        )}
      </div>

      <div className="side-section">
        <div className="row between">
          <h4>Notes here ({mine.length})</h4>
          {mine.length > 0 && (
            <button className="btn ghost small" onClick={() => ui.showJournal({ structureId: def.id })}>
              Open in journal <Icon name="arrowRight" size={14} />
            </button>
          )}
        </div>
        <div className="note-list">
          {mine.slice(0, 20).map((n) => (
            <NoteCard key={n.id} note={n} onOpen={ui.openNote} compact />
          ))}
        </div>
      </div>
    </>
  );
}
