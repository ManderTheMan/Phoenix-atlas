import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { STRUCTURE_BY_ID, STRUCTURES } from '../../anatomy/catalog';
import { SURFACE_REGIONS, surfaceRegionAt } from '../../anatomy/skin';
import type { LayerId, StructureDef } from '../../anatomy/types';
import { baseColor } from '../../analysis/colors';
import type { Vec3 } from '../../db/db';
import { feelingColor, hexRgb } from '../../lib/feeling';
import type { AtlasModel } from '../../model/atlasModel';
import type { CameraView, ColorMode, LayerState, Selection } from '../../state/ui';

export interface Pin {
  id: string; // note id
  structureId: string;
  point: Vec3;
  normal?: Vec3;
  feeling: number;
}

export interface BodyViewerProps {
  model: AtlasModel;
  layers: Record<LayerId, LayerState>;
  showDeep: boolean;
  colorMode: ColorMode;
  /** Colour override per structure id (and per skin region id). */
  colors: Map<string, string>;
  selection: Selection | null;
  pins: Pin[];
  onPick?: (sel: Selection) => void;
  onPinClick?: (noteId: string) => void;
  viewRequest?: { view: CameraView; n: number } | null;
  /** Structure ids to emphasise (e.g. locations of the note being edited). */
  highlight?: Set<string>;
  initialCamera?: { position: Vec3; target: Vec3 };
}

const RENDER_ORDER: Record<LayerId, number> = { organs: 1, skeletal: 2, nerves: 3, muscular: 4, skin: 5 };
/** Below this opacity a layer becomes a "ghost": visible but taps pass through it. */
export const GHOST_OPACITY = 0.35;
const TARGET = new Vector3(0, 0.84, 0);

function isTap(e: ThreeEvent<MouseEvent>) {
  return e.delta < 8;
}

const StructureMesh = memo(function StructureMesh({
  def,
  geometry,
  hitGeometry,
  color,
  opacity,
  pickable,
  selected,
  emphasised,
  hovered,
  onPick,
  onHover,
}: {
  def: StructureDef;
  geometry: BufferGeometry;
  hitGeometry?: BufferGeometry;
  color: string;
  opacity: number;
  pickable: boolean;
  selected: boolean;
  emphasised: boolean;
  hovered: boolean;
  onPick?: (sel: Selection) => void;
  onHover: (id: string | null, e?: ThreeEvent<PointerEvent>) => void;
}) {
  const transparent = opacity < 0.999;
  const handlers = pickable
    ? {
        onClick: (e: ThreeEvent<MouseEvent>) => {
          if (!isTap(e)) return;
          e.stopPropagation();
          const n = e.face?.normal?.clone().transformDirection(e.object.matrixWorld);
          onPick?.({
            structureId: def.id,
            point: [e.point.x, e.point.y, e.point.z],
            normal: n ? [n.x, n.y, n.z] : undefined,
          });
        },
        onPointerMove: (e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation();
          onHover(def.id, e);
        },
        onPointerOut: () => onHover(null),
      }
    : {};
  const emissive = selected ? '#ff7a3d' : emphasised ? '#ffb347' : hovered ? '#ffffff' : '#000000';
  const emissiveIntensity = selected ? 0.42 : emphasised ? 0.3 : hovered ? 0.12 : 0;
  return (
    <group>
      <mesh
        geometry={geometry}
        renderOrder={RENDER_ORDER[def.layer] + (transparent ? 10 : 0)}
        raycast={pickable && !hitGeometry ? Mesh.prototype.raycast : () => null}
        {...(hitGeometry ? {} : handlers)}
      >
        <meshStandardMaterial
          color={color}
          roughness={def.layer === 'skeletal' ? 0.55 : def.layer === 'nerves' ? 0.35 : 0.62}
          metalness={0}
          transparent={transparent}
          opacity={opacity}
          depthWrite={!transparent}
          emissive={emissive}
          emissiveIntensity={emissiveIntensity}
        />
      </mesh>
      {hitGeometry && pickable && (
        <mesh geometry={hitGeometry} {...handlers}>
          <meshBasicMaterial colorWrite={false} depthWrite={false} transparent opacity={0} />
        </mesh>
      )}
    </group>
  );
});

