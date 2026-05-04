'use strict';

/* ============================================================
   EXPORT MODULE
   Generates PNG / GIF / WebM(MP4) and packages them in a ZIP.
   Dependencies: gif.js (CDN), JSZip (CDN), CANVAS module
   ============================================================ */

const EXPORT = (function () {

  /* ── CTA heartbeat helper ─────────────────────────────
     One pulse per 3-sec interval, 0.8 s window, sine ease-in-out.
     Returns a 0..1 intensity consumed by canvas.drawText.
     GIF (3 s loop) → one pulse per loop.
     MP4 (10 s loop) → pulses at 3 s, 6 s, 9 s.                     */
  function ctaHeartbeat(t, loopDuration) {
    var pulseDuration = 0.8;
    var pulseStart = loopDuration >= 8 ? 3.0 : (loopDuration * 0.6);
    var pulseInterval = loopDuration >= 8 ? 3.0 : loopDuration;
    var n = Math.floor((t - pulseStart) / pulseInterval);
    if (n < 0) return 0;
    var pulseAt = pulseStart + n * pulseInterval;
    if (t < pulseAt || t >= pulseAt + pulseDuration) return 0;
    var u = (t - pulseAt) / pulseDuration;
    return Math.sin(u * Math.PI);              // 0 → 1 → 0
  }

  /* ── GIF frame state ─────────────────────────────────── */
  // Round 11: 54 frames @ 18 fps = 3 s loop (was 45 @ 15 fps).
  // 20% faster framerate keeps total duration identical while
  // making motion feel snappier — particle speeds were also
  // multiplied by 1.2× in canvas.genSeeds.
  function gifFrameState(f) {
    var LOOP = 3.0;
    var t = f / 18;
    return {
      msgOpacity:  1,
      msgYOffset:  0,
      ctaPulse:    ctaHeartbeat(t, LOOP),
      t:           t,
      loopSeconds: LOOP
    };
  }

  /* ── MP4 frame state ─────────────────────────────────── */
  // 10 s loop @ 30 fps — same steady-state rule as GIF.
  function mp4FrameState(frame, fps) {
    var LOOP = 10.0;
    var t = frame / fps;
    return {
      msgOpacity:  1,
      msgYOffset:  0,
      ctaPulse:    ctaHeartbeat(t, LOOP),
      t:           t,
      loopSeconds: LOOP
    };
  }

  /* ── Static PNG frame state ──────────────────────────
     Static still — headline fully visible, CTA at rest, smoke at a
     settled mid-loop position.  No loopSeconds → smoke uses continuous
     motion at t=1.33s which is visually equivalent to mid-loop.    */
  function stillFrameState() {
    return {
      msgOpacity: 1,
      msgYOffset: 0,
      ctaPulse:   0,
      t:          1.333
    };
  }

  /* ── PNG: capture single canvas frame ───────────────── */
  function makePNG(state, is916) {
    return new Promise(function (resolve, reject) {
      var oc  = document.createElement('canvas');
      var s   = is916 ? CANVAS.S916 : CANVAS.S11;
      oc.width  = s.w;
      oc.height = s.h;
      var ctx = oc.getContext('2d');

      var fs = stillFrameState();
      CANVAS.renderToCtx(ctx, s, state, 20, fs, is916, true)
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
      var FRAMES = 54;
      var FPS    = 18;
      var DELAY  = Math.round(1000 / FPS); // 56 ms

      if (typeof GIF === 'undefined') {
        reject(new Error('gif.js not loaded'));
        return;
      }

      var gif = new GIF({
        workers:      4,
        quality:      8,          // 1=best, 30=worst; 8 balances size vs. fidelity
        dither:       'FloydSteinberg',
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
          // Slightly longer final-frame delay smooths the loop transition
          var delay = (f === FRAMES - 1) ? 100 : DELAY;
          gif.addFrame(ctx, { copy: true, delay: delay });
          if (onProgress) onProgress(f / FRAMES);
        }
        gif.render();
      })().catch(reject);
    });
  }

  /* ── Video: 10-second 9:16 via MediaRecorder ─────────── */
  function makeVideo(state, onProgress) {
    return new Promise(function (resolve, reject) {
      var FPS          = 30;
      var DURATION     = 10;
      var TOTAL_FRAMES = FPS * DURATION;
      var S            = CANVAS.S916;

      if (!window.MediaRecorder) {
        reject(new Error('MediaRecorder not supported'));
        return;
      }

      // Approach C — prefer native H.264 MP4 MediaRecorder when the browser
      // supports it (Chrome 130+, Safari 17+). No transcoding needed: the
      // output is directly playable on Instagram / TikTok / WhatsApp / iOS.
      // Fall back to webm when MP4 isn't native; ffmpeg.wasm then transcodes
      // the webm to H.264 MP4 (Approach A).
      // videoBitsPerSecond: high bitrate so particle/smoke detail survives
      // compression + any subsequent transcode step.
      var candidateList = [
        { mime: 'video/mp4;codecs=avc1.42E01F', ext: 'mp4',  bps: 6000000 },
        { mime: 'video/mp4;codecs=avc1',        ext: 'mp4',  bps: 6000000 },
        { mime: 'video/mp4',                    ext: 'mp4',  bps: 6000000 },
        { mime: 'video/webm;codecs=vp9',        ext: 'webm', bps: 8000000 },
        { mime: 'video/webm;codecs=vp8',        ext: 'webm', bps: 6000000 },
        { mime: 'video/webm',                   ext: 'webm', bps: 6000000 }
      ];

      var oc  = document.createElement('canvas');
      oc.width  = S.w;
      oc.height = S.h;
      var ctx    = oc.getContext('2d');
      var stream = oc.captureStream(FPS);

      function tryCreateRecorder(opts) {
        try {
          return new MediaRecorder(stream, opts);
        } catch (e) {
          return null;
        }
      }

      var recorder = null;
      var chosenMime = '';
      var chosenExt  = 'webm';

      if (window.MediaRecorder.isTypeSupported) {
        for (var ci = 0; ci < candidateList.length; ci++) {
          if (MediaRecorder.isTypeSupported(candidateList[ci].mime)) {
            recorder = tryCreateRecorder({
              mimeType: candidateList[ci].mime,
              videoBitsPerSecond: candidateList[ci].bps
            });
            if (recorder) {
              chosenMime = candidateList[ci].mime;
              chosenExt  = candidateList[ci].ext;
              break;
            }
            // Fallback if bitrate option is rejected on this codec
            recorder = tryCreateRecorder({ mimeType: candidateList[ci].mime });
            if (recorder) {
              chosenMime = candidateList[ci].mime;
              chosenExt  = candidateList[ci].ext;
              break;
            }
          }
        }
      }

      if (!recorder) {
        recorder = tryCreateRecorder({});
        if (recorder) {
          chosenMime = recorder.mimeType || 'video/webm';
          chosenExt  = chosenMime.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
        }
      }
      if (!recorder) {
        reject(new Error('Failed to create MediaRecorder'));
        return;
      }

      var chunks = [];
      recorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = function () {
        var blob = new Blob(chunks, { type: chosenMime });
        resolve({ blob: blob, ext: chosenExt });
      };
      recorder.onerror = function (e) { reject(e); };

      var frameNum = 0;
      var recording = true;

      function renderNextFrame() {
        if (!recording || frameNum >= TOTAL_FRAMES) {
          recording = false;
          recorder.stop();
          return;
        }

        var fs = mp4FrameState(frameNum, FPS);
        CANVAS.renderToCtx(ctx, S, state, frameNum, fs, true, true)
          .then(function () {
            frameNum++;
            if (onProgress) onProgress(frameNum / TOTAL_FRAMES);
            window.requestAnimationFrame(renderNextFrame);
          })
          .catch(function (err) {
            recording = false;
            recorder.stop();
            reject(err);
          });
      }

      recorder.start();
      renderNextFrame();
    });
  }

  var _ffmpeg = null;
  var _ffmpegLoadPromise = null;

  // ffmpeg.wasm needs SharedArrayBuffer, which is only available when
  // the page is cross-origin-isolated (COOP: same-origin + COEP: require-corp).
  // Log the state on first use so misconfigured headers are easy to diagnose.
  function _sharedArrayBufferAvailable() {
    try { return typeof SharedArrayBuffer !== 'undefined'; }
    catch (e) { return false; }
  }

  function _hasFFmpeg() {
    return (typeof FFmpeg !== 'undefined' && typeof FFmpeg.createFFmpeg === 'function' && typeof FFmpeg.fetchFile === 'function')
      || (typeof FFmpegWASM !== 'undefined' && typeof FFmpegWASM.createFFmpeg === 'function' && typeof FFmpegWASM.fetchFile === 'function');
  }

  function _loadFFmpeg() {
    if (!_sharedArrayBufferAvailable()) {
      console.warn('[ffmpeg] SharedArrayBuffer unavailable — COOP/COEP headers missing. Page is not cross-origin-isolated.');
      return Promise.reject(new Error('SharedArrayBuffer unavailable'));
    }
    if (!_hasFFmpeg()) {
      return Promise.reject(new Error('FFmpeg UMD not loaded'));
    }
    if (_ffmpegLoadPromise) {
      return _ffmpegLoadPromise;
    }
    var ffmpegModule = typeof FFmpeg !== 'undefined' ? FFmpeg : FFmpegWASM;
    // Pin ffmpeg-core to 0.11.0 (matches @ffmpeg/ffmpeg@0.11.6 UMD).
    // unpkg serves with Access-Control-Allow-Origin: * + CORP cross-origin
    // so the core + wasm load cleanly under COEP require-corp.
    _ffmpeg = ffmpegModule.createFFmpeg({
      log: false,
      corePath: 'https://unpkg.com/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js'
    });
    _ffmpegLoadPromise = _ffmpeg.load().catch(function (err) {
      _ffmpegLoadPromise = null;   // allow retry on next call
      throw err;
    });
    return _ffmpegLoadPromise;
  }

  function _reencodeVideoToMP4(blob) {
    if (!_hasFFmpeg()) {
      return Promise.reject(new Error('FFmpeg not loaded'));
    }
    return _loadFFmpeg()
      .then(function () { var ffmpegModule = typeof FFmpeg !== 'undefined' ? FFmpeg : FFmpegWASM; return ffmpegModule.fetchFile(blob); })
      .then(function (inputData) {
        _ffmpeg.FS('writeFile', 'input.webm', inputData);
        // -preset ultrafast: ffmpeg.wasm is compute-bound; this cuts
        //   transcode time ~3× for negligible quality loss at our bitrate.
        // -pix_fmt yuv420p + -movflags +faststart: iOS / Safari / QuickTime
        //   compatibility and web-optimised moov placement.
        return _ffmpeg.run(
          '-fflags', '+genpts',
          '-i', 'input.webm',
          '-an',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          'output.mp4'
        );
      })
      .then(function () {
        var outputData = _ffmpeg.FS('readFile', 'output.mp4');
        try { _ffmpeg.FS('unlink', 'input.webm'); } catch (e) {}
        try { _ffmpeg.FS('unlink', 'output.mp4'); } catch (e) {}
        return new Blob([outputData.buffer], { type: 'video/mp4' });
      });
  }

  /* ── Classic anchor-download helper ──────────────────── */
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
      if (videoResult && videoResult.blob && videoResult.ext) {
        zip.file('banner-9x16.' + videoResult.ext, videoResult.blob);
      }
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
      { name: 'banner-1x1.png',  blob: png11 },
      { name: 'banner-1x1.gif',  blob: gif11 },
      { name: 'banner-9x16.png', blob: png916 }
    ];
    if (videoResult && videoResult.blob && videoResult.ext) {
      files.push({ name: 'banner-9x16.' + videoResult.ext, blob: videoResult.blob });
    }
    return files.reduce(function (chain, f) {
      return chain
        .then(function () { return dir.getFileHandle(f.name, { create: true }); })
        .then(function (fh) { return fh.createWritable(); })
        .then(function (w)  { return w.write(f.blob).then(function () { return w.close(); }); });
    }, Promise.resolve());
  }

  /* ── Generate blobs only (no download, no ZIP) ────────
     Used by the results screen which previews + shares + downloads
     each file individually.  Resolves with:
       { png11, gif11, png916, videoResult: { blob, ext } | null }
                                                                    */
  function generateBlobs(state, onProgress) {
    var step = function (pct, label) {
      if (onProgress) onProgress(pct, label);
    };
    var png11, gif11, png916, videoResult;
    step(0, 'Rendering 1:1 PNG…');
    return makePNG(state, false)
      .then(function (blob) {
        png11 = blob;
        step(5, 'Generating 1:1 GIF (54 frames)…');
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
        })
        .catch(function (err) {
          if (err && /MediaRecorder|not supported|Failed to create MediaRecorder/i.test(err.message || '')) {
            console.warn('[EXPORT] video export unavailable:', err);
            return null;
          }
          throw err;
        })
        .then(function (result) {
          if (!result || !result.blob) return null;

          // Approach C — MediaRecorder already produced native H.264 MP4.
          // No transcode needed; the file plays on iOS / Instagram / TikTok.
          if (result.ext === 'mp4') return result;

          // Approach A — webm → transcode to H.264 MP4 via ffmpeg.wasm.
          // If transcode fails we return null; app.js shows an error state
          // on the video card rather than handing the user an unplayable
          // .webm file labelled as MP4.
          step(94, 'Re-encoding video to MP4…');
          return _reencodeVideoToMP4(result.blob)
            .then(function (mp4Blob) { return { blob: mp4Blob, ext: 'mp4' }; })
            .catch(function (err) {
              console.warn('[EXPORT] ffmpeg transcode failed — video will be shown as error:', err);
              return null;
            });
        });
      })
      .then(function (result) {
        videoResult = result;
        step(100, 'Done!');
        return { png11: png11, gif11: gif11, png916: png916, videoResult: videoResult };
      });
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
        step(5, 'Generating 1:1 GIF (54 frames)…');
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
        })
        .catch(function (err) {
          if (err && /MediaRecorder|not supported|Failed to create MediaRecorder/i.test(err.message || '')) {
            console.warn('[EXPORT] video export unavailable:', err);
            return null;
          }
          throw err;
        })
        .then(function (result) {
          if (!result || !result.blob) return null;
          // Native MP4 — use directly.
          if (result.ext === 'mp4') return result;
          // Webm — transcode; on failure return null (no webm fallback).
          step(94, 'Re-encoding video to MP4…');
          return _reencodeVideoToMP4(result.blob)
            .then(function (mp4Blob) { return { blob: mp4Blob, ext: 'mp4' }; })
            .catch(function (err) {
              console.warn('[EXPORT] ffmpeg transcode failed:', err);
              return null;
            });
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
                videoExt:   videoResult ? videoResult.ext : null,
                png11Size:  (png11.size  / 1024).toFixed(0),
                gif11Size:  (gif11.size  / 1024).toFixed(0),
                png916Size: (png916.size / 1024).toFixed(0),
                vidSize:    videoResult ? (videoResult.blob.size / 1024).toFixed(0) : '0',
                savedAs:    'folder'
              });
            })
            .catch(function (err) {
              console.warn('[EXPORT] folder write failed, falling back to ZIP', err);
              step(95, 'Packaging ZIP…');
              return makeZip(png11, gif11, png916, videoResult)
                .then(function (zipBlob) {
                  var zipName = (filename && filename.trim())
                    ? filename.trim() + '.zip'
                    : 'recruitment-banners.zip';

                  var complete = function () {
                    step(100, 'Done!');
                    if (onComplete) onComplete({
                      videoExt:   videoResult ? videoResult.ext : null,
                      png11Size:  (png11.size  / 1024).toFixed(0),
                      gif11Size:  (gif11.size  / 1024).toFixed(0),
                      png916Size: (png916.size / 1024).toFixed(0),
                      vidSize:    videoResult ? (videoResult.blob.size / 1024).toFixed(0) : '0',
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
                videoExt:   videoResult ? videoResult.ext : null,
                png11Size:  (png11.size  / 1024).toFixed(0),
                gif11Size:  (gif11.size  / 1024).toFixed(0),
                png916Size: (png916.size / 1024).toFixed(0),
                vidSize:    videoResult ? (videoResult.blob.size / 1024).toFixed(0) : '0',
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
    generatePackage:  generatePackage,
    generateBlobs:    generateBlobs,
    makeZip:          makeZip,
    downloadBlob:     _fallbackDownload
  };

})();
