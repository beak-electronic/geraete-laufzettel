/**
 * Geräte field overlay UI + save helpers (blue highlights stay on screen only).
 */
import {
  fieldsForPage,
  fieldKey,
  rectCssPercent,
  drawFieldHighlights,
  drawCenteredFieldText,
  drawMultilineFieldText,
  fitMultilineText,
  drawInitialsStampInRect,
  fieldDialogTitle,
  stampDateForSettings,
  stampInitialsForSettings,
  stampLagerClerkForSettings,
  normalizeStampDateYY,
} from './fields.js?v=1.59';
import { colorCss, colorRgb01 } from './settings.js?v=1.59';
import { createPdfFontBag } from './pdf-fonts.js?v=1.59';

const { rgb } = PDFLib;

/**
 * @param {object} ctx
 * @param {Map<string,{text:string,colorIndex:number}>} ctx.fieldValues
 * @param {object|null} ctx.template
 * @param {object} ctx.settings
 * @param {(msg:string)=>void} ctx.showToast
 * @param {()=>void} ctx.openSettings
 * @param {(pageIndex:number)=>void} ctx.redrawPage
 * @param {(entry:object)=>void} ctx.pushUndo
 * @param {()=>Array} ctx.snapshotFieldKeys
 * @param {(snap:Array)=>void} ctx.restoreFieldSnapshot
 * @param {(opts:object)=>Promise<string|null>} ctx.promptFieldInput
 * @param {(opts:object)=>Promise<string|null>} ctx.scanIntoField
 * @param {()=>boolean} ctx.shouldIgnoreStampClick
 * @param {(e:Event)=>void} ctx.markPenStampSuppress
 * @param {(e:Event)=>boolean} ctx.isPenPointer
 */

export function syncFieldsLayer(wrap, elLayer) {
  const pageCanvas = wrap.querySelector('canvas.page-canvas');
  if (!pageCanvas || !elLayer) return null;
  elLayer.style.left = `${pageCanvas.offsetLeft}px`;
  elLayer.style.top = `${pageCanvas.offsetTop}px`;
  elLayer.style.width = `${pageCanvas.offsetWidth}px`;
  elLayer.style.height = `${pageCanvas.offsetHeight}px`;
  elLayer.style.right = 'auto';
  elLayer.style.bottom = 'auto';
  return pageCanvas;
}

