/* Random-density XOR persistence-of-vision portrait.
   Reconstructs a 2-share XORP grayscale package into a closure-private
   buffer and paints a sparse random subset of pixels each frame.
   Default: 40% density, clear to black (DECAY 0), true source tones
   (BOOST 1). DECAY greater than 0 keeps fading trails; BOOST other
   than 1 optionally applies a soft highlight-preserving curve.
   No dependencies. The reconstructed still is never attached to the DOM
   or the window, and is never offered as a download. */
(function () {
  "use strict";

  var DENSITY = 0.40;
  var DECAY = 0;
  /* 1 = true source tones (default). Any other value optionally applies
     the soft highlight-preserving curve; leave at 1 to avoid clipping. */
  var BOOST = 1;
  var HEADER = 16;
  var DEFAULT_SRC = "images/profile/photo.xor";

  function clamp01(x) {
    if (x < 0) return 0;
    if (x > 1) return 1;
    return x;
  }

  function readU32LE(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  function parseXorP(bytes) {
    if (!bytes || bytes.length < HEADER) throw new Error("XORP too short");
    if (bytes[0] !== 0x58 || bytes[1] !== 0x4F || bytes[2] !== 0x52 || bytes[3] !== 0x50) {
      throw new Error("Not an XORP package");
    }
    if (bytes[4] !== 1) throw new Error("Unsupported XORP version");
    if (bytes[5] !== 1) throw new Error("Expected grayscale XORP");
    var shareCount = bytes[6];
    var width = readU32LE(bytes, 8);
    var height = readU32LE(bytes, 12);
    if (shareCount < 2 || width < 1 || height < 1) throw new Error("Invalid XORP header");
    var per = width * height;
    if (bytes.length !== HEADER + per * shareCount) throw new Error("XORP length mismatch");
    var pixels = new Uint8Array(per);
    var s, i, off;
    for (s = 0; s < shareCount; s++) {
      off = HEADER + s * per;
      for (i = 0; i < per; i++) pixels[i] ^= bytes[off + i];
    }
    return { width: width, height: height, pixels: pixels };
  }


  function makePerm(n) {
    var p = new Uint32Array(n);
    var i, j, t, rand, span;
    for (i = 0; i < n; i++) p[i] = i;
    rand = new Uint32Array(1);
    for (i = n - 1; i > 0; i--) {
      span = i + 1;
      if (crypto && crypto.getRandomValues) {
        crypto.getRandomValues(rand);
        j = rand[0] % span;
      } else {
        j = (Math.random() * span) | 0;
      }
      t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    return p;
  }

  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch (e) {
      return false;
    }
  }

  function initMount(mount) {
    var canvas = mount.querySelector("canvas");
    var fallback = mount.querySelector(".xor-photo-fallback");
    if (!canvas) return;

    var src = mount.getAttribute("data-xor") || DEFAULT_SRC;
    var density = Number(mount.getAttribute("data-density"));
    if (!isFinite(density) || density <= 0) density = DENSITY;
    density = clamp01(density);
    var boost = Number(mount.getAttribute("data-boost"));
    if (!isFinite(boost) || boost <= 0) boost = BOOST;
    /* data-tint="nv" gives a green night-vision phosphor tint. */
    var nv = mount.getAttribute("data-tint") === "nv";
    var tR = nv ? 0.18 : 1, tG = 1, tB = nv ? 0.30 : 1;
    /* data-fireflies="N": night-vision scintillation. About N tiny bright
       specks per second pop up at random spots and fade out quickly, like
       the sampling noise in an image-intensifier tube. Drawn on a separate
       overlay canvas; never touches the portrait pixels. */
    var ffRate = parseFloat(mount.getAttribute("data-fireflies"));
    if (!isFinite(ffRate) || ffRate < 0) ffRate = 0;
    if (ffRate > 400) ffRate = 400;
    var ffCanvas = null, ffCtx = null, sparks = [], ffLast = 0, ffAcc = 0;
    if (ffRate) {
      ffCanvas = document.createElement("canvas");
      ffCanvas.className = "xor-fireflies";
      ffCanvas.setAttribute("aria-hidden", "true");
      canvas.parentNode.insertBefore(ffCanvas, canvas.nextSibling);
      ffCtx = ffCanvas.getContext("2d");
    }

    function drawFireflies(ts) {
      if (!ffCtx) return;
      var w = canvas.width, h = canvas.height;
      if (ffCanvas.width !== w || ffCanvas.height !== h) {
        ffCanvas.width = w;
        ffCanvas.height = h;
      }
      var dt = ffLast ? Math.min(0.1, (ts - ffLast) / 1000) : 0;
      ffLast = ts;
      ffAcc += ffRate * dt;
      while (ffAcc >= 1) {
        ffAcc -= 1;
        sparks.push({
          x: Math.random() * w, y: Math.random() * h,
          life: 1, fade: 1 / (0.06 + Math.random() * 0.22),
          big: Math.random() < 0.15
        });
      }
      ffCtx.clearRect(0, 0, w, h);
      ffCtx.globalCompositeOperation = "lighter";
      var px = Math.max(1, Math.round(w / 400)), i, sp, a, r, g;
      for (i = sparks.length - 1; i >= 0; i--) {
        sp = sparks[i];
        sp.life -= sp.fade * dt;
        if (sp.life <= 0) { sparks.splice(i, 1); continue; }
        a = sp.life * sp.life;
        r = px * (sp.big ? 6 : 3);
        g = ffCtx.createRadialGradient(sp.x, sp.y, 0, sp.x, sp.y, r);
        g.addColorStop(0, "rgba(240,255,235," + a + ")");
        g.addColorStop(0.3, "rgba(150,255,160," + (a * 0.7) + ")");
        g.addColorStop(1, "rgba(40,255,90,0)");
        ffCtx.fillStyle = g;
        ffCtx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);
        ffCtx.fillStyle = "rgba(255,255,255," + a + ")";
        ffCtx.fillRect(Math.round(sp.x - px), Math.round(sp.y - px), px * 2, px * 2);
      }
      ffCtx.globalCompositeOperation = "source-over";
    }

    /* data-noise="0..1": night-vision grain, stronger where the source is
       dark (amplitude scales with (1 - luminance)^1.5). */
    var noise = parseFloat(mount.getAttribute("data-noise"));
    if (!isFinite(noise) || noise < 0) noise = 0;
    if (noise > 1) noise = 1;
    var noiseLut = new Float32Array(256);
    (function () {
      for (var k = 0; k < 256; k++) noiseLut[k] = noise * 160 * Math.pow(1 - k / 255, 1.5);
    })();
    var rng = (Math.random() * 4294967295) >>> 0 || 1;

    var decay = Number(mount.getAttribute("data-decay"));
    if (!isFinite(decay) || decay < 0 || decay > 1) decay = DECAY;
    var liftLut = (function (p) {
      var lut = new Uint8Array(256);
      var i, y;
      if (p === 1) {
        for (i = 0; i < 256; i++) lut[i] = i;
        return lut;
      }
      lut[255] = 255;
      for (i = 0; i < 255; i++) {
        y = 1 - Math.pow(1 - i / 255, p);
        if (y < 0) y = 0;
        if (y > 1) y = 1;
        lut[i] = Math.round(y * 255);
        if (lut[i] > 254) lut[i] = 254;
      }
      return lut;
    })(boost);

    var privatePixels = null;
    var imgW = 0;
    var imgH = 0;
    var perm = null;
    var cycleOffset = 0;
    var frameData = null;
    var blackTemplate = null;
    var aux = null;
    var auxCtx = null;
    var ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    var rafId = 0;
    var visible = false;
    var pageHidden = false;
    var running = false;
    var lastTick = 0;
    var reduced = prefersReducedMotion();
    var minFrameMs = reduced ? 120 : 0;

    function showFallback() {
      canvas.style.display = "none";
      if (fallback) fallback.hidden = false;
      mount.classList.add("xor-photo-failed");
      privatePixels = null;
      perm = null;
      frameData = null;
    }

    function sizeCanvas() {
      if (!imgW) return;
      var dpr = window.devicePixelRatio || 1;
      if (dpr < 1) dpr = 1;
      var cssW = canvas.clientWidth || mount.clientWidth || imgW;
      var cssH = canvas.clientHeight || cssW;
      var bw = Math.max(1, Math.round(cssW * dpr));
      var bh = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      if (!aux) {
        aux = document.createElement("canvas");
        auxCtx = aux.getContext("2d", { alpha: false, willReadFrequently: true });
      }
      if (aux.width !== imgW || aux.height !== imgH) {
        aux.width = imgW;
        aux.height = imgH;
      }
    }

    function renderFrame() {
      if (!privatePixels || !frameData) return;
      var total = imgW * imgH;
      var cap = Math.floor(density * total);
      if (cap < 1 && total > 0) cap = 1;
      var data = frameData.data;
      var i, idx, di, v;
      for (i = 0; i < data.length; i += 4) {
        data[i] = Math.round(data[i] * decay);
        data[i + 1] = Math.round(data[i + 1] * decay);
        data[i + 2] = Math.round(data[i + 2] * decay);
        data[i + 3] = 255;
      }
      var start = total ? (cycleOffset % total) : 0;
      for (i = 0; i < cap; i++) {
        idx = perm[(start + i) % total];
        v = liftLut[privatePixels[idx]];
        di = idx * 4;
        data[di] = Math.round(v * tR);
        data[di + 1] = Math.round(v * tG);
        data[di + 2] = Math.round(v * tB);
        data[di + 3] = 255;
      }
      if (noise > 0) {
        var amp, n, r, gch;
        for (idx = 0; idx < total; idx++) {
          amp = noiseLut[privatePixels[idx]];
          if (amp < 1) continue;
          rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; rng >>>= 0;
          r = (rng & 1023) / 1023;
          n = r * r * r * amp;
          if (n < 1) continue;
          di = idx * 4;
          gch = data[di + 1] + n;
          data[di + 1] = gch > 255 ? 255 : gch;
          data[di] = data[di] + n * tR;
          data[di + 2] = data[di + 2] + n * tB;
        }
      }
      cycleOffset = total ? ((start + cap) % total) : 0;
      auxCtx.putImageData(frameData, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.globalCompositeOperation = "copy";
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(aux, 0, 0, canvas.width, canvas.height);
    }

    function tick(ts) {
      rafId = 0;
      if (!running) return;
      if (minFrameMs && lastTick && (ts - lastTick) < minFrameMs) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      lastTick = ts;
      renderFrame();
      if (!reduced) drawFireflies(ts);
      else if (ffCtx) ffCtx.clearRect(0, 0, ffCanvas.width, ffCanvas.height);
      rafId = requestAnimationFrame(tick);
    }

    function start() {
      if (running || !privatePixels) return;
      if (!visible || pageHidden) return;
      running = true;
      lastTick = 0;
      sizeCanvas();
      if (!rafId) rafId = requestAnimationFrame(tick);
    }

    function stop() {
      running = false;
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    }

    function onVisibility() {
      pageHidden = document.hidden === true;
      if (pageHidden) stop();
      else start();
    }

    function isInViewport() {
      var r = mount.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      var vw = window.innerWidth || document.documentElement.clientWidth || 0;
      return r.width > 1 && r.height > 1 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    }

    function updateVisibility(force) {
      var now = isInViewport();
      if (!force && now === visible) {
        if (now && !running) start();
        return;
      }
      visible = now;
      if (visible) start();
      else stop();
    }

    function onMotionChange() {
      reduced = prefersReducedMotion();
      minFrameMs = reduced ? 120 : 0;
    }

    fetch(src, { credentials: "same-origin" })
      .then(function (res) {
        if (!res.ok) throw new Error("XOR fetch failed");
        return res.arrayBuffer();
      })
      .then(function (buf) {
        var pkg = parseXorP(new Uint8Array(buf));
        privatePixels = pkg.pixels;
        imgW = pkg.width;
        imgH = pkg.height;
        perm = makePerm(imgW * imgH);
        aux = document.createElement("canvas");
        aux.width = imgW;
        aux.height = imgH;
        auxCtx = aux.getContext("2d", { alpha: false, willReadFrequently: true });
        frameData = auxCtx.createImageData(imgW, imgH);
        blackTemplate = new Uint8ClampedArray(imgW * imgH * 4);
        var p;
        for (p = 3; p < blackTemplate.length; p += 4) blackTemplate[p] = 255;
        if (fallback) fallback.hidden = true;
        canvas.style.display = "block";
        sizeCanvas();
        renderFrame();
        updateVisibility(true);
      })
      .catch(function () {
        showFallback();
      });

    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function () {
        updateVisibility(true);
      }, { threshold: 0 });
      io.observe(mount);
    } else {
      visible = true;
      start();
    }
    window.addEventListener("scroll", function () { updateVisibility(false); }, { passive: true });

    document.addEventListener("visibilitychange", onVisibility);
    if (window.matchMedia) {
      try {
        var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
        if (mq.addEventListener) mq.addEventListener("change", onMotionChange);
        else if (mq.addListener) mq.addListener(onMotionChange);
      } catch (ignore) {}
    }
    window.addEventListener("resize", function () {
      if (!privatePixels) return;
      sizeCanvas();
      updateVisibility(true);
      if (!running) renderFrame();
    });
  }

  function boot() {
    var nodes = document.querySelectorAll("[data-xor-photo], .xor-photo");
    var i;
    for (i = 0; i < nodes.length; i++) initMount(nodes[i]);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
