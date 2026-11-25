// Powder Holler - an endless first-person downhill run. Raw WebGL2, no libraries, no assets.
// Rendering, streaming and atmosphere grew out of HYOH (Hike Your Own Hike).
import { makeTerrain } from './terrain.js';
import { makeWorld, CELL } from './forest.js';
import { createGame } from './game.js';
import { deciduousMesh, coniferMesh, rockMesh, stumpMesh, flagMesh, yetiMesh, billboardQuad } from './meshes.js';
import { SKY, TERRAIN, INST, BILLBOARD, RAYS, FINAL, PARTICLES, SPRITES } from './shaders.js';
import { Sfx } from './audio.js';
import { mulberry32, clamp } from './noise.js';

const $ = id => document.getElementById(id);
window.__err = window.__err || [];
const params = new URLSearchParams(location.search);
const SEED = parseInt(params.get('seed') || '1337', 10) || 1337;
const T = makeTerrain(SEED), WORLD = makeWorld(T, SEED), game = createGame(T, WORLD), S = game.s;

const canvas = $('c');
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, powerPreference: 'high-performance' });
if (!gl) { $('nogl').style.display = 'flex'; throw new Error('WebGL2 unavailable'); }
const HDR = !!gl.getExtension('EXT_color_buffer_float');

// ---------- quality ----------
const QUALITY = {
  low:    { maxScale: 0.7, K: 1.5, RN: 1, cut: 70,  RB: 4,  rays: false, parts: 500 },
  medium: { maxScale: 0.85, K: 1.9, RN: 2, cut: 100, RB: 6,  rays: true,  parts: 1000 },
  high:   { maxScale: 1.0, K: 2.3, RN: 2, cut: 125, RB: 8,  rays: true,  parts: 1600 },
};
let qName = params.get('q') || localStorage.getItem('ph.q') || 'high';
if (!QUALITY[qName]) qName = 'high';
let Q = QUALITY[qName], scale = Q.maxScale;

const norm = v => { const l = Math.hypot(...v); return v.map(c => c / l); };
const SUN = norm([0.5, 0.36, -0.79]);   // low winter sun, ahead and to the right of the fall line
const SUNCOL = [2.1, 1.92, 1.68], SKYCOL = [0.34, 0.45, 0.64], ZENITH = [0.12, 0.27, 0.62], HAZE = [0.5, 0.58, 0.74], MISTCOL = [0.82, 0.85, 0.9];

// ---------- GL helpers ----------
function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const e = gl.getShaderInfoLog(s); window.__err.push(e); console.error(e); throw new Error('shader: ' + e); }
  return s;
}
function program(def) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, def.vs)); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, def.fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const e = gl.getProgramInfoLog(p); window.__err.push(e); throw new Error('link: ' + e); }
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}
const P = { sky: program(SKY), ter: program(TERRAIN), inst: program(INST), bb: program(BILLBOARD), rays: program(RAYS), fin: program(FINAL), pt: program(PARTICLES), spr: program(SPRITES) };

const noiseTex = (() => {
  const r = mulberry32(99), N = 256, a = new Uint8Array(N * N), d = new Uint8Array(N * N * 2);
  for (let i = 0; i < N * N; i++) a[i] = (r() * 256) | 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { d[(y * N + x) * 2] = a[y * N + x]; d[(y * N + x) * 2 + 1] = a[((y - 17) & 255) * N + ((x - 37) & 255)]; }
  const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE7); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, N, N, 0, gl.RG, gl.UNSIGNED_BYTE, d);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  return t;
})();

function bindInst(buf) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 4, gl.FLOAT, false, 32, 0); gl.vertexAttribDivisor(3, 1);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, 32, 16); gl.vertexAttribDivisor(4, 1);
}
function meshVAO(m) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, m.data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.index, gl.STATIC_DRAW);
  const inst = gl.createBuffer(); bindInst(inst);
  gl.bindVertexArray(null);
  return { vao, count: m.index.length, inst, n: 0 };
}
const MESH = { decid: meshVAO(deciduousMesh()), conif: meshVAO(coniferMesh()), rock: meshVAO(rockMesh()), stump: meshVAO(stumpMesh()), flag: meshVAO(flagMesh()), yeti: meshVAO(yetiMesh()) };
const BB = (() => {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, billboardQuad(), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
  const inst = gl.createBuffer(); bindInst(inst); gl.bindVertexArray(null);
  return { vao, inst, n: 0 };
})();
function pointsVAO(data, usage) {
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0); gl.bindVertexArray(null);
  return { vao, vb, n: data.length / 4 };
}
const PTS = (() => { const r = mulberry32(5), d = new Float32Array(2000 * 4); for (let i = 0; i < d.length; i++) d[i] = r(); return pointsVAO(d, gl.STATIC_DRAW); })();
const SPR = pointsVAO(new Float32Array(4 * 512), gl.DYNAMIC_DRAW); SPR.data = new Float32Array(4 * 512); SPR.n = 0;
const emptyVAO = gl.createVertexArray();

