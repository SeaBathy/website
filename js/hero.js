// The hero: real seabed from the IMAS 10 m bathymetry composite (central Great Barrier
// Reef, resampled to 512 x 512), drawn with plain WebGL2. It turns slowly, swells and
// flattens its vertical exaggeration and cross-fades between colour palettes, on a loop.
// No libraries. Falls back to a still picture without WebGL2, and holds still for
// people who ask their system for reduced motion.

const SIZE = 512;                 // heights file: SIZE x SIZE little-endian Int16, decimetres (negative = depth)
const AREA_KM = 60.4;             // the tile's width on the ground
const DATA_URL = 'data/central-gbr.bin';

const PALETTES = [
  // Shallow -> deep.
  { name: 'Spectrum', stops: ['#c8102e', '#f0582a', '#f8b62b', '#f4e04d', '#5fd38d', '#19b6c9', '#1f6fd1', '#20307a', '#0e1440'] },
  { name: 'Lagoon', stops: ['#f2fbf6', '#a8eedc', '#4fd1c5', '#14a3a8', '#0e7490', '#0b4f72', '#0a3352', '#071d33', '#050f1f'] },
  { name: 'Thermal', stops: ['#fff5b8', '#ffd17a', '#ff9f5a', '#f2645c', '#d23c78', '#9c2a8c', '#5f2186', '#2e155f', '#120a2b'] },
  { name: 'Chart', stops: ['#d9c58f', '#7fc0d8', '#5aa6d4', '#7db8e0', '#a3cdea', '#c4e0f2', '#dfeefa', '#eff7fd', '#fbfdff'] }
];

const canvas = document.getElementById('hero-canvas');
const root = document.documentElement;
const readoutExag = document.getElementById('hero-exag');
const readoutPalette = document.getElementById('hero-palette');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

start().catch((error) => {
  console.warn('3D hero unavailable:', error);
  root.classList.add('no-webgl');
});

