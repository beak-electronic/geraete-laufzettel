/**
 * Änderungsprotokoll: unsichtbarer JSON-Dateianhang im gespeicherten PDF
 * („aenderungsprotokoll.json“, sichtbar im Anhänge-Bereich von Acrobat/Edge).
 * Wer hat wann, auf welchem Gerät, wo im Dokument und wie etwas geändert/unterschrieben.
 * Kein GPS. Bestehendes Protokoll wird beim Öffnen gelesen und beim Speichern ergänzt.
 */

export const LOG_FILENAME = 'aenderungsprotokoll.json';
/** Human-readable copy, regenerated from the JSON on every save (JSON stays the source of truth). */
export const LOG_HTML_FILENAME = 'aenderungsprotokoll.html';
const LOG_ATTACHMENT_NAMES = [LOG_FILENAME, LOG_HTML_FILENAME];
export const LOG_FORMAT = 'geraete-laufzettel-aenderungsprotokoll';
export const LOG_FORMAT_VERSION = 1;

const LS_DEVICE_ID = 'gl.deviceId.v1';
const LS_DEVICE_NAME = 'gl.deviceName.v1';

/** App version from this module's own ?v= (bumped with every release). */
export const APP_VERSION = (() => {
  try {
    return new URL(import.meta.url).searchParams.get('v') || '';
  } catch (_) {
    return '';
  }
})();

