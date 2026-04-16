'use strict';

/* ============================================================
   APP MODULE — Wizard flow, state, UI wiring
   ============================================================ */

(function () {

  /* ── State ──────────────────────────────────────────────── */
  var state = {
    brand:           null,   // 'overwolf' | 'tebex' | 'outplayed'
    image:           null,   // image object from manifest
    layout:          'left', // always left — layout step removed
    messageMode:     'position',
    messagePreset:   null,
    messagePosition: '',
    cta:             null,
    subLabel:        '',     // optional note below CTA button
    // internal
    images:          {}
  };

  var SUBLABEL_OPTIONS = [
    'UK Based *',
    'US Based *',
    'Remote *',
    'Hybrid *',
    'Part Time *',
    'Maternity Leave Cover *'
  ];

  /* ── DOM refs ───────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };

  var elSteps      = [null, $('step-1'), $('step-2'), $('step-3'), $('step-4')];
  var elSiItems    = document.querySelectorAll('.si-item');
  var elSiLines    = document.querySelectorAll('.si-line');

  var elBrandGrid  = $('brand-grid');
  var elImageGrid  = $('image-grid');
  var elPresetGrid = $('preset-grid');
  var elPosInput   = $('pos-input');
  var elPresetMode = $('preset-mode');
  var elPosMode    = $('pos-mode');
  var elCtaGrid    = $('cta-grid');
  var elSubChips   = $('sublabel-chips');
  var elSubOtherWrap  = $('sublabel-other-wrap');
  var elSubOtherInput = $('sublabel-other-input');

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
    if (n === 3) {
      if (state.messageMode === 'preset') return !!state.messagePreset;
      return state.messagePosition.trim().length > 0;
    }
    if (n === 4) return !!state.cta;
    return false;
  }

  function allComplete() {
    return isComplete(1) && isComplete(2) && isComplete(3) && isComplete(4);
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
    if (n === 3) {
      if (state.messageMode === 'preset') return state.messagePreset || '';
      return state.messagePosition.trim() ? ('"' + state.messagePosition.trim() + '"') : '';
    }
    if (n === 4) return state.cta || '';
    return '';
  }

  /* ── Render all wizard steps ──────────────────────────── */
  function renderWizard() {
    for (var n = 1; n <= 4; n++) {
      var el = elSteps[n];
      if (!el) continue;

      var unlocked = (n === 1) || isComplete(n - 1);
      var complete  = isComplete(n);
      var isCurrent = unlocked && !complete;

      el.classList.toggle('locked',   !unlocked);
      el.classList.toggle('active',   isCurrent || (complete && el.classList.contains('active')));
      el.classList.toggle('complete', complete);

      var sumEl = el.querySelector('.step-selection');
      if (sumEl) sumEl.textContent = stepSummary(n);
    }
    updateIndicator();
    elBtnExport.disabled = !allComplete();
  }

  /* ── Open / collapse a step ───────────────────────────── */
  function openStep(n) {
    for (var i = 1; i <= 4; i++) {
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
    for (var n = 1; n <= 4; n++) {
      if (!isComplete(n)) {
        openStep(n);
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
    state.image           = null;
    state.layout          = 'left';
    state.messagePreset   = null;
    state.messagePosition = '';
    state.cta             = null;
    state.subLabel        = '';
    CANVAS.resetSeeds();

    setAccent(key);
    syncBrandGrid();
    buildImageGrid();
    clearPreset();
    clearCTA();
    clearSubLabel();

    renderWizard();
    advance();
    scheduleRender();
    CANVAS.prewarmExportImages(state);
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
    var src  = (state.images && state.images[poolKey] && state.images[poolKey].length)
               ? state.images
               : (typeof IMAGES_DATA !== 'undefined' ? IMAGES_DATA : {});
    var pool = src[poolKey] || [];

    if (pool.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML =
        '<strong>No visuals added yet for this brand.</strong>' +
        'Drop images into <code>assets/images/' + poolKey + '/</code> and run <code>node generate-manifest.js</code>.';
      elImageGrid.appendChild(empty);
      return;
    }

    pool.forEach(function (img) {
      var div = document.createElement('div');
      div.className = 'image-thumb';
      div.dataset.id = img.id;

      var imgEl = document.createElement('img');
      // Prefer the 1:1 file for the square thumbnail; fall back to 9:16 or legacy .file
      imgEl.src = img.file11 || img.file916 || img.file || '';
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
    state.layout = 'left';
    CANVAS.resetSeeds();
    syncImageGrid();
    renderWizard();
    // No advance() — let the user browse images freely before moving on.
    scheduleRender();
    CANVAS.prewarmExportImages(state);
  }

  function syncImageGrid() {
    elImageGrid.querySelectorAll('.image-thumb').forEach(function (el) {
      el.classList.toggle('selected', state.image && el.dataset.id === state.image.id);
    });
  }

  /* ═══════════════════════════════════════════════════════
     STEP 3 — Message
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
    // No advance() — consistent with position-text input; user moves on at their own pace.
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
     STEP 4 — Action text + optional sub-label
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

  /* ── Sub-label (optional note below CTA button) ───────── */
  function buildSubLabelChips() {
    SUBLABEL_OPTIONS.forEach(function (text) {
      var chip = document.createElement('div');
      chip.className = 'sublabel-chip';
      chip.dataset.value = text;
      chip.textContent = text;
      chip.addEventListener('click', function () { onSubLabelSelect(text); });
      elSubChips.appendChild(chip);
    });
    // "Other" chip
    var other = document.createElement('div');
    other.className = 'sublabel-chip';
    other.dataset.value = '__other__';
    other.textContent = 'Other…';
    other.addEventListener('click', function () { onSubLabelSelect('__other__'); });
    elSubChips.appendChild(other);
  }

  function onSubLabelSelect(value) {
    if (value === '__other__') {
      // Show text input, clear preset selection
      elSubChips.querySelectorAll('.sublabel-chip').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.value === '__other__');
      });
      elSubOtherWrap.style.display = '';
      elSubOtherInput.focus();
      state.subLabel = elSubOtherInput ? elSubOtherInput.value : '';
      scheduleRender();
      return;
    }
    // Toggle off if already selected
    if (state.subLabel === value) {
      state.subLabel = '';
      elSubChips.querySelectorAll('.sublabel-chip').forEach(function (el) {
        el.classList.remove('selected');
      });
      elSubOtherWrap.style.display = 'none';
      scheduleRender();
      return;
    }
    state.subLabel = value;
    elSubChips.querySelectorAll('.sublabel-chip').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.value === value);
    });
    elSubOtherWrap.style.display = 'none';
    if (elSubOtherInput) elSubOtherInput.value = '';
    scheduleRender();
  }

  function clearSubLabel() {
    state.subLabel = '';
    if (elSubChips) elSubChips.querySelectorAll('.sublabel-chip').forEach(function (el) {
      el.classList.remove('selected');
    });
    if (elSubOtherWrap) elSubOtherWrap.style.display = 'none';
    if (elSubOtherInput) elSubOtherInput.value = '';
  }

  /* ═══════════════════════════════════════════════════════
     STEP HEADER clicks
  ══════════════════════════════════════════════════════════ */
  function wireStepHeaders() {
    for (var n = 1; n <= 4; n++) {
      (function (num) {
        var hd = elSteps[num] && elSteps[num].querySelector('.step-hd');
        if (!hd) return;
        hd.addEventListener('click', function () {
          if (elSteps[num].classList.contains('locked')) return;
          var isOpen = elSteps[num].classList.contains('active');
          if (isOpen && isComplete(num)) {
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
  function _runExport(dirHandle) {
    elBtnExport.style.display    = 'none';
    elProgressWrap.style.display = 'flex';
    elSuccessState.style.display = 'none';

    var filenameEl = document.getElementById('filename-input');
    var filename   = filenameEl ? filenameEl.value : 'recruitment-banners';

    EXPORT.generatePackage(
      state,
      function (pct, label) {
        elProgressFill.style.width  = pct + '%';
        elProgressLabel.textContent = label || '';
      },
      function (info) {
        elProgressWrap.style.display = 'none';

        var folderSave = info.savedAs === 'folder';
        var titleText  = folderSave ? 'Files saved to folder!' : 'Package downloaded!';
        var noteText   = folderSave
          ? '<p class="success-note" style="color:var(--tok)">✓ Saved directly — no ZIP, no security warnings.</p>'
          : (info.videoExt === 'webm' ? '<p class="success-note">⚠ Video saved as .webm — rename to .mp4 if needed.</p>' : '');

        elSuccessState.innerHTML =
          '<div class="success-header">' +
            '<div class="success-icon">✓</div>' +
            '<span class="success-title">' + titleText + '</span>' +
          '</div>' +
          '<div class="success-files">' +
            '<div class="success-file">banner-1x1.png <span>'  + info.png11Size  + ' KB</span></div>' +
            '<div class="success-file">banner-1x1.gif <span>'  + info.gif11Size  + ' KB</span></div>' +
            '<div class="success-file">banner-9x16.png <span>' + info.png916Size + ' KB</span></div>' +
            '<div class="success-file">banner-9x16.' + info.videoExt +
              ' <span class="' + (info.videoExt === 'webm' ? 'webm' : '') + '">' + info.vidSize + ' KB</span></div>' +
          '</div>' +
          noteText +
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
        // '__cancelled__' means the user closed the folder/file picker — restore quietly
        if (errMsg === '__cancelled__') {
          elProgressWrap.style.display = 'none';
          elBtnExport.style.display    = '';
          return;
        }
        elProgressWrap.style.display = 'none';
        elProgressLabel.textContent  = '✗ ' + errMsg;
        elProgressLabel.style.color  = 'var(--terr)';
        elProgressWrap.style.display = 'flex';
        setTimeout(function () {
          elProgressWrap.style.display = 'none';
          elBtnExport.style.display    = '';
          elProgressLabel.style.color  = '';
        }, 4000);
      },
      filename,
      dirHandle   // FileSystemDirectoryHandle (or null → ZIP fallback)
    );
  }

  function onExport() {
    if (!allComplete()) return;

    // showDirectoryPicker MUST be called synchronously inside this click
    // handler while the user-gesture token is still alive.  The rendering
    // pipeline (PNG + GIF + 10 s video) takes many seconds, so by the time
    // it finishes the gesture has expired and the browser throws:
    //   "Must be handling a user gesture to show a file picker."
    // Solution: call the picker HERE, get the directory handle, then pass
    // it into generatePackage which uses it after rendering is done.
    if (window.showDirectoryPicker) {
      elBtnExport.disabled = true;   // prevent double-click while picker is open
      window.showDirectoryPicker({ id: 'banner-export', startIn: 'downloads', mode: 'readwrite' })
        .then(function (dirHandle) {
          elBtnExport.disabled = false;
          _runExport(dirHandle);
        })
        .catch(function (err) {
          elBtnExport.disabled = false;
          if (err && err.name === 'AbortError') return; // user closed picker — do nothing
          console.warn('[APP] showDirectoryPicker failed, falling back to ZIP', err);
          _runExport(null);
        });
      return;
    }

    _runExport(null); // no showDirectoryPicker — fall back to ZIP
  }

  /* ── Start over ──────────────────────────────────────── */
  function onRestart() {
    state.brand           = null;
    state.image           = null;
    state.layout          = 'left';
    state.messageMode     = 'position';
    state.messagePreset   = null;
    state.messagePosition = '';
    state.cta             = null;
    state.subLabel        = '';
    CANVAS.resetSeeds();
    setAccent(null);

    syncBrandGrid();
    buildImageGrid();
    clearPreset();
    clearCTA();
    clearSubLabel();

    // Reset mode toggle UI — position is default
    document.querySelectorAll('.radio-btn').forEach(function (el) {
      el.classList.toggle('active', el.dataset.mode === 'position');
    });
    if (elPresetMode) elPresetMode.classList.add('hidden');
    if (elPosMode)    elPosMode.classList.add('visible');

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
    CANVAS.init($('canvas-11'), $('canvas-916'));

    try {
      var el = document.getElementById('images-data-block');
      state.images = el ? JSON.parse(el.textContent) : {};
    } catch (e) {
      console.warn('[images-data-block] parse error:', e);
      state.images = {};
    }

    buildBrandGrid();
    buildPresetGrid();
    buildCTAGrid();
    buildSubLabelChips();

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

    // Sub-label other input
    if (elSubOtherInput) {
      elSubOtherInput.addEventListener('input', function () {
        state.subLabel = elSubOtherInput.value;
        scheduleRender();
      });
    }

    // Export button
    if (elBtnExport) {
      elBtnExport.addEventListener('click', onExport);
    }

    wireStepHeaders();
    wireIndicator();

    renderWizard();
    openStep(1);
    scheduleRender();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
