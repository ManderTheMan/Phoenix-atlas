import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Color, InstancedMesh, Matrix4, Mesh, Quaternion, Raycaster, Vector2, Vector3, type PerspectiveCamera } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { STRUCTURE_BY_ID } from '../../anatomy/catalog';
import { LAYER_BY_ID, type LayerId } from '../../anatomy/types';
import type { Vec3 } from '../../db/db';
import { feelingColor } from '../../lib/feeling';
import { LAYER_IDS, layerBVH, loadLayer, raycastLayer, type LayerHit, type LayerModel } from '../../model/atlasModel';
import { createLayerMaterial } from '../../model/layerMaterial';
import type { CameraView, ColorMode, LayerState, Selection } from '../../state/ui';

export interface Pin {
  id: string; // note id
  structureId: string;
  point: Vec3;
  normal?: Vec3;
  feeling: number;
}

export interface BodyViewerProps {
  layers: Record<LayerId, LayerState>;
  showDeep: boolean;
  colorMode: ColorMode;
  /** Colour override per structure id. */
  colors: Map<string, string>;
  selection: Selection | null;
  pins: Pin[];
  onPick?: (sel: Selection) => void;
  onPinClick?: (noteId: string) => void;
  viewRequest?: { view: CameraView; n: number } | null;
  /** Structure ids to emphasise (e.g. locations of the note being edited). */
  highlight?: Set<string>;
}

const RENDER_ORDER: Record<LayerId, number> = { organs: 1, skeletal: 2, vascular: 3, nerves: 3, muscular: 4, skin: 5 };
/** Below this opacity a layer becomes a "ghost": visible but taps pass through it. */
export const GHOST_OPACITY = 0.35;
/** Layers made of thin strands, picked with extra rays around the tap so they are easy to hit. */
const THIN: LayerId[] = ['nerves', 'vascular'];
/** The camera looks a little below the middle so the feet clear the timeline bar. */
const VIEW_TARGET = new Vector3(0, 0.74, 0.05);
const TAP_PX = 8;

/** With "deep" muscles selected, superficial muscles are peeled away. */
export function structureShown(id: string, showDeep: boolean): boolean {
  const def = STRUCTURE_BY_ID.get(id);
  return !!def && !(showDeep && def.layer === 'muscular' && !def.deep);
}