export function drawGeraetePage(wrap, pageWidth, pageHeight, api) {
  const pageIndex = Number(wrap.dataset.pageIndex);
  const fieldsLayer = wrap.querySelector('canvas.fields-layer');
  const overlay = wrap.querySelector('canvas.overlay');
  const hit = wrap.querySelector('.hit-layer');
  const inkCanvas = wrap.querySelector('canvas.ink-canvas');

  syncFieldsLayer(wrap, fieldsLayer);
  syncFieldsLayer(wrap, overlay);
  syncFieldsLayer(wrap, hit);
  syncFieldsLayer(wrap, inkCanvas);

  const { cssW, cssH, scaleX, scaleY, crop } = api.pageScales(wrap, pageWidth, pageHeight);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const needW = Math.max(1, Math.round(cssW * dpr));
  const needH = Math.max(1, Math.round(cssH * dpr));

  const fields = fieldsForPage(api.template, pageIndex);

  // Blue highlights under stamps/ink
  if (fieldsLayer) {
    if (fieldsLayer.width !== needW || fieldsLayer.height !== needH) {
      fieldsLayer.width = needW;
      fieldsLayer.height = needH;
    }
    const fctx = fieldsLayer.getContext('2d');
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, fieldsLayer.width, fieldsLayer.height);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.translate(-crop.left * scaleX, -crop.top * scaleY);
    drawFieldHighlights(fctx, fields, scaleX, scaleY);
  }

  // Values on overlay (above blue)
  if (overlay) {
    if (overlay.width !== needW || overlay.height !== needH) {
      overlay.width = needW;
      overlay.height = needH;
    }
    const ctx = overlay.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(-crop.left * scaleX, -crop.top * scaleY);

    // White covers below any new value: „Zellen löschen“ (on demand) and saved values
    // (feldwerte.json) that were changed or cleared in this session.
    for (const f of fields) {
      const key = fieldKey(f.page, f.number);
      const rect = api.fieldCovers?.get(key)?.rect_pt || storedDirtyCoverRect(api.storedValues, api.fieldValues, key);
      if (!rect) continue;
      drawWhiteBoxCanvas(ctx, rect, scaleX, scaleY);
      // Keep the light-blue field hint visible on the cover (clipped to the cover rect).
      const [cx0, cy0, cx1, cy1] = rect;
      ctx.save();
      ctx.beginPath();
      ctx.rect(cx0 * scaleX, cy0 * scaleY, (cx1 - cx0) * scaleX, (cy1 - cy0) * scaleY);
      ctx.clip();
      drawFieldHighlights(ctx, [f], scaleX, scaleY);
      ctx.restore();
    }
    for (const f of fields) {
      const key = fieldKey(f.page, f.number);
      const val = api.fieldValues.get(key);
      if (!val?.text) continue;
      if (inlineState && inlineState.key === key) continue; // inline editor covers this cell
      // Saved value unchanged: already printed in the page — never draw it twice.
      if (isStoredUnchanged(api.storedValues, key, val) && !api.fieldCovers?.has(key)) continue;
      // No automatic white box under values: only „Zellen löschen“ covers (drawn above).
      const color = colorCss(val.colorIndex ?? api.settings.colorIndex);
      const typ = val.type || f.type;
      if (typ === 'tap_initials_stamp') {
        drawInitialsStampInRect(ctx, val.text, f.rect_pt, color, scaleX, scaleY);
      } else {
        if (f.multiline || f.single_line) drawMultilineFieldText(ctx, val.text, f.rect_pt, color, scaleX, scaleY, f.font_size_pt, !!f.single_line);
        else drawCenteredFieldText(ctx, val.text, f.rect_pt, color, scaleX, scaleY, f.font_size_pt);
      }
    }
  }

  if (hit) {
    hit._fieldApi = api;
    hit.dataset.eraseMode = api.eraseMode?.() ? '1' : '';
    const keys = fields.map((f) => fieldKey(f.page, f.number)).join('|');
    if (hit.dataset.fieldKeys === keys && hit.children.length === fields.length) {
      // Same fields: keep the buttons (a tap that closes the inline editor must still reach its target).
      for (const btn of hit.children) {
        const k = btn.dataset.fieldKey;
        const filled = api.fieldValues.has(k) && !!api.fieldValues.get(k)?.text;
        btn.className = filled ? 'hit-cell hit-field filled' : 'hit-cell hit-field';
      }
    } else {
      hit.innerHTML = '';
      hit.dataset.fieldKeys = keys;
      for (const f of fields) {
        const key = fieldKey(f.page, f.number);
        const filled = api.fieldValues.has(key) && !!api.fieldValues.get(key)?.text;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = filled ? 'hit-cell hit-field filled' : 'hit-cell hit-field';
        btn.dataset.fieldKey = key;
        btn.setAttribute('aria-label', f.label || `Feld ${f.number}`);
        const pct = rectCssPercent(f.rect_pt, pageWidth, pageHeight, crop);
        btn.style.left = `${pct.left}%`;
        btn.style.top = `${pct.top}%`;
        btn.style.width = `${pct.width}%`;
        btn.style.height = `${pct.height}%`;
        btn.addEventListener('pointerdown', (e) => {
          const a = hit._fieldApi;
          if (a.eraseMode?.()) return; // „Zellen löschen“: Pencil taps cover like finger/mouse
          if (e.pointerType === 'pen' || a.isPenPointer(e)) {
            a.markPenStampSuppress();
            e.preventDefault();
            e.stopPropagation();
          }
        });
        btn.addEventListener('click', (e) => {
          const a = hit._fieldApi;
          if (a.shouldIgnoreStampClick(e)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          onFieldTap(f, pageIndex, a, wrap);
        });
        hit.appendChild(btn);
      }
    }
  }
}

