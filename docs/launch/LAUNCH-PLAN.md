# webTopdf — relaunch and growth plan (18 Nov 2026)

Companion to [BUGS.md](BUGS.md) (IDs `WT-nn`) and [AGENTS.md](../../AGENTS.md). Estimates are rough working hours for one developer with an agent.

## Where it stands today

webTopdf is a small, well-built Chrome extension that is already live on the Chrome Web Store (version 1.1.0; the store's "Updated" date is 13 Oct 2026). It has **11 users and no ratings**. It saves the current page as an image PDF (full page or current view) or opens Chrome's print dialog for a text PDF. Everything runs on the user's machine: no server, no accounts, no analytics. Permissions are minimal (`activeTab`, `scripting`, `downloads`, `storage`, `offscreen`; no host access), which is the strongest thing about it for store review and user trust.

The code is tidy and tested: 24 unit tests pass, and the build produces the store ZIP. The capture engine handles ordinary pages well, but it breaks on several page types that are very common on the real web:
- pages that scroll inside a panel (silently exports one screen; WT-01);
- headers that turn fixed when you scroll (the whole export fails; WT-02);
- right-to-left pages with any horizontal overflow (fails; WT-03);
- pages that change their URL as you scroll (fails with a wrong message; WT-04).

Those four will drive bad reviews and need fixing before any promotion.

Around the product: the store listing is thin (one screenshot, English only, "Offered by kassabmulham"). The privacy policy is decent but has no contact address. There is no CI, the browser tests depend on an undeclared Playwright install, and several docs still describe the store submission as pending. The companion website (static, Vercel, production branch `codex/pagepress`) is fast and simple, but it has no social-preview tags, robots or sitemap.

## Check results

Run on 18 Nov 2026 in a fresh clone, branch `launch/audit` (= `74e12d7`), Node 24.19.0, npm 11.17.0, Windows 11.

| Command | Result |
| --- | --- |
| `npm ci` | OK. Installed jspdf 4.2.1 + fflate 0.8.2 and their dependency tree. Warning: core-js postinstall not covered by npm `allowScripts`. Took >5 min on this network. |
| `npm run check` | OK: "Checked 17 JavaScript files and all JSON manifests" (syntax only). |
| `npm test` | OK: **24 tests, 24 pass, 0 fail**, 0 skipped (2.7 s). |
| `npm run build` | OK: "webTopdf 1.1.0: packaged 17 extension files (163 KB)". Side effect: rewrote the tracked `website/downloads/release.json` (`bytes` 166925 → 167005, CRLF); reverted. |
| `npm audit` | 2 findings: DOMPurify ≤3.4.16 **critical** (transitive optional dependency of jsPDF, not shipped) and fflate 0.8.2 **moderate** (build-time only). See WT-29. |
| Typecheck | **Not available**: the project has no TypeScript and no `tsc`/JSDoc type checking. |
| Lint | **Not available**: no ESLint or other linter is configured. |
| `node scripts/extension-smoke.mjs` (Playwright Chromium) | **Could not run**: every Playwright Chromium build on this PC (1200–1255) is blocked from launching (`spawn UNKNOWN`, exit 126), probably by the audit machine's application policy. Branded Chrome is not installed. |
| `PAGEPRESS_CHROMIUM_PATH=msedge node scripts/extension-smoke.mjs` | **Failed: timed out after 300 s** (exit 124) with no report written. The likely cause is WT-09 (Edge holds downloads, so the next export is refused), not investigated further. |
| `PAGEPRESS_CHROMIUM_PATH=msedge node scripts/site-smoke.mjs` | **Passed**: all site checks pass, including 320 px layouts, clipboard fallback, no-JS install links, and no browser errors. |
| Scratch repro harness (Edge, local fixtures, outside the repo) | 10 cases: plain page OK; LTR wide OK; RTL no-overflow OK; **RTL wide failed (WT-03)**; **URL-on-scroll failed (WT-04)**; **inner scroller exported 1 page (WT-01)**; **JS-fixed header failed (WT-02) and was seen fixed and visible mid-capture (WT-06)**; lazy images finished (pixels not inspected); PDF tab exported 1 page (WT-08); stale-content-script case did not complete (harness error). Also observed: an export started right after a finished one was refused (WT-09). |
| Live website (public pages only, `curl`) | `/`, `/install`, `/privacy`, `/downloads/release.json` and both ZIPs return 200 and match the repo at `74e12d7` (ignoring CRLF). `/robots.txt`, `/sitemap.xml` and `/terms` return 404. HSTS, nosniff, referrer and permissions policies present; no CSP. `pdf.mulhamkassab.dev` → 308 to webtopdf. |
| Store page (public) | v1.1.0, 161 KiB, updated 13 Oct 2026, 11 users, 0 ratings, 1 screenshot, English, non-trader, declares Web history + User activity + Website content. |
| Vercel (read-only lookup) | Project `pagepress`; the last 3 production deploys all came from `codex/pagepress` (latest `74e12d7`). Domains: webtopdf (prod), pdf (308), pagepress-olive.vercel.app. Nothing was changed. |

## Launch-readiness checklist

| Area | Status | Note |
| --- | --- | --- |
| Security and authorization | **Ready** | Minimal permissions with no host access; sender checks on every message channel; strict extension CSP; no remote code; build guards against `host_permissions`. Website lacks a CSP (WT-32); audit noise (WT-29). There are no user accounts, so no authorization surface. |
| Privacy policy and terms | **Partial** | Store-required policy is live and accurate about local processing. It is missing a contact email and identity, a data-request route, children's data, and wording that matches the store's declared categories (WT-15). There is no Terms page; it is optional for a free extension but useful (MIT already covers the code). |
| Email sending | **Ready** | Not applicable: the extension and site send no email. A *receiving* support address is still needed (WT-36). |
| Error monitoring | **Missing** | By design: no telemetry, which is promised. The only error signal is store reviews and GitHub issues. Plan: a "Report a problem" link that pre-fills an email or issue with the version, browser and error text, chosen by the user, with no page content. |
| Uptime / health checks | **Missing** | No monitor on `webtopdf.mulhamkassab.dev` (and the privacy URL the store links to). Add one shared monitor. |
| Backups and restore | **Ready** | Not applicable for user data: no database. Source of truth is GitHub; release ZIPs are attached to GitHub releases. Store listing text and images should also live in `store/` (currently out of sync, WT-16). |
| Analytics | **Missing** | By design: no extension analytics, as promised. Use the store dashboard's install, uninstall and impression stats. For the website, a cookie-less option (Vercel Web Analytics) is possible but means updating the privacy page, which currently says "no analytics scripts". This is Mulham's decision. |
| SEO and social preview tags | **Missing** | No OG/Twitter tags, robots, sitemap or canonical; duplicate `/` vs `/install` (WT-33). |
| Accessibility | **Partial** | Popup and site have focus styles, `aria-pressed`, `role=status` and labelled form controls. Pick & hide is mouse-only (WT-27); progress semantics are missing (WT-28); there has been no contrast or screen-reader pass. |
| Performance | **Partial** | Website is tiny and cached. Extension: 550 ms/tile is a hard Chrome limit (an 80-screen page takes about 1 minute). Huge pages risk memory failure (WT-11); per-tile full-DOM scans (WT-23). |
| Mobile | **Partial** | Site layout passes 320 px checks. The extension is desktop-only (inherent), and the site doesn't say so (WT-34). |
| Arabic/English and RTL | **Missing** | UI, store and site are English only (WT-14); RTL pages fail with overflow (WT-03); Arabic text in the footer becomes `?` (WT-07). |
| Support / contact channel | **Partial** | GitHub Issues only (WT-36); the store shows a personal Gmail as the developer contact (WT-16). |

## Phase 1 — must do before the relaunch (version 1.2.0)

| # | What | Why | Size | Hours | Closes |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Make full-page capture adaptive: re-measure after every scroll, clamp or re-plan the remaining tiles, detect content shifts, and stop cleanly with a "captured what's loaded" message. | The most common real-world failures; currently the whole export throws. | M | 6 | WT-02, WT-10 |
| 1.2 | Re-hide fixed elements after each scroll settles; hide only for `row > 0`. | Repeated headers are the #1 complaint for screenshot-to-PDF tools. | S | 2 | WT-06, WT-21 |
| 1.3 | RTL support in tile geometry (negative `scrollX`), plus a unit test and an RTL fixture in the smoke test. | Arabic pages fail outright; core audience. | S | 3 | WT-03 |
| 1.4 | Relax `ensureActive()`: same tab and window and same origin+path; ignore hash and same-document history changes; detect real navigation with `tabs.onUpdated`. | Scroll-spy and news sites always fail today. | S | 2 | WT-04 |
| 1.5 | Detect inner scroll containers. Capture the main scroller (scroll the element, not the window), or at least warn before exporting one screen. | Silent loss of content on app-style pages. | M | 6 | WT-01 |
| 1.6 | Per-tile image readiness: wait up to ~1.5 s for images in view to load and decode; let the preload cover the whole page within a time cap. | Blank images look broken. | S | 3 | WT-05 |
| 1.7 | Unsupported-page UX: pre-check in the popup (chrome://, Web Store, PDF viewer, view-source), detect PDF documents, use friendly text for raw Chrome errors, and set the action title on shortcut errors. | Users currently find out after clicking, or get jargon. | M | 4 | WT-08, WT-12, WT-19, WT-20 |
| 1.8 | Release the export lock when the download starts. | "Already running" after a finished export. | S | 2 | WT-09 |
| 1.9 | Version the content-script guard and re-inject when a ping fails. | Updates through the store must not break open tabs. | S | 1 | WT-13 |
| 1.10 | Footer: keep non-ASCII URL parts percent-encoded (quick fix now; a Unicode font goes in Phase 3); guard `decodeURIComponent`. | Arabic URLs print as `?????`. | S | 2 | WT-07 |
| 1.11 | Test tooling: declare Playwright, use Chrome for Testing, add RTL / inner-scroll / JS-fixed / URL-change / lazy-image fixtures to `extension-smoke`, per-step timeouts. | Every fix above needs a regression test; the browser tests must run on any machine. | M | 5 | WT-17 |
| 1.12 | CI: GitHub Actions running `npm ci && npm run verify` (plus the smoke test on Chrome for Testing) on push and PR to `codex/pagepress`/`main`; add ESLint. | Nothing runs automatically today. | S | 3 | WT-18 |
| 1.13 | Privacy policy update: support email, controller identity, store data categories, children, data requests, change log; new effective date. | Store and user trust; required before you collect support emails. | S | 2 | WT-15, WT-36 |
| 1.14 | Docs and release hygiene: fix "pending" texts, sync `store/listing.txt` with the live text, mark v1.1.0 as the full release, fix the `release.json` churn, bump fflate, add a dompurify override. | Stops future agents and reviewers working from wrong facts. | S | 2 | WT-29, WT-30, WT-31 |
| 1.15 | Release routine (see below) and a manual test pass of the built ZIP in a normal Chrome profile with the toolbar click, then upload 1.2.0. | Tests mock `chrome.*`; the `activeTab` path is only proven by hand. | S | 3 | — |

**Phase 1 total: about 46 hours** (15 items; 4 M, 11 S).

### Release and versioning routine (adopt in 1.15)

1. Work on a branch from `codex/pagepress`, then open a PR; CI must pass.
2. Bump `version` in **both** `extension/manifest.json` and `package.json` (semver: patch = fixes, minor = features, major = permission or behaviour changes). Add `docs/RELEASE_NOTES_X.Y.Z.md`.
3. `npm ci && npm run verify`; run `extension-smoke` and `site-smoke`; load `.artifacts/webtopdf-extension-vX.Y.Z.zip` unpacked in a clean Chrome profile and run the manual checklist (toolbar click, shortcut, full, current view, print, pick & hide, an Arabic page, a long page).
4. Merge, fast-forward **both** `codex/pagepress` and `main`, tag `vX.Y.Z`, and publish a GitHub release (not pre-release) with the ZIP.
5. Upload the same ZIP in the Chrome Web Store dashboard (and Edge Add-ons once listed). Update the store "What's new" text and, if data handling changed, the privacy page and privacy form first.
6. After approval, check the live listing version, install from the store into a clean profile, and check the website.

## Phase 2 — launch week

| # | What | Why | Size | Hours | Closes |
| --- | --- | --- | --- | --- | --- |
| 2.1 | Store listing refresh: 4–5 screenshots at 1280×800 (popup, before/after cleanup, full-page result, print mode, settings), a sharper first line and keywords ("save webpage as PDF", "full page screenshot to PDF"), and a small promo tile refresh. Keep `store/` in sync. | One screenshot and no ratings convert poorly; the listing is the main acquisition channel. | M | 5 | WT-16 |
| 2.2 | Arabic: `_locales/en` + `_locales/ar` for the manifest and popup strings, RTL-aware popup CSS, and an Arabic store listing (name, summary, description, screenshots with Arabic UI). | A new market with little competition; matches the RTL fixes. | M | 8 | WT-14 |
| 2.3 | Website SEO and social: OG/Twitter tags + a 1200×630 image, `robots.txt`, `sitemap.xml`, canonical, custom 404, merge or differentiate `/install`, "desktop only" note on mobile, a CSP header. | Shares on LinkedIn/WhatsApp look broken today; cheap wins. | S | 4 | WT-32, WT-33, WT-34 |
| 2.4 | Support channel: a support email (forwarding on the domain), a "Report a problem" link in the popup that pre-fills version, browser and error (no page content), and a short FAQ on the site (protected pages, text vs image PDF, long pages). | Turns silent uninstalls into feedback; a store review signal. | S | 3 | WT-36 |
| 2.5 | Review prompt: after the 3rd successful export, show a one-line, dismissible "Enjoying webTopdf? Rate it" link in the popup, with a local counter only (no tracking) and never shown again after dismissal. | Ratings move store ranking; the current 0 ratings hurt conversion. | S | 2 | — |
| 2.6 | Edge Add-ons submission (same ZIP; Edge already runs it, as this audit's Edge runs show). Listing text plus screenshots reused. | A second store with little effort. | S | 3 | — |
| 2.7 | Uptime monitor on the site and the privacy URL (shared setup), and a keyword check on `/privacy`. | The store links to the privacy URL; if it is down, store review can flag the listing. | S | 1 | — |
| 2.8 | Decide the manual ZIP's future: remove it, or move it to a developer section with a version note; retire `pagepress-extension.zip`. | Avoid outdated manual installs. | S | 1 | WT-35 |
| 2.9 | Announce: portfolio case study, LinkedIn/X post, Product Hunt or Arabic tech communities, "Show HN"-style post with the privacy angle. | Initial installs and reviews. | S | 3 (Mulham) | — |

## Phase 3 — after launch: improvements and growth

| # | What | Why | Size | Hours | Closes |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Memory-safe PDF pipeline: JPEG capture for compact/balanced, transferable bitmaps instead of base64 JSON, a DPR cap, a size estimate before export, and a clear out-of-memory message. | Very long pages at High quality. | M | 8 | WT-11 |
| 3.2 | Unicode footer and metadata: embed a subset font (Latin + Arabic) and write the page title into the footer and metadata correctly. | Arabic users; nicer PDFs. | M | 5 | WT-07 (full), WT-26 |
| 3.3 | Firefox port: replace the offscreen document with the background page (Firefox supports MV3 event pages with DOM), adapt `browser_specific_settings`, test `captureVisibleTab` and downloads, then an AMO listing. | A third store; the privacy-first audience fits Firefox. | L | 16 | — |
| 3.4 | Selectable text in Visual PDF: an invisible text layer from DOM text positions (or "hybrid" mode). | The most requested feature category for these tools; also searchable PDFs. | L | 24 | — |
| 3.5 | Pick & hide for keyboard users, an on-page hint bar, and shadow-DOM-aware sticky/fixed detection; scan only candidates once instead of every tile. | Accessibility and speed. | M | 6 | WT-23, WT-24, WT-27, WT-28 |
| 3.6 | Very wide pages: split horizontally across PDF pages or auto-landscape. | Readability. | S | 3 | WT-22 |
| 3.7 | Print mode: smarter nav hiding (site header/footer only), plus a "keep navigation" toggle. | Avoid removing tables of contents. | S | 2 | WT-25 |
| 3.8 | Selection-only export: drag a region or pick one element to export just that part. | A common need; differentiator. | M | 8 | — |
| 3.9 | Store growth loop: monthly listing review using dashboard stats (impressions → installs → uninstalls), A/B the first screenshot, answer every review within a week. | Compounding growth with no telemetry. | S | 1/month | — |
| 3.10 | Consider renaming the GitHub repo to `webtopdf` and the Vercel project (GitHub keeps redirects), and update support URLs in the next release. | One name everywhere. | S | 2 | — |

## Needs Mulham

- **Branch decision:** keep `codex/pagepress` as the production branch (and `main` as a mirror), or switch Vercel production and the GitHub default to `main`. Either way, one rule, written in AGENTS.md.
- **Store publisher profile:** set the display name to "Mulham Kassab" (currently "kassabmulham"). Choose the public developer contact (the personal Gmail is shown today) or create a support address. Confirm the EU **trader / non-trader** declaration.
- **Support email:** pick the address (e.g. `support@` or `hello@mulhamkassab.dev`) and set up receiving/forwarding at the domain's DNS provider.
- **Privacy policy:** approve the new wording, your controller identity and country, and whether to add a short Terms page.
- **Website analytics:** keep "no analytics" (current promise) or allow cookie-less site analytics with a policy update. The extension stays analytics-free either way.
- **Arabic listing:** provide or approve the Arabic name, summary and description (and decide whether the Arabic name stays "webTopdf").
- **Screenshots and promo:** approve the new store graphics; decide whether to make a promo video.
- **Accounts:** Microsoft Partner Center (Edge Add-ons, free) and a Mozilla AMO account for Firefox.
- **Google Search Console:** verify `mulhamkassab.dev` so the store shows the verified "official website".
- **Uploads:** each store upload, store review response and "publish" click is yours (dashboard sign-in).
- **Manual ZIP:** keep, move to a developer section, or remove.
- **Permissions:** confirm the rule "no new permissions without your sign-off". Phase 1 needs none.
- **Repo is public:** confirm that is intended (store text, privacy-form drafts and audit docs are visible to anyone).

## Shared with my other apps

Set these up once on `mulhamkassab.dev` and reuse them everywhere:

- **Support/sending email domain:** one receiving address (forwarding) for all products. If any app sends email (e.g. via Resend), set SPF, DKIM and DMARC on `mulhamkassab.dev` once, with a shared `noreply@` sender.
- **Legal page templates:** a privacy policy and terms skeleton with the same identity, contact and change-log blocks; each app fills in its data table.
- **Uptime and status:** one monitor account covering every `*.mulhamkassab.dev` site plus key URLs (privacy pages linked from stores), and optionally a public status page.
- **Error monitoring:** one Sentry (or similar) organisation for the web apps with backends. webTopdf deliberately stays out (no telemetry) but shares the "Report a problem" pattern.
- **Analytics:** one privacy-friendly choice (Vercel Web Analytics or Plausible) for marketing sites, with matching privacy-policy wording.
- **SEO kit:** OG image template, robots/sitemap pattern, custom 404, and Search Console verification of the apex domain (covers all subdomains).
- **CI template:** a reusable GitHub Actions workflow (`npm ci`, verify, Playwright on Chrome for Testing) and a release checklist.
- **Brand:** webTopdf uses its own cream/blue look, while the portfolio and Skybound use the MK black/green glass look. Decide whether product sites share the MK look or keep their own.
