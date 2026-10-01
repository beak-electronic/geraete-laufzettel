import { extractSerialFromPayload, isUsableSerial } from "./sn.js";
import {
  decodeDataMatrixFromBlob,
  decodeDataMatrixFromElement,
  scanDataMatrixFromVideo,
  startCamera,
  stopCamera,
  releaseAllCameras,
  releaseAllCamerasAsync,
} from "./scan.js";
import {
  findPdfBySerial,
  pickPdfFolder,
  getPdfFolderHandle,
  clearPdfFolderHandle,
  supportsDirectoryPicker,
  reindexPdfFolder,
  getFolderIndexInfo,
  mergePdfsFromFileList,
  getIdbCatalogStats,
  clearIdbCatalog,
  formatCatalogUpdated,
} from "./catalog.js";
import { initFill, openFile, pickAndOpen } from "./fill.js";
import { KNOWN_TEMPLATES } from "./fields.js";

const STORAGE_KEY = "geraete-laufzettel-settings-v1";
const DEMO_PAYLOAD = "DE-200.433-PA180DM-SPEKTRA-V1-BS0180E01A21K0103";
const SAMPLE_DM_URL = "./samples/datamatrix-demo.png";

const $ = (sel) => document.querySelector(sel);

const DEFAULT_SETTINGS = {
  saveMode: "auto",
  /** When true (default), iPad path shows refresh banner on cold start. */
  autoRefreshPrompt: true,
};

const state = {
  settings: { ...DEFAULT_SETTINGS },
  cameraStream: null,
  scanAbort: null,
  scanning: false,
  lastPayload: "",
  lastSerial: "",
  /** Session-only: banner dismissed this cold start */
  bannerDismissed: false,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) Object.assign(state.settings, DEFAULT_SETTINGS, JSON.parse(raw));
  } catch (_) {}
  if (!state.settings.saveMode) state.settings.saveMode = "auto";
  if (typeof state.settings.autoRefreshPrompt !== "boolean") {
    state.settings.autoRefreshPrompt = true;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
  } catch (_) {}
}

function setStatus(text, kind = "") {
  const el = $("#status");
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}

function showToast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add("hidden"), 3600);
}


function showScanView() {
  const home = $("#home");
  const scan = $("#scan-view");
  home?.classList.add("hidden");
  scan?.classList.remove("hidden");
  document.body.classList.add("scan-open");
  document.body.classList.remove("fill-open");
  setStatus("Bereit – DataMatrix scannen");
}

async function showHomeFromScan() {
  await stopScanning({ silent: true });
  try {
    releaseAllCameras();
  } catch (_) {}
  const home = $("#home");
  const scan = $("#scan-view");
  scan?.classList.add("hidden");
  home?.classList.remove("hidden");
  document.body.classList.remove("scan-open");
}

function setScanUi(active) {
  const panel = $("#scan-panel");
  const btnStart = $("#btn-scan-start");
  const btnStop = $("#btn-scan-stop");
  panel?.classList.toggle("hidden", !active);
  btnStart?.classList.toggle("hidden", active);
  btnStop?.classList.toggle("hidden", !active);
  if (active) applyHomeScanMode(getHomeScanMode());
}

const SCAN_MODE_KEY = "gl.scanFrameMode";

function getHomeScanMode() {
  try {
    const v = localStorage.getItem(SCAN_MODE_KEY);
    if (v === "barcode" || v === "datamatrix") return v;
  } catch (_) {}
  return "datamatrix";
}

