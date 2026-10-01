# BUILD_NOTES — Geräte Laufzettel PWA

## Adaptation from BG-Laufzettel-Generator-Web

- Renamed product to **Geräte Laufzettel** (manifest, titles, cache `geraete-laufzettel-v8`, README, DEPLOY).
- Home flow: **Scan DataMatrix → extract SN → open PDF**.
- Fill mode: Geräte field overlays (template `200.433`) + Apple Pencil ink + Speichern/Share.
- DataMatrix: vendored `@zxing/library` UMD as `vendor/zxing-library.min.js`.
- SN helper: `js/sn.js` → `extractSerialFromPayload` (text after last `-`).
- Catalog: `js/catalog.js` resolves by SN against `…-{SN}.pdf` or `{SN}.pdf` — directory handle → IndexedDB → `samples/` (via `samples/index.json`). User imports win over demos.

## Verified

| Test | Result |
|------|--------|
| ZXing decode sample PNG | `DE-200.433-PA180DM-SPEKTRA-V1-BS0180E01A21K0103` |
| `extractSerialFromPayload` | → `BS0180E01A21K0103` |
| `serialFromPdfFilename` | `DE-200.433-BS0180….pdf` → `BS0180…` |
| `findPdfBySerial` | IDB/folder before samples; smoke in `test/catalog-smoke.html` |
| Fill smoke (`?open=…`) | 3 pages, 86 blue hit fields (no p1 #15/#16), tap_ok fills |
| `python3 -m http.server` | index 200, assets present |

## Field overlays (2026-09-15)

- Geometry + capabilities: `data/template-200.433.json` (from analysis JSONs).
- UI blue `#ADD8E6` @ ~59% α on `canvas.fields-layer` **under** stamp/ink (never written into saved PDF).
- Behaviors for template **200.433**: scan_or_manual / tap_ok / manual_date / tap_date_settings / tap_initials_stamp / manual_text / tap_x; page 3 checkboxes + stamp dates; Unterschrift = Pencil only.
- Settings: field template Auto (`DE-{article}-…`) + manual `200.433`; stamp date `TT.MM.JJ`; stamp initials.
- Save embeds centered field text + ink; keywords `glfill=` for restore.

## iPad PDF catalog (1.1)

- `mergePdfsFromFileList` keys by **canonical serial** (after last `-`, uppercased, Unicode dashes normalized), stores ArrayBuffers in IDB `pdfs`.
- Home banner CTA when `autoRefreshPrompt !== false` and no directory picker.

## Gaps

- Only template **200.433** is fully specified; other articles need their own geometry/capabilities.
- iOS Safari: no `showDirectoryPicker`; multi-file pick → IndexedDB. Camera needs HTTPS (or localhost).
- Legacy BG grid code remains in `fill.js` as fallback if no template loads.

## Service Worker (v8)

- Cache `geraete-laufzettel-v8`. Assets include `js/fields.js`, `js/field-fill.js`, `data/template-200.433.json`, DE-named sample + `samples/index.json`.


## Catalog fix (IDB after PDFs aktualisieren)

- Root cause: `findPdfBySerial` tried `samples/` (network fetches) **before** IndexedDB, so imports were delayed/skipped on flaky mobile nets; SN keys were case-sensitive and Unicode dashes in filenames yielded wrong IDB keys.
- Fix: folder → IDB → samples; `canonicalizeSerial` (uppercase + dash normalize); IDB filename cursor fallback; sample fetch timeout.
- Smoke: `test/catalog-smoke.html` (serve repo root over HTTP).

## iOS Home Screen icon (v18)

- Versioned filenames **without** `?v=` query strings (Apple often fails those): `apple-touch-icon-v18.png`, `icons/icon-{180,192,512}-v18.png`.
- `index.html` uses **relative** `href`s (no leading `/`). Manifest icons are relative, no query, 192/512 `any` + 512 `maskable`.
- PNGs are opaque RGB (magenta GL artwork). SW cache `geraete-laufzettel-v18` lists the new files.
- **After deploy:** delete the old Home Screen icon / bookmark on the iPad, then **Add to Home Screen** again. A normal refresh will not refresh the icon.

## iPad camera close (v18)

- Field scan uses fullscreen fixed `#field-scan-overlay` (not nested `<dialog>`).
- ZXing video decode downscales to max width ~640, yields (`setTimeout(0)`) before sync decode, checks `signal.aborted` before/after, interval ~400ms.
- `stopFieldScan` / home `stopScanning` abort controller + stop all MediaStream tracks + clear `srcObject` + hide overlay.
