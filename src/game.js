// Skier physics, collisions, pickups, tricks, scoring and the yeti. No DOM, no GL: easy to test.
import { CELL } from './forest.js';
import { KBAND, GBAND } from './terrain.js';
import { clamp } from './noise.js';

const G = 9.81, TAU = Math.PI * 2, YETI_AT = 2000;
const wrapPi = a => a - Math.round(a / TAU) * TAU;

export function createGame(T, W) {
  const s = {};
  const got = new Set();
  function reset() {
    const z = -12, x = T.cx(z);
    Object.assign(s, { x, z, y: T.height(x, z), vx: 0, vy: 0, vz: -4, yaw: 0, lean: 0, air: false, spin: 0, flip: 0, spinR: 0, flipR: 0,
      grabT: 0, airT: 0, lives: 3, bonus: 0, dist: 0, startZ: z, chain: 0, chainT: 0, crashT: 0, inv: 0, over: false, cause: '',
      tuck: false, brake: 0, jumpCool: 0, flakes: 0, gates: 0, tricks: 0, bestTrick: '', bestPts: 0, time: 0, maxSpeed: 0, why: '',
      yeti: { on: false, x: 0, z: 0, y: 0, t: 0 } });
    got.clear();
  }
  reset();
  const events = [];
  const emit = e => events.push(e);
  const mult = () => Math.min(8, 1 + Math.floor(s.chain / 3));
  const speed = () => Math.hypot(s.vx, s.vz, s.vy * (s.air ? 0 : 1));
  const score = () => Math.floor(s.dist) + s.bonus;
  function award(pts, kind, extra) {
    const m = mult(), p = Math.round(pts * m);
    s.bonus += p; s.chain++; s.chainT = 5;
    emit({ type: kind, pts: p, mult: m, ...extra });
    return p;
  }
  function crash(why) {
    if (s.crashT > 0 || s.over) return;
    const v = Math.hypot(s.vx, s.vz) || 1; s.x -= s.vx / v * 1.4; s.z -= s.vz / v * 1.4;   // bounce back off whatever we hit
    s.lives--; s.chain = 0; s.chainT = 0; s.crashT = 1.9; s.why = why;
    s.vx *= 0.08; s.vz *= 0.08; s.vy = 0; s.air = false; s.spin = s.flip = s.spinR = s.flipR = 0; s.grabT = 0; s.airT = 0;
    s.y = T.height(s.x, s.z);
    emit({ type: 'crash', why, lives: s.lives });
  }
  function gameOver(cause) { if (s.over) return; s.over = true; s.cause = cause; emit({ type: 'over', cause, score: score() }); }

  // ---- pickups: per-cell lines plus arcs above kicker landings
  function kickerFlakes(kk, out) {
    for (let i = 0; i < 3; i++) { const z = kk.zl - 7 - i * 6, y = T.height(kk.x, z) + [2.9, 3.6, 3.0][i] + kk.H * 0.5; out.push({ x: kk.x, y, z, gold: i === 1, key: 'k' + kk.k + ',' + i }); }
  }
  function flakesNear(x, z, R) {
    const out = [], ci = Math.floor(x / CELL), cj = Math.floor(z / CELL), n = Math.ceil(R / CELL);
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      if (!W.has(ci + i, cj + j) && (Math.abs(i) > 1 || Math.abs(j) > 1)) continue;
      const f = W.cell(ci + i, cj + j).flakes;
      for (let k = 0; k < f.length; k += 4) { const key = (ci + i) + ',' + (cj + j) + ',' + k; if (!got.has(key)) out.push({ x: f[k], y: f[k + 1], z: f[k + 2], gold: f[k + 3] > 0.5, key }); }
    }
    const b0 = Math.floor((z - R) / KBAND), b1 = Math.floor((z + R) / KBAND);
    for (let b = b0; b <= b1; b++) { const kk = T.kicker(b); if (kk) { const a = []; kickerFlakes(kk, a); for (const f of a) if (!got.has(f.key)) out.push(f); } }
    return out;
  }
  function gatesNear(z, R) {
    const out = [];
    for (let b = Math.floor((z - R) / GBAND); b <= Math.floor((z + R) / GBAND); b++) { const g = T.gate(b); if (g) out.push(g); }
    return out;
  }
  // ---- collisions with trees, stumps and rocks
  function collide() {
    const ci = Math.floor(s.x / CELL), cj = Math.floor(s.z / CELL);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const c = W.cell(ci + i, cj + j), ox = (ci + i) * CELL, oz = (cj + j) * CELL;
      for (const arr of [c.trees, c.rocks]) for (let k = 0; k < arr.length; k += 8) {
        const dx = s.x - (arr[k] + ox), dz = s.z - (arr[k + 2] + oz);
        if (Math.abs(dx) > 6 || Math.abs(dz) > 6) continue;
        const o = W.obstacleR(arr, k), r = o.r + 0.32, d = Math.hypot(dx, dz);
        if (d > r || s.y > arr[k + 1] + o.top) continue;
        const sp = arr[k + 6];
        const what = sp === 9 ? 'Rock!' : sp === 10 ? 'Stump!' : 'Tree!';
        if (speed() > 5.5) { crash(what); return what; }
        // slow bump: push out, kill inward velocity
        const nx = dx / (d || 1), nz = dz / (d || 1), vn = s.vx * nx + s.vz * nz;
        s.x += nx * (r - d); s.z += nz * (r - d); if (vn < 0) { s.vx -= vn * nx; s.vz -= vn * nz; }
      }
    }
    return null;
  }
  function pickups() {
    for (const f of flakesNear(s.x, s.z, 8)) {
      if (Math.abs(f.x - s.x) < 1.7 && Math.abs(f.z - s.z) < 1.7 && Math.abs(s.y + 0.9 - f.y) < 1.7) {
        got.add(f.key); s.flakes++; award(f.gold ? 250 : 50, 'pickup', { gold: f.gold });
      }
    }
  }
  function land() {
    const [hx, hz] = T.grad(s.x, s.z);
    const vg = s.vx * hx + s.vz * hz;                      // ground vertical rate under our path
    const impact = (vg - s.vy) / Math.sqrt(1 + hx * hx + hz * hz);
    const rs = wrapPi(s.spin), rf = wrapPi(s.flip);
    const spins = Math.round(Math.abs(s.spin) / TAU), flips = Math.round(Math.abs(s.flip) / TAU);
    const airT = s.airT, grab = s.grabT;
    s.air = false; s.y = T.height(s.x, s.z); s.vy = vg;
    s.yaw = clamp(s.yaw + rs, -1.5, 1.5); s.spin = s.flip = s.spinR = s.flipR = 0; s.airT = 0; s.grabT = 0;
    if (Math.abs(rs) > 0.8 || Math.abs(rf) > 0.75) { crash(Math.abs(rf) > 0.75 ? 'Faceplant!' : 'Sideways landing!'); return; }
    if (impact > 17) { crash('Too much air!'); return; }
    emit({ type: 'land', impact, airT });
    let pts = 0; const name = [];
    if (flips) { pts += 600 * flips + 250 * flips * (flips - 1); name.push((flips > 1 ? (flips === 2 ? 'Double ' : 'Triple ') : '') + (s.lastFlipDir > 0 ? 'Backflip' : 'Frontflip')); }
    if (spins) { pts += 300 * spins + 150 * spins * (spins - 1); name.push(String(spins * 360)); }
    if (grab > 0.3) { pts += Math.round(120 + 220 * grab); name.push(spins || flips ? 'Grab' : 'Mute Grab'); }
    if (airT > 0.9) { pts += Math.round(110 * airT); if (!name.length) name.push('Big Air'); }
    if (pts) {
      const p = award(pts, 'trick', { name: name.join(' '), air: airT, n: spins + flips + (grab > 0.3 ? 1 : 0) });
      s.tricks++; if (p > s.bestPts) { s.bestPts = p; s.bestTrick = name.join(' '); }
    }
    s.speedLoss = Math.min(0.15, impact * 0.008); s.vx *= 1 - s.speedLoss; s.vz *= 1 - s.speedLoss;
  }

  // ---- one physics step. input: { steer -1..1, up, down, jump, grab }
  function step(dt, inp) {
    if (s.over) return;
    s.time += dt;
    if (s.chainT > 0 && (s.chainT -= dt) <= 0) s.chain = 0;
    yetiStep(dt);
    if (s.crashT > 0) {
      s.crashT -= dt; s.x += s.vx * dt; s.z += s.vz * dt; s.y = T.height(s.x, s.z);
      if (s.crashT <= 0) { if (s.lives <= 0) gameOver('Out of lives - ' + ({ 'Tree!': 'wrapped around a tree', 'Rock!': 'found a rock', 'Stump!': 'tripped on a stump', 'Faceplant!': 'faceplanted', 'Sideways landing!': 'landed sideways', 'Too much air!': 'too much air' }[s.why] || 'wiped out')); else { s.inv = 1.6; s.yaw = 0; s.vx = 0; s.vz = -3; } }
      return;
    }
    if (s.inv > 0) s.inv -= dt;
    const zPrev = s.z;
    s.jumpCool -= dt;
    if (!s.air) {
      const [hx, hz] = T.grad(s.x, s.z), q = 1 + hx * hx + hz * hz;
      s.vx += -G * hx / q * dt; s.vz += -G * hz / q * dt;
      s.tuck = !!inp.up; s.brake += ((inp.down ? 1 : 0) - s.brake) * Math.min(1, dt * 6);
      s.lean += (clamp(inp.steer, -1, 1) - s.lean) * Math.min(1, dt * 7);
      const sp = Math.hypot(s.vx, s.vz);
      s.yaw = clamp(s.yaw + s.lean * (2.3 - Math.min(1, sp / 32) * 1.1) * dt, -1.5, 1.5);
      const dx = Math.sin(s.yaw), dz = -Math.cos(s.yaw), rx = Math.cos(s.yaw), rz = Math.sin(s.yaw);
      let va = s.vx * dx + s.vz * dz, vl = s.vx * rx + s.vz * rz;
      const k = Math.exp(-(7 - 4 * s.brake) * dt), lost = vl * (1 - k);
      vl *= k; if (va >= 0) va += Math.abs(lost) * 0.55 * (1 - s.brake);
      const mu = s.tuck ? 0.03 : 0.05 + 0.42 * s.brake;
      va -= Math.sign(va) * Math.min(Math.abs(va), mu * G * dt);
      va -= (s.tuck ? 0.0023 : 0.0042 + 0.006 * s.brake) * va * Math.abs(va) * dt;
      if (s.tuck && sp < 7) va += 2.6 * dt;   // skate / pole push
      if (va < 0) va *= Math.exp(-3 * dt);
      s.vx = dx * va + rx * vl; s.vz = dz * va + rz * vl;
      const yPrev = s.y;
      s.x += s.vx * dt; s.z += s.vz * dt;
      const h = T.height(s.x, s.z), yb = s.y + s.vy * dt - 0.5 * G * dt * dt;
      if (inp.jump && s.jumpCool <= 0) { s.air = true; s.vy = Math.max(s.vy, 0) * 0.6 + 4.8 + (h - yPrev) / dt * 0.4; s.y = h + 0.02; s.jumpCool = 0.4; emit({ type: 'jump' }); }
      else if (yb > h + 0.1 && s.jumpCool <= 0.25) { s.air = true; s.y = yb; s.vy -= G * dt; }
      else { s.vy = clamp((h - yPrev) / dt, -40, 40); s.y = h; }
    } else {
      s.airT += dt; s.vy -= G * dt;
      const sp = Math.hypot(s.vx, s.vz), dr = 1 - 0.0012 * sp * dt;
      s.vx *= dr; s.vz *= dr;
      // tricks: steer spins, up/down flips, grab held
      const st = clamp(inp.steer, -1, 1);
      if (Math.abs(st) > 0.1) s.spinR += (st * 7.2 - s.spinR) * Math.min(1, dt * 6);
      else s.spinR = clamp((Math.round(s.spin / TAU) * TAU - s.spin) * 5, -6, 6);
      const fl = inp.up ? -1 : inp.down ? 1 : 0;
      if (fl) { s.flipR += (fl * 6.4 - s.flipR) * Math.min(1, dt * 6); s.lastFlipDir = fl; }
      else s.flipR = clamp((Math.round(s.flip / TAU) * TAU - s.flip) * 5, -6, 6);
      s.spin += s.spinR * dt; s.flip += s.flipR * dt;
      if (inp.grab) s.grabT += dt;
      s.lean *= Math.exp(-4 * dt);
      s.x += s.vx * dt; s.z += s.vz * dt; s.y += s.vy * dt;
      if (s.y <= T.height(s.x, s.z)) land();
    }
    if (s.crashT <= 0 && s.inv <= 0) collide();
    if (s.crashT <= 0) pickups();
    // slalom gates
    for (const g of gatesNear(s.z, 4)) if (zPrev > g.z && s.z <= g.z) {
      if (Math.abs(s.x - g.x) < g.w / 2) { s.gates++; award(150, 'gate', {}); } else emit({ type: 'miss' });
    }
    s.dist = Math.max(s.dist, s.startZ - s.z);
    s.maxSpeed = Math.max(s.maxSpeed, Math.hypot(s.vx, s.vz));
  }
  function yetiStep(dt) {
    const y = s.yeti;
    if (!y.on) {
      if (s.dist >= YETI_AT) { y.on = true; y.t = 0; y.x = s.x; y.z = s.z + 170; emit({ type: 'yeti' }); }
      else return;
    }
    y.t += dt;
    const sp = Math.min(44, 21 + y.t * 0.13) * (s.over ? 0 : 1);
    const dx = s.x - y.x, dz = s.z - y.z, d = Math.hypot(dx, dz);
    if (d > 0.01) { const m = Math.min(d, sp * dt); y.x += dx / d * m; y.z += dz / d * m; }
    y.dir = Math.atan2(dx, dz);
    y.y = T.height(y.x, y.z) + Math.abs(Math.sin(y.t * 7)) * 0.9;
    if (d < 400) y.d = d;
    if (Math.hypot(s.x - y.x, s.z - y.z) < 2.3 && !s.over) { gameOver('Eaten by the Holler Yeti'); emit({ type: 'eaten' }); }
  }
  return { s, step, reset, events, score, mult, speed, flakesNear, gatesNear, crash, yetiDist: () => s.yeti.on ? Math.hypot(s.x - s.yeti.x, s.z - s.yeti.z) : -1, YETI_AT };
}
