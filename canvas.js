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

  const _imgCache = {};
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

  /* ── Image loading with cache ──────────────────────────── */
  function loadImg(src) {
    if (_imgCache[src]) return Promise.resolve(_imgCache[src]);
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload  = function () { _imgCache[src] = img; res(img); };
      img.onerror = function () { rej(new Error('Image load failed: ' + src)); };
      img.src = src;
    });
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

  /* ── Smoke seed generation ─────────────────────────────── */
  function genSeeds(w, h, seed) {
    var r = mkRng(seed);
    var wisps = [], dots = [];

    // Smoke wisps — weighted toward bottom 40 %
    for (var i = 0; i < 22; i++) {
      wisps.push({
        x:   r() * w,
        y:   h * 0.55 + r() * h * 0.45,
        rad: 65 + r() * 155,
        op:  0.025 + r() * 0.035,
        spd: 0.30 + r() * 0.25   // upward drift px/frame
      });
    }

    // Extra thin wisps spread across canvas
    for (var j = 0; j < 10; j++) {
      wisps.push({
        x:   r() * w,
        y:   r() * h,
        rad: 40 + r() * 60,
        op:  0.012 + r() * 0.018,
        spd: 0.20 + r() * 0.20
      });
    }

    // Particles — bias toward bottom text zone
    var nDots = Math.round((w * h) / 11000);
    for (var k = 0; k < nDots; k++) {
      var bias = r();
      dots.push({
        x:   r() * w,
        y:   bias < 0.65 ? (h * 0.6 + r() * h * 0.4) : r() * h,
        r:   1 + r(),
        op:  0.05 + r() * 0.09,
        spd: 0.22 + r() * 0.32
      });
    }

    return { wisps: wisps, dots: dots };
  }

  /* ── Smoke rendering (frame 0 = static) ───────────────── */
  function drawSmoke(ctx, w, h, seeds, frame) {
    ctx.save();
    var fr = frame || 0;

    seeds.wisps.forEach(function (ws) {
      var drift = fr * ws.spd;
      var y = ((ws.y - drift) % (h + ws.rad * 2) + h + ws.rad * 2) % (h + ws.rad * 2) - ws.rad;
      var g = ctx.createRadialGradient(ws.x, y, 0, ws.x, y, ws.rad);
      g.addColorStop(0, 'rgba(6,6,6,' + (ws.op * 2.4).toFixed(4) + ')');
      g.addColorStop(0.5, 'rgba(4,4,4,' + ws.op.toFixed(4) + ')');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(ws.x, y, ws.rad, 0, Math.PI * 2);
      ctx.fill();
    });

    seeds.dots.forEach(function (d) {
      var drift = fr * d.spd;
      var y = ((d.y - drift) % (h + 10) + h + 10) % (h + 10) - 5;
      ctx.beginPath();
      ctx.arc(d.x, y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(220,220,220,' + d.op.toFixed(4) + ')';
      ctx.fill();
    });

    ctx.restore();
  }

  /* ── Layout zone calculators ───────────────────────────── */
  function getZones11(lay) {
    var M  = 65,   W  = 1080, H  = 1080;
    var LW = 238,  LH = 118;   // logo max
    var TW = 648,  TH = 313;   // title max
    var CW = 475,  CH = 130;   // cta max
    var ctaTop = H - M - CH;   // 885
    var titBot = H - 237;      // 843
    var titTop = titBot - TH;  // 530

    if (lay === 'right') return {
      logo:  { x: W - M - LW,       y: M,      w: LW, h: LH, al: 'right'  },
      title: { x: W - M - TW,       y: titTop, w: TW, h: TH, al: 'right'  },
      cta:   { x: W - M - CW,       y: ctaTop, w: CW, h: CH, al: 'right'  }
    };
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

    if (lay === 'right') return {
      logo:  { x: W - M - LW,       y: SAFE, w: LW, h: LH, al: 'right'  },
      title: { x: W - M - TW,       y: 1000, w: TW, h: TH, al: 'right'  },
      cta:   { x: W - M - CW,       y: 1360, w: CW, h: CH, al: 'right'  }
    };
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
  function fitFont(ctx, text, maxW, maxH, startSz, font) {
    var sz = startSz;
    var lines;
    while (sz >= 24) {
      ctx.font = '800 ' + sz + 'px ' + font;
      lines = wrapText(ctx, text, maxW, 2);
      if (lines.length <= 2 && lines.length * sz * 1.25 <= maxH) break;
      sz -= 4;
    }
    return { sz: sz, lines: lines };
  }

  /* ── Text + CTA rendering ──────────────────────────────── */
  function drawText(ctx, zones, brand, msg, cta, is916, fstate) {
    var BF = "'Montserrat', sans-serif";
    var LF = "'Lato', sans-serif";
    var msgOpacity = (fstate && fstate.msgOpacity !== undefined) ? fstate.msgOpacity : 1;
    var ctaPulse   = (fstate && fstate.ctaPulse   !== undefined) ? fstate.ctaPulse   : 0;

    var tz = zones.title;
    var cz = zones.cta;

    // Headline
    var maxStartSz = is916 ? 110 : 96;
    var fit = fitFont(ctx, msg, tz.w, tz.h, maxStartSz, BF);
    var sz    = fit.sz;
    var lines = fit.lines;
    var lineH = sz * 1.25;
    var totalH = lines.length * lineH;
    var startY = tz.y + (tz.h - totalH) / 2 + lineH / 2;

    var anchorX = tz.al === 'left'   ? tz.x :
                  tz.al === 'right'  ? tz.x + tz.w :
                                       tz.x + tz.w / 2;

    ctx.save();
    ctx.globalAlpha  = msgOpacity;
    ctx.font         = '800 ' + sz + 'px ' + BF;
    ctx.fillStyle    = '#FFFFFF';
    ctx.textAlign    = tz.al;
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur   = sz * 0.35;
    ctx.shadowOffsetY = sz * 0.05;

    lines.forEach(function (line, i) {
      ctx.fillText(line, anchorX, startY + i * lineH);
    });
    ctx.restore();

    // CTA button
    var ctaFontSz = is916 ? 42 : 32;
    ctx.save();
    ctx.font = '700 ' + ctaFontSz + 'px ' + LF;
    var txtW = ctx.measureText(cta).width;
    var padH = is916 ? 36 : 32;   // horizontal padding
    var padV = is916 ? 22 : 18;   // vertical padding
    var btnW = Math.min(cz.w, txtW + padH * 2);
    var btnH = Math.min(cz.h, ctaFontSz + padV * 2);

    var bx = cz.al === 'left'   ? cz.x :
             cz.al === 'right'  ? cz.x + cz.w - btnW :
                                   cz.x + (cz.w - btnW) / 2;
    var by = cz.y + (cz.h - btnH) / 2;

    // Pulse scale transform
    var scale = 1 + Math.sin(ctaPulse * Math.PI) * 0.03;
    ctx.translate(bx + btnW / 2, by + btnH / 2);
    ctx.scale(scale, scale);

    ctx.fillStyle = brand.accent;
    ctx.fillRect(-btnW / 2, -btnH / 2, btnW, btnH);

    ctx.fillStyle    = brand.ctaTextColor;
    ctx.font         = '700 ' + ctaFontSz + 'px ' + LF;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor  = 'rgba(0,0,0,0)'; // no shadow on CTA text
    ctx.shadowBlur   = 0;
    ctx.fillText(cta, 0, 0);
    ctx.restore();
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
  async function renderToCtx(ctx, spec, state, frame, fstate, is916) {
    var w = spec.w, h = spec.h;
    ctx.clearRect(0, 0, w, h);

    var brand = BRANDS[state.brand];
    var lay   = state.layout || 'left';
    var msg   = state.messageMode === 'preset' ? state.messagePreset : state.messagePosition;
    var cta   = state.cta;

    // Load assets (cached after first call)
    var results = await Promise.all([
      state.image ? loadImg(state.image.file).catch(function () { return null; }) : Promise.resolve(null),
      loadImg(brand.logo).catch(function () { return null; })
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

    drawBg(ctx, bgImg, w, h);
    drawSmoke(ctx, w, h, seeds, frame || 0);
    if (msg && cta) drawText(ctx, zones, brand, msg, cta, is916, fstate || {});
    drawLogo(ctx, logoImg, zones.logo);
  }

  /* ── Public render (both canvases) ────────────────────── */
  async function render(state, frame, fstate) {
    if (!state || !state.brand) {
      // Blank slate
      [{ ctx: _x11, s: S11 }, { ctx: _x916, s: S916 }].forEach(function (p) {
        p.ctx.fillStyle = '#080808';
        p.ctx.fillRect(0, 0, p.s.w, p.s.h);
        // Subtle brand grid placeholder
        p.ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        p.ctx.lineWidth = 1;
        for (var x = 0; x < p.s.w; x += 120) {
          p.ctx.beginPath();
          p.ctx.moveTo(x, 0);
          p.ctx.lineTo(x, p.s.h);
          p.ctx.stroke();
        }
        for (var y = 0; y < p.s.h; y += 120) {
          p.ctx.beginPath();
          p.ctx.moveTo(0, y);
          p.ctx.lineTo(p.s.w, y);
          p.ctx.stroke();
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

  /* ── Invalidate seed cache (call after brand/image change) */
  function resetSeeds() { _seeds = null; _seedKey = ''; }

  return {
    init:        init,
    render:      render,
    renderToCtx: renderToCtx,
    resetSeeds:  resetSeeds,
    getC11:      function () { return _c11; },
    getC916:     function () { return _c916; },
    S11:         S11,
    S916:        S916
  };

})();