function applyHomeScanMode(mode) {
  const m = mode === "barcode" ? "barcode" : "datamatrix";
  try {
    localStorage.setItem(SCAN_MODE_KEY, m);
  } catch (_) {}
  const reticle = $("#scan-panel .scan-reticle");
  if (reticle) reticle.setAttribute("data-mode", m);
  document.querySelectorAll("#scan-panel .scan-mode-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.getAttribute("data-scan-mode") === m);
  });
  const hint = $("#scan-mode-hint");
  if (hint) {
    hint.textContent =
      m === "barcode"
        ? "Länglichen Barcode in den Rahmen halten."
        : "Kleinen DataMatrix-Code in den Rahmen halten.";
  }
  setStatus(
    m === "barcode" ? "Barcode in den Rahmen halten…" : "DataMatrix in den Rahmen halten…",
    "busy"
  );
}


async function stopScanning({ silent = false } = {}) {
  const ac = state.scanAbort;
  state.scanAbort = null;
  if (ac) {
    try {
      ac.abort();
    } catch (_) {}
  }
  const video = $("#scan-video");
  const stream = state.cameraStream;
  state.cameraStream = null;
  state.scanning = false;
  try {
    stopCamera(stream, video);
  } catch (_) {}
  try {
    releaseAllCameras();
  } catch (_) {}
  setScanUi(false);
  if (!silent) {
    /* status left to caller */
  }
}

/** Public: ensure home + field cameras are fully released (after save / close / open PDF). */
export async function ensureCamerasReleased() {
  await stopScanning({ silent: true });
  try {
    await releaseAllCamerasAsync(250);
  } catch (_) {
    try {
      releaseAllCameras();
    } catch (_) {}
  }
}

async function startScanning() {
  let video = $("#scan-video");
  if (!video) return;

  // Always release leftovers first (iOS keeps the red camera pill otherwise).
  await stopScanning({ silent: true });
  // Brief yield so iOS can drop the previous capture session before getUserMedia.
  await new Promise((r) => setTimeout(r, 120));

  try {
    setStatus("Kamera wird gestartet…", "busy");
    state.cameraStream = await startCamera(video);
    video = $("#scan-video") || video;
    state.scanning = true;
    setScanUi(true);
    applyHomeScanMode(getHomeScanMode());

    const ac = new AbortController();
    state.scanAbort = ac;
    const payload = await scanDataMatrixFromVideo(video, {
      signal: ac.signal,
      getMode: () => getHomeScanMode(),
    });
    // Stop decode loop + kill tracks BEFORE opening the PDF (iOS red camera pill).
    await stopScanning({ silent: true });
    await releaseAllCamerasAsync(300);
    setStatus("Code erkannt…", "ok");
    await handlePayload(payload, "Kamera");
    // One more pass after UI switched to fill mode
    await releaseAllCamerasAsync(100);
  } catch (err) {
    await stopScanning({ silent: true });
    releaseAllCameras();
    if (err && err.name === "AbortError") {
      setStatus("Scan abgebrochen");
      return;
    }
    console.error(err);
    const msg = err?.message || String(err);
    setStatus("Kamerafehler", "error");
    const busy =
      /NotReadable|TrackStart|Device in use|could not start|AbortError/i.test(msg) ||
      err?.name === "NotReadableError";
    const readonlyish = /readonly property|Assignment to constant/i.test(msg);
    showToast(
      busy
        ? "Kamera noch belegt — bitte einen Moment warten und erneut „Kamera starten“ tippen."
        : msg.includes("getUserMedia") || msg.includes("Permission") || err?.name === "NotAllowedError"
          ? "Kamerazugriff verweigert oder nicht verfügbar."
          : readonlyish
            ? "Kamera-Start fehlgeschlagen (iOS). Bitte Seite neu laden und erneut versuchen."
            : msg
    );
  }
}

function updateResultPreview(payload, sn) {
  const payloadEl = $("#result-payload");
  const snEl = $("#result-serial");
  if (payloadEl) payloadEl.textContent = payload || "—";
  if (snEl) snEl.textContent = sn || "—";
  $("#result-box")?.classList.toggle("hidden", !sn);
}