async function start() {
  const gl = canvas && canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) throw new Error('WebGL2 not available');

  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`heights: HTTP ${response.status}`);
  const raw = new Int16Array(await response.arrayBuffer());
  if (raw.length !== SIZE * SIZE) throw new Error('heights: unexpected size');

  let min = Infinity;
  let max = -Infinity;
  for (const v of raw) { if (v < min) min = v; if (v > max) max = v; }
  const depthRange = (max - min) / 10;                     // metres
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) heights[i] = (raw[i] - min) / (max - min); // 0 deepest .. 1 shallowest

  // Colour spread: three parts "by how much seabed sits at each depth" (histogram equalised),
  // one part logarithmic, so the reefs, the lagoon floor and the drop-off each get their own colours.
  const bins = new Float32Array(256);
  for (const h of heights) bins[Math.min(255, Math.floor(h * 256))]++;
  const lut = new Float32Array(256);
  let below = 0;
  for (let i = 0; i < 256; i++) {
    below += bins[i];
    const h = (i + 0.5) / 256;
    const depth = (1 - h) * depthRange;
    const byArea = 1 - below / heights.length;
    const byLog = Math.log(1 + depth / 3) / Math.log(1 + depthRange / 3);
    lut[i] = Math.min(1, Math.max(0, 0.72 * byArea + 0.28 * byLog));
  }

  const program = link(gl, VERTEX, FRAGMENT);
  gl.useProgram(program);
  const u = uniforms(gl, program, ['uMvp', 'uH', 'uPal', 'uExag', 'uTexel', 'uLight', 'uEye', 'uPalA', 'uPalB', 'uMix', 'uDepthRange', 'uContour', 'uRows', 'uLut']);

  // Heights: half-float texture, filterable everywhere WebGL2 runs.
  const heightTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, heightTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, SIZE, SIZE, 0, gl.RED, gl.FLOAT, heights);
  setSampling(gl, gl.LINEAR);

  // Palettes: one row each, 256 wide.
  const palTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, palTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, PALETTES.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteBytes());
  setSampling(gl, gl.LINEAR);

  const lutTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 256, 1, 0, gl.RED, gl.FLOAT, lut);
  setSampling(gl, gl.LINEAR);

  // Grid mesh: lighter on phones; the pixel shader lights it from the full-resolution heights.
  const grid = innerWidth < 760 ? 220 : 340;
  const uvs = new Float32Array((grid + 1) * (grid + 1) * 2);
  for (let y = 0, k = 0; y <= grid; y++) for (let x = 0; x <= grid; x++) { uvs[k++] = x / grid; uvs[k++] = y / grid; }
  const indices = new Uint32Array(grid * grid * 6);
  for (let y = 0, k = 0; y < grid; y++) {
    for (let x = 0; x < grid; x++) {
      const a = y * (grid + 1) + x;
      const b = a + grid + 1;
      indices.set([a, b, a + 1, a + 1, b, b + 1], k);
      k += 6;
    }
  }
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, 'aUv');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  gl.uniform1i(u.uH, 0);
  gl.uniform1i(u.uPal, 1);
  gl.uniform1i(u.uLut, 2);
  gl.uniform2f(u.uTexel, 1 / SIZE, 1 / SIZE);
  gl.uniform1f(u.uDepthRange, depthRange);
  gl.uniform1f(u.uRows, PALETTES.length);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

  // One metre of relief, in tile widths, at true scale.
  const trueScale = depthRange / (AREA_KM * 1000);

  // Drag sideways to turn it; it carries on by itself afterwards.
  let dragOffset = 0;
  let dragging = null;
  canvas.addEventListener('pointerdown', (e) => { dragging = { x: e.clientX, start: dragOffset }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => { if (dragging) dragOffset = dragging.start + (e.clientX - dragging.x) * 0.006; });
  const endDrag = () => { dragging = null; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // One loop for the page's life; it only draws while the hero is on screen.
  // With reduced motion it draws a still frame, and again when the size changes.
  let visible = true;
  let needsStill = true;
  new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }).observe(canvas);
  addEventListener('resize', () => { needsStill = true; });

  let shownExag = '';
  let shownPalette = '';
  const t0 = performance.now();

  function loop(now) {
    requestAnimationFrame(loop);
    if (!visible) return;
    if (reduceMotion && !needsStill) return;
    needsStill = false;
    frame(now);
  }

  function frame(now) {
    const t = reduceMotion ? 6 : (now - t0) / 1000;
    resize(gl, canvas);

    // Slow orbit, gentle bob of the camera, breathing vertical exaggeration.
    const azimuth = -0.6 + t * (Math.PI * 2 / 90) + dragOffset;
    const elevation = 0.5 + 0.12 * Math.sin(t * 0.21);
    const exag = 9 + 7 * Math.sin(t * (Math.PI * 2 / 16) - Math.PI / 2) + 4;  // 6x .. 20x
    const heightScale = trueScale * exag;

    // Palette: 7 s each, the last 2.2 s a cross-fade into the next.
    const hold = 7;
    const fade = 2.2;
    const phase = t / hold;
    const a = Math.floor(phase) % PALETTES.length;
    const b = (a + 1) % PALETTES.length;
    const local = (phase - Math.floor(phase)) * hold;
    const mix = smoothstep(hold - fade, hold, local);

    const aspect = canvas.width / canvas.height;
    const narrow = aspect < 1.1;
    const radius = narrow ? 1.5 : 1.22;
    const target = [0, heightScale * 0.45, 0];
    const eye = [
      target[0] + radius * Math.cos(elevation) * Math.sin(azimuth),
      target[1] + radius * Math.sin(elevation),
      target[2] + radius * Math.cos(elevation) * Math.cos(azimuth)
    ];
    const mvp = multiply(perspective(narrow ? 0.72 : 0.6, aspect, 0.02, 20), lookAt(eye, target, [0, 1, 0]));

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(u.uMvp, false, mvp);
    gl.uniform1f(u.uExag, heightScale);
    gl.uniform3f(u.uLight, -0.55, 0.75, -0.35);
    gl.uniform3f(u.uEye, eye[0], eye[1], eye[2]);
    gl.uniform1f(u.uPalA, a);
    gl.uniform1f(u.uPalB, b);
    gl.uniform1f(u.uMix, mix);
    gl.uniform1f(u.uContour, 0.55);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);

    const exagText = `${Math.round(exag)}×`;
    if (readoutExag && exagText !== shownExag) { readoutExag.textContent = exagText; shownExag = exagText; }
    const palName = PALETTES[mix > 0.5 ? b : a].name;
    if (readoutPalette && palName !== shownPalette) { readoutPalette.textContent = palName; shownPalette = palName; }

    if (!root.classList.contains('hero-ready')) root.classList.add('hero-ready');
  }
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------ shaders

