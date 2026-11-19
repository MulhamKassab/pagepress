# webTopdf 1.2.0 (draft)

Draft release notes. Confirm the final list with the checks before publishing.

webTopdf 1.2.0 is a reliability and polish update. Everything still happens on your device.

## Pages that used to export badly

- Pages that scroll inside a panel (WT-01) are exported correctly, or you are told clearly to use Current view or Print instead of getting a single screen without warning.
- Headers that appear only after you scroll (WT-02, WT-06, WT-21) no longer repeat or shrink the page, including on wide pages.
- Right-to-left pages with horizontal overflow, such as Arabic sites (WT-03), now export instead of failing.
- Pages that change their address while you scroll (WT-04) no longer cancel the export.
- Images that load lazily (WT-05), pages that keep loading as you scroll (WT-10), and elements inside web components (WT-24) are captured more reliably.
- Very wide pages stay readable (WT-22), and big pages use less memory and run faster (WT-11, WT-23).
- Clean print keeps in-article tables of contents and breadcrumbs (WT-25).

## Clearer messages and easier use

- Pages webTopdf cannot capture, such as Chrome pages, the Web Store and PDFs, are shown in the popup before you click, with a short reason (WT-08, WT-19).
- Plain-language error messages instead of raw browser errors (WT-12), and a clear notice when the keyboard shortcut cannot run (WT-20).
- You can start a new export as soon as the previous one is done (WT-09).
- After an extension update, open tabs keep working without reloading (WT-13).
- Arabic and accented web addresses and titles show correctly in the PDF footer and file properties (WT-07, WT-26).
- Pick and hide works with the keyboard (WT-27), and the progress bar is announced by screen readers (WT-28).

## Arabic and support

- The popup is now available in Arabic, with a right-to-left layout (WT-14).
- A Report a problem link in the popup opens a pre-filled report with only the version, browser and error text, never page content (WT-36).
- New Help & FAQ page, and a clearer privacy policy that says who is responsible, how to contact the developer and what data is handled (WT-15, WT-36).

## Website

- Better link previews when sharing, a custom not-found page, search engine files and stronger security headers (WT-32, WT-33).
- A note for phone and tablet visitors that webTopdf needs desktop Chrome or Edge (WT-34).
- The manual ZIP is now a small developer option with a version notice (WT-35).
- Store listing text and documents updated (WT-16, WT-31).

Developer-facing: lint and continuous checks were added (WT-17, WT-18), dependencies were updated so the audit reports no known vulnerabilities (WT-29), and builds no longer change tracked files (WT-30).
