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
    positionRef:     null,   // full position object when a chip is selected
    referralLink:    '',     // user-pasted https://careers.overwolf.com/career/…?ref=…
    cta:             null,
    subLabel:        [],     // optional notes below CTA button (multi-select)
    smartSuggestions:[],     // subset of subLabel that was auto-suggested for the current position
    // internal
    images:          {}
  };

  // Holds the generated blobs after Generate Package completes.
  // { png11, gif11, png916, videoResult: { blob, ext } | null }
  var _resultBlobs = null;
  var _resultVideoMime = '';

  var SUBLABEL_OPTIONS = [
    'UK Based *',
    'US Based *',
    'Israel Based *',
    'Remote *',
    'Hybrid *',
    'Part Time *',
    'Maternity Leave Cover *',
    'Outplayed',
    'Tebex',
    'CurseForge',
    'Overwolf Ads',
  ];

  // ISO 3166-1 alpha-2 country codes → human-readable names used by the
  // position detail strip + extractSuggestions.
  var COUNTRY_NAMES = {
    IL: 'Israel', GB: 'United Kingdom', US: 'United States',
    DE: 'Germany', FR: 'France', CA: 'Canada', AU: 'Australia',
    NL: 'Netherlands', ES: 'Spain', IT: 'Italy', PL: 'Poland',
    BR: 'Brazil', MX: 'Mexico', IN: 'India', JP: 'Japan'
  };

  /* ── Exhaustive smart-suggestion extraction ───────────
     Pulls every applicable sublabel chip from a position object.
     Returns an array of SUBLABEL_OPTIONS entries (values the chip
     pool already knows how to render).                             */
  function extractSuggestions(pos) {
    if (!pos) return [];
    var out = [];
    var add = function (v) {
      if (v && SUBLABEL_OPTIONS.indexOf(v) !== -1 && out.indexOf(v) === -1) {
        out.push(v);
      }
    };

    var wt    = (pos.workplaceType   || '').toLowerCase();
    var et    = (pos.employmentType  || '').toLowerCase();
    var title = (pos.rawName || pos.title || '').toLowerCase();
    var dept  = (pos.department      || '').toLowerCase();
    var country = pos.country || '';

    if (/remote/.test(wt))  add('Remote *');
    if (/hybrid/.test(wt))  add('Hybrid *');

    if (country === 'GB') add('UK Based *');
    if (country === 'US') add('US Based *');
    if (country === 'IL') add('Israel Based *');

    if (/part.time/.test(et)) add('Part Time *');

    if (/maternity/.test(title)) add('Maternity Leave Cover *');

    if (/tebex/.test(dept)       || /tebex/.test(title))       add('Tebex');
    if (/outplayed/.test(dept)   || /outplayed/.test(title))   add('Outplayed');
    if (/curseforge/.test(dept)  || /curseforge/.test(title))  add('CurseForge');
    if (/overwolf ads/.test(dept) || /overwolf ads/.test(title) ||
        /\bads\b/.test(dept)) add('Overwolf Ads');

    if (pos.isRemote) add('Remote *');

    return out;
  }

  /* ── DOM refs ───────────────────────────────────────────── */
  var $ = function (id) { return document.getElementById(id); };

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var elSteps      = [null, $('step-1'), $('step-2'), $('step-3'), $('step-4')];
  var elSiItems    = document.querySelectorAll('.si-item');
  var elSiLines    = document.querySelectorAll('.si-line');

  var elBrandGrid  = $('brand-grid');
  var elImageGrid  = $('image-grid');
  var elPresetGrid = $('preset-grid');
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
    state.positionRef     = null;
    state.referralLink    = '';
    state.cta             = null;
    state.subLabel        = [];
    state.smartSuggestions = [];
    CANVAS.resetSeeds();
    syncReferralNudge();
    renderPositionDetail(null);

    setAccent(key);
    syncBrandGrid();
    buildImageGrid();
    clearPreset();
    buildPositionChips();
    clearCTA();
    clearSubLabel();

    renderWizard();
    advance();
    mfSyncContinueButtons();
    mfMaybeAutoAdvance(1);
    // Prewarm first (fetches SVG logo), then render so the logo is ready
    CANVAS.prewarmExportImages(state).then(function () { scheduleRender(); });
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

  // Kick off loading of the per-image base64 data URL shims in the background.
  // These are REQUIRED for export to work on file:// (Chrome blocks fetch + XHR),
  // and also guarantee an untainted canvas on https://.  Each shim populates
  // window._imgData[path] = 'data:image/png;base64,...' which canvas.js reads
  // inside loadImgForExport.
  var _dataScriptsLoaded = {};   // scriptPath → Promise<void>
  function loadDataScript(scriptPath) {
    if (!scriptPath) return Promise.resolve();
    if (_dataScriptsLoaded[scriptPath]) return _dataScriptsLoaded[scriptPath];
    _dataScriptsLoaded[scriptPath] = new Promise(function (resolve) {
      var s = document.createElement('script');
      s.src = scriptPath;
      s.onload  = function () { resolve(); };
      s.onerror = function () {
        console.warn('[app] failed to load data URL shim:', scriptPath);
        resolve();   // proceed anyway — export will fall back to fetch/XHR
      };
      document.head.appendChild(s);
    });
    return _dataScriptsLoaded[scriptPath];
  }

  // Promise that resolves when the currently-selected image's data shims
  // have finished loading.  onExport awaits this before running the render
  // pipeline so toBlob() always succeeds on file://.
  var _imageDataReady = Promise.resolve();

  function onImageSelect(img) {
    state.image  = img;
    state.layout = 'left';
    CANVAS.resetSeeds();
    syncImageGrid();
    renderWizard();
    mfSyncContinueButtons();
    mfMaybeAutoAdvance(2);

    // Start loading data URL shims in parallel (non-blocking for preview)
    _imageDataReady = Promise.all([
      loadDataScript(img.dataScript11),
      loadDataScript(img.dataScript916)
    ]);

    // Prewarm preview, then render
    CANVAS.prewarmExportImages(state).then(function () { scheduleRender(); });
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
    var posGrid = $('pos-grid');
    if (posGrid) posGrid.querySelectorAll('.pos-chip').forEach(function (el) {
      el.classList.remove('selected');
    });
    state.messagePreset   = null;
    state.messagePosition = '';
  }

  function onPresetSelect(text) {
    state.messagePreset = text;
    elPresetGrid.querySelectorAll('.preset-chip').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.value === text);
    });
    renderWizard();
    mfSyncContinueButtons();
    mfMaybeAutoAdvance(3);
    // No advance() — consistent with position-text input; user moves on at their own pace.
    scheduleRender();
  }

  function onModeToggle(mode) {
    state.messageMode = mode;
    state.messagePreset   = null;
    state.messagePosition = '';
    state.positionRef     = null;
    syncReferralNudge();
    renderPositionDetail(null);
    var posGrid = $('pos-grid');
    if (posGrid) posGrid.querySelectorAll('.pos-chip').forEach(function (el) {
      el.classList.remove('selected');
    });

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
    // Step 4 doesn't auto-advance (notes are multi-select / optional).
    // The "Preview" button stays manual. But we still keep continues in sync.
    mfSyncContinueButtons();
    scheduleRender();
  }

  /* ── Sub-label (optional notes below CTA button, multi-select) ─── */
  // The "Other…" free-text entry is tracked separately so toggling preset
  // chips doesn't wipe what the user typed (and vice-versa).
  var _customSubLabel = '';

  function buildSubLabelChips() {
    SUBLABEL_OPTIONS.forEach(function (text) {
      var chip = document.createElement('div');
      chip.className = 'sublabel-chip';
      chip.dataset.value = text;
      chip.textContent = text;
      chip.addEventListener('click', function () { onSubLabelSelect(text); });
      elSubChips.appendChild(chip);
    });
    // "Other" chip — toggles the free-text input
    var other = document.createElement('div');
    other.className = 'sublabel-chip';
    other.dataset.value = '__other__';
    other.textContent = 'Other…';
    other.addEventListener('click', function () { onSubLabelSelect('__other__'); });
    elSubChips.appendChild(other);
  }

  function syncSubLabelUI() {
    if (!elSubChips) return;
    elSubChips.querySelectorAll('.sublabel-chip').forEach(function (el) {
      var v = el.dataset.value;
      if (v === '__other__') {
        el.classList.toggle('selected', !!_customSubLabel);
        return;
      }
      el.classList.toggle('selected', state.subLabel.indexOf(v) !== -1);
    });
    renderSmartBox();
  }

  // Populate the dedicated Smart Suggestions box. Chips render in the
  // "suggested" visual state — accent border / accent text / transparent
  // background — but are NOT pre-selected. Clicking promotes a chip into
  // state.subLabel (and flips it to the selected style). The same chip
  // in the full pool stays in sync via syncSubLabelUI().
  function renderSmartBox() {
    var box  = document.getElementById('sublabel-smart-box');
    var host = document.getElementById('sublabel-smart-chips');
    if (!box || !host) return;
    if (!state.smartSuggestions.length) { box.style.display = 'none'; return; }
    box.style.display = '';
    host.innerHTML = '';
    state.smartSuggestions.forEach(function (text) {
      var chip = document.createElement('div');
      chip.className = 'sublabel-chip suggested';
      if (state.subLabel.indexOf(text) !== -1) chip.classList.add('selected');
      chip.dataset.value = text;
      chip.textContent = text;
      chip.addEventListener('click', function () { onSubLabelSelect(text); });
      host.appendChild(chip);
    });
  }

  function onSubLabelSelect(value) {
    if (value === '__other__') {
      // Toggle the free-text input row. When closing, drop the custom entry.
      if (_customSubLabel) {
        // Deselect: remove the custom string from subLabel and clear input.
        var idx = state.subLabel.indexOf(_customSubLabel);
        if (idx !== -1) state.subLabel.splice(idx, 1);
        _customSubLabel = '';
        if (elSubOtherInput) elSubOtherInput.value = '';
        elSubOtherWrap.style.display = 'none';
      } else {
        elSubOtherWrap.style.display = '';
        if (elSubOtherInput) elSubOtherInput.focus();
      }
      syncSubLabelUI();
      scheduleRender();
      return;
    }

    // Preset chip — toggle in/out of the array
    var i = state.subLabel.indexOf(value);
    if (i === -1) {
      state.subLabel.push(value);
    } else {
      state.subLabel.splice(i, 1);
      // If the user deselects a smart suggestion, drop its "smart" badge too.
      var si = state.smartSuggestions.indexOf(value);
      if (si !== -1) state.smartSuggestions.splice(si, 1);
    }
    syncSubLabelUI();
    scheduleRender();
  }

  function clearSubLabel() {
    state.subLabel = [];
    state.smartSuggestions = [];
    _customSubLabel = '';
    if (elSubOtherWrap) elSubOtherWrap.style.display = 'none';
    if (elSubOtherInput) elSubOtherInput.value = '';
    syncSubLabelUI();
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

  function sanitizeFilename(name) {
    if (!name) return 'recruitment-banners';
    return name
      .trim()
      .replace(/\.[^/.]+$/, '')
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'recruitment-banners';
  }

  /* ═══════════════════════════════════════════════════════
     EXPORT
  ══════════════════════════════════════════════════════════ */
  // Lock/unlock the entire wizard panel while an export is in progress.
  // Without this, users who tweak selections mid-render end up with files
  // that contain half old / half new state — the renderer reads live state
  // for each frame.  pointer-events:none + opacity:.5 via .wizard-locked.
  function setWizardLocked(locked) {
    var panel = document.querySelector('.wizard-panel');
    if (panel) panel.classList.toggle('wizard-locked', !!locked);
    // Also lock the filename input (it lives in the preview panel, outside
    // .wizard-panel) and the step indicator clicks.
    var fn = document.getElementById('filename-input');
    if (fn) fn.disabled = !!locked;
  }

  function _runExport() {
    elBtnExport.style.display    = 'none';
    elProgressWrap.style.display = 'flex';
    setWizardLocked(true);

    EXPORT.generateBlobs(state, function (pct, label) {
      elProgressFill.style.width  = pct + '%';
      elProgressLabel.textContent = label || '';
    })
    .then(function (blobs) {
      _resultBlobs = blobs;
      _resultVideoMime = blobs.videoResult ? (blobs.videoResult.blob.type || '') : '';
      elProgressWrap.style.display = 'none';
      showResults();
    })
    .catch(function (err) {
      console.error('[EXPORT]', err);
      setWizardLocked(false);
      elProgressWrap.style.display = 'flex';
      elProgressLabel.textContent  = '✗ ' + (err && err.message ? err.message : 'Export failed');
      elProgressLabel.style.color  = 'var(--terr)';
      setTimeout(function () {
        elProgressWrap.style.display = 'none';
        elBtnExport.style.display    = '';
        elProgressLabel.style.color  = '';
      }, 4000);
    });
  }

  function onExport() {
    if (!allComplete()) return;
    setWizardLocked(true);
    elProgressWrap.style.display = 'flex';
    elProgressLabel.textContent  = 'Preparing image data…';
    _imageDataReady.then(function () { _runExport(); });
  }

  /* ── Start over ──────────────────────────────────────── */
  function onRestart() {
    state.brand           = null;
    state.image           = null;
    state.layout          = 'left';
    state.messageMode     = 'position';
    state.messagePreset   = null;
    state.messagePosition = '';
    state.positionRef     = null;
    state.referralLink    = '';
    state.cta             = null;
    state.subLabel        = [];
    state.smartSuggestions = [];
    syncReferralNudge();
    renderPositionDetail(null);
    CANVAS.resetSeeds();
    setAccent(null);

    syncBrandGrid();
    buildImageGrid();
    clearPreset();
    buildPositionChips();
    clearCTA();
    clearSubLabel();

    // Reset mode toggle UI — position is default
    document.querySelectorAll('.radio-btn').forEach(function (el) {
      el.classList.toggle('active', el.dataset.mode === 'position');
    });
    if (elPresetMode) elPresetMode.classList.add('hidden');
    if (elPosMode)    elPosMode.classList.add('visible');

    setWizardLocked(false);
    elProgressWrap.style.display = 'none';
    elBtnExport.style.display    = '';
    elProgressLabel.style.color  = '';

    renderWizard();
    openStep(1);
    scheduleRender();
  }

  /* ═══════════════════════════════════════════════════════
     RESULTS SCREEN (§7)
     After Generate Package completes, reveal the results section
     below the wizard + preview panels and scroll to it.  The
     wizard stays visible above so the user can scroll back up.
  ══════════════════════════════════════════════════════════ */
  var elResultsSection = $('results-section');
  var elResultsTitle   = $('results-title');
  var elResultsSubtitle = $('results-subtitle');

  // Map of data-fmt → blob + filename + MIME. Populated when results render.
  // Consumed by share + download + ZIP wiring.
  var _resultMap = {};
  // Cached object URLs for preview <img> elements so we can revoke them on restart.
  var _previewUrls = [];

  function filenameBase() {
    var fn = $('filename-input');
    return sanitizeFilename(fn ? fn.value : 'recruitment-banners');
  }

  function buildResultMap() {
    _resultMap = {};
    if (!_resultBlobs) return;
    var base = filenameBase();
    _resultMap.gif11  = { blob: _resultBlobs.gif11,  mime: 'image/gif',  name: base + '-1x1.gif'  };
    _resultMap.png11  = { blob: _resultBlobs.png11,  mime: 'image/png',  name: base + '-1x1.png'  };
    _resultMap.png916 = { blob: _resultBlobs.png916, mime: 'image/png',  name: base + '-9x16.png' };
    // Video pipeline only produces MP4 now — webm is no longer an accepted
    // output. If videoResult is null the video card renders in an error
    // state (see showResults). Never hand users a .webm file.
    if (_resultBlobs.videoResult && _resultBlobs.videoResult.blob &&
        _resultBlobs.videoResult.ext === 'mp4') {
      _resultMap.video916 = {
        blob: _resultBlobs.videoResult.blob,
        mime: 'video/mp4',   // canonical top-level MIME (navigator.share fussy)
        name: base + '-9x16.mp4',
        ext:  'mp4'
      };
    }
  }

  function setPreviewImage(id, blob) {
    var img = $(id);
    if (!img || !blob) return;
    var url = URL.createObjectURL(blob);
    _previewUrls.push(url);
    img.src = url;
  }

  function revokePreviewUrls() {
    _previewUrls.forEach(function (u) {
      try { URL.revokeObjectURL(u); } catch (_) {}
    });
    _previewUrls = [];
  }

  // ── Device + share capability detection ──────────────
  var IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

  // Mobile devices land downloads in the Photos app (iOS) or Gallery
  // (Android Chrome via download intent), so we surface that explicitly.
  // Desktop downloads land in the Downloads folder — "Save" reads cleaner
  // there than the slightly misleading "Save to Camera Roll".
  function saveLabel(withIcon) {
    var label = IS_MOBILE ? 'Save to Camera Roll' : 'Save';
    return withIcon ? '↓ ' + label : label;
  }
  function savedLabel() {
    return IS_MOBILE ? '✓ Saved to Camera Roll' : '✓ Saved';
  }
  function gifSavedTip() {
    return IS_MOBILE
      ? 'Saved to your gallery — open LinkedIn and post from there'
      : 'Saved — open LinkedIn and attach from your Downloads folder';
  }

  // Probe canShare() WITH the actual file type the caller will share. iOS
  // Safari rejects MP4 file shares based on size; Android Chrome differs
  // for image vs video. The probe must match the actual file's MIME.
  function canShareFiles(mimeOrFmt) {
    try {
      if (!navigator.share || !navigator.canShare) return false;
      var mime = mimeOrFmt || 'image/png';
      // If a fmt key was passed, use the cached blob's mime
      if (_resultMap[mimeOrFmt]) mime = _resultMap[mimeOrFmt].mime;
      var probe = new File([''], 'probe.bin', { type: mime });
      return !!navigator.canShare({ files: [probe] });
    } catch (_) { return false; }
  }

  function positionHeadline() {
    if (state.messageMode === 'position') {
      return state.messagePosition || 'Recruitment Banner';
    }
    return state.messagePreset || 'Recruitment Banner';
  }

  // Share caption appended only when sharing the MP4 — LinkedIn (the GIF
  // path) doesn't accept files via the share sheet at all, so the GIF
  // saves silently to the camera roll without text.
  function shareCaption() {
    if (!state.referralLink) return '';
    return state.referralLink;
  }

  function triggerDownload(blob, filename) {
    EXPORT.downloadBlob(blob, filename);
  }

  // Deep-link to LinkedIn with a graceful web fallback. Mobile apps own
  // the linkedin:// scheme; on desktop the timeout fires and opens web.
  function openLinkedIn() {
    var webUrl = 'https://www.linkedin.com/feed/?shareActive=true';
    if (IS_MOBILE) {
      // Try the app, fall back to web after a short delay
      var t = setTimeout(function () { window.open(webUrl, '_blank'); }, 1200);
      try { window.location.href = 'linkedin://'; }
      catch (_) { clearTimeout(t); window.open(webUrl, '_blank'); }
    } else {
      window.open(webUrl, '_blank');
    }
  }

  // ── GIF: save to gallery (LinkedIn flow) ─────────────
  // CRITICAL: this runs synchronously from the click handler. navigator.share
  // requires the active user-activation token; any await between the user
  // gesture and the share call will invalidate the token on iOS/Safari.
  // Blobs are pre-rendered during Generate Package and cached on _resultMap.
  function saveGifToCameraRoll() {
    var entry = _resultMap.gif11;
    if (!entry || !entry.blob) return;
    var file = new File([entry.blob], entry.name, { type: entry.mime });

    if (canShareFiles('image/gif')) {
      // iOS/Android share sheet gives the user the "Save to Photos" option.
      // No text body — LinkedIn discards files anyway, this is purely a save.
      navigator.share({ files: [file], title: positionHeadline() })
        .then(function () { showGifSaved(); })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          console.warn('[saveGif] share failed, falling back to download:', err);
          triggerDownload(entry.blob, entry.name);
          showGifSaved();
        });
    } else {
      // Desktop / no share sheet — direct download (Downloads on desktop,
      // Gallery via download intent on Android Chrome).
      triggerDownload(entry.blob, entry.name);
      showGifSaved();
    }
  }

  function showGifSaved() {
    var btn   = $('btn-save-gif');
    var saved = $('saved-gif');
    var tip   = $('tip-gif');
    if (btn) {
      btn.classList.add('is-saved');
      btn.textContent = savedLabel();   // "✓ Saved to Camera Roll" or "✓ Saved"
    }
    // Hide the original tip and show the device-aware confirmation panel.
    if (tip) tip.style.display = 'none';
    if (saved) {
      saved.style.display = '';
      var savedText = saved.querySelector('.saved-text');
      if (savedText) savedText.textContent = gifSavedTip();
    }
  }

  // ── MP4: share to Stories (Instagram / TikTok / WhatsApp) ──
  function shareMp4ToStories() {
    var entry = _resultMap.video916;
    if (!entry || !entry.blob) return;
    var file = new File([entry.blob], entry.name, { type: entry.mime });

    if (canShareFiles('video/mp4')) {
      var data = { files: [file], title: positionHeadline() };
      var text = shareCaption();
      if (text) data.text = text;
      navigator.share(data).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        console.warn('[shareMp4] failed, falling back to download:', err);
        triggerDownload(entry.blob, entry.name);
      });
    } else {
      triggerDownload(entry.blob, entry.name);
    }
  }

  // ── Save MP4 to gallery (no share sheet — direct download) ──
  function saveMp4ToGallery() {
    var entry = _resultMap.video916;
    if (!entry || !entry.blob) return;
    triggerDownload(entry.blob, entry.name);
  }

  function downloadByFmt(fmt) {
    var entry = _resultMap[fmt];
    if (!entry || !entry.blob) return;
    triggerDownload(entry.blob, entry.name);
  }

  function showResults() {
    if (!_resultBlobs) return;
    buildResultMap();
    revokePreviewUrls();

    // Header
    if (elResultsTitle)    elResultsTitle.textContent = positionHeadline();
    if (elResultsSubtitle) {
      var brandName = state.brand ? BRANDS[state.brand].name : '';
      var visualLabel = state.image ? state.image.label : '';
      var bits = [];
      if (brandName)  bits.push(brandName);
      if (visualLabel) bits.push(visualLabel + ' visual');
      elResultsSubtitle.textContent = bits.join(' · ');
    }

    // Previews — animated primary uses the motion blob (GIF/MP4 inline in <img>);
    // video inside <img> isn't valid, so for story primary we use the static PNG
    // frame-20 still as the thumbnail (the motion badge communicates "MP4").
    setPreviewImage('sq-gif-img', _resultBlobs.gif11);
    setPreviewImage('sq-png-img', _resultBlobs.png11);
    setPreviewImage('st-vid-img', _resultBlobs.png916);   // static still as thumb
    setPreviewImage('st-png-img', _resultBlobs.png916);

    // Video card: MP4 is the only acceptable output. If the pipeline
    // couldn't produce one (ffmpeg.wasm failed / not available and no
    // native MP4 MediaRecorder), flip the card into an error state
    // telling the user to retry or use the PNG. We NEVER hand out webm.
    var videoCard = elResultsSection.querySelector('[data-fmt="video916"]');
    if (videoCard) {
      videoCard.style.display = '';
      var hasMp4 = !!_resultMap.video916;
      videoCard.classList.toggle('results-card-error', !hasMp4);

      var badge   = videoCard.querySelector('.results-motion-badge');
      var fname   = videoCard.querySelector('.results-format-name');
      var fdesc   = videoCard.querySelector('.results-format-desc');
      var actions = videoCard.querySelector('.results-actions');
      var badges  = videoCard.querySelector('.results-badges');

      if (hasMp4) {
        if (badge)  { badge.style.display = ''; badge.lastChild.textContent = 'MP4'; }
        if (fname)  fname.textContent = '9:16 Animated MP4';
        if (fdesc)  fdesc.textContent = 'Best for Instagram, TikTok, WhatsApp statuses';
        if (actions) actions.style.display = '';
        if (badges)  badges.style.display  = '';
      } else {
        if (badge)  badge.style.display = 'none';
        if (fname)  fname.textContent = '9:16 Video export failed';
        if (fdesc)  fdesc.textContent = 'Try generating again — or use the static PNG below.';
        if (actions) actions.style.display = 'none';
        if (badges)  badges.style.display  = 'none';
      }
    }

    // ── GIF card: reset to pristine state on every fresh results render ──
    var gifBtn   = $('btn-save-gif');
    var gifSaved = $('saved-gif');
    var gifTip   = $('tip-gif');
    if (gifBtn) {
      gifBtn.classList.remove('is-saved');
      gifBtn.textContent = saveLabel(true);   // "↓ Save to Camera Roll" or "↓ Save"
    }
    if (gifSaved) gifSaved.style.display = 'none';
    if (gifTip) {
      gifTip.style.display = '';
      gifTip.textContent   = 'Save to your gallery, then post on LinkedIn';
    }

    // ── MP4 card: device-specific primary action ──
    var mp4Btn = $('btn-share-mp4');
    var mp4Tip = $('tip-mp4');
    if (mp4Btn && mp4Tip) {
      if (IS_MOBILE && canShareFiles('video/mp4')) {
        mp4Btn.textContent = '↗ Share to Stories';
        mp4Tip.textContent = 'Opens your share sheet — pick Instagram, TikTok, or WhatsApp';
      } else {
        mp4Btn.textContent = '↓ Download MP4';
        mp4Tip.textContent = 'On mobile you can share directly to Instagram, TikTok, and WhatsApp';
      }
    }
    // MP4 card secondary "Save" + PNG cards' Save labels
    var saveMp4Btn = $('btn-save-mp4-gallery');
    if (saveMp4Btn) saveMp4Btn.textContent = saveLabel(false);
    var savePng11Btn  = $('btn-save-png11');
    if (savePng11Btn)  savePng11Btn.textContent  = '↓ ' + saveLabel(false);
    var savePng916Btn = $('btn-save-png916');
    if (savePng916Btn) savePng916Btn.textContent = '↓ ' + saveLabel(false);

    syncReferralPanel();
    syncCaptionHelper();

    elResultsSection.style.display = 'block';
    setTimeout(function () {
      elResultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 40);
  }

  function hideResults() {
    revokePreviewUrls();
    if (elResultsSection) elResultsSection.style.display = 'none';
    _resultBlobs = null;
    _resultMap   = {};
  }

  function onResultsZip() {
    if (!_resultBlobs) return;
    EXPORT.makeZip(
      _resultBlobs.png11,
      _resultBlobs.gif11,
      _resultBlobs.png916,
      _resultBlobs.videoResult
    ).then(function (zipBlob) {
      EXPORT.downloadBlob(zipBlob, filenameBase() + '.zip');
    }).catch(function (err) {
      console.error('[ZIP]', err);
    });
  }

  function onResultsRestart() {
    hideResults();
    onRestart();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function wireResultsActions() {
    if (!elResultsSection) return;

    // GIF card
    var bSaveGif = $('btn-save-gif');
    if (bSaveGif) bSaveGif.addEventListener('click', saveGifToCameraRoll);
    var bOpenLi = $('btn-open-linkedin');
    if (bOpenLi) bOpenLi.addEventListener('click', openLinkedIn);
    var bSavedOpenLi = $('btn-saved-open-linkedin');
    if (bSavedOpenLi) bSavedOpenLi.addEventListener('click', openLinkedIn);
    var bDlGif = $('btn-dl-gif');
    if (bDlGif) bDlGif.addEventListener('click', function () { downloadByFmt('gif11'); });

    // MP4 card
    var bShareMp4 = $('btn-share-mp4');
    if (bShareMp4) bShareMp4.addEventListener('click', shareMp4ToStories);
    var bSaveMp4 = $('btn-save-mp4-gallery');
    if (bSaveMp4) bSaveMp4.addEventListener('click', saveMp4ToGallery);
    var bDlMp4 = $('btn-dl-mp4');
    if (bDlMp4) bDlMp4.addEventListener('click', function () { downloadByFmt('video916'); });

    // PNG disclosure cards
    var bSavePng11 = $('btn-save-png11');
    if (bSavePng11) bSavePng11.addEventListener('click', function () { downloadByFmt('png11'); });
    var bDlPng11 = $('btn-dl-png11');
    if (bDlPng11) bDlPng11.addEventListener('click', function () { downloadByFmt('png11'); });
    var bSavePng916 = $('btn-save-png916');
    if (bSavePng916) bSavePng916.addEventListener('click', function () { downloadByFmt('png916'); });
    var bDlPng916 = $('btn-dl-png916');
    if (bDlPng916) bDlPng916.addEventListener('click', function () { downloadByFmt('png916'); });

    // ZIP + restart
    var zipBtn = $('btn-results-zip');
    if (zipBtn) zipBtn.addEventListener('click', onResultsZip);
    var restartBtn = $('btn-results-restart');
    if (restartBtn) restartBtn.addEventListener('click', onResultsRestart);
  }

  /* ═══════════════════════════════════════════════════════
     REFERRAL LINK (§9)
     Nudge in step 3 (position mode only, after selection).
     Input on results screen — validates against the Comeet
     careers.overwolf.com prefix and updates share caption.
  ══════════════════════════════════════════════════════════ */
  var CAREERS_PREFIX = 'https://careers.overwolf.com/career/';

  function syncReferralNudge() {
    var nudge = $('referral-nudge');
    if (!nudge) return;
    var show = state.messageMode === 'position' && state.positionRef && state.positionRef.urlActivePage;
    nudge.style.display = show ? '' : 'none';
    if (!show) return;
    var link = $('referral-nudge-link');
    if (link) link.href = state.positionRef.urlActivePage;
    var title = $('referral-nudge-title');
    if (title) {
      var reward = state.positionRef.referralReward;
      title.textContent = reward
        ? '✦ Refer someone and earn ' + reward
        : '✦ Refer someone';
    }
  }

  function syncReferralPanel() {
    var panel = $('results-referral');
    if (!panel) return;
    var show = state.messageMode === 'position' && state.positionRef;
    panel.style.display = show ? '' : 'none';
    if (!show) return;
    var link = $('results-referral-link');
    if (link) link.href = state.positionRef.urlActivePage || '#';
    var input = $('results-referral-input');
    if (input) input.value = state.referralLink || '';
    var ok = $('results-referral-ok');
    if (ok) ok.style.display = state.referralLink ? '' : 'none';
  }

  function syncCaptionHelper() {
    var cap = $('results-referral-caption');
    if (!cap) return;
    // Only surface the copyable caption helper on desktop fallback (no
    // native share sheet). On mobile the share sheet delivers the caption.
    var show = !canShareFiles('video/mp4') && !!state.referralLink;
    cap.style.display = show ? '' : 'none';
    if (!show) return;
    var ta = $('results-referral-caption-text');
    if (ta) ta.value = shareCaption();
  }

  function wireReferral() {
    var input = $('results-referral-input');
    if (input) {
      input.addEventListener('input', function () {
        var v = input.value.trim();
        if (v && v.indexOf(CAREERS_PREFIX) === 0) {
          state.referralLink = v;
        } else {
          state.referralLink = '';
        }
        var ok = $('results-referral-ok');
        if (ok) ok.style.display = state.referralLink ? '' : 'none';
        syncCaptionHelper();
      });
    }
    var copyBtn = $('results-referral-caption-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var ta = $('results-referral-caption-text');
        if (!ta) return;
        ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        if (navigator.clipboard) navigator.clipboard.writeText(ta.value).catch(function(){});
        var orig = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied';
        setTimeout(function () { copyBtn.textContent = orig; }, 1600);
      });
    }
  }

  /* ═══════════════════════════════════════════════════════
     MOBILE-RECOMMENDATION BANNER (Round 6)
     Lives at the top of the results section. CSS already hides it
     on mobile via @media; we additionally honour a session-scoped
     dismiss so it doesn't keep nagging after the user closed it.
  ══════════════════════════════════════════════════════════ */
  function wireMobileBanner() {
    var banner = $('mobile-banner');
    if (!banner) return;
    var dismissed = false;
    try { dismissed = sessionStorage.getItem('mobile-banner-dismissed') === '1'; } catch (_) {}
    if (dismissed || IS_MOBILE) { banner.style.display = 'none'; return; }

    var copyBtn = $('btn-copy-tool-link');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var url = window.location.href;
        var done = function () {
          copyBtn.classList.add('copied');
          copyBtn.textContent = 'Copied!';
          setTimeout(function () {
            copyBtn.classList.remove('copied');
            copyBtn.textContent = 'Copy link';
          }, 1600);
        };
        if (navigator.clipboard) {
          navigator.clipboard.writeText(url).then(done).catch(function () {
            _legacyCopy(url); done();
          });
        } else {
          _legacyCopy(url); done();
        }
      });
    }
    var dismissBtn = $('btn-dismiss-banner');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        banner.style.display = 'none';
        try { sessionStorage.setItem('mobile-banner-dismissed', '1'); } catch (_) {}
      });
    }
  }

  function _legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    document.body.removeChild(ta);
  }

  /* ═══════════════════════════════════════════════════════
     JOBS — fetch open positions from Netlify function
  ══════════════════════════════════════════════════════════ */
  var _jobsCache = null; // null = not yet fetched, [] = fetched (empty or populated)

  function fetchJobs() {
    if (_jobsCache !== null) return; // already fetched this session

    fetch('/.netlify/functions/jobs')
      .then(function (res) { return res.ok ? res.json() : { positions: [] }; })
      .then(function (data) {
        _jobsCache = (data.positions || []);
        buildPositionChips();
      })
      .catch(function () {
        _jobsCache = [];
        buildPositionChips();
      });
  }

  function buildPositionChips() {
    var grid = $('pos-grid');
    if (!grid) return;
    grid.innerHTML = '';

    var all = _jobsCache || [];

    // Filter by brand when positions exist for that brand.
    // Overwolf is the umbrella brand — always show every open role across
    // the whole group so recruiters can tag any position under it.
    var positions = all;
    if (state.brand && state.brand !== 'overwolf') {
      var branded = all.filter(function (p) { return p.brand === state.brand; });
      if (branded.length) positions = branded;
    }

    if (!positions.length) {
      var msg = document.createElement('p');
      msg.className = 'pos-hint';
      msg.textContent = (_jobsCache === null)
        ? 'Loading open positions…'
        : 'No open positions right now.';
      grid.appendChild(msg);
      return;
    }

    positions.forEach(function (p) {
      var chip = document.createElement('div');
      chip.className = 'pos-chip';
      chip.dataset.title = p.title;
      chip.innerHTML =
        '<span class="pos-chip-title">' + escapeHtml(p.title) + '</span>' +
        (p.location ? '<span class="pos-chip-meta">' + escapeHtml(p.location) + '</span>' : '');
      chip.addEventListener('click', function () { onPositionSelect(p); });
      grid.appendChild(chip);
    });
  }

  function onPositionSelect(pos) {
    state.messagePosition = pos.title;
    state.positionRef     = pos;
    syncReferralNudge();
    renderPositionDetail(pos);

    var grid = $('pos-grid');
    if (grid) grid.querySelectorAll('.pos-chip').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.title === pos.title);
    });

    // Surface the extracted suggestions, but DO NOT auto-apply them to
    // state.subLabel. Comeet's workplace_type / is_remote fields are
    // sometimes out of date — pre-selecting them would cause employees to
    // unknowingly post inaccurate tags. Chips render in a distinct
    // "highlighted but unselected" state and require an explicit tap.
    //
    // Any chips the user manually selected from a prior position stay put.
    // If the old smart set included auto-applied chips (from the previous
    // behaviour), clear them now so the state is consistent.
    state.smartSuggestions.forEach(function (v) {
      var i = state.subLabel.indexOf(v);
      if (i !== -1) state.subLabel.splice(i, 1);
    });
    state.smartSuggestions = extractSuggestions(pos);
    syncSubLabelUI();

    renderWizard();
    advance();
    mfSyncContinueButtons();
    mfMaybeAutoAdvance(3);
    scheduleRender();
  }

  // Renders the compact detail strip of structured fields below the grid
  // (location, department, employment type, experience level, workplace).
  function renderPositionDetail(pos) {
    var el = $('pos-detail');
    if (!el) return;
    if (!pos) { el.style.display = 'none'; el.innerHTML = ''; return; }

    var items = [];
    var locBits = [];
    if (pos.city) locBits.push(pos.city);
    var country = pos.country && COUNTRY_NAMES[pos.country] ? COUNTRY_NAMES[pos.country] : pos.country;
    if (country) locBits.push(country);
    if (locBits.length) items.push({ icon: '📍', value: locBits.join(', ') });

    if (pos.isRemote)        items.push({ icon: '🌍', value: 'Open to remote' });
    if (pos.department)      items.push({ icon: '🏢', value: pos.department });
    if (pos.employmentType)  items.push({ icon: '⏳', value: pos.employmentType });
    if (pos.experienceLevel) items.push({ icon: '👤', value: pos.experienceLevel });
    if (pos.workplaceType)   items.push({ icon: '🌐', value: pos.workplaceType });

    if (!items.length) { el.style.display = 'none'; el.innerHTML = ''; return; }

    el.innerHTML = items.map(function (it) {
      return '<span class="pos-detail-item">' +
             '<span class="pos-detail-icon">' + it.icon + '</span>' +
             '<span class="pos-detail-value">' + escapeHtml(it.value) + '</span>' +
             '</span>';
    }).join('');
    el.style.display = '';
  }

  /* ═══════════════════════════════════════════════════════
     MOBILE FLOW (Round 7)
     Reuses the existing wizard grids by physically moving them
     into per-step slots. All event handlers and state-setting
     logic continue to work as-is since we only relocate nodes.
  ══════════════════════════════════════════════════════════ */
  // Decided once at load — desktop users never see the mobile flow even
  // if they resize. Avoids brittle DOM swap on viewport changes.
  var MF_VIEWPORT = window.matchMedia('(max-width: 768px)').matches;
  var MF_STEPS    = 5;
  var mfStep      = 1;

  // Back is hidden on Step 1 (nothing to go back to) — visible on every
  // other step so users can tweak previous selections before/after generating.
  function mfCurrentBackBlocked() { return mfStep === 1; }

  function mfGo(n) {
    if (n < 1 || n > MF_STEPS) return;
    var cur = $('mf-s' + mfStep);
    var nxt = $('mf-s' + n);
    if (!cur || !nxt) return;
    if (n === mfStep) return;

    if (n > mfStep) {
      cur.classList.remove('active');
      cur.classList.add('prev');
      nxt.classList.remove('prev');
      nxt.classList.add('active');
    } else {
      cur.classList.remove('active');
      cur.classList.remove('prev');
      // The new "current" must already be at translateX(-100%) so it can
      // slide back in from the left — give it the active class straight away.
      nxt.classList.remove('prev');
      nxt.classList.add('active');
    }
    mfStep = n;
    mfUpdateTopbar();
  }

  function mfBack() {
    if (mfStep > 1 && mfStep <= MF_STEPS) mfGo(mfStep - 1);
  }
  function mfNext() {
    if (mfStep < MF_STEPS) mfGo(mfStep + 1);
  }

  function mfUpdateTopbar() {
    var label = $('mf-step-label');
    var fill  = $('mf-progress-fill');
    var back  = $('mf-back-btn');

    if (label) {
      label.textContent = mfStep < MF_STEPS
        ? 'Step ' + mfStep + ' of ' + (MF_STEPS - 1)
        : '✦ Your package';
    }
    if (fill) {
      fill.style.width = (mfStep / MF_STEPS * 100) + '%';
      var accent = (BRANDS[state.brand] || {}).accent || '#D34037';
      fill.style.background = accent;
    }
    if (back) back.disabled = mfCurrentBackBlocked();
  }

  // Enable/disable Step N's Continue button based on shared isComplete().
  function mfSyncContinueButtons() {
    if (!MF_VIEWPORT) return;
    [1,2,3].forEach(function (n) {
      var btn = $('mf-btn' + n);
      if (btn) btn.disabled = !isComplete(n);
    });
    // Step 4 ("Preview") is always enabled — it just slides forward;
    // the user selected a CTA when they tapped a chip, but if not we'll
    // show the Generate state and they can still go back.
  }

  // Auto-advance after a 250ms beat so users see the chip light up before
  // sliding to the next screen. Steps 1–3 only; Step 4 stays manual.
  var _mfAutoAdvanceTimer = null;
  function mfMaybeAutoAdvance(forStep) {
    if (!MF_VIEWPORT) return;
    if (mfStep !== forStep) return;
    if (forStep >= 4) return;
    if (!isComplete(forStep)) return;
    clearTimeout(_mfAutoAdvanceTimer);
    _mfAutoAdvanceTimer = setTimeout(function () {
      if (mfStep === forStep) mfNext();
    }, 250);
  }

  function mfRestart() {
    onRestart();         // clears state + resets desktop wizard
    mfGo(1);
    var body = $('mf-results-body');
    if (body) body.innerHTML =
      '<button class="ms-next" id="mf-generate-btn">✦ Generate Package</button>' +
      '<p class="mf-gen-note">Takes ~15 seconds. Share directly from here.</p>';
    var foot = $('mf-step5-foot');
    if (foot) foot.style.display = 'none';
    mfWireGenerateBtn();
    mfSyncContinueButtons();
  }

  // Move the existing wizard grids into mobile slots.  This preserves
  // every event listener already attached — no rebinding, no duplicate
  // chips, just relocation.  Runs once at init() when in mobile viewport.
  function mfRelocateNodes() {
    if (!MF_VIEWPORT) return;
    document.body.classList.add('mf-active');
    document.getElementById('mobile-flow').setAttribute('aria-hidden', 'false');

    // Step 1 — brand grid
    var brand = $('brand-grid');
    var slot1 = $('mf-slot-brand');
    if (brand && slot1) slot1.appendChild(brand);

    // Step 2 — image grid
    var img = $('image-grid');
    var slot2 = $('mf-slot-image');
    if (img && slot2) slot2.appendChild(img);

    // Step 3 — message: mode toggle + position chips + preset chips
    var slot3 = $('mf-slot-message');
    if (slot3) {
      var modeRow = document.querySelector('.msg-mode-row');
      if (modeRow) slot3.appendChild(modeRow);
      var posMode = $('pos-mode');
      if (posMode) slot3.appendChild(posMode);
      var presetMode = $('preset-mode');
      if (presetMode) slot3.appendChild(presetMode);
    }

    // Step 4 — action: CTA grid + sublabel section
    var slot4 = $('mf-slot-action');
    if (slot4) {
      var cta = $('cta-grid');
      if (cta) slot4.appendChild(cta);
      var sub = document.querySelector('.sublabel-section');
      if (sub) slot4.appendChild(sub);
    }

    // Step 5 preview strip — move the live canvases here so CANVAS.render
    // keeps drawing them and the user sees the preview as they progress.
    // Each canvas is wrapped in a .canvas-wrap whose first child is the
    // canvas itself; we move the wraps so the canvas labels travel along
    // even though we hide them via CSS in the strip.
    var strip = $('mf-preview-strip');
    if (strip) {
      var c11  = $('canvas-11');
      var c916 = $('canvas-916');
      var w11  = c11  && c11.parentElement;
      var w916 = c916 && c916.parentElement;
      if (w11)  strip.appendChild(w11);
      if (w916) strip.appendChild(w916);
    }
  }

  function mfWireGenerateBtn() {
    var btn = $('mf-generate-btn');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (!allComplete()) return;
      btn.disabled = true;
      btn.textContent = 'Generating…';
      // Keep the existing pipeline — onExport handles state, progress,
      // and showResults() at the end. We watch for the results section
      // becoming visible to slot it into the mobile body.
      _mfWaitForResults();
      onExport();
    });
  }

  function _mfWaitForResults() {
    var src = elResultsSection;
    if (!src) return;
    // MutationObserver fires when showResults() flips display to 'block'.
    var obs = new MutationObserver(function () {
      if (getComputedStyle(src).display !== 'none') {
        obs.disconnect();
        mfMountResults();
      }
    });
    obs.observe(src, { attributes: true, attributeFilter: ['style', 'class'] });
    // Also poll briefly in case the observer misses (e.g. style was already block)
    setTimeout(function () {
      if (getComputedStyle(src).display !== 'none') { obs.disconnect(); mfMountResults(); }
    }, 100);
  }

  function mfMountResults() {
    var body = $('mf-results-body');
    var src  = elResultsSection;
    if (!body || !src) return;
    body.innerHTML = '';
    body.appendChild(src);
    src.style.display = 'block';
    var foot = $('mf-step5-foot');
    if (foot) foot.style.display = 'block';
    var subtitle = $('mf-result-sub');
    if (subtitle) subtitle.textContent = 'Tap to share or save';
  }

  function mfWireUI() {
    var back = $('mf-back-btn');
    if (back) back.addEventListener('click', mfBack);
    [1,2,3,4].forEach(function (n) {
      var b = $('mf-btn' + n);
      if (b) b.addEventListener('click', mfNext);
    });
    var restart = $('mf-restart-btn');
    if (restart) restart.addEventListener('click', mfRestart);
    mfWireGenerateBtn();
  }

  function initMobileFlow() {
    if (!MF_VIEWPORT) return;
    mfRelocateNodes();
    mfWireUI();
    mfUpdateTopbar();
    mfSyncContinueButtons();
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
    fetchJobs();

    // Mode toggle buttons
    document.querySelectorAll('.radio-btn').forEach(function (el) {
      el.addEventListener('click', function () { onModeToggle(el.dataset.mode); });
    });

    // Sub-label other input — keeps the custom free-text in sync with the
    // subLabel array (replaces the previous custom entry if present).
    if (elSubOtherInput) {
      elSubOtherInput.addEventListener('input', function () {
        if (_customSubLabel) {
          var idx = state.subLabel.indexOf(_customSubLabel);
          if (idx !== -1) state.subLabel.splice(idx, 1);
        }
        _customSubLabel = elSubOtherInput.value.trim();
        if (_customSubLabel) state.subLabel.push(_customSubLabel);
        scheduleRender();
      });
    }

    // Export button
    if (elBtnExport) {
      elBtnExport.addEventListener('click', onExport);
    }

    wireStepHeaders();
    wireIndicator();
    wireResultsActions();
    wireReferral();
    wireMobileBanner();

    renderWizard();
    openStep(1);
    scheduleRender();

    // Mobile-only: relocate the wizard grids into per-step slots and
    // bind the step controller. Runs after the desktop wizard is built
    // so all event listeners are already attached to the moved nodes.
    initMobileFlow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
