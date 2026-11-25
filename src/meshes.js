// Procedural unit meshes. Vertex layout: pos(3) normal(3) part(1: 0 wood, 1 leaf, 2 rock, 3 fur, 4 face, 5 pole, 6 cloth) hfrac(1)
import { mulberry32 } from './noise.js';

function icosphere(sub) {
  const t = (1 + Math.sqrt(5)) / 2;
  let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  v = v.map(a => { const l = Math.hypot(...a); return a.map(c => c / l); });
  for (let s = 0; s < sub; s++) {
    const cache = new Map(), nf = [];
    const mid = (a, b) => {
      const k = a < b ? a + '_' + b : b + '_' + a;
      if (cache.has(k)) return cache.get(k);
      const m = [(v[a][0] + v[b][0]) / 2, (v[a][1] + v[b][1]) / 2, (v[a][2] + v[b][2]) / 2];
      const l = Math.hypot(...m); v.push(m.map(c => c / l)); cache.set(k, v.length - 1); return v.length - 1;
    };
    for (const [a, b, c] of f) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    f = nf;
  }
  return { v, f };
}

class Builder {
  constructor() { this.d = []; this.idx = []; this.n = 0; }
  vert(p, nr, part, hf) { this.d.push(p[0], p[1], p[2], nr[0], nr[1], nr[2], part, hf); return this.n++; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  // tapered cylinder from p0 to p1
  tube(p0, p1, r0, r1, sides, part = 0) {
    const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(...d);
    const ax = d.map(c => c / L);
    let up = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let a = [ax[1] * up[2] - ax[2] * up[1], ax[2] * up[0] - ax[0] * up[2], ax[0] * up[1] - ax[1] * up[0]];
    let al = Math.hypot(...a); a = a.map(c => c / al);
    const b = [ax[1] * a[2] - ax[2] * a[1], ax[2] * a[0] - ax[0] * a[2], ax[0] * a[1] - ax[1] * a[0]];
    const base = this.n;
    for (let s = 0; s <= 1; s++) {
      const p = s ? p1 : p0, r = s ? r1 : r0;
      for (let i = 0; i < sides; i++) {
        const t = (i / sides) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
        const nr = [a[0] * c + b[0] * sn, a[1] * c + b[1] * sn, a[2] * c + b[2] * sn];
        this.vert([p[0] + nr[0] * r, p[1] + nr[1] * r, p[2] + nr[2] * r], nr, part, p[1]);
      }
    }
    for (let i = 0; i < sides; i++) {
      const i1 = (i + 1) % sides;
      this.tri(base + i, base + i1, base + sides + i);
      this.tri(base + i1, base + sides + i1, base + sides + i);
    }
  }
  blob(c, rx, ry, rz, rnd, part = 1, center = null, sub = 1, jit = 0.18) {
    const ico = icosphere(sub), base = this.n;
    for (const p of ico.v) {
      const j = 1 + (rnd() - 0.5) * 2 * jit;
      const q = [c[0] + p[0] * rx * j, c[1] + p[1] * ry * j, c[2] + p[2] * rz * j];
      let nr = [p[0] / rx, p[1] / ry, p[2] / rz];
      if (center) { const o = [q[0] - center[0], q[1] - center[1], q[2] - center[2]]; const l = Math.hypot(...o) || 1; nr = nr.map((v, i) => v * 0.5 + (o[i] / l) * 3); }
      const l = Math.hypot(...nr); nr = nr.map(v => v / l);
      this.vert(q, nr, part, q[1]);
    }
    for (const [a, b, cc] of ico.f) this.tri(base + a, base + b, base + cc);
  }
  build() { return { data: new Float32Array(this.d), index: new Uint16Array(this.idx) }; }
}

// Deciduous hardwood, unit height 1, crown width ~1
export function deciduousMesh() {
  const B = new Builder(), rnd = mulberry32(7);
  B.tube([0, 0, 0], [0.01, 0.35, 0], 0.045, 0.032, 7);
  B.tube([0.01, 0.35, 0], [-0.01, 0.62, 0.01], 0.032, 0.018, 6);
  const crownC = [0, 0.66, 0];
  // branches (visible in winter)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + rnd() * 0.6, y0 = 0.36 + rnd() * 0.22;
    const r = 0.28 + rnd() * 0.16, y1 = y0 + 0.2 + rnd() * 0.18;
    const p1 = [Math.cos(a) * r, y1, Math.sin(a) * r];
    B.tube([0, y0, 0], p1, 0.016, 0.006, 5);
    for (let k = 0; k < 2; k++) {
      const a2 = a + (k ? 0.7 : -0.7) + (rnd() - 0.5) * 0.4, r2 = r + 0.08 + rnd() * 0.08;
      B.tube(p1, [Math.cos(a2) * r2, y1 + 0.08 + rnd() * 0.1, Math.sin(a2) * r2], 0.006, 0.002, 4);
    }
    B.tube([0, y0 + 0.1, 0], [Math.cos(a + 1) * 0.12, y1 + 0.12, Math.sin(a + 1) * 0.12], 0.008, 0.003, 4);
  }
  // crown blobs
  const blobs = [[0, 0.82, 0, 0.26], [0.2, 0.68, 0.05, 0.22], [-0.19, 0.7, -0.08, 0.23], [0.05, 0.66, 0.22, 0.2], [-0.06, 0.64, -0.24, 0.21], [0.16, 0.56, -0.17, 0.17], [-0.17, 0.55, 0.15, 0.17], [0.0, 0.95, 0.02, 0.15]];
  for (const [x, y, z, r] of blobs) B.blob([x, y, z], r * 1.15, r * 0.9, r * 1.15, rnd, 1, crownC);
  return B.build();
}

