/**
 * PDF Manipulator – eingebauter PDF Zerteiler (Port von PDF Zerteiler v1.6).
 * Eigene Ansicht, eigener Datei-Input: läuft NICHT über die Feldvorlagen-Prüfung
 * des Laufzettel-Öffnens (PDFs ohne Feldvorlage werden hier normal geteilt).
 */
import * as pdfjsLib from '../vendor/pdf.min.mjs?v=1.41';
import { buildSplitZip, sanitizeFilename } from './split.js?v=1.41';
import { xpsToPdf, isXpsFile } from './xps2pdf.js?v=1.41';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs?v=1.41', import.meta.url).href;
}

const $ = (sel) => document.querySelector(sel);
const state = { busy: false, lastZip: null };

function setStatus(text, kind = '') {
  const el = $('#pm-status');
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind || '';
}

function showToast(msg) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.add('hidden'), 3600);
}

/* ---------- Save / share ZIP (wie PDF Zerteiler) ---------- */

function canShareFile(file) {
  if (typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return true;
  try {
    return navigator.canShare({ files: [file] });
  } catch (_) {
    return false;
  }
}

function downloadBlob(blob, filename) {
  if (typeof window.saveAs === 'function') {
    try {
      window.saveAs(blob, filename);
      return;
    } catch (_) {}
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Desktop Chrome/Edge: File System Access API („Speichern unter“). iPad/Safari hat das nicht. */
export function hasSaveAsPicker() {
  return typeof window.showSaveFilePicker === 'function';
}

const SAVE_TYPES = {
  'application/zip': { description: 'ZIP-Archiv', accept: { 'application/zip': ['.zip'] } },
  'application/pdf': { description: 'PDF-Dokument', accept: { 'application/pdf': ['.pdf'] } },
};

/**
 * Speichern unter… (nur wenn showSaveFilePicker existiert).
 * @returns {'saved'|'aborted'|'needs-gesture'|'failed'}
 */
async function saveAsWithPicker(blob, name, type) {
  let handle;
  try {
    handle = await window.showSaveFilePicker({
      suggestedName: name,
      types: [SAVE_TYPES[type] || SAVE_TYPES['application/zip']],
    });
  } catch (err) {
    if (err?.name === 'AbortError') return 'aborted';
    // Transiente Nutzeraktivierung nach async Verarbeitung abgelaufen
    if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') return 'needs-gesture';
    console.warn('showSaveFilePicker failed', err);
    return 'failed';
  }
  try {
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return 'saved';
  } catch (err) {
    console.warn('write failed', err);
    return 'failed';
  }
}

/**
 * Reihenfolge: Desktop mit „Speichern unter“ → Dialog; sonst (iPad) Teilen-Menü; sonst Download.
 * @returns {Promise<string>} Ergebnis ('saved'|'aborted'|'needs-gesture'|'shared'|'downloaded')
 */
/**
 * „Speichern unter“ SOFORT öffnen (synchron im change-/click-Handler, vor jeder
 * asynchronen Verarbeitung), solange die Nutzeraktivierung noch gilt.
 * Der Name ist schon aus den Dateinamen bekannt. Die Verarbeitung läuft parallel,
 * geschrieben wird danach in den gewählten Handle.
 * @returns {Promise<{handle?:any, status?:string}>|null}  null = kein Picker (iPad etc.)
 */
function requestSaveHandle(name, type) {
  if (!hasSaveAsPicker()) return null;
  let p;
  try {
    p = window.showSaveFilePicker({
      suggestedName: name,
      types: [SAVE_TYPES[type] || SAVE_TYPES['application/zip']],
    });
  } catch (err) {
    p = Promise.reject(err);
  }
  return p.then(
    (handle) => ({ handle }),
    (err) => {
      if (err?.name === 'AbortError') return { status: 'aborted' };
      if (err?.name === 'SecurityError' || err?.name === 'NotAllowedError') return { status: 'needs-gesture' };
      console.warn('showSaveFilePicker failed', err);
      return { status: 'failed' };
    }
  );
}

async function writeToHandle(handle, blob) {
  try {
    const w = await handle.createWritable();
    await w.write(blob);
    await w.close();
    return 'saved';
  } catch (err) {
    console.warn('write failed', err);
    return 'failed';
  }
}

async function finishSaveBlob(blob, name, type = 'application/zip', pre = null) {
  if (hasSaveAsPicker()) {
    let r;
    if (pre) {
      const got = await pre;
      r = got.handle ? await writeToHandle(got.handle, blob) : got.status;
    } else {
      r = await saveAsWithPicker(blob, name, type);
    }
    if (r === 'saved') {
      showToast(`Gespeichert: ${name}`);
      return r;
    }
    if (r === 'aborted') {
      showToast('Speichern abgebrochen');
      return r;
    }
    if (r === 'needs-gesture') {
      showToast('Fertig – zum Speichern auf „Speichern unter…“ tippen');
      return r;
    }
    // 'failed' → Download als Rückfall
    downloadBlob(blob, name);
    showToast('Download gestartet');
    return 'downloaded';
  }
  const file = new File([blob], name, { type });
  if (canShareFile(file)) {
    try {
      await navigator.share({ files: [file] });
      showToast('Über Teilen-Menü gespeichert');
      return 'shared';
    } catch (err) {
      if (err && err.name === 'AbortError') {
        showToast('Speichern abgebrochen');
        return 'aborted';
      }
      console.warn('navigator.share failed', err);
    }
  }
  downloadBlob(blob, name);
  showToast('Download gestartet');
  return 'downloaded';
}

/* ---------- Ergebnisliste ---------- */

function renderResult(result) {
  const box = $('#pm-result');
  const list = $('#pm-result-list');
  const zipName = $('#pm-result-zip');
  if (!box || !list) return;
  list.innerHTML = '';
  result.filenames.forEach((name, i) => {
    const li = document.createElement('li');
    const r = result.ranges?.[i];
    const pages = r ? (r.start === r.end ? `Seite ${r.start}` : `Seiten ${r.start}–${r.end}`) : '';
    li.innerHTML = '<span class="pm-file"></span><span class="pm-pages muted"></span>';
    li.querySelector('.pm-file').textContent = name;
    li.querySelector('.pm-pages').textContent = pages;
    list.appendChild(li);
  });
  if (zipName) zipName.textContent = result.zipName;
  const removed = $('#pm-result-removed');
  if (removed) {
    const c = result.cautionPages || [];
    removed.textContent = c.length ? `Caution-Seite(n) entfernt: ${c.join(', ')}` : '';
    removed.classList.toggle('hidden', !c.length);
  }
  box.classList.remove('hidden');
}

/* ---------- Verarbeiten ---------- */

/**
 * Desktop-Chrome/Edge: Dateien per showOpenFilePicker statt <input type=file> wählen.
 * Getestet (Chrome 154, headful): Nach <input>-Dialog ist navigator.userActivation.isActive
 * false → showSaveFilePicker scheitert. Nach showOpenFilePicker bleibt die Aktivierung
 * erhalten → „Speichern unter“ öffnet direkt. iPad/Safari hat die API nicht → <input> wie bisher.
 * @returns {boolean} true, wenn der Picker-Pfad genutzt wird
 */
function openViaPicker(multiple, onFiles) {
  if (typeof window.showOpenFilePicker !== 'function' || !hasSaveAsPicker()) return false;
  window.showOpenFilePicker({
    multiple,
    types: [{
      description: multiple ? 'PDF / XPS' : 'PDF',
      accept: multiple
        ? { 'application/pdf': ['.pdf'], 'application/vnd.ms-xpsdocument': ['.xps'], 'application/oxps': ['.oxps'] }
        : { 'application/pdf': ['.pdf'] },
    }],
  }).then(async (handles) => {
    const files = await Promise.all(handles.map((h) => h.getFile()));
    onFiles(files);
  }).catch((err) => {
    if (err?.name !== 'AbortError') console.warn('showOpenFilePicker failed', err);
  });
  return true;
}

async function handlePdfFile(file) {
  if (!file || state.busy) return;
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
    showToast('Bitte eine PDF-Datei wählen');
    return;
  }
  const PDFLib = window.PDFLib;
  const JSZip = window.JSZip;
  if (!PDFLib || !JSZip) {
    setStatus('Bibliotheken nicht geladen', 'error');
    showToast('pdf-lib oder JSZip fehlt');
    return;
  }
  // Name ist vorab bekannt → Dialog sofort öffnen (Nutzeraktivierung noch gültig)
  const stem = String(file.name || 'dokument').replace(/\.pdf$/i, '') || 'dokument';
  const preZipName = `${sanitizeFilename(stem)}_geteilt.zip`;
  const pre = requestSaveHandle(preZipName, 'application/zip');
  state.busy = true;
  const btn = $('#btn-pm-open');
  if (btn) btn.disabled = true;
  $('#pm-result')?.classList.add('hidden');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await buildSplitZip({
      pdfBytes: bytes,
      splitField: $('#pm-split-field')?.value ?? '',
      removeField: $('#pm-remove-field')?.value ?? '',
      originalName: file.name,
      pdfjsLib,
      PDFLib,
      JSZip,
      onStatus: setStatus,
    });
    state.lastZip = result;
    setStatus(`${result.filenames.length} Datei(en): ${result.filenames.join(', ')}`, 'ok');
    renderResult(result);
    await finishSaveBlob(result.zipBlob, result.zipName, 'application/zip', result.zipName === preZipName ? pre : null);
  } catch (err) {
    console.error(err);
    const msg = err?.message || 'Teilen fehlgeschlagen';
    setStatus(msg, 'error');
    showToast(msg);
  } finally {
    state.busy = false;
    if (btn) btn.disabled = false;
  }
}

/* ---------- PDFs verbinden ---------- */

/** Geräte-ID im Dateinamen, z. B. DE-200.433-XX0000E00A00K0002(.pdf / Zusatz) */
export const DEVICE_ID_NAME_RE = /^DE-\d{3}\.\d{3}-[A-Z0-9]+/i;

function setMergeStatus(text, kind = '') {
  const el = $('#pm-merge-status');
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind || '';
}

/**
 * Reihenfolge + Name: Datei mit Geräte-ID zuerst, danach die Safety Tests
 * in natürlicher Dateinamen-Sortierung (z. B. „Safety Test 2“ vor „Safety Test 10“).
 * Fehler bei 0 oder mehreren Geräte-ID-Treffern.
 * @param {{name:string}[]} files  2–4 Dateien
 */
export function planMerge(files) {
  const hits = files.filter((f) => DEVICE_ID_NAME_RE.test(f.name));
  if (hits.length === 0) throw new Error('Keine Datei mit Geräte-ID (DE-…) gefunden');
  if (hits.length > 1) throw new Error('Mehrere Dateien haben eine Geräte-ID (DE-…) – bitte nur eine');
  const first = hits[0];
  const coll = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });
  const rest = files.filter((f) => f !== first).sort((a, b) => coll.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const id = first.name.match(DEVICE_ID_NAME_RE)[0].toUpperCase().replace(/^DE-/, 'DE-');
  return { ordered: [first, ...rest], outName: `${id} (Safety Test).pdf` };
}

