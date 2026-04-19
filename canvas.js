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
    if (_exportImgCache[src]) return Promise.resolve(_exportImgCache[src]);

    // The only way to draw an image on a canvas and still call toBlob() is to
    // ensure the image is "origin-clean".  Drawing a blob: URL image is ALWAYS
    // origin-clean regardless of where the underlying bytes came from.
    //
    // Problem: on file:// Chrome blocks fetch() (since Chrome 94).  Fallback:
    // XMLHttpRequest still works for same-origin file:// requests.
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
        // Last resort: plain new Image().
        // On file:// in Chrome/Windows, same-directory images loaded this way
        // do NOT taint the canvas (confirmed by successful toBlob() in testing).
        // This path is only reached when both fetch AND XHR are blocked.
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

  /* ── Smoke & ember seed generation ────────────────────── */
  function genSeeds(w, h, seed) {
    var r = mkRng(seed);
    var wisps = [], dots = [];

    // Smoke wisps — weighted toward bottom 50%
    for (var i = 0; i < 28; i++) {
      wisps.push({
        x:   r() * w,
        y:   h * 0.5 + r() * h * 0.5,
        rad: 80 + r() * 180,
        op:  0.05 + r() * 0.06,
        spd: 0.35 + r() * 0.30
      });
    }
    // Extra thin wisps spread across canvas
    for (var j = 0; j < 12; j++) {
      wisps.push({
        x:   r() * w,
        y:   r() * h,
        rad: 50 + r() * 80,
        op:  0.02 + r() * 0.025,
        spd: 0.20 + r() * 0.20
      });
    }

    // Ember particles — denser and more visible than before
    // ~2× more particles, 30% are "bright" embers
    var nDots = Math.round((w * h) / 5500);
    for (var k = 0; k < nDots; k++) {
      var bias     = r();
      var isBright = r() < 0.30;
      dots.push({
        x:            r() * w,
        y:            bias < 0.70 ? (h * 0.5 + r() * h * 0.5) : r() * h,
        r:            isBright ? (1.5 + r() * 2.0) : (0.7 + r() * 1.3),
        op:           isBright ? (0.50 + r() * 0.35) : (0.07 + r() * 0.10),
        spd:          0.38 + r() * 0.58,
        flickerPhase: r() * Math.PI * 2
      });
    }

    return { wisps: wisps, dots: dots };
  }

  /* ── Smoke & ember rendering ───────────────────────────── */
  // t = elapsed time in SECONDS — frame-rate independent.
  // At 15 fps: t = frame/15.  At 30 fps: t = frame/30.
  // Drift speed ~15 px/s; flicker ~0.9 Hz (gentle, ambient).
  function drawSmoke(ctx, w, h, seeds, t, emberColor) {
    ctx.save();
    t = t || 0;
    var DRIFT = 15; // px per second of drift

    // ── Smoke wisps (dark, always) ──────────────────────
    seeds.wisps.forEach(function (ws) {
      var drift = t * ws.spd * DRIFT;
      var y = ((ws.y - drift) % (h + ws.rad * 2) + h + ws.rad * 2) % (h + ws.rad * 2) - ws.rad;
      var g = ctx.createRadialGradient(ws.x, y, 0, ws.x, y, ws.rad);
      g.addColorStop(0,   'rgba(18,18,18,' + (ws.op * 3.0).toFixed(4) + ')');
      g.addColorStop(0.5, 'rgba(10,10,10,' + (ws.op * 1.5).toFixed(4) + ')');
      g.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ws.x, y, ws.rad, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── Ember particles ─────────────────────────────────
    if (emberColor) {
      var rgb = hexToRGB(emberColor);
      seeds.dots.forEach(function (d) {
        var drift = t * d.spd * DRIFT;
        var y = ((d.y - drift) % (h + 10) + h + 10) % (h + 10) - 5;
        // Flicker at ~0.9 Hz — ambient, not flashy. Frame-rate independent.
        var flicker = 0.55 + 0.45 * Math.sin(t * Math.PI * 2 * 0.9 + d.flickerPhase);
        var alpha   = Math.min(1, d.op * flicker);

        // Core dot
        ctx.beginPath();
        ctx.arc(d.x, y, d.r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha.toFixed(4) + ')';
        ctx.fill();

        // Glow halo on bright embers
        if (d.op > 0.40) {
          var glowR = d.r * 3.5;
          var g2    = ctx.createRadialGradient(d.x, y, 0, d.x, y, glowR);
          g2.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + (alpha * 0.35).toFixed(4) + ')');
          g2.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0)');
          ctx.beginPath();
          ctx.arc(d.x, y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = g2;
          ctx.fill();
        }
      });
    } else {
      // Tebex: very subtle neutral dust only
      seeds.dots.forEach(function (d) {
        var drift = t * d.spd * DRIFT;
        var y = ((d.y - drift) % (h + 10) + h + 10) % (h + 10) - 5;
        ctx.beginPath();
        ctx.arc(d.x, y, d.r * 0.6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(180,180,180,' + (d.op * 0.25).toFixed(4) + ')';
        ctx.fill();
      });
    }

    ctx.restore();
  }

  /* ── Layout zone calculators ───────────────────────────── */
  function getZones11(lay) {
    var M  = 65,   W  = 1080, H  = 1080;
    var LW = 238,  LH = 118;   // logo max
    var TW = 648,  TH = 313;   // title max
    var CW = 475,  CH = 85;    // cta max — reduced height keeps button snug under title
    var titBot = H - 237;      // 843  — bottom of title zone
    var titTop = titBot - TH;  // 530  — top of title zone
    var ctaTop = titBot;       // 843  — zero gap: CTA zone starts right at title zone bottom

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
    var ctaPulse   = (fstate && fstate.ctaPulse   !== undefined) ? fstate.ctaPulse   : 0;

    var tz = zones.title;
    var cz = zones.cta;

    // ── Headline ──────────────────────────────────────────
    var maxStartSz = is916 ? 110 : 96;
    var fit    = fitFont(ctx, msg, tz.w, tz.h, maxStartSz, BF);
    var sz     = fit.sz;
    var lines  = fit.lines;
    var lineH  = sz * 1.25;
    var totalH = lines.length * lineH;
    var startY = tz.y + (tz.h - totalH) / 2 + lineH / 2;

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

    // ── CTA button — only rendered when cta text is present ──
    if (cta && cta.trim()) {
      var ctaText  = cta.toUpperCase();               // always CAPS
      var ctaFontSz = is916 ? 42 : 36;
      ctx.save();
      ctx.font = '700 ' + ctaFontSz + 'px ' + BF;   // Montserrat, not Lato
      var txtW  = ctx.measureText(ctaText).width;
      var padH  = is916 ? 36 : 34;
      var padV  = is916 ? 22 : 20;
      var btnW  = Math.min(cz.w, txtW + padH * 2);
      var btnH  = Math.min(cz.h, ctaFontSz + padV * 2);

      var bx = cz.al === 'left'   ? cz.x :
               cz.al === 'right'  ? cz.x + cz.w - btnW :
                                     cz.x + (cz.w - btnW) / 2;
      var by = cz.y + (cz.h - btnH) / 2;

      // Pulse: smooth scale + accent glow
      var scale = 1 + ctaPulse * 0.07;
      ctx.translate(bx + btnW / 2, by + btnH / 2);
      ctx.scale(scale, scale);

      // Glow layer
      if (ctaPulse > 0.15) {
        var glowSize  = ctaPulse * 28;
        var rgb       = hexToRGB(brand.accent);
        var glowAlpha = ctaPulse * 0.55;
        var g = ctx.createRadialGradient(0, 0, 0, 0, 0, btnW * 0.8);
        g.addColorStop(0, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + glowAlpha.toFixed(3) + ')');
        g.addColorStop(1, 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',0)');
        ctx.beginPath();
        ctx.rect(-btnW / 2 - glowSize, -btnH / 2 - glowSize,
                 btnW + glowSize * 2, btnH + glowSize * 2);
        ctx.fillStyle = g;
        ctx.fill();
      }

      // Button fill
      ctx.fillStyle = brand.accent;
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
      if (subLabel && subLabel.trim()) {
        var subFontSz = is916 ? 22 : 17;
        ctx.save();
        ctx.font         = '300 ' + subFontSz + 'px ' + BF;  // Montserrat Light
        ctx.fillStyle    = 'rgba(255,255,255,0.65)';
        ctx.textAlign    = cz.al === 'center' ? 'center' : 'left';
        ctx.textBaseline = 'top';
        ctx.shadowColor  = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur   = 6;
        if ('letterSpacing' in ctx) ctx.letterSpacing = '0.10em';
        var subX = cz.al === 'center' ? (cz.x + cz.w / 2) : cz.x;
        // Gap below button = same visual weight as the gap above button from title zone bottom.
        // Title zone bottom → button top is (cz.y + (cz.h-btnH)/2) - titBot,
        // which works out to roughly btnH/2 worth of zone padding.
        // Matching that: gap = half the button height keeps it balanced.
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
    var subLabel = state.subLabel || '';

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

    drawBg(ctx, bgImg, w, h);
    drawSmoke(ctx, w, h, seeds, t, brand.emberColor || null);
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
