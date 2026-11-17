# AGENTS.md — webTopdf (repo: pagepress)

Guide for coding agents and new contributors. Read this before you change anything.
Last reviewed: 18 Nov 2026 (launch audit, branch `launch/audit`). Audit outputs: [docs/launch/BUGS.md](docs/launch/BUGS.md), [docs/launch/LAUNCH-PLAN.md](docs/launch/LAUNCH-PLAN.md).

## 1. What this is and who it is for

**webTopdf** is a Chrome extension (Manifest V3) that saves the current webpage as a PDF, by Mulham Kassab. It is live on the Chrome Web Store:
https://chromewebstore.google.com/detail/webtopdf/mjaclamnjdmipobljileifmgkppiaeeb (version 1.1.0; the store page shows "Updated October 13, 2026").

- **Visual PDF**: scroll-and-screenshot capture of the full page or the current view, stitched into a paginated image PDF (text is not selectable).
- **Searchable print**: injects print CSS and opens Chrome's print dialog; the user picks "Save as PDF".
- Options: A4/Letter, portrait/landscape, margins, image quality, source/date/page-number footer, "avoid repeated sticky headers", "preload images", presets, **Pick & hide** (click page elements to hide them before export), and an **Alt+Shift+P** quick-save shortcut.
- Everything runs locally in the browser. No accounts, no server, no analytics.

Audience: everyday Chrome users who want to keep an article, recipe, receipt or research page as a PDF.

A small **companion website** at https://webtopdf.mulhamkassab.dev (static HTML on Vercel) links to the store, offers an optional ZIP for a manual install, and hosts the privacy policy the store requires.

### Names: "PagePress" vs "webTopdf"

The product was built as **PagePress** and renamed **webTopdf** in 1.1.0 (commit `9afe4f1`). Everything the user sees says webTopdf. The old name remains in internals:

| Where | Name used |
| --- | --- |
| Store listing, `extension/manifest.json` name, popup, website, privacy page, README, `store/*` | webTopdf |
| GitHub repo `MulhamKassab/pagepress`, all support/issue URLs, `release.json` `source` | pagepress |
| `package.json` / `package-lock.json` `"name": "pagepress"` | pagepress |
| Vercel project `pagepress` and its `pagepress-*.vercel.app` aliases | pagepress |
| `extension/content.js`: `__PAGEPRESS_CONTENT__` guard, `data-pagepress`, `data-pagepress-unclip`, `data-pagepress-static` | pagepress (internal markers) |
| `scripts/build.mjs`: also writes `website/downloads/pagepress-extension.zip` (old link kept alive) | pagepress |
| Env vars `PAGEPRESS_CHROMIUM_PATH`, `PAGEPRESS_HEADED`; `serve.mjs` log line; smoke fixture title | PagePress |
| Tests: runtime IDs `pagepress-*`, blob URLs, PDF title "PagePress PDF integration" (asserted) | PagePress |
| `docs/RELEASE_NOTES_1.0.0–1.0.2.md` (historical) | PagePress |
| Old domain `pdf.mulhamkassab.dev` → 308 redirect to `webtopdf.mulhamkassab.dev` | — |

The spelling is **webTopdf** (lower-case w, capital T, lower-case pdf). One commit message says "WebToPdf"; the site eyebrow says "WEB TO PDF". Do **not** rename the `data-pagepress*` attributes or the `__PAGEPRESS_CONTENT__` guard casually; see trap 3 below.

## 2. Branches: which one is real

| Branch | Role |
| --- | --- |
| `codex/pagepress` | **GitHub default branch and Vercel's production branch.** Every production deployment of the website so far came from this branch. |
| `main` | Kept identical to `codex/pagepress` (the README says "Updates are published to `main`; … `codex/pagepress` … is kept at the same release commit"). Mulham's local copy uses `main`. A push to `main` alone does **not** update the production website. |

On 18 Nov 2026 both branches pointed at the same commit, `74e12d7` ("Link WebToPdf installation to the Chrome Web Store"), and so did the live website (checked file by file, ignoring CRLF).

- **Store build:** the extension folder last changed in `9afe4f1` (tag `v1.1.0`, GitHub pre-release "webTopdf 1.1.0"). The release asset `webtopdf-extension-v1.1.0.zip` (166,925 bytes) is almost certainly what the store shows as 1.1.0 (updated 13 Oct 2026); it was not compared byte for byte. Commits after `9afe4f1` changed only docs, store text and the website, so the extension code at `74e12d7` equals the published 1.1.0.
- **Rule for agents:** branch from `codex/pagepress`. When a change is released, fast-forward **both** `codex/pagepress` and `main` to the same commit and tag it `vX.Y.Z`. Never let them diverge.
- Audit work lives on `launch/audit` (docs only).

