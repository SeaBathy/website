// The hero: real seabed from the IMAS bathymetry composite, drawn with plain WebGL2. Two
// scenes take turns (or pick one with the Wide / Close-up switch): a wide stretch of the
// central Great Barrier Reef at about 59 m per cell, and a reef edge at the survey's full 10 m. Each turns slowly while its vertical exaggeration sweeps from 4x to
// 80x and back, the camera eases in and out, the colours cross-fade between palettes and the
// contour lines fade on and off. No libraries. Falls back to a still picture without WebGL2,
// and holds still for people who ask their system for reduced motion.

// Heights files: size x size little-endian Int16 (negative = depth, in 1/unitsPerMetre m),
// each row delta-encoded (every value after the first is the change from the one before),
// then gzipped.
const SCENES = [
  { url: 'data/wide-1024.i16d.gz', size: 1024, unitsPerMetre: 10, areaKm: 60.4, maxExag: 80, coords: '17°51.3′S 146°38.1′E', place: 'Central Great Barrier Reef, QLD' },
  { url: 'data/reef-1024.i16d.gz', size: 1024, unitsPerMetre: 100, areaKm: 9.74, maxExag: 40, coords: '18°01.5′S 146°35.5′E', place: 'A reef edge at 10 m detail, central GBR' }
];
const SCENE_SECONDS = 36;     // each scene's turn, with a short fade at each end
const SCENE_FADE = 1.2;

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
const readoutContours = document.getElementById('hero-contours');
const readoutCoords = document.getElementById('hero-coords');
const readoutPlace = document.getElementById('hero-place');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// For checking a moment of the loop: ?t=12 holds the animation at 12 s.
const frozenAt = Number.parseFloat(new URLSearchParams(location.search).get('t'));

// Starts once this whole file has run (the shaders are defined further down).
Promise.resolve().then(start).catch((error) => {
  console.warn('3D hero unavailable:', error);
  root.classList.add('no-webgl');
});

/** Loads one scene's heights into textures, with its colour-spread table. */
async function loadScene(gl, scene) {
  const response = await fetch(scene.url);
  if (!response.ok) throw new Error(`${scene.url}: HTTP ${response.status}`);
  if (typeof DecompressionStream === 'undefined') throw new Error('DecompressionStream not available');
  const unzipped = response.body.pipeThrough(new DecompressionStream('gzip'));
  const raw = new Int16Array(await new Response(unzipped).arrayBuffer());
  if (raw.length !== scene.size * scene.size) throw new Error(`${scene.url}: unexpected size`);
  // Undo the row delta-encoding (Int16Array wraps exactly as the encoder did).
  for (let y = 0; y < scene.size; y++) {
    const row = y * scene.size;
    for (let x = 1; x < scene.size; x++) raw[row + x] += raw[row + x - 1];
  }

  let min = Infinity;
  let max = -Infinity;
  for (const v of raw) { if (v < min) min = v; if (v > max) max = v; }
  const depthRange = (max - min) / scene.unitsPerMetre;   // metres
  const heights = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) heights[i] = (raw[i] - min) / (max - min); // 0 deepest .. 1 shallowest

  // Colour spread: three parts "by how much seabed sits at each depth" (histogram equalised),
  // one part logarithmic, so the reef tops, the lagoon floor and the drop-off each get their own colours.
  const bins = new Float32Array(256);
  for (const h of heights) bins[Math.min(255, Math.floor(h * 256))]++;
  const lut = new Float32Array(256);
  let below = 0;
  let typicalH = 0.5;   // the median seabed height: where the camera aims
  for (let i = 0; i < 256; i++) {
    if (below < heights.length / 2 && below + bins[i] >= heights.length / 2) typicalH = (i + 0.5) / 256;
    below += bins[i];
    const h = (i + 0.5) / 256;
    const depth = (1 - h) * depthRange;
    const byArea = 1 - below / heights.length;
    const byLog = Math.log(1 + depth / 3) / Math.log(1 + depthRange / 3);
    lut[i] = Math.min(1, Math.max(0, 0.72 * byArea + 0.28 * byLog));
  }

  const heightTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, heightTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, scene.size, scene.size, 0, gl.RED, gl.FLOAT, heights);
  setSampling(gl, gl.LINEAR);

  const lutTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE2);
  gl.bindTexture(gl.TEXTURE_2D, lutTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 256, 1, 0, gl.RED, gl.FLOAT, lut);
  setSampling(gl, gl.LINEAR);

  return {
    ...scene,
    heightTex,
    lutTex,
    depthRange,
    typicalH,
    trueScale: depthRange / (scene.areaKm * 1000),     // one exaggeration step, in tile widths
    contourStep: depthRange < 120 ? 5 : 10             // metres between contour lines in the shallows
  };
}

