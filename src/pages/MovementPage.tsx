import { useEffect, useMemo, useRef, useState } from 'react';
import landmarks from '../anatomy/landmarks.json';
import type { LayerId } from '../anatomy/types';
import PatternPanel, { type PatternState } from '../components/movement/PatternPanel';
import TrainingPanel, { FULL_SETS } from '../components/movement/TrainingPanel';
import { Check, Seg } from '../components/common';
import Icon from '../components/Icon';
import BodyViewer, { type AxisMarker } from '../components/viewer/BodyViewer';
import { useActivities, useNotes } from '../hooks/useData';
import { bodyDims, type V3 } from '../model/bodyShape';
import { effortColor, effortColors, groupEfforts, relativeDemand, sweep } from '../movement/activation';
import { runModel, type JointId } from '../movement/biomech';
import { groupsOfStructure, groupStructures, GROUP_BY_ID, type GroupId } from '../movement/groups';
import { PATTERN_BY_ID, type PatternId } from '../movement/patterns';
import { lastLoad, summarizeTraining } from '../movement/training';
import { shapeInputFrom, useBody, useBodyMass } from '../profile/profile';
import { useUI, type CameraView, type LayerState, type Selection } from '../state/ui';

const LM = landmarks as unknown as { joints: Record<string, V3>; axes: Record<string, V3> };
const DIRS: Record<'x' | 'y' | 'z', V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

function layersFor(skeleton: boolean): Record<LayerId, LayerState> {
  return {
    skin: { visible: false, opacity: 1 },
    muscular: { visible: true, opacity: 1 },
    skeletal: { visible: skeleton, opacity: 1 },
    nerves: { visible: false, opacity: 1 },
    vascular: { visible: false, opacity: 1 },
    organs: { visible: false, opacity: 1 },
  };
}

function defaultsFor(pattern: PatternId, logged?: { load: number; variant?: string } | null): PatternState {
  const p = PATTERN_BY_ID.get(pattern)!;
  const variant = (logged?.variant && p.variants.find((v) => v.value === logged.variant)) || p.variants[0];
  const load = logged?.load ?? (variant.load === 'none' ? 0 : variant.load);
  return { pattern, variant: variant.value, options: Object.fromEntries(p.options.map((o) => [o.id, o.default])), load, phase: 0.85 };
}

const NO_PINS: never[] = [];