/** White plate exactly over a rect (canvas, top-left origin). Used only by „Zellen löschen“. */
function drawWhiteBoxCanvas(ctx, rect, scaleX, scaleY) {
  const [x0, y0, x1, y1] = rect;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x0 * scaleX, y0 * scaleY, (x1 - x0) * scaleX, (y1 - y0) * scaleY);
  ctx.restore();
}

/** Cover rect of a field for „Zellen löschen“: white_rect_pt where defined (keeps printed form values), else rect_pt. */
export function coverRectForField(field) {
  return (field.white_rect_pt || field.rect_pt).slice();
}

/* ---------- Saved values (feldwerte.json) ---------- */

/** True when the value equals the one already saved (and printed) in the PDF. */
export function isStoredUnchanged(storedValues, key, val) {
  const base = storedValues?.get(key);
  return !!base && !!val?.text && String(val.text) === base.text;
}

/** Cover rect for a saved value that was changed or cleared in this session, else null. */
export function storedDirtyCoverRect(storedValues, fieldValues, key) {
  const base = storedValues?.get(key);
  if (!base) return null;
  const now = fieldValues.get(key)?.text || '';
  return now === base.text ? null : base.cover_rect_pt;
}

/**
 * Put saved values (feldwerte.json) back into fieldValues and remember them as the printed baseline.
 * Rows without a matching template field are returned as „extra“ and written back unchanged.
 * @returns {{applied:number, extra:object[]}}
 */
export function restoreStoredFieldValues(fieldValues, storedValues, data, template, templateId = '') {
  storedValues.clear();
  const extra = [];
  let applied = 0;
  if (!data?.fields?.length) return { applied, extra };
  // Saved with another field template: numbering may differ — keep the rows, apply none.
  if (data.template && templateId && data.template !== templateId) return { applied, extra: data.fields.slice() };
  const byKey = new Map();
  for (const blk of Object.values(template?.pages || {})) {
    for (const f of blk.fields || []) byKey.set(fieldKey(f.page, f.number), f);
  }
  for (const r of data.fields) {
    const key = fieldKey(r.page, r.number);
    const f = byKey.get(key);
    // Other template (Verbinden of different files) or unknown field: keep, do not apply.
    if (!f || (r.template && templateId && r.template !== templateId)) {
      extra.push(r);
      continue;
    }
    fieldValues.set(key, {
      page: f.page,
      number: f.number,
      id: f.id,
      type: f.type,
      text: r.text,
      colorIndex: Number.isInteger(r.color_index) ? r.color_index : 0,
      rect_pt: f.rect_pt,
      multiline: !!f.multiline,
      single_line: !!f.single_line,
      font_size_pt: f.font_size_pt,
    });
    storedValues.set(key, { text: r.text, cover_rect_pt: coverRectForField(f) });
    applied++;
  }
  return { applied, extra };
}

/** Rows for feldwerte.json: every current value (saved + new) plus unmatched extra rows. */
export function feldwerteRows(fieldValues, extra = []) {
  const rows = [];
  for (const [, v] of fieldValues) {
    if (!v?.text) continue;
    rows.push({ page: v.page, number: v.number, id: v.id, type: v.type, text: String(v.text), color_index: v.colorIndex ?? 0 });
  }
  return rows.concat(extra || []);
}

/** manual_text fields are edited inline in the cell unless the template sets "inline": false. */
export function isInlineField(field) {
  return field?.type === 'manual_text' && field.inline !== false;
}

function storeFieldValue(api, field, type, text) {
  api.fieldValues.set(fieldKey(field.page, field.number), {
    page: field.page,
    number: field.number,
    id: field.id,
    type,
    text,
    colorIndex: api.settings.colorIndex,
    rect_pt: field.rect_pt,
    multiline: !!field.multiline,
    single_line: !!field.single_line,
    font_size_pt: field.font_size_pt,
  });
}

/* ---------- Inline cell editor (manual_text) ---------- */

/** @type {null|{key:string,field:object,pageIndex:number,wrap:HTMLElement,api:object,el:HTMLElement,layer:HTMLElement,oldText:string,cleanup:()=>void}} */
let inlineState = null;

export function isInlineEditing() {
  return !!inlineState;
}

