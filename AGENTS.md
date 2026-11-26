# AGENTS.md — webTopdf (repo: pagepress)

Guide for coding agents and new contributors. Read this before you change anything.
Last reviewed: 19 Nov 2026 (release 1.2.0 fixes all audit items). The launch audit is kept privately, outside this public repo.

## 1. What this is and who it is for

**webTopdf** is a Chrome extension (Manifest V3) that saves the current webpage as a PDF, by Mulham Kassab. It is live on the Chrome Web Store:
https://chromewebstore.google.com/detail/webtopdf/mjaclamnjdmipobljileifmgkppiaeeb (store: version 1.1.0, "Updated October 13, 2026"; the code is at 1.2.0, which Mulham uploads by hand).

The UI is in **English and Arabic** (`extension/_locales/en|ar`, right-to-left popup when the browser language is Arabic).

- **Visual PDF**: scroll-and-screenshot capture of the full page or the current view, stitched into a paginated image PDF (text is not selectable).
- **Searchable print**: injects print CSS and opens Chrome's print dialog; the user picks "Save as PDF".
- Options: A4/Letter, portrait/landscape, margins, image quality, source/date/page-number footer, "avoid repeated sticky headers", "preload images", presets, **Pick & hide** (click page elements to hide them before export), and an **Alt+Shift+P** quick-save shortcut.
- Everything runs locally in the browser. No accounts, no server, no analytics in the extension. The website (website/) loads only Vercel Web Analytics (/_vercel/insights/script.js, same origin, no cookies) since 26 Nov 2026; never add it to the extension.

Audience: everyday Chrome users who want to keep an article, recipe, receipt or research page as a PDF.

A small **companion website** at https://webtopdf.mulhamkassab.dev (static HTML on Vercel) links to the store, hosts the Help & FAQ page (`/install`, linked from the popup) and the privacy policy the store requires, and keeps a ZIP for developers in a small "For developers" note.

### Names: "PagePress" vs "webTopdf"

The product was built as **PagePress** and renamed **webTopdf** in 1.1.0 (commit `9afe4f1`). Everything the user sees says webTopdf. The old name remains in internals:

| Where | Name used |
| --- | --- |
| Store listing, `extension/manifest.json` name, popup, website, privacy page, README, `store/*` | webTopdf |
| GitHub repo `MulhamKassab/pagepress`, all support/issue URLs (incl. `extension/lib/report.js`), `release.json` `source` | pagepress |
| `package.json` / `package-lock.json` `"name": "pagepress"` | pagepress |
| Vercel project `pagepress` and its `pagepress-*.vercel.app` aliases | pagepress |
| `extension/content.js`: `__PAGEPRESS_CONTENT__` guard, `data-pagepress`, `data-pagepress-unclip`, `data-pagepress-static` | pagepress (internal markers) |
| `vercel.json`: 301 redirect from the old `/downloads/pagepress-extension.zip` to `webtopdf-extension.zip` | pagepress |
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
- Audit work lives on `launch/audit` (docs only); the 1.2.0 fixes were built on `launch/fixes` and merged into both branches.

## 3. Stack and versions

- Extension: plain JavaScript ES modules, **no bundler, no framework, no TypeScript**. MV3 service worker (`type: module`), an offscreen document, and an injected content script. `minimum_chrome_version: 116` (`chrome.runtime.getContexts`).
- PDF engine: **jsPDF 4.2.1** (`dependencies`), copied by the build into `extension/vendor/jspdf.umd.min.js`, together with its license. Only `addImage`/`text` are used. jsPDF's optional `html()` dependencies (DOMPurify, html2canvas, canvg) are referenced by name inside the UMD file but are **not shipped** and never called.
- Build tool: **fflate 0.8.3** (devDependency) for ZIP packaging. `overrides` pins DOMPurify ≥3.4.17 so `npm audit` is clean.
- Runtime: **Node.js 24.x** (`engines`; tested with 24.19.0, npm 11.17.0).
- Website: hand-written static HTML/CSS plus a small `app.js`; strict CSP (no inline scripts or styles allowed). No build step other than copying the ZIP and writing `release.json`.
- Lint: **ESLint 9** flat config (`eslint.config.mjs`).
- Browser tests: **Playwright 1.62.1** (devDependency); browsers are not downloaded on install. Point `PAGEPRESS_CHROMIUM_PATH` at Edge or Chrome for Testing.

