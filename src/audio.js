// Procedural sound: wind rush by speed, carve swish, pickup chimes, thuds and the yeti. Starts only after a click.
export class Sfx {
  constructor() { this.ctx = null; this.on = false; }
  start() {
    if (this.ctx) { this.ctx.resume(); this.on = true; return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 3, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b = (b + 0.02 * w) / 1.02; d[i] = w * 0.5 + b * 4; }
    this.buf = buf;
    const loop = (type, f, q) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 2);
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = ctx.createGain(); g.gain.value = 0;
      s.connect(fl).connect(g).connect(this.master); return { f: fl, g }; };
    this.wind = loop('lowpass', 300, 0.8);
    this.carve = loop('bandpass', 1800, 1.4);
    this.growl = ctx.createOscillator(); this.growl.type = 'sawtooth'; this.growl.frequency.value = 55;
    this.growlG = ctx.createGain(); this.growlG.gain.value = 0;
    const gf = ctx.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 380;
    this.growl.connect(gf).connect(this.growlG).connect(this.master); this.growl.start();
    this.on = true;
  }
  stop() { if (this.ctx) { this.on = false; this.ctx.suspend(); } }
  update(st) {   // ~10 Hz
    if (!this.on) return;
    const t = this.ctx.currentTime, v = Math.min(st.speed / 30, 1.2);
    this.wind.g.gain.setTargetAtTime(0.05 + 0.35 * v * v * (st.air ? 1.3 : 1), t, 0.2);
    this.wind.f.frequency.setTargetAtTime(250 + 1400 * v, t, 0.3);
    this.carve.g.gain.setTargetAtTime(st.air || st.down ? 0 : Math.min(0.35, (Math.abs(st.lean) * 0.6 + st.brake) * v * 0.6 + 0.02 * v), t, 0.08);
    this.carve.f.frequency.setTargetAtTime(1200 + 1600 * Math.abs(st.lean) + 900 * st.brake, t, 0.1);
    const y = st.yeti > 0 ? Math.max(0, 1 - st.yeti / 90) : 0;
    this.growlG.gain.setTargetAtTime(0.14 * y * (0.6 + 0.4 * Math.sin(t * 7)), t, 0.1);
    this.growl.frequency.setTargetAtTime(48 + 20 * y + 8 * Math.sin(t * 3), t, 0.2);
  }
  tone(f, dur, type = 'sine', vol = 0.12, slide = 1, when = 0) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime + when, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * slide, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  }
  thud(vol = 0.5, f = 400) {
    if (!this.on) return;
    const ctx = this.ctx, t = ctx.currentTime, s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = this.buf; fl.type = 'lowpass'; fl.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    s.connect(fl).connect(g).connect(this.master); s.start(t, Math.random()); s.stop(t + 0.45);
  }
  pickup(gold) { const b = gold ? 660 : 990; [0, 4, 7, 12].slice(0, gold ? 4 : 2).forEach((n, i) => this.tone(b * 2 ** (n / 12), 0.25, 'triangle', 0.09, 1, i * 0.06)); }
  gate() { this.tone(523, 0.18, 'square', 0.05); this.tone(784, 0.3, 'square', 0.05, 1, 0.09); }
  trick(n) { for (let i = 0; i < Math.min(n, 5); i++) this.tone(440 * 2 ** ((i * 4) / 12), 0.2, 'triangle', 0.08, 1, i * 0.07); }
  crash() { this.thud(0.9, 260); this.tone(220, 0.5, 'sawtooth', 0.06, 0.4); }
  roar() { this.tone(90, 1.2, 'sawtooth', 0.25, 0.6); this.thud(0.8, 150); }
}
