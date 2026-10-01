/**
 * DataMatrix camera / image / string decode helpers (ZXing UMD global `ZXing`).
 */

function assertZXing() {
  if (typeof ZXing === "undefined") {
    throw new Error("ZXing DataMatrix-Bibliothek nicht geladen.");
  }
}

function createHints() {
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [ZXing.BarcodeFormat.DATA_MATRIX]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  return hints;
}

/**
 * Low-level decode from luminance / canvas pixels.
 * @param {HTMLCanvasElement} canvas
 * @returns {string}
 */
function decodeCanvasSync(canvas) {
  assertZXing();
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  if (!width || !height) throw new Error("Leeres Bild");
  const imageData = ctx.getImageData(0, 0, width, height);
  const luminances = new Uint8ClampedArray(width * height);
  const data = imageData.data;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    luminances[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  const source = new ZXing.RGBLuminanceSource(luminances, width, height);
  const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(createHints());
  const result = reader.decode(bitmap);
  return String(result.getText()).trim();
}

function elementToCanvas(element, maxWidth = 0) {
  const canvas = document.createElement("canvas");
  let w;
  let h;
  if (element instanceof HTMLVideoElement) {
    w = element.videoWidth;
    h = element.videoHeight;
  } else if (element instanceof HTMLCanvasElement) {
    if (!maxWidth || element.width <= maxWidth) return element;
    w = element.width;
    h = element.height;
  } else {
    w = element.naturalWidth || element.width;
    h = element.naturalHeight || element.height;
  }
  if (!w || !h) {
    canvas.width = 0;
    canvas.height = 0;
    return canvas;
  }
  if (maxWidth > 0 && w > maxWidth) {
    const scale = maxWidth / w;
    h = Math.max(1, Math.round(h * scale));
    w = maxWidth;
  }
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(element, 0, 0, w, h);
  return canvas;
}


/**
 * Crop live video to match the on-screen reticle.
 * @param {HTMLVideoElement} video
 * @param {{shape?: 'square'|'barcode', cropFraction?: number, widthFraction?: number, heightFraction?: number, outW?: number, outH?: number}} [opts]
 * @returns {HTMLCanvasElement}
 */
function videoRegionToCanvas(video, opts = {}) {
  const shape = opts.shape === "barcode" ? "barcode" : "square";
  const vw = video.videoWidth | 0;
  const vh = video.videoHeight | 0;
  const canvas = document.createElement("canvas");
  if (!vw || !vh) {
    canvas.width = 0;
    canvas.height = 0;
    return canvas;
  }
  const short = Math.min(vw, vh);
  let sx;
  let sy;
  let sw;
  let sh;
  let outW;
  let outH;
  if (shape === "barcode") {
    const widthFraction = opts.widthFraction ?? 0.76;
    const heightFraction = opts.heightFraction ?? 0.24;
    sw = Math.max(64, Math.floor(short * widthFraction));
    sh = Math.max(24, Math.floor(short * heightFraction));
    sx = Math.floor((vw - sw) / 2);
    sy = Math.floor((vh - sh) / 2);
    outW = opts.outW ?? 640;
    outH = opts.outH ?? 200;
  } else {
    const cropFraction = opts.cropFraction ?? 0.26;
    const side = Math.max(32, Math.floor(short * cropFraction));
    sw = side;
    sh = side;
    sx = Math.floor((vw - side) / 2);
    sy = Math.floor((vh - side) / 2);
    outW = opts.outW ?? 512;
    outH = opts.outH ?? 512;
  }
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
  return canvas;
}

/** @deprecated alias */
function videoCenterCropToCanvas(video, opts = {}) {
  return videoRegionToCanvas(video, { shape: "square", cropFraction: opts.cropFraction, outW: opts.outSize, outH: opts.outSize });
}

function resolveScanMode(opts) {
  try {
    if (typeof opts.getMode === "function") {
      const m = opts.getMode();
      if (m === "barcode" || m === "datamatrix") return m;
    }
  } catch (_) {}
  return opts.mode === "barcode" ? "barcode" : "datamatrix";
}

/** Try decode on one or more reticle-aligned crops. */
function decodeVideoCropsSync(video, decodeFn, spec) {
  const shape = spec && spec.shape === "barcode" ? "barcode" : "square";
  if (shape === "barcode") {
    const bands = (spec && spec.bands) || [
      { widthFraction: 0.72, heightFraction: 0.2 },
      { widthFraction: 0.8, heightFraction: 0.26 },
    ];
    for (const band of bands) {
      try {
        const canvas = videoRegionToCanvas(video, { shape: "barcode", ...band });
        const text = decodeFn(canvas);
        if (text) return text;
      } catch (_) {}
    }
    return "";
  }
  const cropFractions = (spec && spec.cropFractions) || [0.24, 0.32];
  for (const frac of cropFractions) {
    try {
      const canvas = videoRegionToCanvas(video, { shape: "square", cropFraction: frac });
      const text = decodeFn(canvas);
      if (text) return text;
    } catch (_) {}
  }
  return "";
}

/** Yield to the browser so Stop/Schließen clicks can run (iOS main-thread). */
function yieldToMain() {
  return new Promise((r) => setTimeout(r, 0));
}

/**
 * Decode DataMatrix from an HTMLImageElement / HTMLCanvasElement / HTMLVideoElement.
 * @param {HTMLImageElement|HTMLCanvasElement|HTMLVideoElement} element
 * @returns {Promise<string>}
 */
export async function decodeDataMatrixFromElement(element) {
  assertZXing();
  // Prefer BrowserDatamatrixCodeReader for images with URL
  try {
    if (element instanceof HTMLImageElement && element.src) {
      const reader = new ZXing.BrowserDatamatrixCodeReader();
      const result = await reader.decodeFromImageElement(element);
      const text = String(result.getText?.() ?? result.text ?? "").trim();
      if (text) return text;
    }
  } catch (_) {
    /* fall through to canvas path */
  }
  return decodeCanvasSync(elementToCanvas(element));
}

/**
 * Decode from an image File / Blob (PNG/JPEG).
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function decodeDataMatrixFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return await decodeDataMatrixFromElement(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
    img.src = src;
  });
}

/**
 * Continuous video decode until first hit or abort.
 * @param {HTMLVideoElement} video
 * @param {{signal?: AbortSignal, intervalMs?: number}} [opts]
 * @returns {Promise<string>}
 */
export async function scanDataMatrixFromVideo(video, opts = {}) {
  assertZXing();
  const intervalMs = opts.intervalMs ?? 280;
  const signal = opts.signal;
  const maxWidth = opts.maxWidth ?? 640;

  return new Promise((resolve, reject) => {
    let timer = 0;
    let stopped = false;
    let running = false;

    const cleanup = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Abgebrochen", "AbortError"));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort);
    }

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(tick, intervalMs);
    };

    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try {
        if (signal?.aborted) {
          onAbort();
          return;
        }
        if (video.readyState >= 2 && video.videoWidth > 0) {
          // Yield before sync decode so UI events (Stop) can run.
          await yieldToMain();
          if (stopped || signal?.aborted) {
            onAbort();
            return;
          }
          try {
            const mode = resolveScanMode(opts);
            const text =
              mode === "barcode"
                ? decodeVideoCropsSync(video, decodeCanvasFieldSync, { shape: "barcode" })
                : decodeVideoCropsSync(video, decodeCanvasSync, {
                    shape: "square",
                    cropFractions: opts.cropFractions || [0.24, 0.32],
                  });
            if (stopped || signal?.aborted) {
              onAbort();
              return;
            }
            if (text) {
              cleanup();
              resolve(text);
              return;
            }
          } catch (_) {
            /* keep scanning */
          }
          if (stopped || signal?.aborted) {
            onAbort();
            return;
          }
        }
      } finally {
        running = false;
      }
      if (!stopped) schedule();
    };

    tick();
  });
}