async function openMatchedOrOfferPicker(sn) {
  if (!isUsableSerial(sn)) {
    setStatus("Seriennummer fehlt oder ungültig", "error");
    return false;
  }
  setStatus(`Suche Laufzettel für ${sn}…`, "busy");
  const hit = await findPdfBySerial(sn);
  if (hit) {
    await ensureCamerasReleased();
    await openFile(hit.file, hit.fileHandle);
    setStatus(`Geöffnet: ${hit.file.name}`, "ok");
    showToast(`Laufzettel ${sn} geöffnet`);
    return true;
  }

  setStatus("Kein passendes PDF gefunden", "error");
  const box = $("#not-found-box");
  const snSpan = $("#not-found-sn");
  if (snSpan) snSpan.textContent = sn;
  box?.classList.remove("hidden");
  showToast(`Keine Datei „${sn}.pdf“ gefunden. Bitte manuell öffnen oder PDFs aktualisieren.`);
  return false;
}

async function handlePayload(payload, source = "") {
  const text = String(payload || "").trim();
  if (!text) {
    showToast("Leerer Code");
    return;
  }
  const sn = extractSerialFromPayload(text);
  state.lastPayload = text;
  state.lastSerial = sn;
  updateResultPreview(text, sn);
  $("#not-found-box")?.classList.add("hidden");

  if (!isUsableSerial(sn)) {
    setStatus("Seriennummer nicht erkannt", "error");
    showToast("Keine gültige Seriennummer nach dem letzten „-“ gefunden.");
    return;
  }

  setStatus(`SN ${sn}${source ? ` (${source})` : ""}`, "ok");
  await openMatchedOrOfferPicker(sn);
}

async function onPasteSubmit() {
  const input = $("#code-input");
  const text = input?.value.trim() || "";
  if (!text || text === "—" || text === "-" || text === "–") {
    showToast("Bitte Code oder Seriennummer einfügen");
    return;
  }
  await handlePayload(text, "Eingabe");
}

async function onLoadSampleImage() {
  try {
    setStatus("Beispiel-DataMatrix wird gelesen…", "busy");
    const img = $("#sample-dm-img");
    let payload;
    if (img && img.complete && img.naturalWidth) {
      payload = await decodeDataMatrixFromElement(img);
    } else {
      const res = await fetch(SAMPLE_DM_URL);
      if (!res.ok) throw new Error("Beispielbild nicht gefunden");
      payload = await decodeDataMatrixFromBlob(await res.blob());
    }
    await handlePayload(payload, "Beispielbild");
  } catch (err) {
    console.error(err);
    setStatus("Decode fehlgeschlagen", "error");
    showToast(err?.message || "DataMatrix konnte nicht gelesen werden.");
  }
}

async function onPickImageFile(file) {
  if (!file) return;
  try {
    setStatus("Bild wird gelesen…", "busy");
    const payload = await decodeDataMatrixFromBlob(file);
    await handlePayload(payload, "Bild");
  } catch (err) {
    console.error(err);
    setStatus("Decode fehlgeschlagen", "error");
    showToast("Kein DataMatrix-Code im Bild erkannt.");
  }
}

function triggerPdfCatalogPick() {
  const input = $("#pdf-catalog-input");
  if (!input) return;
  input.value = "";
  input.click();
}

async function onPdfCatalogFilesSelected() {
  const input = $("#pdf-catalog-input");
  const files = input?.files;
  if (!files || !files.length) return;
  try {
    setStatus("PDFs werden gespeichert…", "busy");
    const result = await mergePdfsFromFileList(files);
    input.value = "";
    hideRefreshBanner();
    await refreshCatalogUi();
    setStatus(`${result.imported} PDF(s) übernommen · Katalog: ${result.total}`, "ok");
    showToast(
      result.imported
        ? `${result.imported} PDF(s) aktualisiert (gesamt ${result.total})`
        : "Keine PDF-Dateien gewählt"
    );
  } catch (err) {
    console.error(err);
    setStatus("PDF-Import fehlgeschlagen", "error");
    showToast(err?.message || "PDFs konnten nicht gespeichert werden.");
  }
}

