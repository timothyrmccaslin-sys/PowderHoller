// GLSL ES 3.00 shaders for Powder Holler (adapted from HYOH).
const HEAD = `#version 300 es
precision highp float;
precision highp int;
`;

export const COMMON = `
uniform mat4 uViewProj;
uniform vec3 uCam;          // camera position (floating-origin space)
uniform float uTime;
uniform vec3 uSunDir, uSunCol, uSkyCol, uHazeCol, uZenith, uMistCol;
uniform float uHazeDen, uMistDen, uMistH, uMistScale;
uniform vec2 uOriginMod;    // origin modulo a large period, for stable world-space noise

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
uniform sampler2D uNoise;   // 256x256 RG noise; G is R shifted by (37,17) so one fetch gives 3D value noise
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); return textureLod(uNoise, (i + f + .5) / 256., 0.).r; }
float vnoise3(vec3 x){ vec3 p = floor(x), f = fract(x); f = f*f*(3.-2.*f);
  vec2 uv = p.xy + vec2(37., 17.) * p.z + f.xy; vec2 rg = textureLod(uNoise, (uv + .5) / 256., 0.).yx; return mix(rg.x, rg.y, f.z); }
float fbm2(vec2 p){ float s = 0., a = .5; for(int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + 17.1; a *= .5; } return s / .9375; }

vec3 skyColor(vec3 rd){
  float y = max(rd.y, 0.);
  vec3 c = mix(uHazeCol, uZenith, pow(y, 0.5));
  float s = max(dot(rd, uSunDir), 0.);
  c += uSunCol * (0.12 * pow(s, 6.) + 0.4 * pow(s, 48.));
  return c;
}

// Aerial perspective: uniform blue haze + exponential valley mist, with sun forward-scatter.
vec3 applyFog(vec3 col, vec3 wp){
  vec3 rd = wp - uCam; float d = length(rd); rd /= max(d, 1e-3);
  float od = uHazeDen * d;
  float b = 1. / uMistScale;
  float k = rd.y * b * d;
  float f = abs(k) > 1e-4 ? (1. - exp(-k)) / k : 1.;
  float mi = uMistDen * exp(-(uCam.y - uMistH) * b) * d * f;
  mi = min(mi, 20.);
  float tot = od + mi;
  // red fades first, so far ridges sink into blue
  vec3 T = exp(-(od * vec3(1.55, 1.0, 0.62) + mi));
  float s = max(dot(rd, uSunDir), 0.);
  vec3 haze = mix(uHazeCol, uMistCol, mi / (tot + 1e-5)) + uSunCol * (0.07 * pow(s, 6.));
  return col * T + haze * (1. - T);
}

vec3 leafColor(float sp, float seed, out float leafOn){
  leafOn = 1.;
  int s = int(sp + .5);
  float v = seed;
  if (s == 4) return mix(vec3(.035,.075,.045), vec3(.05,.10,.06), v);              // red spruce
  if (s == 5) return mix(vec3(.05,.10,.055), vec3(.07,.13,.07), v);                // Fraser fir
  leafOn = 0.;                  // winter: deciduous bare
  return vec3(.2,.17,.15);
}

// Wind sway: more at the crown, phase varies across the hillside, slow gusts.
vec2 wind(vec2 p, float h, float t, float stiff){
  float ph = dot(p, vec2(.021, .013));
  float gust = 0.6 + 0.4 * sin(t * 0.23 + p.x * 0.004 + p.y * 0.003);
  float a = 0.035 * pow(max(h, 0.), 1.1) * stiff * gust;
  return a * (vec2(sin(t * 0.9 + ph), cos(t * 0.7 + ph * 1.2)) + 0.4 * vec2(sin(t * 2.1 + ph * 3.), cos(t * 1.8 + ph * 2.)));
}
`;

const FULLSCREEN_VS = HEAD + `
out vec2 vUV;
void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); vUV = p; gl_Position = vec4(p * 2. - 1., 0., 1.); }
`;