## 3. Stack and versions

- Extension: plain JavaScript ES modules, **no bundler, no framework, no TypeScript**. MV3 service worker (`type: module`), an offscreen document, and an injected content script. `minimum_chrome_version: 116` (`chrome.runtime.getContexts`).
- PDF engine: **jsPDF 4.2.1** (`dependencies`), copied by the build into `extension/vendor/jspdf.umd.min.js`, together with its license. Only `addImage`/`text` are used. jsPDF's optional `html()` dependencies (DOMPurify, html2canvas, canvg) are referenced by name inside the UMD file but are **not shipped** and never called.
- Build tool: **fflate 0.8.2** (devDependency) for ZIP packaging.
- Runtime: **Node.js 24.x** (`engines`; tested with 24.19.0, npm 11.17.0).
- Website: hand-written static HTML/CSS plus a 15-line `app.js`; no build step other than copying the ZIP.
- Browser tests: **Playwright**, which is **not** in `package.json`. The smoke scripts import `playwright`, or fall back to a hard-coded Codex runtime path under `~/.cache/codex-runtimes/...` (trap 6).

## 4. Folder map

```text
extension/            The product. Everything in here (plus vendor/) is zipped and uploaded to the store.
  manifest.json       MV3 manifest: name, version, permissions, Alt+Shift+P command, CSP.
  background.js       Service worker: message router, export pipeline, capture throttle, downloads, badge.
  content.js          Injected into the page on demand: measure, scroll, sticky/fixed handling, Pick & hide, print CSS, restore.
  offscreen.html/.js  Offscreen document: draws screenshot tiles onto page canvases and builds the PDF with jsPDF.
  lib/geometry.js     Pure functions: option normalising, tile plan, PDF layout, page slicing, safe filename. Unit-tested.
  popup.html/.js/.css The toolbar popup UI (CSS is minified onto one line).
  icons/              16/32/48/128 PNG icons and logo.svg (logo.svg is copied from website/brand by the build).
  vendor/             Generated by the build (git-ignored): jsPDF and its license.
  LICENSE             Copied from the root LICENSE by the build (tracked).
website/              Companion site served by Vercel as-is (outputDirectory).
  index.html, install.html  Store link, 3-step guide, optional manual ZIP install (nearly identical pages).
  privacy.html        The privacy policy linked from the store listing.
  downloads/          release.json (tracked; rewritten by every build) and the built ZIPs (git-ignored).
  brand/logo.svg      Logo and favicon.
scripts/              build.mjs (vendor + ZIP + release.json), check.mjs (syntax check), serve.mjs (local site),
                      extension-smoke.mjs / site-smoke.mjs (Playwright, local only), store-assets.mjs (store PNGs),
                      package-store.mjs (submission kit ZIP), generate-icons.py (Pillow).
tests/                node:test unit/integration tests with mocked chrome.* APIs (geometry, background, content, PDF).
store/                Store listing text, privacy-form answers, permission justifications and the upload PNGs.
docs/                 Store-prep notes and per-release notes. docs/launch/ holds the launch audit.
.artifacts/           Build and test output (git-ignored): versioned ZIPs, smoke reports, screenshots.
```

## 5. Install, run, test, build (local)

```sh
npm ci                  # installs jspdf + fflate (core-js has a postinstall script that npm's allow-scripts may warn about)
npm run check           # node --check on every .js/.mjs and JSON.parse on every .json (syntax only; no lint or types)
npm test                # node --test tests/*.test.mjs; 24 tests
npm run build           # vendors jsPDF into extension/vendor, writes website/downloads/*.zip, .artifacts/webtopdf-extension-vX.Y.Z.zip, release.json
npm run verify          # check + test + build
npm run dev             # serves website/ at http://127.0.0.1:4387 (PORT overrides)
```

