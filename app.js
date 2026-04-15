'use strict';

/* ============================================================
   APP MODULE — Wizard flow, state, UI wiring
   ============================================================ */

(function () {

  /* ── State ──────────────────────────────────────────────── */
  var state = {
    brand:           null,   // 'overwolf' | 'tebex' | 'outplayed'
    image:           null,   // image object from images.json
    layout:          null,   // 'left' | 'right' | 'center'
    messageMode:     'preset',
    messagePreset:   null,
    messagePosition: '',
    cta:             null,
    // internal
    images:          {}      // loaded from images.json
  };

  /* ── DOM refs ───────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };

  var elSteps      = [null, $('step-1'), $('step-2'), $('step-3'), $('step-4'), $('step-5')];
  var elSiItems    = document.querySelectorAll('.si-item');
  var elSiLines    = document.querySelectorAll('.si-line');

  var elBrandGrid  = $('brand-grid');
  var elImageGrid  = $('image-grid');
  var elLayoutPills= $('layout-pills');
  var elPresetGrid = $('preset-grid');
  var elPosInput   = $('pos-input');
  var elPresetMode = $('preset-mode');
  var elPosMode    = $('pos-mode');
  var elCtaGrid    = $('cta-grid');

  var elBtnExport  = $('btn-export');
  var elProgressWrap  = $('progress-wrap');
  var elProgressFill  = $('progress-fill');
  var elProgressLabel = $('progress-label');
  var elSuccessState  = $('success-state');
  var elExportArea    = $('export-area');

  /* ── Accent CSS variables ─────────────────────────────── */
  function setAccent(brand) {
    var b = brand ? BRANDS[brand] : { accent: '#D34037', accentHover: '#F05C48' };
    document.documentElement.style.setProperty('--accent',       b.accent);
    document.documentElement.style.setProperty('--accent-hover', b.accentHover);
    // Update ow-f for focus ring
    var hex = b.accent;
    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var bl = parseInt(hex.slice(5, 7), 16);
    document.documentElement.style.setProperty('--ow-f', 'rgba(' + r + ',' + g + ',' + bl + ',0.20)');
  }

  /* ── Step completion logic ────────────────────────────── */
  function isComplete(n) {
    if (n === 1) return !!state.brand;
    if (n === 2) return !!state.image;
    if (n === 3) return !!state.layout;
    if (n === 4) {
      if (state.messageMode === 'preset') return !!state.messagePreset;
      return state.messagePosition.trim().length > 0;
    }
    if (n === 5) return !!state.cta;
    return false;
  }

  function allComplete() {
    return isComplete(1) && isComplete(2) && isComplete(3) && isComplete(4) && isComplete(5);
  }

  /* ── Update step indicator ────────────────────────────── */
  function updateIndicator() {
    elSiItems.forEach(function (el, i) {
      var n = i + 1;
      el.classList.remove('active', 'done');
      if (isComplete(n)) {
        el.classList.add('done');
        el.querySelector('.si-dot').textContent = '✓';
      } else {
        el.querySelector('.si-dot').textContent = String(n);
        // Current step = first incomplete
        if (!isComplete(n) && (n === 1 || isComplete(n - 1))) {
          el.classList.add('active');
        }
      }
    });
    elSiLines.forEach(function (el, i) {
      el.classList.toggle('done', isComplete(i + 1));
    });
  }

  /* ── Step label summaries ─────────────────────────────── */
  function stepSummary(n) {
    if (n === 1) return state.brand ? BRANDS[state.brand].name : '';
    if (n === 2) return state.image ? state.image.label : '';
    if (n === 3) return state.layout ? (state.layout.charAt(0).toUpperCase() + state.layout.slice(1) + '-aligned') : '';
    if (n === 4) {
      if (state.messageMode === 'preset') return state.messagePreset || '';
      return state.messagePosition.trim() ? ('"' + state.messagePosition.trim() + '"') : '';
    }
    if (n === 5) return state.cta || '';
    return '';
  }

  /* ── Render all wizard steps ──────────────────────────── */
  function renderWizard() {
    for (var n = 1; n <= 5; n++) {
      var el = elSteps[n];
      if (!el) continue;

      var unlocked = (n === 1) || isComplete(n - 1);
      var complete  = isComplete(n);
      var isCurrent = unlocked && !complete;

      el.classList.toggle('locked',   !unlocked);
      el.classList.toggle('active',   isCurrent || (complete && el.classList.contains('active')));
      el.classList.toggle('complete', complete);

      // Summary tag
      var sumEl = el.querySelector('.step-selection');
      if (sumEl) sumEl.textContent = stepSummary(n);
    }
    updateIndicator();
    elBtnExport.disabled = !allComplete();
  }

  /* ── Open / collapse a step ───────────────────────────── */
  function openStep(n) {
    for (var i = 1; i <= 5; i++) {
      if (!elSteps[i]) continue;
      if (i === n && !elSteps[i].classList.contains('locked')) {
        elSteps[i].classList.add('active');
      } else {
        elSteps[i].classList.remove('active');
      }
    }
  }

  /* ── Advance to next uncompleted step ─────────────────── */
  function advance() {
    for (var n = 1; n <= 5; n++) {
      if (!isComplete(n)) {
        openStep(n);
        // Scroll into view
        if (elSteps[n]) {
          setTimeout(function () {
            elSteps[n] && elSteps[n].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }, 80);
        }
        return;
      }
    }
  }

  /* ── Trigger preview re-render ────────────────────────── */
  var _renderTimer = null;
  function scheduleRender() {
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(function () {
      document.fonts.ready.then(function () {
        CANVAS.render(state).catch(function (e) { console.warn('[CANVAS]', e); });
      });
    }, 60);
  }

  /* ═══════════════════════════════════════════════════════
     STEP 1 — Brand selection
  ══════════════════════════════════════════════════════════ */
  function buildBrandGrid() {
    Object.keys(BRANDS).forEach(function (key) {
      var b   = BRANDS[key];
      var div = document.createElement('div');
      div.className = 'brand-card';
      div.dataset.brand = key;
      div.innerHTML =
        '<img src="' + b.logo + '" alt="' + b.name + '">' +
        '<span class="brand-card-name">' + b.name + '</span>';
      div.addEventListener('click', function () { onBrandSelect(key); });
      elBrandGrid.appendChild(div);
    });
  }

  function onBrandSelect(key) {
    if (state.brand === key) return;
    state.brand           = key;
    // Reset downstream steps
    state.image           = null;
    state.layout          = null;
    state.messagePreset   = null;
    state.messagePosition = '';
    state.cta             = null;
    CANVAS.resetSeeds();

    setAccent(key);
    syncBrandGrid();
    buildImageGrid(); // rebuild with new pool
    clearLayoutPills();
    clearPreset();
    clearCTA();

    renderWizard();
    advance();
    scheduleRender();
  }

  function syncBrandGrid() {
    elBrandGrid.querySelectorAll('.brand-card').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.brand === state.brand);
    });
  }

  /* ═══════════════════════════════════════════════════════
     STEP 2 — Image selection
  ══════════════════════════════════════════════════════════ */
  function buildImageGrid() {
    elImageGrid.innerHTML = '';
    if (!state.brand) return;

    var poolKey = BRANDS[state.brand].imagePool;
    // Try state.images first, fall back to global IMAGES_DATA directly
    var src  = (state.images && state.images[poolKey] && state.images[poolKey].length)
               ? state.images
               : (typeof IMAGES_DATA !== 'undefined' ? IMAGES_DATA : {});
    var pool = src[poolKey] || [];

    if (pool.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      var hasData = typeof IMAGES_DATA !== 'undefined';
      var dataLen = hasData ? (IMAGES_DATA[poolKey] || []).length : '?';
      empty.innerHTML =
        '<strong>No visuals added yet for this brand.</strong>' +
        '<small style="display:block;margin-top:8px;color:#666;font-size:10px">' +
        'debug: IMAGES_DATA=' + (hasData ? 'defined' : 'MISSING') +
        ' pool=' + poolKey + ' count=' + dataLen +
        '</small>';
      elImageGrid.appendChild(empty);
      return;
    }

    pool.forEach(function (img) {
      var div = document.createElement('div');
      div.className = 'image-thumb';
      div.dataset.id = img.id;

      var imgEl = document.createElement('img');
      imgEl.src = img.file;
      imgEl.alt = img.label;
      imgEl.loading = 'lazy';

      var lbl = document.createElement('div');
      lbl.className = 'image-thumb-label';
      lbl.textContent = img.label;

      div.appendChild(imgEl);
      div.appendChild(lbl);
      div.addEventListener('click', function () { onImageSelect(img); });
      elImageGrid.appendChild(div);
    });
  }

  function onImageSelect(img) {
    state.image  = img;
    state.layout = null;  // reset layout — different image may have different options
    CANVAS.resetSeeds();
    syncImageGrid();
    buildLayoutPills(img.layouts || []);
    renderWizard();
    advance();
    scheduleRender();
  }

  function syncImageGrid() {
    elImageGrid.querySelectorAll('.image-thumb').forEach(function (el) {
      el.classList.toggle('selected', state.image && el.dataset.id === state.image.id);
    });
  }

  /* ═══════════════════════════════════════════════════════
     STEP 3 — Layout selection
  ══════════════════════════════════════════════════════════ */
  var LAYOUT_DEFS = {
    left:   { label: 'Left-Aligned',  diag: 'l' },
    right:  { label: 'Right-Aligned', diag: 'r' },
    center: { label: 'Centered',      diag: 'c' }
  };

  function buildLayoutPills(allowed) {
    elLayoutPills.innerHTML = '';
    Object.keys(LAYOUT_DEFS).forEach(function (key) {
      var def  = LAYOUT_DEFS[key];
      var pill = document.createElement('div');
      pill.className = 'layout-pill' + (allowed.indexOf(key) === -1 ? ' disabled' : '');
      pill.dataset.layout = key;

      var d = def.diag;
      pill.innerHTML =
        '<div class="layout-diagram">' +
          '<div class="ld-img"></div>' +
          '<div class="ld-text-' + d + '"></div>' +
          '<div class="ld-cta ld-cta-' + d + '"></div>' +
        '</div>' +
        '<span class="layout-label">' + def.label + '</span>';

      pill.addEventListener('click', function () { onLayoutSelect(key); });
      elLayoutPills.appendChild(pill);
    });
  }

  function clearLayoutPills() {
    elLayoutPills.innerHTML = '';
  }

  function onLayoutSelect(key) {
    state.layout = key;
    elLayoutPills.querySelectorAll('.layout-pill').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.layout === key);
    });
    renderWizard();
    advance();
    scheduleRender();
  }

  /* ═══════════════════════════════════════════════════════
     STEP 4 — Message
  ══════════════════════════════════════════════════════════ */
  function buildPresetGrid() {
    PRESET_COPY.forEach(function (text) {
      var chip = document.createElement('div');
      chip.className = 'preset-chip';
      chip.dataset.value = text;
      chip.textContent = text;
      chip.addEventListener('click', function () { onPresetSelect(text); });
      elPresetGrid.appendChild(chip);
    });
  }

  function clearPreset() {
    elPresetGrid.querySelectorAll('.preset-chip').forEach(function (el) {
      el.classList.remove('selected');
    });
    state.messagePreset   = null;
    state.messagePosition = '';
    if (elPosInput) elPosInput.value = '';
  }

  function onPresetSelect(text) {
    state.messagePreset = text;
    elPresetGrid.querySelectorAll('.preset-chip').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.value === text);
    });
    renderWizard();
    advance();
    scheduleRender();
  }

  function onModeToggle(mode) {
    state.messageMode = mode;
    state.messagePreset   = null;
    state.messagePosition = '';
    if (elPosInput) elPosInput.value = '';

    document.querySelectorAll('.radio-btn').forEach(function (el) {
      el.classList.toggle('active', el.dataset.mode === mode);
    });

    if (elPresetMode) elPresetMode.classList.toggle('hidden',  mode !== 'preset');
    if (elPosMode)    elPosMode.classList.toggle('visible', mode === 'position');

    renderWizard();
    scheduleRender();
  }

  /* ═══════════════════════════════════════════════════════
     STEP 5 — CTA
  ══════════════════════════════════════════════════════════ */
  function buildCTAGrid() {
    CTA_OPTIONS.forEach(function (text) {
      var chip = document.createElement('div');
      chip.className = 'cta-chip';
      chip.dataset.value = text;
      chip.textContent = text;
      chip.addEventListener('click', function () { onCTASelect(text); });
      elCtaGrid.appendChild(chip);
    });
  }

  function clearCTA() {
    elCtaGrid.querySelectorAll('.cta-chip').forEach(function (el) {
      el.classList.remove('selected');
    });
    state.cta = null;
  }

  function onCTASelect(text) {
    state.cta = text;
    elCtaGrid.querySelectorAll('.cta-chip').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.value === text);
    });
    renderWizard();
    scheduleRender();
  }

  /* ═══════════════════════════════════════════════════════
     STEP HEADER clicks (collapse / expand)
  ══════════════════════════════════════════════════════════ */
  function wireStepHeaders() {
    for (var n = 1; n <= 5; n++) {
      (function (num) {
        var hd = elSteps[num] && elSteps[num].querySelector('.step-hd');
        if (!hd) return;
        hd.addEventListener('click', function () {
          if (elSteps[num].classList.contains('locked')) return;
          var isOpen = elSteps[num].classList.contains('active');
          if (isOpen && isComplete(num)) {
            // Collapse completed step
            elSteps[num].classList.remove('active');
          } else {
            openStep(num);
          }
        });
      })(n);
    }
  }

  /* ═══════════════════════════════════════════════════════
     STEP INDICATOR clicks
  ══════════════════════════════════════════════════════════ */
  function wireIndicator() {
    elSiItems.forEach(function (el, i) {
      el.addEventListener('click', function () {
        var n = i + 1;
        var unlocked = (n === 1) || isComplete(n - 1);
        if (unlocked) openStep(n);
      });
    });
  }

  /* ═══════════════════════════════════════════════════════
     EXPORT
  ══════════════════════════════════════════════════════════ */
  function onExport() {
    if (!allComplete()) return;

    // Hide button, show progress
    elBtnExport.style.display    = 'none';
    elProgressWrap.style.display = 'flex';
    elSuccessState.style.display = 'none';

    EXPORT.generatePackage(
      state,
      function (pct, label) {
        elProgressFill.style.width  = pct + '%';
        elProgressLabel.textContent = label || '';
      },
      function (info) {
        // Success
        elProgressWrap.style.display = 'none';

        var vidLabel = info.videoExt === 'webm' ? 'WebM (rename to .mp4 if needed)' : 'MP4';
        elSuccessState.innerHTML =
          '<div class="success-header">' +
            '<div class="success-icon">✓</div>' +
            '<span class="success-title">Package downloaded!</span>' +
          '</div>' +
          '<div class="success-files">' +
            '<div class="success-file">banner-1x1.png <span>' + info.png11Size + ' KB</span></div>' +
            '<div class="success-file">banner-1x1.gif <span>' + info.gif11Size + ' KB</span></div>' +
            '<div class="success-file">banner-9x16.png <span>' + info.png916Size + ' KB</span></div>' +
            '<div class="success-file">banner-9x16.' + info.videoExt +
              ' <span class="' + (info.videoExt === 'webm' ? 'webm' : '') + '">' + info.vidSize + ' KB</span></div>' +
          '</div>' +
          (info.videoExt === 'webm' ? '<p class="success-note">⚠ Video saved as .webm — rename to .mp4 if your platform requires it.</p>' : '') +
          '<div class="action-bar" style="margin-top:12px">' +
            '<button class="btn-s" id="btn-restart" style="width:100%;justify-content:center">↩ Start Over</button>' +
          '</div>';

        elSuccessState.style.display = 'flex';
        elSuccessState.style.flexDirection = 'column';
        elSuccessState.style.gap = '12px';

        var restartBtn = document.getElementById('btn-restart');
        if (restartBtn) restartBtn.addEventListener('click', onRestart);
      },
      function (errMsg) {
        // Error
        elProgressWrap.style.display = 'none';
        elProgressLabel.textContent  = '✗ ' + errMsg;
        elProgressLabel.style.color  = 'var(--terr)';
        elProgressWrap.style.display = 'flex';
        // Re-show button after delay
        setTimeout(function () {
          elProgressWrap.style.display = 'none';
          elBtnExport.style.display    = '';
          elProgressLabel.style.color  = '';
        }, 4000);
      }
    );
  }

  /* ── Start over ──────────────────────────────────────── */
  function onRestart() {
    state.brand           = null;
    state.image           = null;
    state.layout          = null;
    state.messageMode     = 'preset';
    state.messagePreset   = null;
    state.messagePosition = '';
    state.cta             = null;
    CANVAS.resetSeeds();
    setAccent(null);

    syncBrandGrid();
    buildImageGrid();
    clearLayoutPills();
    clearPreset();
    clearCTA();

    // Reset mode toggle UI
    document.querySelectorAll('.radio-btn').forEach(function (el) {
      el.classList.toggle('active', el.dataset.mode === 'preset');
    });
    if (elPresetMode) elPresetMode.classList.remove('hidden');
    if (elPosMode)    elPosMode.classList.remove('visible');

    // Reset export area
    elSuccessState.style.display = 'none';
    elProgressWrap.style.display = 'none';
    elBtnExport.style.display    = '';
    elProgressLabel.style.color  = '';

    renderWizard();
    openStep(1);
    scheduleRender();
  }

  /* ═══════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════ */
  function init() {
    // Init canvases
    CANVAS.init($('canvas-11'), $('canvas-916'));

    // Load images from the pre-generated JS manifest (works on file:// and Netlify)
    if (typeof IMAGES_DATA !== 'undefined') {
      state.images = IMAGES_DATA;
    } else {
      console.warn('[images-data.js] not loaded — run: node generate-manifest.js');
      state.images = { overwolf: [], tebex: [], outplayed: [] };
    }

    // Build static grids
    buildBrandGrid();
    buildPresetGrid();
    buildCTAGrid();

    // Mode toggle buttons
    document.querySelectorAll('.radio-btn').forEach(function (el) {
      el.addEventListener('click', function () { onModeToggle(el.dataset.mode); });
    });

    // Position input
    if (elPosInput) {
      elPosInput.addEventListener('input', function () {
        state.messagePosition = elPosInput.value;
        renderWizard();
        scheduleRender();
      });
    }

    // Export button
    if (elBtnExport) {
      elBtnExport.addEventListener('click', onExport);
    }

    // Step headers + indicator
    wireStepHeaders();
    wireIndicator();

    // Initial render
    renderWizard();
    openStep(1);
    scheduleRender();
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