export const SKY = {
  vs: FULLSCREEN_VS,
  fs: HEAD + COMMON + `
in vec2 vUV; out vec4 o;
uniform vec3 uFwd, uRight, uUp; uniform vec2 uTan;
void main(){
  vec3 rd = normalize(uFwd + (vUV.x * 2. - 1.) * uTan.x * uRight + (vUV.y * 2. - 1.) * uTan.y * uUp);
  vec3 c = skyColor(rd);
  float s = max(dot(rd, uSunDir), 0.);
  c += uSunCol * smoothstep(0.99965, 0.99985, s) * 12.;
  // soft cumulus on a high plane
  if (rd.y > 0.01) {
    vec2 cp = rd.xz / (rd.y + 0.08) * 1.2 + vec2(uTime * 0.004, uTime * 0.002) + uOriginMod * 0.00005;
    float cl = smoothstep(0.52, 0.8, fbm2(cp * 1.3));
    float fade = smoothstep(0.01, 0.25, rd.y);
    vec3 cc = mix(vec3(0.85, 0.87, 0.9), uSunCol * 0.9 + 0.4, 0.3 + 0.4 * pow(s, 4.));
    c = mix(c, cc * (0.85 + 0.15 * fbm2(cp * 4.)), cl * fade * 0.85);
  }
  o = vec4(c, 1.);
}`
};