// Hemlock / pine: stacked drooping tiers
export function coniferMesh() {
  const B = new Builder(), rnd = mulberry32(11);
  B.tube([0, 0, 0], [0, 1.0, 0], 0.05, 0.008, 6);
  const tiers = 8;
  for (let t = 0; t < tiers; t++) {
    const f = t / (tiers - 1);
    const y = 0.16 + f * 0.78, r = 0.5 * (1 - f * 0.85) + 0.03, hgt = 0.16 + (1 - f) * 0.06;
    const sides = 9, base = B.n;
    const apex = B.vert([0, y + hgt, 0], [0, 1, 0], 1, y + hgt);
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2 + t * 0.5, rr = r * (0.8 + rnd() * 0.4);
      const droop = -0.03 - rnd() * 0.03;
      const nr = [Math.cos(a) * 0.6, 0.8, Math.sin(a) * 0.6];
      B.vert([Math.cos(a) * rr, y + droop, Math.sin(a) * rr], nr, 1, y);
    }
    const inner = B.vert([0, y + 0.02, 0], [0, -1, 0], 1, y);
    for (let i = 0; i < sides; i++) {
      const a = base + 1 + i, b = base + 1 + ((i + 1) % sides);
      B.tri(apex, a, b); B.tri(inner, b, a);
    }
  }
  return B.build();
}

export function rockMesh() {
  const B = new Builder(), rnd = mulberry32(3);
  B.blob([0, 0.5, 0], 0.5, 0.5, 0.5, rnd, 2, null, 2, 0.22);
  return B.build();
}

export function billboardQuad() {
  return new Float32Array([-0.5, 0, 0.5, 0, 0.5, 1, -0.5, 0, 0.5, 1, -0.5, 1]);
}

// Snow-capped stump, unit height 1, width 1
export function stumpMesh() {
  const B = new Builder(), rnd = mulberry32(13);
  B.tube([0, 0, 0], [0, 0.9, 0], 0.5, 0.42, 9);
  B.blob([0, 0.92, 0], 0.46, 0.14, 0.46, rnd, 2, null, 1, 0.1);
  return B.build();
}

// Slalom / kicker flag: striped pole with a pennant, unit height 1
export function flagMesh() {
  const B = new Builder();
  B.tube([0, 0, 0], [0, 1, 0], 0.025, 0.02, 6, 5);
  const a = B.vert([0, 0.97, 0], [0, 0, 1], 6, 0.97), b = B.vert([0.42, 0.86, 0], [0, 0, 1], 6, 0.86), c = B.vert([0, 0.7, 0], [0, 0, 1], 6, 0.7);
  B.tri(a, b, c);
  return B.build();
}

// The Holler Yeti: shaggy, arms up, unit height ~1
export function yetiMesh() {
  const B = new Builder(), rnd = mulberry32(21);
  B.blob([0, 0.45, 0], 0.27, 0.3, 0.22, rnd, 3, null, 2, 0.25);                 // body
  B.blob([0, 0.82, 0.02], 0.17, 0.16, 0.16, rnd, 3, null, 2, 0.2);              // head
  for (const s of [-1, 1]) {
    B.blob([s * 0.3, 0.72, 0.02], 0.08, 0.24, 0.08, rnd, 3, null, 1, 0.2);       // arms up
    B.blob([s * 0.12, 0.12, 0], 0.09, 0.14, 0.1, rnd, 3, null, 1, 0.2);          // legs
    B.blob([s * 0.065, 0.86, 0.15], 0.03, 0.035, 0.02, rnd, 4, null, 1, 0);       // eyes
  }
  B.blob([0, 0.76, 0.15], 0.07, 0.04, 0.03, rnd, 6, null, 1, 0);                  // big red mouth
  return B.build();
}
