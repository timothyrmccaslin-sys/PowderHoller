// Endless downhill run carved between Appalachian ridges. Deterministic from a seed, evaluated anywhere.
// +x = east, downhill = -z. Height falls ~0.21 m per metre on average, with rollers, moguls, gullies and kickers.
import { makeNoise, fbm, clamp, smoothstep, ihash } from './noise.js';

export const KBAND = 80, GBAND = 230;

export function makeTerrain(seed) {
  const N = makeNoise(seed), M = makeNoise(seed + 101), C = makeNoise(seed + 202), B = makeNoise(seed + 303);
  const S = seed | 0;
  const out = { h: 0, kick: 0, run: 0, d: 0 };
  const cx = z => 240 * fbm(M, z / 1900, 7.7, 2);                // meandering centre line of the run
  const halfW = z => 56 + 22 * fbm(M, z / 520, 1.3, 2);
  const kcache = new Map();
  // Kicker (jump) for band k: one per 80 m band, ~60% of bands. Ramp rises over L metres, lip at z0 - L.
  function kicker(k) {
    if (kcache.has(k)) return kcache.get(k);
    let r = null;
    if (k < -1 && ihash(k, 7, S) < 0.62) {
      const z0 = k * KBAND + 22 + 36 * ihash(k, 8, S);
      const x = cx(z0) + (ihash(k, 9, S) - 0.5) * halfW(z0) * 0.9;
      const L = 8 + 3 * ihash(k, 10, S), H = 1.3 + 1.3 * ihash(k, 11, S), W = 3.6 + 1.6 * ihash(k, 12, S);
      r = { k, x, z0, L, H, W, zl: z0 - L };
    }
    if (kcache.size > 400) kcache.clear();
    kcache.set(k, r); return r;
  }
  // Slalom gate for band k (every 230 m): two flags 8 m apart.
  function gate(k) {
    if (k > -1) return null;
    const z = k * GBAND + 60 + 100 * ihash(k, 21, S);
    return { k, z, x: cx(z) + (ihash(k, 22, S) - 0.5) * halfW(z) * 0.8, w: 8 };
  }
  function sample(x, z) {
    const c = cx(z), d = x - c, ad = Math.abs(d), rw = halfW(z);
    let h = 0.21 * z + 70 * fbm(N, z / 900, 3.3, 2);
    // Valley walls: ridges rising either side, with spurs; farther ranges behind them
    const side = d > 0 ? 1 : -1;
    const ridge = 1 - Math.abs(fbm(N, z / 1500, side * 5.3 + ad / 1100, 3));
    const wall = smoothstep(rw * 0.85, rw + 300, ad);
    h += wall * wall * (140 + 300 * ridge * ridge);
    h += smoothstep(600, 2600, ad) * 260 * Math.max(0, 1 - Math.abs(fbm(C, x / 3200, z / 3200, 3)) * 1.7);
    // Cross-slope tilt and rolling ground
    h += d * 0.05 * fbm(C, z / 420, 1.1, 2);
    h += 4.5 * fbm(C, x / 95, z / 95, 2);
    // Rollers: long waves across the run that throw you in the air at speed
    const rollM = smoothstep(0.05, 0.4, fbm(B, z / 650, 4.4, 2));
    h += 1.7 * rollM * (0.5 - Math.abs(Math.sin(z / 24 + 2.5 * fbm(B, z / 300, x / 220, 2))));
    // Mogul fields
    const mog = smoothstep(0.12, 0.4, fbm(B, z / 480, 9.1, 2)) * (1 - wall);
    h += 0.6 * mog * Math.sin(x * 0.43 + z * 0.2) * Math.sin(z * 0.43 - x * 0.19);
    // Gullies (natural half-pipes) inside the run
    const gm = smoothstep(0.18, 0.42, fbm(B, z / 700, 13.3, 2));
    if (gm > 0) { const gx = c + 34 * fbm(M, z / 380, 3.3, 2), gd = Math.abs(x - gx) / 7; if (gd < 1) h -= 3.6 * gm * (1 - gd * gd); }
    // Kicker
    let kick = 0;
    const kk = kicker(Math.floor(z / KBAND));
    if (kk) {
      const u = kk.z0 - z, w = smoothstep(kk.W + 1, kk.W - 0.6, Math.abs(x - kk.x));
      if (w > 0 && u > -3 && u < kk.L + 1.4) {
        const f = u < 0 ? 0 : u <= kk.L ? kk.H * (u / kk.L) ** 2 : kk.H * (1 - (u - kk.L) / 1.4);
        h += f * w; kick = w * (u < 0 ? 0.05 : u <= kk.L ? 0.05 + 0.95 * u / kk.L : 0.6);
      }
    }
    h += 0.5 * C(x / 11.3, z / 11.3);
    out.h = h; out.kick = kick; out.run = 1 - smoothstep(rw * 0.6, rw * 1.05, ad); out.d = d;
    return out;
  }
  const height = (x, z) => sample(x, z).h;
  function grad(x, z) { const e = 0.35; return [(height(x + e, z) - height(x - e, z)) / (2 * e), (height(x, z + e) - height(x, z - e)) / (2 * e)]; }
  return { sample, height, grad, cx, halfW, kicker, gate };
}