// ---------- terrain quadtree (streamed, cached) ----------
const ROOT = 8192, MAXL = 7, NG = 33, VC = NG * NG + 4 * NG;
const terrainIndex = (() => {
  const idx = [];
  for (let j = 0; j < NG - 1; j++) for (let i = 0; i < NG - 1; i++) { const a = j * NG + i, b = a + 1, c = a + NG, d = c + 1; idx.push(a, c, b, b, c, d); }
  const edge = (k, e) => [[k, 0], [k, NG - 1], [0, k], [NG - 1, k]][e];
  for (let e = 0; e < 4; e++) for (let k = 0; k < NG - 1; k++) {
    const [i0, j0] = edge(k, e), [i1, j1] = edge(k + 1, e);
    const a = j0 * NG + i0, b = j1 * NG + i1, sa = NG * NG + e * NG + k, sb = sa + 1;
    idx.push(a, b, sa, b, sb, sa);
  }
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
  return { ib, count: idx.length };
})();
const nodes = new Map();
const H2 = new Float64Array((NG + 2) * (NG + 2)), K2 = new Float32Array(NG * NG), R2 = new Float32Array(NG * NG);
function buildNode(level, ix, iz) {
  const size = ROOT / 2 ** level, step = size / (NG - 1), x0 = ix * size, z0 = iz * size, W = NG + 2;
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) {
    const s = T.sample(x0 + (i - 1) * step, z0 + (j - 1) * step);
    H2[j * W + i] = s.h;
    if (i > 0 && j > 0 && i <= NG && j <= NG) { K2[(j - 1) * NG + i - 1] = s.kick; R2[(j - 1) * NG + i - 1] = s.run; }
  }
  const data = new Float32Array(VC * 8);
  let mn = 1e9, mx = -1e9;
  for (let j = 0; j < NG; j++) for (let i = 0; i < NG; i++) {
    const k = (j + 1) * W + (i + 1), h = H2[k];
    const dx = (H2[k + 1] - H2[k - 1]) / (2 * step), dz = (H2[k + W] - H2[k - W]) / (2 * step);
    const l = Math.hypot(dx, 1, dz), slope = Math.hypot(dx, dz);
    const forest = (1 - R2[j * NG + i]) * (1 - clamp((slope - 0.8) / 0.4, 0, 1));
    const o = (j * NG + i) * 8;
    data[o] = i * step; data[o + 1] = h; data[o + 2] = j * step;
    data[o + 3] = -dx / l; data[o + 4] = 1 / l; data[o + 5] = -dz / l; data[o + 6] = step <= 4 ? K2[j * NG + i] : 0; data[o + 7] = forest;
    if (h < mn) mn = h; if (h > mx) mx = h;
  }
  const drop = step * 1.5 + 2;
  for (let e = 0; e < 4; e++) for (let k = 0; k < NG; k++) {
    const [i, j] = [[k, 0], [k, NG - 1], [0, k], [NG - 1, k]][e];
    const src = (j * NG + i) * 8, dst = (NG * NG + e * NG + k) * 8;
    for (let c = 0; c < 8; c++) data[dst + c] = data[src + c];
    data[dst + 1] -= drop;
  }
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 32, 12);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 32, 24);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, terrainIndex.ib);
  gl.bindVertexArray(null);
  return { level, ix, iz, x0, z0, size, minY: mn - drop, maxY: mx, vao, vb, used: 0 };
}
const key = (l, x, z) => l + ',' + x + ',' + z;
let frameNo = 0;
const need = [], draws = [];
const planes = new Float32Array(24);
function inFrustum(n, ox, oz) {
  const x0 = n.x0 - ox, z0 = n.z0 - oz, x1 = x0 + n.size, z1 = z0 + n.size;
  for (let p = 0; p < 6; p++) {
    const a = planes[p * 4], b = planes[p * 4 + 1], c = planes[p * 4 + 2], d = planes[p * 4 + 3];
    if (a * (a > 0 ? x1 : x0) + b * (b > 0 ? n.maxY : n.minY) + c * (c > 0 ? z1 : z0) + d < 0) return false;
  }
  return true;
}
function selectTerrain(cx, cy, cz, ox, oz) {
  need.length = 0; draws.length = 0;
  const rx = Math.floor(cx / ROOT), rz = Math.floor(cz / ROOT);
  const visit = (l, ix, iz) => {
    const n = nodes.get(key(l, ix, iz));
    const size = ROOT / 2 ** l, x0 = ix * size, z0 = iz * size;
    const dx = Math.max(x0 - cx, 0, cx - x0 - size), dz = Math.max(z0 - cz, 0, cz - z0 - size);
    if (!n) { need.push([l, ix, iz, Math.hypot(dx, dz) / size + l * 0.01]); return; }
    n.used = frameNo;
    const dist = Math.hypot(dx, Math.max(n.minY - cy, 0, cy - n.maxY), dz);
    if (l < MAXL && dist < size * Q.K) {
      let all = true;
      for (let c = 0; c < 4; c++) {
        const cix = ix * 2 + (c & 1), ciz = iz * 2 + (c >> 1);
        if (!nodes.has(key(l + 1, cix, ciz))) { all = false; const cs = size / 2, ccx = cix * cs, ccz = ciz * cs; need.push([l + 1, cix, ciz, Math.hypot(Math.max(ccx - cx, 0, cx - ccx - cs), Math.max(ccz - cz, 0, cz - ccz - cs)) / cs + (l + 1) * 0.01]); }
      }
      if (all) { for (let c = 0; c < 4; c++) visit(l + 1, ix * 2 + (c & 1), iz * 2 + (c >> 1)); return; }
    }
    if (inFrustum(n, ox, oz)) draws.push(n);
  };
  for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) visit(0, rx + i, rz + j);
}
function buildTerrain(budgetMs) {
  if (!need.length) return 0;
  need.sort((a, b) => a[3] - b[3]);
  const t0 = performance.now(); let n = 0;
  for (const [l, ix, iz] of need) {
    const k = key(l, ix, iz); if (nodes.has(k)) continue;
    nodes.set(k, buildNode(l, ix, iz)); n++;
    if (performance.now() - t0 > budgetMs) break;
  }
  return n;
}
function evictTerrain() {
  if (nodes.size < 900) return;
  for (const [k, n] of nodes) if (frameNo - n.used > 600 && n.level > 0) { gl.deleteVertexArray(n.vao); gl.deleteBuffer(n.vb); nodes.delete(k); }
}

