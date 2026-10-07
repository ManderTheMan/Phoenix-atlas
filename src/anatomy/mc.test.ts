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

import { tube } from './tube';
describe('tube', () => {
  it('faces agree with outward vertex normals', () => {
    const m = tube([[0, 0, 0], [0.05, 0.02, 0], [0.1, 0.0, 0.03]], { radius: 0.01 });
    let agree = 0, total = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t] * 3, m.indices[t + 1] * 3, m.indices[t + 2] * 3];
      const ab = [m.positions[b] - m.positions[a], m.positions[b + 1] - m.positions[a + 1], m.positions[b + 2] - m.positions[a + 2]];
      const ac = [m.positions[c] - m.positions[a], m.positions[c + 1] - m.positions[a + 1], m.positions[c + 2] - m.positions[a + 2]];
      const f = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const n = [m.normals[a] + m.normals[b] + m.normals[c], m.normals[a + 1] + m.normals[b + 1] + m.normals[c + 1], m.normals[a + 2] + m.normals[b + 2] + m.normals[c + 2]];
      total++;
      if (f[0] * n[0] + f[1] * n[1] + f[2] * n[2] > 0) agree++;
    }
    expect(agree / total).toBeGreaterThan(0.98);
  });
});