export const TERRAIN = {
  vs: HEAD + COMMON + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aAttr;
uniform vec3 uOffset;
out vec3 vWP; out vec3 vN; out vec2 vAttr;
void main(){ vec3 wp = aPos + uOffset; vWP = wp; vN = aNrm; vAttr = aAttr; gl_Position = uViewProj * vec4(wp, 1.); }`,
  fs: HEAD + COMMON + `
in vec3 vWP; in vec3 vN; in vec2 vAttr; out vec4 o;
void main(){
  vec3 n = normalize(vN);
  vec2 p = vWP.xz + uOriginMod;
  float d = length(vWP - uCam);
  float kick = vAttr.x, forest = vAttr.y;
  float slope = 1. - n.y;
  vec3 p3 = vec3(p.x, vWP.y, p.y);
  float n1 = fbm2(p * 0.07), n2 = mix(.5, vnoise3(p3 * 0.6) * .6 + vnoise3(p3 * 2.3) * .4, 1. - smoothstep(40., 160., d));
  // wind-packed snow with soft drifts, a hint of blue in the hollows
  float near = 1. - smoothstep(25., 90., d);
  // wind ripples: perturb the normal close up
  vec2 rp = p * vec2(1.6, 0.55);
  n = normalize(n + near * 0.12 * vec3(vnoise(rp) - .5, 0., vnoise(rp + 9.1) - .5));
  vec3 snow = vec3(.8, .83, .89) * (0.9 + 0.12 * n2) * mix(vec3(1.), vec3(.88, .94, 1.06), smoothstep(.4, .8, n1));
  // carved S-turn tracks of earlier skiers along the fall line
  float tr = 0.;
  for (int i = 0; i < 3; i++) {
    float fi = float(i), x = p.x + 7. * sin(p.y * (0.05 + fi * 0.013) + fi * 2.1) + fi * 17.3;
    float c = abs(mod(x, 26. + fi * 7.) - 13.);
    tr = max(tr, smoothstep(.1, .03, abs(c - .16)) * step(.5, vnoise(vec2(fi * 13., p.y * 0.01))));
  }
  snow *= 1. - tr * 0.22 * (1. - forest) * (1. - smoothstep(40., 110., d));
  // groomed corduroy on kickers
  snow = mix(snow, vec3(.62, .74, .9) * (0.9 + 0.1 * sin(p.x * 9.)), smoothstep(0., .1, kick) * 0.8);
  snow = mix(snow, vec3(.95, .25, .08), smoothstep(.8, .97, kick) * .85);   // dye line at the lip
  vec3 rock = vec3(.2, .19, .18) * (0.7 + 0.5 * n2);
  float rockAmt = smoothstep(0.52, 0.75, slope + (n1 - .5) * 0.35);
  vec3 alb = mix(snow, rock, rockAmt * 0.85);
  // distant snowy spruce-fir forest painted on the ridges
  float far = smoothstep(120., 520., d) * forest;
  float lump = fbm2(p * 0.06);
  vec3 can = mix(vec3(.05, .075, .06), vec3(.62, .66, .7), smoothstep(.45, .75, fbm2(p * 0.035 + 3.)) * .55 + .15 * lump);
  can *= (0.6 + 0.6 * lump) * mix(1., 0.75, smoothstep(600., 4000., d));
  alb = mix(alb, can, far);
  float ndl = max(dot(n, uSunDir), 0.);
  vec3 lit = alb * (uSunCol * ndl * 1.4 + uSkyCol * (0.32 + 0.33 * n.y));
  // sun glints in the snow
  if (d < 35.) { vec2 gc = p * 22.; vec2 gi = floor(gc); float g = hash12(gi + floor(uTime * 3.)); lit += uSunCol * step(0.993, g) * step(length(fract(gc) - .5), .22) * 3. * near * ndl; }
  o = vec4(applyFog(lit, vWP), 1.);
}`
};

export const INST = {
  vs: HEAD + COMMON + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNrm; layout(location=2) in vec2 aPart;
layout(location=3) in vec4 iA; layout(location=4) in vec4 iB;
out vec3 vWP; out vec3 vN; out vec3 vLP; flat out vec3 vCol; flat out float vPart; flat out float vSp; out float vH; flat out float vSd;
void main(){
  float sp = iB.z, seed = iB.w;
  float leafOn; vec3 lc = leafColor(sp, seed, leafOn);
  vPart = aPart.x; vSp = sp;
  bool decid = sp < 3.5 || abs(sp - 6.) < .1;
  if (aPart.x > .5 && aPart.x < 1.5 && decid && leafOn < .5) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec3 p = aPos * vec3(iB.x, iB.y, iB.x);
  if (sp > 8.5 && sp < 9.5) p = aPos * vec3(iB.x, iB.y, iB.x * (0.7 + seed * 0.6));
  if (aPart.x > 5.5 && sp > 10.5 && sp < 11.5) p.z += sin(uTime * 9. + aPos.x * 12. + seed * 9.) * 0.035 * aPos.x * iB.x;
  float c = cos(iA.w), s = sin(iA.w);
  p.xz = mat2(c, -s, s, c) * p.xz;
  vec3 nr = aNrm; nr.xz = mat2(c, -s, s, c) * nr.xz;
  vec2 wpos = iA.xz + uOriginMod;
  if (aPart.x < .5 && decid && leafOn > .5 && aPos.y > 0.3) p.xz *= 0.55;   // keep limbs inside the leafy crown
  if (sp < 8.5) {
    float stiff = aPart.x > .5 ? 1. : 0.45;
    if (sp > 6.5) stiff = 1.6;
    p.xz += wind(wpos, aPos.y * iB.y, uTime, stiff) * (aPos.y * aPos.y) * (sp > 6.5 ? 0.6 : 1.);
  }
  vec3 wp = iA.xyz + p;
  vWP = wp; vN = nr; vLP = sp > 10.5 ? aPos : aPos + seed * 13.; vCol = lc; vH = aPart.y; vSd = seed;
  gl_Position = uViewProj * vec4(wp, 1.);
}`,
  fs: HEAD + COMMON + `
in vec3 vWP; in vec3 vN; in vec3 vLP; flat in vec3 vCol; flat in float vPart; flat in float vSp; in float vH; flat in float vSd; out vec4 o;
uniform float uCut, uFadeW, uSnow;
void main(){
  vec3 tc = vWP - uCam; float d = length(tc); vec3 v = tc / d;
  float dith = hash12(gl_FragCoord.xy);
  if (d > uCut + (dith - .5) * uFadeW) discard;
  if (vPart > .5 && vPart < 1.5 && d < 1.4) discard;   // don't fill the view with needles you are standing in
  vec3 n = normalize(vN);
  vec3 alb; float trans = 0.;
  if (vPart < .5) {            // bark
    float br = vnoise(vec2(atan(n.z, n.x) * 3., vLP.y * 40.));
    alb = mix(vec3(.07, .06, .05), vec3(.16, .15, .13), br);
    if (vSp > 4.5 && vSp < 5.5) alb *= 0.8;
  } else if (vPart < 1.5) {    // foliage
    float lf = vnoise3(vLP * 26.) * .55 + vnoise3(vLP * 70.) * .45;
    float rim = 1. - abs(dot(n, v));
    if (rim > 0.4 + 0.55 * lf) discard;              // ragged leafy silhouette
    bool con = vSp > 3.5 && vSp < 5.5;
    if (con && vnoise3(vLP * 90.) < 0.32) discard;    // needle sprays
    alb = vCol * (0.45 + 1.0 * lf * lf + 0.15);
    alb *= mix(0.55, 1.1, smoothstep(0.35, 0.95, vH)); // inner crown darker
    if (uSnow > 0. && n.y > .3) alb = mix(alb, vec3(.85), smoothstep(.5, .9, n.y) * uSnow * 0.7);
    trans = 1.;
  } else if (vPart > 2.5) {   // props: fur, face, pole, cloth
    if (vPart < 3.5) alb = vec3(.66, .68, .74) * (0.55 + 0.6 * vnoise3(vLP * 70.));
    else if (vPart < 4.5) alb = vec3(.02);
    else if (vPart < 5.5) alb = fract(vLP.y * 5.) < .5 ? vec3(.9) : (vSp > 11.5 ? vec3(.6, .05, .04) : vec3(.05));
    else alb = 1.6 * (vSp > 11.5 ? vec3(.7, .04, .05) : vSd < .4 ? vec3(.8, .06, .04) : vSd < .75 ? vec3(.06, .16, .8) : vec3(1., .45, .02));
  } else {                     // rock
    float rn = vnoise3(vLP * 5.) * .6 + vnoise3(vLP * 17.) * .4;
    alb = vec3(.19, .185, .175) * (0.6 + 0.7 * rn);
    alb = mix(alb, vec3(.82, .85, .9), smoothstep(0.45, 0.8, n.y + (rn - .5) * .6));
  }
  float ndl = dot(n, uSunDir);
  float diff = trans > 0. ? clamp(ndl * .6 + .4, 0., 1.) : max(ndl, 0.);
  float back = trans * pow(max(dot(v, uSunDir), 0.), 4.) * 0.6;
  vec3 lit = alb * (uSunCol * (diff + back) + uSkyCol * (0.5 + 0.5 * n.y) * (0.55 + 0.45 * vH));
  o = vec4(applyFog(lit, vWP), 1.);
}`
};