async function start() {
  const gl = canvas && canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) throw new Error('WebGL2 not available');

  const program = link(gl, VERTEX, FRAGMENT);
  gl.useProgram(program);
  const u = uniforms(gl, program, ['uMvp', 'uH', 'uPal', 'uExag', 'uTexel', 'uLight', 'uEye', 'uPalA', 'uPalB', 'uMix',
    'uDepthRange', 'uContour', 'uContourStep', 'uRows', 'uLut', 'uFade']);

  // The first scene before anything shows; the close-up loads behind it.
  const scenes = [await loadScene(gl, SCENES[0])];
  loadScene(gl, SCENES[1]).then((s) => scenes.push(s)).catch((e) => console.warn('second 3D scene unavailable:', e));

  // Palettes: one row each, 256 wide.
  const palTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, palTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, PALETTES.length, 0, gl.RGBA, gl.UNSIGNED_BYTE, paletteBytes());
  setSampling(gl, gl.LINEAR);

  // Grid mesh, shared by both scenes: lighter on phones; the pixel shader lights it from
  // the full-resolution heights.
  const grid = innerWidth < 760 ? 320 : 720;
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
  gl.uniform1f(u.uRows, PALETTES.length);
  gl.enable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.clearColor(0, 0, 0, 0);

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

  // Wide / Close-up switch. The scenes still take turns every SCENE_SECONDS; a click shows
  // the chosen one now (fading it in) and the turns carry on from there.
  let sceneOffset = 0;
  let pickedAt = -Infinity;
  let lastT = 0;
  const sceneButtons = [...document.querySelectorAll('[data-scene]')];
  for (const button of sceneButtons) {
    button.addEventListener('click', () => {
      const wanted = Number(button.dataset.scene);
      if (wanted >= scenes.length) return;                 // still loading
      const turn = Math.floor(lastT / SCENE_SECONDS);
      sceneOffset = (((wanted - turn) % scenes.length) + scenes.length) % scenes.length;
      pickedAt = lastT;
      needsStill = true;
    });
  }

  const shown = {};
  const show = (el, key, text) => { if (el && shown[key] !== text) { el.textContent = text; shown[key] = text; } };
  const t0 = performance.now();

  function loop(now) {
    requestAnimationFrame(loop);
    if (!visible) return;
    if (reduceMotion && !needsStill) return;
    needsStill = false;
    frame(now);
  }

  function frame(now) {
    const t = Number.isFinite(frozenAt) ? frozenAt : reduceMotion ? 6 : (now - t0) / 1000;
    resize(gl, canvas);

    // Which scene, and its fade in and out.
    lastT = t;
    const turn = Math.floor(t / SCENE_SECONDS);
    const sceneT = t - turn * SCENE_SECONDS;
    const sceneIndex = (turn + sceneOffset) % scenes.length;
    const scene = scenes[sceneIndex];
    const fadeAmount = reduceMotion ? 1
      : smoothstep(0, SCENE_FADE, sceneT) * (1 - smoothstep(SCENE_SECONDS - SCENE_FADE, SCENE_SECONDS, sceneT))
        * smoothstep(0, 0.6, t - pickedAt);

    // Slow orbit, gentle bob of the camera.
    const azimuth = -0.6 + t * (Math.PI * 2 / 90) + dragOffset;
    const elevation = 0.5 + 0.12 * Math.sin(t * 0.21);
    // Exaggeration sweeps 4x -> the scene's top (80x wide, 40x close up) -> 4x every 24 s,
    // on a log scale so each step feels even.
    const sweep = (1 - Math.cos(t * (Math.PI * 2 / 24))) / 2;
    const exag = 4 * Math.pow(scene.maxExag / 4, sweep);
    const heightScale = scene.trueScale * exag;

    // Palette: 7 s each, the last 2.2 s a cross-fade into the next.
    const hold = 7;
    const fade = 2.2;
    const phase = t / hold;
    const a = Math.floor(phase) % PALETTES.length;
    const b = (a + 1) % PALETTES.length;
    const local = (phase - Math.floor(phase)) * hold;
    const mix = smoothstep(hold - fade, hold, local);

    // Contour lines: on for about half of every 20 s, fading in and out.
    const contourWave = 0.5 + 0.5 * Math.sin(t * (Math.PI * 2 / 20) - 0.4);
    const contour = smoothstep(0.35, 0.65, contourWave) * 0.75;

    const aspect = canvas.width / canvas.height;
    const narrow = aspect < 1.1;
    // Slow zoom in and out (31 s, out of step with the other loops so the view keeps changing),
    // backing off a little as the relief grows so the tall parts stay in frame.
    const zoom = 1 + 0.2 * Math.sin(t * (Math.PI * 2 / 31) + 1.2);
    // Beside the headline on wide screens the stage is about square; on phones it's below the text.
    const base = narrow ? (innerWidth > 980 ? 1.3 : 1.5) : 1.22;
    let radius = (base + heightScale * 0.4) * zoom;
    const target = [0, heightScale * scene.typicalH, 0];
    // Never let the camera dip into the reef tops: keep the same angle and back away instead.
    const minEyeY = heightScale * 1.05 + 0.08;
    radius = Math.max(radius, (minEyeY - target[1]) / Math.sin(elevation));
    const eye = [
      target[0] + radius * Math.cos(elevation) * Math.sin(azimuth),
      target[1] + radius * Math.sin(elevation),
      target[2] + radius * Math.cos(elevation) * Math.cos(azimuth)
    ];
    const mvp = multiply(perspective(narrow ? 0.72 : 0.6, aspect, 0.02, 20), lookAt(eye, target, [0, 1, 0]));

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene.heightTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, scene.lutTex);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(u.uMvp, false, mvp);
    gl.uniform2f(u.uTexel, 1 / scene.size, 1 / scene.size);
    gl.uniform1f(u.uDepthRange, scene.depthRange);
    gl.uniform1f(u.uContourStep, scene.contourStep);
    gl.uniform1f(u.uExag, heightScale);
    gl.uniform3f(u.uLight, -0.55, 0.75, -0.35);
    gl.uniform3f(u.uEye, eye[0], eye[1], eye[2]);
    gl.uniform1f(u.uPalA, a);
    gl.uniform1f(u.uPalB, b);
    gl.uniform1f(u.uMix, mix);
    gl.uniform1f(u.uContour, contour);
    gl.uniform1f(u.uFade, fadeAmount);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_INT, 0);

    show(readoutExag, 'exag', `${Math.round(exag)}×`);
    show(readoutPalette, 'palette', PALETTES[mix > 0.5 ? b : a].name);
    show(readoutContours, 'contours', contour > 0.3 ? `${scene.contourStep} m` : 'Off');
    show(readoutCoords, 'coords', scene.coords);
    show(readoutPlace, 'place', scene.place);
    if (shown.scene !== sceneIndex) {
      shown.scene = sceneIndex;
      sceneButtons.forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.scene) === sceneIndex)));
    }

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
uniform float uExag, uPalA, uPalB, uMix, uDepthRange, uContour, uContourStep, uRows, uFade;
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
  // Low ambient and a strong key light, plus a soft fill from the other side: crisp relief.
  float fill = max(dot(n, normalize(vec3(0.6, 0.5, 0.45))), 0.0);
  vec3 colour = base * (0.18 + 0.92 * diffuse + 0.16 * fill) + spec + rim;

  // Contour lines: the scene's step in the shallows, 50 m beyond 50 m.
  float step = depth < 50.0 ? uContourStep : 50.0;
  float c = depth / step;
  float line = 1.0 - smoothstep(0.0, fwidth(c) * 1.3, abs(fract(c - 0.5) - 0.5));
  colour = mix(colour, colour * 0.55, line * uContour);

  // Soft edges so the tile floats in the page.
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = smoothstep(0.0, 0.07, min(e.x, e.y));
  float alpha = edge * uFade;
  outColour = vec4(colour * alpha, alpha);
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
