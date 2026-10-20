(() => {
  'use strict';
  const surface = document.querySelector('[data-seona-wave]');
  if (!surface) return;
  const image = surface.querySelector('img');
  const canvas = surface.querySelector('canvas');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let gl = null;
  let draw = null;
  let failed = false;
  let initialized = false;
  let inView = true;
  let frame = 0;
  let lastTime = 0;
  let time = 0;
  let energy = 0;
  let targetEnergy = 0;
  let motion = 0;
  let targetMotion = 0;
  let pointerX = .5;
  let pointerY = .46;
  let targetX = .5;
  let targetY = .46;
  let width = 1;
  let height = 1;
  let coverX = 1;
  let coverY = 1;
  let keyboardFocus = false;

  const vertexSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;
    void main() {
      v_uv = vec2(a_position.x * .5 + .5, .5 - a_position.y * .5);
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;
  const fragmentSource = `
    precision highp float;
    varying vec2 v_uv;
    uniform sampler2D u_image;
    uniform vec2 u_size;
    uniform vec2 u_cover;
    uniform vec2 u_pointer;
    uniform float u_time;
    uniform float u_energy;
    uniform float u_motion;
    float hash21(vec2 p) {
      vec3 q = fract(vec3(p.xyx) * .1031);
      q += dot(q, q.yzx + 33.33);
      return fract((q.x + q.y) * q.z);
    }
    float noise(vec2 p) {
      vec2 cell = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash21(cell), hash21(cell + vec2(1.0, 0.0)), u.x),
        mix(hash21(cell + vec2(0.0, 1.0)), hash21(cell + vec2(1.0, 1.0)), u.x), u.y);
    }
    float flowNoise(vec2 p) {
      return .62 * noise(p) + .28 * noise(p * 2.03 + 11.7)
        + .10 * noise(p * 4.09 - 8.3);
    }
    void main() {
      vec2 uv = v_uv;
      vec2 source = (uv - .5) * u_cover + .5;
      // A broad soft boundary lets the full silhouette ripple without clipping it.
      float mask = smoothstep(.23, .29, source.x)
        * (1.0 - smoothstep(.71, .77, source.x))
        * smoothstep(.17, .27, source.y)
        * (1.0 - smoothstep(.66, .76, source.y));
      float aspect = u_size.x / u_size.y;
      vec2 p = vec2(uv.x * aspect, uv.y);
      vec2 delta = (uv - u_pointer) * vec2(aspect, 1.0);
      float distanceToPointer = length(delta);
      float local = exp(-distanceToPointer * distanceToPointer * 3.2);
      float t = u_time;
      vec2 direction = vec2(.258819, .965926);
      float travel = dot(p, direction);
      // Domain-warped currents create irregular folds rather than a regular sine bend.
      vec2 field = p * 6.5 - direction * t * 1.45;
      vec2 warp = vec2(noise(field * .55 + t * .2), noise(field * .55 + 17.2 - t * .16));
      vec2 liquid = vec2(flowNoise(field + warp * 1.3),
        flowNoise(field + warp.yx * 1.3 + vec2(24.7, 8.4))) * 2.0 - 1.0;
      float waveX = sin(travel * 16.0 - t * 4.4 + sin(p.x * 10.0 + t * 1.3));
      float waveY = sin(p.x * 13.0 - t * 3.7 + cos(p.y * 12.0 + t * 1.1));
      vec2 largeWave = vec2(waveX, waveY);
      float hoverAmplitude = min(32.0, u_size.x * .04);
      float idleAmplitude = min(5.5, u_size.x * .009);
      float amplitude = idleAmplitude + hoverAmplitude * u_energy * (.52 + .48 * local);
      vec2 folds = liquid * .85 + largeWave * .7;
      vec2 shift = folds * amplitude / u_size;
      // Cursor movement leaves an expanding, short-lived wake in the material.
      float ripple = sin(distanceToPointer * 43.0 - t * 7.5 + liquid.x * 2.0)
        * exp(-distanceToPointer * 3.4) * u_motion * u_energy;
      shift += normalize(delta + vec2(.0001)) * ripple * hoverAmplitude * .48 / u_size;
      source += shift * u_cover * mask;
      gl_FragColor = texture2D(u_image, clamp(source, .001, .999));
    }
  `;

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }
  function fallback() {
    failed = true;
    stop();
    surface.classList.remove('is-wave-ready');
  }
  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      throw new Error('Wave shader unavailable');
    }
    return shader;
  }
  function resize() {
    const rect = surface.getBoundingClientRect();
    width = Math.max(1, rect.width);
    height = Math.max(1, rect.height);
    const ratio = (image.naturalWidth || 2048) / (image.naturalHeight || 724);
    coverX = Math.min(1, (width / height) / ratio);
    coverY = Math.min(1, ratio / (width / height));
    const dpr = Math.min(window.devicePixelRatio || 1, 1.75, Math.sqrt(2300000 / (width * height)));
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    if (gl && draw) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw();
    }
  }
  function tick(now) {
    frame = 0;
    if (failed || reduced.matches || document.hidden || !inView || !draw) return;
    const dt = Math.min(lastTime ? (now - lastTime) / 1000 : 1 / 60, .05);
    lastTime = now;
    time += dt;
    const ease = 1 - Math.exp(-dt / (targetEnergy > energy ? .16 : .65));
    energy += (targetEnergy - energy) * ease;
    const tracking = 1 - Math.exp(-dt / .095);
    pointerX += (targetX - pointerX) * tracking;
    pointerY += (targetY - pointerY) * tracking;
    motion += (targetMotion - motion) * (1 - Math.exp(-dt / .18));
    targetMotion *= Math.exp(-dt / .23);
    draw();
    surface.classList.add('is-wave-ready');
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (!failed && draw && !reduced.matches && !document.hidden && inView && !frame) {
      frame = requestAnimationFrame(tick);
    }
  }
  function initialize() {
    if (initialized || failed || reduced.matches || !image.naturalWidth) return;
    initialized = true;
    try {
      gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
      if (!gl) throw new Error('WebGL unavailable');
      const program = gl.createProgram();
      const vertex = compile(gl.VERTEX_SHADER, vertexSource);
      const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Wave program unavailable');
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      const texture = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      const uniforms = {};
      for (const name of ['image','size','cover','pointer','time','energy','motion']) {
        uniforms[name] = gl.getUniformLocation(program, 'u_' + name);
      }
      gl.uniform1i(uniforms.image, 0);
      draw = () => {
        gl.uniform2f(uniforms.size, width, height);
        gl.uniform2f(uniforms.cover, coverX, coverY);
        gl.uniform2f(uniforms.pointer, pointerX, pointerY);
        gl.uniform1f(uniforms.time, time);
        gl.uniform1f(uniforms.energy, energy);
        gl.uniform1f(uniforms.motion, motion);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      };
      resize();
      start();
    } catch (_) {
      fallback();
    }
  }
  function move(event) {
    if (reduced.matches) return;
    const rect = surface.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    targetMotion = Math.min(1, Math.hypot((x - targetX) * width / height, y - targetY) * 13);
    targetX = x;
    targetY = y;
    const imageX = (x - .5) * coverX + .5;
    const imageY = (y - .5) * coverY + .5;
    targetEnergy = imageX > .27 && imageX < .73 && imageY > .25 && imageY < .68 ? 1 : 0;
    start();
  }
  function release() { targetEnergy = keyboardFocus ? 1 : 0; targetMotion = 0; }
  surface.addEventListener('pointermove', move, { passive: true });
  surface.addEventListener('pointerenter', move, { passive: true });
  surface.addEventListener('pointerdown', move, { passive: true });
  surface.addEventListener('pointerleave', release);
  surface.addEventListener('pointercancel', release);
  surface.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') release(); });
  surface.addEventListener('focus', () => {
    keyboardFocus = surface.matches(':focus-visible');
    if (keyboardFocus) { targetX = .5; targetY = .46; targetEnergy = 1; start(); }
  });
  surface.addEventListener('blur', () => { keyboardFocus = false; release(); });
  surface.addEventListener('keydown', event => { if (event.key === 'Escape') { keyboardFocus = false; release(); } });
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fallback(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else start(); });
  const motionPreference = () => {
    if (reduced.matches) { stop(); surface.classList.remove('is-wave-ready'); }
    else { initialize(); start(); }
  };
  if (reduced.addEventListener) reduced.addEventListener('change', motionPreference);
  else reduced.addListener(motionPreference);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      inView = entries[0].isIntersecting;
      if (inView) start(); else stop();
    }, { rootMargin: '60px' }).observe(surface);
  }
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(surface);
  else window.addEventListener('resize', resize, { passive: true });
  if (image.complete && image.naturalWidth) initialize();
  else image.addEventListener('load', initialize, { once: true });
})();