/** ISO 8601 with local offset, e.g. 2026-10-22T11:30:05.123+02:00 */
export function isoLocal(d = new Date()) {
  const pad = (n, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}` +
    `${sign}${pad(off / 60)}:${pad(off % 60)}`
  );
}

export function randomId() {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  const b = new Uint8Array(16);
  try {
    crypto.getRandomValues(b);
  } catch (_) {
    for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  }
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Random per-installation id (localStorage); not derived from hardware. */
export function getDeviceId() {
  try {
    let id = localStorage.getItem(LS_DEVICE_ID);
    if (!id) {
      id = randomId();
      localStorage.setItem(LS_DEVICE_ID, id);
    }
    return id;
  } catch (_) {
    return '';
  }
}

export function getDeviceName() {
  try {
    return (localStorage.getItem(LS_DEVICE_NAME) || '').trim();
  } catch (_) {
    return '';
  }
}

export function setDeviceName(name) {
  const v = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  try {
    if (v) localStorage.setItem(LS_DEVICE_NAME, v);
    else localStorage.removeItem(LS_DEVICE_NAME);
  } catch (_) {}
  return v;
}

function isIpadLike() {
  const ua = navigator.userAgent || '';
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
}

/** Device type / OS / browser from the user agent (best effort, no fingerprinting beyond UA). */
export function deviceInfo() {
  const ua = navigator.userAgent || '';
  let type = 'Unbekannt';
  let os = '';
  if (isIpadLike()) {
    type = 'iPad';
    const m = ua.match(/OS (\d+)[_.](\d+)/) || ua.match(/Version\/(\d+)\.(\d+)/);
    os = m ? `iPadOS ${m[1]}.${m[2]}` : 'iPadOS';
  } else if (/iPhone|iPod/.test(ua)) {
    type = 'iPhone';
    const m = ua.match(/OS (\d+)[_.](\d+)/);
    os = m ? `iOS ${m[1]}.${m[2]}` : 'iOS';
  } else if (/Android/.test(ua)) {
    type = /Mobile/.test(ua) ? 'Android-Phone' : 'Android-Tablet';
    const m = ua.match(/Android ([\d.]+)/);
    os = m ? `Android ${m[1]}` : 'Android';
  } else if (/Windows/.test(ua)) {
    type = 'Windows';
    const m = ua.match(/Windows NT ([\d.]+)/);
    os = m ? `Windows NT ${m[1]}` : 'Windows';
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    type = 'Mac';
    const m = ua.match(/Mac OS X (\d+)[_.](\d+)/);
    os = m ? `macOS ${m[1]}.${m[2]}` : 'macOS';
  } else if (/CrOS/.test(ua)) {
    type = 'ChromeOS';
    os = 'ChromeOS';
  } else if (/Linux/.test(ua)) {
    type = 'Linux';
    os = 'Linux';
  }
  let browser = '';
  let m;
  if ((m = ua.match(/Edg(?:A|iOS)?\/([\d.]+)/))) browser = `Edge ${m[1]}`;
  else if ((m = ua.match(/(?:OPR|Opera)\/([\d.]+)/))) browser = `Opera ${m[1]}`;
  else if ((m = ua.match(/(?:Firefox|FxiOS)\/([\d.]+)/))) browser = `Firefox ${m[1]}`;
  else if ((m = ua.match(/CriOS\/([\d.]+)/))) browser = `Chrome (iOS) ${m[1]}`;
  else if ((m = ua.match(/(?:HeadlessChrome|Chrome)\/([\d.]+)/))) browser = `${/HeadlessChrome/.test(ua) ? 'HeadlessChrome' : 'Chrome'} ${m[1]}`;
  else if ((m = ua.match(/Version\/([\d.]+).*Safari/))) browser = `Safari ${m[1]}`;
  let standalone = false;
  try {
    standalone = !!(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone);
  } catch (_) {}
  return {
    type,
    os,
    browser,
    installed_app: standalone,
    device_id: getDeviceId(),
    device_name: getDeviceName() || null,
    screen: `${screen?.width || 0}x${screen?.height || 0}@${window.devicePixelRatio || 1}`,
    touch_points: navigator.maxTouchPoints || 0,
    language: navigator.language || '',
    time_zone: (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch (_) {
        return '';
      }
    })(),
    user_agent: ua,
  };
}

/** Pointer type → German-neutral id used in the log. */
export function inputDevice(pointerType) {
  if (pointerType === 'mouse') return 'mouse';
  if (pointerType === 'touch') return 'finger';
  if (pointerType === 'pen') return isIpadLike() || /iPhone/.test(navigator.userAgent || '') ? 'apple_pencil' : 'pen';
  return pointerType ? String(pointerType) : 'unknown';
}

export function emptyLog() {
  return { format: LOG_FORMAT, format_version: LOG_FORMAT_VERSION, created: isoLocal(), updated: null, sessions: [] };
}

/** @returns {object|null} validated log or null */
export function parseLog(data) {
  try {
    const text = typeof data === 'string' ? data : new TextDecoder('utf-8').decode(data);
    const j = JSON.parse(text);
    if (!j || j.format !== LOG_FORMAT || !Array.isArray(j.sessions)) return null;
    return j;
  } catch (_) {
    return null;
  }
}

/**
 * Read the log attachment from a pdf.js document.
 * @returns {Promise<{log: object|null, unparsed: string|null}>}
 */
export async function readLogFromPdfJs(pdf) {
  try {
    const atts = (await pdf.getAttachments()) || {};
    for (const key of Object.keys(atts)) {
      const a = atts[key];
      const name = String(a?.filename || key || '');
      if (name.split(/[\\/]/).pop() !== LOG_FILENAME || !a?.content) continue;
      const log = parseLog(a.content);
      if (log) return { log, unparsed: null };
      let raw = '';
      try {
        raw = new TextDecoder('utf-8').decode(a.content).slice(0, 200000);
      } catch (_) {}
      return { log: null, unparsed: raw };
    }
  } catch (err) {
    console.warn('Änderungsprotokoll: Anhänge konnten nicht gelesen werden', err);
  }
  return { log: null, unparsed: null };
}

/** Merge several logs (e.g. Verbinden). Sessions de-duplicated by session_id, sorted by start. */
export function mergeLogs(logs) {
  const out = emptyLog();
  const seen = new Set();
  let created = null;
  for (const l of logs) {
    if (!l) continue;
    if (l.created && (!created || l.created < created)) created = l.created;
    for (const s of l.sessions || []) {
      const id = s?.session_id || JSON.stringify(s).slice(0, 200);
      if (seen.has(id)) continue;
      seen.add(id);
      out.sessions.push(s);
    }
    if (l.previous_unparsed) out.previous_unparsed = l.previous_unparsed;
  }
  if (created) out.created = created;
  out.sessions.sort((a, b) => String(a.started || '').localeCompare(String(b.started || '')));
  return out;
}

/** New session record. */
export function newSession({ fileName = '', templateId = '', who = {}, kind = 'edit' } = {}) {
  return {
    session_id: randomId(),
    kind,
    started: isoLocal(),
    saved: null,
    file_name: fileName,
    app_version: APP_VERSION,
    template: templateId || null,
    device: deviceInfo(),
    who,
    entries: [],
  };
}

/** Remove every embedded log file (JSON + HTML) from the name tree (incl. Kids) and catalog /AF. */
function removeExistingLog(pdfDoc, PDFLib) {
  const { PDFName, PDFArray, PDFDict } = PDFLib;
  const removed = [];
  const nameOf = (o) => {
    try {
      return typeof o?.decodeText === 'function' ? o.decodeText() : '';
    } catch (_) {
      return '';
    }
  };
  const walk = (node, depth) => {
    if (!node || depth > 8) return;
    const arr = node.lookupMaybe(PDFName.of('Names'), PDFArray);
    if (arr) {
      for (let i = arr.size() - 2; i >= 0; i -= 2) {
        if (LOG_ATTACHMENT_NAMES.includes(nameOf(arr.lookup(i)))) {
          removed.push(arr.get(i + 1));
          arr.remove(i + 1);
          arr.remove(i);
        }
      }
    }
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) walk(kids.lookupMaybe(i, PDFDict), depth + 1);
  };
  const names = pdfDoc.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const ef = names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict);
  walk(ef, 0);
  const af = pdfDoc.catalog.lookupMaybe(PDFName.of('AF'), PDFArray);
  if (af && removed.length) {
    const ctx = pdfDoc.context;
    const removedObjs = removed.map((r) => ctx.lookup(r));
    for (let i = af.size() - 1; i >= 0; i--) {
      const it = af.get(i);
      if (removed.includes(it) || removedObjs.includes(ctx.lookup(it))) af.remove(i);
    }
  }
  return removed.length;
}

/**
 * Replace (never duplicate) the log attachment in a pdf-lib document.
 * Never throws: on failure the PDF is saved without the log (console warning).
 * @returns {Promise<boolean>}
 */
export async function attachLogToPdfLib(pdfDoc, log, PDFLib = window.PDFLib) {
  let ok = false;
  const now = new Date();
  try {
    removeExistingLog(pdfDoc, PDFLib);
    log.updated = isoLocal();
    const bytes = new TextEncoder().encode(JSON.stringify(log, null, 1));
    await pdfDoc.attach(bytes, LOG_FILENAME, {
      mimeType: 'application/json',
      description: 'Änderungsprotokoll Geräte Laufzettel (wer/wann/wo/wie)',
      creationDate: now,
      modificationDate: now,
    });
    ok = true;
  } catch (err) {
    console.warn('Änderungsprotokoll konnte nicht angehängt werden — PDF wird ohne Protokoll gespeichert', err);
    return false;
  }
  // Readable HTML copy; a failure here never blocks the JSON or the save.
  try {
    const html = new TextEncoder().encode(renderLogHtml(log));
    await pdfDoc.attach(html, LOG_HTML_FILENAME, {
      mimeType: 'text/html',
      description: 'Änderungsprotokoll (lesbar, im Browser öffnen)',
      creationDate: now,
      modificationDate: now,
    });
  } catch (err) {
    console.warn('Änderungsprotokoll (HTML) konnte nicht angehängt werden', err);
  }
  return ok;
}

/* ---------- Where: nearest PDF text for a stroke ---------- */

/** Text lines of a pdf.js page in PDF pt, origin top-left. */
export async function pageTextLines(pdfPage) {
  const vp = pdfPage.getViewport({ scale: 1 });
  const ph = vp.height;
  const tc = await pdfPage.getTextContent();
  const items = [];
  for (const it of tc.items || []) {
    const str = String(it.str || '').trim();
    if (!str || !it.transform) continue;
    const [a, b, c, d, e, f] = it.transform;
    const h = it.height || Math.hypot(c, d) || Math.hypot(a, b) || 8;
    const yBase = ph - f;
    items.push({ str, x0: e, x1: e + (it.width || 0), y0: yBase - h, y1: yBase });
  }
  items.sort((p, q) => p.y1 - q.y1 || p.x0 - q.x0);
  const lines = [];
  for (const it of items) {
    const ln = lines.find((l) => Math.abs(l.y1 - it.y1) < 2.5);
    if (ln) {
      ln.items.push(it);
      ln.y0 = Math.min(ln.y0, it.y0);
    } else lines.push({ y0: it.y0, y1: it.y1, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((p, q) => p.x0 - q.x0);
    l.x0 = l.items[0].x0;
    l.text = l.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
  }
  lines.sort((p, q) => p.y0 - q.y0);
  return lines;
}

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Describe where a stroke is: label left of it on the same row („Unterschrift:“),
 * row label (leftmost text), section heading above, nearest template field.
 */
export function describeStrokeLocation(bbox, lines, fields = []) {
  const [x0, y0, x1, y1] = bbox;
  const cy = (y0 + y1) / 2;
  const out = {};
  if (lines?.length) {
    let row = null;
    let best = Infinity;
    for (const l of lines) {
      const lc = (l.y0 + l.y1) / 2;
      const inside = cy >= l.y0 - 5 && cy <= l.y1 + 5;
      const d = Math.abs(lc - cy) + (inside ? 0 : 100);
      if (d < best && Math.abs(lc - cy) < 16) {
        best = d;
        row = l;
      }
    }
    if (row) {
      const left = row.items.filter((i) => i.x1 <= x0 + 8);
      const near = left.length ? left[left.length - 1] : row.items.find((i) => i.x1 > x0 && i.x0 < x1);
      if (near) out.near_text = near.str;
      if (row.items[0] && row.items[0] !== near) out.row_label = row.items[0].str;
      const above = lines.filter((l) => l.y1 < row.y0 - 2 && l.x0 < 90).sort((p, q) => q.y1 - p.y1);
      if (above[0]) out.section = above[0].text.slice(0, 100);
    }
  }
  let nf = null;
  for (const f of fields) {
    const r = f.rect_pt;
    if (!r) continue;
    const dx = Math.max(0, r[0] - x1, x0 - r[2]);
    const dy = Math.max(0, r[1] - y1, y0 - r[3]);
    const d = Math.hypot(dx, dy);
    if (!nf || d < nf.d) nf = { d, f };
  }
  if (nf) out.nearest_field = { number: nf.f.number, id: nf.f.id, label: nf.f.label, distance_pt: r1(nf.d) };
  return out;
}

export function strokeBBox(stroke) {
  const pts = stroke?.points || [];
  if (!pts.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const w = (stroke.width || 1.5) / 2;
  return [r1(x0 - w), r1(y0 - w), r1(x1 + w), r1(y1 + w)];
}

/* ---------- Viewer ---------- */

const ACTION_DE = {
  field_filled: 'Feld gefüllt',
  field_changed: 'Feld geändert',
  field_cleared: 'Feld geleert',
  field_covered: 'Feld weiß überdeckt',
  stroke: 'Strich gezeichnet',
  undo: 'Rückgängig',
  cells_changed: 'Zellen geändert',
  saved: 'Gesichert',
  merged: 'Verbunden',
  split: 'Geteilt',
};

/** Viewer-only German labels for the JSON codes (codes in the JSON stay unchanged). */
const METHOD_DE = {
  tap: 'Getippt',
  tap_date: 'Datum getippt',
  date_settings: 'Datum aus Einstellungen',
  tap_name: 'Name getippt',
  date_entry: 'Datum eingegeben',
  inline_text: 'Freitext in Zelle',
  text_dialog: 'Textfenster',
  keyboard: 'Tastatur',
  scan: 'Scan',
  stamp: 'Stempel',
  tap_clear: 'Geleert durch Tippen',
  erase: 'Radiermodus',
  erase_mode: 'Radiermodus',
  freehand: 'Freihand',
  undo_button: 'Rückgängig-Button',
  zellen_loeschen: 'Zellen löschen',
  merge: 'Verbinden',
  split: 'Teilen',
  // Field types (fallback of fieldMethod for unexpected types)
  tap_ok: 'Getippt',
  tap_x: 'Getippt',
  tap_date_settings: 'Datum getippt',
  tap_initials_stamp: 'Stempel',
  tap_lager_clerk: 'Name getippt',
  manual_date: 'Datum eingegeben',
  manual_text: 'Textfenster',
  scan_or_manual: 'Scan / Tastatur',
  unknown: 'Unbekannt',
};
const INPUT_DE = {
  mouse: 'Maus',
  finger: 'Finger',
  touch: 'Finger',
  apple_pencil: 'Apple Pencil',
  pencil: 'Apple Pencil',
  pen: 'Stift',
  unknown: 'Eingabegerät unbekannt',
};
const methodDe = (c) => (c ? METHOD_DE[c] || 'Sonstige Eingabe' : '');
const inputDe = (c) => (c ? INPUT_DE[c] || 'Sonstiges Eingabegerät' : '');
const actionDe = (c) => ACTION_DE[c] || 'Änderung';

function fmtTime(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)/);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)} ${m[4]}:${m[5]}:${m[6]}` : String(iso || '');
}