function SkinMesh({
  model,
  colors,
  colorMode,
  opacity,
  pickable,
  selectedRegion,
  onPick,
  onHover,
}: {
  model: AtlasModel;
  colors: Map<string, string>;
  colorMode: ColorMode;
  opacity: number;
  pickable: boolean;
  selectedRegion: string | null;
  onPick?: (sel: Selection) => void;
  onHover: (id: string | null, e?: ThreeEvent<PointerEvent>) => void;
}) {
  const base = model.geometries.get('skin')!;
  const geometry = useMemo(() => {
    const g = new BufferGeometry();
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('normal', base.getAttribute('normal'));
    g.setIndex(base.getIndex());
    g.setAttribute('color', new BufferAttribute(new Float32Array(base.getAttribute('position').count * 3), 3));
    g.boundingSphere = base.boundingSphere;
    g.boundingBox = base.boundingBox;
    return g;
  }, [base]);

  useEffect(() => {
    const regions = model.skinRegions;
    const attr = geometry.getAttribute('color') as BufferAttribute;
    const arr = attr.array as Float32Array;
    const baseRgb = hexRgb(baseColor('skin', colorMode));
    const regionRgb = SURFACE_REGIONS.map((r) => {
      const c = colors.get(r.id);
      const rgb = c ? hexRgb(c) : baseRgb;
      const lift = r.id === selectedRegion ? 1.25 : 1;
      return rgb.map((v) => Math.min(1, ((v / 255) ** 2.2) * lift));
    });
    for (let v = 0; v < attr.count; v++) {
      const rgb = regionRgb[regions ? regions[v] : 0];
      arr[v * 3] = rgb[0];
      arr[v * 3 + 1] = rgb[1];
      arr[v * 3 + 2] = rgb[2];
    }
    attr.needsUpdate = true;
  }, [geometry, colors, colorMode, model.skinRegions, selectedRegion]);

  const transparent = opacity < 0.999;
  return (
    <mesh
      geometry={geometry}
      renderOrder={RENDER_ORDER.skin + (transparent ? 10 : 0)}
      raycast={pickable ? Mesh.prototype.raycast : () => null}
      onClick={
        pickable
          ? (e) => {
              if (!isTap(e)) return;
              e.stopPropagation();
              const p = e.point;
              const n = e.face?.normal?.clone().transformDirection(e.object.matrixWorld);
              onPick?.({ structureId: surfaceRegionAt(p.x, p.y, p.z), point: [p.x, p.y, p.z], normal: n ? [n.x, n.y, n.z] : undefined });
            }
          : undefined
      }
      onPointerMove={
        pickable
          ? (e) => {
              e.stopPropagation();
              onHover(surfaceRegionAt(e.point.x, e.point.y, e.point.z), e);
            }
          : undefined
      }
      onPointerOut={pickable ? () => onHover(null) : undefined}
    >
      <meshStandardMaterial
        vertexColors
        roughness={0.7}
        metalness={0}
        transparent={transparent}
        opacity={opacity}
        depthWrite={!transparent}
        side={transparent ? DoubleSide : undefined}
      />
    </mesh>
  );
}

const _m = new Matrix4();
const _q = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _p = new Vector3();
const _n = new Vector3();
const _s = new Vector3();
const _c = new Color();

function Pins({ pins, onPinClick }: { pins: Pin[]; onPinClick?: (id: string) => void }) {
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
    <instancedMesh
      key={pins.length}
      ref={ref}
      args={[undefined, undefined, Math.max(1, pins.length)]}
      renderOrder={30}
      onClick={(e) => {
        if (!isTap(e) || e.instanceId === undefined) return;
        e.stopPropagation();
        onPinClick?.(pins[e.instanceId].id);
      }}
    >
      <sphereGeometry args={[0.0075, 14, 10]} />
      <meshStandardMaterial roughness={0.3} emissive="#ffffff" emissiveIntensity={0.15} />
    </instancedMesh>
  );
}