## 4. Folder map

```text
extension/            The product. Everything in here (plus vendor/) is zipped and uploaded to the store.
  manifest.json       MV3 manifest: name, version, permissions, Alt+Shift+P command, CSP.
  background.js       Service worker: message router, export pipeline, capture throttle, downloads, badge.
  content.js          Injected into the page on demand: measure, scroll, sticky/fixed handling, Pick & hide, print CSS, restore.
  offscreen.html/.js  Offscreen document: draws screenshot tiles onto page canvases and builds the PDF with jsPDF.
  lib/geometry.js     Pure functions: option normalising, tile plan, RTL scroll mapping, crops, PDF layout and size estimate, page slicing, safe filename. Unit-tested.
  lib/i18n.js         t(key, englishFallback, subs) over chrome.i18n; isRtl(). Offscreen has no chrome.i18n, so it returns errorKey and the worker translates.
  lib/pages.js        classifyUrl(url): which pages can be captured, with the reason shown in the popup and errors.
  lib/report.js       Builds the "Report a problem" GitHub issue link (version, browser, error text with links stripped; never page data).
  _locales/en, ar     All user-facing strings. scripts/check.mjs fails if any t()/data-i18n/__MSG__ key is missing or the English text differs.
  popup.html/.js/.css The toolbar popup UI (CSS is mostly minified onto one line, plus RTL rules).
  icons/              16/32/48/128 PNG icons and logo.svg (logo.svg is copied from website/brand by the build).
  vendor/             Generated by the build (git-ignored): jsPDF and its license.
  LICENSE             Copied from the root LICENSE by the build (tracked).
website/              Companion site served by Vercel as-is (outputDirectory).
  index.html          Store link, 3-step guide, mobile "desktop only" note, "For developers" ZIP note.
  install.html        Help & FAQ (protected pages, image vs searchable PDF, long pages, panels, Arabic/RTL, support).
  privacy.html        The privacy policy linked from the store listing (data table matching the store categories).
  404.html, robots.txt, sitemap.xml, brand/og.png   SEO and social-preview files.
  downloads/          Generated by the build (git-ignored): release.json and the ZIP.
  brand/logo.svg      Logo and favicon.
scripts/              build.mjs (vendor + ZIP + release.json), check.mjs (syntax + i18n check), serve.mjs (local site with vercel.json headers/redirects),
                      extension-smoke.mjs / site-smoke.mjs (Playwright, local only), store-assets.mjs (store PNGs),
                      package-store.mjs (submission kit ZIP), generate-icons.py (Pillow).
tests/                node:test unit/integration tests with mocked chrome.* APIs (geometry, background, content, PDF, popup).
.github/workflows/    ci.yml: npm ci, verify, lint (GitHub Actions is currently blocked by billing; run the same steps locally).
store/                Store listing text, privacy-form answers, permission justifications and the upload PNGs.
docs/                 Store-prep notes and per-release notes.
.artifacts/           Build and test output (git-ignored): versioned ZIPs, smoke reports, screenshots.
```

## 5. Install, run, test, build (local)

```sh
npm ci                  # installs jspdf, fflate, playwright, eslint (core-js postinstall may trigger an allow-scripts warning)
npm run check           # syntax check of every .js/.mjs/.json plus the i18n key check
npm run lint            # ESLint
npm test                # node --test tests/*.test.mjs; 67 tests
npm run build           # vendors jsPDF into extension/vendor, writes website/downloads/ (zip + release.json, ignored) and .artifacts/webtopdf-extension-vX.Y.Z.zip
npm run verify          # check + lint + test + build
npm run dev             # serves website/ at http://127.0.0.1:4387 (PORT overrides)
```

Load the extension for manual testing: run `npm run build` first (it creates `extension/vendor/`), then go to `chrome://extensions`, turn on Developer mode, choose **Load unpacked** and select `extension/`.

Browser smoke tests (optional; local fixture, throwaway profile, external requests blocked):

```sh
PAGEPRESS_CHROMIUM_PATH="<path to chrome or msedge>" node scripts/extension-smoke.mjs   # writes .artifacts/browser-smoke/report.json
PAGEPRESS_CHROMIUM_PATH="<path>" node scripts/site-smoke.mjs
```

