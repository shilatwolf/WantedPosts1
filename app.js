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
    if (_resultBlobs.videoResult && _resultBlobs.videoResult.blob) {
      var ext = _resultBlobs.videoResult.ext || 'mp4';
      // navigator.share is picky — use canonical top-level MIME ('video/mp4'
      // or 'video/webm'), never the codec-qualified variant ('video/mp4;codecs=avc1').
      var mime = (ext === 'webm') ? 'video/webm' : 'video/mp4';
      _resultMap.video916 = {
        blob: _resultBlobs.videoResult.blob,
        mime: mime,
        name: base + '-9x16.' + ext,
        ext:  ext
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

  // Returns true if the browser natively supports sharing files (mobile Chrome,
  // Safari iOS 15+). On desktop, navigator.share may exist but canShare({files})
  // returns false — in that case we fall back to plain download.
  //
  // Lightweight probe is used ONLY for UI toggling (share label vs download label).
  // The actual navigator.share call in shareFile() re-checks canShare with the
  // real File object, which is the only reliable pre-flight check.
  function canNativeShareFiles() {
    try {
      if (!navigator.share || !navigator.canShare) return false;
      var probe = new File([''], 'probe.png', { type: 'image/png' });
      return !!navigator.canShare({ files: [probe] });
    } catch (_) { return false; }
  }

  function positionHeadline() {
    if (state.messageMode === 'position') {
      return state.messagePosition || 'Recruitment Banner';
    }
    return state.messagePreset || 'Recruitment Banner';
  }

  function shareCaption() {
    var head = positionHeadline();
    var lines = ['We\'re hiring ' + head + '! Know someone great?'];
    if (state.referralLink) lines.push(state.referralLink);
    return lines.join('\n');
  }

  // CRITICAL: this function must be reachable synchronously from the click
  // handler. navigator.share() requires the active user-activation token —
  // any async awaits between the user gesture and the share call will
  // invalidate the token on iOS/Safari. Blobs are pre-rendered during the
  // Generate Package phase and cached on _resultMap so this is sync.
  function shareFile(fmt) {
    var entry = _resultMap[fmt];
    if (!entry || !entry.blob) return;
    var file = new File([entry.blob], entry.name, { type: entry.mime });

    // Check canShare with the actual File object — the generic probe lies
    // on some browsers (notably Android Chrome) that reject video files
    // based on size/duration but accept empty probes.
    var shareOk = navigator.share
      && navigator.canShare
      && navigator.canShare({ files: [file] });

    if (shareOk) {
      var text = shareCaption();
      navigator.share({
        files: [file],
        title: positionHeadline(),
        text:  text
      }).catch(function (err) {
        if (err && err.name === 'AbortError') return;   // user cancelled
        console.warn('[share] navigator.share failed:', err);
        EXPORT.downloadBlob(entry.blob, entry.name);
      });
    } else {
      EXPORT.downloadBlob(entry.blob, entry.name);
    }
  }

  function downloadFile(fmt) {
    var entry = _resultMap[fmt];
    if (!entry) return;
    EXPORT.downloadBlob(entry.blob, entry.name);
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

    // Hide the video card entirely if no video blob, otherwise relabel it
    // to reflect the actual output format (MP4 when ffmpeg.wasm transcoded,
    // WebM if it fell back). WebM still plays in Chrome/Firefox/Edge but
    // not iOS/Safari/QuickTime — surface that inline so users aren't surprised.
    var videoCard = elResultsSection.querySelector('[data-fmt="video916"]');
    if (videoCard) {
      videoCard.style.display = _resultMap.video916 ? '' : 'none';
      if (_resultMap.video916) {
        var isWebm = _resultMap.video916.ext === 'webm';
        var badge  = videoCard.querySelector('.results-motion-badge');
        var fname  = videoCard.querySelector('.results-format-name');
        var fdesc  = videoCard.querySelector('.results-format-desc');
        if (badge) badge.lastChild.textContent = isWebm ? 'WEBM' : 'MP4';
        if (fname) fname.textContent = isWebm ? '9:16 Animated WebM' : '9:16 Animated MP4';
        if (fdesc) fdesc.textContent = isWebm
          ? 'Saved as .webm — open in Chrome, Firefox or Edge to view.'
          : 'Best for Instagram, TikTok, WhatsApp statuses';
      }
    }

    // Toggle share button labels + caption helper based on native-share support
    var hasShare = canNativeShareFiles();
    elResultsSection.querySelectorAll('.results-share-btn').forEach(function (btn) {
      btn.textContent = hasShare ? '↗ Share' : '↓ Download';
      btn.title = hasShare ? '' : 'On mobile, this opens the share sheet directly.';
    });

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
    elResultsSection.querySelectorAll('.results-share-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { shareFile(btn.dataset.fmt); });
    });
    elResultsSection.querySelectorAll('.results-dl-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { downloadFile(btn.dataset.fmt); });
    });
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
    var show = !canNativeShareFiles() && !!state.referralLink;
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
     DESKTOP MOBILE-RECOMMENDATION BANNER (§7)
  ══════════════════════════════════════════════════════════ */
  function wireDesktopBanner() {
    var banner = $('desktop-banner');
    if (!banner) return;
    var dismissed = false;
    try { dismissed = sessionStorage.getItem('desktopBannerDismissed') === '1'; } catch (_) {}
    if (dismissed) { banner.style.display = 'none'; return; }

    var copyBtn = $('desktop-banner-copy');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var url = window.location.href;
        var done = function () {
          var orig = copyBtn.textContent;
          copyBtn.classList.add('copied');
          copyBtn.textContent = 'Copied!';
          setTimeout(function () {
            copyBtn.classList.remove('copied');
            copyBtn.textContent = orig;
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
    var dismissBtn = $('desktop-banner-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('click', function () {
        banner.style.display = 'none';
        try { sessionStorage.setItem('desktopBannerDismissed', '1'); } catch (_) {}
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
    wireDesktopBanner();

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