function entryText(e) {
  const parts = [];
  if (e.page) parts.push(`S. ${e.page}`);
  if (e.field) parts.push(`Nr. ${e.field.number} ${e.field.label || e.field.id || ''}`.trim());
  if (e.where) {
    const w = [e.where.section, e.where.row_label, e.where.near_text].filter(Boolean).join(' › ');
    if (w) parts.push(w);
  }
  if (e.action === 'undo' && e.undone) {
    const ua = { fields: 'Feld', ink: 'Strich', cells: 'Zellen' }[e.undone.action] || actionDe(e.undone.action);
    parts.push(`(${ua}${e.undone.summary ? `: ${e.undone.summary}` : ''})`);
  }
  if ('old' in e || 'new' in e) parts.push(`„${e.old ?? ''}“ → „${e.new ?? ''}“`);
  if (e.file_name && e.action !== 'stroke') parts.push(e.file_name);
  return parts.join(' · ');
}

/** Small modal list of all sessions + entries (current, unsaved session included). */
export function showLogDialog(log, { title = 'Änderungsprotokoll' } = {}) {
  let dlg = document.getElementById('protokoll-dialog');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.id = 'protokoll-dialog';
    dlg.className = 'settings-dialog protokoll-dialog';
    document.body.appendChild(dlg);
  }
  dlg.innerHTML = '';
  const form = document.createElement('form');
  form.method = 'dialog';
  const head = document.createElement('header');
  head.className = 'settings-header';
  const h2 = document.createElement('h2');
  h2.className = 'protokoll-title';
  h2.textContent = title;
  const done = document.createElement('button');
  done.type = 'submit';
  done.className = 'btn btn-text btn-primary-text btn-done';
  done.textContent = 'Fertig';
  head.append(h2, done);
  const body = document.createElement('div');
  body.className = 'settings-scroll protokoll-body';
  const sessions = log?.sessions || [];
  if (!sessions.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Noch keine Einträge.';
    body.appendChild(p);
  }
  for (const s of [...sessions].reverse()) {
    const sec = document.createElement('section');
    sec.className = 'settings-section protokoll-session';
    const h3 = document.createElement('h3');
    const dev = s.device || {};
    const who = s.who || {};
    h3.textContent = `${fmtTime(s.started)}${s.saved ? '' : ' (nicht gesichert)'} · ${who.kuerzel || '—'}` +
      ` · ${dev.device_name || dev.type || ''} ${dev.browser ? `(${dev.browser})` : ''}`;
    const meta = document.createElement('p');
    meta.className = 'hint';
    // who.sachbearbeiter_lager (older logs) stays in the JSON but is not shown.
    meta.textContent = `Datei: ${s.file_name || '—'} · Vorlage ${s.template || '—'} · App ${s.app_version || '—'}`;
    const ol = document.createElement('ol');
    ol.className = 'protokoll-list';
    for (const e of s.entries || []) {
      const li = document.createElement('li');
      if (e.action === 'field_covered') li.className = 'protokoll-covered';
      const t = document.createElement('span');
      t.className = 'protokoll-time';
      t.textContent = fmtTime(e.t).slice(9);
      const a = document.createElement('strong');
      a.textContent = ` ${actionDe(e.action)}`;
      const how = document.createElement('span');
      how.className = 'protokoll-how';
      how.textContent = [methodDe(e.method), inputDe(e.input)].filter(Boolean).join(' · ');
      const d = document.createElement('div');
      d.className = 'protokoll-detail';
      d.textContent = entryText(e);
      li.append(t, a, document.createTextNode(' '), how, d);
      ol.appendChild(li);
    }
    sec.append(h3, meta, ol);
    body.appendChild(sec);
  }
  form.append(head, body);
  dlg.appendChild(form);
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
  return dlg;
}