/** Loads the visible layers on demand; returns the ones that are ready. */
function useLayerModels(wanted: LayerId[]) {
  const [models, setModels] = useState<Partial<Record<LayerId, LayerModel>>>({});
  const [error, setError] = useState<string | null>(null);
  const key = wanted.join(',');
  useEffect(() => {
    let alive = true;
    for (const id of wanted) {
      loadLayer(id)
        .then((m) => {
          if (!alive) return;
          setModels((s) => (s[id] ? s : { ...s, [id]: m }));
          // build the picking structure while the user is still looking
          const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 200));
          idle(() => layerBVH(m));
        })
        .catch((e) => alive && setError(String(e?.message ?? e)));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return { models, error };
}

function LayerMesh({
  model,
  state,
  showDeep,
  colorMode,
  colors,
  highlight,
  selectedId,
  hoveredId,
}: {
  model: LayerModel;
  state: LayerState;
  showDeep: boolean;
  colorMode: ColorMode;
  colors: Map<string, string>;
  highlight?: Set<string>;
  selectedId: string | null;
  hoveredId: string | null;
}) {
  const lm = useMemo(() => createLayerMaterial(model.layer, model.ids.length), [model]);
  useEffect(() => () => lm.dispose(), [lm]);

  useEffect(() => {
    const anatomy = colorMode === 'anatomy';
    lm.setStates(model.ids.length, (i) => {
      const id = model.ids[i];
      return {
        visible: structureShown(id, showDeep),
        color: anatomy ? undefined : colors.get(id),
        emphasis: highlight?.has(id),
      };
    });
    lm.uniforms.uAnatomy.value = anatomy ? 1 : 0;
    lm.uniforms.uNeutral.value.set(LAYER_BY_ID[model.layer].color);
  }, [lm, model, showDeep, colorMode, colors, highlight]);

  useEffect(() => lm.setOpacity(state.opacity), [lm, state.opacity]);
  lm.uniforms.uSelected.value = selectedId ? (model.indexOf.get(selectedId) ?? -1) : -1;
  lm.uniforms.uHovered.value = hoveredId ? (model.indexOf.get(hoveredId) ?? -1) : -1;

  return (
    <mesh
      geometry={model.geometry}
      material={lm.material}
      renderOrder={RENDER_ORDER[model.layer] + (state.opacity < 0.999 ? 10 : 0)}
      raycast={() => null}
      frustumCulled={false}
    />
  );
}

const _m = new Matrix4();
const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _p = new Vector3();
const _n = new Vector3();
const _s = new Vector3();
const _c = new Color();
const PIN_RADIUS = 0.0075;

function Pins({ pins }: { pins: Pin[] }) {
  const ref = useRef<InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    pins.forEach((p, i) => {
      _n.set(...(p.normal ?? [0, 0, 1])).normalize();
      _p.set(...p.point).addScaledVector(_n, 0.004);
      _q.setFromUnitVectors(_up, _n);
      _s.setScalar(1);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.set(feelingColor(p.feeling)));
    });
    mesh.count = pins.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [pins]);
  if (!pins.length) return null;
  return (
    <instancedMesh key={pins.length} ref={ref} args={[undefined, undefined, Math.max(1, pins.length)]} renderOrder={30} raycast={() => null}>
      <sphereGeometry args={[PIN_RADIUS, 14, 10]} />
      <meshStandardMaterial roughness={0.3} emissive="#ffffff" emissiveIntensity={0.15} />
    </instancedMesh>
  );
}

function SelectionMarker({ selection }: { selection: Selection | null }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.setScalar(1 + 0.25 * Math.sin(clock.elapsedTime * 4));
  });
  if (!selection?.point) return null;
  const n = new Vector3(...(selection.normal ?? [0, 0, 1])).normalize();
  const p = new Vector3(...selection.point).addScaledVector(n, 0.002);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n);
  return (
    <group position={p} quaternion={q}>
      <mesh ref={ref} renderOrder={40}>
        <ringGeometry args={[0.007, 0.0105, 32]} />
        <meshBasicMaterial color="#ff8a4c" depthTest={false} transparent opacity={0.95} />
      </mesh>
      <mesh renderOrder={41}>
        <circleGeometry args={[0.003, 20]} />
        <meshBasicMaterial color="#fff2e8" depthTest={false} transparent />
      </mesh>
    </group>
  );
}

/**
 * Tap and hover picking. Taps are told apart from drags (which orbit the camera)
 * by how far the pointer moved. Every visible, non-ghosted layer is ray cast
 * through its BVH and the nearest visible structure wins; nerves and vessels
 * also get a ring of extra rays so a near miss still selects them.
 */