/** Close the inline editor (save=true keeps the typed text, false discards). */
export function closeInlineEditor(save = true) {
  const s = inlineState;
  if (!s) return;
  inlineState = null;
  s.cleanup();
  const raw = String(s.el.value ?? '');
  try { s.el.remove(); } catch (_) {}
  if (save) {
    const text = s.field.multiline
      ? raw.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '').trim()
      : raw.replace(/\s+/g, ' ').trim();
    if (text !== s.oldText) {
      const before = s.api.snapshotFieldKeys([s.key]);
      if (text) storeFieldValue(s.api, s.field, s.field.type, text);
      else s.api.fieldValues.delete(s.key);
      s.api.pushUndo({ kind: 'fields', pageIndex: s.pageIndex, before });
    }
  }
  s.api.redrawPage(s.pageIndex);
  s.api.onInlineEditorClosed?.();
}

function inlineLayer(wrap) {
  let layer = wrap.querySelector('.inline-edit-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'inline-edit-layer';
    wrap.appendChild(layer);
  }
  syncFieldsLayer(wrap, layer);
  return layer;
}

/** Position/size the editor from rect_pt and the current page scale; text size = filled text size. */
function layoutInlineEditor(s) {
  const { wrap, field, el, layer } = s;
  const pw = Number(wrap.dataset.pageWidth);
  const ph = Number(wrap.dataset.pageHeight);
  syncFieldsLayer(wrap, layer);
  const { scaleX, scaleY, crop } = s.api.pageScales(wrap, pw, ph);
  const [x0, y0, x1, y1] = field.rect_pt;
  const L = (x0 - crop.left) * scaleX;
  const T = (y0 - crop.top) * scaleY;
  const W = (x1 - x0) * scaleX;
  const H = (y1 - y0) * scaleY;
  const free = field.multiline || field.single_line;
  let fpx;
  if (free) fpx = (field.font_size_pt || 9) * scaleY;
  else {
    const pad = Math.max(1, Math.min(W, H) * 0.08);
    fpx = Math.min((H - pad * 2) * 0.85, 28);
    if (field.font_size_pt) fpx = Math.min(fpx, field.font_size_pt * scaleY);
  }
  fpx = Math.max(4, fpx);
  // Visible box: the cell, at least ~1.6 lines tall and ~5 em wide (tiny Istwert cells).
  const visW = Math.max(W, field.multiline ? W : fpx * 5);
  const visH = field.multiline ? H : Math.max(H, fpx * 1.6);
  const layerW = layer.offsetWidth || W;
  let left = free ? L : L - (visW - W) / 2;
  left = Math.max(0, Math.min(left, layerW - visW));
  const top = T - (visH - H) / 2;
  // iOS zooms into inputs with font-size < 16px: keep 16px computed size, scale the box down.
  const k = fpx < 16 ? fpx / 16 : 1;
  const cssFont = fpx < 16 ? 16 : fpx;
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.width = `${visW / k}px`;
  el.style.height = `${visH / k}px`;
  el.style.transform = k === 1 ? '' : `scale(${k})`;
  el.style.fontSize = `${cssFont}px`;
  const padPx = (1.5 * scaleX) / k;
  el.style.padding = field.multiline ? `${(1.5 * scaleY) / k}px ${padPx}px` : `0 ${padPx}px`;
  el.style.lineHeight = field.multiline ? '1.2' : `${visH / k}px`;
  el.style.textAlign = free ? 'left' : 'center';
  // Keep the focus ring ~2 px on screen regardless of the scale-down.
  el.style.outlineWidth = `${2 / k}px`;
  el.style.boxShadow = `0 0 0 ${4 / k}px rgba(47, 111, 174, 0.25)`;
}