// ---------- forest cells / instances ----------
let originX = 0, originZ = 0, oCellX = 1e9, oCellZ = 1e9, instDirty = true, lastRebuild = 0;
function buildCells(ccx, ccz, budgetMs) {
  const R = Q.RB, list = [];
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) if (!WORLD.has(ccx + i, ccz + j)) list.push([ccx + i, ccz + j, Math.max(Math.abs(i), Math.abs(j))]);
  list.sort((a, b) => a[2] - b[2]);
  const t0 = performance.now(); let n = 0;
  for (const [ci, cj] of list) { WORLD.cell(ci, cj); n++; instDirty = true; if (performance.now() - t0 > budgetMs) break; }
  WORLD.prune(ccx, ccz, R + 1);
  return list.length - n;
}
const bufs = {};
function grow(name, n) { if (!bufs[name] || bufs[name].length < n) bufs[name] = new Float32Array(Math.ceil(n * 1.5) + 64); return bufs[name]; }
function rebuildInstances(ccx, ccz) {
  let nt = 0, nr = 0;
  for (let j = -Q.RB; j <= Q.RB; j++) for (let i = -Q.RB; i <= Q.RB; i++) { const c = WORLD.has(ccx + i, ccz + j) && WORLD.cell(ccx + i, ccz + j); if (c) { nt += c.trees.length; nr += c.rocks.length; } }
  const D = grow('d', nt), Cn = grow('c', nt), St = grow('s', nt), R = grow('r', nr), BBb = grow('b', nt), F = grow('f', 8 * 64);
  let nd = 0, nc = 0, ns = 0, nr2 = 0, nb = 0, nf = 0;
  const copy = (src, s, dst, d, ox, oz) => { dst[d] = src[s] + ox; dst[d + 1] = src[s + 1]; dst[d + 2] = src[s + 2] + oz; for (let k = 3; k < 8; k++) dst[d + k] = src[s + k]; };
  for (let j = -Q.RB; j <= Q.RB; j++) for (let i = -Q.RB; i <= Q.RB; i++) {
    if (!WORLD.has(ccx + i, ccz + j)) continue;
    const c = WORLD.cell(ccx + i, ccz + j), ox = (ccx + i) * CELL - originX, oz = (ccz + j) * CELL - originZ;
    const near = Math.abs(i) <= Q.RN && Math.abs(j) <= Q.RN;
    for (let s = 0; s < c.trees.length; s += 8) {
      const sp = c.trees[s + 6];
      if (sp === 10) { if (near) { copy(c.trees, s, St, ns, ox, oz); ns += 8; } continue; }
      copy(c.trees, s, BBb, nb, ox, oz); nb += 8;
      if (near) { if (sp === 4 || sp === 5) { copy(c.trees, s, Cn, nc, ox, oz); nc += 8; } else { copy(c.trees, s, D, nd, ox, oz); nd += 8; } }
    }
    if (near) for (let s = 0; s < c.rocks.length; s += 8) { copy(c.rocks, s, R, nr2, ox, oz); nr2 += 8; }
  }
  // slalom gate flags and orange kicker markers
  const flag = (x, z, seed, h) => { if (nf >= F.length) return; F.set([x - originX, T.height(x, z) - 0.2, z - originZ, 0, 1.6, h, 11, seed], nf); nf += 8; };
  for (const g of game.gatesNear(S.z - 350, 450)) { const sd = (g.k & 1) ? 0.2 : 0.6; flag(g.x - g.w / 2, g.z, sd, 1.9); flag(g.x + g.w / 2, g.z, sd, 1.9); }
  for (let b = Math.floor((S.z - 700) / 80); b <= Math.floor((S.z + 80) / 80); b++) { const kk = T.kicker(b); if (kk) { flag(kk.x - kk.W - 0.6, kk.zl, 0.9, 1.5 + kk.H); flag(kk.x + kk.W + 0.6, kk.zl, 0.9, 1.5 + kk.H); } }
  const up = (m, arr, n) => { gl.bindBuffer(gl.ARRAY_BUFFER, m.inst); gl.bufferData(gl.ARRAY_BUFFER, arr.subarray(0, n), gl.DYNAMIC_DRAW); m.n = n / 8; };
  up(MESH.decid, D, nd); up(MESH.conif, Cn, nc); up(MESH.stump, St, ns); up(MESH.rock, R, nr2); up(BB, BBb, nb); up(MESH.flag, F, nf);
  instDirty = false;
}
const yetiInst = new Float32Array(8);
function updateDynamic() {
  // pickups near the skier
  const list = game.flakesNear(S.x, S.z - 120, 200), d = SPR.data; let n = 0;
  for (const f of list) { if (n >= 512) break; d[n * 4] = f.x - originX; d[n * 4 + 1] = f.y; d[n * 4 + 2] = f.z - originZ; d[n * 4 + 3] = f.gold ? 1 : 0; n++; }
  SPR.n = n; gl.bindBuffer(gl.ARRAY_BUFFER, SPR.vb); gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, n * 4));
  const y = S.yeti;
  if (y.on) { yetiInst.set([y.x - originX, y.y, y.z - originZ, (y.dir || 0), 4.2, 4.2, 12, 0.1]); gl.bindBuffer(gl.ARRAY_BUFFER, MESH.yeti.inst); gl.bufferData(gl.ARRAY_BUFFER, yetiInst, gl.DYNAMIC_DRAW); MESH.yeti.n = 1; }
  else MESH.yeti.n = 0;
}