function SelectionMarker({ selection }: { selection: Selection | null }) {
  const ref = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const s = 1 + 0.25 * Math.sin(clock.elapsedTime * 4);
      ref.current.scale.setScalar(s);
    }
  });
  if (!selection?.point) return null;
  const n = new Vector3(...(selection.normal ?? [0, 0, 1])).normalize();
  const p = new Vector3(...selection.point).addScaledVector(n, 0.003);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), n);
  return (
    <group position={p} quaternion={q}>
      <mesh ref={ref} renderOrder={40}>
        <ringGeometry args={[0.009, 0.0135, 32]} />
        <meshBasicMaterial color="#ff8a4c" depthTest={false} transparent opacity={0.95} />
      </mesh>
      <mesh renderOrder={41}>
        <circleGeometry args={[0.004, 20]} />
        <meshBasicMaterial color="#fff2e8" depthTest={false} transparent />
      </mesh>
    </group>
  );
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
      to: TARGET.clone().addScaledVector(VIEW_DIRS[viewRequest.view].clone().normalize(), dist),
      t: 0,
      tf: controls.target.clone(),
      tt: TARGET.clone(),
    };
  }, [viewRequest, camera, controls]);
  useFrame((_, dt) => {
    const a = anim.current;
    if (!a || !controls) return;
    a.t = Math.min(1, a.t + dt * 2.2);
    const k = 1 - (1 - a.t) ** 3;
    // slerp-ish around the target to avoid passing through the body
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
  const { model, layers, showDeep, colorMode, colors, selection, pins, onPick, onPinClick, viewRequest, highlight, initialCamera } = props;
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const onHover = useMemo(
    () => (id: string | null, e?: ThreeEvent<PointerEvent>) => {
      if (!id || !e) return setHover(null);
      if (e.nativeEvent.pointerType !== 'mouse') return;
      const rect = wrapRef.current?.getBoundingClientRect();
      setHover({ id, x: e.nativeEvent.clientX - (rect?.left ?? 0), y: e.nativeEvent.clientY - (rect?.top ?? 0) });
    },
    [],
  );

  // Superficial and deep muscles are shown one set at a time so the deep ones
  // (which sit underneath) can be seen and tapped.
  const isShown = (s: StructureDef) => s.layer !== 'muscular' || (showDeep ? !!s.deep : !s.deep);

  const visibleDefs = useMemo(
    () => STRUCTURES.filter((s) => s.layer !== 'skin' && layers[s.layer].visible),
    [layers],
  );

  const visiblePins = useMemo(
    () =>
      pins.filter((p) => {
        const def = STRUCTURE_BY_ID.get(p.structureId);
        return def && layers[def.layer].visible && isShown(def);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pins, layers, showDeep],
  );

  const hoverName = hover ? STRUCTURE_BY_ID.get(hover.id)?.name : null;
  const selectedId = selection?.structureId ?? null;

  return (
    <div className="viewer" ref={wrapRef}>
      <Canvas
        camera={{ position: initialCamera?.position ?? [0.18, 1.05, 3.75], fov: 32, near: 0.02, far: 30 }}
        dpr={[1, 2]}
        gl={{ antialias: true, preserveDrawingBuffer: true }}
        onPointerMissed={() => setHover(null)}
      >
        <color attach="background" args={['#0d1016']} />
        <hemisphereLight args={['#dfe7ff', '#2a1d18', 0.85]} />
        <directionalLight position={[1.5, 3, 2.5]} intensity={1.7} />
        <directionalLight position={[-2, 1.5, -2]} intensity={0.75} color="#ffd2b0" />
        <directionalLight position={[0, -1, 2]} intensity={0.25} color="#9ab8ff" />
        <group>
          {visibleDefs.filter(isShown).map((def) => {
            const g = model.geometries.get(def.id);
            if (!g) return null;
            const ls = layers[def.layer];
            return (
              <StructureMesh
                key={def.id}
                def={def}
                geometry={g}
                hitGeometry={model.hitGeometries.get(def.id)}
                color={colors.get(def.id) ?? baseColor(def.layer, colorMode)}
                opacity={ls.opacity}
                pickable={ls.opacity >= GHOST_OPACITY}
                selected={def.id === selectedId}
                emphasised={!!highlight?.has(def.id)}
                hovered={hover?.id === def.id}
                onPick={onPick}
                onHover={onHover}
              />
            );
          })}
          {layers.skin.visible && model.geometries.has('skin') && (
            <SkinMesh
              model={model}
              colors={colors}
              colorMode={colorMode}
              opacity={layers.skin.opacity}
              pickable={layers.skin.opacity >= GHOST_OPACITY}
              selectedRegion={selectedId?.startsWith('skin-') ? selectedId : null}
              onPick={onPick}
              onHover={onHover}
            />
          )}
          <Pins pins={visiblePins} onPinClick={onPinClick} />
          <SelectionMarker selection={selection} />
        </group>
        <OrbitControls
          makeDefault
          target={initialCamera ? new Vector3(...initialCamera.target) : TARGET}
          enableDamping
          dampingFactor={0.12}
          minDistance={0.35}
          maxDistance={6}
          screenSpacePanning
          zoomSpeed={0.9}
        />
        <CameraRig viewRequest={viewRequest} />
      </Canvas>
      {hover && hoverName && (
        <div className="viewer-tip" style={{ left: hover.x + 14, top: hover.y + 10 }}>
          {hoverName}
        </div>
      )}
    </div>
  );
}