Load the extension for manual testing: run `npm run build` first (it creates `extension/vendor/`), then go to `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `extension/`.

Browser smoke tests (optional; local fixture, throwaway profile, external requests blocked):

```sh
PAGEPRESS_CHROMIUM_PATH="<path to chrome or msedge>" node scripts/extension-smoke.mjs   # writes .artifacts/browser-smoke/report.json
PAGEPRESS_CHROMIUM_PATH="<path>" node scripts/site-smoke.mjs
```

Branded Google Chrome (version 137 and later) ignores `--load-extension`. Use Playwright's Chromium, Chrome for Testing, or Microsoft Edge. On the audit machine, Playwright's Chromium builds were blocked from launching (exit 126); Edge worked. Because Playwright cannot press the toolbar button, the extension smoke test falls back to a **test copy** of the extension with `<all_urls>`. The production manifest is hashed before and after to prove it was not changed.

**Before committing, run `git status`.** `npm run build` rewrites the tracked `website/downloads/release.json` (the ZIP size changes with OS line endings). It also re-copies `extension/LICENSE` and `extension/icons/logo.svg`. Revert these unless you are cutting a release.

## 6. Environment variables

There are no secrets and no `.env` file. The extension and website need **no** environment variables.

| Name | Used by | Purpose |
| --- | --- | --- |
| `PORT` | `scripts/serve.mjs` | Port for the local website preview (default 4387). |
| `PAGEPRESS_CHROMIUM_PATH` | `extension-smoke.mjs`, `site-smoke.mjs`, `store-assets.mjs` | Browser executable for Playwright tests. |
| `PAGEPRESS_HEADED` | `extension-smoke.mjs` | `1` = run the smoke test with a visible (off-screen) window. |

Vercel has no project environment variables that the app needs.

## 7. Data model (there is no database)

All state is in `chrome.storage`, on the user's machine:

| Area | Key | Contents |
| --- | --- | --- |
| `local` | `options` | Last-used export options (`normalizeOptions` shape: scope, paper, orientation, margin, footer, quality, hideSticky, loadImages, cleanPrint). |
| `local` | `savedPreset` | The user's saved preset (same shape). |
| `session` | `exportStatus` | `{ phase, progress, message, tabId, title, downloadId, filename, totalTiles, capturedTiles, pages, error, updatedAt }`. Phases: idle, preparing, capturing, assembling, saving, done, error, canceled. |
| `session` | `pendingDownloads` | `{ [downloadId]: blobUrl }` so Blob URLs can be revoked after Chrome finishes the download. |
| `session` | `selection` | `{ count, selecting, tabId }` for Pick & hide. |

No history of exported pages is kept. Removing the extension clears everything.

## 8. How the main flows work

**Visual export (popup "Save as PDF", or Alt+Shift+P):**
1. Popup → `background` `EXPORT` (or `commands.onCommand`). `activeTab()` rejects anything that is not `http(s)://` or `file://`. Options are saved, and `job` is set (only one export at a time).
2. `inject()` runs `content.js` via `chrome.scripting.executeScript`. If that fails, the user sees a message: "Chrome does not allow…", or, for `file://`, "enable file URL access".
3. `PREPARE` (content): adds a style that freezes animations, turns `position: sticky` elements into `relative` (full page), waits for fonts, optionally scrolls through up to 16 viewports to wake lazy images, then returns metrics (`scrollWidth`/`scrollHeight` of the document, viewport, DPR, title, URL).
4. `planTiles()` splits the document into viewport-sized tiles (max 80 tiles, max 100,000 CSS px tall). `pdfLayout()` decides the paper size, canvas width (1200/1800/2400 px by quality) and page count.
5. `ensureOffscreen()` creates `offscreen.html`; `BEGIN` starts a jsPDF document.
6. For each tile: `ensureActive()` (same tab, window and URL, else abort) → `MOVE` (from the 2nd tile on, hide `position: fixed` elements, then scroll and wait 180 ms + 2 frames) → throttle to ≥550 ms between captures (Chrome's `captureVisibleTab` quota) → check that scroll and size are unchanged → `chrome.tabs.captureVisibleTab` (PNG data URL) → `TILE` to offscreen, which crops/scales into page canvases and flushes finished pages to jsPDF as JPEG.
7. `RESTORE` the page, `FINISH` → Blob URL → `chrome.downloads.download` (`saveAs: false`, uniquified, sanitised filename) → poll for up to 20 s, then revoke the Blob (or `downloads.onChanged` does it later) → close the offscreen document when idle.
8. Progress goes to `storage.session.exportStatus` and the action badge (`NN%`, or `!` on error). The popup listens to `storage.onChanged`. If the worker lost the job, the next `GET_STATUS` marks it interrupted and restores the page.

**Searchable print:** `PRINT` → content injects `@page` size/margin and, if "clean print" is on, unclips overflow, makes fixed/sticky static, hides `nav` and cookie banners, and opens `<details>` → `window.print()` → `afterprint` restores everything.

**Pick & hide:** `SELECT` adds capture-phase mousemove/click/keydown listeners and a blue outline overlay. Clicks set `display: none !important` on the target, and Escape stops. `UNDO`/`RESET` restore the elements. Hidden elements are restored automatically after every export or print.

Safety nets: a 90 s watchdog in the content script restores the page if the background goes quiet, and `pagehide` restores too.

## 9. Authentication and permissions

- No user accounts or sign-in anywhere (extension or website).
- Extension permissions: `activeTab`, `scripting`, `downloads`, `storage`, `offscreen`. There are **no `host_permissions`**, and `build.mjs` and `package-store.mjs` both fail the build if any are added. The justification for each permission is in `store/privacy-form.txt`. Adding any permission changes what users see on install, triggers a fresh store review and may disable the extension for existing users until they accept. Treat that as a product decision, not a code change.
- Internal messages: background and offscreen check `sender.id === chrome.runtime.id`. The content script ignores messages without `target: 'content'`.
- CSP for extension pages: `script-src 'self'; object-src 'self'`. No remote code (a store policy requirement).

## 10. Deployment

- **Website**: Vercel project `pagepress` (Mulham's Vercel team), Git-connected to `MulhamKassab/pagepress`, **production branch `codex/pagepress`**. `vercel.json`: `buildCommand: npm run build`, `outputDirectory: website`, `cleanUrls`, plus security headers (`nosniff`, referrer policy, permissions policy) and a 5-minute cache on `/downloads/*`. Node 24.x.
  - Domains: `webtopdf.mulhamkassab.dev` (production); `pdf.mulhamkassab.dev` (308 → webtopdf); `pagepress-olive.vercel.app`. Preview URLs are behind Vercel SSO protection.
  - DNS for `mulhamkassab.dev` is managed outside this repo (the portfolio project).
- **Extension**: uploaded by hand in the Chrome Web Store developer dashboard (publisher account owned by Mulham). The upload is `.artifacts/webtopdf-extension-vX.Y.Z.zip` from `npm run build`, with `manifest.json` at the archive root. There is no CI and no automated store publish.
- **GitHub releases**: tags `v1.0.0`–`v1.1.0`, all marked pre-release, with the ZIP, the store kit and the PNGs attached.

## 11. Rules — never do these without Mulham's explicit OK

- Never deploy, push to `codex/pagepress`/`main`, change Vercel settings or domains, or upload to the Chrome Web Store.
- Never add `host_permissions`, `<all_urls>`, `tabs`, `debugger`, `webRequest`, remote scripts, analytics or any network call to the extension. "All processing is local" is a promise made in the store privacy form and on the website.
- Never bump `manifest.json` `version` without also updating `package.json`, the release notes and the store privacy-form header, and tagging.
- Never commit `extension/vendor/`, ZIPs, `.artifacts/` or `.vercel/`.
- Keep `store/privacy-form.txt`, `website/privacy.html` and the store dashboard's privacy answers consistent. Any change in data handling means updating all three before the release.
- Commit under Mulham Kassab's personal Git identity (never a work email); no AI co-author lines.
- This repository is **public**. Never commit personal emails, dashboard IDs or anything from the store developer account.

## 12. Known traps

1. **Two branches, one truth.** Vercel builds `codex/pagepress`, while Mulham works on `main`. Release to both.
2. **`npm run build` dirties tracked files** (`website/downloads/release.json` size changes with CRLF vs LF). Revert it unless releasing.
3. **The content script guard is global**: `globalThis.__PAGEPRESS_CONTENT__` lives in the extension's isolated world. Renaming it, or loading two copies, changes which listener answers. After an extension update or reload, tabs that already ran the old script may need a page reload (see BUGS.md).
4. **Capture quota**: Chrome limits `captureVisibleTab` to about 2 calls/second. `CAPTURE_INTERVAL_MS = 550` and the module-level `lastCaptureAt` share the limit across jobs. Do not lower it.
5. **Everything compares the URL**: `ensureActive()` aborts if `tab.url` changes, including `#hash`/`history.replaceState` changes made by the page itself while it scrolls.
6. **Playwright is not a declared dependency.** The smoke scripts use whatever `playwright` resolves, or a Codex runtime path in the home folder. Branded Chrome 137+ refuses `--load-extension`.
7. **Tests mock `chrome.*`**. A passing `npm test` does not prove that `activeTab` or a real toolbar click works. Before every store upload, test the built ZIP by hand in a normal Chrome profile.
8. **Footer text is ASCII-only**: jsPDF's built-in Helvetica cannot draw Arabic or other non-Latin text, so the footer replaces those characters with `?`.
9. **Store text in the repo is not the live text.** The live store description was edited in the dashboard and differs from `store/listing.txt`. Several docs (`docs/CHROME_WEB_STORE.md`, `store/submission-guide.md`, release notes 1.1.0) still say the store submission is pending.
10. **Windows checkout** uses `core.autocrlf=true`; ZIP contents and sizes differ from a Linux (Vercel) build.