/**
 * Log for a PDF produced by Teilen/Verbinden: earlier sessions + one session for this step.
 * @param {object[]} logs  source logs (null entries ignored)
 * @param {{kind:string, action:string, fileName:string, details?:object}} step
 */
export function derivedLog(logs, { kind, action, fileName, details = {} }) {
  const log = mergeLogs(logs);
  const s = newSession({ fileName, kind });
  s.saved = isoLocal();
  s.entries.push({ seq: 1, t: s.saved, action, file_name: fileName, method: kind, ...details });
  log.sessions.push(s);
  return log;
}

/* ---------- Readable HTML attachment ---------- */

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** „Feld/Stelle“ column: field, stroke location, undo/merge/split details. */
function entryPlace(e) {
  if (e.field) {
    const f = `Nr. ${e.field.number ?? ''} ${e.field.label || e.field.id || ''}`.trim();
    return e.action === 'field_covered' && e.where?.cover_rect_pt ? `${f} (weiß: ${e.where.cover_rect_pt.join(', ')} pt)` : f;
  }
  if (e.action === 'field_covered' && e.where?.cover_rect_pt) {
    // (field handled above) — kept for entries without field info
    return `Bereich ${e.where.cover_rect_pt.join(', ')} pt`;
  }
  if (e.action === 'stroke' && e.where) {
    const w = e.where;
    const t = [w.section, w.row_label, w.near_text].filter(Boolean).join(' › ');
    const bb = Array.isArray(w.bbox_pt) ? ` (Bereich ${w.bbox_pt.join(', ')} pt)` : '';
    return (t || (w.nearest_field ? `bei Nr. ${w.nearest_field.number} ${w.nearest_field.label || ''}` : '')) + bb;
  }
  if (e.action === 'undo' && e.undone) {
    const ua = { fields: 'Feld', ink: 'Strich', cells: 'Zellen' }[e.undone.action] || actionDe(e.undone.action);
    return `${ua}${e.undone.summary ? `: ${e.undone.summary}` : ''}`;
  }
  if (e.action === 'merged') return `Eingaben: ${(e.inputs || []).join(', ')}`;
  if (e.action === 'split') return `Seiten ${e.source_pages || ''} aus ${e.source_file || ''}`;
  if (e.action === 'cells_changed') return `${(e.cells || []).length} Zelle(n)`;
  if (e.action === 'saved') return e.file_name || '';
  return '';
}