const VERTEX = `#version 300 es
in vec2 aUv;
uniform sampler2D uH;
uniform mat4 uMvp;
uniform float uExag;
out vec2 vUv;
out vec3 vPos;
void main() {
  float h = texture(uH, aUv).r;
  vec3 p = vec3(aUv.x - 0.5, h * uExag, aUv.y - 0.5);
  vUv = aUv;
  vPos = p;
  gl_Position = uMvp * vec4(p, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vPos;
uniform sampler2D uH;
uniform sampler2D uPal;
uniform sampler2D uLut;
uniform float uExag, uPalA, uPalB, uMix, uDepthRange, uContour, uRows;
uniform vec2 uTexel;
uniform vec3 uLight, uEye;
out vec4 outColour;

vec3 palette(float row, float t) { return texture(uPal, vec2(t, (row + 0.5) / uRows)).rgb; }

void main() {
  float h = texture(uH, vUv).r;
  float hx = texture(uH, vUv + vec2(uTexel.x, 0.0)).r - texture(uH, vUv - vec2(uTexel.x, 0.0)).r;
  float hy = texture(uH, vUv + vec2(0.0, uTexel.y)).r - texture(uH, vUv - vec2(0.0, uTexel.y)).r;
  vec3 n = normalize(vec3(-hx * uExag / (2.0 * uTexel.x), 1.0, -hy * uExag / (2.0 * uTexel.y)));

  // Depth in metres; where it falls on the palette comes from the colour-spread table.
  float depth = (1.0 - h) * uDepthRange;
  float t = texture(uLut, vec2(h, 0.5)).r;
  vec3 base = mix(palette(uPalA, t), palette(uPalB, t), uMix);

  vec3 l = normalize(uLight);
  vec3 v = normalize(uEye - vPos);
  float diffuse = max(dot(n, l), 0.0);
  float spec = pow(max(dot(n, normalize(l + v)), 0.0), 60.0) * 0.28;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.12;
  vec3 colour = base * (0.32 + 0.82 * diffuse) + spec + rim;

  // Contour lines every 10 m to 50 m, 50 m beyond.
  float step = depth < 50.0 ? 10.0 : 50.0;
  float c = depth / step;
  float line = 1.0 - smoothstep(0.0, fwidth(c) * 1.3, abs(fract(c - 0.5) - 0.5));
  colour = mix(colour, colour * 0.55, line * uContour);

  // Soft edges so the tile floats in the page.
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.0, 0.07, min(e.x, e.y));
  outColour = vec4(colour * edge, edge);
}`;

// ------------------------------------------------------------------ helpers

function link(gl, vs, fs) {
  const program = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

function uniforms(gl, program, names) {
  return Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));
}

function setSampling(gl, filter) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function paletteBytes() {
  const out = new Uint8Array(256 * PALETTES.length * 4);
  PALETTES.forEach((p, row) => {
    const stops = p.stops.map(hex);
    for (let i = 0; i < 256; i++) {
      const f = (i / 255) * (stops.length - 1);
      const k = Math.min(Math.floor(f), stops.length - 2);
      const w = f - k;
      for (let c = 0; c < 3; c++) out[(row * 256 + i) * 4 + c] = Math.round(stops[k][c] * (1 - w) + stops[k + 1][c] * w);
      out[(row * 256 + i) * 4 + 3] = 255;
    }
  });
  return out;
}

function hex(s) { return [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16)); }

function smoothstep(e0, e1, x) { const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1); return t * t * (3 - 2 * t); }

function resize(gl, c) {
  const dpr = Math.min(devicePixelRatio || 1, innerWidth < 760 ? 1.5 : 2);
  const w = Math.round(c.clientWidth * dpr);
  const h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const nf = 1 / (near - far);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
}

function lookAt(eye, target, up) {
  const z = norm(sub(eye, target));
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1];
}

function multiply(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
