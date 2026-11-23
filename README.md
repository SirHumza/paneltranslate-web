# PanelTranslate
A browser-local comic lettering and translation workspace for GitHub Pages. Open images, select their source language and choose **Translate page**. Review or correct each transcript and English translation. Switch between original and translated views. Save the PNG and editable dialogue JSON before closing the tab.

The first run downloads OCR software, language data and translation weights. Pages and dialogue are processed on the device. The editor shell is cached after the first successful visit. Full offline inference depends on the browser retaining every runtime and model asset. Large downloads can be slow on mobile devices.

## Running and publishing
Serve this directory using any static HTTP server, e.g. `python3 -m http.server 8000` and open http://localhost:8000. For GitHub Pages choose Deploy from a branch, main, root. No API keys or build step.

## Scope
Image files supported by the browser, sequential page review, manual region selection, editable OCR, local English translation, conservative lettering on opaque light backgrounds, and per-page PNG/JSON export. Multi-image input is naturally sorted. Select each page to process it. The renderer leaves difficult backgrounds or overflowing text intact and reports the reason. Low-confidence OCR regions need explicit enabling. Missing detections need manual review. To add one, drag its rectangle, enter the source text, then translate. Redraw from the original whenever you edit.

The initial version uses geometric OCR blocks and per-block translation. Automatic language selection, validated chapter context, comic-specific panel detection, archive/PDF import, detailed-background reconstruction and project memory remain open work. Decoded pages are limited to 32 megapixels. Confirm browser support and example output on your device before translating a full chapter.

See ENGINE.md for upstream runtimes and model identifiers. Apache-2.0 covers original project code and the synthetic two-bubble example.

## Measured example
Chrome on Intel macOS recovered both Indonesian blocks in examples/indonesian.png (OCR confidence 96 and 95), produced two English regions, and exported 1000 × 700 pixels. A sentence-count retry recovered an omitted clause. The phrasing “I just heard it the first time” still benefits from editing. Inspect examples/indonesian.en.png and examples/indonesian.json. This synthetic result covers plain white speech bubbles.

Open tests/render.html on the served site for pixel-preservation checks. To run the public UI integration test, install Python Playwright and Chromium, serve the site, and run python tests/browser.py. PANELTRANSLATE_URL selects the deployment and CHROME_BIN can select an existing Chrome installation.
