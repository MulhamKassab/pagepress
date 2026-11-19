# Chrome Web Store release preparation

webTopdf is live on the Chrome Web Store: https://chromewebstore.google.com/detail/webtopdf/mjaclamnjdmipobljileifmgkppiaeeb. This document describes how updates are prepared and what the listing and privacy declarations should say. Each update is a new package uploaded to the existing item by the publisher (see `store/submission-guide.md`).

## Package

Run `npm ci && npm run verify`. Upload `.artifacts/webtopdf-extension-v<version>.zip` (the version in `extension/manifest.json`), with `manifest.json` directly at the archive root. The release contains the locally bundled jsPDF library and its MIT license. No remote code runs inside the extension.

## Listing (live text, kept in `store/listing.txt`)

- **Name:** webTopdf
- **Publisher display name:** Mulham Kassab
- **Category:** Productivity
- **Summary:** Save webpages as a PDF on your device. Full-page capture, browser print and page cleanup. By Mulham Kassab.
- **Homepage:** https://mulhamkassab.dev/
- **Product website:** https://webtopdf.mulhamkassab.dev/
- **Support:** https://webtopdf.mulhamkassab.dev/install (Help & FAQ), the developer email shown on the listing, and GitHub issues for non-private reports
- **Privacy policy:** https://webtopdf.mulhamkassab.dev/privacy
- **Languages:** English and Arabic (Arabic text is in `store/listing.txt`)

Description (English, as published):

> Save the webpage you’re viewing as a PDF, directly from Chrome.
>
> Capture the full page or just the current view, choose your paper settings, and download the PDF to your device.
>
> - Full-page and current-view capture
> - A4 or Letter paper, portrait or landscape
> - Adjustable margins and image quality
> - Hide unwanted elements before exporting
> - Optional source, date, and page-number footer
> - Saved settings and Alt+Shift+P quick export
>
> PDF processing happens locally. No account, subscription, analytics, or page uploads.
>
> Visual PDFs preserve the page’s appearance as images. For selectable text, use Searchable print, which opens Chrome’s print preview.
>
> Chrome’s internal and protected pages cannot be captured. Very long or changing pages may work better with current-view capture.
>
> Created by Mulham Kassab · https://mulhamkassab.dev/

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

The publisher uploads each package and handles store review. A ZIP hosted on Vercel is an unpacked developer build, not a Chrome Web Store installation; the website offers it only in a small "For developers" section.

## Ready-to-upload graphics

Use `store/screenshot-capture.png` (1280×800), `store/promo-small.png` (440×280), `store/promo-marquee.png` (1400×560), and `store/icon128.png`. The screenshot and promo tiles are 24-bit RGB PNGs without alpha; the icon retains transparent padding. These show the actual extension interface and its current branding. The account publisher display name should be Mulham Kassab. Chrome removed manifest `author` support in February 2024, so attribution is included in the popup, listing description, and publisher display name; the manifest homepage is https://mulhamkassab.dev/. Use `store/fields.txt` for the exact asset and URL mapping.

Official references: https://developer.chrome.com/docs/extensions/reference/manifest/author and https://developer.chrome.com/docs/webstore/images.
