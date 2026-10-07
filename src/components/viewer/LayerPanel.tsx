import { useState } from 'react';
import { LAYERS } from '../../anatomy/types';
import { useUI, type ColorMode } from '../../state/ui';
import { Check, Seg } from '../common';
import Icon from '../Icon';
import { GHOST_OPACITY } from './BodyViewer';

const MODES: { value: ColorMode; label: string; title: string }[] = [
  { value: 'feeling', label: 'Feeling', title: 'Colour by how each part feels (recent notes weigh more)' },
  { value: 'trend', label: 'Trend', title: 'Blue = improving, red = getting worse over the window' },
  { value: 'activity', label: 'Activity', title: 'How much you have logged for each part' },
  { value: 'anatomy', label: 'Anatomy', title: 'Natural anatomical colours' },
];

export default function LayerPanel() {
  const ui = useUI();
  const [open, setOpen] = useState(() => (typeof window !== 'undefined' ? window.innerWidth > 820 : true));
  if (!open) {
    return (
      <div className="overlay layer-panel collapsed">
        <button className="btn ghost small" onClick={() => setOpen(true)} aria-label="Show layers">
          <Icon name="layers" /> Layers
        </button>
      </div>
    );
  }
  return (
    <div className="overlay layer-panel">
      <div className="row between" style={{ padding: '0 2px 4px' }}>
        <h4>Layers</h4>
        <button className="btn ghost icon small" onClick={() => setOpen(false)} aria-label="Hide layer panel">
          <Icon name="chevronUp" size={15} />
        </button>
      </div>
      {LAYERS.map((l) => {
        const st = ui.layers[l.id];
        return (
          <div key={l.id} className={`layer-row ${st.visible ? '' : 'off'}`}>
            <Check on={st.visible} onChange={(v) => ui.setLayer(l.id, { visible: v })} label={`Show ${l.name}`} />
            <button className="name" onClick={() => ui.soloLayer(l.id)} title="Show only this layer">
              {l.name}
            </button>
            <span className="swatch" style={{ background: l.anatomyColor, opacity: st.visible ? 1 : 0.35 }} />
            {st.visible && (
              <input
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={st.opacity}
                onChange={(e) => ui.setLayer(l.id, { opacity: Number(e.target.value) })}
                aria-label={`${l.name} opacity`}
                title={st.opacity < GHOST_OPACITY ? 'Ghosted: taps pass through this layer' : 'Opacity'}
              />
            )}
          </div>
        );
      })}
      <hr className="sep" />
      <div className="col" style={{ gap: 8, padding: '4px 2px' }}>
        <div className="row between small">
          <span className="dim">Muscles</span>
          <Seg
            value={ui.showDeep ? 'deep' : 'superficial'}
            onChange={(v) => ui.set({ showDeep: v === 'deep' })}
            options={[
              { value: 'superficial', label: 'Surface' },
              { value: 'deep', label: 'Deep' },
            ]}
            label="Muscle depth"
          />
        </div>
        <div className="row between small">
          <span className="dim">Note pins</span>
          <Check on={ui.showPins} onChange={(v) => ui.set({ showPins: v })} label="Show note pins" />
        </div>
        <div className="col" style={{ gap: 6 }}>
          <span className="dim small">Colour by</span>
          <div className="chips">
            {MODES.map((m) => (
              <button key={m.value} className={`chip ${ui.colorMode === m.value ? 'on' : ''}`} title={m.title} onClick={() => ui.set({ colorMode: m.value })}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <p className="tiny muted">Lower a layer’s opacity to see and tap what’s underneath.</p>
      </div>
    </div>
  );
}
