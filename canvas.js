'use strict';

/* ============================================================
   CANVAS MODULE
   Handles compositing and rendering for both 1:1 and 9:16.
   Exposes: CANVAS.init(), CANVAS.render(), CANVAS.renderToCtx()
   ============================================================ */

const CANVAS = (function () {

  /* ── Internal state ────────────────────────────────────── */
  let _c11, _x11, _c916, _x916;

  const S11  = { w: 1080, h: 1080 };
  const S916 = { w: 1080, h: 1920 };

  const _imgCache = {};        // preview cache
  const _exportImgCache = {};  // export-only cache for untainted blobs
  let _seeds = null;
  let _seedKey = '';

  /* ── Seeded deterministic RNG (LCG) ───────────────────── */
  function mkRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ── Hex → RGB ─────────────────────────────────────────── */
  function hexToRGB(hex) {
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    return { r: r, g: g, b: b };
  }

  /* ── Image loader ────────────────────────────────────────
     Raster images (PNG/JPG): plain new Image(). Same-origin
     rasters never taint the canvas — fast and simple.

     SVG images: MUST go through fetch → Blob → createObjectURL.
     Chrome taints the canvas when you draw an SVG loaded via
     new Image(), even if it's same-origin, because SVGs can embed
     external resources. A blob: URL sandboxes the SVG and the
     canvas stays untainted so canvas.toBlob() always works.

     encodeURI: "Castle 1_1.png" → "Castle%201_1.png"            */
  function swapAssetsPrefix(src) {
    if (!src) return src;
    if (src.indexOf('assets/') === 0) return 'Assets/' + src.slice(7);
    if (src.indexOf('Assets/') === 0) return 'assets/' + src.slice(7);
    return src;
  }

  function loadImg(src) {
    if (!src) return Promise.resolve(null);
    if (_imgCache[src]) return Promise.resolve(_imgCache[src]);

    // data: URLs are already inline — no fetch needed. encodeURI() would
    // double-encode `%` in URL-encoded SVG data URLs and break them.
    if (src.indexOf('data:') === 0) {
      return new Promise(function (res) {
        var img = new Image();
        img.onload  = function () { _imgCache[src] = img; res(img); };
        img.onerror = function () { res(null); };
        img.src = src;
      });
    }

    var isSvg = src.toLowerCase().indexOf('.svg') !== -1;
    var altSrc = swapAssetsPrefix(src);
    var triedAlt = false;

    if (isSvg) {
      return new Promise(function (res) {
        function fallback(currentSrc) {
          var img = new Image();
          img.onload  = function () { _imgCache[src] = img; res(img); };
          img.onerror = function () {
            if (!triedAlt && altSrc && currentSrc !== altSrc) {
              triedAlt = true;
              fallback(altSrc);
              return;
            }
            res(null);
          };
          img.src = encodeURI(currentSrc);
        }

        if (!window.fetch) { fallback(src); return; }

        function fetchSvg(currentSrc) {
          return fetch(encodeURI(currentSrc))
            .then(function (r) {
              if (!r.ok) throw new Error('HTTP ' + r.status);
              return r.blob();
            })
            .then(function (blob) {
              var typed   = new Blob([blob], { type: 'image/svg+xml' });
              var blobUrl = URL.createObjectURL(typed);
              var img = new Image();
              img.onload = function () {
                _imgCache[src] = img;
                res(img);
              };
              img.onerror = function () {
                URL.revokeObjectURL(blobUrl);
                if (!triedAlt && altSrc && currentSrc !== altSrc) {
                  triedAlt = true;
                  fetchSvg(altSrc);
                } else {
                  fallback(currentSrc);
                }
              };
              img.src = blobUrl;
            });
        }

        fetchSvg(src).catch(function () {
          if (!triedAlt && altSrc && altSrc !== src) {
            triedAlt = true;
            return fetchSvg(altSrc);
          }
          fallback(src);
        });
      });
    }

    return new Promise(function (res) {
      var triedAlt = false;
      var altSrc = swapAssetsPrefix(src);
      var img = new Image();
      img.onload  = function () { _imgCache[src] = img; res(img); };
      img.onerror = function () {
        if (!triedAlt && altSrc && altSrc !== src) {
          triedAlt = true;
          img.src = encodeURI(altSrc);
          return;
        }
        console.warn('[CANVAS] image load failed:', src);
        res(null);
      };
      img.src = encodeURI(src);
    });
  }

  function loadImgForExport(src) {
    if (!src) return Promise.resolve(null);

    // ── PRIMARY PATH: pre-generated base64 data URL ─────────────────────
    // generate-manifest.js writes a tiny JS shim per image that registers
    // the image as a data: URL under its file path.  app.js loads these
    // shims when the user selects an image.  Using the data: URL directly
    // avoids ALL canvas-taint issues because data: URLs are always
    // same-origin — this is the ONLY approach that works reliably on
    // file:// (where fetch() and XHR are both blocked by Chrome).
    if (typeof window !== 'undefined' && window._imgData && window._imgData[src]) {
      src = window._imgData[src];
    }

    if (_exportImgCache[src]) return Promise.resolve(_exportImgCache[src]);

    // ── FALLBACK PATH (mostly Netlify/https://) ─────────────────────────
    // If no data shim is loaded, fall back to fetch→blob→Image.  On
    // https:// this produces an untainted blob: URL.  On file:// without
    // shims there is nothing we can do — plainImg() taints the canvas.
    //
    // Special case: data: URLs (our embedded logos) never taint — load directly.
    return new Promise(function (res) {
      function store(img) { _exportImgCache[src] = img; res(img); }

      // ── data: URL (embedded logos) ──────────────────────────────────────
      // Data URLs are same-origin by definition — always safe, skip fetch/XHR.
      if (src.indexOf('data:') === 0) {
        var di = new Image();
        di.onload  = function () { store(di); };
        di.onerror = function () { res(null); };
        di.src = src;
        return;
      }

      // ── Blob URL path: fetch (https://) → XHR (file://) → give up ──────
      // Once we have a Blob we call URL.createObjectURL() → blob: URL →
      // new Image().  blob: URLs are always same-origin → no canvas taint.
      function fromBlob(blob) {
        var blobUrl = URL.createObjectURL(blob);
        var img = new Image();
        img.onload  = function () { store(img); };          // keep blobUrl alive (don't revoke)
        img.onerror = function () { URL.revokeObjectURL(blobUrl); res(null); };
        img.src = blobUrl;
      }

      function plainImg() {
        // Absolute last resort — used only when the data URL shim wasn't
        // preloaded AND fetch/XHR both failed.  On file:// this DOES taint
        // the canvas, but we've run out of options.  Normal file:// export
        // goes through the PRIMARY PATH (window._imgData) above and never
        // reaches here.
        var img = new Image();
        img.onload  = function () { store(img); };
        img.onerror = function () { res(null); };
        img.src = encodeURI(src);
      }

      function tryXHR() {
        // XHR to file:// same-origin still works in some Chrome versions.
        // status === 0 is the success indicator for file:// responses.
        // Falls back to plainImg() if XHR is also blocked or returns nothing.
        var xhr = new XMLHttpRequest();
        xhr.open('GET', encodeURI(src), true);
        xhr.responseType = 'blob';
        xhr.onload = function () {
          if ((xhr.status === 200 || xhr.status === 0) && xhr.response && xhr.response.size > 0) {
            fromBlob(xhr.response);
          } else {
            plainImg();
          }
        };
        xhr.onerror = function () { plainImg(); };
        xhr.send();
      }

      // 1. fetch — works on https:// (Netlify), blocked on file://
      if (window.fetch) {
        fetch(encodeURI(src))
          .then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.blob();
          })
          .then(fromBlob)
          .catch(tryXHR);          // fetch blocked → fall through to XHR
        return;
      }

      // 2. No fetch API at all → go straight to XHR
      tryXHR();
    });
  }

  /* ── Pre-warm image cache ────────────────────────────────
     Returns a Promise that resolves once all images for the
     current state are loaded.  Callers await this before
     rendering so the first frame is never logo-less.        */
  function prewarmExportImages(state) {
    if (!state || !state.brand) return Promise.resolve();
    var brand = BRANDS[state.brand];
    var jobs  = [];
    if (brand && brand.logo) jobs.push(loadImgForExport(brand.logo));
    if (state.image) {
      if (state.image.file11)  jobs.push(loadImgForExport(state.image.file11));
      if (state.image.file916) jobs.push(loadImgForExport(state.image.file916));
    }
    return Promise.all(jobs);
  }

  /* ── Background (cover-fit) ────────────────────────────── */
  function drawBg(ctx, img, w, h) {
    ctx.fillStyle = '#080808';
    ctx.fillRect(0, 0, w, h);
    if (!img) return;
    var sc = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    var dw = img.naturalWidth * sc;
    var dh = img.naturalHeight * sc;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  /* ── 4-layer particle seed generation ─────────────────────
     Layers are independent pools with their own speed, density, and
     size distributions.  All positions are seeded at init and advanced
     deterministically (y wraps via modulo), guaranteeing a seamless
     loop at any duration.                                             */
  function genSeeds(w, h, seed) {
    var r = mkRng(seed);

    // Speeds are stored as px/second.  Spec numbers are px/frame at
    // ~30 fps reference, so × 30 to get px/s.
    var deepSmoke = [];    // large, slow, dark
    var midSmoke  = [];    // medium wisps with sine drift
    var fineDots  = [];    // small grey particles
    var embers    = [];    // brand-accent sparks

    // Opacity values bumped ~2-3× over the Round-1 spec baseline — at the
    // original values the particles were technically rendered but compressed
    // out of existence by GIF dithering + MP4 VP9/H.264 compression, leaving
    // flat-looking exports.  These levels still read as "ambient smoke",
    // not "fireworks", while surviving the pipeline.
    for (var i = 0; i < 16; i++) {
      deepSmoke.push({
        x:   r() * w,
        y:   h * 0.5 + r() * h * 0.5,
        rad: 60 + r() * 80,
        op:  0.08 + r() * 0.08,       // was 0.03–0.06 → 0.08–0.16
        spd: 6 + r() * 6
      });
    }
    for (var j = 0; j < 22; j++) {
      midSmoke.push({
        xBase: r() * w,
        y:     r() * h,
        rad:   25 + r() * 35,
        op:    0.06 + r() * 0.06,     // was 0.02–0.04 → 0.06–0.12
        spd:   12 + r() * 10,
        phase: r() * Math.PI * 2
      });
    }
    // Scale particle counts with canvas area so 9:16 isn't sparse
    var areaScale = (w * h) / (1080 * 1080);
    var nFine = Math.round(48 * areaScale);   // was 30 → 48
    for (var k = 0; k < nFine; k++) {
      var bottomBias = r() < 0.75;
      fineDots.push({
        x:   r() * w,
        y:   bottomBias ? (h * 0.4 + r() * h * 0.6) : r() * h,
        rad: 1.2 + r() * 1.6,
        op:  0.18 + r() * 0.22,       // was 0.05–0.15 → 0.18–0.40
        spd: 18 + r() * 16
      });
    }
    var nEmbers = Math.round(14 * areaScale); // was 8 → 14
    for (var m = 0; m < nEmbers; m++) {
      embers.push({
        x:            r() * w,
        y:            h * 0.3 + r() * h * 0.7,
        rad:          1.2 + r() * 1.3,
        op:           0.28 + r() * 0.30,   // was 0.06–0.12 → 0.28–0.58
        spd:          24 + r() * 22,
        flickerPhase: r() * Math.PI * 2
      });
    }

    return {
      deepSmoke: deepSmoke,
      midSmoke:  midSmoke,
      fineDots:  fineDots,
      embers:    embers
    };
  }

  /* ── 4-layer particle rendering ─────────────────────────
     t = elapsed seconds. y wraps via modulo so frame 0 and the last
     frame match exactly — guaranteed seamless loop.

     When loopSeconds is supplied, each particle's vertical travel
     is quantized to an integer number of full wraparounds over the
     loop.  Without this the recorded endframe and frame 0 land at
     subtly different positions and the loop hitches on every pass.

     yFade multiplier fades every layer toward the top of the canvas,
     keeping the headline area clean.  Bottom 40% is fully opaque;
     the top third is nearly invisible.                              */
  function drawSmoke(ctx, w, h, seeds, t, emberColor, loopSeconds) {
    ctx.save();
    t = t || 0;

    function wrapY(y, extent) {
      var span = h + extent * 2;
      return ((y - extent) % span + span) % span - extent;
    }
    function yFadeAt(y) {
      return Math.min(1, y / (h * 0.6));
    }
    // Quantized drift: integer cycles per loop → position at t=0 and
    // t=loopSeconds are identical by construction.
    function driftDist(p, extent) {
      var span = h + extent * 2;
      if (loopSeconds) {
        var cycles = Math.max(1, Math.round(p.spd * loopSeconds / span));
        var u = ((t % loopSeconds) + loopSeconds) % loopSeconds / loopSeconds;
        return u * cycles * span;
      }
      return t * p.spd;
    }

    // ── Layer 1: deep smoke (dark radial gradients) ─────
    seeds.deepSmoke.forEach(function (p) {
      var drift = driftDist(p, p.rad);
      var y = wrapY(p.y - drift, p.rad);
      var fade = yFadeAt(y);
      if (fade <= 0) return;
      var a = (p.op * fade).toFixed(4);
      var g = ctx.createRadialGradient(p.x, y, 0, p.x, y, p.rad);
      g.addColorStop(0, 'rgba(10,10,10,' + a + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, y, p.rad, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Layer 2: mid smoke (smaller wisps + sine drift) ─
    seeds.midSmoke.forEach(function (p) {
      var drift = driftDist(p, p.rad);
      var y = wrapY(p.y - drift, p.rad);
      var x = p.xBase + Math.sin(y * 0.015 + p.phase) * 12;
      var fade = yFadeAt(y);
      if (fade <= 0) return;
      var a = (p.op * fade).toFixed(4);
      var g = ctx.createRadialGradient(x, y, 0, x, y, p.rad);
      g.addColorStop(0, 'rgba(14,14,14,' + a + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, p.rad, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Layer 3: fine particles (small grey dots) ───────
    seeds.fineDots.forEach(function (p) {
      var drift = driftDist(p, 6);
      var y = wrapY(p.y - drift, 6);
      var fade = yFadeAt(y);
      if (fade <= 0) return;
      var a = Math.min(1, p.op * fade).toFixed(4);
      ctx.beginPath();
      ctx.arc(p.x, y, p.rad, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(200,200,200,' + a + ')';
      ctx.fill();
    });

    // ── Layer 4: ember sparks (brand accent, brand-gated) ─
    if (emberColor) {
      var rgb = hexToRGB(emberColor);
      seeds.embers.forEach(function (p) {
        var drift = driftDist(p, 4);
        var y = wrapY(p.y - drift, 4);
        var fade = yFadeAt(y);
        if (fade <= 0) return;
        // Flicker must also loop seamlessly — quantize to integer cycles
        // across the loop so sin() returns to the same phase at t=0 and t=LOOP.
        var flickerT;
        if (loopSeconds) {
          var flickCycles = Math.max(1, Math.round(0.9 * loopSeconds));
          var uL = ((t % loopSeconds) + loopSeconds) % loopSeconds / loopSeconds;
          flickerT = uL * flickCycles;
        } else {
          flickerT = t * 0.9;
        }
        var flicker = 0.65 + 0.35 * Math.sin(flickerT * Math.PI * 2 + p.flickerPhase);
        var alpha   = Math.min(1, p.op * fade * flicker);
        ctx.beginPath();
        ctx.arc(p.x, y, p.rad, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha.toFixed(4) + ')';
        ctx.fill();
      });
    }

    ctx.restore();
  }

  /* ── Layout zone calculators ───────────────────────────── */
  function getZones11(lay) {
    var M  = 65,   W  = 1080, H  = 1080;
    var LW = 290,  LH = 140;   // logo max — bigger presence on the square
    var TW = 940,  TH = 400;   // title max — wider zone lets long headlines render bigger
    var CW = 720,  CH = 115;   // cta max — accommodates bigger button
    var titBot = H - 195;      // 885  — bottom of title zone
    var titTop = titBot - TH;  // 485  — top of title zone
    var ctaTop = titBot;       // 885  — zero gap: CTA zone starts right at title zone bottom

    if (lay === 'center') return {
      logo:  { x: (W - LW) / 2,     y: M,      w: LW, h: LH, al: 'center' },
      title: { x: (W - TW) / 2,     y: titTop, w: TW, h: TH, al: 'center' },
      cta:   { x: (W - CW) / 2,     y: ctaTop, w: CW, h: CH, al: 'center' }
    };
    // left (default)
    return {
      logo:  { x: M,                 y: M,      w: LW, h: LH, al: 'left'   },
      title: { x: M,                 y: titTop, w: TW, h: TH, al: 'left'   },
      cta:   { x: M,                 y: ctaTop, w: CW, h: CH, al: 'left'   }
    };
  }

  function getZones916(lay) {
    var M  = 65,   W  = 1080;
    var LW = 238,  LH = 72;
    var TW = 907,  TH = 350;
    var CW = 648,  CH = 99;
    var SAFE = 270;

    if (lay === 'center') return {
      logo:  { x: (W - LW) / 2,     y: SAFE, w: LW, h: LH, al: 'center' },
      title: { x: (W - TW) / 2,     y: 1000, w: TW, h: TH, al: 'center' },
      cta:   { x: (W - CW) / 2,     y: 1360, w: CW, h: CH, al: 'center' }
    };
    return {
      logo:  { x: M,                 y: SAFE, w: LW, h: LH, al: 'left'   },
      title: { x: M,                 y: 1000, w: TW, h: TH, al: 'left'   },
      cta:   { x: M,                 y: 1360, w: CW, h: CH, al: 'left'   }
    };
  }

  /* ── Text wrapping ─────────────────────────────────────── */
  function wrapText(ctx, text, maxW, maxLines) {
    var words = text.split(' ');
    var lines = [];
    var cur   = '';

    for (var i = 0; i < words.length; i++) {
      var next = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(next).width > maxW && cur) {
        lines.push(cur);
        if (lines.length >= maxLines - 1) {
          lines.push(words.slice(i).join(' '));
          return lines;
        }
        cur = words[i];
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  /* ── Headline auto-fit ─────────────────────────────────── */
  // Tries 2 lines first, then 3 lines, stepping font size down from
  // startSz to MIN_SZ.  Checks BOTH vertical height and that every
  // individual line fits within maxW — without this check, wrapText
  // stuffs all overflow words into the last line, which then renders
  // wider than the canvas and appears cropped.
  function fitFont(ctx, text, maxW, maxH, startSz, font) {
    var MIN_SZ = 20;
    function allLinesFit(lines, sz) {
      if (lines.length * sz * 1.25 > maxH) return false;
      for (var i = 0; i < lines.length; i++) {
        if (ctx.measureText(lines[i]).width > maxW) return false;
      }
      return true;
    }
    var sz, lines;
    for (var maxL = 2; maxL <= 3; maxL++) {
      sz = startSz;
      while (sz >= MIN_SZ) {
        ctx.font = '800 ' + sz + 'px ' + font;
        lines = wrapText(ctx, text, maxW, maxL);
        if (lines.length <= maxL && allLinesFit(lines, sz)) {
          return { sz: sz, lines: lines };
        }
        sz -= 2;  // smaller step for smoother fit
      }
    }
    // Absolute fallback — 3 lines at minimum size
    ctx.font = '800 ' + MIN_SZ + 'px ' + font;
    lines = wrapText(ctx, text, maxW, 3);
    return { sz: MIN_SZ, lines: lines };
  }

  /* ── Text + CTA rendering ──────────────────────────────── */
  function drawText(ctx, zones, brand, msg, cta, subLabel, is916, fstate) {
    var BF = "'Montserrat', sans-serif";
    var msgOpacity = (fstate && fstate.msgOpacity !== undefined) ? fstate.msgOpacity : 1;
    var msgYOffset = (fstate && fstate.msgYOffset !== undefined) ? fstate.msgYOffset : 0;
    var ctaPulse   = (fstate && fstate.ctaPulse   !== undefined) ? fstate.ctaPulse   : 0;

    var tz = zones.title;
    var cz = zones.cta;

    // ── Headline ──────────────────────────────────────────
    var maxStartSz = is916 ? 110 : 130;
    var fit    = fitFont(ctx, msg, tz.w, tz.h, maxStartSz, BF);
    var sz     = fit.sz;
    var lines  = fit.lines;
    var lineH  = sz * 1.25;
    var totalH = lines.length * lineH;
    var startY = tz.y + (tz.h - totalH) / 2 + lineH / 2 + msgYOffset;

    var anchorX = tz.al === 'left'   ? tz.x :
                  tz.al === 'right'  ? tz.x + tz.w :
                                       tz.x + tz.w / 2;

    ctx.save();
    ctx.globalAlpha   = msgOpacity;
    ctx.font          = '800 ' + sz + 'px ' + BF;
    ctx.fillStyle     = '#FFFFFF';
    ctx.textAlign     = tz.al;
    ctx.textBaseline  = 'middle';
    ctx.shadowColor   = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur    = sz * 0.35;
    ctx.shadowOffsetY = sz * 0.05;

    lines.forEach(function (line, i) {
      ctx.fillText(line, anchorX, startY + i * lineH);
    });
    ctx.restore();

    // Bottom edge of the last text line (textBaseline = 'middle', so add sz/2)
    var textBottom = startY + (lines.length - 1) * lineH + sz / 2;

    // ── CTA button — only rendered when cta text is present ──
    if (cta && cta.trim()) {
      var ctaText  = cta.toUpperCase();               // always CAPS
      var ctaFontSz = is916 ? 42 : 52;
      ctx.save();
      ctx.font = '700 ' + ctaFontSz + 'px ' + BF;   // Montserrat, not Lato
      var txtW  = ctx.measureText(ctaText).width;
      var padH  = is916 ? 36 : 42;
      var padV  = is916 ? 22 : 26;
      var btnW  = Math.min(cz.w, txtW + padH * 2);
      var btnH  = Math.min(cz.h, ctaFontSz + padV * 2);

      var bx = cz.al === 'left'   ? cz.x :
               cz.al === 'right'  ? cz.x + cz.w - btnW :
                                     cz.x + (cz.w - btnW) / 2;

      // Fixed gap below last text line — same regardless of title length or font size
      var ctaGap = is916 ? 60 : 50;
      var by = textBottom + ctaGap;

      // Heartbeat pulse — subtle scale (1 → 1.04 → 1) + brightness mix.
      // No glow, no shadow; keeps the CTA clean and brand-accurate.
      var scale = 1 + 0.04 * ctaPulse;
      ctx.translate(bx + btnW / 2, by + btnH / 2);
      ctx.scale(scale, scale);

      // Mix brand accent with white at up to 12% at the pulse peak.
      var accRgb = hexToRGB(brand.accent);
      var mix    = 0.12 * ctaPulse;
      var pr = Math.round(accRgb.r + (255 - accRgb.r) * mix);
      var pg = Math.round(accRgb.g + (255 - accRgb.g) * mix);
      var pb = Math.round(accRgb.b + (255 - accRgb.b) * mix);

      ctx.fillStyle = 'rgb(' + pr + ',' + pg + ',' + pb + ')';
      ctx.fillRect(-btnW / 2, -btnH / 2, btnW, btnH);

      // Button text — Montserrat Bold CAPS
      ctx.fillStyle    = brand.ctaTextColor;
      ctx.font         = '700 ' + ctaFontSz + 'px ' + BF;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = 'rgba(0,0,0,0)';
      ctx.shadowBlur   = 0;
      ctx.fillText(ctaText, 0, 0);
      ctx.restore();

      // ── Sub-label below button (optional) ─────────────
      // Multi-note line joined with '·'.  Auto-shrinks to fit the CTA zone
      // width if the combined string is too long, matching the headline.
      if (subLabel && subLabel.trim()) {
        var subMaxW  = cz.w;
        var subFontSz = is916 ? 22 : 24;
        var SUB_MIN  = is916 ? 14 : 16;
        ctx.save();
        ctx.font = '300 ' + subFontSz + 'px ' + BF;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0.10em';
        while (subFontSz > SUB_MIN && ctx.measureText(subLabel.toUpperCase()).width > subMaxW) {
          subFontSz -= 1;
          ctx.font = '300 ' + subFontSz + 'px ' + BF;
        }
        ctx.fillStyle    = 'rgba(255,255,255,0.65)';
        ctx.textAlign    = cz.al === 'center' ? 'center' : 'left';
        ctx.textBaseline = 'top';
        ctx.shadowColor  = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur   = 6;
        var subX = cz.al === 'center' ? (cz.x + cz.w / 2) : cz.x;
        var subGap = Math.round(btnH * 0.45);
        var subY = by + btnH + subGap;
        ctx.fillText(subLabel.toUpperCase(), subX, subY);
        ctx.restore();
      }
    }
  }

  /* helper used inside drawText */
  function hexToRGB(hex) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    };
  }

  /* ── Logo rendering ────────────────────────────────────── */
  function drawLogo(ctx, logoImg, zone) {
    if (!logoImg) return;
    var sc = Math.min(zone.w / logoImg.naturalWidth, zone.h / logoImg.naturalHeight);
    var dw = logoImg.naturalWidth  * sc;
    var dh = logoImg.naturalHeight * sc;
    ctx.drawImage(logoImg, zone.x, zone.y, dw, dh);
  }

  /* ── Core renderer (single canvas + ctx) ──────────────── */
  // forExport = true  → uses loadImgForExport (fetch+blob, never taints, safe for toBlob)
  // forExport = false → uses loadImg (plain Image, fast, may taint — preview only)
  async function renderToCtx(ctx, spec, state, frame, fstate, is916, forExport) {
    var w = spec.w, h = spec.h;
    var loader = forExport ? loadImgForExport : loadImg;

    var brand    = BRANDS[state.brand];
    var lay      = 'left';   // layout step removed — always left-aligned
    var msg      = state.messageMode === 'preset' ? state.messagePreset : state.messagePosition;
    var cta      = state.cta;
    // subLabel is an array of selected notes (multi-select). Join with a
    // middle dot for canvas rendering. Legacy string values are tolerated.
    var subLabelArr = Array.isArray(state.subLabel)
      ? state.subLabel.filter(function (s) { return s && String(s).trim(); })
      : (state.subLabel ? [state.subLabel] : []);
    var subLabel = subLabelArr.join(' · ');

    // Use the correct format image for each output size
    var imgSrc = is916
      ? ((state.image && (state.image.file916 || state.image.file11 || state.image.file)) || null)
      : ((state.image && (state.image.file11  || state.image.file916 || state.image.file)) || null);

    var results = await Promise.all([
      imgSrc ? loader(imgSrc).catch(function () { return null; }) : Promise.resolve(null),
      loader(brand.logo).catch(function () { return null; })
    ]);
    var bgImg   = results[0];
    var logoImg = results[1];

    // Refresh seeds when brand or image changes
    var newKey = state.brand + '|' + (state.image ? state.image.id : '');
    if (!_seeds || _seedKey !== newKey) {
      _seedKey = newKey;
      _seeds = {
        s11:  genSeeds(S11.w,  S11.h,  12345),
        s916: genSeeds(S916.w, S916.h, 67890)
      };
    }
    var seeds = is916 ? _seeds.s916 : _seeds.s11;
    var zones = is916 ? getZones916(lay) : getZones11(lay);

    // Convert frame → seconds so drawSmoke is frame-rate independent.
    // fstate.t is set by export.js (f/15 for GIF, frame/fps for video).
    // Preview renders at frame=0, t=0 (static snapshot is fine).
    var t = (fstate && fstate.t !== undefined) ? fstate.t : (frame || 0) / 15;

    var loopSeconds = (fstate && fstate.loopSeconds) || null;

    drawBg(ctx, bgImg, w, h);
    drawSmoke(ctx, w, h, seeds, t, brand.emberColor || null, loopSeconds);
    if (msg) drawText(ctx, zones, brand, msg, cta || '', subLabel, is916, fstate || {});
    drawLogo(ctx, logoImg, zones.logo);
  }

  /* ── Public render (both canvases) ────────────────────── */
  async function render(state, frame, fstate) {
    if (!state || !state.brand) {
      [{ ctx: _x11, s: S11 }, { ctx: _x916, s: S916 }].forEach(function (p) {
        p.ctx.fillStyle = '#080808';
        p.ctx.fillRect(0, 0, p.s.w, p.s.h);
        p.ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        p.ctx.lineWidth = 1;
        for (var x = 0; x < p.s.w; x += 120) {
          p.ctx.beginPath(); p.ctx.moveTo(x, 0); p.ctx.lineTo(x, p.s.h); p.ctx.stroke();
        }
        for (var y = 0; y < p.s.h; y += 120) {
          p.ctx.beginPath(); p.ctx.moveTo(0, y); p.ctx.lineTo(p.s.w, y); p.ctx.stroke();
        }
      });
      return;
    }

    await Promise.all([
      renderToCtx(_x11,  S11,  state, frame, fstate, false),
      renderToCtx(_x916, S916, state, frame, fstate, true)
    ]);
  }

  /* ── Init ──────────────────────────────────────────────── */
  function init(c11el, c916el) {
    _c11  = c11el;  _x11  = _c11.getContext('2d');
    _c916 = c916el; _x916 = _c916.getContext('2d');
    _c11.width  = S11.w;   _c11.height  = S11.h;
    _c916.width = S916.w;  _c916.height = S916.h;
  }

  /* ── Invalidate seed + image cache ────────────────────── */
  function resetSeeds() {
    _seeds = null; _seedKey = '';
    Object.keys(_imgCache).forEach(function (k) { delete _imgCache[k]; });
    Object.keys(_exportImgCache).forEach(function (k) { delete _exportImgCache[k]; });
  }

  return {
    init:                 init,
    render:               render,
    renderToCtx:          renderToCtx,
    resetSeeds:           resetSeeds,
    prewarmExportImages:  prewarmExportImages,
    getC11:               function () { return _c11; },
    getC916:              function () { return _c916; },
    S11:                  S11,
    S916:                 S916
  };

})();