function showRefreshBanner() {
  const banner = $("#pdf-refresh-banner");
  if (!banner || state.bannerDismissed) return;
  banner.classList.remove("hidden");
}

function hideRefreshBanner() {
  $("#pdf-refresh-banner")?.classList.add("hidden");
}

function dismissRefreshBanner() {
  state.bannerDismissed = true;
  hideRefreshBanner();
}

async function refreshCatalogUi() {
  await refreshFolderLabel();
  await refreshIdbLabel();
  syncCatalogPlatformUi();
}

function syncCatalogPlatformUi() {
  const hasDir = supportsDirectoryPicker();
  const folderBlock = $("#settings-folder-block");
  const idbBlock = $("#settings-idb-block");
  const pickBtn = $("#btn-pick-folder");
  const clearBtn = $("#btn-clear-folder");

  if (folderBlock) {
    folderBlock.classList.toggle("is-unsupported", !hasDir);
  }
  if (pickBtn) {
    pickBtn.disabled = !hasDir;
    pickBtn.title = hasDir
      ? "Ordner mit Seriennummer.pdf wählen"
      : "In diesem Browser nicht verfügbar (z. B. iPad Safari)";
  }
  if (clearBtn) {
    clearBtn.disabled = !hasDir;
  }

  // On iPad path, keep IDB block prominent; on desktop show both
  if (idbBlock) {
    idbBlock.classList.toggle("is-primary", !hasDir);
  }
}

async function refreshFolderLabel() {
  const el = $("#settings-folder-label");
  if (!el) return;
  if (!supportsDirectoryPicker()) {
    el.textContent =
      "Ordnerwahl nicht verfügbar in diesem Browser. Bitte PDFs aus Dateien aktualisieren.";
    return;
  }
  const handle = await getPdfFolderHandle();
  const info = getFolderIndexInfo();
  if (handle?.name) {
    const countPart =
      info.folderName === handle.name && info.count >= 0
        ? ` · ${info.count} PDF(s) beim Start eingelesen`
        : "";
    el.textContent = `Aktueller Ordner: ${handle.name}${countPart}`;
  } else {
    el.textContent = "Kein Ordner gewählt (nur samples/ + ggf. Katalog).";
  }
}

async function refreshIdbLabel() {
  const el = $("#settings-idb-label");
  if (!el) return;
  const stats = await getIdbCatalogStats();
  if (!stats.count) {
    el.textContent = "Keine PDFs im Katalog gespeichert.";
    return;
  }
  const when = formatCatalogUpdated(stats.lastUpdated);
  el.textContent = `${stats.count} PDF(s) gespeichert · zuletzt aktualisiert: ${when}`;
}

function syncSettingsForm() {
  const saveMode = $("#settings-save-mode");
  if (saveMode) saveMode.value = state.settings.saveMode || "auto";
  const autoPrompt = $("#settings-auto-refresh-prompt");
  if (autoPrompt) autoPrompt.checked = state.settings.autoRefreshPrompt !== false;
  refreshCatalogUi();
}

function readSettingsFromForm() {
  const saveMode = $("#settings-save-mode");
  if (saveMode) state.settings.saveMode = saveMode.value || "auto";
  const autoPrompt = $("#settings-auto-refresh-prompt");
  if (autoPrompt) state.settings.autoRefreshPrompt = !!autoPrompt.checked;
}