// ---------- input ----------
const keys = {};
let mode = 'intro', paused = false, jumpQ = false, lookBack = false, testInput = null, frozen = false;
const isTouch = matchMedia('(pointer: coarse)').matches;
addEventListener('keydown', e => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (!keys[e.code] && e.code === 'Space') jumpQ = true;
  keys[e.code] = true;
  if (e.code === 'KeyM') toggleSound();
  if (e.code === 'KeyH') $('help').classList.toggle('hidden');
  if (e.code === 'KeyQ') cycleQuality();
  if ((e.code === 'KeyP' || e.code === 'Escape') && mode === 'play') setPause(!paused);
  if (mode === 'over' && (e.code === 'KeyR' || e.code === 'Enter')) restart();
  if (mode === 'over' && e.code === 'KeyN') newMountain();
  if (mode === 'intro' && e.code === 'Enter' && !$('start').disabled) startRun();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (mode === 'play') setPause(true); });
// touch: left third leans left, right third leans right, middle tap = jump, middle hold = tuck / flip, swipe down = brake
const touches = new Map();
let tilt = null;
canvas.addEventListener('touchstart', e => { for (const t of e.changedTouches) touches.set(t.identifier, { x0: t.clientX, y0: t.clientY, x: t.clientX, y: t.clientY, t0: performance.now() }); e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchmove', e => { for (const t of e.changedTouches) { const o = touches.get(t.identifier); if (o) { o.x = t.clientX; o.y = t.clientY; } } e.preventDefault(); }, { passive: false });
const endTouch = e => { for (const t of e.changedTouches) { const o = touches.get(t.identifier); touches.delete(t.identifier); if (o && performance.now() - o.t0 < 250 && (o.y0 - o.y > 40 || (Math.abs(o.x0 - innerWidth / 2) < innerWidth / 6 && Math.hypot(o.x - o.x0, o.y - o.y0) < 20))) jumpQ = true; } };
canvas.addEventListener('touchend', endTouch); canvas.addEventListener('touchcancel', endTouch);
function enableTilt() {
  const on = () => addEventListener('deviceorientation', e => { const a = (screen.orientation && screen.orientation.angle) || 0; const v = a === 90 ? e.beta : (a === 270 || a === -90) ? -e.beta : e.gamma; if (v != null) tilt = clamp(v / 22, -1, 1); });
  if (window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) DeviceOrientationEvent.requestPermission().then(r => r === 'granted' && on()).catch(() => {}); else on();
}
function readInput() {
  if (testInput) return testInput;
  let steer = 0, up = !!(keys.KeyW || keys.ArrowUp), down = !!(keys.KeyS || keys.ArrowDown);
  if (keys.KeyA || keys.ArrowLeft) steer -= 1; if (keys.KeyD || keys.ArrowRight) steer += 1;
  for (const t of touches.values()) {
    if (t.x < innerWidth / 3) steer -= 1; else if (t.x > innerWidth * 2 / 3) steer += 1;
    else if (t.y - t.y0 > 40) down = true; else if (performance.now() - t.t0 > 250) up = true;
  }
  if (tilt !== null && Math.abs(tilt) > 0.08 && steer === 0) steer = tilt;
  const jump = jumpQ; jumpQ = false;
  lookBack = !!keys.KeyC;
  return { steer: clamp(steer, -1, 1), up, down, jump, grab: !!(keys.ShiftLeft || keys.ShiftRight || keys.KeyF) };
}

// ---------- render targets ----------
let W = 0, H = 0, fb = null;
function makeTex(w, h, fmt, f, type, filter) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, fmt, w, h, 0, f, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const w = Math.max(1, Math.round(innerWidth * dpr)), h = Math.max(1, Math.round(innerHeight * dpr));
  if (w === W && h === H && fb) return;
  W = w; H = h; canvas.width = W; canvas.height = H;
  if (fb) { gl.deleteTexture(fb.color); gl.deleteTexture(fb.depth); gl.deleteTexture(fb.rays); gl.deleteFramebuffer(fb.f); gl.deleteFramebuffer(fb.rf); }
  gl.activeTexture(gl.TEXTURE0);
  const color = HDR ? makeTex(W, H, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, gl.LINEAR) : makeTex(W, H, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
  const depth = makeTex(W, H, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, gl.NEAREST);
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
  const rw = Math.max(1, W >> 1), rh = Math.max(1, H >> 1);
  const rays = makeTex(rw, rh, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
  const rf = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, rf);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rays, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  fb = { f, color, depth, rf, rays, rw, rh };
}
addEventListener('resize', resize);
resize();

function perspective(fovy, aspect, n, f) { const t = 1 / Math.tan(fovy / 2), m = new Float32Array(16); m[0] = t / aspect; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f); return m; }
function mul(a, b) { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; }
function extractPlanes(m) {
  const row = r => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  [[1, r0], [-1, r0], [1, r1], [-1, r1], [1, r2], [-1, r2]].forEach(([sg, r], i) => { for (let k = 0; k < 4; k++) planes[i * 4 + k] = r3[k] + sg * r[k]; });
}

// ---------- UI / game flow ----------
const sfx = new Sfx();
let soundOn = false, best = +(localStorage.getItem('ph.best.' + SEED) || 0), flash = [1, 1, 1, 0], shake = 0;
function toggleSound() { soundOn = !soundOn; soundOn ? sfx.start() : sfx.stop(); $('sound').classList.toggle('on', soundOn); $('sound').textContent = soundOn ? 'Sound on' : 'Sound off'; }
function setQuality(n) { qName = n; Q = QUALITY[n]; scale = Q.maxScale; localStorage.setItem('ph.q', n); instDirty = true; oCellX = 1e9; $('quality').value = n; }
function cycleQuality() { const k = Object.keys(QUALITY); setQuality(k[(k.indexOf(qName) + 1) % k.length]); }
function setPause(p) { paused = p; $('paused').classList.toggle('show', p); }
function startRun() {
  if (mode !== 'intro') return;
  mode = 'play'; $('intro').classList.add('gone'); document.body.classList.add('playing');
  if ($('withsound').checked && !soundOn) toggleSound();
  if (isTouch && $('withtilt') && $('withtilt').checked) enableTilt();
}
function restart() { game.reset(); game.events.length = 0; mode = 'play'; $('over').classList.remove('show'); oCellX = 1e9; instDirty = true; setPause(false); hud(true); }
function newMountain() { params.set('seed', (Math.random() * 1e6) | 0); location.search = params.toString(); }
function pop(text, sub, cls) {
  const el = document.createElement('div'); el.className = 'pop ' + (cls || ''); el.innerHTML = text + (sub ? '<small>' + sub + '</small>' : '');
  $('pops').appendChild(el); setTimeout(() => el.remove(), 1600);
  while ($('pops').children.length > 3) $('pops').firstChild.remove();
}
function handleEvents() {
  for (const e of game.events) {
    if (window.PH) PH.log.push(e);
    if (e.type === 'pickup') { sfx.pickup(e.gold); if (e.gold) pop('+' + e.pts, 'golden flake', 'gold'); flash = e.gold ? [1.4, 1.1, .4, .12] : [.7, .9, 1.3, .06]; }
    if (e.type === 'gate') { sfx.gate(); pop('Gate +' + e.pts, e.mult > 1 ? 'x' + e.mult + ' combo' : ''); }
    if (e.type === 'miss') pop('Missed gate', '', 'dim');
    if (e.type === 'trick') { sfx.trick(e.n || 1); pop(e.name + ' +' + e.pts, (e.air > 0.9 ? e.air.toFixed(1) + 's air' : '') + (e.mult > 1 ? ' · x' + e.mult : ''), 'big'); }
    if (e.type === 'land') { sfx.thud(Math.min(0.8, e.impact / 15), 600); shake = Math.min(1, e.impact / 12); }
    if (e.type === 'jump') sfx.thud(0.15, 900);
    if (e.type === 'crash') { sfx.crash(); flash = [1.2, .15, .1, .45]; shake = 1; pop(e.why, e.lives > 0 ? e.lives + (e.lives === 1 ? ' life' : ' lives') + ' left' : 'no lives left', 'bad'); }
    if (e.type === 'yeti') { sfx.roar(); pop('The Holler Yeti is awake!', 'it is coming down the mountain after you', 'bad'); }
    if (e.type === 'eaten') { sfx.roar(); flash = [1, .9, .9, .8]; }
    if (e.type === 'over') gameOver(e);
  }
  game.events.length = 0;
}
function gameOver(e) {
  mode = 'over'; $('pops').innerHTML = '';
  const sc = e.score, nb = sc > best;
  if (nb) { best = sc; localStorage.setItem('ph.best.' + SEED, best); }
  $('ocause').textContent = e.cause;
  $('oscore').textContent = sc.toLocaleString();
  $('obest').textContent = nb ? 'New best!' : 'Best ' + best.toLocaleString();
  $('obest').classList.toggle('nb', nb);
  $('ostats').innerHTML = [['Distance', Math.floor(S.dist).toLocaleString() + ' m'], ['Top speed', Math.round(S.maxSpeed * 2.237) + ' mph'], ['Snowflakes', S.flakes], ['Gates', S.gates], ['Tricks', S.tricks], ['Best trick', S.bestTrick || '-']].map(([a, b]) => '<span>' + a + '</span><b>' + b + '</b>').join('');
  setTimeout(() => $('over').classList.add('show'), e.cause.includes('Yeti') ? 900 : 300);
}
let lastHud = '';
function hud(force) {
  const sc = game.score(), m = game.mult();
  $('score').textContent = sc.toLocaleString();
  $('combo').textContent = m > 1 ? 'x' + m + ' combo' : S.chain ? 'combo ' + S.chain % 3 + '/3' : '';
  $('combobar').style.width = (S.chainT / 5 * 100).toFixed(0) + '%';
  $('spd').textContent = Math.round(Math.hypot(S.vx, S.vz) * 2.237) + ' mph';
  $('dst').textContent = Math.floor(S.dist).toLocaleString() + ' m';
  const lv = '<i></i>'.repeat(Math.max(0, S.lives)) + '<i class="lost"></i>'.repeat(Math.max(0, 3 - S.lives));
  if (lv !== lastHud || force) { $('lives').innerHTML = lv; lastHud = lv; }
  const yd = game.yetiDist(), toY = game.YETI_AT - S.dist;
  $('yeti').classList.toggle('show', mode === 'play' && (yd >= 0 || toY < 400));
  $('yeti').classList.toggle('near', yd >= 0 && yd < 60);
  $('yeti').textContent = yd >= 0 ? 'YETI ' + Math.round(yd) + ' m behind' : 'Yeti wakes in ' + Math.max(0, Math.round(toY)) + ' m';
  $('fps').textContent = Math.round(1 / avg) + ' fps · ' + Math.round(scale * 100) + '%';
}
$('start').addEventListener('click', startRun);
$('again').addEventListener('click', restart);
$('newmtn').addEventListener('click', newMountain);
$('quality').addEventListener('change', e => setQuality(e.target.value));
$('sound').addEventListener('click', e => { toggleSound(); e.currentTarget.blur(); });
$('helpbtn').addEventListener('click', e => { $('help').classList.toggle('hidden'); e.currentTarget.blur(); });
$('resume').addEventListener('click', () => setPause(false));
$('ibest').textContent = best ? 'Best on this mountain: ' + best.toLocaleString() : '';
setQuality(qName);
if (isTouch) document.body.classList.add('touch');

// ---------- frame ----------
let last = performance.now(), time = 0, avg = 1 / 60, slow = 0, fast = 0, loading = true, audioTick = 0;
const cam = { x: 0, y: 0, z: 0, eye: 1.55, fov: 1, roll: 0, back: 0, pitch: -0.2 };
function uniformsCommon(u, VP, camL, ox, oz) {
  gl.uniformMatrix4fv(u.uViewProj, false, VP);
  gl.uniform3f(u.uCam, camL[0], camL[1], camL[2]);
  gl.uniform1f(u.uTime, time);
  gl.uniform3fv(u.uSunDir, SUN); gl.uniform3fv(u.uSunCol, SUNCOL); gl.uniform3fv(u.uSkyCol, SKYCOL);
  gl.uniform3fv(u.uHazeCol, HAZE); gl.uniform3fv(u.uZenith, ZENITH); gl.uniform3fv(u.uMistCol, MISTCOL);
  gl.uniform1f(u.uHazeDen, 0.0002); gl.uniform1f(u.uMistDen, 0.0011); gl.uniform1f(u.uMistH, camL[1] - 160); gl.uniform1f(u.uMistScale, 70);
  gl.uniform2f(u.uOriginMod, ((ox % 32768) + 32768) % 32768, ((oz % 32768) + 32768) % 32768);
  if (u.uNoise) gl.uniform1i(u.uNoise, 7);
}
function render(now) {
  const raw = (now - last) / 1000; last = now;
  const dt = clamp(raw, 0, 0.1); frameNo++;
  avg += (raw - avg) * 0.05;
  if (!loading && raw < 0.5) {
    if (raw > 1 / 45) { slow++; fast = 0; } else if (raw < 1 / 58) { fast++; slow = Math.max(0, slow - 1); }
    if (slow > 40) { scale = Math.max(0.5, scale - 0.08); slow = 0; }
    if (fast > 180) { scale = Math.min(Q.maxScale, scale + 0.05); fast = 0; }
  }
  const live = (mode === 'play' || mode === 'over') && !paused && !frozen;
  if (live) {
    time += dt;
    const inp = readInput(), n = Math.ceil(dt / (1 / 120));
    for (let i = 0; i < n; i++) { game.step(dt / n, i ? { ...inp, jump: false } : inp); }
    handleEvents();
  } else if (!paused) time += dt * 0.3;

  // camera: eye height, lean roll, trick rotations, crash tumble, speed FOV and shake
  const sp = Math.hypot(S.vx, S.vz), k = Math.min(1, dt * 8);
  const crashing = S.crashT > 0, ct = crashing ? 1.9 - S.crashT : 0;
  cam.eye += ((crashing ? 0.45 : S.tuck ? 1.1 : 1.55) - cam.eye) * k;
  cam.roll += ((crashing ? Math.sin(ct * 5) * 0.9 * Math.max(0, 1 - ct / 1.4) + 0.5 : -S.lean * 0.16) - cam.roll) * k;
  cam.fov += ((isTouch && innerWidth < innerHeight ? 1.2 : 0.98) + clamp(sp / 34, 0, 1) * 0.32 - cam.fov) * Math.min(1, dt * 3);
  cam.back += ((lookBack && !crashing ? Math.PI : 0) - cam.back) * Math.min(1, dt * 10);
  cam.pitch += ((crashing ? 0.25 : cam.back > 1 ? 0.08 : -0.2 - (S.tuck ? 0.05 : 0)) - cam.pitch) * k;
  shake = Math.max(0, shake - dt * 2.5);
  const sh = (shake * 0.03 + clamp((sp - 14) / 25, 0, 1) * 0.004 * (S.air ? 0.3 : 1)) * (frozen ? 0 : 1);
  const yaw = S.yaw + S.spin + cam.back + Math.sin(time * 61) * sh;
  const pitch = cam.pitch + S.flip + Math.sin(time * 47 + 1) * sh;
  cam.x = S.x; cam.z = S.z; cam.y = S.y + cam.eye;
  const ccx = Math.floor(cam.x / CELL), ccz = Math.floor(cam.z / CELL);
  if (ccx !== oCellX || ccz !== oCellZ) { oCellX = ccx; oCellZ = ccz; originX = ccx * CELL; originZ = ccz * CELL; instDirty = true; }
  const camL = [cam.x - originX, cam.y, cam.z - originZ];
  const aspect = W / H, fovy = cam.fov;
  const cp = Math.cos(pitch), spn = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
  const F = [sy * cp, spn, -cy * cp], R0 = [cy, 0, sy], U0 = [R0[1] * F[2] - R0[2] * F[1], R0[2] * F[0] - R0[0] * F[2], R0[0] * F[1] - R0[1] * F[0]];
  const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
  const R = R0.map((v, i) => v * cr + U0[i] * sr), U = U0.map((v, i) => v * cr - R0[i] * sr);
  const V = new Float32Array([R[0], U[0], -F[0], 0, R[1], U[1], -F[1], 0, R[2], U[2], -F[2], 0,
    -(R[0] * camL[0] + R[1] * camL[1] + R[2] * camL[2]), -(U[0] * camL[0] + U[1] * camL[1] + U[2] * camL[2]), (F[0] * camL[0] + F[1] * camL[1] + F[2] * camL[2]), 1]);
  const VP = mul(perspective(fovy, aspect, 0.3, 42000), V);
  extractPlanes(VP);

  // streaming (look ahead downhill)
  selectTerrain(cam.x, cam.y, cam.z, originX, originZ);
  const pendingT = need.length;
  buildTerrain(loading ? 40 : 5);
  const pendingC = buildCells(ccx, ccz, loading ? 40 : 3);
  if (instDirty && (loading || now - lastRebuild > 150)) { rebuildInstances(ccx, ccz); lastRebuild = now; }
  if (frameNo % 60 === 0) evictTerrain();
  if (loading) {
    $('loadbar').style.width = Math.round(100 * (1 - Math.min(1, (pendingT + pendingC) / 300))) + '%';
    if (pendingT === 0 && pendingC === 0 && !instDirty && frameNo > 3) { loading = false; $('loading').classList.add('gone'); $('start').disabled = false; if (window.PH) PH.ready = true; }
  }
  updateDynamic();

  const rw = Math.max(1, Math.round(W * scale)), rh = Math.max(1, Math.round(H * scale));
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb.f);
  gl.viewport(0, 0, rw, rh);
  gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND);
  gl.depthMask(true); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
  const tanY = Math.tan(fovy / 2), tanX = tanY * aspect;
  gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
  let u = P.sky.u; gl.useProgram(P.sky.p); uniformsCommon(u, VP, camL, originX, originZ);
  gl.uniform3fv(u.uFwd, F); gl.uniform3fv(u.uRight, R); gl.uniform3fv(u.uUp, U); gl.uniform2f(u.uTan, tanX, tanY);
  gl.bindVertexArray(emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.depthFunc(gl.LESS);
  u = P.ter.u; gl.useProgram(P.ter.p); uniformsCommon(u, VP, camL, originX, originZ);
  for (const n of draws) { gl.uniform3f(u.uOffset, n.x0 - originX, 0, n.z0 - originZ); gl.bindVertexArray(n.vao); gl.drawElements(gl.TRIANGLES, terrainIndex.count, gl.UNSIGNED_SHORT, 0); }
  u = P.inst.u; gl.useProgram(P.inst.p); uniformsCommon(u, VP, camL, originX, originZ);
  gl.uniform1f(u.uSnow, 1);
  const drawMesh = (m, cut) => { if (!m.n) return; gl.uniform1f(u.uCut, cut); gl.uniform1f(u.uFadeW, cut * 0.18); gl.bindVertexArray(m.vao); gl.drawElementsInstanced(gl.TRIANGLES, m.count, gl.UNSIGNED_SHORT, 0, m.n); };
  drawMesh(MESH.decid, Q.cut); drawMesh(MESH.conif, Q.cut); drawMesh(MESH.rock, Q.cut); drawMesh(MESH.stump, Q.cut); drawMesh(MESH.flag, 600); drawMesh(MESH.yeti, 1000);
  u = P.bb.u; gl.useProgram(P.bb.p); uniformsCommon(u, VP, camL, originX, originZ);
  gl.uniform1f(u.uCut, Q.cut); gl.uniform1f(u.uFadeW, Q.cut * 0.18); gl.uniform1f(u.uMinD, Q.cut * 0.8);
  if (BB.n) { gl.bindVertexArray(BB.vao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, BB.n); }
  // pickups (premultiplied glow) and falling snow
  gl.enable(gl.BLEND); gl.depthMask(false);
  if (SPR.n) {
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    u = P.spr.u; gl.useProgram(P.spr.p);
    gl.uniformMatrix4fv(u.uViewProj, false, VP); gl.uniform3f(u.uCam, camL[0], camL[1], camL[2]); gl.uniform1f(u.uPx, rh / (2 * tanY)); gl.uniform1f(u.uTime, time);
    gl.bindVertexArray(SPR.vao); gl.drawArrays(gl.POINTS, 0, SPR.n);
  }
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  u = P.pt.u; gl.useProgram(P.pt.p); uniformsCommon(u, VP, camL, originX, originZ);
  gl.uniform1f(u.uBox, 36); gl.uniform1f(u.uPx, rh / (2 * tanY)); gl.uniform1f(u.uFall, 1.2);
  gl.bindVertexArray(PTS.vao); gl.drawArrays(gl.POINTS, 0, Math.min(PTS.n, Q.parts));
  gl.disable(gl.BLEND); gl.depthMask(true);
  // god rays (half res)
  const sunView = [SUN[0] * R[0] + SUN[1] * R[1] + SUN[2] * R[2], SUN[0] * U[0] + SUN[1] * U[1] + SUN[2] * U[2], SUN[0] * F[0] + SUN[1] * F[1] + SUN[2] * F[2]];
  let rayStr = 0, sunUV = [0.5, 0.5];
  if (Q.rays && sunView[2] > 0.05) {
    sunUV = [0.5 + 0.5 * sunView[0] / sunView[2] / tanX, 0.5 + 0.5 * sunView[1] / sunView[2] / tanY];
    rayStr = clamp(1.6 - Math.max(Math.abs(sunUV[0] - 0.5), Math.abs(sunUV[1] - 0.5)) * 1.2, 0, 1) * 0.3;
  }
  gl.disable(gl.DEPTH_TEST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb.rf);
  gl.viewport(0, 0, Math.max(1, Math.round(fb.rw * scale)), Math.max(1, Math.round(fb.rh * scale)));
  if (rayStr > 0) {
    u = P.rays.u; gl.useProgram(P.rays.p);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fb.depth); gl.uniform1i(u.uDepth, 1);
    gl.uniform2f(u.uSunUV, sunUV[0], sunUV[1]); gl.uniform1f(u.uScale, scale);
    gl.uniform3fv(u.uFwd, F); gl.uniform3fv(u.uRight, R); gl.uniform3fv(u.uUp, U); gl.uniform3fv(u.uSunDir, SUN); gl.uniform2f(u.uTan, tanX, tanY);
    gl.bindVertexArray(emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
  } else { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }
  // final composite: tonemap, speed vignette, hit/pickup flash
  flash[3] = Math.max(0, flash[3] - dt * 1.6);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
  u = P.fin.u; gl.useProgram(P.fin.p);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fb.color); gl.uniform1i(u.uScene, 1);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, fb.rays); gl.uniform1i(u.uRays, 2);
  gl.uniform1f(u.uScale, scale); gl.uniform1f(u.uRayStr, rayStr); gl.uniform1f(u.uTime, time); gl.uniform1f(u.uExposure, 0.74);
  gl.uniform1f(u.uVig, clamp((sp - 12) / 25, 0, 1) * 0.9); gl.uniform4fv(u.uFlash, flash);
  gl.uniform3fv(u.uSunCol, SUNCOL); gl.uniform2f(u.uPx, scale / W, scale / H);
  gl.bindVertexArray(emptyVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.activeTexture(gl.TEXTURE7);

  // ski tips follow lean, tuck and tricks
  const sk = $('skis');
  sk.style.transform = `translateY(${(S.tuck ? 4 : 0) + (S.air ? -10 : 0) + (crashing ? 60 : 0)}%) rotate(${(-cam.roll * 57).toFixed(1)}deg) translateX(${(S.lean * -6).toFixed(1)}%)`;
  sk.style.opacity = mode === 'over' || crashing || Math.abs(S.flip) > 0.5 || cam.back > 0.5 ? 0 : 1;
  sk.classList.toggle('plow', S.brake > 0.5 && !S.air);
  if (frameNo % 6 === 0) hud();
  audioTick += dt;
  if (audioTick > 0.1 && soundOn) { audioTick = 0; sfx.update({ speed: sp, air: S.air, lean: S.lean, brake: S.brake, down: crashing, yeti: game.yetiDist() }); }
}
function frame(now) { requestAnimationFrame(frame); try { render(now); } catch (e) { window.__err.push(String(e && e.stack || e)); console.error(e); } }