const MERGE_MIN = 2; // 1 Gerätelaufzettel + 1 Safety Test
const MERGE_MAX = 4; // 1 Gerätelaufzettel + 3 Safety Tests

let lastMerge = null;

async function handleMergeFiles(fileList) {
  if (state.busy) return;
  const files = [...(fileList || [])];
  if (files.length < MERGE_MIN || files.length > MERGE_MAX) {
    const msg = `Bitte einen Gerätelaufzettel und 1 bis 3 Safety Tests auswählen (${files.length} gewählt)`;
    setMergeStatus(msg, 'error');
    showToast(msg);
    return;
  }
  if (files.some((f) => !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf' && !isXpsFile(f))) {
    showToast('Bitte nur PDF- oder XPS-Dateien wählen');
    return;
  }
  const PDFLib = window.PDFLib;
  if (!PDFLib) {
    showToast('pdf-lib fehlt');
    return;
  }
  let plan;
  try {
    plan = planMerge(files);
  } catch (err) {
    setMergeStatus(err.message, 'error');
    showToast(err.message);
    return;
  }
  const pre = requestSaveHandle(plan.outName, 'application/pdf');
  state.busy = true;
  const btn = $('#btn-pm-merge');
  if (btn) btn.disabled = true;
  $('#pm-merge-result')?.classList.add('hidden');
  try {
    setMergeStatus('PDFs werden verbunden…', 'busy');
    const out = await PDFLib.PDFDocument.create();
    const counts = [];
    for (const f of plan.ordered) {
      if (isXpsFile(f)) {
        setMergeStatus(`XPS wird umgewandelt: ${f.name}…`, 'busy');
        const before = out.getPageCount();
        try {
          await xpsToPdf(await f.arrayBuffer(), PDFLib, { outDoc: out });
        } catch (err) {
          console.error(err);
          throw new Error(`XPS-Umwandlung fehlgeschlagen (${f.name}): ${err?.message || err}`);
        }
        counts.push(out.getPageCount() - before);
        continue;
      }
      const src = await PDFLib.PDFDocument.load(await f.arrayBuffer(), { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      counts.push(pages.length);
    }
    const bytes = await out.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    lastMerge = { blob, name: plan.outName };
    const total = counts.reduce((a, b) => a + b, 0);
    setMergeStatus(`${plan.outName} · ${total} Seite(n)`, 'ok');
    const list = $('#pm-merge-list');
    if (list) {
      list.innerHTML = '';
      plan.ordered.forEach((f, i) => {
        const li = document.createElement('li');
        li.innerHTML = '<span class="pm-file"></span><span class="pm-pages muted"></span>';
        li.querySelector('.pm-file').textContent = f.name;
        li.querySelector('.pm-pages').textContent = `${counts[i]} Seite(n)`;
        list.appendChild(li);
      });
    }
    const nm = $('#pm-merge-name');
    if (nm) nm.textContent = plan.outName;
    const tot = $('#pm-merge-total');
    if (tot) tot.textContent = `Gesamt: ${total} Seite(n)`;
    $('#pm-merge-result')?.classList.remove('hidden');
    await finishSaveBlob(blob, plan.outName, 'application/pdf', pre);
  } catch (err) {
    console.error(err);
    const msg = err?.message || 'Verbinden fehlgeschlagen';
    setMergeStatus(msg, 'error');
    showToast(msg);
  } finally {
    state.busy = false;
    if (btn) btn.disabled = false;
  }
}

/* ---------- Ansicht ---------- */

export function showManipulatorView() {
  $('#home')?.classList.add('hidden');
  $('#pm-view')?.classList.remove('hidden');
  document.body.classList.add('pm-open');
  document.body.classList.remove('fill-open', 'scan-open');
  window.scrollTo(0, 0);
}

export function hideManipulatorView() {
  $('#pm-view')?.classList.add('hidden');
  $('#home')?.classList.remove('hidden');
  document.body.classList.remove('pm-open');
}

export function initManipulator() {
  const btn = $('#btn-pm-open');
  const input = $('#pm-file-input');
  $('#btn-pdf-manipulator')?.addEventListener('click', showManipulatorView);
  $('#btn-pm-back')?.addEventListener('click', hideManipulatorView);
  $('#btn-pm-save-again')?.addEventListener('click', () => {
    if (state.lastZip) finishSaveBlob(state.lastZip.zipBlob, state.lastZip.zipName);
  });
  const mBtn = $('#btn-pm-merge');
  const mInput = $('#pm-merge-input');
  mBtn?.addEventListener('click', () => {
    if (!openViaPicker(true, (files) => handleMergeFiles(files))) mInput?.click();
  });
  mInput?.addEventListener('change', () => {
    const fl = mInput.files ? [...mInput.files] : [];
    mInput.value = '';
    handleMergeFiles(fl);
  });
  $('#btn-pm-merge-save-again')?.addEventListener('click', () => {
    if (lastMerge) finishSaveBlob(lastMerge.blob, lastMerge.name, 'application/pdf');
  });
  if (!btn || !input) return;
  btn.addEventListener('click', () => {
    if (!openViaPicker(false, (files) => files[0] && handlePdfFile(files[0]))) input.click();
  });
  input.addEventListener('change', () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (f) handlePdfFile(f);
  });
  const prevent = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((ev) => btn.addEventListener(ev, prevent));
  btn.addEventListener('dragenter', () => btn.classList.add('is-over'));
  btn.addEventListener('dragover', () => btn.classList.add('is-over'));
  btn.addEventListener('dragleave', () => btn.classList.remove('is-over'));
  btn.addEventListener('drop', (e) => {
    btn.classList.remove('is-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) handlePdfFile(f);
  });
  if (hasSaveAsPicker()) {
    const a = $('#btn-pm-save-again');
    const b = $('#btn-pm-merge-save-again');
    if (a) a.textContent = 'Speichern unter…';
    if (b) b.textContent = 'Speichern unter…';
  }
  setStatus('PDF auf den Button ziehen oder tippen');
}

initManipulator();

/* v1.31: Feldinhalt bei Klick/Fokus/Tap komplett markieren, damit Tippen ersetzt */
function selectAllOnFocus(el) {
  if (!el) return;
  let justFocused = false;
  const selAll = () => { try { el.setSelectionRange(0, el.value.length); } catch { el.select(); } };
  el.addEventListener('focus', () => {
    justFocused = true;
    selAll();
    setTimeout(selAll, 0); // iPad Safari setzt den Cursor nach focus
  });
  el.addEventListener('mouseup', (e) => {
    if (justFocused) { e.preventDefault(); selAll(); }
    justFocused = false;
  });
  el.addEventListener('touchend', () => {
    if (justFocused) setTimeout(selAll, 0);
    justFocused = false;
  });
}
selectAllOnFocus(document.getElementById('pm-split-field'));
selectAllOnFocus(document.getElementById('pm-remove-field'));
