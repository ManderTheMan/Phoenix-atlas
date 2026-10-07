// Tag network: tags are nodes (size = how often used, colour = average feeling),
// edges join tags used together on the same note.
import { useMemo, useState } from 'react';
import type { TagStat } from '../../analysis/stats';
import { feelingColor, formatFeeling } from '../../lib/feeling';

interface Node extends TagStat {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export default function TagGraph({
  tags,
  edges,
  onPick,
  height = 380,
}: {
  tags: TagStat[];
  edges: { a: string; b: string; count: number }[];
  onPick?: (tag: string) => void;
  height?: number;
}) {
  const W = 760, H = height;
  const [hover, setHover] = useState<string | null>(null);
  const nodes = useMemo(() => {
    const maxC = Math.max(1, ...tags.map((t) => t.count));
    // deterministic initial layout on a circle
    const ns: Node[] = tags.map((t, i) => {
      const a = (i / tags.length) * Math.PI * 2;
      return { ...t, x: W / 2 + Math.cos(a) * 160, y: H / 2 + Math.sin(a) * 120, vx: 0, vy: 0, r: 7 + 15 * Math.sqrt(t.count / maxC) };
    });
    const idx = new Map(ns.map((n, i) => [n.tag, i]));
    const links = edges.filter((e) => idx.has(e.a) && idx.has(e.b));
    for (let it = 0; it < 320; it++) {
      const alpha = 1 - it / 320;
      for (let i = 0; i < ns.length; i++)
        for (let j = i + 1; j < ns.length; j++) {
          const a = ns[i], b = ns[j];
          let dx = b.x - a.x, dy = b.y - a.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const d = Math.sqrt(d2);
          const min = a.r + b.r + 26;
          const f = (2600 / d2 + (d < min ? (min - d) * 0.5 : 0)) * alpha;
          dx /= d; dy /= d;
          a.vx -= dx * f; a.vy -= dy * f;
          b.vx += dx * f; b.vy += dy * f;
        }
      for (const l of links) {
        const a = ns[idx.get(l.a)!], b = ns[idx.get(l.b)!];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = 90 / Math.sqrt(l.count);
        const f = (d - target) * 0.02 * Math.min(3, l.count) * alpha;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      for (const n of ns) {
        n.vx += (W / 2 - n.x) * 0.004 * alpha;
        n.vy += (H / 2 - n.y) * 0.006 * alpha;
        n.x += Math.max(-20, Math.min(20, n.vx));
        n.y += Math.max(-20, Math.min(20, n.vy));
        n.vx *= 0.6; n.vy *= 0.6;
        n.x = Math.max(n.r + 40, Math.min(W - n.r - 40, n.x));
        n.y = Math.max(n.r + 14, Math.min(H - n.r - 18, n.y));
      }
    }
    return { ns, idx, links };
  }, [tags, edges, H]);

  const neighbours = useMemo(() => {
    if (!hover) return null;
    const s = new Set([hover]);
    for (const l of nodes.links) {
      if (l.a === hover) s.add(l.b);
      if (l.b === hover) s.add(l.a);
    }
    return s;
  }, [hover, nodes]);

  const maxE = Math.max(1, ...nodes.links.map((l) => l.count));
  const hn = hover ? nodes.ns[nodes.idx.get(hover)!] : null;

  return (
    <div style={{ position: 'relative' }}>
      <svg className="tag-graph" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Network of tags that appear together">
        {nodes.links.map((l, i) => {
          const a = nodes.ns[nodes.idx.get(l.a)!], b = nodes.ns[nodes.idx.get(l.b)!];
          const on = !neighbours || (neighbours.has(l.a) && neighbours.has(l.b) && (l.a === hover || l.b === hover));
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#4a5670" strokeWidth={1 + (3 * l.count) / maxE} opacity={on ? 0.85 : 0.15} />;
        })}
        {nodes.ns.map((n) => {
          const on = !neighbours || neighbours.has(n.tag);
          return (
            <g
              key={n.tag}
              style={{ cursor: onPick ? 'pointer' : 'default' }}
              opacity={on ? 1 : 0.3}
              onPointerEnter={() => setHover(n.tag)}
              onPointerLeave={() => setHover(null)}
              onClick={() => onPick?.(n.tag)}
            >
              <circle cx={n.x} cy={n.y} r={n.r + 10} fill="transparent" />
              <circle cx={n.x} cy={n.y} r={n.r} fill={feelingColor(n.mean)} stroke="var(--panel)" strokeWidth={2} />
              <text x={n.x} y={n.y + n.r + 13} textAnchor="middle">
                #{n.tag}
              </text>
            </g>
          );
        })}
      </svg>
      {hn && (
        <div className="chart-tip" style={{ left: `${(hn.x / W) * 100}%`, top: `${((hn.y - hn.r) / H) * 100}%` }}>
          <strong>#{hn.tag}</strong> <span className="dim">· {hn.count} notes · avg {formatFeeling(hn.mean)}</span>
        </div>
      )}
    </div>
  );
}