// ---------- test hook ----------
window.PH = {
  ready: false, log: [],
  stat: () => ({ mode, score: game.score(), dist: S.dist, speed: Math.hypot(S.vx, S.vz), lives: S.lives, over: S.over, cause: S.cause, air: S.air, x: S.x, y: S.y, z: S.z, yaw: S.yaw,
    flakes: S.flakes, gates: S.gates, tricks: S.tricks, chain: S.chain, mult: game.mult(), yeti: game.yetiDist(), best, W, H, scale, q: qName, fps: Math.round(1 / avg),
    draws: draws.length, trees: MESH.decid.n + MESH.conif.n, bb: BB.n, flakesShown: SPR.n, err: window.__err }),
  start: startRun, restart, setPause, quality: setQuality,
  input(i) { testInput = i ? { steer: 0, up: false, down: false, jump: false, grab: false, ...i } : null; },
  freeze(f) { frozen = f; },
  lookBack(b) { lookBack = b; },
  step(n, i) { const inp = { steer: 0, up: false, down: false, jump: false, grab: false, ...(i || {}) }; for (let k = 0; k < n; k++) game.step(1 / 60, k ? { ...inp, jump: false } : inp); handleEvents(); return PH.stat(); },
  place(x, z, vz, yaw) { S.x = x; S.z = z; S.y = T.height(x, z); S.vx = 0; S.vz = -(vz || 0); S.vy = 0; S.air = false; S.yaw = yaw || 0; S.crashT = 0; },
  kickerAhead() { for (let b = Math.floor(S.z / 80) - 1; b > Math.floor(S.z / 80) - 30; b--) { const k = T.kicker(b); if (k && k.z0 < S.z - 20) return k; } },
  gateAhead() { for (let b = Math.floor(S.z / 230); b > Math.floor(S.z / 230) - 10; b--) { const g = T.gate(b); if (g && g.z < S.z - 5) return g; } },
  treeAhead() {   // nearest tree standing on the run ahead (for tests)
    let b = null;
    for (let cj = Math.floor(S.z / CELL); cj > Math.floor(S.z / CELL) - 6; cj--) for (let ci = Math.floor(S.x / CELL) - 1; ci <= Math.floor(S.x / CELL) + 1; ci++) {
      const t = WORLD.cell(ci, cj).trees;
      for (let k = 0; k < t.length; k += 8) { const x = t[k] + ci * CELL, z = t[k + 2] + cj * CELL; if (t[k + 6] < 9 && z < S.z - 15 && T.sample(x, z).run > 0.8 && (!b || z > b.z)) b = { x, z }; }
    }
    return b;
  },
  setDist(d) { S.startZ = S.z + d; S.dist = d; },
  T, game,
};
requestAnimationFrame(frame);