Branded Google Chrome (version 137 and later) ignores `--load-extension`. Use Chrome for Testing or Microsoft Edge. On the audit machine, Playwright's Chromium builds were blocked from launching (exit 126); Edge worked. Because Playwright cannot press the toolbar button, the extension smoke test uses a **test copy** of the extension with `<all_urls>` (the production manifest is hashed before and after to prove it was not changed). Its fixtures check **pixels** in the produced PDFs: RTL wide page, URL changes while scrolling, inner scroll panel, header that turns fixed, slow lazy images, PDF tab, two-column wide page. Edge's `browserContext.close()` can hang, so the scripts race it against a timeout and kill the profile's processes.

**Before committing, run `git status`.** `npm run build` re-copies `extension/LICENSE` and `extension/icons/logo.svg` (normally unchanged).

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
1. Popup → `background` `EXPORT` (or `commands.onCommand`). `activeTab()` uses `classifyUrl()` and refuses browser pages, web stores and non-web URLs with a plain reason. Options are saved, and `job` is set (only one export at a time).
2. `inject()` pings the page (`ALIVE`); if no current-version content script answers, it clears the old guard and runs `content.js` via `chrome.scripting.executeScript`. Raw Chrome errors are mapped to plain messages (`friendlyError`).
3. `PREPARE` (content): refuses PDF documents; adds a style that freezes animations; turns `position: sticky` into `relative` (full page); finds an inner scroll panel if the document itself does not scroll; waits for fonts; optionally pre-scrolls the whole page (time-capped) to wake lazy images; returns metrics (size, viewport, DPR, direction, title, URL).
4. `planTiles()` splits the document into viewport tiles (max 80 tiles, max 100,000 CSS px tall); in RTL documents x positions are mapped to Chrome's 0…negative `scrollX`. `pdfLayout()` decides paper size, canvas width (1200/1800/2400 px by quality, DPR capped at 2), page count and a memory estimate; oversized jobs are refused with advice.
5. `ensureOffscreen()` creates `offscreen.html`; `BEGIN` starts a jsPDF document.
6. For each tile: `ensureActive()` (same tab and window; same-document URL changes are allowed, real navigations abort) → `MOVE` (scroll, wait for images in view, then hide fixed elements found so far, only for rows after the first) → re-measure: if the page shrank, the remaining tiles are re-targeted (3 tries, then a clear error); if it grew, the planned length is kept and the done message says so → throttle to ≥550 ms between captures → `captureVisibleTab` (PNG for High, JPEG otherwise) → `TILE` to offscreen.
7. `RESTORE` the page, `FINISH` → Blob URL → `chrome.downloads.download` → `job` is released immediately → the Blob is revoked when Chrome reports the download complete (polling in its own try, or `downloads.onChanged`) → offscreen closes when idle. The done message can add notes (inner panel, page grew, content shifted, very wide page).
8. Progress goes to `storage.session.exportStatus` and the action badge (`NN%`, or `!` on error, with the error as the button tooltip). The popup listens to `storage.onChanged`. If the worker lost the job, the next `GET_STATUS` marks it interrupted and restores the page.

**Searchable print:** `PRINT` → content injects `@page` size/margin and, if "clean print" is on, unclips overflow, makes fixed/sticky static, hides site navigation (not tables of contents inside the article) and cookie banners, and opens `<details>` → `window.print()` → `afterprint` restores everything.

**Pick & hide:** `SELECT` shows an on-page hint bar and a blue outline. Mouse: click hides. Keyboard: Tab/arrow keys move the outline, Enter hides, Escape stops. Hidden elements get `display: none !important`. `UNDO`/`RESET` restore the elements. Hidden elements are restored automatically after every export or print.

Safety nets: a 90 s watchdog in the content script restores the page if the background goes quiet, and `pagehide` restores too.

## 9. Authentication and permissions

- No user accounts or sign-in anywhere (extension or website).
- Extension permissions: `activeTab`, `scripting`, `downloads`, `storage`, `offscreen`. There are **no `host_permissions`**, and `build.mjs` and `package-store.mjs` both fail the build if any are added. The justification for each permission is in `store/privacy-form.txt`. Adding any permission changes what users see on install, triggers a fresh store review and may disable the extension for existing users until they accept. Treat that as a product decision, not a code change.
- Internal messages: background and offscreen check `sender.id === chrome.runtime.id`. The content script ignores messages without `target: 'content'`.
- CSP for extension pages: `script-src 'self'; object-src 'self'`. No remote code (a store policy requirement).

