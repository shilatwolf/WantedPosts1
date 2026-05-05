'use strict';

/* ============================================================
   APP MODULE — Wizard flow, state, UI wiring
   ============================================================ */

(function () {

  /* ── Defaults (Round 11) ───────────────────────────────────
     Round 11 promotes the placeholder defaults from render-time
     fallbacks into real state values. brand / messagePreset /
     cta all have meaningful defaults so Save works the moment
     the manifest finishes loading (state.image is set then).
     The wizard still starts on Step 1 — defaults don't advance.   */
  var DEFAULT_BRAND       = 'overwolf';
  var PLACEHOLDER_PRESET  = 'Wolves Wanted';
  var PLACEHOLDER_CTA     = 'Apply Now';

  /* ── State ──────────────────────────────────────────────── */
  var state = {
    brand:           DEFAULT_BRAND,        // 'overwolf' | 'tebex' | 'outplayed' | 'overwolfads' | 'curseforge' — pre-selected on load; user can change
    image:           null,                 // set after manifest loads (init())
    layout:          'left',               // always left — layout step removed
    messageMode:     'preset',
    messagePreset:   PLACEHOLDER_PRESET,
    messagePosition: '',
    positionRef:     null,
    referralLink:    '',
    cta:             PLACEHOLDER_CTA,
    subLabel:        [],
    smartSuggestions:[],
    images:          {}
  };

  /* ── User-completion tracking (Round 11) ──────────────────
     Distinct from state. Defaults populate state so the
     preview renders immediately, but the wizard step buttons
     only enable once the user has *explicitly* tapped a chip
     for that step — so Step 1 is never bypassed.               */
  var userCompleted = {
    brand:   false,
    image:   false,
    message: false,
    cta:     false
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

  // Comeet `department` → BRANDS key. Anything not listed maps to 'overwolf'
  // (mother brand). Comeet positions have no `brand` field — the department
  // label is the only signal we get.
  var DEPT_TO_BRAND = {
    'Overwolf Ads': 'overwolfads',
    'CurseForge':   'curseforge',
    'Tebex':        'tebex'
  };

  function getBrandForPosition(pos) {
    var dept = (pos && pos.department) || '';
    return DEPT_TO_BRAND[dept] || 'overwolf';
  }

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

    var brandKey = getBrandForPosition(pos);
    if (brandKey === 'tebex')       add('Tebex');
    if (brandKey === 'curseforge')  add('CurseForge');
    if (brandKey === 'overwolfads') add('Overwolf Ads');
    if (/outplayed/.test(dept) || /outplayed/.test(title)) add('Outplayed');

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
  var elCtaGrid    = $('cta-grid');
  var elSubChips   = $('sublabel-chips');
  var elSubOtherWrap  = $('sublabel-other-wrap');
  var elSubOtherInput = $('sublabel-other-input');

  var elBtnExport  = $('btn-export');
  /* ── Accent CSS variables ─────────────────────────────── */
  function setAccent(brand) {
    var b = brand ? BRANDS[brand] : { accent: '#D34037', accentHover: '#F05C48', ctaTextColor: '#FFFFFF' };
    document.documentElement.style.setProperty('--accent',       b.accent);
    document.documentElement.style.setProperty('--accent-hover', b.accentHover);
    // Round 13: text drawn on top of --accent must respect the
    // brand's ctaTextColor (e.g. Tebex cyan needs black text).
    document.documentElement.style.setProperty('--accent-fg', b.ctaTextColor || '#FFFFFF');
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

  /* ── Export availability (Round 11) ───────────────────────
     Export only requires state.cta — every other field has a
     default in state from the moment the manifest finishes
     parsing. Save buttons are always enabled.                   */
  function canExport() {
    return !!state.cta;
  }

  /* ── Continue-button gating (Round 11) ────────────────────
     Per-step Continue buttons unlock only after the user has
     made an EXPLICIT selection for that step. Defaults in
     state do NOT unlock the button — the user must tap the
     pre-selected chip (or pick a different one) at least once.
     Step 4 is exempt: CTA has a default, button always on.      */
  function isStepUnlocked(step) {
    if (step === 1) return userCompleted.brand;
    if (step === 2) return userCompleted.image;
    if (step === 3) return userCompleted.message;
    if (step === 4) return true;
    return true;
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
    elBtnExport.disabled = !canExport();
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

  /* ── Advance to next not-yet-user-confirmed step ──────────
     Round 11: defaults satisfy isComplete() for every step on
     load, so we drive advance() off userCompleted instead — the
     wizard surfaces whichever step the user still has to act on. */
  function advance() {
    var keys = ['brand', 'image', 'message', 'cta'];
    for (var n = 1; n <= 4; n++) {
      if (!userCompleted[keys[n - 1]]) {
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

  /* ── Placeholder render-state (Round 10) ────────────────
     Build a derived state where any field the user hasn't yet
     chosen falls back to a placeholder (default image, preset,
     or CTA). The real `state` is left untouched so isComplete()
     and the wizard UI continue to reflect actual selections.   */
  function getDefaultImage(brandKey) {
    var b = brandKey || state.brand;
    if (!b || !BRANDS[b]) return null;
    var poolKey = BRANDS[b].imagePool;
    var src  = (state.images && state.images[poolKey] && state.images[poolKey].length)
               ? state.images
               : (typeof IMAGES_DATA !== 'undefined' ? IMAGES_DATA : {});
    var pool = src[poolKey] || [];
    return pool[0] || null;
  }

  function getRenderState() {
    var headlineMissing = state.messageMode === 'preset'
      ? !state.messagePreset
      : !(state.messagePosition && state.messagePosition.trim());
    if (state.image && !headlineMissing && state.cta) return state;

    var rs = Object.assign({}, state);
    if (!rs.image) {
      var def = getDefaultImage(rs.brand);
      if (def) rs.image = def;
    }
    if (headlineMissing) {
      rs.messageMode   = 'preset';
      rs.messagePreset = PLACEHOLDER_PRESET;
    }
    if (!rs.cta) rs.cta = PLACEHOLDER_CTA;
    return rs;
  }

  /* ── Trigger preview re-render ────────────────────────── */
  var _renderTimer = null;
  function scheduleRender() {
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(function () {
      document.fonts.ready.then(function () {
        CANVAS.render(getRenderState()).catch(function (e) { console.warn('[CANVAS]', e); });
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
    var brandChanged = state.brand !== key;

    // Mark Step 1 as user-confirmed (unlocks its Continue button).
    userCompleted.brand = true;

    if (!brandChanged) {
      // User tapped the already-selected (default) brand — just
      // confirm and let downstream gating react. No state reset.
      syncBrandGrid();
      renderWizard();
      mfSyncContinueButtons();
      mfMaybeAutoAdvance(1);
      return;
    }

    state.brand           = key;
    state.image           = null;
    state.layout          = 'left';
    state.messagePreset   = PLACEHOLDER_PRESET;
    state.messageMode     = 'preset';
    state.messagePosition = '';
    state.positionRef     = null;
    state.referralLink    = '';
    state.cta             = PLACEHOLDER_CTA;
    state.subLabel        = [];
    state.smartSuggestions = [];
    // Brand changed → Steps 2/3 need re-confirmation. Step 4 (CTA)
    // keeps its default-confirmed status since CTA is brand-agnostic.
    userCompleted.image   = false;
    userCompleted.message = false;
    CANVAS.resetSeeds();
    syncStickyPosBar();

    setAccent(key);
    syncBrandGrid();
    buildImageGrid();

    // Re-seed default image for the new brand so the preview keeps
    // rendering something while the user reaches Step 2.
    var brandDefImg = getDefaultImage(key);
    if (brandDefImg) {
      state.image = brandDefImg;
      syncImageGrid();
    }

    // Re-apply preset/cta highlights (they survived the brand change).
    if (elPresetGrid) {
      elPresetGrid.querySelectorAll('.preset-chip').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.value === state.messagePreset);
      });
    }
    buildPositionChips();
    if (elCtaGrid) {
      elCtaGrid.querySelectorAll('.cta-chip').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.value === state.cta);
      });
    }
    syncCtaRequired();
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
    userCompleted.image = true;       // Round 11: explicit user pick unlocks Step 2 Continue
    CANVAS.resetSeeds();
    syncImageGrid();
    renderWizard();
    mfSyncContinueButtons();
    // Round 8: no auto-advance. User stays on Step 2 to browse visuals,
    // taps "Use this visual →" when ready.

    _imageDataReady = Promise.all([
      loadDataScript(img.dataScript11),
      loadDataScript(img.dataScript916)
    ]);

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
    if (elPresetGrid) elPresetGrid.querySelectorAll('.preset-chip').forEach(function (el) {
      el.classList.remove('selected');
    });
    var list = $('pos-acc-list');
    if (list) list.querySelectorAll('.pos-acc-row').forEach(function (el) {
      el.classList.remove('selected');
    });
    state.messagePreset   = null;
    state.messagePosition = '';
    state.positionRef     = null;
    syncStickyPosBar();
  }

  function onPresetSelect(text) {
    // Selecting a preset switches into preset mode and clears position
    state.messageMode     = 'preset';
    state.messagePreset   = text;
    state.messagePosition = '';
    state.positionRef     = null;
    userCompleted.message = true;    // Round 11: unlocks Step 3 Continue

    if (elPresetGrid) elPresetGrid.querySelectorAll('.preset-chip').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.value === text);
    });
    var list = $('pos-acc-list');
    if (list) list.querySelectorAll('.pos-acc-row').forEach(function (el) {
      el.classList.remove('selected');
    });
    syncStickyPosBar();

    renderWizard();
    mfSyncContinueButtons();
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
    syncCtaRequired();
  }

  function onCTASelect(text) {
    state.cta = text;
    userCompleted.cta = true;        // Round 11: explicit CTA pick recorded
    elCtaGrid.querySelectorAll('.cta-chip').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.value === text);
    });
    renderWizard();
    mfSyncContinueButtons();
    syncCtaRequired();
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

  // Round 8: Preview & Save advances directly to the results screen.
  // PNG saves are instant (live canvas → toBlob). The animated GIF + MP4
  // pipeline only runs on demand when the user opts in.
  function onExport() {
    if (!canExport()) return;
    _imageDataReady.then(function () {
      showResults();
    });
  }

  /* ── Start over ──────────────────────────────────────── */
  function onRestart() {
    // Round 11: restart returns to the same defaults init() applies —
    // brand + preset + cta pre-selected, first available visual chosen,
    // wizard re-opens at Step 1.
    state.brand           = DEFAULT_BRAND;
    state.image           = null;
    state.layout          = 'left';
    state.messageMode     = 'preset';
    state.messagePreset   = PLACEHOLDER_PRESET;
    state.messagePosition = '';
    state.positionRef     = null;
    state.referralLink    = '';
    state.cta             = PLACEHOLDER_CTA;
    state.subLabel        = [];
    state.smartSuggestions = [];
    // Round 11: clear the explicit-confirmation flags so the wizard
    // lands on Step 1 with Continue disabled, exactly like first load.
    userCompleted.brand   = false;
    userCompleted.image   = false;
    userCompleted.message = false;
    userCompleted.cta     = false;
    syncStickyPosBar();
    CANVAS.resetSeeds();
    setAccent(state.brand);

    syncBrandGrid();
    buildImageGrid();
    // Re-seed the default visual after the grid is rebuilt
    var restartImg = getDefaultImage(state.brand);
    if (restartImg) {
      state.image = restartImg;
      syncImageGrid();
    }
    // Don't clearPreset()/clearCTA() — that wipes our defaults. Just
    // re-apply the visual selection on the chips.
    if (elPresetGrid) {
      elPresetGrid.querySelectorAll('.preset-chip').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.value === state.messagePreset);
      });
    }
    var posList = $('pos-acc-list');
    if (posList) posList.querySelectorAll('.pos-acc-row').forEach(function (el) {
      el.classList.remove('selected');
    });
    buildPositionChips();
    if (elCtaGrid) {
      elCtaGrid.querySelectorAll('.cta-chip').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.value === state.cta);
      });
    }
    syncCtaRequired();
    clearSubLabel();

    // Close general-copy disclosure
    var disc = $('gen-copy-disclosure');
    if (disc) disc.removeAttribute('open');

    setWizardLocked(false);
    elBtnExport.style.display    = '';

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
    if (_resultBlobs.gif11)  _resultMap.gif11  = { blob: _resultBlobs.gif11,  mime: 'image/gif',  name: base + '-1x1.gif'  };
    if (_resultBlobs.png11)  _resultMap.png11  = { blob: _resultBlobs.png11,  mime: 'image/png',  name: base + '-1x1.png'  };
    if (_resultBlobs.png916) _resultMap.png916 = { blob: _resultBlobs.png916, mime: 'image/png',  name: base + '-9x16.png' };
    if (_resultBlobs.videoResult && _resultBlobs.videoResult.blob &&
        _resultBlobs.videoResult.ext === 'mp4') {
      _resultMap.video916 = {
        blob: _resultBlobs.videoResult.blob,
        mime: 'video/mp4',
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

  function downloadByFmt(fmt) {
    var entry = _resultMap[fmt];
    if (!entry || !entry.blob) return;
    triggerDownload(entry.blob, entry.name);
  }

  // Round 8: capture a still PNG from the live canvas. This runs the
  // canvas through stillFrameState so animation noise (smoke, CTA pulse)
  // doesn't leak into the saved image.
  function capturePng(is916) {
    return new Promise(function (resolve, reject) {
      var oc  = document.createElement('canvas');
      var s   = is916 ? CANVAS.S916 : CANVAS.S11;
      oc.width = s.w; oc.height = s.h;
      var ctx = oc.getContext('2d');
      var fs  = { msgOpacity: 1, msgYOffset: 0, ctaPulse: 0, t: 1.333 };
      CANVAS.renderToCtx(ctx, s, state, 20, fs, is916, true)
        .then(function () {
          oc.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('toBlob failed'));
          }, 'image/png');
        })
        .catch(reject);
    });
  }

  function flashSaved(btn, originalLabel) {
    if (!btn) return;
    var prev = originalLabel || btn.textContent;
    btn.classList.add('is-saved');
    btn.textContent = '✓ Saved';
    setTimeout(function () {
      btn.classList.remove('is-saved');
      btn.textContent = prev;
    }, 1500);
  }

  // Save a PNG: native share sheet on mobile (gives user "Save to Photos"
  // option), direct download on desktop or share-unavailable.
  function savePngWithShare(blob, filename, btn, originalLabel) {
    var file = new File([blob], filename, { type: 'image/png' });
    if (IS_MOBILE && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: positionHeadline() })
        .then(function () { flashSaved(btn, originalLabel); })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          triggerDownload(blob, filename);
          flashSaved(btn, originalLabel);
        });
    } else {
      triggerDownload(blob, filename);
      flashSaved(btn, originalLabel);
    }
  }

  function onSavePng(is916) {
    var btn = $(is916 ? 'btn-save-png916' : 'btn-save-png11');
    var originalLabel = btn ? btn.textContent : '';
    var name = filenameBase() + (is916 ? '-9x16.png' : '-1x1.png');
    capturePng(is916).then(function (blob) {
      savePngWithShare(blob, name, btn, originalLabel);
    }).catch(function (err) {
      console.error('[savePng]', err);
    });
  }

  // GIF — save (LinkedIn flow). Opens share sheet on mobile so user can
  // "Save to Photos"; downloads directly otherwise.
  function onSaveGif() {
    var entry = _resultMap.gif11;
    if (!entry || !entry.blob) return;
    var btn = $('btn-save-gif');
    var orig = btn ? btn.textContent : '';
    var file = new File([entry.blob], entry.name, { type: entry.mime });
    if (IS_MOBILE && navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: positionHeadline() })
        .then(function () { flashSaved(btn, orig); })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          triggerDownload(entry.blob, entry.name);
          flashSaved(btn, orig);
        });
    } else {
      triggerDownload(entry.blob, entry.name);
      flashSaved(btn, orig);
    }
  }

  // MP4 — Save / Share. On mobile with share support, opens share sheet
  // (Instagram, TikTok, WhatsApp); otherwise direct download.
  function onSaveMp4() {
    var entry = _resultMap.video916;
    if (!entry || !entry.blob) return;
    var btn = $('btn-save-mp4');
    var orig = btn ? btn.textContent : '';
    var file = new File([entry.blob], entry.name, { type: entry.mime });
    if (IS_MOBILE && navigator.canShare && navigator.canShare({ files: [file] })) {
      var data = { files: [file], title: positionHeadline() };
      var text = shareCaption();
      if (text) data.text = text;
      navigator.share(data)
        .then(function () { flashSaved(btn, orig); })
        .catch(function (err) {
          if (err && err.name === 'AbortError') return;
          triggerDownload(entry.blob, entry.name);
          flashSaved(btn, orig);
        });
    } else {
      triggerDownload(entry.blob, entry.name);
      flashSaved(btn, orig);
    }
  }

  // Round 8: opt-in animated generation (GIF + MP4 only, PNGs already saved).
  function onGenerateAnimated() {
    var btn = $('btn-generate-animated');
    if (!btn) return;
    btn.disabled = true;
    btn.classList.add('is-generating');

    var titleEl = btn.querySelector('.bga-title');
    var subEl   = btn.querySelector('.bga-sub');
    var arrowEl = btn.querySelector('.bga-arrow');
    var timeEl  = btn.querySelector('.bga-time');

    if (titleEl) titleEl.textContent = '✦ Generating animated versions…';
    if (subEl)   subEl.textContent   = 'Rendering frames — please wait';
    if (arrowEl) arrowEl.textContent = '0%';
    if (timeEl)  timeEl.textContent  = '~15s';

    EXPORT.generateBlobs(state, function (pct, label) {
      if (arrowEl) arrowEl.textContent = Math.round(pct) + '%';
      if (subEl && label) subEl.textContent = label;
    })
      .then(function (blobs) {
        _resultBlobs = blobs;
        buildResultMap();
        showAnimatedResults();
      })
      .catch(function (err) {
        console.error('[animated]', err);
        btn.disabled = false;
        btn.classList.remove('is-generating');
        if (titleEl) titleEl.textContent = '✗ Generation failed — tap to retry';
        if (subEl)   subEl.textContent   = (err && err.message) ? err.message : 'Unknown error';
        if (arrowEl) arrowEl.textContent = 'Retry →';
        if (timeEl)  timeEl.textContent  = '~15s';
      });
  }

  function showAnimatedResults() {
    revokePreviewUrls();
    var animSection = $('animated-section');
    var animResults = $('animated-results');
    if (animSection) animSection.style.display = 'none';
    if (animResults) animResults.style.display = '';

    setPreviewImage('r8-gif-img', _resultBlobs.gif11);
    // Static still as MP4 thumbnail (video can't render in <img>)
    setPreviewImage('r8-mp4-img', _resultBlobs.png916);

    // Hide MP4 card if pipeline failed
    var mp4Card = document.querySelector('[data-fmt="video916"]');
    if (mp4Card) mp4Card.style.display = _resultMap.video916 ? '' : 'none';
  }

  // Render PNG snapshots into the result preview slots so the static
  // result cards always show a clean still (no animation noise) without
  // needing to relocate the live canvases.
  function renderResultPreviews() {
    var slot11  = $('r8-preview-png11');
    var slot916 = $('r8-preview-png916');
    if (!slot11 && !slot916) return;

    var renderInto = function (slot, blob) {
      if (!slot || !blob) return;
      slot.innerHTML = '';
      var img = new Image();
      var url = URL.createObjectURL(blob);
      _previewUrls.push(url);
      img.src = url;
      slot.appendChild(img);
    };

    capturePng(false).then(function (b) { renderInto(slot11, b);  }).catch(function(){});
    capturePng(true ).then(function (b) { renderInto(slot916, b); }).catch(function(){});
  }

  function showResults() {
    revokePreviewUrls();

    if (elResultsTitle) elResultsTitle.textContent = positionHeadline();
    if (elResultsSubtitle) {
      var brandName   = state.brand ? BRANDS[state.brand].name : '';
      var visualLabel = state.image ? state.image.label : '';
      var bits = [];
      if (brandName)   bits.push(brandName);
      if (visualLabel) bits.push(visualLabel + ' visual');
      elResultsSubtitle.textContent = bits.join(' · ');
    }

    // Reset the animated section back to its CTA state on every entry
    var animSection = $('animated-section');
    var animResults = $('animated-results');
    if (animSection) animSection.style.display = '';
    if (animResults) animResults.style.display = 'none';
    var bga = $('btn-generate-animated');
    if (bga) {
      bga.disabled = false;
      bga.classList.remove('is-generating');
      var bgaTitle = bga.querySelector('.bga-title');
      var bgaSub   = bga.querySelector('.bga-sub');
      var bgaArrow = bga.querySelector('.bga-arrow');
      var bgaTime  = bga.querySelector('.bga-time');
      if (bgaTitle) bgaTitle.textContent = '✦ Add motion to stand out';
      if (bgaSub)   bgaSub.textContent   = 'Animated GIF + MP4 — moving posts catch more attention in feeds';
      if (bgaArrow) bgaArrow.textContent = 'Generate →';
      if (bgaTime)  bgaTime.textContent  = '~15s';
    }

    renderResultPreviews();

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

    var bSavePng11 = $('btn-save-png11');
    if (bSavePng11) bSavePng11.addEventListener('click', function () { onSavePng(false); });
    var bSavePng916 = $('btn-save-png916');
    if (bSavePng916) bSavePng916.addEventListener('click', function () { onSavePng(true); });

    var bGen = $('btn-generate-animated');
    if (bGen) bGen.addEventListener('click', onGenerateAnimated);

    var bSaveGif = $('btn-save-gif');
    if (bSaveGif) bSaveGif.addEventListener('click', onSaveGif);
    var bSaveMp4 = $('btn-save-mp4');
    if (bSaveMp4) bSaveMp4.addEventListener('click', onSaveMp4);

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

  /* ═══════════════════════════════════════════════════════
     CTA mandatory enforcement (Round 8) — Step 4 button stays
     disabled until state.cta is set. Note + button label live on
     both desktop (#cta-required-note + #btn-export) and mobile
     (#mf-cta-required-note + #mf-btn4).
  ══════════════════════════════════════════════════════════ */
  function syncCtaRequired() {
    var hasCta = !!state.cta;
    var exportable = canExport();
    [['cta-required-note',    'btn-export', exportable],
     ['mf-cta-required-note', 'mf-btn4',    hasCta]].forEach(function (pair) {
      var note = $(pair[0]);
      var btn  = $(pair[1]);
      if (note) note.classList.toggle('hidden', hasCta);
      if (btn)  btn.disabled = !pair[2];
    });
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
    var list = $('pos-acc-list');
    if (!list) return;
    list.innerHTML = '';

    var all = _jobsCache || [];

    // Filter by brand. Overwolf is the umbrella brand — always show every
    // open role across the whole group so recruiters can tag any position
    // under it. Sub-brands (Tebex, Outplayed, CurseForge, Overwolf Ads)
    // get strictly filtered: only roles whose title mentions the brand.
    // No "fall back to all" — that would mislead users into thinking
    // unrelated positions belong to the chosen brand.
    var positions = all;
    if (state.brand && state.brand !== 'overwolf') {
      positions = all.filter(function (p) {
        return getBrandForPosition(p) === state.brand;
      });
    }

    if (!positions.length) {
      if (_jobsCache === null) {
        var loading = document.createElement('p');
        loading.className = 'pos-hint';
        loading.textContent = 'Loading open positions…';
        list.appendChild(loading);
        return;
      }
      // Sub-brand had no roles but the umbrella has openings — invite the
      // user to switch brands rather than leaving them stuck.
      if (state.brand && state.brand !== 'overwolf' && all.length) {
        var brandName = (BRANDS[state.brand] && BRANDS[state.brand].name) || state.brand;
        var fallback = document.createElement('div');
        fallback.className = 'pos-empty-fallback';
        fallback.innerHTML =
          '<p class="pos-empty-fallback-msg">No open ' + escapeHtml(brandName) +
          ' positions right now.</p>' +
          '<button type="button" class="pos-empty-fallback-btn" id="pos-fallback-btn">' +
          'Browse Overwolf positions instead →</button>';
        list.appendChild(fallback);
        var btn = $('pos-fallback-btn');
        if (btn) btn.addEventListener('click', function () { onBrandSelect('overwolf'); });
        return;
      }
      var none = document.createElement('p');
      none.className = 'pos-hint';
      none.textContent = 'No open positions right now.';
      list.appendChild(none);
      return;
    }

    positions.forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'pos-acc-row';
      row.dataset.title = p.title;

      var head = document.createElement('div');
      head.className = 'pos-acc-head';
      head.innerHTML =
        '<span class="pos-acc-title">' + escapeHtml(p.title) + '</span>' +
        '<span class="pos-acc-caret">▶</span>';
      head.addEventListener('click', function () { onPositionSelect(p); });
      row.appendChild(head);

      var detail = document.createElement('div');
      detail.className = 'pos-acc-detail';
      detail.innerHTML = buildPositionDetailHtml(p);
      row.appendChild(detail);

      list.appendChild(row);
    });
  }

  function buildPositionDetailHtml(pos) {
    var rows = [];
    var locBits = [];
    if (pos.city) locBits.push(pos.city);
    var country = pos.country && COUNTRY_NAMES[pos.country] ? COUNTRY_NAMES[pos.country] : pos.country;
    if (country) locBits.push(country);
    if (locBits.length) rows.push({ icon: '📍', value: locBits.join(' · ') });

    var deptBits = [];
    if (pos.department) deptBits.push(pos.department);
    if (pos.employmentType) deptBits.push(pos.employmentType);
    if (deptBits.length) rows.push({ icon: '🏢', value: deptBits.join('  ·  ') });

    if (pos.workplaceType) rows.push({ icon: '🌐', value: pos.workplaceType });
    if (pos.isRemote)      rows.push({ icon: '🌍', value: 'Open to remote' });

    var html = '<div class="pos-acc-detail-row">' +
      rows.map(function (r) {
        return '<span class="pos-acc-detail-item">' +
               '<span class="pos-acc-detail-icon">' + r.icon + '</span>' +
               '<span>' + escapeHtml(r.value) + '</span>' +
               '</span>';
      }).join('') +
      '</div>';

    if (pos.urlActivePage) {
      html += '<a class="pos-acc-detail-link" href="' + escapeHtml(pos.urlActivePage) +
              '" target="_blank" rel="noopener">View full job posting →</a>';
    }
    return html;
  }

  function onPositionSelect(pos) {
    // Selecting a position clears any preset selection
    state.messageMode     = 'position';
    state.messagePreset   = null;
    state.messagePosition = pos.title;
    state.positionRef     = pos;
    userCompleted.message = true;    // Round 11: unlocks Step 3 Continue

    var presetGrid = $('preset-grid');
    if (presetGrid) presetGrid.querySelectorAll('.preset-chip').forEach(function (el) {
      el.classList.remove('selected');
    });

    syncStickyPosBar();

    var list = $('pos-acc-list');
    if (list) list.querySelectorAll('.pos-acc-row').forEach(function (el) {
      el.classList.toggle('selected', el.dataset.title === pos.title);
    });

    // Surface the extracted suggestions, but DO NOT auto-apply them.
    state.smartSuggestions.forEach(function (v) {
      var i = state.subLabel.indexOf(v);
      if (i !== -1) state.subLabel.splice(i, 1);
    });
    state.smartSuggestions = extractSuggestions(pos);
    syncSubLabelUI();

    renderWizard();
    advance();
    mfSyncContinueButtons();
    scheduleRender();
  }

  function syncStickyPosBar() {
    var bar   = $('sticky-pos-bar');
    var title = $('spb-title');
    var link  = $('spb-link');
    if (!bar) return;
    if (state.messageMode === 'position' && state.positionRef) {
      bar.style.display = '';
      if (title) title.textContent = 'Selected: ' + state.positionRef.title;
      if (link)  link.href = state.positionRef.urlActivePage || '#';
    } else {
      bar.style.display = 'none';
    }
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
      nxt.classList.remove('prev');
      nxt.classList.add('active');
    }
    mfStep = n;
    mfUpdateTopbar();
    mfMountCanvasFor(n);

    // Step 2 entry: auto-select first visual if none chosen yet
    if (n === 2 && !state.image && state.brand) {
      var firstThumb = document.querySelector('#mf-slot-image .image-thumb');
      if (firstThumb) {
        var poolKey = BRANDS[state.brand].imagePool;
        var src  = (state.images && state.images[poolKey] && state.images[poolKey].length)
                   ? state.images
                   : (typeof IMAGES_DATA !== 'undefined' ? IMAGES_DATA : {});
        var pool = src[poolKey] || [];
        if (pool.length) onImageSelect(pool[0]);
      }
    }

    // Step 5 entry: render the results UI (instant — no generation)
    if (n === 5) {
      _imageDataReady.then(function () {
        showResults();
        // Move the (now-public) results section into the mobile body so
        // it lays out within the slide.
        var body = $('mf-results-body');
        if (body && elResultsSection && body !== elResultsSection.parentNode) {
          body.appendChild(elResultsSection);
          elResultsSection.style.display = 'block';
        }
        // Re-mount canvases inside the now-mounted result cards
        mfMountCanvasFor(5);
      });
    }
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

  // Round 11: per-step Continue buttons gate on userCompleted, not
  // state. Defaults populate state for preview rendering but do NOT
  // pre-unlock buttons — user must tap a chip in each step. Step 4
  // is exempt (CTA has a default and button stays enabled).
  function mfSyncContinueButtons() {
    if (!MF_VIEWPORT) return;
    [1,2,3,4].forEach(function (n) {
      var btn = $('mf-btn' + n);
      if (btn) btn.disabled = !isStepUnlocked(n);
    });
  }

  // Auto-advance after a 250ms beat so users see the chip light up before
  // sliding to the next screen. Steps 1–3 only; Step 4 stays manual.
  // Round 11: gates on userCompleted so default-only state never
  // auto-advances on init.
  var _mfAutoAdvanceTimer = null;
  function mfMaybeAutoAdvance(forStep) {
    if (!MF_VIEWPORT) return;
    if (mfStep !== forStep) return;
    if (forStep >= 4) return;
    if (!isStepUnlocked(forStep)) return;
    clearTimeout(_mfAutoAdvanceTimer);
    _mfAutoAdvanceTimer = setTimeout(function () {
      if (mfStep === forStep) mfNext();
    }, 250);
  }

  function mfRestart() {
    onRestart();         // clears state + resets desktop wizard
    mfGo(1);
    mfSyncContinueButtons();
  }

  // Round 8 mobile relocation. The 1:1 canvas moves between steps 2, 4
  // and 5 (in the result PNG card). Step 3 has no preview — focused list.
  function mfRelocateNodes() {
    if (!MF_VIEWPORT) return;
    document.body.classList.add('mf-active');
    document.getElementById('mobile-flow').setAttribute('aria-hidden', 'false');

    // Step 1 — brand grid
    var brand = $('brand-grid');
    var slot1 = $('mf-slot-brand');
    if (brand && slot1) slot1.appendChild(brand);

    // Step 2 — image grid (preview host populated on step transition)
    var img = $('image-grid');
    var slot2 = $('mf-slot-image');
    if (img && slot2) slot2.appendChild(img);

    // Step 3 — entire pos accordion + general copy disclosure
    var slot3 = $('mf-slot-message');
    if (slot3) {
      var liveHint = document.querySelector('.pos-live-hint');
      if (liveHint) slot3.appendChild(liveHint);
      var posList = $('pos-acc-list');
      if (posList) slot3.appendChild(posList);
      var stickyBar = $('sticky-pos-bar');
      if (stickyBar) slot3.appendChild(stickyBar);
      var genCopy = $('gen-copy-disclosure');
      if (genCopy) slot3.appendChild(genCopy);
    }

    // Step 4 — CTA grid + sublabel section
    var slot4 = $('mf-slot-action');
    if (slot4) {
      var cta = $('cta-grid');
      if (cta) slot4.appendChild(cta);
      var ctaNote = $('cta-required-note');
      // Desktop note element no longer needed — mobile has its own
      if (ctaNote) ctaNote.remove();
      var sub = document.querySelector('.sublabel-section');
      if (sub) slot4.appendChild(sub);
    }

    // Position canvases into the active step's preview host on first show.
    mfMountCanvasFor(mfStep);
  }

  // Move canvas-11 into the active step's preview host (Step 2 / 4).
  // Other steps don't show a live preview.
  function mfMountCanvasFor(step) {
    if (!MF_VIEWPORT) return;
    var c11 = $('canvas-11');
    if (!c11) return;

    if (step === 2 || step === 4) {
      var host = $('mf-preview-host-' + step);
      if (host && c11.parentElement !== host) host.appendChild(c11);
    }
    scheduleRender();
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
  }

  // Round 8.1: swipe-to-select on the visual carousel.
  // After the user scrolls the horizontal thumbnail strip and the scroll
  // settles, select whichever thumb is aligned with the strip's left edge.
  // This makes the carousel feel like a phone photo roll — swipe to browse,
  // and the preview at the top updates live as the leading thumb changes.
  function wireImageCarouselSwipe() {
    if (!MF_VIEWPORT) return;
    var strip = $('image-grid');
    if (!strip) return;
    var endTimer = null;
    strip.addEventListener('scroll', function () {
      clearTimeout(endTimer);
      endTimer = setTimeout(function () {
        var thumbs = strip.querySelectorAll('.image-thumb');
        if (!thumbs.length) return;
        var stripRect = strip.getBoundingClientRect();
        // Center of the strip's leftmost visible region (small offset for snap)
        var anchorX = stripRect.left + 12;
        var best = null, bestDist = Infinity;
        for (var i = 0; i < thumbs.length; i++) {
          var r = thumbs[i].getBoundingClientRect();
          // Skip items that are off-screen entirely
          if (r.right < stripRect.left || r.left > stripRect.right) continue;
          var d = Math.abs(r.left - anchorX);
          if (d < bestDist) { bestDist = d; best = thumbs[i]; }
        }
        if (best && !best.classList.contains('selected')) best.click();
      }, 120);
    }, { passive: true });
  }

  function initMobileFlow() {
    if (!MF_VIEWPORT) return;
    mfRelocateNodes();
    mfWireUI();
    mfUpdateTopbar();
    mfSyncContinueButtons();
    wireImageCarouselSwipe();
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

    // Round 11: brand / preset / cta come from defaults. Wire up
    // accent + grid highlights so the user lands on Step 1 with a
    // pre-selected brand, preset chip, and CTA chip — and a real
    // banner already rendered behind the wizard.
    if (state.brand) {
      setAccent(state.brand);
      syncBrandGrid();
      buildImageGrid();
      buildPositionChips();

      // Manifest just parsed — promote the first available visual
      // into state so canExport() succeeds out of the box.
      if (!state.image) {
        var defImg = getDefaultImage(state.brand);
        if (defImg) {
          state.image = defImg;
          syncImageGrid();
        }
      }

      // Visually pre-select the default preset + CTA chips.
      if (state.messagePreset && elPresetGrid) {
        elPresetGrid.querySelectorAll('.preset-chip').forEach(function (el) {
          el.classList.toggle('selected', el.dataset.value === state.messagePreset);
        });
      }
      if (state.cta && elCtaGrid) {
        elCtaGrid.querySelectorAll('.cta-chip').forEach(function (el) {
          el.classList.toggle('selected', el.dataset.value === state.cta);
        });
      }
    }

    fetchJobs();

    // Sub-label other input
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

    // Preview & Save (formerly Generate Package)
    if (elBtnExport) {
      elBtnExport.addEventListener('click', onExport);
    }

    wireStepHeaders();
    wireIndicator();
    wireResultsActions();

    syncCtaRequired();

    renderWizard();
    // Round 11: ALWAYS land on Step 1, even though defaults make
    // every step technically "complete". User can confirm the
    // pre-selected brand or change it before moving on.
    openStep(1);

    // Round 10: prewarm the brand logo + default image before the first
    // render so the canvas appears fully composed, not logo-less.
    CANVAS.prewarmExportImages(getRenderState())
      .then(function () { scheduleRender(); })
      .catch(function () { scheduleRender(); });

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