export const BILLBOARD = {
  vs: HEAD + COMMON + `
layout(location=0) in vec2 aCorner; layout(location=3) in vec4 iA; layout(location=4) in vec4 iB;
out vec2 vUV; out vec3 vWP; flat out vec3 vCol; flat out float vSp; flat out float vLeaf; flat out float vSeed;
uniform float uMinD;
void main(){
  vec3 to = iA.xyz - uCam; to.y = 0.;
  float dd = length(to);
  if (dd < uMinD) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec3 right = normalize(vec3(-to.z, 0., to.x));
  float w = iB.x * 1.4, h = iB.y * 1.02;
  vec3 wp = iA.xyz + right * aCorner.x * w + vec3(0., aCorner.y * h, 0.);
  wp.xz += wind(iA.xz + uOriginMod, aCorner.y * h, uTime, 1.) * aCorner.y * aCorner.y;
  float leafOn; vCol = leafColor(iB.z, iB.w, leafOn); vLeaf = leafOn; vSp = iB.z; vSeed = iB.w;
  vUV = vec2(aCorner.x + .5, aCorner.y); vWP = wp;
  gl_Position = uViewProj * vec4(wp, 1.);
}`,
  fs: HEAD + COMMON + `
in vec2 vUV; in vec3 vWP; flat in vec3 vCol; flat in float vSp; flat in float vLeaf; flat in float vSeed; out vec4 o;
uniform float uCut, uFadeW;
void main(){
  vec3 tc = vWP - uCam; float d = length(tc);
  float dith = hash12(gl_FragCoord.xy);
  if (d < uCut + (dith - .5) * uFadeW) discard;
  vec2 q = vUV;
  float x = q.x - .5;
  bool con = vSp > 3.5 && vSp < 5.5;
  float nz = vnoise(q * 9. + vSeed * 31.) * .6 + vnoise(q * 23. + vSeed * 7.) * .4;
  float inside; vec3 col; float sh;
  if (con) {
    float wdt = (1. - q.y) * 0.5 * (0.75 + 0.5 * nz);
    inside = step(q.y, .99) * step(.12, q.y) * step(abs(x), wdt);
    col = vCol; sh = 0.7 + 0.3 * q.y - abs(x) * .3;
  } else {
    vec2 c = (q - vec2(.5, .66)) / vec2(.5, .34);
    float r = length(c);
    inside = step(r, 0.82 + 0.3 * (nz - .5) * 2.);
    if (vLeaf < .5) {   // bare winter crown: sparse grey twigs
      inside *= step(0.55, vnoise(q * 40. + vSeed * 9.)) * step(r, 0.9);
    }
    col = vCol; sh = 0.65 + 0.35 * (c.y * .5 + .5) + (nz - .5) * .4;
  }
  float trunk = step(abs(x), 0.035) * step(q.y, 0.4);
  if (inside < .5 && trunk < .5) discard;
  if (inside < .5) { col = vec3(.08, .07, .06); sh = 0.7; }
  float sunSide = 0.6 + 0.4 * max(dot(normalize(vec3(x, 0., 0.)), uSunDir), 0.);
  vec3 lit = col * (uSunCol * 0.55 * sh * sunSide + uSkyCol * 0.6 * sh);
  o = vec4(applyFog(lit, vWP), 1.);
}`
};

