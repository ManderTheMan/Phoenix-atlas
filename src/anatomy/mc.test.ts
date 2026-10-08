import { describe, expect, it } from 'vitest';
import { meshFromShape } from './mc';
import { sphere, roundCone, union } from './sdf';

describe('marching cubes', () => {
  it('produces a closed, outward-facing sphere of the right size', () => {
    const m = meshFromShape(sphere([0.1, 0.2, 0.3], 0.05), 0.004, 0);
    expect(m.indices.length).toBeGreaterThan(300);
    let outward = 0;
    let maxErr = 0;
    for (let i = 0; i < m.positions.length; i += 3) {
      const dx = m.positions[i] - 0.1, dy = m.positions[i + 1] - 0.2, dz = m.positions[i + 2] - 0.3;
      const r = Math.hypot(dx, dy, dz);
      maxErr = Math.max(maxErr, Math.abs(r - 0.05));
      if (dx * m.normals[i] + dy * m.normals[i + 1] + dz * m.normals[i + 2] > 0) outward++;
    }
    expect(outward / (m.positions.length / 3)).toBeGreaterThan(0.99);
    expect(maxErr).toBeLessThan(0.002);
  });

  it('every edge is shared by exactly two triangles (watertight)', () => {
    const m = meshFromShape(union([sphere([0, 0, 0], 0.03), roundCone([0, 0, 0], [0.06, 0.02, 0], 0.02, 0.01)], 0.01), 0.004, 1);
    const edges = new Map<string, number>();
    for (let t = 0; t < m.indices.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = m.indices[t + e], b = m.indices[t + ((e + 1) % 3)];
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    const bad = [...edges.values()].filter((c) => c !== 2).length;
    expect(bad).toBe(0);
  });
});
