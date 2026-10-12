PagePress 1.0.1 personal beta

Save the current webpage as a PDF on your device. Full-page and viewport visual capture, browser-print mode, page cleanup, A4/Letter settings, source/date footers, saved presets, progress, cancellation, and Alt+Shift+P quick save are included.

This update shares Chrome's capture-rate limit across consecutive exports, so rapidly saving several current views no longer risks exceeding the browser quota. The regression test checks three consecutive exports.

Download the ZIP, extract it, and use Chrome's Extensions page → Developer mode → Load unpacked. Keep the extracted folder in place. The installation guide and working sample PDF demo are at https://webtopdf.mulhamkassab.dev/install. Existing unpacked installations can replace their extracted files and click Reload on Chrome's Extensions page.

Visual PDFs preserve the page's appearance as images. Use Print PDF for selectable text where the website supports it. Protected pages and some long or changing layouts have browser limitations.

Validated with 24 automated regression tests, isolated real-Chromium capture/download checks, rendered PDF inspection, and desktop/mobile demo checks. Processing is local; the production extension requests temporary active-tab access, with no persistent all-site or debugger permission.

This beta is not yet listed in the Chrome Web Store. The store listing, privacy information, and permission explanations are prepared in docs/CHROME_WEB_STORE.md.