## 10. Deployment

- **Website**: Vercel project `pagepress` (Mulham's Vercel team), Git-connected to `MulhamKassab/pagepress`, **production branch `codex/pagepress`**. `vercel.json`: `buildCommand: npm run build`, `outputDirectory: website`, `cleanUrls`, the old-ZIP redirect, security headers (strict CSP, `X-Frame-Options: DENY`, `nosniff`, referrer and permissions policies) and a 5-minute cache on `/downloads/*`. Node 24.x.
  - Domains: `webtopdf.mulhamkassab.dev` (production); `pdf.mulhamkassab.dev` (308 → webtopdf); `pagepress-olive.vercel.app`. Preview URLs are behind Vercel SSO protection.
  - DNS for `mulhamkassab.dev` is managed outside this repo (the portfolio project).
- **Extension**: uploaded by hand in the Chrome Web Store developer dashboard (publisher account owned by Mulham). The upload is `.artifacts/webtopdf-extension-vX.Y.Z.zip` from `npm run build`, with `manifest.json` at the archive root. There is no automated store publish. `.github/workflows/ci.yml` exists but GitHub Actions is blocked by billing, so run `npm ci && npm run verify` locally before merging.
- **GitHub releases**: tags `v1.0.0`–`v1.1.0`, all marked pre-release, with the ZIP, the store kit and the PNGs attached.

## 11. Rules — never do these without Mulham's explicit OK

- Never deploy, push to `codex/pagepress`/`main`, change Vercel settings or domains, or upload to the Chrome Web Store.
- Never add `host_permissions`, `<all_urls>`, `tabs`, `debugger`, `webRequest`, remote scripts, analytics or any network call to the extension. "All processing is local" is a promise made in the store privacy form and on the website.
- Never bump `manifest.json` `version` without also updating `package.json`, the release notes and the store privacy-form header, and tagging.
- Never commit `extension/vendor/`, ZIPs, `.artifacts/` or `.vercel/`.
- Keep `store/privacy-form.txt`, `website/privacy.html` and the store dashboard's privacy answers consistent. Any change in data handling means updating all three before the release.
- Every user-facing string goes through `t('key', 'English')` (or `data-i18n`) with matching entries in both `_locales/en` and `_locales/ar`; `npm run check` enforces it. Arabic text shown in the store or popup should be reviewed by Mulham.
- Never put the page URL, title or content into the problem-report link or any log.
- Commit under Mulham Kassab's personal Git identity (never a work email); no AI co-author lines.
- This repository is **public**. Never commit personal emails, dashboard IDs or anything from the store developer account.

## 12. Known traps

1. **Two branches, one truth.** Vercel builds `codex/pagepress`, while Mulham works on `main`. Release to both.
2. **Offscreen has no `chrome.i18n`.** Never call `t()` in offscreen.js; return `{ errorKey, error }` and let the service worker translate.
3. **The content script guard is versioned**: `globalThis.__PAGEPRESS_CONTENT__` holds the extension version. The worker pings `ALIVE` and re-injects after updates. Keep the name (old tabs still carry it).
4. **Capture quota**: Chrome limits `captureVisibleTab` to about 2 calls/second. `CAPTURE_INTERVAL_MS = 550` and the module-level `lastCaptureAt` share the limit across jobs. Do not lower it.
5. **RTL scrolling**: in right-to-left documents Chrome's `scrollX` runs from 0 to negative. Use the geometry helpers (`toNativeScrollX`/`toVisualScrollX`), never raw `scrollTo(x)`.
6. **Edge and Playwright**: `browserContext.close()` can hang on Edge; the smoke scripts already race it and kill the profile. Branded Chrome 137+ refuses `--load-extension`.
7. **Tests mock `chrome.*`**. A passing `npm test` does not prove that `activeTab` or a real toolbar click works. Before every store upload, test the built ZIP by hand in a normal Chrome profile.
8. **Footer text is ASCII-only**: jsPDF's built-in Helvetica cannot draw Arabic, so non-ASCII URL parts stay percent-encoded in the footer. A Unicode font is a later improvement.
9. **Store text**: `store/listing.txt` mirrors the live dashboard text (with an Arabic section). Edit the dashboard and the file together.
10. **Windows checkout** uses `core.autocrlf=true`; ZIP contents and sizes differ from a Linux (Vercel) build. `release.json` is generated, not tracked.