function renderFieldTemplatesList() {
  const ul =
    document.getElementById("settings-field-templates-list") ||
    $("#settings-field-templates-list");
  if (!ul) {
    console.warn("Feldvorlagen-Liste nicht gefunden");
    return;
  }
  const list = Array.isArray(KNOWN_TEMPLATES) ? [...KNOWN_TEMPLATES] : [];
  list.sort((a, b) => String(a.id || "").localeCompare(String(b.id || ""), "de", { numeric: true }));
  try {
    ul.replaceChildren();
  } catch (_) {
    ul.innerHTML = "";
  }
  if (!list.length) {
    const li = document.createElement("li");
    li.className = "tmpl-empty";
    li.textContent = "Keine Feldvorlagen hinterlegt.";
    ul.appendChild(li);
    return;
  }
  for (const t of list) {
    const li = document.createElement("li");
    const id = document.createElement("span");
    id.className = "tmpl-id";
    id.textContent = t.id || "";
    li.appendChild(id);
    const label = String(t.label || "").trim();
    if (label && label !== t.id) {
      const lab = document.createElement("span");
      lab.className = "tmpl-label";
      lab.textContent = label;
      li.appendChild(lab);
    }
    ul.appendChild(li);
  }
}

function openSettings() {
  const dlg = $("#home-settings-dialog");
  syncSettingsForm();
  renderFieldTemplatesList();
  if (typeof dlg.showModal === "function") dlg.showModal();
  else dlg.setAttribute("open", "");
}

function closeSettings() {
  const dlg = $("#home-settings-dialog");
  readSettingsFromForm();
  saveSettings();
  if (typeof dlg.close === "function") dlg.close();
  else dlg.removeAttribute("open");
  // If user turned auto-prompt back on, banner may show again next cold start only
}

function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((err) => {
      console.warn("SW register failed", err);
    });
  });
}

function syncThemeChrome() {
  const dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const color = dark ? "#1c1c1e" : "#ffffff";
  let live = document.querySelector('meta[name="theme-color"]:not([media])');
  if (!live) {
    live = document.createElement("meta");
    live.name = "theme-color";
    document.head.insertBefore(live, document.head.firstChild);
  }
  live.setAttribute("content", color);
  for (const m of document.querySelectorAll('meta[name="theme-color"][media]')) {
    if (m.media.includes("dark") && dark) m.setAttribute("content", color);
    if (m.media.includes("light") && !dark) m.setAttribute("content", color);
  }
}

/**
 * Desktop: request permission + re-index folder into memory map.
 * iPad: show non-modal banner CTA to refresh from Files into IndexedDB.
 */
async function startupCatalogRefresh() {
  syncCatalogPlatformUi();

  if (supportsDirectoryPicker()) {
    const handle = await getPdfFolderHandle();
    if (!handle) {
      await refreshCatalogUi();
      return;
    }
    setStatus("PDF-Ordner wird neu eingelesen…", "busy");
    const result = await reindexPdfFolder();
    await refreshCatalogUi();
    if (result.ok) {
      setStatus(
        result.count
          ? `Ordner „${result.folderName || handle.name}“: ${result.count} PDF(s) eingelesen`
          : `Ordner „${result.folderName || handle.name}“: keine PDFs gefunden`,
        "ok"
      );
    } else if (result.reason === "permission") {
      setStatus("PDF-Ordner: Zugriff verweigert", "error");
      showToast("Ordnerzugriff nicht erteilt — in den Einstellungen erneut wählen.");
    } else {
      setStatus("Bereit – DataMatrix scannen");
    }
    return;
  }

  // iPad / no directory picker
  const stats = await getIdbCatalogStats();
  await refreshCatalogUi();
  const wantPrompt = state.settings.autoRefreshPrompt !== false;
  if (wantPrompt) {
    showRefreshBanner();
    if (stats.count > 0) {
      setStatus(`Katalog: ${stats.count} PDF(s) · ggf. aktualisieren`, "ok");
    } else {
      setStatus("Bereit – PDFs aus Dateien aktualisieren oder scannen");
    }
  } else {
    setStatus(
      stats.count
        ? `Bereit · Katalog: ${stats.count} PDF(s)`
        : "Bereit – DataMatrix scannen"
    );
  }
}

