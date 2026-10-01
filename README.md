# Geräte Laufzettel (PWA)

Offline-fähige PWA: DataMatrix scannen → Seriennummer → Laufzettel-PDF öffnen und ausfüllen.

## Ablauf

1. App öffnen (HTTPS oder `localhost`)
2. DataMatrix scannen (oder Code einfügen / Beispiel laden)
3. Seriennummer = Text **nach dem letzten Bindestrich**  
   Beispiel: `DE-200.433-…-BS0180E01A21K0103` → `BS0180E01A21K0103`
4. PDF öffnen: Dateiname `DE-{Artikel}-{SN}.pdf` oder `{SN}.pdf`  
   Suche: Ordner-Handle → IndexedDB-Katalog → `samples/`

## Felder ausfüllen (Vorlage 200.433)

- Hellblaue Markierungen zeigen tippbare Felder (nur UI, **nicht** in der gespeicherten PDF).
- Tippen: OK / Datum / Initialen / X / Text / Scan-oder-Eingabe je nach Feld.
- Apple Pencil: frei zeichnen und Unterschriften (Seite 3).
- Einstellungen: Feldvorlage (Auto aus `DE-…` oder manuell), Stempel-Datum `TT.MM.JJ`, Initialen.

## Lokal starten

```bash
cd geraete-laufzettel
python3 -m http.server
```

Dann http://localhost:8000 — ohne Kamera: „Beispiel-Code“ oder „Beispiel-DataMatrix laden“.

## Wichtige Dateien

| Pfad | Rolle |
|------|--------|
| `samples/DE-200.433-BS0180E01A21K0103.pdf` | Demo-Laufzettel (Header-Dateiname) |
| `samples/index.json` | Sample-Liste für SN-Auflösung |
| `samples/datamatrix-demo.png` | Demo-DataMatrix → SN **BS0180E01A21K0103** |
| `data/template-200.433.json` | Feldgeometrie + Aktionen |
| `js/catalog.js` | PDF nach SN finden |
| `js/fields.js` / `js/field-fill.js` | Vorlage + Overlay/Save |
| `js/fill.js` | Fill-Modus (PDF, Pencil, Speichern) |

## Deploy

Netlify Drop: Ordnerinhalt von `geraete-laufzettel/` hochladen (siehe `DEPLOY.txt`). Kein Build-Schritt. **Kein Zip erstellen/senden**, außer ausdrücklich gewünscht.

## GitHub Pages

https://beak-electronic.github.io/geraete-laufzettel/
