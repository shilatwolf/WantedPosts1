'use strict';

/* ============================================================
   EXPORT MODULE
   Generates PNG / GIF / WebM(MP4) and packages them in a ZIP.
   Dependencies: gif.js (CDN), JSZip (CDN), CANVAS module
   ============================================================ */

const EXPORT = (function () {

  /* ── GIF frame state ─────────────────────────────────── */
  // 45 frames @ 15 fps = 3 s loop
  // F 0-9  : headline fades in fast
  // All:    embers drift up, CTA pulses continuously
  function gifFrameState(f) {
    // msgOpacity is always 1 — a fade-in would cause a hard jump when the GIF
    // loops back to frame 0 (text would instantly vanish), breaking the loop.
    var msgOpacity = 1;
    // CTA pulse: period = 15 frames, 45 frames total = exactly 3 full cycles.
    // Frame 0 and frame 45 have the same phase (0), so the loop is seamless.
    var ctaPulse = (Math.sin(f * (Math.PI * 2 / 15)) * 0.5 + 0.5);
    return { msgOpacity: msgOpacity, ctaPulse: ctaPulse };
  }

  /* ── MP4 frame state ─────────────────────────────────── */
  // 10 s loop @ 30 fps
  function mp4FrameState(frame, fps) {
    var t = frame / fps;
    var msgOpacity = t < 0.35 ? 0 :
                     t < 1.1  ? (t - 0.35) / 0.75 :
                     1;
    // Continuous pulse matching GIF rhythm
    var ctaPulse = (Math.sin(t * Math.PI * 2 / 1.0) * 0.5 + 0.5);
    return { msgOpacity: msgOpacity, ctaPulse: ctaPulse };
  }

  /* ── PNG: capture single canvas frame ───────────────── */
  function makePNG(state, is916) {
    return new Promise(function (resolve, reject) {
      var oc  = document.createElement('canvas');
      var s   = is916 ? CANVAS.S916 : CANVAS.S11;
      oc.width  = s.w;
      oc.height = s.h;
      var ctx = oc.getContext('2d');

      CANVAS.renderToCtx(ctx, s, state, 0, { msgOpacity: 1, ctaPulse: 0 }, is916, true)
        .then(function () {
          oc.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('PNG toBlob failed'));
          }, 'image/png');
        })
        .catch(reject);
    });
  }

  /* ── GIF: 45-frame animated 1:1 ─────────────────────── */
  function makeGIF(state, onProgress) {
    return new Promise(function (resolve, reject) {
      var FRAMES = 45;
      var FPS    = 15;
      var DELAY  = Math.round(1000 / FPS); // 67 ms

      if (typeof GIF === 'undefined') {
        reject(new Error('gif.js not loaded'));
        return;
      }

      var gif = new GIF({
        workers:      2,
        quality:      3,          // 1=best, lower = sharper colors (was 8)
        width:        CANVAS.S11.w,
        height:       CANVAS.S11.h,
        workerScript: (typeof GIF_WORKER_URL !== 'undefined') ? GIF_WORKER_URL : 'gif.worker.js'
      });

      var oc  = document.createElement('canvas');
      oc.width  = CANVAS.S11.w;
      oc.height = CANVAS.S11.h;
      var ctx = oc.getContext('2d');

      gif.on('finished', function (blob) { resolve(blob); });
      gif.on('error',    function (e)    { reject(e); });

      (async function addFrames() {
        for (var f = 0; f < FRAMES; f++) {
          var fs = gifFrameState(f);
          await CANVAS.renderToCtx(ctx, CANVAS.S11, state, f, fs, false, true);
          gif.addFrame(ctx, { copy: true, delay: DELAY });
          if (onProgress) onProgress(f / FRAMES);
        }
        gif.render();
      })().catch(reject);
    });
  }

  /* ── Video: 10-second 9:16 via MediaRecorder ─────────── */
  function makeVideo(state, onProgress) {
    return new Promise(function (resolve, reject) {
      var FPS      = 30;
      var DURATION = 10;
      var S        = CANVAS.S916;

      // Prefer MP4 (required for Instagram Stories).
      // Chrome 130+ supports video/mp4 natively in MediaRecorder.
      // Falls back to WebM if MP4 is unavailable.
      var mime = '', ext = 'mp4';
      var candidates = [
        'video/mp4;codecs=avc1',
        'video/mp4',
        'video/webm;codecs=vp9',
        'video/webm'
      ];
      if (window.MediaRecorder) {
        for (var ci = 0; ci < candidates.length; ci++) {
          if (MediaRecorder.isTypeSupported(candidates[ci])) {
            mime = candidates[ci];
            ext  = candidates[ci].startsWith('video/mp4') ? 'mp4' : 'webm';
            break;
          }
        }
      }

      if (!window.MediaRecorder) {
        reject(new Error('MediaRecorder not supported'));
        return;
      }

      var oc  = document.createElement('canvas');
      oc.width  = S.w;
      oc.height = S.h;
      var ctx    = oc.getContext('2d');
      var stream = oc.captureStream(FPS);

      var opts = mime ? { mimeType: mime } : {};
      var recorder;
      try {
        recorder = new MediaRecorder(stream, opts);
      } catch (e) {
        reject(e);
        return;
      }

      var chunks = [];
      recorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = function () {
        var blob = new Blob(chunks, { type: mime || 'video/webm' });
        resolve({ blob: blob, ext: ext });
      };
      recorder.onerror = function (e) { reject(e); };

      var frameNum = 0;
      var startMs  = null;

      recorder.start(200);

      function tick(ts) {
        if (startMs === null) startMs = ts;
        var elapsed = (ts - startMs) / 1000;

        if (elapsed >= DURATION) {
          recorder.stop();
          return;
        }

        var fs = mp4FrameState(frameNum, FPS);
        CANVAS.renderToCtx(ctx, S, state, frameNum, fs, true, true)
          .then(function () {
            frameNum++;
            if (onProgress) onProgress(elapsed / DURATION);
            requestAnimationFrame(tick);
          })
          .catch(function (err) {
            recorder.stop();
            reject(err);
          });
      }

      CANVAS.renderToCtx(ctx, S, state, 0, mp4FrameState(0, FPS), true, true)
        .then(function () { requestAnimationFrame(tick); })
        .catch(reject);
    });
  }

  /* ── Classic anchor-download helper ─────────────────── */
  function _fallbackDownload(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ── ZIP via JSZip (fallback only) ───────────────────── */
  function makeZip(png11, gif11, png916, videoResult) {
    return new Promise(function (resolve, reject) {
      if (typeof JSZip === 'undefined') {
        reject(new Error('JSZip not loaded'));
        return;
      }
      var zip = new JSZip();
      zip.file('banner-1x1.png',  png11);
      zip.file('banner-1x1.gif',  gif11);
      zip.file('banner-9x16.png', png916);
      zip.file('banner-9x16.' + videoResult.ext, videoResult.blob);
      zip.generateAsync({ type: 'blob' }).then(resolve).catch(reject);
    });
  }

  /* ── Write files to a pre-obtained directory handle ────
     dirHandle comes from showDirectoryPicker() called in app.js
     synchronously inside the click handler (user-gesture context).
     Files written here are local — no Zone.Identifier ever applied.
  ──────────────────────────────────────────────────────── */
  function _writeToDir(dir, png11, gif11, png916, videoResult) {
    var files = [
      { name: 'banner-1x1.png',                     blob: png11 },
      { name: 'banner-1x1.gif',                     blob: gif11 },
      { name: 'banner-9x16.png',                    blob: png916 },
      { name: 'banner-9x16.' + videoResult.ext,     blob: videoResult.blob }
    ];
    return files.reduce(function (chain, f) {
      return chain
        .then(function () { return dir.getFileHandle(f.name, { create: true }); })
        .then(function (fh) { return fh.createWritable(); })
        .then(function (w)  { return w.write(f.blob).then(function () { return w.close(); }); });
    }, Promise.resolve());
  }

  /* ── Main export orchestrator ────────────────────────── */
  // dirHandle: FileSystemDirectoryHandle obtained by app.js calling
  // showDirectoryPicker() synchronously inside the Generate click handler.
  // Pass null to fall back to ZIP download.
  function generatePackage(state, onProgress, onComplete, onError, filename, dirHandle) {
    var step = function (pct, label) {
      if (onProgress) onProgress(pct, label);
    };

    step(0, 'Rendering 1:1 PNG…');

    var png11, gif11, png916, videoResult;

    makePNG(state, false)
      .then(function (blob) {
        png11 = blob;
        step(5, 'Generating 1:1 GIF (45 frames)…');
        return makeGIF(state, function (f) {
          step(5 + f * 50, 'Generating GIF… ' + Math.round(f * 100) + '%');
        });
      })
      .then(function (blob) {
        gif11 = blob;
        step(56, 'Rendering 9:16 PNG…');
        return makePNG(state, true);
      })
      .then(function (blob) {
        png916 = blob;
        step(60, 'Recording 9:16 video (10 s)…');
        return makeVideo(state, function (p) {
          step(60 + p * 34, 'Recording video… ' + Math.round(p * 100) + '%');
        });
      })
      .then(function (result) {
        videoResult = result;
        step(95, 'Saving files…');

        if (dirHandle) {
          // ── Strategy 1: write directly to user-chosen folder ──
          return _writeToDir(dirHandle, png11, gif11, png916, videoResult)
            .then(function () {
              step(100, 'Done!');
              if (onComplete) onComplete({
                videoExt:   videoResult.ext,
                png11Size:  (png11.size  / 1024).toFixed(0),
                gif11Size:  (gif11.size  / 1024).toFixed(0),
                png916Size: (png916.size / 1024).toFixed(0),
                vidSize:    (videoResult.blob.size / 1024).toFixed(0),
                savedAs:    'folder'
              });
            });
        }

        // ── Strategy 2: ZIP + showSaveFilePicker or anchor ───
        step(95, 'Packaging ZIP…');
        return makeZip(png11, gif11, png916, videoResult)
          .then(function (zipBlob) {
            var zipName = (filename && filename.trim())
              ? filename.trim() + '.zip'
              : 'recruitment-banners.zip';

            var complete = function () {
              step(100, 'Done!');
              if (onComplete) onComplete({
                videoExt:   videoResult.ext,
                png11Size:  (png11.size  / 1024).toFixed(0),
                gif11Size:  (gif11.size  / 1024).toFixed(0),
                png916Size: (png916.size / 1024).toFixed(0),
                vidSize:    (videoResult.blob.size / 1024).toFixed(0),
                savedAs:    'zip'
              });
            };

            if (window.showSaveFilePicker) {
              return window.showSaveFilePicker({
                suggestedName: zipName,
                types: [{ description: 'ZIP Archive', accept: { 'application/zip': ['.zip'] } }]
              })
              .then(function (handle) {
                return handle.createWritable()
                  .then(function (w) { return w.write(zipBlob).then(function () { return w.close(); }); });
              })
              .then(complete)
              .catch(function (err) {
                if (err && err.name === 'AbortError') {
                  step(0, '');
                  if (onError) onError('__cancelled__');
                  return;
                }
                _fallbackDownload(zipBlob, zipName);
                complete();
              });
            }

            _fallbackDownload(zipBlob, zipName);
            complete();
          });
      })
      .catch(function (err) {
        console.error('[EXPORT]', err);
        if (onError) onError(err.message || 'Export failed');
      });
  }

  return {
    generatePackage: generatePackage
  };

})();
