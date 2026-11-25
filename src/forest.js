// Seeded per-cell placement of trees, rocks, stumps and snowflake pickups. Each 64 m cell is regenerated
// identically from (seed, cellX, cellZ), so the mountain is endless and the same every run.
import { ihash, clamp, smoothstep } from './noise.js';
import { KBAND, GBAND } from './terrain.js';

export const CELL = 64;
// species: 0 oak, 1 maple, 3 hickory (bare in winter), 4 red spruce, 5 Fraser fir, 9 rock, 10 stump
export function makeWorld(T, seed) {
  const S = seed | 0, cells = new Map();
  // keep kicker approaches, landings and gates clear of trees
  function blocked(x, z) {
    if (z > -50) return Math.abs(x - T.cx(z)) < 30;
    for (const k of [Math.floor(z / KBAND), Math.floor(z / KBAND) + 1]) {
      const kk = T.kicker(k);
      if (kk && Math.abs(x - kk.x) < kk.W + 3 && z < kk.z0 + 30 && z > kk.zl - 40) return true;
    }
    const g = T.gate(Math.floor(z / GBAND)) || T.gate(Math.floor(z / GBAND) + 1);
    if (g && Math.abs(z - g.z) < 16 && Math.abs(x - g.x) < g.w + 5) return true;
    return false;
  }
  function gen(ci, cj) {
    const x0 = ci * CELL, z0 = cj * CELL;
    const trees = [], rocks = [], flakes = [];
    // snowflake lines along the fall line (lay these first so trees stay off them)
    const lines = [];
    for (let k = 0; k < 2; k++) {
      if (ihash(ci, cj, 500 + k + S) > 0.42) continue;
      const lx = 8 + ihash(ci, cj, 510 + k + S) * 48, x = x0 + lx, z = z0 + 30 + k * 30;
      const s = T.sample(x, z); if (s.run < 0.7 || z > -60) continue;
      const gold = ihash(ci, cj, 520 + k + S) < 0.09, ph = ihash(ci, cj, 530 + k + S) * 6;
      for (let i = 0; i < 5; i++) {
        const fx = x + Math.sin(ph + i * 0.7) * 3.5, fz = z - i * 6.5;
        flakes.push(fx, T.height(fx, fz) + 1.1, fz, gold ? 1 : 0); lines.push(fx, fz);
      }
    }
    const nearLine = (x, z) => { for (let i = 0; i < lines.length; i += 2) if (Math.abs(x - lines[i]) < 4 && Math.abs(z - lines[i + 1]) < 5) return true; return false; };
    for (let k = 0; k < 64 + 16; k++) {
      const small = k >= 64;
      let lx, lz;
      if (!small) { lx = ((k & 7) + ihash(ci, cj, k * 7 + S)) * 8; lz = ((k >> 3) + ihash(ci, cj, k * 7 + 1 + S)) * 8; }
      else { lx = ihash(ci, cj, k * 7 + S) * CELL; lz = ihash(ci, cj, k * 7 + 1 + S) * CELL; }
      const x = x0 + lx, z = z0 + lz;
      const r = ihash(ci, cj, k * 7 + 2 + S), r2 = ihash(ci, cj, k * 7 + 3 + S), r3 = ihash(ci, cj, k * 7 + 4 + S);
      const s = T.sample(x, z), run = s.run;
      // SkiFree-style: thin scattering of trees on the run, thick woods on the walls
      const glade = smoothstep(0.55, 0.8, Math.sin(x * 0.011 + z * 0.007) * 0.5 + 0.5 + (ihash(ci, cj, 99 + S) - 0.5) * 0.4);
      const dens = run > 0.5 ? (small ? 0.05 : 0.04) : (0.85 - 0.6 * glade) * (small ? 0.5 : 1);
      if (r > dens || blocked(x, z) || nearLine(x, z)) continue;
      const conif = r2 < (run > 0.5 ? 0.8 : 0.66);
      const sp = conif ? (r3 < 0.6 ? 4 : 5) : [0, 1, 3][Math.floor(r3 * 3)];
      const v = ihash(ci, cj, k * 7 + 5 + S);
      let ht = conif ? 10 + v * 12 : 15 + v * 9;
      if (small || run > 0.5) ht *= 0.45 + v * 0.35;
      const wd = conif ? ht * (0.42 + r3 * 0.1) : ht * (0.5 + r3 * 0.2);
      trees.push(lx, s.h - 0.3, lz, r2 * 6.2832, wd, ht, sp, ihash(ci, cj, k * 7 + 6 + S));
    }
    // rocks and stumps on the run
    for (let k = 0; k < 14; k++) {
      const lx = ihash(ci, cj, 3000 + k * 5 + S) * CELL, lz = ihash(ci, cj, 3001 + k * 5 + S) * CELL;
      const x = x0 + lx, z = z0 + lz, s = T.sample(x, z);
      const r = ihash(ci, cj, 3002 + k * 5 + S), r2 = ihash(ci, cj, 3003 + k * 5 + S), v = ihash(ci, cj, 3004 + k * 5 + S);
      if (r > (s.run > 0.5 ? 0.12 : 0.3) || blocked(x, z) || nearLine(x, z)) continue;
      if (r2 < 0.45) { const sz = 0.5 + v * 0.5; trees.push(lx, s.h - 0.15, lz, r2 * 20, sz * 0.9, sz * 0.75, 10, v); }   // stump
      else { const sz = 0.7 + v * v * 2.2; rocks.push(lx, s.h - sz * 0.3, lz, r2 * 6.2832, sz * (1 + r2 * 0.4), sz * (0.55 + v * 0.3), 9, v); }
    }
    return { trees: new Float32Array(trees), rocks: new Float32Array(rocks), flakes: new Float32Array(flakes) };
  }
  function cell(ci, cj) {
    const k = ci + ',' + cj; let c = cells.get(k);
    if (!c) { c = gen(ci, cj); cells.set(k, c); }
    return c;
  }
  function prune(ccx, ccz, R) {
    if (cells.size < (2 * R + 6) ** 2) return;
    for (const k of cells.keys()) { const [i, j] = k.split(',').map(Number); if (Math.max(Math.abs(i - ccx), Math.abs(j - ccz)) > R + 2) cells.delete(k); }
  }
  // obstacle radius for collisions; null if harmless
  function obstacleR(arr, s) {
    const sp = arr[s + 6], wd = arr[s + 4];
    if (sp === 4 || sp === 5) return { r: Math.max(0.5, wd * 0.2), top: arr[s + 5] };
    if (sp < 4) return { r: Math.max(0.35, wd * 0.035), top: arr[s + 5] };
    if (sp === 10) return { r: wd * 0.5, top: arr[s + 5] };
    return { r: wd * 0.42, top: arr[s + 5] * 0.85 };
  }
  return { cell, prune, cells, has: (ci, cj) => cells.has(ci + ',' + cj), obstacleR };
}