export default function MovementPage() {
  const ui = useUI();
  const notes = useNotes();
  const activities = useActivities();
  const { profile, values, shape } = useBody();
  const healthMass = useBodyMass();
  const [tab, setTab] = useState<'pattern' | 'training'>('pattern');
  const [sheet, setSheet] = useState<'collapsed' | 'open' | 'full'>('open');
  const [state, setStateRaw] = useState<PatternState>(() => defaultsFor((ui.movementPattern as PatternId) ?? 'squat'));
  const [joint, setJoint] = useState<JointId | null>(null);
  const [group, setGroup] = useState<GroupId | null>(null);
  const [playing, setPlaying] = useState(false);
  const [weeks, setWeeks] = useState(8);
  const [skeleton, setSkeleton] = useState(true);
  const [showDeep, setShowDeep] = useState(false);
  const [view, setView] = useState<{ view: CameraView; n: number }>({ view: 'angle', n: 1 });
  const touchedLoad = useRef(new Set<PatternId>());

  const pattern = PATTERN_BY_ID.get(state.pattern)!;
  const setState = (patch: Partial<PatternState>) =>
    setStateRaw((s) => {
      if (patch.pattern && patch.pattern !== s.pattern) {
        setJoint(null);
        setGroup(null);
        const logged = lastLoad(notes, patch.pattern);
        return { ...defaultsFor(patch.pattern, logged), phase: s.phase };
      }
      if (patch.load !== undefined) touchedLoad.current.add(s.pattern);
      if (patch.variant && patch.variant !== s.variant && !touchedLoad.current.has(s.pattern)) {
        const v = PATTERN_BY_ID.get(s.pattern)!.variants.find((x) => x.value === patch.variant);
        if (v) patch = { ...patch, load: v.load === 'none' ? 0 : v.load };
      }
      return { ...s, ...patch };
    });

  // opened from another page with a pattern in mind
  useEffect(() => {
    if (ui.movementPattern && ui.movementPattern !== state.pattern) setState({ pattern: ui.movementPattern as PatternId });
    if (ui.movementPattern) useUI.setState({ movementPattern: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.movementPattern]);

  // start from the last load you logged for this pattern
  const logged = useMemo(() => lastLoad(notes, state.pattern), [notes, state.pattern]);
  const seeded = useRef(new Set<PatternId>());
  useEffect(() => {
    if (logged && !seeded.current.has(state.pattern) && !touchedLoad.current.has(state.pattern)) {
      seeded.current.add(state.pattern);
      setStateRaw((s) => ({ ...s, load: logged.load, variant: pattern.variants.some((v) => v.value === logged.variant) ? logged.variant! : s.variant }));
    }
  }, [logged, state.pattern, pattern]);

  // play the movement back and forth
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now(), dirn = 1;
    const tick = (t: number) => {
      const dt = (t - last) / 1000;
      last = t;
      setStateRaw((s) => {
        let ph = s.phase + dirn * dt * 0.45;
        if (ph >= 1) (ph = 1), (dirn = -1);
        if (ph <= 0) (ph = 0), (dirn = 1);
        return { ...s, phase: ph };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const mass = values.weight ?? healthMass ?? 75;
  const massSource = values.weight ? 'profile' : healthMass ? 'health' : 'default';
  const dims = useMemo(() => bodyDims(shapeInputFrom(values)), [values]);
  const variant = pattern.variants.find((v) => v.value === state.variant) ?? pattern.variants[0];
  const options = useMemo(() => ({ ...state.options, variant: variant.value }), [state.options, variant.value]);
  const load = variant.load === 'none' ? 0 : state.load;
  const inp = useMemo(() => ({ dims, mass, load, options }), [dims, mass, load, options]);
  const result = useMemo(() => runModel(pattern.model, { ...inp, phase: state.phase }), [pattern.model, inp, state.phase]);
  const curves = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const { result: r } of sweep(pattern, inp, 30)) for (const j of r.joints) (out[j.id] ??= []).push(j.demand);
    return out;
  }, [pattern, inp]);
  const efforts = useMemo(() => groupEfforts(pattern, result, mass), [pattern, result, mass]);

  const summary = useMemo(() => summarizeTraining(notes, activities, { weeks }), [notes, activities, weeks]);

  // 3D colours: effort in this movement, or weekly volume per group
  const colors = useMemo(() => {
    if (tab === 'pattern') return effortColors(efforts);
    const m = new Map<string, string>();
    for (const [g, v] of Object.entries(summary.groupPerWeek)) {
      if (v < 0.25) continue;
      for (const id of groupStructures(g as GroupId)) m.set(id, effortColor(Math.min(1, v / FULL_SETS)));
    }
    return m;
  }, [tab, efforts, summary]);
  const highlight = useMemo(() => new Set(group ? groupStructures(group) : []), [group]);

  // joint axes on the body, coloured by how hard each joint works
  const axes = useMemo<AxisMarker[]>(() => {
    if (tab !== 'pattern') return [];
    const out: AxisMarker[] = [];
    for (const a of pattern.axes) {
      const j = result.joints.find((x) => x.id === a.joint);
      if (!j) continue;
      const rel = relativeDemand(j, mass, j.demand >= 0 ? 1 : -1);
      a.at.forEach((name, i) => {
        const center = (shape?.joints[name] ?? LM.joints[name]) as V3;
        const dir = a.joint === 'ankle' && a.dir === 'x' && LM.axes[name] ? LM.axes[name] : DIRS[a.dir];
        out.push({
          id: `${a.joint}:${name}`,
          center,
          dir,
          length: a.joint === 'lumbar' || a.joint.startsWith('spine') ? 0.2 : 0.15,
          color: effortColor(rel),
          label: i === 0 ? j.label : undefined,
          detail: i === 0 ? `${Math.round(Math.abs(j.demand))} N·m · lever ${Math.round(Math.abs(j.arm) * 100)} cm` : undefined,
        });
      });
    }
    return out;
  }, [tab, pattern, result, mass, shape]);

  const onPick = (sel: Selection) => {
    const gs = groupsOfStructure(sel.structureId);
    const inPattern = tab === 'pattern' ? gs.find((g) => pattern.groups.some((t) => t.group === g)) : gs[0];
    if (inPattern) setGroup(inPattern);
    else if (gs[0]) ui.showToast(`${GROUP_BY_ID.get(gs[0])!.name} isn’t a main group in the ${pattern.name.toLowerCase()}`);
  };

  const dimsNote = values.height ? `Your proportions (${Math.round(dims.height * 100)} cm)` : 'Reference proportions (add your height in Profile)';

  return (
    <div className="atlas movement">
      <div className="atlas-stage">
        <BodyViewer
          layers={layersFor(skeleton)}
          showDeep={showDeep}
          colorMode="feeling"
          colors={colors}
          selection={null}
          pins={NO_PINS}
          onPick={onPick}
          viewRequest={view}
          highlight={highlight}
          shape={profile.applyToModel ? shape : null}
          neutral={{ muscular: '#5b5358' }}
          axes={axes}
          selectedAxis={joint}
          onAxisClick={(id) => setJoint((j) => (j === id.split(':')[0] ? null : (id.split(':')[0] as JointId)))}
        />
        <div className="overlay movement-tools">
          <div className="row between small">
            <span className="dim">Skeleton</span>
            <Check on={skeleton} onChange={setSkeleton} label="Show skeleton" />
          </div>
          <div className="row between small">
            <span className="dim">Deep muscles</span>
            <Check on={showDeep} onChange={setShowDeep} label="Show deep muscles" />
          </div>
          <div className="legend">
            <span>{tab === 'pattern' ? 'Rest' : '0'}</span>
            <span className="legend-bar effort" />
            <span>{tab === 'pattern' ? 'Max' : `${FULL_SETS}+`}</span>
          </div>
          {tab === 'pattern' && <p className="tiny muted">Tap an axis or a muscle.</p>}
        </div>
        <div className="overlay view-buttons" role="group" aria-label="Camera view">
          {(['angle', 'front', 'back', 'left', 'right'] as const).map((v) => (
            <button key={v} onClick={() => setView((x) => ({ view: v, n: x.n + 1 }))}>
              {v === 'angle' ? '¾' : v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>
      <aside className={`side ${sheet === 'collapsed' ? 'collapsed' : sheet === 'full' ? 'full' : ''}`}>
        <button className="sheet-handle" aria-label={sheet === 'collapsed' ? 'Expand panel' : 'Collapse panel'} onClick={() => setSheet((s) => (s === 'collapsed' ? 'open' : 'collapsed'))} />
        <div className="side-section side-tabs">
          <Seg
            value={tab}
            onChange={(t) => {
              setTab(t);
              setGroup(null);
            }}
            label="Movement view"
            options={[
              { value: 'pattern', label: <><Icon name="axis" size={15} /> Pattern & leverage</> },
              { value: 'training', label: <><Icon name="chart" size={15} /> My training</> },
            ]}
          />
        </div>
        {tab === 'pattern' ? (
          <PatternPanel
            state={state}
            setState={setState}
            pattern={pattern}
            result={result}
            curves={curves}
            efforts={efforts}
            mass={mass}
            massSource={massSource}
            dimsNote={dimsNote}
            units={profile.units}
            lastLogged={logged}
            selectedJoint={joint}
            onSelectJoint={setJoint}
            selectedGroup={group}
            onSelectGroup={setGroup}
            playing={playing}
            onPlay={setPlaying}
          />
        ) : (
          <TrainingPanel
            summary={summary}
            weeks={weeks}
            setWeeks={setWeeks}
            onOpenPattern={(p) => {
              setTab('pattern');
              setState({ pattern: p });
            }}
            selectedGroup={group}
            onSelectGroup={setGroup}
          />
        )}
      </aside>
    </div>
  );
}
