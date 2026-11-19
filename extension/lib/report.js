// Builds the prefilled GitHub issue link for the popup's "Report a problem".
// Only the extension version, browser string and last error text are included;
// never the page URL, title or content.
export const REPORT_URL = 'https://github.com/MulhamKassab/pagepress/issues/new';

export function reportUrl(version, userAgent, lastError) {
  const body = [
    'What happened?',
    '',
    '',
    '---',
    `webTopdf version: ${version || 'unknown'}`,
    `Browser: ${userAgent || 'unknown'}`,
    // Browser error texts can quote a URL; drop any so no page address leaves the device.
    `Last error shown: ${lastError ? String(lastError).replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[link removed]') : 'none'}`,
  ].join('\n');
  return `${REPORT_URL}?${new URLSearchParams({ title: 'Problem report', body })}`;
}
