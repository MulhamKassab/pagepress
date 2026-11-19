// Which pages webTopdf can work on. Shared by the popup (to explain up front)
// and the service worker (to refuse before injecting). Pure, unit-testable.
import { t } from './i18n.js';

const STORE_HOSTS = new Set(['chromewebstore.google.com', 'chrome.google.com', 'microsoftedge.microsoft.com']);

// Returns { ok, kind, message }.
// kind: 'web' | 'file' | 'internal' | 'store' | 'pdf' | 'other'
export function classifyUrl(url) {
  let parsed;
  try { parsed = new URL(String(url || '')); } catch { return refuse('other'); }
  const protocol = parsed.protocol;
  if (protocol === 'http:' || protocol === 'https:') {
    if (STORE_HOSTS.has(parsed.hostname) && (parsed.hostname !== 'chrome.google.com' || parsed.pathname.startsWith('/webstore'))) return refuse('store');
    if (/\.pdf$/i.test(parsed.pathname)) return { ok: true, kind: 'pdf', message: t('pagePdfMaybe', 'This looks like a PDF file. If Chrome is showing it in its PDF viewer, use the viewer’s download button instead.') };
    return { ok: true, kind: 'web', message: '' };
  }
  if (protocol === 'file:') return { ok: true, kind: 'file', message: '' };
  if (['chrome:', 'edge:', 'about:', 'chrome-extension:', 'extension:', 'devtools:', 'view-source:', 'chrome-search:', 'chrome-untrusted:'].includes(protocol)) return refuse('internal');
  return refuse('other');
}

function refuse(kind) {
  const messages = {
    internal: t('pageInternal', 'Browser pages like Settings, Extensions and New Tab can’t be saved. Open a normal webpage first.'),
    store: t('pageStore', 'The browser blocks extensions on its own web store pages. Open a different webpage first.'),
    other: t('pageOther', 'webTopdf works on normal webpages (http or https). Open one first.'),
  };
  return { ok: false, kind, message: messages[kind] };
}