export const RAYS = {
  vs: FULLSCREEN_VS,
  fs: HEAD + `
in vec2 vUV; out vec4 o;
uniform sampler2D uDepth; uniform vec2 uSunUV; uniform float uScale;
uniform vec3 uFwd, uRight, uUp, uSunDir; uniform vec2 uTan;
float src(vec2 uv){
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 0.;
  float dd = texture(uDepth, uv * uScale).r;
  if (dd < 0.99999) return 0.;
  vec3 rd = normalize(uFwd + (uv.x * 2. - 1.) * uTan.x * uRight + (uv.y * 2. - 1.) * uTan.y * uUp);
  return pow(max(dot(rd, uSunDir), 0.), 28.);
}
void main(){
  vec2 dir = uSunUV - vUV;
  float acc = 0., w = 1., tw = 0.;
  float j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  for (int i = 0; i < 40; i++) {
    float t = (float(i) + j) / 40.;
    acc += src(vUV + dir * t) * w; tw += w; w *= 0.96;
  }
  o = vec4(acc / tw, 0., 0., 1.);
}`
};

export const FINAL = {
  vs: FULLSCREEN_VS,
  fs: HEAD + `
in vec2 vUV; out vec4 o;
uniform sampler2D uScene, uRays; uniform float uScale, uRayStr, uTime, uExposure, uVig; uniform vec3 uSunCol; uniform vec2 uPx; uniform vec4 uFlash;
vec3 tone(vec3 x){ x *= uExposure; x = clamp((x * (2.51 * x + .03)) / (x * (2.43 * x + .59) + .14), 0., 1.); return pow(x, vec3(1. / 2.2)); }
vec3 at(vec2 uv){ return texture(uScene, uv * uScale).rgb + uSunCol * texture(uRays, uv * uScale).r * uRayStr; }
void main(){
  vec3 c = tone(at(vUV));
  // gentle unsharp mask applied after tonemapping, so bright sky edges do not ring
  vec2 px = uPx / uScale;
  vec3 nb = tone(at(vUV + vec2(px.x, 0.))) + tone(at(vUV - vec2(px.x, 0.))) + tone(at(vUV + vec2(0., px.y))) + tone(at(vUV - vec2(0., px.y)));
  c = clamp(c + (c - nb * .25) * .35, 0., 1.);
  // soft S-curve and a touch of saturation
  c = mix(c, c * c * (3. - 2. * c), .3);
  c = mix(vec3(dot(c, vec3(.27, .6, .13))), c, 1.08);
  vec2 q = vUV - .5;
  c *= 1. - dot(q, q) * (0.5 + uVig);
  c = mix(c, uFlash.rgb, uFlash.a * (0.35 + dot(q, q) * 1.6));
  float g = fract(sin(dot(gl_FragCoord.xy + fract(uTime) * 61., vec2(12.9898, 78.233))) * 43758.5453);
  c += (g - .5) * 0.016;
  o = vec4(c, 1.);
}`
};