function openInlineEditor(field, pageIndex, api, wrap) {
  closeInlineEditor(true);
  const key = fieldKey(field.page, field.number);
  const oldText = String(api.fieldValues.get(key)?.text || '');
  const layer = inlineLayer(wrap);
  const ed = document.createElement(field.multiline ? 'textarea' : 'input');
  if (!field.multiline) ed.type = 'text';
  ed.className = field.multiline ? 'inline-field-editor multiline' : 'inline-field-editor';
  ed.value = oldText;
  ed.setAttribute('autocapitalize', 'sentences');
  ed.setAttribute('autocorrect', 'on');
  ed.setAttribute('spellcheck', 'false');
  ed.setAttribute('enterkeyhint', field.multiline ? 'enter' : 'done');
  ed.setAttribute('aria-label', fieldDialogTitle(field, 'Text'));
  ed.dataset.fieldKey = key;
  ed.style.color = colorCss(api.settings.colorIndex);
  ed.style.fontFamily = field.multiline || field.single_line
    ? 'Helvetica, Arial, sans-serif'
    : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  layer.appendChild(ed);

  const s = { key, field, pageIndex, wrap, api, el: ed, layer, oldText, cleanup: () => {} };
  inlineState = s;
  layoutInlineEditor(s);
  api.redrawPage(pageIndex); // hide the old canvas text under the editor

  const onKey = (e) => {
    if (e.isComposing) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeInlineEditor(false);
    } else if (e.key === 'Enter' && (!field.multiline || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      e.stopPropagation();
      closeInlineEditor(true);
    }
  };
  const onBlur = () => {
    if (inlineState === s) closeInlineEditor(true);
  };
  // iOS does not blur an input when tapping non-focusable page areas: treat a tap outside as „fertig“.
  let downAt = null;
  const onDocDown = (e) => {
    downAt = ed.contains(e.target) ? null : { x: e.clientX, y: e.clientY };
  };
  const onDocUp = (e) => {
    if (!downAt || ed.contains(e.target)) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved < 10 && inlineState === s) closeInlineEditor(true);
  };
  const onResize = () => {
    if (inlineState === s) layoutInlineEditor(s);
  };
  ed.addEventListener('keydown', onKey);
  ed.addEventListener('blur', onBlur);
  document.addEventListener('pointerdown', onDocDown, true);
  document.addEventListener('pointerup', onDocUp, true);
  window.addEventListener('resize', onResize);
  s.cleanup = () => {
    ed.removeEventListener('keydown', onKey);
    ed.removeEventListener('blur', onBlur);
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('pointerup', onDocUp, true);
    window.removeEventListener('resize', onResize);
  };

  try { ed.focus({ preventScroll: true }); } catch (_) { ed.focus(); }
  const end = ed.value.length;
  try { ed.setSelectionRange(end, end); } catch (_) {}
  if (field.multiline) ed.scrollTop = ed.scrollHeight;
  try { ed.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) {}
}

