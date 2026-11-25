// Seeded noise utilities (gradient noise, hashing, PRNG). Pure functions, no deps.
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer hash -> [0,1)
export function ihash(x, y, z) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(z | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function makeNoise(seed) {
  const rnd = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const gx = new Float32Array(256), gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const a = rnd() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  // 2D gradient noise, roughly [-1, 1]
  return function n2(x, y) {
    const xf = Math.floor(x), yf = Math.floor(y);
    const X = xf & 255, Y = yf & 255;
    x -= xf; y -= yf;
    const u = x * x * x * (x * (x * 6 - 15) + 10);
    const v = y * y * y * (y * (y * 6 - 15) + 10);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    const g00 = perm[a], g01 = perm[a + 1], g10 = perm[b], g11 = perm[b + 1];
    const n00 = gx[g00] * x + gy[g00] * y;
    const n10 = gx[g10] * (x - 1) + gy[g10] * y;
    const n01 = gx[g01] * x + gy[g01] * (y - 1);
    const n11 = gx[g11] * (x - 1) + gy[g11] * (y - 1);
    const nx0 = n00 + u * (n10 - n00), nx1 = n01 + u * (n11 - n01);
    return (nx0 + v * (nx1 - nx0)) * 1.42;
  };
}

export function fbm(n, x, y, oct) {
  let s = 0, a = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += a * n(x * f + i * 17.31, y * f - i * 9.13);
    norm += a; a *= 0.5; f *= 2.03;
  }
  return s / norm;
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
