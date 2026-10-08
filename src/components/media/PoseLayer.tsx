// The tracker's skeleton drawn over the frame. Joints it is unsure about
// (visibility under 0.5) are drawn faint and dashed.
import { BONES, LM, type Side } from '../../vision/analysis';

export default function PoseLayer({ lm, width, height, boxW, side }: { lm: number[] | null; width: number; height: number; boxW: number; side: Side }) {
  if (!lm) return null;
  const k = boxW ? width / boxW : 1;
  const P = (i: number) => [lm[i * 3] * width, lm[i * 3 + 1] * height, lm[i * 3 + 2]] as const;
  const near = new Set(['shoulder', 'elbow', 'wrist', 'hip', 'knee', 'ankle', 'heel', 'foot_index'].map((n) => LM[`${side}_${n}` as keyof typeof LM]));
  return (
    <svg className="pose-layer" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
      {BONES.map(([a, b]) => {
        const p = P(LM[a]), q = P(LM[b]);
        const sure = p[2] >= 0.5 && q[2] >= 0.5;
        const isNear = near.has(LM[a]) && near.has(LM[b]);
        return <line key={`${a}-${b}`} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} className={`pose-bone ${sure ? '' : 'unsure'} ${isNear ? 'near' : ''}`} strokeWidth={(isNear ? 3.2 : 2) * k} />;
      })}
      {Array.from({ length: 33 }, (_, i) => {
        if (i > 0 && i < 11 && i !== 2 && i !== 5 && i !== 7 && i !== 8) return null; // face: nose, eyes and ears only
        const p = P(i);
        return <circle key={i} cx={p[0]} cy={p[1]} r={(near.has(i) ? 4.5 : 3) * k} className={`pose-joint ${p[2] >= 0.5 ? '' : 'unsure'} ${near.has(i) ? 'near' : ''}`} />;
      })}
    </svg>
  );
}