async function onFieldTap(field, pageIndex, api, wrap) {
  const key = fieldKey(field.page, field.number);
  // Any tap on a field finishes an open inline edit first.
  if (inlineState && inlineState.key !== key) closeInlineEditor(true);
  const before = api.snapshotFieldKeys([key]);

  // „Zellen löschen“: remove this session's value (if any) and white-cover the field. One undo step.
  if (api.eraseMode?.()) {
    if (!api.fieldCovers || api.fieldCovers.has(key)) return; // already covered: nothing more
    if (inlineState?.key === key) closeInlineEditor(false);
    api.fieldValues.delete(key);
    api.fieldCovers.set(key, { page: field.page, number: field.number, id: field.id, rect_pt: coverRectForField(field) });
    api.pushUndo({ kind: 'cover', pageIndex, key, before });
    api.redrawPage(pageIndex);
    return;
  }

  // Free text: edit directly in the cell, pre-filled with the current text.
  if (isInlineField(field) && wrap) {
    if (inlineState?.key === key) return;
    openInlineEditor(field, pageIndex, api, wrap);
    return;
  }

  // Toggle clear if already filled (simple types)
  if (api.fieldValues.has(key) && api.fieldValues.get(key)?.text) {
    // For scan/manual/text/date — offer clear on second tap
    api.fieldValues.delete(key);
    api.pushUndo({ kind: 'fields', pageIndex, before });
    api.redrawPage(pageIndex);
    return;
  }

  const type = field.type;
  let text = null;

  if (type === 'tap_ok') {
    text = field.value || 'OK';
  } else if (type === 'tap_x') {
    text = field.value || 'X';
  } else if (type === 'tap_date_settings') {
    text = stampDateForSettings(api.settings);
  } else if (type === 'tap_initials_stamp') {
    text = stampInitialsForSettings(api.settings);
    if (!text) {
      api.showToast('Bitte Initialen in den Einstellungen setzen.');
      api.openSettings();
      return;
    }
  } else if (type === 'tap_lager_clerk') {
    text = stampLagerClerkForSettings(api.settings);
    if (!text) {
      api.showToast('Bitte Sachbearbeiter Lager in den Einstellungen setzen.');
      api.openSettings();
      return;
    }
  } else if (type === 'manual_text') {
    text = await api.promptFieldInput({
      title: fieldDialogTitle(field, 'Text'),
      kind: 'text',
      initial: '',
      placeholder: '',
      autocapitalize: 'sentences',
    });
    if (text == null) return;
    text = String(text).trim();
    if (!text) return;
  } else if (type === 'manual_date') {
    // Software-Datum etc.: never prefill with today's stamp date — always empty for manual entry.
    text = await api.promptFieldInput({
      title: fieldDialogTitle(field, 'Datum'),
      kind: 'date',
      initial: '',
      placeholder: 'TT.MM.JJ',
    });
    if (text == null) return;
    text = normalizeStampDateYY(text);
    if (!text) return;
  } else if (type === 'scan_or_manual') {
    text = await api.promptFieldInput({
      title: fieldDialogTitle(field, 'Scan / Eingabe'),
      kind: 'scan_or_manual',
      initial: '',
      placeholder: 'Wert oder scannen',
    });
    if (text == null) return;
    text = String(text).trim();
    if (!text) return;
  } else {
    api.showToast(`Feldtyp „${type}“ nicht unterstützt.`);
    return;
  }

  storeFieldValue(api, field, type, text);
  api.pushUndo({ kind: 'fields', pageIndex, before });
  api.redrawPage(pageIndex);
}

/**
 * Write field values into pdf-lib document (no blue overlays).
 */