/**
 * Start rear-facing camera into a video element.
 * @param {HTMLVideoElement} video
 * @returns {Promise<MediaStream>}
 */
/** Streams we opened — stop tracks on release (iOS-safe, no removeTrack / no playsInline prop). */
const liveStreams = new Set();

function stopStreamTracks(stream) {
  if (!stream || typeof stream.getTracks !== 'function') return;
  try {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (_) {}
    });
  } catch (_) {}
  try {
    liveStreams.delete(stream);
  } catch (_) {}
}

/**
 * Start rear-facing camera into a video element.
 * @param {HTMLVideoElement} video
 * @returns {Promise<MediaStream>}
 */
export async function startCamera(video) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Kamera nicht verfügbar (getUserMedia fehlt).');
  }
  // Soft release first (no DOM replace — that path caused iOS TypeErrors).
  releaseAllCameras();

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1280 },
      height: { ideal: 720 },
    },
  };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (_) {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
  }
  liveStreams.add(stream);

  const el =
    (video && video.isConnected && video) ||
    (typeof document !== 'undefined' ? document.getElementById((video && video.id) || 'scan-video') : null);

  if (el) {
    // Only setAttribute for playsinline/muted — never assign .playsInline / .muted (readonly on iOS).
    try {
      el.setAttribute('playsinline', 'true');
      el.setAttribute('webkit-playsinline', 'true');
      el.setAttribute('muted', '');
    } catch (_) {}
    try {
      el.srcObject = stream;
    } catch (err) {
      stopStreamTracks(stream);
      throw err;
    }
    try {
      await el.play();
    } catch (_) {
      /* autoplay quirks — stream still usable once user gesture continues */
    }
  }
  return stream;
}