function wireUi() {
  $("#btn-go-scan")?.addEventListener("click", () => showScanView());
  $("#btn-scan-back")?.addEventListener("click", () => {
    showHomeFromScan().catch(() => {});
  });
  $("#btn-scan-start")?.addEventListener("click", () => startScanning());
  document.querySelectorAll("#scan-panel .scan-mode-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      applyHomeScanMode(btn.getAttribute("data-scan-mode") || "datamatrix");
    });
  });
  applyHomeScanMode(getHomeScanMode());
  $("#btn-scan-stop")?.addEventListener("click", () => stopScanning());
  $("#btn-send")?.addEventListener("click", () => onPasteSubmit());
  $("#code-input")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onPasteSubmit();
    }
  });
  $("#btn-home-settings")?.addEventListener("click", openSettings);
  renderFieldTemplatesList(); // home settings overview
  $("#btn-home-settings-done")?.addEventListener("click", (e) => {
    e.preventDefault();
    closeSettings();
  });
  $("#home-settings-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    closeSettings();
  });
  $("#btn-demo-paste")?.addEventListener("click", (e) => {
    e.preventDefault();
    const input = $("#code-input");
    if (input) {
      input.value = DEMO_PAYLOAD;
      input.focus();
    }
  });
  $("#btn-sample-dm")?.addEventListener("click", () => onLoadSampleImage());
  $("#btn-pick-image")?.addEventListener("click", () => $("#image-input")?.click());
  $("#image-input")?.addEventListener("change", () => {
    const file = $("#image-input").files?.[0];
    $("#image-input").value = "";
    if (file) onPickImageFile(file);
  });
  $("#btn-not-found-open")?.addEventListener("click", (e) => {
    e.preventDefault();
    pickAndOpen();
  });
  $("#btn-pick-folder")?.addEventListener("click", async () => {
    try {
      const handle = await pickPdfFolder();
      const info = getFolderIndexInfo();
      showToast(`Ordner „${handle.name}“ · ${info.count} PDF(s) eingelesen`);
      await refreshCatalogUi();
    } catch (err) {
      if (err && err.name === "AbortError") return;
      showToast(err?.message || "Ordner konnte nicht gewählt werden");
    }
  });
  $("#btn-clear-folder")?.addEventListener("click", async () => {
    await clearPdfFolderHandle();
    await refreshCatalogUi();
    showToast("Ordnerzuordnung entfernt");
  });
  $("#btn-refresh-pdfs")?.addEventListener("click", () => triggerPdfCatalogPick());
  $("#btn-banner-refresh-pdfs")?.addEventListener("click", () => triggerPdfCatalogPick());
  $("#btn-banner-dismiss")?.addEventListener("click", () => dismissRefreshBanner());
  $("#pdf-catalog-input")?.addEventListener("change", () => onPdfCatalogFilesSelected());
  $("#btn-clear-idb-catalog")?.addEventListener("click", async () => {
    await clearIdbCatalog();
    await refreshCatalogUi();
    showToast("Gespeicherte PDFs gelöscht");
  });
  $("#settings-auto-refresh-prompt")?.addEventListener("change", () => {
    readSettingsFromForm();
    saveSettings();
  });
}

function init() {
  // Do not auto-resolve / open PDF on boot — only user actions (scan, paste, demo taps).
  loadSettings();
  syncThemeChrome();
  try {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => syncThemeChrome();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (_) {}

  setStatus("Bereit – DataMatrix scannen");
  wireUi();
  initFill();
  registerSW();
  startupCatalogRefresh().catch((err) => {
    console.warn("startup catalog refresh", err);
  });
}

init();

export function getSaveMode() {
  return state.settings.saveMode || "auto";
}

/** Kept for fill.js compatibility (generator auto-increment unused here). */
export function onStampSaved() {}

/** After a successful PDF save: keep IDB in sync + show refresh banner again. */
export async function onPdfCatalogUpdated() {
  state.bannerDismissed = false;
  showRefreshBanner();
  try {
    await refreshCatalogUi();
  } catch (_) {}
}
