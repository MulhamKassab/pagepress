// Shared translation helper for extension pages and the service worker.
// Strings live in extension/_locales/<lang>/messages.json. The English fallback
// passed at each call site keeps tests (which have no chrome.i18n) and any
// missing key readable. scripts/check.mjs verifies every t('key', 'English')
// call has a matching English entry with the same text, and an Arabic entry.
export function format(text, substitutions = []) {
  const values = Array.isArray(substitutions) ? substitutions : [substitutions];
  return String(text).replace(/\$(\d)/g, (match, index) => (values[index - 1] ?? match));
}

export function t(key, fallback, substitutions = []) {
  const values = (Array.isArray(substitutions) ? substitutions : [substitutions]).map(String);
  try {
    const message = globalThis.chrome?.i18n?.getMessage?.(key, values);
    if (message) return message;
  } catch { /* fall back to the English text below */ }
  return format(fallback, values);
}

// 'ar' and other right-to-left UI languages.
export function isRtl() {
  try { return /^(ar|fa|he|ur)\b/i.test(globalThis.chrome?.i18n?.getUILanguage?.() || ''); } catch { return false; }
}