export async function embedFieldValuesInPdf(pdfDoc, pages, fieldValues, settings, fieldCovers = null, storedValues = null) {
  const fonts = await createPdfFontBag(pdfDoc);
  // Preload Liberation Sans only when at least one value needs non-WinAnsi glyphs.
  await fonts.preloadFor([...fieldValues.values()].map((v) => v?.text).filter(Boolean));

  const whiteRect = (pageNo, rect) => {
    const page = pages[(pageNo || 1) - 1];
    if (!page || !rect) return;
    const { height: pageHeight } = page.getSize();
    const [wx0, wy0, wx1, wy1] = rect;
    page.drawRectangle({ x: wx0, y: pageHeight - wy1, width: wx1 - wx0, height: wy1 - wy0, color: rgb(1, 1, 1), borderWidth: 0, opacity: 1 });
  };
  // Covers first, so new values are drawn on top of them: „Zellen löschen“ …
  for (const [, cov] of fieldCovers || []) whiteRect(cov.page, cov.rect_pt);
  // … and saved values (feldwerte.json) that were changed or cleared: cover, then the full new text.
  for (const [key] of storedValues || []) {
    if (fieldCovers?.has(key)) continue;
    const rect = storedDirtyCoverRect(storedValues, fieldValues, key);
    if (rect) whiteRect(Number(String(key).split(':')[0]), rect);
  }

  for (const [key, val] of fieldValues) {
    if (!val?.text || !val.rect_pt) continue;
    // Unchanged saved value: already printed — do not render twice.
    if (isStoredUnchanged(storedValues, key, val) && !fieldCovers?.has(key)) continue;
    const pageIndex = (val.page || 1) - 1;
    const page = pages[pageIndex];
    if (!page) continue;
    const { height: pageHeight, width: pageWidth } = page.getSize();
    const [x0, y0, x1, y1] = val.rect_pt;
    // rect is top-left origin → pdf-lib bottom-left
    const w = x1 - x0;
    const h = y1 - y0;
    const x = x0;
    const y = pageHeight - y1;

    const c = colorRgb01(val.colorIndex ?? settings.colorIndex);
    const textColor = rgb(c.r, c.g, c.b);
    const text = String(val.text);
    if (val.multiline || val.single_line) {
      const fit = fitMultilineText(text, val.rect_pt, val.font_size_pt, (s, pt) => fonts.widthOf(s, pt, false), !!val.single_line);
      fit.lines.forEach((ln, i) => {
        if (!ln) return; // empty line from Enter: keep spacing, nothing to draw
        fonts.drawText(page, ln, {
          x: x0 + fit.pad,
          y: pageHeight - (y0 + fit.padY + i * fit.lineH + fit.lineH * 0.5 + fit.size * 0.35),
          size: fit.size,
          color: textColor,
        }, false);
      });
      continue;
    }
    const isInitials = val.type === 'tap_initials_stamp';
    // OK / serials / dates share regular weight — only initials stamps stay bold.
    const { font, text: drawStr } = fonts.prepare(text, isInitials);

    let size = Math.min(h * 0.72, val.font_size_pt || 14);
    const maxW = Math.max(2, w - 2);
    while (size > 4 && font.widthOfTextAtSize(drawStr, size) > maxW) {
      size -= 0.25;
    }
    const tw = font.widthOfTextAtSize(drawStr, size);

    if (isInitials) {
      // White plate + colored stroke box (Umrandung) around initials
      const inset = Math.max(0.5, Math.min(w, h) * 0.06);
      page.drawRectangle({
        x: x + inset * 0.35,
        y: y + inset * 0.35,
        width: Math.max(1, w - inset * 0.7),
        height: Math.max(1, h - inset * 0.7),
        color: rgb(1, 1, 1),
        borderWidth: 0,
        opacity: 0.92,
      });
      const padX = Math.max(2.5, size * 0.32);
      const padY = Math.max(1.2, size * 0.16);
      let boxW = Math.min(maxW, tw + padX * 2);
      let boxH = Math.min(h - inset * 2, Math.max(size * 1.1, size + padY * 2));
      const bx = x + Math.max(0, (w - boxW) / 2);
      const by = y + Math.max(0, (h - boxH) / 2);
      page.drawRectangle({
        x: bx,
        y: by,
        width: boxW,
        height: boxH,
        borderColor: textColor,
        borderWidth: Math.max(0.9, Math.min(1.8, size * 0.1)),
      });
    }

    // Vertical center approx: baseline ~ mid - size*0.35
    const tx = x + Math.max(0, (w - tw) / 2);
    const ty = y + h / 2 - size * 0.35;
    fonts.drawText(page, drawStr, {
      x: tx,
      y: ty,
      size,
      color: textColor,
    }, isInitials);
  }
}

export function serializeFieldValues(fieldValues) {
  const arr = [];
  for (const [key, val] of fieldValues) {
    if (!val?.text) continue;
    arr.push([val.page, val.number, val.text, val.colorIndex ?? 0]);
  }
  return arr;
}

export function parseFieldValuesFromKeywords(keywords) {
  if (!keywords) return [];
  const str = Array.isArray(keywords) ? keywords.join(',') : String(keywords);
  const m = str.match(/glfill=([^;]*)/);
  if (!m) return [];
  try {
    const json = decodeURIComponent(m[1]);
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (_) {
    return [];
  }
}

export function applyParsedFieldValues(fieldValues, parsed, template) {
  fieldValues.clear();
  if (!parsed?.length || !template) return;
  const byKey = new Map();
  for (const pageKey of Object.keys(template.pages || {})) {
    for (const f of template.pages[pageKey].fields || []) {
      byKey.set(fieldKey(f.page, f.number), f);
    }
  }
  for (const row of parsed) {
    const [page, number, text, colorIndex] = row;
    const f = byKey.get(fieldKey(page, number));
    if (!f || !text) continue;
    fieldValues.set(fieldKey(page, number), {
      page,
      number,
      id: f.id,
      type: f.type,
      text: String(text),
      colorIndex: colorIndex ?? 0,
      rect_pt: f.rect_pt,
      multiline: !!f.multiline,
      single_line: !!f.single_line,
      font_size_pt: f.font_size_pt,
    });
  }
}
