# webTopdf

A Chrome extension that turns the current webpage into a PDF, with a companion installation website. Built by Mulham Kassab.

## What it does

- **Visual PDF:** captures the full loaded page or current viewport and downloads a paginated PDF locally. This mode preserves the visible appearance; the captured text is part of the image and is not selectable.
- **Print PDF:** opens the browser's print preview for text-friendly, searchable PDFs when the source page supports them. Select **Save as PDF** and save in the browser dialog.
- A4 or Letter, portrait or landscape, margins, capture quality, source/date footer, and saved preferences.
- Hide selected page elements, undo removals, and restore the page. Long captures omit repeated sticky elements and restore the scroll position afterward.
- Page processing stays in the browser. No accounts, conversion server, remote scripts, analytics, or page-content uploads.

## Install from the Chrome Web Store

1. Open [webTopdf on the Chrome Web Store](https://chromewebstore.google.com/detail/webtopdf/mjaclamnjdmipobljileifmgkppiaeeb).
2. Click **Add to Chrome**, then confirm **Add extension**.
3. Pin webTopdf from Chrome’s extensions menu, open a regular webpage, and use the extension.

The store handles installation and updates. Use **Alt+Shift+P** to export with the last saved settings (subject to other browser shortcut assignments).

### Manual installation

The website retains an optional ZIP download under **Prefer a manual installation?** for local development or an unpacked installation.

1. Download and unzip `webtopdf-extension.zip` from the website.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder containing `manifest.json`.
4. Pin webTopdf, open a regular webpage, and use the extension.

Keep the extracted folder in place. To update an unpacked installation, replace its files and click **Reload** at `chrome://extensions`.

## Develop

Requires Node.js 24.

```sh
npm ci
npm run build
npm test
npm run dev
```

`npm run dev` serves the companion website at `http://127.0.0.1:4387`. `npm run build` bundles the pinned jsPDF library into the extension and creates the installable ZIP in `website/downloads/` and `.artifacts/`.

Extension icons are tracked, ready to use, and can be regenerated with `python scripts/generate-icons.py` when Pillow is installed.

## Repository layout

```text
extension/    Manifest V3 extension, popup, capture engine, local PDF renderer
website/      Chrome Web Store link, optional ZIP, install guide, and privacy page
scripts/      Build, packaging, source checks, and local preview
tests/        Capture geometry and PDF rendering regression checks
```

## Deployment

Import this repository into Vercel. The root `vercel.json` sets `npm run build` and the `website` output directory. Updates are published to `main`; the existing Git-connected production branch is `codex/pagepress`, which is kept at the same release commit. Add `webtopdf.mulhamkassab.dev` to the Vercel project and create the CNAME Vercel specifies at the domain's DNS provider. The portfolio links to the product site and Chrome Web Store listing.

## Permissions and limits

`activeTab` provides access only after a user action; `scripting` prepares the selected page; `downloads` saves the PDF; `storage` remembers settings and progress; `offscreen` assembles PDF pages without a large foreground window. webTopdf does not ask for persistent access to every website, browser history, or the debugger.

Chrome restricts extension access on browser-internal pages and some protected pages. Full-page capture is bounded to avoid excessive memory use. Pages with infinite scrolling, virtualized lists, internal scroll regions, or rapidly changing layouts may need viewport capture or Print PDF. Keep the captured tab active until export finishes. Content that has not loaded is not part of the capture.

The companion website links to the Chrome Web Store, provides an optional extension ZIP, and explains both installation paths. Webpage export runs through the extension in Chrome; the website does not accept arbitrary URLs or fetch pages for conversion.

## License

MIT. jsPDF is bundled locally under its MIT license; its license is included in the release ZIP. No third-party code is fetched by the extension at runtime.