/** Self-contained HTML (inline CSS, no scripts/external resources), sessions newest first. */
export function renderLogHtml(log) {
  const sessions = [...(log?.sessions || [])].reverse();
  const parts = [];
  for (const s of sessions) {
    const dev = s.device || {};
    const who = s.who || {}; // sachbearbeiter_lager (older logs) intentionally not shown
    const rows = (s.entries || [])
      .map((e) => {
        const hasVals = 'old' in e || 'new' in e;
        return `<tr class="a-${esc(e.action)}"><td class="t">${esc(fmtTime(e.t).slice(9))}</td><td class="c">${esc(e.page ?? '')}</td>` +
          `<td>${esc(actionDe(e.action))}</td><td>${esc(entryPlace(e))}</td>` +
          `<td>${hasVals ? esc(e.old ?? '') : ''}</td><td>${hasVals ? esc(e.new ?? '') : ''}</td>` +
          `<td>${esc(methodDe(e.method))}</td><td>${esc(inputDe(e.input))}</td></tr>`;
      })
      .join('\n');
    const meta = [
      ['Kürzel', who.kuerzel || '—'],
      ['Gerät', [dev.device_name, dev.type].filter(Boolean).join(' · ') || '—'],
      ['System', dev.os || '—'],
      ['Browser', dev.browser || '—'],
      ['Datei', s.file_name || '—'],
      ['Vorlage', s.template || '—'],
      ['App', s.app_version || '—'],
    ]
      .map(([k, v]) => `<span><b>${esc(k)}:</b> ${esc(v)}</span>`)
      .join('');
    const kind = { merge: ' · Verbinden', split: ' · Teilen' }[s.kind] || '';
    parts.push(`<section class="session"><h2>${esc(fmtTime(s.started))}${esc(kind)}` +
      `${s.saved ? ` <small>gesichert ${esc(fmtTime(s.saved))}</small>` : ' <small>nicht gesichert</small>'}</h2>` +
      `<div class="meta">${meta}</div>` +
      `<table><thead><tr><th>Zeit</th><th>Seite</th><th>Aktion</th><th>Feld/Stelle</th><th>Alt</th><th>Neu</th><th>Wie</th><th>Eingabegerät</th></tr></thead>` +
      `<tbody>${rows || '<tr><td colspan="8" class="empty">Keine Einträge</td></tr>'}</tbody></table></section>`);
  }
  const updated = log?.updated ? fmtTime(log.updated) : '';
  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Änderungsprotokoll</title>
<style>
:root{--pink:#dd007a;--ink:#1d1d1f;--muted:#6e6e73;--line:#e3e3e8;--soft:#fdf0f7}
*{box-sizing:border-box}
body{margin:0;padding:24px;font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:#fff}
header{border-bottom:3px solid var(--pink);padding-bottom:8px;margin-bottom:18px}
h1{margin:0;font-size:22px;font-weight:700}
.sub{color:var(--muted);font-size:12px;margin-top:4px}
.session{margin:0 0 22px;break-inside:avoid-page}
h2{font-size:15px;font-weight:700;margin:0 0 4px;padding-left:8px;border-left:4px solid var(--pink)}
h2 small{font-weight:400;color:var(--muted);font-size:12px;margin-left:6px}
.meta{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;color:var(--muted);margin:0 0 8px 12px}
.meta b{color:var(--ink);font-weight:600}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{background:var(--soft);color:var(--ink);text-align:left;font-weight:600;border-bottom:2px solid var(--pink);padding:5px 6px;white-space:nowrap}
td{border-bottom:1px solid var(--line);padding:4px 6px;vertical-align:top;word-break:break-word}
td.t{white-space:nowrap;font-variant-numeric:tabular-nums;color:var(--muted)}
td.c{text-align:center}
tr.a-undo td{color:var(--muted);font-style:italic}
tr.a-field_covered td{background:var(--soft);font-weight:600}
tr.a-field_covered td:first-child{box-shadow:inset 3px 0 0 var(--pink)}
@media print{tr.a-field_covered td{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
tr.a-saved td{color:var(--muted)}
td.empty{color:var(--muted);text-align:center}
footer{margin-top:18px;color:var(--muted);font-size:11px}
@media print{body{padding:0;font-size:11px}table{font-size:10px}thead{display:table-header-group}tr{break-inside:avoid}
th{-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4 landscape;margin:12mm}}
</style></head><body>
<header><h1>Änderungsprotokoll</h1>
<div class="sub">Geräte Laufzettel · ${esc(sessions.length)} Sitzung(en)${updated ? ` · Stand ${esc(updated)}` : ''} · Lesbare Kopie, maßgeblich ist ${esc(LOG_FILENAME)}</div></header>
${parts.join('\n') || '<p class="sub">Noch keine Einträge.</p>'}
<footer>Erzeugt von Geräte Laufzettel ${esc(APP_VERSION)}. Kein Standort gespeichert.</footer>
</body></html>
`;
}
