(() => {
  'use strict';
  const surface = document.querySelector('[data-seona-wave]');
  if (!surface) return;
  const image = surface.querySelector('.seona-hero__image');
  const rippleMap = surface.querySelector('[data-seona-ripple-map]');
  const canvas = surface.querySelector('canvas');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  // Match the reference's Ripple displacement, without loading Cargo or Pixi.
  // Map source: https://static.cargo.site/assets/backdrop/ripple/filter_NRM.jpg
  const settings = Object.freeze({
    distortionX: 20, distortionY: 20, scale: 1,
    speed: 5.5, direction: 75, mouseSensitivity: 100
  });
  const radians = -settings.direction * Math.PI / 180;
  const velocity = settings.speed * .15 * 60;
  let gl = null;
  let draw = null;
  let failed = false;
  let initialized = false;
  let inView = true;
  let frame = 0;
  let lastTime = 0;
  let width = 1;
  let height = 1;
  let coverX = 1;
  let coverY = 1;
  let flowX = 0;
  let flowY = 0;
  let mouseX = 0;
  let mouseY = 0;
  let targetMouseX = 0;
  let targetMouseY = 0;
  let previousPointer = null;

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
    uniform sampler2D u_map;
    uniform vec2 u_size;
    uniform vec2 u_cover;
    uniform vec2 u_offset;
    uniform vec2 u_distortion;
    uniform float u_scale;
    void main() {
      // A translating, repeating normal map displaces the whole artwork.
      // Its fine folds are present at rest as well as during pointer movement.
      vec2 mapUV = (v_uv * u_size - u_offset) / (512.0 * u_scale);
      vec2 displacement = texture2D(u_map, mapUV).rg - .5;
      vec2 shift = displacement * u_distortion * (2.0 * u_scale) / u_size;
      vec2 source = (v_uv + shift - .5) * u_cover + .5;
      gl_FragColor = texture2D(u_image, clamp(source, .001, .999));
    }
  `;

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    previousPointer = null;
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
      throw new Error('Ripple shader unavailable');
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
    if (draw) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      draw();
    }
  }
  function tick(now) {
    frame = 0;
    if (failed || reduced.matches || document.hidden || !inView || !draw) return;
    const dt = Math.min(lastTime ? (now - lastTime) / 1000 : 1 / 60, .05);
    lastTime = now;
    const repeat = 512 * settings.scale;
    flowX = (flowX + Math.cos(radians) * velocity * dt) % repeat;
    flowY = (flowY + Math.sin(radians) * velocity * dt) % repeat;
    // The reference retains 95% of the previous pointer velocity per 60-Hz frame.
    // Exponential smoothing preserves that inertia on 30/60/120-Hz displays.
    const follow = 1 - Math.pow(.95, dt * 60);
    mouseX += (targetMouseX - mouseX) * follow;
    mouseY += (targetMouseY - mouseY) * follow;
    // Rebase only settled whole periods so long visits retain subpixel precision.
    if (Math.abs(targetMouseX - mouseX) < .001) {
      const periods = Math.trunc(mouseX / repeat) * repeat;
      mouseX -= periods; targetMouseX -= periods;
    }
    if (Math.abs(targetMouseY - mouseY) < .001) {
      const periods = Math.trunc(mouseY / repeat) * repeat;
      mouseY -= periods; targetMouseY -= periods;
    }
    draw();
    surface.classList.add('is-wave-ready');
    frame = requestAnimationFrame(tick);
  }
  function start() {
    if (!failed && draw && !reduced.matches && !document.hidden && inView && !frame) {
      frame = requestAnimationFrame(tick);
    }
  }
  function uploadTexture(source, unit, repeat) {
    const texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }
  function initialize() {
    if (initialized || failed || reduced.matches || !image.complete || !rippleMap.complete || !image.naturalWidth || !rippleMap.naturalWidth) return;
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
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Ripple program unavailable');
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      uploadTexture(image, 0, false);
      uploadTexture(rippleMap, 1, true);
      const uniforms = {};
      for (const name of ['image', 'map', 'size', 'cover', 'offset', 'distortion', 'scale']) {
        uniforms[name] = gl.getUniformLocation(program, 'u_' + name);
      }
      gl.uniform1i(uniforms.image, 0);
      gl.uniform1i(uniforms.map, 1);
      gl.uniform2f(uniforms.distortion, settings.distortionX, settings.distortionY);
      gl.uniform1f(uniforms.scale, settings.scale);
      draw = () => {
        gl.uniform2f(uniforms.size, width, height);
        gl.uniform2f(uniforms.cover, coverX, coverY);
        gl.uniform2f(uniforms.offset, flowX + mouseX, flowY + mouseY);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      };
      resize();
      start();
    } catch (_) { fallback(); }
  }
  function move(event) {
    if (reduced.matches || !inView) return;
    const pointer = { x: event.clientX, y: event.clientY };
    if (previousPointer) {
      const dx = pointer.x - previousPointer.x;
      const dy = pointer.y - previousPointer.y;
      // Ignore pointer re-entry/teleportation instead of giving the map a jump.
      if (Math.abs(dx) <= 200 && Math.abs(dy) <= 200) {
        targetMouseX += dx * settings.mouseSensitivity / 100;
        targetMouseY += dy * settings.mouseSensitivity / 100;
      }
    }
    previousPointer = pointer;
    start();
  }
  const release = () => { previousPointer = null; };
  surface.addEventListener('pointermove', move, { passive: true });
  surface.addEventListener('pointerenter', move, { passive: true });
  surface.addEventListener('pointerdown', move, { passive: true });
  surface.addEventListener('pointerleave', release);
  surface.addEventListener('pointercancel', release);
  surface.addEventListener('pointerup', event => { if (event.pointerType !== 'mouse') release(); });
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
  for (const source of [image, rippleMap]) {
    source.addEventListener('load', initialize, { once: true });
    source.addEventListener('error', fallback, { once: true });
  }
  initialize();
})();