// Falling snow that wraps around the camera.
export const PARTICLES = {
  vs: HEAD + COMMON + `
layout(location=0) in vec4 aP;   // xyz in [0,1) box, w = random
uniform float uBox, uPx, uFall;
out float vA;
void main(){
  float r = aP.w;
  vec3 drift = vec3(sin(uTime * (0.3 + r * 0.4) + r * 40.) * 0.6 + 0.4, -uFall * (0.6 + r * 0.8), cos(uTime * (0.25 + r * 0.3) + r * 17.) * 0.6) * uTime;
  vec3 rel = mod(aP.xyz * uBox + drift - uCam, uBox) - uBox * 0.5;
  vec4 cp = uViewProj * vec4(uCam + rel, 1.);
  float d = length(rel);
  gl_PointSize = clamp(0.09 * (0.6 + r * 0.8) * uPx / max(cp.w, 0.1), 1., 24.);
  vA = 0.9 * smoothstep(uBox * 0.5, uBox * 0.3, d) * smoothstep(0.3, 1.2, d);
  gl_Position = cp;
}`,
  fs: HEAD + `
in float vA; out vec4 o;
void main(){ vec2 q = gl_PointCoord * 2. - 1.; if (dot(q, q) > 1. || vA < 0.02) discard; o = vec4(vec3(1.4) * vA, vA); }`
};

// Glowing snowflake pickups (point sprites, additive)
export const SPRITES = {
  vs: HEAD + `
layout(location=0) in vec4 aP;   // xyz (origin-relative), w = kind (0 flake, 1 gold)
uniform mat4 uViewProj; uniform vec3 uCam; uniform float uPx, uTime;
out float vK; out float vRot; out float vFade;
void main(){
  vec3 wp = aP.xyz + vec3(0., sin(uTime * 2.5 + aP.x * .7 + aP.z * .3) * .15, 0.);
  vec4 cp = uViewProj * vec4(wp, 1.);
  float d = length(wp - uCam);
  gl_PointSize = clamp((aP.w > .5 ? 1.5 : 1.15) * uPx / max(cp.w, .1), 2., 160.);
  vK = aP.w; vRot = uTime * 1.6 + aP.x; vFade = smoothstep(260., 150., d);
  gl_Position = cp;
}`,
  fs: HEAD + `
in float vK; in float vRot; in float vFade; out vec4 o;
void main(){
  vec2 q = gl_PointCoord * 2. - 1.;
  float r = length(q); if (r > 1.) discard;
  float a = atan(q.y, q.x) + vRot;
  float arms = pow(abs(cos(a * 3.)), 18.) * smoothstep(.95, .2, r);
  float tips = pow(abs(cos(a * 3.)), 40.) * smoothstep(.12, .0, abs(r - .55)) ;
  float core = exp(-r * r * 22.), halo = exp(-r * r * 5.) * .35;
  vec3 col = vK > .5 ? vec3(1., .62, .05) : vec3(.08, .45, 1.);
  float body = clamp(arms + tips + core * 1.4 + halo, 0., 1.) * vFade;
  vec3 c = mix(col, vec3(1.4), core) * (1. + halo);
  o = vec4(c * body, body);
}`
};
