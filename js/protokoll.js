/**
 * Änderungsprotokoll: unsichtbarer JSON-Dateianhang im gespeicherten PDF
 * („aenderungsprotokoll.json“, sichtbar im Anhänge-Bereich von Acrobat/Edge).
 * Wer hat wann, auf welchem Gerät, wo im Dokument und wie etwas geändert/unterschrieben.
 * Kein GPS. Bestehendes Protokoll wird beim Öffnen gelesen und beim Speichern ergänzt.
 */

export const LOG_FILENAME = 'aenderungsprotokoll.json';
/** Human-readable copy, regenerated from the JSON on every save (JSON stays the source of truth). */
export const LOG_PDF_FILENAME = 'aenderungsprotokoll.pdf';
/** Readable copy of v1.54 (blocked by Acrobat Reader); only removed on save, never written again. */
const LEGACY_LOG_HTML_FILENAME = 'aenderungsprotokoll.html';
const LOG_ATTACHMENT_NAMES = [LOG_FILENAME, LOG_PDF_FILENAME, LEGACY_LOG_HTML_FILENAME];
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

/** Browser name only; Edge before Chrome, CriOS (Chrome on iOS) as Chrome. */
function browserFromUa(ua) {
  if (/Edg(?:e|A|iOS)?\//.test(ua)) return 'Edge';
  if (/(?:OPR|Opera)\//.test(ua)) return 'Opera';
  if (/(?:Firefox|FxiOS)\//.test(ua)) return 'Firefox';
  if (/SamsungBrowser\//.test(ua)) return 'Samsung Internet';
  if (/(?:CriOS|HeadlessChrome|Chrome|Chromium)\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua) || /AppleWebKit/.test(ua)) return 'Safari';
  return '';
}

/** Short system name for display, also for older logs ('Windows NT 10.0', 'iPadOS 17.4', 'macOS 10.15'). */
export function osShort(os) {
  const v = String(os || '').trim();
  if (!v) return '';
  if (/ipad/i.test(v)) return 'iPad';
  if (/iphone|ios/i.test(v)) return 'iPhone';
  if (/windows/i.test(v)) return 'Windows';
  if (/mac/i.test(v)) return 'Mac';
  if (/android/i.test(v)) return 'Android';
  if (/chrome ?os/i.test(v)) return 'ChromeOS';
  if (/linux/i.test(v)) return 'Linux';
  return v.replace(/\s*[\d._]+(\s|$)/g, ' ').trim();
}

/** Browser name for display, also for older logs ('Chrome 156.0.0.0', 'Chrome (iOS) 120.0', 'HeadlessChrome 155.0.0.0'). */
export function browserShort(browser) {
  const v = String(browser || '').trim();
  if (!v) return '';
  if (/edg/i.test(v)) return 'Edge';
  if (/chrom|crios/i.test(v)) return 'Chrome';
  for (const n of ['Firefox', 'Safari', 'Opera', 'Samsung Internet']) if (v.toLowerCase().includes(n.toLowerCase())) return n;
  return v.replace(/\s*\(.*?\)|\s*[\d._]+/g, '').trim();
}

/** Device parts for viewer/PDF: no user agent, no versions, system hidden when equal to type/name. */
function deviceDisplay(dev = {}) {
  const name = dev.device_name || '';
  const type = dev.type && dev.type !== 'Unbekannt' ? dev.type : '';
  const sys = osShort(dev.os);
  const seen = new Set([name, type].filter(Boolean).map((x) => x.toLowerCase()));
  return {
    name,
    type: type && type.toLowerCase() !== name.toLowerCase() ? type : '',
    system: sys && !seen.has(sys.toLowerCase()) ? sys : '',
    browser: browserShort(dev.browser),
  };
}

/** Device type / OS / browser from the user agent (best effort, no fingerprinting beyond UA). */
export function deviceInfo() {
  const ua = navigator.userAgent || '';
  let type = 'Unbekannt';
  let os = '';
  // Short names only (no NT, no version numbers); raw details stay in user_agent.
  if (isIpadLike()) type = os = 'iPad';
  else if (/iPhone|iPod/.test(ua)) type = os = 'iPhone';
  else if (/Android/.test(ua)) {
    type = /Mobile/.test(ua) ? 'Android-Phone' : 'Android-Tablet';
    os = 'Android';
  } else if (/Windows/.test(ua)) type = os = 'Windows';
  else if (/Macintosh|Mac OS X/.test(ua)) type = os = 'Mac';
  else if (/CrOS/.test(ua)) type = os = 'ChromeOS';
  else if (/Linux/.test(ua)) type = os = 'Linux';
  const browser = browserFromUa(ua);
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

/** Remove every embedded log file (JSON, PDF, legacy HTML) from the name tree (incl. Kids) and catalog /AF. */
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
  // Readable PDF copy; a failure here never blocks the JSON or the save.
  try {
    const pdfBytes = await renderLogPdf(log, PDFLib);
    await pdfDoc.attach(pdfBytes, LOG_PDF_FILENAME, {
      mimeType: 'application/pdf',
      description: 'Änderungsprotokoll (lesbar)',
      creationDate: now,
      modificationDate: now,
    });
  } catch (err) {
    console.warn('Änderungsprotokoll (PDF) konnte nicht angehängt werden', err);
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
    const dd = deviceDisplay(dev);
    const devTxt = [dd.name, dd.type, dd.system].filter(Boolean).join(' · ');
    h3.textContent = `${fmtTime(s.started)}${s.saved ? '' : ' (nicht gesichert)'} · ${who.kuerzel || '—'}` +
      `${devTxt ? ` · ${devTxt}` : ''}${dd.browser ? ` (${dd.browser})` : ''}`;
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

/* ---------- Readable PDF attachment ---------- */

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

/**
 * Readable protocol as its own small PDF (A4 landscape, Helvetica/WinAnsi, no external resources).
 * Sessions newest first, header + table per session; long tables continue on new pages with the
 * table header repeated. The JSON stays the source of truth.
 * @returns {Promise<Uint8Array>}
 */
export async function renderLogPdf(log, PDFLib = window.PDFLib) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle('Änderungsprotokoll');
  doc.setCreator(`Geräte Laufzettel ${APP_VERSION}`);
  doc.setProducer('Geräte Laufzettel');
  doc.setLanguage('de-DE');
  const F = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    ital: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  // WinAnsi covers äöüß · › „ “ ” – … ; anything else is replaced safely.
  const charset = new Set(F.reg.getCharacterSet());
  const SUBST = { '→': '->', '←': '<-', '‚': ',', '‘': "'", '’': "'", '\u00a0': ' ', '\u2009': ' ', '\u202f': ' ' };
  const clean = (v) => {
    let out = '';
    for (const ch of String(v ?? '').replace(/[\r\n\t]+/g, ' ')) {
      const cp = ch.codePointAt(0);
      if (charset.has(cp)) out += ch;
      else if (SUBST[ch]) out += SUBST[ch];
      else if (cp < 32) continue;
      else {
        const base = ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        out += base && [...base].every((c) => charset.has(c.codePointAt(0))) ? base : '?';
      }
    }
    return out;
  };
  const C = {
    pink: rgb(221 / 255, 0, 122 / 255),
    ink: rgb(29 / 255, 29 / 255, 31 / 255),
    muted: rgb(110 / 255, 110 / 255, 115 / 255),
    line: rgb(227 / 255, 227 / 255, 232 / 255),
    soft: rgb(253 / 255, 240 / 255, 247 / 255),
  };
  const PW = 841.89, PH = 595.28, M = 34; // A4 landscape, 12 mm margin
  const W = PW - 2 * M;
  const COLS = [
    ['Zeit', 46], ['Seite', 32], ['Aktion', 88], ['Feld/Stelle', 262],
    ['Alt', 96], ['Neu', 96], ['Wie', 86], ['Eingabegerät', W - 706],
  ];
  const FS = 8.5, LH = 10.6, PAD = 4;

  /** Word wrap with hard breaks for over-long words. */
  const wrap = (text, font, size, width) => {
    const t = clean(text);
    if (!t) return [''];
    const lines = [];
    let cur = '';
    const fits = (s) => font.widthOfTextAtSize(s, size) <= width;
    for (const word of t.split(/ +/)) {
      const cand = cur ? `${cur} ${word}` : word;
      if (fits(cand)) { cur = cand; continue; }
      if (cur) lines.push(cur);
      cur = '';
      let w = word;
      while (w && !fits(w)) {
        let n = w.length - 1;
        while (n > 1 && !fits(w.slice(0, n))) n--;
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      cur = w;
    }
    if (cur || !lines.length) lines.push(cur);
    return lines;
  };
  const text = (pg, s, x, y, font, size, color) => {
    const t = clean(s);
    if (t) pg.drawText(t, { x, y, font, size, color });
  };

  let page = null, y = 0;
  const newPage = () => {
    page = doc.addPage([PW, PH]);
    y = PH - M;
    if (doc.getPageCount() > 1) {
      text(page, 'Änderungsprotokoll (Fortsetzung)', M, y - 9, F.bold, 9, C.muted);
      y -= 18;
    }
  };
  const ensure = (h) => {
    if (y - h < M + 16) { newPage(); return true; }
    return false;
  };

  const sessions = [...(log?.sessions || [])].reverse();
  newPage();
  // Title
  text(page, 'Änderungsprotokoll', M, y - 18, F.bold, 18, C.ink);
  y -= 32;
  const updated = log?.updated ? fmtTime(log.updated) : '';
  const sub = `Geräte Laufzettel · ${sessions.length} Sitzung(en)${updated ? ` · Stand ${updated}` : ''} · Lesbare Kopie, maßgeblich ist ${LOG_FILENAME}`;
  text(page, sub, M, y, F.reg, 8.5, C.muted);
  y -= 8;
  page.drawRectangle({ x: M, y: y - 2.5, width: W, height: 2.5, color: C.pink });
  y -= 18;

  const tableHeader = () => {
    const h = LH + 2 * PAD;
    page.drawRectangle({ x: M, y: y - h, width: W, height: h, color: C.soft });
    let x = M;
    for (const [label, w] of COLS) {
      text(page, label, x + PAD, y - PAD - FS + 1, F.bold, FS, C.ink);
      x += w;
    }
    page.drawRectangle({ x: M, y: y - h - 1.5, width: W, height: 1.5, color: C.pink });
    y -= h + 1.5;
  };

  for (const s of sessions) {
    const dev = s.device || {};
    const who = s.who || {}; // sachbearbeiter_lager (older logs) intentionally not shown
    const kind = { merge: ' · Verbinden', split: ' · Teilen' }[s.kind] || '';
    const title = `${fmtTime(s.started)}${kind}`;
    const savedTxt = s.saved ? `gesichert ${fmtTime(s.saved)}` : 'nicht gesichert';
    const dd = deviceDisplay(dev); // user_agent stays in the JSON only
    const meta = [
      ['Kürzel', who.kuerzel || '—'],
      ['Gerät', [dd.name, dd.type].filter(Boolean).join(' · ') || '—'],
      ...(dd.system ? [['System', dd.system]] : []),
      ['Browser', dd.browser || '—'],
      ['Datei', s.file_name || '—'],
      ['Vorlage', s.template || '—'],
      ['App', s.app_version || '—'],
    ];
    // Meta items laid out inline, wrapping to further lines.
    const metaLines = [[]];
    let mx = 0;
    for (const [k, v] of meta) {
      const kw = F.bold.widthOfTextAtSize(clean(`${k}: `), 8);
      const vw = F.reg.widthOfTextAtSize(clean(v), 8);
      const iw = kw + vw + 14;
      if (mx + iw > W - 12 && metaLines[metaLines.length - 1].length) { metaLines.push([]); mx = 0; }
      metaLines[metaLines.length - 1].push({ k, v, x: mx, kw });
      mx += iw;
    }
    const rows = (s.entries || []).map((e) => {
      const hasVals = 'old' in e || 'new' in e;
      const covered = e.action === 'field_covered';
      const undo = e.action === 'undo';
      const font = covered ? F.bold : undo ? F.ital : F.reg;
      const color = undo || e.action === 'saved' ? C.muted : C.ink;
      const cells = [
        fmtTime(e.t).slice(9), e.page ?? '', actionDe(e.action), entryPlace(e),
        hasVals ? e.old ?? '' : '', hasVals ? e.new ?? '' : '', methodDe(e.method), inputDe(e.input),
      ].map((v, i) => wrap(v, font, FS, COLS[i][1] - 2 * PAD));
      const h = Math.max(...cells.map((c) => c.length)) * LH + 2 * PAD;
      return { cells, h, font, color, covered, timeColor: covered ? C.ink : C.muted };
    });
    const headH = 16 + metaLines.length * 11 + 4;
    const thH = LH + 2 * PAD + 1.5;
    // Keep session header, table header and the first row together.
    ensure(headH + thH + (rows[0]?.h || LH + 2 * PAD));
    const sessionHead = (cont) => {
      page.drawRectangle({ x: M, y: y - 13, width: 3.5, height: 13, color: C.pink });
      const t = clean(title + (cont ? ' (Fortsetzung)' : ''));
      text(page, t, M + 9, y - 10.5, F.bold, 11, C.ink);
      text(page, savedTxt, M + 9 + F.bold.widthOfTextAtSize(t, 11) + 8, y - 10.5, F.reg, 8.5, C.muted);
      y -= 16;
      if (!cont) {
        for (const line of metaLines) {
          for (const it of line) {
            text(page, `${it.k}:`, M + 12 + it.x, y - 8, F.bold, 8, C.ink);
            text(page, it.v, M + 12 + it.x + it.kw, y - 8, F.reg, 8, C.muted);
          }
          y -= 11;
        }
      }
      y -= 4;
      tableHeader();
    };
    sessionHead(false);
    if (!rows.length) {
      const h = LH + 2 * PAD;
      text(page, 'Keine Einträge', M + W / 2 - 25, y - PAD - FS + 1, F.reg, FS, C.muted);
      page.drawLine({ start: { x: M, y: y - h }, end: { x: M + W, y: y - h }, thickness: 0.6, color: C.line });
      y -= h;
    }
    for (const r of rows) {
      if (ensure(r.h)) sessionHead(true);
      if (r.covered) {
        page.drawRectangle({ x: M, y: y - r.h, width: W, height: r.h, color: C.soft });
        page.drawRectangle({ x: M, y: y - r.h, width: 2.5, height: r.h, color: C.pink });
      }
      let x = M;
      r.cells.forEach((lines, i) => {
        const w = COLS[i][1];
        lines.forEach((ln, li) => {
          const ty = y - PAD - FS + 1 - li * LH;
          const tx = i === 1 ? x + (w - r.font.widthOfTextAtSize(ln, FS)) / 2 : x + PAD;
          text(page, ln, tx, ty, r.font, FS, i === 0 ? r.timeColor : r.color);
        });
        x += w;
      });
      page.drawLine({ start: { x: M, y: y - r.h }, end: { x: M + W, y: y - r.h }, thickness: 0.6, color: C.line });
      y -= r.h;
    }
    y -= 18;
  }
  if (!sessions.length) text(page, 'Noch keine Einträge.', M, y - 10, F.reg, 9, C.muted);

  const pages = doc.getPages();
  pages.forEach((pg, i) => {
    text(pg, `Erzeugt von Geräte Laufzettel ${APP_VERSION}`, M, M - 14, F.reg, 7.5, C.muted);
    const pn = clean(`Seite ${i + 1} von ${pages.length}`);
    text(pg, pn, PW - M - F.reg.widthOfTextAtSize(pn, 7.5), M - 14, F.reg, 7.5, C.muted);
  });
  return doc.save({ useObjectStreams: false });
}