function Picker({
  models,
  layers,
  showDeep,
  pins,
  onPick,
  onPinClick,
  onHover,
}: {
  models: Partial<Record<LayerId, LayerModel>>;
  layers: Record<LayerId, LayerState>;
  showDeep: boolean;
  pins: Pin[];
  onPick?: (sel: Selection) => void;
  onPinClick?: (noteId: string) => void;
  onHover: (h: { id: string; x: number; y: number } | null) => void;
}) {
  const { gl, camera } = useThree();
  const latest = useRef({ models, layers, showDeep, pins, onPick, onPinClick, onHover });
  latest.current = { models, layers, showDeep, pins, onPick, onPinClick, onHover };

  useEffect(() => {
    const el = gl.domElement;
    const raycaster = new Raycaster();
    const ndc = new Vector2();
    const pointers = new Map<number, { x: number; y: number; t: number }>();
    let multi = false;
    let hoverFrame = 0;

    const rayAt = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      return raycaster.ray.clone();
    };

    const castAt = (x: number, y: number, only?: LayerId[]): LayerHit | null => {
      const { models, layers, showDeep } = latest.current;
      const ray = rayAt(x, y);
      let best: LayerHit | null = null;
      for (const id of only ?? LAYER_IDS) {
        const m = models[id];
        const ls = layers[id];
        if (!m || !ls.visible || ls.opacity < GHOST_OPACITY) continue;
        const hit = raycastLayer(m, ray, (i) => structureShown(m.ids[i], showDeep), best?.distance ?? Infinity);
        if (hit && (!best || hit.distance < best.distance)) best = hit;
      }
      return best;
    };

    const pick = (x: number, y: number, touch: boolean) => {
      const { pins, onPick, onPinClick } = latest.current;
      let best = castAt(x, y);
      // nerves and vessels are only a few millimetres wide: accept a near miss
      // as long as the strand is not hidden behind the surface that was hit
      const radius = touch ? 16 : 7;
      let ringBest: LayerHit | null = null;
      if (!best || !THIN.includes(best.layer)) {
        for (const k of [0.5, 1])
          for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * Math.PI * 2 + k;
            const hit = castAt(x + Math.cos(ang) * radius * k, y + Math.sin(ang) * radius * k, THIN);
            if (hit && THIN.includes(hit.layer) && (!best || hit.distance <= best.distance + 0.004) && (!ringBest || hit.distance < ringBest.distance))
              ringBest = hit;
          }
        if (ringBest) best = ringBest;
      }
      // note pins
      const ray = rayAt(x, y);
      const tol = (touch ? 2.2 : 1.4) * PIN_RADIUS;
      let pinHit: { id: string; d: number } | null = null;
      for (const p of pins) {
        _p.set(...p.point);
        const d = ray.origin.distanceTo(_p);
        if (ray.distanceSqToPoint(_p) < tol * tol && (!best || d < best.distance + 0.012) && (!pinHit || d < pinHit.d)) pinHit = { id: p.id, d };
      }
      if (pinHit) return onPinClick?.(pinHit.id);
      if (!best) return;
      onPick?.({
        structureId: best.structureId,
        point: [best.point.x, best.point.y, best.point.z],
        normal: [best.normal.x, best.normal.y, best.normal.z],
      });
    };

    const down = (e: PointerEvent) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now() });
      if (pointers.size > 1) multi = true;
      latest.current.onHover(null);
    };
    const up = (e: PointerEvent) => {
      const d = pointers.get(e.pointerId);
      pointers.delete(e.pointerId);
      if (!d) return;
      const wasMulti = multi;
      if (pointers.size === 0) multi = false;
      if (wasMulti || Math.hypot(e.clientX - d.x, e.clientY - d.y) > TAP_PX || performance.now() - d.t > 800) return;
      pick(e.clientX, e.clientY, e.pointerType !== 'mouse');
    };
    const cancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) multi = false;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      const { clientX: x, clientY: y } = e;
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => {
        const hit = castAt(x, y);
        const r = el.getBoundingClientRect();
        latest.current.onHover(hit ? { id: hit.structureId, x: x - r.left, y: y - r.top } : null);
      });
    };
    const leave = () => {
      cancelAnimationFrame(hoverFrame);
      latest.current.onHover(null);
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    return () => {
      cancelAnimationFrame(hoverFrame);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    };
  }, [gl, camera]);
  return null;
}

const VIEW_DIRS: Record<CameraView, Vector3> = {
  front: new Vector3(0, 0.05, 1),
  back: new Vector3(0, 0.05, -1),
  left: new Vector3(1, 0.05, 0),
  right: new Vector3(-1, 0.05, 0),
};

