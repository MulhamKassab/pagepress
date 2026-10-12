# Chrome Web Store release preparation

The public website and personal-beta ZIP are ready. A store release is a separate publisher submission; the website deliberately does not claim that webTopdf is listed in the store.

## Package

Run `npm ci && npm run verify`. Upload `.artifacts/webtopdf-extension-v1.1.0.zip`, with `manifest.json` directly at the archive root. The release contains the locally bundled jsPDF library and its MIT license. No remote code runs inside the extension.

## Listing draft

- **Name:** webTopdf
- **Publisher display name:** Mulham Kassab
- **Category:** Productivity
- **Summary:** Save the current webpage as a local PDF. Full-page captures, print mode, and simple page cleanup.
- **Homepage:** https://mulhamkassab.dev/
- **Product website:** https://webtopdf.mulhamkassab.dev/
- **Support:** https://github.com/MulhamKassab/pagepress/issues
- **Privacy policy:** https://webtopdf.mulhamkassab.dev/privacy
- **Languages:** English

Suggested description:

> webTopdf by Mulham Kassab — https://mulhamkassab.dev/
>
> Keep the recipe, research, menu, or page you want to revisit. webTopdf turns the page open in your browser into a PDF on your device.
>
> Visual PDF captures the full loaded webpage or current view, stitches scrolling views, and downloads a paginated PDF. Choose A4 or Letter, portrait or landscape, margins, image quality, and a source/date footer. Hide selected elements, undo changes, and save a preferred export preset. Alt+Shift+P provides quick save with the last settings when that shortcut is available.
>
> Print PDF opens Chrome's print preview for a text-friendly PDF using the source website's print layout. Select Save as PDF in that dialog. Visual captures preserve appearance as images; their captured text is not selectable.
>
> Export happens locally. webTopdf has no account, page-upload endpoint, remote scripts, advertising, or analytics. It requests temporary access to the page only when you invoke it.
>
> Chrome blocks extension access on browser-internal and other protected pages. Keep the captured tab active until saving finishes. Very long, infinite-scrolling, virtualized, or internally scrolling pages may need current-view capture or Print PDF. webTopdf restores page styles and scroll position after capture, cancellation, or a recoverable failure.

## Single purpose and permissions

Single purpose: create a PDF of a webpage the user deliberately chooses, with optional temporary layout preparation.

| Permission | Justification |
| --- | --- |
| activeTab | Temporary access to the current tab after a user action, for the selected export. |
| scripting | Measure and prepare the page, perform scrolling capture, hide selected elements, and restore the page. |
| downloads | Download the PDF created locally and show the resulting file in Chrome Downloads. |
| storage | Save export preferences and keep temporary progress and download-recovery state. |
| offscreen | Assemble captured views into PDF pages and manage a local Blob URL without a foreground window. |

No persistent host permissions, browsing-history permission, debugger permission, remotely hosted code, or background collection of pages.

## Privacy declarations to review in the publisher dashboard

webTopdf processes website content, page title, URL, and rendered screenshots locally to perform the chosen capture. Temporary status includes the latest export title and download state for the current browser session. Export preferences remain in local extension storage. Page content is not transmitted to webTopdf, sold, or used for advertising, analytics, or unrelated purposes.

Complete the current dashboard's data-use declarations accurately for local processing; do not describe the product as never handling website content. Select the publisher's preferred public contact email in the account settings. No private email address is embedded in the extension or listing draft.

## Release checks

- Automated regression checks cover capture coverage, page boundaries, dimensions, filenames, cancellation, page restoration, and local PDF encoding.
- Real Chromium tests exercise captureVisibleTab, content scripting, offscreen rendering, downloads, horizontal overflow, current view, tab switching, and cancellation on a controlled local fixture.
- The automated capture test uses an isolated test-only all-URL grant because Playwright cannot invoke the native toolbar user gesture that grants activeTab. It blocks external requests and contains no user account or browsing data. The production manifest remains activeTab-only and is fingerprinted before and after the test. Test the production package by invoking the toolbar button in an ordinary Chrome profile before submitting to the store.
- Website installation instructions, extension download, and desktop/mobile layouts are checked.
- Include store-sized product screenshots and the supplied 128px icon. The actual popup capture is in `.artifacts/browser-smoke/popup.png`; website screenshots are in `.artifacts/qa/`.

The publisher must complete any required account registration, agreements, payment, and store review. A ZIP hosted on Vercel is an unpacked beta distribution, not a Chrome Web Store installation.

## Ready-to-upload graphics

Use `store/screenshot-capture.png` (1280×800), `store/promo-small.png` (440×280), and `store/icon128.png`. These show the actual extension interface and its current branding. The account publisher display name should be Mulham Kassab. Chrome removed manifest `author` support in February 2024, so attribution is included in the popup, listing description, and publisher display name; the manifest homepage is https://mulhamkassab.dev/.

Official references: https://developer.chrome.com/docs/extensions/reference/manifest/author and https://developer.chrome.com/docs/webstore/images.
