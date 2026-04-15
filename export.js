'use strict';

/* ============================================================
   EXPORT MODULE
   Generates PNG / GIF / WebM(MP4) and packages them in a ZIP.
   Dependencies: gif.js (CDN), JSZip (CDN), CANVAS module
   ============================================================ */

const EXPORT = (function () {

  /* ── GIF frame state ─────────────────────────────────── */
  // 45 frames @ 15 fps = 3 s loop
  // F 0-19  : headline fades in  (0 → 1)
  // F 34-44 : CTA pulses once    (sin curve)
  // All:     smoke drifts up
  function gifFrameState(f) {
    var msgOpacity = f < 20 ? f / 19 : 1;
    var ctaPulse   = (f >= 34 && f <= 44) ? (f - 34) / 10 : 0;
    return { msgOpacity: msgOpacity, ctaPulse: ctaPulse };
  }

  /* ── MP4 frame state ─────────────────────────────────── */
  // 10 s loop @ 30 fps
  // Headline fades in from t=0.5 → 1.5 s
  // CTA pulses at t=3, 6, 9 s (each lasts 0.5 s)
  function mp4FrameState(frame, fps) {
    var t = frame / fps;
    var msgOpacity = t < 0.5  ? 0 :
                     t < 1.5  ? (t - 0.5) :
                     1;
    var ctaPulse = 0;
    [3, 6, 9].forEach(function (pt) {
      var dt = t - pt;
      if (dt >= 0 && dt < 0.5) ctaPulse = dt / 0.5;
    });
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

      // Static frame — smoke at frame 0, all text fully visible
      CANVAS.renderToCtx(ctx, s, state, 0, { msgOpacity: 1, ctaPulse: 0 }, is916)
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
        quality:      8,
        width:        CANVAS.S11.w,
        height:       CANVAS.S11.h,
        workerScript: 'gif.worker.js'
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
          await CANVAS.renderToCtx(ctx, CANVAS.S11, state, f, fs, false);
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
      var DURATION = 10; // seconds
      var S        = CANVAS.S916;

      // Check mime type support
      var mime = 'video/webm;codecs=vp9';
      var ext  = 'webm';
      if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mime)) {
        mime = 'video/webm';
        if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(mime)) {
          mime = '';
          ext  = 'webm';
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

      recorder.start(200); // collect every 200 ms

      function tick(ts) {
        if (startMs === null) startMs = ts;
        var elapsed = (ts - startMs) / 1000;

        if (elapsed >= DURATION) {
          recorder.stop();
          return;
        }

        var fs = mp4FrameState(frameNum, FPS);
        CANVAS.renderToCtx(ctx, S, state, frameNum, fs, true)
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

      // Pre-render frame 0 so the canvas isn't blank at start
      CANVAS.renderToCtx(ctx, S, state, 0, mp4FrameState(0, FPS), true)
        .then(function () {
          requestAnimationFrame(tick);
        })
        .catch(reject);
    });
  }

  /* ── ZIP via JSZip ───────────────────────────────────── */
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

  /* ── Main export orchestrator ────────────────────────── */
  function generatePackage(state, onProgress, onComplete, onError) {
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
        step(95, 'Packaging ZIP…');
        return makeZip(png11, gif11, png916, videoResult);
      })
      .then(function (zipBlob) {
        step(100, 'Done!');
        // Trigger download
        var url = URL.createObjectURL(zipBlob);
        var a   = document.createElement('a');
        a.href     = url;
        a.download = 'recruitment-banners.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (onComplete) onComplete({
          videoExt: videoResult.ext,
          png11Size:  (png11.size  / 1024).toFixed(0),
          gif11Size:  (gif11.size  / 1024).toFixed(0),
          png916Size: (png916.size / 1024).toFixed(0),
          vidSize:    (videoResult.blob.size / 1024).toFixed(0)
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
