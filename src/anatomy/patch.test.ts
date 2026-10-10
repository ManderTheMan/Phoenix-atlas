import { describe, expect, it } from 'vitest';
import { cover, heightField, HOLE, INTERIOR, inFront, KNOWN, NONE, REPLACED, splitByX, SURFACE } from './patch';

// A flat sheet of skin (z = 0) over x, y in [-5, 5] cm with a square opening in the
// middle that a pointed bump (the part to replace) used to fill, muscle just beneath,
// a flap of the bump overhanging the skin, and a tab sticking out past its edge.
function scene() {
  const tris: number[] = [], kind: number[] = [];
  const quad = (x0: number, y0: number, x1: number, y1: number, z: (x: number, y: number) => number, k: number) => {
    tris.push(x0, y0, z(x0, y0), x1, y0, z(x1, y0), x1, y1, z(x1, y1), x0, y0, z(x0, y0), x1, y1, z(x1, y1), x0, y1, z(x0, y1));
    kind.push(k, k);
  };
  const s = 0.005;
  for (let x = -0.05; x < 0.0499; x += s)
    for (let y = -0.05; y < 0.0499; y += s) {
      const inOpening = Math.abs(x + s / 2) < 0.01 && Math.abs(y + s / 2) < 0.01;
      if (!inOpening) quad(x, y, x + s, y + s, () => 0, SURFACE);
      quad(x, y, x + s, y + s, () => -0.006, INTERIOR);
    }
  // the bump over the opening
  const apex = [0, 0, 0.02];
  const ring = [[-0.01, -0.01], [0.01, -0.01], [0.01, 0.01], [-0.01, 0.01]];
  for (let i = 0; i < 4; i++) {
    const [a, b] = [ring[i], ring[(i + 1) % 4]];
    tris.push(a[0], a[1], 0, b[0], b[1], 0, apex[0], apex[1], apex[2]);
    kind.push(REPLACED);
  }
  // a flap lying over the skin beside the opening, and a tab out past the sheet's edge
  quad(0.02, -0.01, 0.03, 0.01, () => 0.004, REPLACED);
  quad(0.06, -0.01, 0.07, 0.01, () => 0.004, REPLACED);
  return { tris, kind };
}

const view = { toward: [0, 0, 1] as [number, number, number], across: [1, 0, 0] as [number, number, number], cell: 0.001, u: [-0.08, 0.08] as [number, number], v: [-0.06, 0.06] as [number, number] };
const node = (f: ReturnType<typeof heightField>, x: number, y: number) => Math.round((y - view.v[0]) / view.cell) * f.nu + Math.round((x - view.u[0]) / view.cell);

describe('smoothing over part of a surface', () => {
  it('tells the opening from overhangs and gaps', () => {
    const { tris, kind } = scene();
    const f = heightField(view, tris, kind);
    expect(f.state[node(f, 0, 0)]).toBe(HOLE); // looks through the opening onto muscle
    expect(f.state[node(f, 0.025, 0)]).toBe(KNOWN); // the flap only overhung skin
    expect(f.h[node(f, 0.025, 0)]).toBeCloseTo(0, 6);
    expect(f.state[node(f, 0.065, 0)]).toBe(NONE); // nothing behind the tab
    expect(f.state[node(f, -0.03, 0.02)]).toBe(KNOWN);
  });

  it('covers the opening flush with the skin around it', () => {
    const { tris, kind } = scene();
    const { surface, fields } = cover(tris, kind, [view], { grow: 2 });
    expect(fields).toHaveLength(1);
    expect(surface.indices.length).toBeGreaterThan(0);
    let lo = Infinity, hi = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (let i = 0; i < surface.positions.length; i += 3) {
      lo = Math.min(lo, surface.positions[i + 2]);
      hi = Math.max(hi, surface.positions[i + 2]);
      x0 = Math.min(x0, surface.positions[i]);
      x1 = Math.max(x1, surface.positions[i]);
    }
    // flat at skin level (the skirt over the skin sits just beneath it), spanning only the opening
    expect(hi).toBeLessThan(1e-6);
    expect(lo).toBeGreaterThan(-0.0011);
    expect(x0).toBeGreaterThan(-0.015);
    expect(x1).toBeLessThan(0.015);
    // every patch triangle faces the viewer
    const P = (i: number) => surface.positions.slice(i * 3, i * 3 + 3);
    for (let t = 0; t < surface.indices.length; t += 3) {
      const [a, b, c] = [P(surface.indices[t]), P(surface.indices[t + 1]), P(surface.indices[t + 2])];
      expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0);
    }
    // what stood out of the opening is now outside; the muscle beneath is not
    expect(inFront(fields[0], [0, 0, 0.01])).toBe(true);
    expect(inFront(fields[0], [0, 0, -0.006])).toBe(false);
    expect(inFront(fields[0], [0.03, 0.03, 0.01])).toBe(false); // away from the opening
  });

  it('domes the middle when asked', () => {
    const { tris, kind } = scene();
    const { surface } = cover(tris, kind, [view], { bulge: 0.003 });
    let hi = -Infinity;
    for (let i = 2; i < surface.positions.length; i += 3) hi = Math.max(hi, surface.positions[i]);
    expect(hi).toBeGreaterThan(0.002);
    expect(hi).toBeLessThan(0.0031);
  });

  it('splits at the midline', () => {
    const { tris, kind } = scene();
    const { surface } = cover(tris, kind, [view]);
    const [left, right] = splitByX(surface);
    expect(left.indices.length + right.indices.length).toBe(surface.indices.length);
    for (let i = 0; i < left.positions.length; i += 3) expect(left.positions[i]).toBeGreaterThan(-0.0011);
    for (let i = 0; i < right.positions.length; i += 3) expect(right.positions[i]).toBeLessThan(0.0011);
  });
});