/**
 * @param {MediaStream|null} stream
 * @param {HTMLVideoElement} [video]
 */
export function stopCamera(stream, video) {
  stopStreamTracks(stream);
  if (!video) return;
  try {
    video.pause();
  } catch (_) {}
  try {
    const vs = video.srcObject;
    if (vs && vs !== stream) stopStreamTracks(vs);
  } catch (_) {}
  try {
    video.srcObject = null;
  } catch (_) {}
}

/**
 * Stop every tracked stream and clear both known video elements.
 */
export function releaseAllCameras() {
  for (const stream of [...liveStreams]) {
    stopStreamTracks(stream);
  }
  liveStreams.clear();
  if (typeof document === 'undefined') return;
  for (const id of ['scan-video', 'field-scan-video']) {
    const video = document.getElementById(id);
    if (!video) continue;
    try {
      const vs = video.srcObject;
      stopStreamTracks(vs);
    } catch (_) {}
    try {
      video.pause();
    } catch (_) {}
    try {
      video.srcObject = null;
    } catch (_) {}
  }
}

/**
 * Async release with a short delay so iOS can drop the status-bar camera pill.
 */
export async function releaseAllCamerasAsync(delayMs = 200) {
  releaseAllCameras();
  await new Promise((r) => setTimeout(r, delayMs));
  releaseAllCameras();
}

/** Formats for field scan_or_manual: DataMatrix + common 1D. */
function createFieldScanHints() {
  const hints = new Map();
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.DATA_MATRIX,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.ITF,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.QR_CODE,
  ]);
  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
  return hints;
}

function decodeCanvasFieldSync(canvas) {
  assertZXing();
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const { width, height } = canvas;
  if (!width || !height) throw new Error("Leeres Bild");
  const imageData = ctx.getImageData(0, 0, width, height);
  const luminances = new Uint8ClampedArray(width * height);
  const data = imageData.data;
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    luminances[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  const source = new ZXing.RGBLuminanceSource(luminances, width, height);
  const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(createFieldScanHints());
  const result = reader.decode(bitmap);
  return String(result.getText()).trim();
}

export async function decodeBarcodeFromElement(element) {
  assertZXing();
  try {
    return decodeCanvasFieldSync(elementToCanvas(element));
  } catch (_) {
    return decodeDataMatrixFromElement(element);
  }
}

export async function decodeBarcodeFromBlob(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return await decodeBarcodeFromElement(img);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function scanBarcodeFromVideo(video, opts = {}) {
  assertZXing();
  const intervalMs = opts.intervalMs ?? 280;
  const signal = opts.signal;
  const maxWidth = opts.maxWidth ?? 640;

  return new Promise((resolve, reject) => {
    let timer = 0;
    let stopped = false;
    let running = false;

    const cleanup = () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Abgebrochen", "AbortError"));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort);
    }

    const schedule = () => {
      if (stopped) return;
      timer = setTimeout(tick, intervalMs);
    };

    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try {
        if (signal?.aborted) {
          onAbort();
          return;
        }
        if (video.readyState >= 2 && video.videoWidth > 0) {
          // Yield before sync decode so UI events (Stop/Schließen) can run.
          await yieldToMain();
          if (stopped || signal?.aborted) {
            onAbort();
            return;
          }
          try {
            const mode = resolveScanMode(opts);
            const text =
              mode === "datamatrix"
                ? decodeVideoCropsSync(video, decodeCanvasSync, {
                    shape: "square",
                    cropFractions: opts.cropFractions || [0.24, 0.32],
                  })
                : decodeVideoCropsSync(video, decodeCanvasFieldSync, { shape: "barcode" });
            if (stopped || signal?.aborted) {
              onAbort();
              return;
            }
            if (text) {
              cleanup();
              resolve(text);
              return;
            }
          } catch (_) {
            /* keep scanning */
          }
          if (stopped || signal?.aborted) {
            onAbort();
            return;
          }
        }
      } finally {
        running = false;
      }
      if (!stopped) schedule();
    };

    tick();
  });
}