function CameraRig({ viewRequest }: { viewRequest?: { view: CameraView; n: number } | null }) {
  const { camera, controls } = useThree() as unknown as { camera: PerspectiveCamera; controls: OrbitControlsImpl | null };
  const anim = useRef<{ from: Vector3; to: Vector3; t: number; tf: Vector3; tt: Vector3 } | null>(null);
  useEffect(() => {
    if (!viewRequest || !controls) return;
    const dist = Math.max(1.6, camera.position.distanceTo(controls.target));
    anim.current = {
      from: camera.position.clone(),
      to: VIEW_TARGET.clone().addScaledVector(VIEW_DIRS[viewRequest.view].clone().normalize(), dist),
      t: 0,
      tf: controls.target.clone(),
      tt: VIEW_TARGET.clone(),
    };
  }, [viewRequest, camera, controls]);
  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.t = Math.min(1, a.t + dt * 2.2);
    const k = 1 - (1 - a.t) ** 3;
    // swing around the target instead of passing through the body
    const fromDir = a.from.clone().sub(a.tf);
    const toDir = a.to.clone().sub(a.tt);
    const len = fromDir.length() + (toDir.length() - fromDir.length()) * k;
    const dir = fromDir.normalize().lerp(toDir.normalize(), k);
    if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
    controls.target.lerpVectors(a.tf, a.tt, k);
    camera.position.copy(controls.target).addScaledVector(dir.normalize(), len);
    controls.update();
    if (a.t >= 1) anim.current = null;
  });
  return null;
}

export default function BodyViewer(props: BodyViewerProps) {
  const { layers, showDeep, colorMode, colors, selection, pins, onPick, onPinClick, viewRequest, highlight } = props;
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const wanted = useMemo(() => LAYER_IDS.filter((id) => layers[id].visible), [layers]);
  const { models, error } = useLayerModels(wanted);
  const loading = wanted.filter((id) => !models[id]);

  const visiblePins = useMemo(
    () =>
      pins.filter((p) => {
        const def = STRUCTURE_BY_ID.get(p.structureId);
        return def && layers[def.layer].visible && structureShown(def.id, showDeep);
      }),
    [pins, layers, showDeep],
  );

  const hoverName = hover ? STRUCTURE_BY_ID.get(hover.id)?.name : null;
  const selectedId = selection?.structureId ?? null;

  return (
    <div className="viewer">
      <Canvas
        camera={{ position: [0.18, 0.93, 4.1], fov: 32, near: 0.02, far: 30 }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
      >
        <color attach="background" args={['#0d1016']} />
        <hemisphereLight args={['#dfe7ff', '#2a1d18', 0.85]} />
        <directionalLight position={[1.5, 3, 2.5]} intensity={1.7} />
        <directionalLight position={[-2, 1.5, -2]} intensity={0.75} color="#ffd2b0" />
        <directionalLight position={[0, -1, 2]} intensity={0.25} color="#9ab8ff" />
        <group>
          {wanted.map((id) => {
            const m = models[id];
            return m ? (
              <LayerMesh
                key={id}
                model={m}
                state={layers[id]}
                showDeep={showDeep}
                colorMode={colorMode}
                colors={colors}
                highlight={highlight}
                selectedId={selectedId}
                hoveredId={hover?.id ?? null}
              />
            ) : null;
          })}
          <Pins pins={visiblePins} />
          <SelectionMarker selection={selection} />
        </group>
        <OrbitControls
          makeDefault
          target={VIEW_TARGET}
          enableDamping
          dampingFactor={0.12}
          minDistance={0.25}
          maxDistance={6}
          screenSpacePanning
          zoomSpeed={0.9}
        />
        <CameraRig viewRequest={viewRequest} />
        <Picker models={models} layers={layers} showDeep={showDeep} pins={visiblePins} onPick={onPick} onPinClick={onPinClick} onHover={setHover} />
      </Canvas>
      {hover && hoverName && (
        <div className="viewer-tip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
          {hoverName}
        </div>
      )}
      {(loading.length > 0 || error) && (
        <div className="viewer-status" role="status">
          {error ? (
            <span>Couldn’t load the body model: {error}</span>
          ) : (
            <>
              <span className="spinner small" /> Loading {loading.map((id) => LAYER_BY_ID[id].name.toLowerCase()).join(', ')}…
            </>
          )}
        </div>
      )}
    </div>
  );
}
